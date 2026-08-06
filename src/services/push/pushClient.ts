import { apiRequest } from '../api/apiClient'

export type PushSupportState = 'unsupported' | 'denied' | 'subscribed' | 'not-subscribed'

const urlBase64ToUint8Array = (base64String: string): Uint8Array => {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

export const isPushSupported = (): boolean =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

export const getPushState = async (): Promise<PushSupportState> => {
  if (!isPushSupported()) {
    return 'unsupported'
  }
  if (Notification.permission === 'denied') {
    return 'denied'
  }
  try {
    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.getSubscription()
    return subscription ? 'subscribed' : 'not-subscribed'
  } catch {
    return 'not-subscribed'
  }
}

export const subscribeToPush = async (): Promise<void> => {
  if (!isPushSupported()) {
    throw new Error('Este navegador no soporta notificaciones push.')
  }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error('Permiso de notificaciones denegado.')
  }

  const keyResponse = await apiRequest<{ enabled: boolean; publicKey: string }>('/push/public-key')
  if (!keyResponse.enabled || !keyResponse.publicKey) {
    throw new Error('Las notificaciones push no estan configuradas en el servidor.')
  }

  const registration = await navigator.serviceWorker.ready
  const existing = await registration.pushManager.getSubscription()
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(keyResponse.publicKey) as BufferSource,
    }))

  const json = subscription.toJSON()
  await apiRequest('/push/subscribe', {
    method: 'POST',
    body: {
      endpoint: json.endpoint,
      keys: json.keys,
      userAgent: navigator.userAgent,
    },
  })
}

export const unsubscribeFromPush = async (): Promise<void> => {
  if (!isPushSupported()) {
    return
  }
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  if (!subscription) {
    return
  }
  const endpoint = subscription.endpoint
  await subscription.unsubscribe().catch(() => undefined)
  await apiRequest('/push/unsubscribe', { method: 'POST', body: { endpoint } }).catch(() => undefined)
}
