/* @vitest-environment jsdom */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useOfflineSync } from './useOfflineSync'

const queueMocks = vi.hoisted(() => ({
  getQueueItems: vi.fn(),
}))

const syncMocks = vi.hoisted(() => ({
  syncQueue: vi.fn(),
}))

vi.mock('../../services/offline/queue', () => queueMocks)
vi.mock('../../services/offline/sync', () => syncMocks)

const HookProbe = () => {
  const state = useOfflineSync()
  return (
    <div>
      <span data-testid="pending">{state.pendingCount}</span>
      <span data-testid="blocked">{state.blockedCount}</span>
      <span data-testid="syncing">{String(state.isSyncing)}</span>
    </div>
  )
}

describe('useOfflineSync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: true,
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('computes pending and blocked count from queue', async () => {
    queueMocks.getQueueItems.mockResolvedValue([
      { id: '1', blocked: true },
      { id: '2', blocked: false },
      { id: '3' },
    ])

    render(<HookProbe />)

    await waitFor(() => {
      expect(screen.getByTestId('pending').textContent).toBe('3')
      expect(screen.getByTestId('blocked').textContent).toBe('1')
    })
  })

  it('resets isSyncing to false after a sync failure', async () => {
    queueMocks.getQueueItems
      .mockResolvedValueOnce([{ id: '1', blocked: false }]) // initial refresh
      .mockResolvedValueOnce([{ id: '1', blocked: false }]) // triggerSync pre-check
      .mockResolvedValueOnce([{ id: '1', blocked: false }]) // refresh after failure
    syncMocks.syncQueue.mockRejectedValue(new Error('sync failed'))

    render(<HookProbe />)

    await act(async () => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: 'visible',
      })
      document.dispatchEvent(new Event('visibilitychange'))
    })

    await waitFor(() => {
      expect(syncMocks.syncQueue).toHaveBeenCalled()
      expect(screen.getByTestId('syncing').textContent).toBe('false')
    })
  })
})
