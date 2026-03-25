import type { Prisma } from '@prisma/client'
import { prisma } from '../db.js'
import { pushUserNotifications, resolveOperationalNotificationRecipients } from './userNotifications.js'

const CRM_AUTOMATION_STATE_KEY = '__crmAutomationState'
const SENT_RETENTION_DAYS = 45

const parseBooleanEnv = (value: string | undefined, defaultValue: boolean): boolean => {
  if (value === undefined) return defaultValue
  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return defaultValue
}

const parseNumberEnv = (value: string | undefined, defaultValue: number): number => {
  if (!value) return defaultValue
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue
}

export const isCrmAutomationEnabled = () => parseBooleanEnv(process.env.CRM_AUTOMATIONS_ENABLED, true)
export const getCrmAutomationIntervalMinutes = () => parseNumberEnv(process.env.CRM_AUTOMATIONS_INTERVAL_MINUTES, 30)

const getStaleDealDays = () => parseNumberEnv(process.env.CRM_AUTOMATION_STALE_DAYS, 14)
const getDueSoonHours = () => parseNumberEnv(process.env.CRM_AUTOMATION_DUE_SOON_HOURS, 24)
const getCloseWindowDays = () => parseNumberEnv(process.env.CRM_AUTOMATION_CLOSE_WINDOW_DAYS, 7)
const getOverdueEscalationHours = () => parseNumberEnv(process.env.CRM_AUTOMATION_OVERDUE_ESCALATION_HOURS, 24)

type CrmAutomationState = {
  lastRunAt?: string
  sentByKey: Record<string, string>
}

export type CrmAutomationRunSummary = {
  triggeredBy: 'scheduler' | 'manual'
  generated: number
  skippedDuplicates: number
  scannedDeals: number
  scannedActivities: number
  skippedBecauseRunning: boolean
  lastRunAt: string
}

const toRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

const readAutomationState = (featureFlagsValue: unknown): CrmAutomationState => {
  const featureFlags = toRecord(featureFlagsValue)
  const rawState = toRecord(featureFlags[CRM_AUTOMATION_STATE_KEY])
  const rawSentByKey = toRecord(rawState.sentByKey)

  const sentByKey = Object.entries(rawSentByKey).reduce<Record<string, string>>((acc, [key, value]) => {
    if (typeof value === 'string' && value.trim().length > 0) {
      acc[key] = value
    }
    return acc
  }, {})

  const lastRunAt = typeof rawState.lastRunAt === 'string' && rawState.lastRunAt.trim().length > 0 ? rawState.lastRunAt : undefined

  return { lastRunAt, sentByKey }
}

const normalizeRecipients = (recipientIds: Array<string | null | undefined>): string[] =>
  Array.from(new Set(recipientIds.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)))

