export const ROUTE_PATHS = {
  auth: {
    login: '/login',
  },
  dashboard: '/dashboard',
  fleet: {
    list: '/fleet',
    create: '/fleet/new',
    edit: '/fleet/:unitId/edit',
    detail: '/fleet/:unitId',
  },
  maintenance: '/maintenance',
  audits: '/audits',
  tasks: '/tasks',
  movements: '/movements',
  clients: '/clients',
  deliveries: '/deliveries',
  workOrders: '/work-orders',
  externalRequests: '/work-orders/external-requests',
  repairs: '/repairs',
  suppliers: '/suppliers',
  supplierDetail: '/suppliers/:supplierId',
  crm: '/crm',
  inventory: '/inventory',
  reports: '/reports',
  notifications: '/notifications',
  users: '/users',
  profile: '/profile',
  maintenanceMode: '/maintenance-mode',
  projects: {
    list: '/projects',
    detail: '/projects/:projectId',
  },
} as const

const unitIdPlaceholder = ':unitId'
const supplierIdPlaceholder = ':supplierId'

export const buildFleetDetailPath = (unitId: string): string => ROUTE_PATHS.fleet.detail.replace(unitIdPlaceholder, unitId)

export const buildFleetEditPath = (unitId: string): string => ROUTE_PATHS.fleet.edit.replace(unitIdPlaceholder, unitId)

export const buildSupplierDetailPath = (supplierId: string): string =>
  ROUTE_PATHS.supplierDetail.replace(supplierIdPlaceholder, supplierId)

const projectIdPlaceholder = ':projectId'
export const buildProjectDetailPath = (projectId: string): string =>
  ROUTE_PATHS.projects.detail.replace(projectIdPlaceholder, projectId)
