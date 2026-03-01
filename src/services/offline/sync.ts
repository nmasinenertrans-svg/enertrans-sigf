import { ApiRequestError, apiRequest } from '../api/apiClient'
import { enqueueItem, getQueueItems, removeQueueItem, updateQueueItem, type OfflineQueueItem } from './queue'
import { recordSyncTelemetry } from './telemetry'

let syncing = false

const MAX_RETRY_ATTEMPTS = 5
const NON_RETRYABLE_STATUS_CODES = new Set([400, 404, 409, 422])

type RepairPayload = {
  id: string
  invoiceFileUrl?: string
  invoiceFileBase64?: string
  invoiceFileName?: string
} & Record<string, unknown>

type ExternalRequestPayload = {
  id: string
  providerFileUrl?: string
  providerFileBase64?: string
  providerFileName?: string
} & Record<string, unknown>

type AuditPayload = {
  id: string
  auditKind: string
  workOrderId?: string
  workOrderCode?: string
  unitId: string
  auditorUserId: string
  auditorName: string
  performedAt: string
  result: string
  observations?: string
  photoBase64List?: string[]
  reportPdfFileName?: string
  reportPdfFileBase64?: string
  reportPdfFileUrl?: string
  checklistSections: unknown[]
  unitKilometers?: number
  engineHours?: number
  hydroHours?: number
}

const parseDataUrl = (dataUrl: string) => {
  const [meta, base64] = dataUrl.split(',')
  const contentType = meta?.split(':')[1]?.split(';')[0] || 'application/octet-stream'
  return { contentType, base64: base64 || dataUrl }
}

const uploadDataUrl = async (dataUrl: string, fileName: string, folder: string) => {
  const { contentType } = parseDataUrl(dataUrl)
  const response = await apiRequest<{ url: string }>(`/files/upload`, {
    method: 'POST',
    body: {
      fileName,
      contentType,
      dataUrl,
      folder,
    },
  })
  return response.url
}

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) {
    return error.message
  }
  if (typeof error === 'object' && error && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message) {
      return message
    }
  }
  return fallback
}

const syncAudit = async (payload: AuditPayload) => {
  const photoUrls: string[] = []
  const photoList: string[] = payload.photoBase64List || []

  for (let index = 0; index < photoList.length; index += 1) {
    const dataUrl = photoList[index]
    try {
      const url = await uploadDataUrl(dataUrl, `audit-${payload.id}-${index}.jpg`, 'audits')
      photoUrls.push(url)
    } catch (error: unknown) {
      const message = getErrorMessage(error, 'Error de carga de adjunto')
      throw new Error(`AUDIT_PHOTO_UPLOAD_FAILED [${index + 1}/${photoList.length}] ${message}`)
    }
  }

  let reportPdfFileUrl = payload.reportPdfFileUrl || ''
  if (!reportPdfFileUrl && payload.reportPdfFileBase64) {
    try {
      reportPdfFileUrl = await uploadDataUrl(
        payload.reportPdfFileBase64,
        payload.reportPdfFileName || `audit-${payload.id}.pdf`,
        'audits',
      )
    } catch (error: unknown) {
      const message = getErrorMessage(error, 'Error de carga de informe PDF')
      throw new Error(`AUDIT_PDF_UPLOAD_FAILED ${message}`)
    }
  }

  const body = {
    id: payload.id,
    auditKind: payload.auditKind,
    workOrderId: payload.workOrderId,
    workOrderCode: payload.workOrderCode,
    unitId: payload.unitId,
    auditorUserId: payload.auditorUserId,
    auditorName: payload.auditorName,
    performedAt: payload.performedAt,
    result: payload.result,
    observations: payload.observations,
    photoUrls,
    checklist: {
      sections: payload.checklistSections,
      meta: reportPdfFileUrl
        ? {
            reportPdfFileUrl,
            reportPdfFileName: payload.reportPdfFileName || `audit-${payload.id}.pdf`,
          }
        : undefined,
    },
    unitKilometers: payload.unitKilometers ?? 0,
    engineHours: payload.engineHours ?? 0,
    hydroHours: payload.hydroHours ?? 0,
  }

  await apiRequest('/audits', { method: 'POST', body })
}

const syncItem = async (item: OfflineQueueItem) => {
  switch (item.type) {
    case 'fleet.create':
      await apiRequest('/fleet', { method: 'POST', body: item.payload })
      return
    case 'maintenance.create':
      await apiRequest('/maintenance', { method: 'POST', body: item.payload })
      return
    case 'workOrder.create':
      await apiRequest('/work-orders', { method: 'POST', body: item.payload })
      return
    case 'repair.create': {
      const payload = item.payload as RepairPayload
      let invoiceFileUrl = payload.invoiceFileUrl || ''
      let invoiceFileBase64 = payload.invoiceFileBase64 || ''

      if (invoiceFileBase64 && !invoiceFileUrl) {
        invoiceFileUrl = await uploadDataUrl(
          invoiceFileBase64,
          payload.invoiceFileName || `repair-${payload.id}.pdf`,
          'repairs',
        )
        invoiceFileBase64 = ''
      }

      await apiRequest('/repairs', {
        method: 'POST',
        body: {
          ...payload,
          invoiceFileUrl,
          invoiceFileBase64,
        },
      })
      return
    }
    case 'inventory.create':
      await apiRequest('/inventory', { method: 'POST', body: item.payload })
      return
    case 'audit.create':
      await syncAudit(item.payload as AuditPayload)
      return
    case 'externalRequest.create': {
      const payload = item.payload as ExternalRequestPayload
      let providerFileUrl = payload.providerFileUrl || ''
      let providerFileBase64 = payload.providerFileBase64 || ''

      if (providerFileBase64 && !providerFileUrl) {
        providerFileUrl = await uploadDataUrl(
          providerFileBase64,
          payload.providerFileName || `external-${payload.id}.pdf`,
          'external-requests',
        )
        providerFileBase64 = ''
      }

      await apiRequest('/external-requests', {
        method: 'POST',
        body: {
          ...payload,
          providerFileUrl,
          providerFileBase64,
        },
      })
      return
    }
    default:
      return
  }
}