const formatDateTime = (value: Date): string =>
  value.toLocaleString('es-AR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })

const buildDayKey = (value: Date): string => value.toISOString().slice(0, 10)

const pruneSentByKey = (sentByKey: Record<string, string>, referenceDate: Date): Record<string, string> => {
  const threshold = referenceDate.getTime() - SENT_RETENTION_DAYS * 24 * 60 * 60 * 1000
  return Object.entries(sentByKey).reduce<Record<string, string>>((acc, [key, value]) => {
    const ts = new Date(value).getTime()
    if (!Number.isFinite(ts) || ts >= threshold) {
      acc[key] = value
    }
    return acc
  }, {})
}

let running = false

export const runCrmAutomations = async (triggeredBy: 'scheduler' | 'manual' = 'scheduler'): Promise<CrmAutomationRunSummary> => {
  const now = new Date()
  const nowIso = now.toISOString()

  if (running) {
    return {
      triggeredBy,
      generated: 0,
      skippedDuplicates: 0,
      scannedDeals: 0,
      scannedActivities: 0,
      skippedBecauseRunning: true,
      lastRunAt: nowIso,
    }
  }

  running = true
  try {
    const settings = await prisma.appSettings.findUnique({ where: { id: 'app' }, select: { featureFlags: true } })
    const state = readAutomationState(settings?.featureFlags)
    const sentByKey = { ...state.sentByKey }

    let generated = 0
    let skippedDuplicates = 0
    const todayKey = buildDayKey(now)
    const staleCutoff = new Date(now.getTime() - getStaleDealDays() * 24 * 60 * 60 * 1000)
    const dueSoonCutoff = new Date(now.getTime() + getDueSoonHours() * 60 * 60 * 1000)
    const closeWindowCutoff = new Date(now.getTime() + getCloseWindowDays() * 24 * 60 * 60 * 1000)
    const overdueEscalationMs = getOverdueEscalationHours() * 60 * 60 * 1000

    const [openDeals, pendingActivities] = await Promise.all([
      prisma.crmDeal.findMany({
        where: {
          stage: { notIn: ['WON', 'LOST'] },
          isHistorical: false,
        },
        select: {
          id: true,
          title: true,
          stage: true,
          dealKind: true,
          companyName: true,
          expectedCloseDate: true,
          lastContactAt: true,
          updatedAt: true,
          assignedToUserId: true,
          createdByUserId: true,
        },
      }),
      prisma.crmActivity.findMany({
        where: {
          status: 'PENDING',
          dueAt: { not: null },
          deal: {
            stage: { notIn: ['WON', 'LOST'] },
            isHistorical: false,
          },
        },
        select: {
          id: true,
          summary: true,
          dueAt: true,
          dealId: true,
          deal: {
            select: {
              id: true,
              title: true,
              assignedToUserId: true,
              createdByUserId: true,
            },
          },
        },
      }),
    ])

    const managerialRecipients = await resolveOperationalNotificationRecipients()

    const notify = async (params: {
      dedupeKey: string
      recipientUserIds: string[]
      title: string
      description: string
      severity: 'info' | 'warning' | 'danger'
      eventType: string
    }) => {
      if (sentByKey[params.dedupeKey]) {
        skippedDuplicates += 1
        return
      }
      if (params.recipientUserIds.length === 0) {
        return
      }
      await pushUserNotifications(params.recipientUserIds, {
        title: params.title,
        description: params.description,
        severity: params.severity,
        target: '/crm',
        eventType: params.eventType,
        createdAt: nowIso,
      })
      sentByKey[params.dedupeKey] = nowIso
      generated += 1
    }

    for (const activity of pendingActivities) {
      if (!activity.dueAt) continue
      const dueAt = activity.dueAt
      const recipients = normalizeRecipients([activity.deal.assignedToUserId, activity.deal.createdByUserId])
      if (recipients.length === 0) continue

      if (dueAt <= now) {
        const overdueMs = now.getTime() - dueAt.getTime()
        const escalationRecipients =
          overdueMs >= overdueEscalationMs
            ? normalizeRecipients([...recipients, ...managerialRecipients])
            : recipients

        await notify({
          dedupeKey: `crm.activity.overdue:${activity.id}:${todayKey}`,
          recipientUserIds: escalationRecipients,
          title: 'CRM: actividad vencida',
          description: `${activity.deal.title}: "${activity.summary}" vencio el ${formatDateTime(dueAt)}.`,
          severity: 'danger',
          eventType: 'CRM_ACTIVITY_OVERDUE',
        })
        continue
      }

      if (dueAt <= dueSoonCutoff) {
        await notify({
          dedupeKey: `crm.activity.due_soon:${activity.id}:${todayKey}`,
          recipientUserIds: recipients,
          title: 'CRM: actividad por vencer',
          description: `${activity.deal.title}: "${activity.summary}" vence el ${formatDateTime(dueAt)}.`,
          severity: 'warning',
          eventType: 'CRM_ACTIVITY_DUE_SOON',
        })
      }
    }

    for (const deal of openDeals) {
      const recipients = normalizeRecipients([deal.assignedToUserId, deal.createdByUserId])
      if (recipients.length === 0) continue

      const lastTouch = deal.lastContactAt ?? deal.updatedAt
      if (lastTouch <= staleCutoff) {
        await notify({
          dedupeKey: `crm.deal.stale:${deal.id}:${todayKey}`,
          recipientUserIds: normalizeRecipients([...recipients, ...managerialRecipients]),
          title: 'CRM: oportunidad estancada',
          description: `${deal.title} (${deal.companyName}) sin seguimiento reciente.`,
          severity: 'warning',
          eventType: 'CRM_DEAL_STALE',
        })
      }

      if (deal.expectedCloseDate && deal.expectedCloseDate >= now && deal.expectedCloseDate <= closeWindowCutoff) {
        await notify({
          dedupeKey: `crm.deal.close_window:${deal.id}:${todayKey}`,
          recipientUserIds: recipients,
          title: 'CRM: cierre proximo',
          description: `${deal.title} (${deal.companyName}) tiene cierre estimado para ${formatDateTime(deal.expectedCloseDate)}.`,
          severity: 'info',
          eventType: 'CRM_DEAL_CLOSE_WINDOW',
        })
      }
    }

    const latestSettings = await prisma.appSettings.findUnique({ where: { id: 'app' }, select: { featureFlags: true } })
    const latestFeatureFlags = toRecord(latestSettings?.featureFlags)
    const nextState: CrmAutomationState = {
      lastRunAt: nowIso,
      sentByKey: pruneSentByKey(sentByKey, now),
    }

    const nextFeatureFlags = JSON.parse(
      JSON.stringify({
        ...latestFeatureFlags,
        [CRM_AUTOMATION_STATE_KEY]: nextState,
      }),
    ) as Prisma.InputJsonObject

    await prisma.appSettings.upsert({
      where: { id: 'app' },
      update: { featureFlags: nextFeatureFlags },
      create: { id: 'app', featureFlags: nextFeatureFlags },
    })

    return {
      triggeredBy,
      generated,
      skippedDuplicates,
      scannedDeals: openDeals.length,
      scannedActivities: pendingActivities.length,
      skippedBecauseRunning: false,
      lastRunAt: nowIso,
    }
  } finally {
    running = false
  }
}

