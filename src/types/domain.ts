export const visualStatuses = ['OVERDUE', 'OK', 'DUE_SOON'] as const
export type VisualStatus = (typeof visualStatuses)[number]

export const userRoles = ['DEV', 'GERENTE', 'COORDINADOR', 'AUDITOR', 'MECANICO'] as const
export type UserRole = (typeof userRoles)[number]

export const permissionModules = [
  'FLEET',
  'PROJECTS',
  'CLIENTS',
  'DELIVERIES',
  'MOVEMENTS',
  'MAINTENANCE',
  'AUDITS',
  'WORK_ORDERS',
  'EXTERNAL_REQUESTS',
  'TASKS',
  'REPAIRS',
  'SUPPLIERS',
  'CRM',
  'INVENTORY',
  'REPORTS',
  'USERS',
  'MAINTENANCE_MODE',
  'POSTVENTA',
  'SERVICE_ORDERS',
  'INVOICES',
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

export const fleetLogisticsStatuses = ['AVAILABLE', 'PENDING_DELIVERY', 'DELIVERED', 'PENDING_RETURN', 'RETURNED'] as const
export type FleetLogisticsStatus = (typeof fleetLogisticsStatuses)[number]

export const deliveryOperationTypes = ['DELIVERY', 'RETURN'] as const
export type DeliveryOperationType = (typeof deliveryOperationTypes)[number]

export const taskStatuses = ['UNASSIGNED', 'ASSIGNED', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELED'] as const
export type TaskStatus = (typeof taskStatuses)[number]

export const taskPriorities = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const
export type TaskPriority = (typeof taskPriorities)[number]

export const taskEventTypes = [
  'CREATED',
  'UPDATED',
  'ASSIGNED',
  'UNASSIGNED',
  'MOVED_TO_BANK',
  'REMOVED_FROM_BANK',
  'TAKEN_FROM_BANK',
  'STATUS_CHANGED',
] as const
export type TaskEventType = (typeof taskEventTypes)[number]

export interface AppUser {
  id: string
  username: string
  fullName: string
  role: UserRole
  password: string
  avatarUrl?: string
  lastLoginAt?: string
  lastActivityAt?: string
  permissions?: UserPermissions
  permissionOverrides?: PermissionOverride[]
}

export interface MaintenanceStatus {
  enabled: boolean
  message: string
}

export interface FeatureFlags {
  showDemoUnitButton: boolean
  showFleetModule: boolean
  showMaintenanceModule: boolean
  showAuditsModule: boolean
  showMovementsModule: boolean
  showClientsModule: boolean
  showDeliveriesModule: boolean
  showWorkOrdersModule: boolean
  showTasksModule: boolean
  showExternalRequestsModule: boolean
  showRepairsModule: boolean
  showSuppliersModule: boolean
  showCrmModule: boolean
  showReportsModule: boolean
  showInventoryModule: boolean
  showUsersModule: boolean
  manualAuditMode: boolean
  interactiveDashboard: boolean
  basicViewMode: boolean
}

export interface UserInboxNotification {
  id: string
  title: string
  description: string
  severity: 'info' | 'warning' | 'danger'
  createdAt: string
  target?: string
  actorUserId?: string
  eventType?: string
}

export interface FleetUnit {
  id: string
  qrId: string
  internalCode: string
  clientId?: string | null
  brand: string
  model: string
  year: number
  clientName: string
  location: string
  ownerCompany: string
  operationalStatus: FleetOperationalStatus
  logisticsStatus?: FleetLogisticsStatus
  logisticsStatusNote?: string
  logisticsUpdatedAt?: string
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
  engineCylinders?: number
  lubricants: FleetUnitLubricants
  filters: FleetUnitFilters
  documents: FleetUnitDocuments
  profilePhotoUrl?: string | null
  crmDealLink?: {
    dealId: string
    dealTitle: string
    dealKind: CrmDealKind
    companyName: string
    stage: CrmDealStage
    status: CrmDealUnitStatus
  } | null
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
  rtoProvincial?: boolean
  rtoNacional?: boolean
}

export interface FleetUnitTracking {
  ituran: boolean
  rsv: boolean
  microtrack: boolean
}

export interface FleetUnitDocuments {
  rto: FleetUnitDocument
  insurance: FleetUnitDocument
  hoist: FleetUnitDocument
  title?: FleetUnitDocument
  registration?: FleetUnitDocument
  hoistNotApplicable?: boolean
  tracking?: FleetUnitTracking
}

export const maintenanceTypes = [
  'MOTOR',
  'DISTRIBUTION',
  'GEARBOX',
  'COOLING',
  'DIFFERENTIAL',
  'STEERING',
  'CLUTCH',
  'BRAKES',
  'HYDRO_CRANE',
] as const
export type MaintenanceType = (typeof maintenanceTypes)[number]

export type MaintenanceMeasurementUnit = 'KILOMETERS' | 'HOURS'

export interface MaintenancePlan {
  id: string
  unitId: string
  maintenanceType: MaintenanceType
  currentKilometers: number
  currentHours: number
  serviceIntervalKilometers?: number | null
  serviceIntervalHours?: number | null
  nextServiceByKilometers: number
  nextServiceByHours: number
  oils: string[]
  filters: string[]
  notes: string
  status: VisualStatus
  /** @deprecated Reemplazado por maintenanceType + serviceInterval*. Se mantiene solo por compatibilidad con planes viejos. */
  serviceSchedule?: Record<string, unknown>
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
  unitId: string | null
  externalVehicle?: string | null
  auditorUserId: string
  auditorName: string
  performedAt: string
  result: AuditResult
  observations: string
  photoBase64List: string[]
  reportPdfFileName?: string
  reportPdfFileUrl?: string
  reportPdfFileBase64?: string
  checklistSections: AuditChecklistSection[]
  unitKilometers: number
  engineHours: number
  hydroHours: number
  syncState?: 'SYNCED' | 'PENDING' | 'LOCAL_ONLY' | 'ERROR'
  syncError?: string
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
  unitId: string | null
  externalVehicle?: string | null
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
  linkedExternalRequestIds?: string[]
  sourceType?: 'WORK_ORDER' | 'EXTERNAL_REQUEST'
  performedAt?: string
  unitKilometers: number
  currency: 'ARS' | 'USD'
  supplierId?: string
  supplierName: string
  laborCost?: number
  partsCost?: number
  partsUsed?: RepairPartUsed[]
  createdAt?: string
  realCost: number
  invoicedToClient: number
  margin: number
  invoiceFileName?: string
  invoiceFileBase64?: string
  invoiceFileUrl?: string
}

export interface RepairPartUsed {
  id?: string
  inventoryItemId?: string | null
  description: string
  quantity: number
  unitPrice: number
  lineTotal?: number
}

export interface Invoice {
  id: string
  code: string
  providerName: string
  supplierId?: string | null
  invoiceNumber?: string
  amount: number
  currency: 'ARS' | 'USD'
  issuedAt?: string | null
  notes?: string
  fileName?: string
  fileBase64?: string
  fileUrl?: string
  repairId?: string | null
  inventoryItemIds: string[]
  inventoryItemQuantities?: Record<string, number>
  createdByUserId: string
  createdByUserName?: string
  createdAt?: string
  updatedAt?: string
}

export const inventoryUnits = ['UNIDAD', 'LITRO', 'KG', 'METRO'] as const
export type InventoryUnit = (typeof inventoryUnits)[number]

export interface InventoryItem {
  id: string
  sku: string
  externalBarcode?: string
  productName: string
  description?: string
  stock: number
  unit: InventoryUnit
  unitPrice?: number
  currency?: 'ARS' | 'USD'
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
  currency?: 'ARS' | 'USD'
  partsItems?: ExternalRequestPartItem[]
  partsTotal?: number
  eligibilityStatus?: 'PENDING_ATTACHMENT' | 'READY_FOR_REPAIR'
  linkedRepairId?: string | null
  serviceOrderId?: string | null
  createdAt?: string
  providerFileName?: string
  providerFileBase64?: string
  providerFileUrl?: string
  ocCode?: string | null
  ocGeneratedAt?: string | null
}

export interface ExternalRequestPartItem {
  description: string
  quantity: number
  unitPrice: number
  lineTotal: number
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

export interface ClientAccount {
  id: string
  name: string
  legalName: string
  taxId: string
  contactName: string
  contactPhone: string
  contactEmail: string
  notes: string
  isActive: boolean
  createdAt?: string
  updatedAt?: string
  _count?: {
    units: number
    deliveries: number
  }
}

export interface Supplier {
  id: string
  name: string
  serviceType: string
  paymentMethod: string
  paymentTerms: string
  address: string
  mapsUrl: string
  contactName: string
  contactPhone: string
  contactEmail: string
  notes: string
  isActive: boolean
  createdAt?: string
  updatedAt?: string
  _count?: {
    repairs: number
  }
}

export interface DeliveryOperation {
  id: string
  unitId: string
  clientId?: string | null
  operationType: DeliveryOperationType
  targetLogisticsStatus: FleetLogisticsStatus
  summary: string
  reason: string
  remitoFileName?: string
  remitoFileUrl?: string
  remitoAttachedAt?: string
  remitoAttachedByUserName?: string
  requestedByUserId?: string | null
  requestedByUserName?: string
  effectiveAt?: string
  createdAt?: string
  updatedAt?: string
  unit?: {
    id: string
    internalCode: string
    ownerCompany: string
  }
  client?: {
    id: string
    name: string
  } | null
}

export const crmDealStages = ['LEAD', 'CONTACTED', 'QUALIFICATION', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'] as const
export type CrmDealStage = (typeof crmDealStages)[number]

export const crmDealKinds = ['TENDER', 'CONTRACT'] as const
export type CrmDealKind = (typeof crmDealKinds)[number]

export const crmDealUnitStatuses = ['EN_CONCURSO', 'ADJUDICADA', 'PERDIDA', 'LIBERADA'] as const
export type CrmDealUnitStatus = (typeof crmDealUnitStatuses)[number]

export const crmActivityTypes = ['CALL', 'WHATSAPP', 'EMAIL', 'MEETING', 'TASK'] as const
export type CrmActivityType = (typeof crmActivityTypes)[number]

export const crmActivityStatuses = ['PENDING', 'DONE'] as const
export type CrmActivityStatus = (typeof crmActivityStatuses)[number]

export interface CrmDeal {
  id: string
  title: string
  companyName: string
  dealKind: CrmDealKind
  referenceCode: string
  isHistorical: boolean
  contactName: string
  contactEmail: string
  contactPhone: string
  source: string
  serviceLine: string
  amount: number
  currency: 'ARS' | 'USD'
  probability: number
  stage: CrmDealStage
  expectedCloseDate?: string | null
  lastContactAt?: string | null
  lostReason: string
  notes: string
  assignedToUserId?: string | null
  convertedClientId?: string | null
  createdByUserId: string
  wonAt?: string | null
  createdAt?: string
  updatedAt?: string
  assignedToUser?: {
    id: string
    fullName: string
    username: string
  } | null
  createdByUser?: {
    id: string
    fullName: string
    username: string
  }
  convertedClient?: {
    id: string
    name: string
  } | null
  unitLinks?: CrmDealUnit[]
}

export interface CrmActivity {
  id: string
  dealId: string
  type: CrmActivityType
  status: CrmActivityStatus
  summary: string
  dueAt?: string | null
  completedAt?: string | null
  createdByUserId: string
  createdAt?: string
  updatedAt?: string
  createdByUser?: {
    id: string
    fullName: string
    username: string
  }
}

export interface CrmDealUnit {
  id: string
  dealId: string
  unitId: string
  status: CrmDealUnitStatus
  notes: string
  createdByUserId: string
  linkedAt?: string
  releasedAt?: string | null
  createdAt?: string
  updatedAt?: string
  unit?: {
    id: string
    internalCode: string
    ownerCompany: string
    clientName: string
  }
}

export interface TaskEventRecord {
  id: string
  taskId: string
  type: TaskEventType
  actorUserId: string
  actorName?: string
  notes?: string
  fromStatus?: TaskStatus | ''
  toStatus?: TaskStatus | ''
  fromAssignedToUserId?: string | null
  toAssignedToUserId?: string | null
  createdAt?: string
}

export interface TaskRecord {
  id: string
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  assignedToUserId?: string | null
  assignedToUserName?: string
  assignedToExternalName?: string
  assignedByUserId?: string | null
  createdByUserId: string
  createdByUserName?: string
  isInTaskBank: boolean
  startDate?: string | null
  estimatedFinishDate?: string | null
  createdAt?: string
  updatedAt?: string
  closedAt?: string | null
  events: TaskEventRecord[]
}

export const fleetProjectTypes = [
  'HYDROCRANE_CHANGE',
  'THIRD_AXLE',
  'BOX_EXTENSION',
  'BODY_MODIFICATION',
  'ENGINE_OVERHAUL',
  'TRANSMISSION',
  'SUSPENSION',
  'ELECTRICAL',
  'BRAKE_SYSTEM',
  'OTHER',
] as const
export type FleetProjectType = (typeof fleetProjectTypes)[number]

export const fleetProjectStatuses = ['PENDING', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELED'] as const
export type FleetProjectStatus = (typeof fleetProjectStatuses)[number]

export const fleetProjectItemStatuses = ['PENDING', 'IN_PROGRESS', 'DONE', 'SKIPPED'] as const
export type FleetProjectItemStatus = (typeof fleetProjectItemStatuses)[number]

export interface FleetProjectItem {
  id: string
  projectId: string
  title: string
  description: string
  status: FleetProjectItemStatus
  assignedToUserId: string | null
  assignedToUserName: string
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface FleetProject {
  id: string
  title: string
  projectTypes: FleetProjectType[]
  status: FleetProjectStatus
  priority: TaskPriority
  unitId: string
  unitInternalCode: string
  unitLabel: string
  description: string
  estimatedCost: number
  actualCost: number
  currency: string
  externalRequestId: string | null
  createdByUserId: string
  createdByUserName: string
  targetDate: string | null
  startedAt: string | null
  completedAt: string | null
  modificationNotes: string
  linkedWorkOrderIds: string[]
  linkedExternalRequestIds: string[]
  createdAt: string
  updatedAt: string
  items: FleetProjectItem[]
}

export const serviceOrderStatuses = ['OPEN', 'IN_PROGRESS', 'WAITING_PARTS', 'CLOSED'] as const
export type ServiceOrderStatus = (typeof serviceOrderStatuses)[number]

export const serviceOrderOrigins = ['EMAIL', 'PHONE_CALL', 'WHATSAPP', 'INTERNAL_INSPECTION'] as const
export type ServiceOrderOrigin = (typeof serviceOrderOrigins)[number]

export interface ServiceOrder {
  id: string
  code: string
  unitId?: string | null
  externalVehicle?: string | null
  clientId?: string | null
  clientName: string
  reportedFault: string
  claimOrigin: ServiceOrderOrigin
  status: ServiceOrderStatus
  estimatedResolutionAt?: string | null
  closedAt?: string | null
  resolutionDetail: string
  assignedToUserId?: string | null
  assignedToName: string
  sparePartsUsed: string
  photoUrls: string[]
  createdByUserId: string
  createdAt: string
  updatedAt: string
  unit?: { id: string; internalCode: string; brand: string; model: string } | null
  client?: { id: string; name: string } | null
  createdBy?: { id: string; name: string }
  assignedTo?: { id: string; name: string } | null
}

export interface PostventaEvent {
  id: string
  title: string
  startDate: string // YYYY-MM-DD
  endDate: string | null // YYYY-MM-DD
  notes: string
  unitId: string | null
  unitLabel: string | null
  externalVehicle: string | null
  workOrderId: string | null
  color: string
  createdByUserId: string
  createdByUserName: string
  createdAt: string
  updatedAt: string
}