const extractStatusCode = (error: unknown): number | null => {
  if (error instanceof ApiRequestError) {
    return error.status
  }
  const message = getErrorMessage(error, '')
  const statusMatch = message.match(/^(\d{3})\b/)
  return statusMatch ? Number(statusMatch[1]) : null
}

const classifySyncError = (item: OfflineQueueItem, error: unknown) => {
  const statusCode = extractStatusCode(error)
  const message = getErrorMessage(error, '')

  if (!statusCode) {
    return { shouldDrop: false, message: message || 'Error desconocido al sincronizar.' }
  }

  if (item.type === 'audit.create' && statusCode === 409) {
    return { shouldDrop: true, message: `409 conflicto: auditoria ya existente en servidor.` }
  }

  if (NON_RETRYABLE_STATUS_CODES.has(statusCode)) {
    return { shouldDrop: true, message: `${statusCode} error no recuperable para ${item.type}.` }
  }

  return { shouldDrop: false, message: message || `${statusCode} error recuperable al sincronizar.` }
}

const markSyncFailure = async (item: OfflineQueueItem, message: string) => {
  const nextAttemptCount = (item.attemptCount ?? 0) + 1
  const isBlocked = nextAttemptCount >= MAX_RETRY_ATTEMPTS
  const normalizedMessage = message || 'Error desconocido al sincronizar.'

  await updateQueueItem(item.id, {
    attemptCount: nextAttemptCount,
    lastAttemptAt: new Date().toISOString(),
    lastError: isBlocked
      ? `PAUSADO_AUTOMATICO: supero ${MAX_RETRY_ATTEMPTS} intentos. ${normalizedMessage}`
      : normalizedMessage,
    blocked: isBlocked,
  })
}

const getQueueItemById = async (id: string) => {
  const items = await getQueueItems()
  return items.find((entry) => entry.id === id)
}

export const enqueueAndSync = async (item: OfflineQueueItem) => {
  await enqueueItem(item)
  recordSyncTelemetry({
    name: 'queue.enqueued',
    itemType: item.type,
    itemId: item.id,
  })
  if (typeof navigator !== 'undefined' && navigator.onLine) {
    await syncQueue()
  }
}

export const syncQueueItem = async (id: string) => {
  const currentItem = await getQueueItemById(id)
  if (!currentItem) {
    return
  }

  if (currentItem.blocked) {
    await updateQueueItem(currentItem.id, {
      blocked: false,
      lastError: '',
    })
    recordSyncTelemetry({
      name: 'sync.unblocked.manual',
      itemType: currentItem.type,
      itemId: currentItem.id,
    })
  }

  const item = (await getQueueItemById(id)) ?? currentItem

  try {
    await syncItem(item)
    await removeQueueItem(item.id)
    recordSyncTelemetry({
      name: 'sync.success',
      itemType: item.type,
      itemId: item.id,
    })
  } catch (error: unknown) {
    const { shouldDrop, message } = classifySyncError(item, error)
    const statusCode = extractStatusCode(error)
    if (shouldDrop) {
      await removeQueueItem(item.id)
      recordSyncTelemetry({
        name: 'sync.dropped',
        itemType: item.type,
        itemId: item.id,
        statusCode,
        retryable: false,
        reason: message,
      })
      return
    }
    await markSyncFailure(item, message)
    const refreshedItem = await getQueueItemById(item.id)
    const blocked = Boolean(refreshedItem?.blocked)
    recordSyncTelemetry({
      name: blocked ? 'sync.blocked' : 'sync.failure',
      itemType: item.type,
      itemId: item.id,
      statusCode,
      retryable: true,
      reason: message,
    })
    throw error
  }
}

export const syncQueue = async () => {
  if (syncing) {
    return
  }

  syncing = true
  try {
    const items = await getQueueItems()
    for (const item of items) {
      if (item.blocked) {
        recordSyncTelemetry({
          name: 'sync.skipped.blocked',
          itemType: item.type,
          itemId: item.id,
          retryable: false,
          reason: 'Item bloqueado por reintentos previos.',
        })
        continue
      }

      try {
        await syncItem(item)
        await removeQueueItem(item.id)
        recordSyncTelemetry({
          name: 'sync.success',
          itemType: item.type,
          itemId: item.id,
        })
      } catch (error: unknown) {
        const { shouldDrop, message } = classifySyncError(item, error)
        const statusCode = extractStatusCode(error)
        if (shouldDrop) {
          await removeQueueItem(item.id)
          recordSyncTelemetry({
            name: 'sync.dropped',
            itemType: item.type,
            itemId: item.id,
            statusCode,
            retryable: false,
            reason: message,
          })
          continue
        }
        await markSyncFailure(item, message)
        const refreshedItem = await getQueueItemById(item.id)
        const blocked = Boolean(refreshedItem?.blocked)
        recordSyncTelemetry({
          name: blocked ? 'sync.blocked' : 'sync.failure',
          itemType: item.type,
          itemId: item.id,
          statusCode,
          retryable: true,
          reason: message,
        })
        continue
      }
    }
  } finally {
    syncing = false
  }
}
