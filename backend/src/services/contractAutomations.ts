import { prisma } from '../db.js'
import { pushUserNotifications, resolveOperationalNotificationRecipients } from './userNotifications.js'

const ALERT_DAYS_BEFORE = 7

export const runContractExpirationAutomations = async (): Promise<void> => {
  const now = new Date()
  const alertCutoff = new Date(now.getTime() + ALERT_DAYS_BEFORE * 24 * 60 * 60 * 1000)

  const expiringContracts = await prisma.rentalContract.findMany({
    where: {
      status: 'ACTIVE',
      endDate: { gte: now, lte: alertCutoff },
      expirationAlertSentAt: null,
    },
    select: {
      id: true,
      code: true,
      clientName: true,
      endDate: true,
      unit: { select: { internalCode: true } },
    },
  })

  if (expiringContracts.length === 0) {
    return
  }

  const recipients = await resolveOperationalNotificationRecipients()
  if (recipients.length === 0) {
    return
  }

  for (const contract of expiringContracts) {
    const label = contract.code || contract.id.slice(0, 8)
    await pushUserNotifications(recipients, {
      title: 'Contrato por vencer',
      description: `Contrato ${label} (${contract.clientName || 'sin cliente'}, unidad ${contract.unit.internalCode}) vence el ${contract.endDate.toLocaleDateString('es-AR')}.`,
      severity: 'warning',
      target: '/contracts',
      eventType: 'CONTRACT_EXPIRING',
    })
    await prisma.rentalContract.update({
      where: { id: contract.id },
      data: { expirationAlertSentAt: now },
    })
  }
}
