/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from 'vitest'
import type { FleetUnit, WorkOrder } from '../../types/domain'
import {
  buildAppNotifications,
  NOTIFICATIONS_READ_KEY,
  persistReadNotifications,
  readStoredNotifications,
} from './notifications'

const createUnit = (): FleetUnit =>
  ({
    id: 'unit-1',
    internalCode: 'AC001',
    ownerCompany: 'ENERTRANS',
    documents: {
      rto: { fileName: '', fileBase64: '', expiresAt: '' },
      insurance: { fileName: '', fileBase64: '', expiresAt: '' },
      hoist: { fileName: '', fileBase64: '', expiresAt: '' },
    },
  }) as FleetUnit

const createWorkOrder = (): WorkOrder =>
  ({
    id: 'wo-1',
    code: 'OT-001',
    unitId: 'unit-1',
    status: 'OPEN',
    createdAt: '2026-02-10T10:00:00.000Z',
    pendingReaudit: true,
    taskList: [],
    spareParts: [],
    laborDetail: '',
    linkedInventorySkuList: [],
  }) as WorkOrder

describe('notifications storage', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('merges read ids to avoid stale overwrites', () => {
    persistReadNotifications(['n-1'])
    persistReadNotifications([])
    persistReadNotifications(['n-2'])

    expect(readStoredNotifications().sort()).toEqual(['n-1', 'n-2'])
  })

  it('can replace ids when caller needs pruning', () => {
    persistReadNotifications(['n-1', 'n-2'])
    persistReadNotifications(['n-2'], { merge: false })

    expect(readStoredNotifications()).toEqual(['n-2'])
  })

  it('stores sanitized ids', () => {
    persistReadNotifications(['n-1', '', 'n-1', '   ', 'n-2'])
    const raw = window.localStorage.getItem(NOTIFICATIONS_READ_KEY)
    expect(raw).toBe(JSON.stringify(['n-1', 'n-2']))
  })
})

describe('buildAppNotifications', () => {
  it('builds stable notifications for equal input', () => {
    const fleetUnits = [createUnit()]
    const workOrders = [createWorkOrder()]

    const first = buildAppNotifications({ fleetUnits, audits: [], workOrders })
    const second = buildAppNotifications({ fleetUnits, audits: [], workOrders })

    expect(first).toEqual(second)
  })
})
