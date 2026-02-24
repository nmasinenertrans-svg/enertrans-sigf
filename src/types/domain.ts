export const visualStatuses = ['OVERDUE', 'OK', 'DUE_SOON'] as const
export type VisualStatus = (typeof visualStatuses)[number]

export const userRoles = ['DEV', 'GERENTE', 'COORDINADOR', 'AUDITOR', 'MECANICO'] as const
export type UserRole = (typeof userRoles)[number]

export const permissionModules = [
  'FLEET',
  'MAINTENANCE',
  'AUDITS',
  'WORK_ORDERS',
  'REPAIRS',
  'INVENTORY',
  'REPORTS',
  'USERS',
  'MAINTENANCE_MODE',
] as const
export type PermissionModule = (typeof permissionModules)[number]

export const permissionActions = ['view', 'create', 'edit', 'delete'] as const
export type PermissionAction = (typeof permissionActions)[number]

export type ModulePermissionSet = Record<PermissionAction, boolean>
export type UserPermissions = Record<PermissionModule, ModulePermissionSet>

export interface PermissionOverride {
  module: PermissionModule
  action: PermissionAction
  allow: boolean
  expiresAt?: string
}

export const workOrderStatuses = ['OPEN', 'IN_PROGRESS', 'CLOSED'] as const
export type WorkOrderStatus = (typeof workOrderStatuses)[number]

export const auditResults = ['APPROVED', 'REJECTED'] as const
export type AuditResult = (typeof auditResults)[number]

export const auditChecklistStatuses = ['OK', 'BAD', 'NA'] as const
export type AuditChecklistStatus = (typeof auditChecklistStatuses)[number]

export const fleetOperationalStatuses = ['OPERATIONAL', 'MAINTENANCE', 'OUT_OF_SERVICE'] as const
export type FleetOperationalStatus = (typeof fleetOperationalStatuses)[number]

export const fleetUnitTypes = [
  'CHASSIS',
  'CHASSIS_WITH_HYDROCRANE',
  'TRACTOR',
  'TRACTOR_WITH_HYDROCRANE',
  'SEMI_TRAILER',
  'AUTOMOBILE',
  'VAN',
  'PICKUP',
] as const
export type FleetUnitType = (typeof fleetUnitTypes)[number]

export const fleetMovementTypes = ['ENTRY', 'RETURN'] as const
export type FleetMovementType = (typeof fleetMovementTypes)[number]

export interface AppUser {
  id: string
  username: string
  fullName: string
  role: UserRole
  password: string
  avatarUrl?: string
  permissions?: UserPermissions
  permissionOverrides?: PermissionOverride[]
}

export interface MaintenanceStatus {
  enabled: boolean
  message: string
}

export interface FeatureFlags {
  showDemoUnitButton: boolean
  showExternalRequestsModule: boolean
  showReportsModule: boolean
  showInventoryModule: boolean
}

export interface FleetUnit {
  id: string
  qrId: string
  internalCode: string
  brand: string
  model: string
  year: number
  clientName: string
  location: string
  ownerCompany: string
  operationalStatus: FleetOperationalStatus
  unitType: FleetUnitType
  configurationNotes: string
  chassisNumber: string
  engineNumber: string
  tareWeightKg: number
  maxLoadKg: number
  hasHydroCrane: boolean
  hydroCraneBrand: string
  hydroCraneModel: string
  hydroCraneSerialNumber: string
  hasSemiTrailer: boolean
  semiTrailerUnitId: string | null
  semiTrailerLicensePlate: string
  semiTrailerBrand: string
  semiTrailerModel: string
  semiTrailerYear: number
  semiTrailerChassisNumber: string
  tractorHistoryIds: string[]
  currentKilometers: number
  currentEngineHours: number
  currentHydroHours: number
  lubricants: FleetUnitLubricants
  filters: FleetUnitFilters
  documents: FleetUnitDocuments
}

export interface FleetUnitLubricants {
  engineOil: string
  engineOilLiters: string
  gearboxOil: string
  gearboxOilLiters: string
  differentialOil: string
  differentialOilLiters: string
  clutchFluid: string
  clutchFluidLiters: string
  steeringFluid: string
  steeringFluidLiters: string
  brakeFluid: string
  brakeFluidLiters: string
  coolant: string
  coolantLiters: string
  hydraulicOil: string
  hydraulicOilLiters: string
}

