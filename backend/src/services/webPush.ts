import webpush from 'web-push'
import { prisma } from '../db.js'

const vapidPublicKey = process.env.VAPID_PUBLIC_KEY ?? ''
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY ?? ''
const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:soporte@enertrans.com.ar'

const isConfigured = Boolean(vapidPublicKey && vapidPrivateKey)

if (isConfigured) {
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)
}

export const isPushConfigured = (): boolean => isConfigured

export const getVapidPublicKey = (): string => vapidPublicKey

export type PushPayload = {
  title: string
  body: string
  url?: string
  tag?: string
}

const removeSubscription = async (endpoint: string): Promise<void> => {
  await prisma.pushSubscription.deleteMany({ where: { endpoint } }).catch(() => undefined)
}

const deliverToSubscription = async (
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: PushPayload,
): Promise<void> => {
  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify(payload),
    )
  } catch (error: unknown) {
    const statusCode = (error as { statusCode?: number } | undefined)?.statusCode
    if (statusCode === 404 || statusCode === 410) {
      // Suscripcion vencida o revocada por el navegador: la limpiamos para no reintentar.
      await removeSubscription(subscription.endpoint)
      return
    }
    console.error('[push] error enviando notificacion:', error)
  }
}

export const sendPushToUser = async (userId: string, payload: PushPayload): Promise<void> => {
  if (!isConfigured || !userId) {
    return
  }
  const subscriptions = await prisma.pushSubscription.findMany({ where: { userId } })
  await Promise.all(subscriptions.map((subscription) => deliverToSubscription(subscription, payload)))
}

export const sendPushToAllUsers = async (payload: PushPayload, excludeUserId?: string): Promise<void> => {
  if (!isConfigured) {
    return
  }
  const subscriptions = await prisma.pushSubscription.findMany({
    where: excludeUserId ? { userId: { not: excludeUserId } } : undefined,
  })
  await Promise.all(subscriptions.map((subscription) => deliverToSubscription(subscription, payload)))
}
