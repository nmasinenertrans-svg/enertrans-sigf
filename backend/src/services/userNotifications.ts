import { UserRole } from '@prisma/client'
import { prisma, runWithSchemaFailover } from '../db.js'

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

// Antes esto se guardaba como un blob JSON compartido (un solo registro
// AppSettings, leido-modificado-escrito sin lock). Con varias asignaciones
// llegando cerca en el tiempo (CRM, Proyectos, Ordenes de Servicio, Tareas,
// todas a la vez) el read-modify-write se pisaba entre si y se perdian
// notificaciones en silencio (confirmado con un script de verificacion: de 3
// asignaciones simultaneas solo sobrevivian 2). Una tabla real con un INSERT
// por notificacion no tiene esa condicion de carrera.
export const pushUserNotifications = async (
  recipientUserIds: string[],
  notification: Omit<UserInboxNotification, 'id' | 'createdAt'> & { id?: string; createdAt?: string },
) => {
  if (recipientUserIds.length === 0) {
    return
  }

  const createdAt = notification.createdAt ? new Date(notification.createdAt) : new Date()

  await runWithSchemaFailover(() =>
    prisma.userNotification.createMany({
      data: recipientUserIds.map((userId) => ({
        userId,
        title: notification.title,
        description: notification.description,
        severity: notification.severity,
        target: notification.target ?? null,
        actorUserId: notification.actorUserId ?? null,
        eventType: notification.eventType ?? null,
        createdAt,
      })),
    }),
  )
}

export const getUserInboxNotifications = async (userId: string): Promise<UserInboxNotification[]> => {
  const rows = await runWithSchemaFailover(() =>
    prisma.userNotification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: MAX_NOTIFICATIONS_PER_USER,
    }),
  )

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    severity: row.severity as UserNotificationSeverity,
    createdAt: row.createdAt.toISOString(),
    target: row.target ?? undefined,
    actorUserId: row.actorUserId ?? undefined,
    eventType: row.eventType ?? undefined,
  }))
}
