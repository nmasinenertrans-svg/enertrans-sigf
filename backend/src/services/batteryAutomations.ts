import { prisma } from '../db.js'
import { pushUserNotifications, resolveOperationalNotificationRecipients } from './userNotifications.js'

const ALERT_DAYS_BEFORE = 30

const addMonths = (date: Date, months: number): Date => {
  const result = new Date(date.getTime())
  result.setMonth(result.getMonth() + months)
  return result
}

/**
 * Las baterias se controlan por fecha (no por km/horas): se avisa cuando la
 * fecha estimada de vencimiento (installedAt + lifespanMonths) esta a menos
 * de ALERT_DAYS_BEFORE dias, o ya paso.
 */
export const runBatteryExpirationAutomations = async (): Promise<void> => {
  const now = new Date()
  const alertCutoff = new Date(now.getTime() + ALERT_DAYS_BEFORE * 24 * 60 * 60 * 1000)

  const activeBatteries = await prisma.battery.findMany({
    where: { isActive: true, expirationAlertSentAt: null, installedAt: { not: null } },
    select: {
      id: true,
      position: true,
      brand: true,
      model: true,
      installedAt: true,
      lifespanMonths: true,
      unit: { select: { internalCode: true } },
    },
  })

  const dueForReplacement = activeBatteries.filter((battery) => {
    if (!battery.installedAt) return false
    const expiresAt = addMonths(battery.installedAt, battery.lifespanMonths)
    return expiresAt <= alertCutoff
  })

  if (dueForReplacement.length === 0) return

  const recipients = await resolveOperationalNotificationRecipients()
  if (recipients.length === 0) return

  for (const battery of dueForReplacement) {
    const expiresAt = addMonths(battery.installedAt as Date, battery.lifespanMonths)
    const isOverdue = expiresAt <= now
    const detail = [battery.brand, battery.model].filter(Boolean).join(' ')
    await pushUserNotifications(recipients, {
      title: isOverdue ? 'Batería vencida' : 'Batería por vencer',
      description: `Unidad ${battery.unit.internalCode}, batería ${battery.position}${detail ? ` (${detail})` : ''}: vence el ${expiresAt.toLocaleDateString('es-AR')}, revisar cambio.`,
      severity: 'warning',
      target: '/batteries',
      eventType: 'BATTERY_EXPIRATION_DUE',
    })
    await prisma.battery.update({ where: { id: battery.id }, data: { expirationAlertSentAt: now } })
  }
}
