import { apiRequest } from '../api/apiClient'
import { enqueueItem, getQueueItems, removeQueueItem, type OfflineQueueItem } from './queue'

let syncing = false

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

const syncAudit = async (payload: any) => {
  const photoUrls: string[] = []
  const photoList: string[] = payload.photoBase64List || []

  for (let index = 0; index < photoList.length; index += 1) {
    const dataUrl = photoList[index]
    const url = await uploadDataUrl(dataUrl, `audit-${payload.id}-${index}.jpg`, 'audits')
    photoUrls.push(url)
  }

  const body = {
    id: payload.id,
    code: payload.code,
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
    checklist: { sections: payload.checklistSections },
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
    case 'repair.create':
      {
        const payload = item.payload as any
        let invoiceFileUrl = payload.invoiceFileUrl || ''
        let invoiceFileBase64 = payload.invoiceFileBase64 || ''

        if (invoiceFileBase64 && !invoiceFileUrl) {
          try {
            invoiceFileUrl = await uploadDataUrl(
              invoiceFileBase64,
              payload.invoiceFileName || `repair-${payload.id}.pdf`,
              'repairs',
            )
            invoiceFileBase64 = ''
          } catch {
            invoiceFileUrl = ''
          }
        }

        await apiRequest('/repairs', {
          method: 'POST',
          body: {
            ...payload,
            invoiceFileUrl,
            invoiceFileBase64,
          },
        })
      }
      return
    case 'inventory.create':
      await apiRequest('/inventory', { method: 'POST', body: item.payload })
      return
    case 'audit.create':
      await syncAudit(item.payload)
      return
    case 'externalRequest.create':
      {
        const payload = item.payload as any
        let providerFileUrl = payload.providerFileUrl || ''
        let providerFileBase64 = payload.providerFileBase64 || ''

        if (providerFileBase64 && !providerFileUrl) {
          try {
            providerFileUrl = await uploadDataUrl(
              providerFileBase64,
              payload.providerFileName || `external-${payload.id}.pdf`,
              'external-requests',
            )
            providerFileBase64 = ''
          } catch {
            providerFileUrl = ''
          }
        }

        await apiRequest('/external-requests', {
          method: 'POST',
          body: {
            ...payload,
            providerFileUrl,
            providerFileBase64,
          },
        })
      }
      return
    default:
      return
  }
}

export const enqueueAndSync = async (item: OfflineQueueItem) => {
  await enqueueItem(item)
  if (typeof navigator !== 'undefined' && navigator.onLine) {
    await syncQueue()
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
      try {
        await syncItem(item)
        await removeQueueItem(item.id)
      } catch (error: any) {
        const message = String(error?.message ?? '')
        const statusMatch = message.match(/^(\d{3})\b/)
        const statusCode = statusMatch ? Number(statusMatch[1]) : null

        if (statusCode && [400, 404, 409, 422].includes(statusCode)) {
          await removeQueueItem(item.id)
          continue
        }
        break
      }
    }
  } finally {
    syncing = false
  }
}