export interface FleetUnitFilters {
  oilFilter: string
  fuelFilter: string
  taFilter: string
  primaryAirFilter: string
  secondaryAirFilter: string
  cabinFilter: string
}

export interface FleetUnitDocument {
  fileName: string
  fileBase64: string
  fileUrl?: string
  expiresAt: string
}

export interface FleetUnitDocuments {
  rto: FleetUnitDocument
  insurance: FleetUnitDocument
  hoist: FleetUnitDocument
  title?: FleetUnitDocument
  registration?: FleetUnitDocument
  hoistNotApplicable?: boolean
}

export interface MaintenancePlan {
  id: string
  unitId: string
  currentKilometers: number
  currentHours: number
  nextServiceByKilometers: number
  nextServiceByHours: number
  oils: string[]
  filters: string[]
  notes: string
  status: VisualStatus
  serviceSchedule: MaintenanceServiceSchedule
}

export interface MaintenanceServiceSchedule {
  motorHours: number | null
  motorKilometers: number | null
  distributionHours: number | null
  distributionKilometers: number | null
  gearboxHours: number | null
  gearboxKilometers: number | null
  coolingHours: number | null
  coolingKilometers: number | null
  differentialHours: number | null
  differentialKilometers: number | null
  steeringHours: number | null
  steeringKilometers: number | null
  clutchHours: number | null
  clutchKilometers: number | null
  brakesHours: number | null
  brakesKilometers: number | null
  hydroCraneHours: number | null
}

export interface AuditChecklistItem {
  id: string
  label: string
  status: AuditChecklistStatus
  observation: string
}

export interface AuditChecklistSection {
  id: string
  title: string
  items: AuditChecklistItem[]
}

export interface AuditRecord {
  code: string
  auditKind: 'AUDIT' | 'REAUDIT'
  id: string
  unitId: string
  auditorUserId: string
  auditorName: string
  performedAt: string
  result: AuditResult
  observations: string
  photoBase64List: string[]
  checklistSections: AuditChecklistSection[]
  unitKilometers: number
  engineHours: number
  hydroHours: number
}

export type WorkOrderDeviationStatus = 'PENDING' | 'RESOLVED'

export interface WorkOrderDeviation {
  id: string
  section: string
  item: string
  observation: string
  status: WorkOrderDeviationStatus
  resolutionNote: string
  resolutionPhotoBase64: string
  resolutionPhotoUrl: string
  resolvedAt?: string
}

export interface WorkOrder {
  code: string
  pendingReaudit: boolean
  id: string
  unitId: string
  status: WorkOrderStatus
  createdAt?: string
  taskList: WorkOrderDeviation[]
  spareParts: string[]
  laborDetail: string
  linkedInventorySkuList: string[]
}

export interface RepairRecord {
  id: string
  unitId: string
  workOrderId: string
  externalRequestId?: string
  sourceType?: 'WORK_ORDER' | 'EXTERNAL_REQUEST'
  supplierName: string
  createdAt?: string
  realCost: number
  invoicedToClient: number
  margin: number
  invoiceFileName?: string
  invoiceFileBase64?: string
  invoiceFileUrl?: string
}

export interface InventoryItem {
  id: string
  sku: string
  productName: string
  stock: number
  movementHistory: string[]
  linkedWorkOrderIds: string[]
}

export interface ExternalRequest {
  id: string
  code: string
  unitId: string
  companyName: string
  description: string
  tasks: string[]
  createdAt?: string
  providerFileName?: string
  providerFileBase64?: string
  providerFileUrl?: string
}

export interface FleetMovement {
  id: string
  unitIds: string[]
  movementType: FleetMovementType
  remitoNumber: string
  remitoDate?: string
  clientName: string
  workLocation: string
  equipmentDescription: string
  observations: string
  deliveryContactName?: string
  deliveryContactDni?: string
  deliveryContactSector?: string
  deliveryContactRole?: string
  receiverContactName?: string
  receiverContactDni?: string
  receiverContactSector?: string
  receiverContactRole?: string
  pdfFileName?: string
  pdfFileUrl?: string
  parsedPayload?: Record<string, unknown>
  createdAt?: string
}
