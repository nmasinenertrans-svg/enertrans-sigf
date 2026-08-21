import { prisma } from '../db.js'
import { pushUserNotifications, resolveOperationalNotificationRecipients } from './userNotifications.js'

// Mismos umbrales que se usaban en la planilla de origen (Parametros): a
// partir de 90.000 km recorridos la cubierta se considera para cambio.
const REPLACEMENT_KM_THRESHOLD = 90000

export const runTireWearAutomations = async (): Promise<void> => {
  const activeTires = await prisma.tire.findMany({
    where: { isActive: true, wearAlertSentAt: null },
    select: {
      id: true,
      position: true,
      installedKm: true,
      unit: { select: { internalCode: true, currentKilometers: true } },
    },
  })

  const dueForReplacement = activeTires.filter(
    (tire) => tire.unit.currentKilometers - tire.installedKm >= REPLACEMENT_KM_THRESHOLD,
  )

  if (dueForReplacement.length === 0) {
    return
  }

  const recipients = await resolveOperationalNotificationRecipients()
  if (recipients.length === 0) {
    return
  }

  for (const tire of dueForReplacement) {
    const kmOnTire = tire.unit.currentKilometers - tire.installedKm
    await pushUserNotifications(recipients, {
      title: 'Cubierta para cambio',
      description: `Unidad ${tire.unit.internalCode}, posicion ${tire.position}: ${kmOnTire.toLocaleString('es-AR')} km recorridos, revisar cambio.`,
      severity: 'warning',
      target: '/tires',
      eventType: 'TIRE_REPLACEMENT_DUE',
    })
    await prisma.tire.update({
      where: { id: tire.id },
      data: { wearAlertSentAt: new Date() },
    })
  }
}
