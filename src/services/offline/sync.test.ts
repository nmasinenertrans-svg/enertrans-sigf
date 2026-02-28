import { beforeEach, describe, expect, it, vi } from 'vitest'

const queueMocks = vi.hoisted(() => ({
  enqueueItem: vi.fn(),
  getQueueItems: vi.fn(),
  removeQueueItem: vi.fn(),
  updateQueueItem: vi.fn(),
}))

const telemetryMocks = vi.hoisted(() => ({
  recordSyncTelemetry: vi.fn(),
}))

const apiMocks = vi.hoisted(() => {
  class ApiRequestError extends Error {
    status: number
    path: string
    method: string
    responseBody: string

    constructor(params: { status: number; path?: string; method?: string; responseBody?: string }) {
      const { status, path = '/test', method = 'POST', responseBody = 'Error en la API' } = params
      super(`${status} ${responseBody}`)
      this.name = 'ApiRequestError'
      this.status = status
      this.path = path
      this.method = method
      this.responseBody = responseBody
    }
  }

  return {
    apiRequest: vi.fn(),
    ApiRequestError,
  }
})

vi.mock('./queue', () => queueMocks)
vi.mock('./telemetry', () => telemetryMocks)
vi.mock('../api/apiClient', () => apiMocks)

const importSync = async () => import('./sync')

describe('offline sync hardening', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('drops non-retryable items on 422', async () => {
    const item = {
      id: 'fleet.create.1',
      type: 'fleet.create',
      payload: { id: 'u-1' },
      createdAt: new Date().toISOString(),
      attemptCount: 0,
    }
    queueMocks.getQueueItems.mockResolvedValue([item])
    apiMocks.apiRequest.mockRejectedValue(new apiMocks.ApiRequestError({ status: 422, responseBody: 'Validation' }))

    const { syncQueue } = await importSync()
    await syncQueue()

    expect(queueMocks.removeQueueItem).toHaveBeenCalledWith(item.id)
    expect(queueMocks.updateQueueItem).not.toHaveBeenCalled()
    expect(telemetryMocks.recordSyncTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'sync.dropped',
        itemType: item.type,
        statusCode: 422,
      }),
    )
  })

  it('blocks an item after max retry attempts', async () => {
    const item = {
      id: 'maintenance.create.1',
      type: 'maintenance.create',
      payload: { id: 'm-1' },
      createdAt: new Date().toISOString(),
      attemptCount: 4,
    }
    queueMocks.getQueueItems
      .mockResolvedValueOnce([item])
      .mockResolvedValueOnce([{ ...item, attemptCount: 5, blocked: true }])
    apiMocks.apiRequest.mockRejectedValue(new Error('503 upstream unavailable'))

    const { syncQueue } = await importSync()
    await syncQueue()

    expect(queueMocks.updateQueueItem).toHaveBeenCalledWith(
      item.id,
      expect.objectContaining({
        attemptCount: 5,
        blocked: true,
      }),
    )
    expect(telemetryMocks.recordSyncTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'sync.blocked',
        itemType: item.type,
      }),
    )
  })

  it('unblocks manually and retries an item', async () => {
    const blockedItem = {
      id: 'inventory.create.1',
      type: 'inventory.create',
      payload: { id: 'i-1' },
      createdAt: new Date().toISOString(),
      attemptCount: 5,
      blocked: true,
      lastError: 'PAUSADO_AUTOMATICO',
    }
    const unblockedItem = { ...blockedItem, blocked: false, lastError: '' }
    queueMocks.getQueueItems
      .mockResolvedValueOnce([blockedItem])
      .mockResolvedValueOnce([unblockedItem])
    apiMocks.apiRequest.mockResolvedValue({})

    const { syncQueueItem } = await importSync()
    await syncQueueItem(blockedItem.id)

    expect(queueMocks.updateQueueItem).toHaveBeenCalledWith(
      blockedItem.id,
      expect.objectContaining({
        blocked: false,
        lastError: '',
      }),
    )
    expect(queueMocks.removeQueueItem).toHaveBeenCalledWith(blockedItem.id)
    expect(telemetryMocks.recordSyncTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'sync.unblocked.manual',
        itemType: blockedItem.type,
      }),
    )
    expect(telemetryMocks.recordSyncTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'sync.success',
        itemType: blockedItem.type,
      }),
    )
  })

  it('never posts audit when photo upload fails', async () => {
    const item = {
      id: 'audit.create.1',
      type: 'audit.create',
      payload: {
        id: 'a-1',
        auditKind: 'AUDIT',
        unitId: 'u-1',
        auditorUserId: 'usr-1',
        auditorName: 'Tester',
        performedAt: new Date().toISOString(),
        result: 'APPROVED',
        observations: 'ok',
        photoBase64List: ['data:image/jpeg;base64,aaa'],
        checklistSections: [],
      },
      createdAt: new Date().toISOString(),
      attemptCount: 0,
    }
    queueMocks.getQueueItems
      .mockResolvedValueOnce([item])
      .mockResolvedValueOnce([{ ...item, attemptCount: 1, blocked: false }])
    apiMocks.apiRequest.mockImplementation(async (path: string) => {
      if (path === '/files/upload') {
        throw new Error('upload failed')
      }
      return {}
    })

    const { syncQueue } = await importSync()
    await syncQueue()

    const postedAudits = apiMocks.apiRequest.mock.calls.filter((args) => args[0] === '/audits')
    expect(postedAudits.length).toBe(0)
    expect(queueMocks.updateQueueItem).toHaveBeenCalledWith(
      item.id,
      expect.objectContaining({
        attemptCount: 1,
      }),
    )
    expect(telemetryMocks.recordSyncTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'sync.failure',
        itemType: item.type,
      }),
    )
  })
})
