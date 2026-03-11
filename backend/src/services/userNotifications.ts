import { Prisma, UserRole } from '@prisma/client'
import { prisma } from '../db.js'

const USER_NOTIFICATIONS_BY_USER_KEY = '__userNotificationsByUser'
const MAX_NOTIFICATIONS_PER_USER = 200
const DEFAULT_TARGET_USERNAMES = ['rbottero', 'galonso', 'nmasin']

export type UserNotificationSeverity = 'info' | 'warning' | 'danger'

export interface UserInboxNotification {
  id: string
  title: string
  description: string
  severity: UserNotificationSeverity
  createdAt: string
  target?: string
  actorUserId?: string
  eventType?: string
}

const toFeatureFlagsRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

const sanitizeNotification = (value: unknown): UserInboxNotification | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const source = value as Record<string, unknown>
  const id = typeof source.id === 'string' ? source.id.trim() : ''
  const title = typeof source.title === 'string' ? source.title.trim() : ''
  const description = typeof source.description === 'string' ? source.description.trim() : ''
  const severity = source.severity
  const createdAt = typeof source.createdAt === 'string' ? source.createdAt : ''
  const target = typeof source.target === 'string' ? source.target.trim() : ''
  const actorUserId = typeof source.actorUserId === 'string' ? source.actorUserId.trim() : ''
  const eventType = typeof source.eventType === 'string' ? source.eventType.trim() : ''

  if (!id || !title || !description || !createdAt) {
    return null
  }
  if (severity !== 'info' && severity !== 'warning' && severity !== 'danger') {
    return null
  }

  return {
    id,
    title,
    description,
    severity,
    createdAt,
    target: target || undefined,
    actorUserId: actorUserId || undefined,
    eventType: eventType || undefined,
  }
}

const readNotificationsByUser = (featureFlagsValue: unknown): Record<string, UserInboxNotification[]> => {
  const source = toFeatureFlagsRecord(featureFlagsValue)
  const rawMap = source[USER_NOTIFICATIONS_BY_USER_KEY]
  if (!rawMap || typeof rawMap !== 'object' || Array.isArray(rawMap)) {
    return {}
  }

  return Object.entries(rawMap as Record<string, unknown>).reduce<Record<string, UserInboxNotification[]>>(
    (acc, [userId, rawList]) => {
      if (!Array.isArray(rawList)) {
        return acc
      }
      const sanitizedList = rawList
        .map((item) => sanitizeNotification(item))
        .filter((item): item is UserInboxNotification => Boolean(item))
      if (sanitizedList.length > 0) {
        acc[userId] = sanitizedList
      }
      return acc
    },
    {},
  )
}

const sortAndTrim = (items: UserInboxNotification[]): UserInboxNotification[] =>
  items
    .slice()
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, MAX_NOTIFICATIONS_PER_USER)

const resolveTargetUsernames = (): string[] => {
  const envValue = process.env.NOTIFICATION_TARGET_USERNAMES ?? ''
  const parsed = envValue
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0)
  return parsed.length > 0 ? parsed : DEFAULT_TARGET_USERNAMES
}

export const resolveOperationalNotificationRecipients = async (actorUserId?: string): Promise<string[]> => {
  const users = await prisma.user.findMany({
    select: { id: true, username: true, role: true },
  })

  const targetUsernames = resolveTargetUsernames()
  const directTargets = users
    .filter((user) => targetUsernames.includes(user.username.toLowerCase()))
    .map((user) => user.id)

  const fallbackTargets = users
    .filter((user) => user.role === UserRole.GERENTE || user.role === UserRole.COORDINADOR)
    .map((user) => user.id)

  const resolved = (directTargets.length > 0 ? directTargets : fallbackTargets).filter((id) => id !== actorUserId)
  return Array.from(new Set(resolved))
}

export const pushUserNotifications = async (
  recipientUserIds: string[],
  notification: Omit<UserInboxNotification, 'id' | 'createdAt'> & { id?: string; createdAt?: string },
) => {
  if (recipientUserIds.length === 0) {
    return
  }

  const settings = await prisma.appSettings.findUnique({ where: { id: 'app' }, select: { featureFlags: true } })
  const featureFlags = toFeatureFlagsRecord(settings?.featureFlags)
  const notificationsByUser = readNotificationsByUser(featureFlags)

  const nextNotification: UserInboxNotification = {
    id: notification.id ?? `notif-${Date.now()}-${Math.round(Math.random() * 100000)}`,
    title: notification.title,
    description: notification.description,
    severity: notification.severity,
    createdAt: notification.createdAt ?? new Date().toISOString(),
    target: notification.target,
    actorUserId: notification.actorUserId,
    eventType: notification.eventType,
  }

  recipientUserIds.forEach((userId) => {
    const current = notificationsByUser[userId] ?? []
    notificationsByUser[userId] = sortAndTrim([nextNotification, ...current])
  })

  const nextFeatureFlags = JSON.parse(
    JSON.stringify({
      ...featureFlags,
      [USER_NOTIFICATIONS_BY_USER_KEY]: notificationsByUser,
    }),
  ) as Prisma.InputJsonObject

  await prisma.appSettings.upsert({
    where: { id: 'app' },
    update: { featureFlags: nextFeatureFlags },
    create: { id: 'app', featureFlags: nextFeatureFlags },
  })
}

export const getUserInboxNotifications = async (userId: string): Promise<UserInboxNotification[]> => {
  const settings = await prisma.appSettings.findUnique({ where: { id: 'app' }, select: { featureFlags: true } })
  const notificationsByUser = readNotificationsByUser(settings?.featureFlags)
  return sortAndTrim(notificationsByUser[userId] ?? [])
}
