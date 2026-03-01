import { readLocalStorage, writeLocalStorage } from '../../services/storage/localStorageService'
import { getAuthToken } from '../../services/api/apiClient'
import type {
  AppUser,
  AuditRecord,
  ExternalRequest,
  FleetMovement,
  FeatureFlags,
  FleetUnit,
  InventoryItem,
  MaintenancePlan,
  RepairRecord,
  WorkOrder,
  MaintenanceStatus,
} from '../../types/domain'

const STORAGE_KEY = 'enertrans.sigf.app-state.v1'
const CURRENT_USER_KEY = 'enertrans.sigf.currentUserId'
const CURRENT_USER_SESSION_KEY = 'enertrans.sigf.currentUserId.session'

interface PersistedAppState {
  currentUserId: string | null
  users: AppUser[]
  fleetUnits: FleetUnit[]
  maintenancePlans: MaintenancePlan[]
  audits: AuditRecord[]
  workOrders: WorkOrder[]
  repairs: RepairRecord[]
  externalRequests: ExternalRequest[]
  movements: FleetMovement[]
  inventoryItems: InventoryItem[]
  featureFlags: FeatureFlags
}

export interface AppState extends PersistedAppState {
  currentUser: AppUser | null
  isGlobalLoading: boolean
  appError: string | null
  maintenanceStatus: MaintenanceStatus
}

export interface AppActions {
  setCurrentUser: (user: AppUser | null) => void
  setUsers: (users: AppUser[]) => void
  setFleetUnits: (units: FleetUnit[]) => void
  setMaintenancePlans: (plans: MaintenancePlan[]) => void
  setAudits: (audits: AuditRecord[] | ((previousAudits: AuditRecord[]) => AuditRecord[])) => void
  setWorkOrders: (orders: WorkOrder[]) => void
  setRepairs: (repairs: RepairRecord[]) => void
  setExternalRequests: (requests: ExternalRequest[]) => void
  setMovements: (movements: FleetMovement[]) => void
  setInventoryItems: (items: InventoryItem[]) => void
  setFeatureFlags: (flags: FeatureFlags) => void
  setGlobalLoading: (value: boolean) => void
  setAppError: (errorMessage: string | null) => void
  setMaintenanceStatus: (status: MaintenanceStatus) => void
}

export interface AppContextValue {
  state: AppState
  actions: AppActions
}

const defaultUsers: AppUser[] = [
  {
    id: 'user-dev-nmasin',
    username: 'Nmasin',
    fullName: 'Nicolas Masin',
    role: 'DEV',
    password: 'enermasin26',
  },
]

const defaultFeatureFlags: FeatureFlags = {
  showDemoUnitButton: true,
  showFleetModule: true,
  showMaintenanceModule: true,
  showAuditsModule: true,
  showMovementsModule: true,
  showWorkOrdersModule: true,
  showTasksModule: true,
  showExternalRequestsModule: true,
  showRepairsModule: true,
  showReportsModule: true,
  showInventoryModule: true,
  showUsersModule: true,
  manualAuditMode: false,
  interactiveDashboard: true,
}

const defaultPersistedState: PersistedAppState = {
  currentUserId: null,
  users: defaultUsers,
  fleetUnits: [],
  maintenancePlans: [],
  audits: [],
  workOrders: [],
  repairs: [],
  externalRequests: [],
  movements: [],
  inventoryItems: [],
  featureFlags: defaultFeatureFlags,
}

const defaultRuntimeState: Pick<AppState, 'isGlobalLoading' | 'appError'> = {
  isGlobalLoading: false,
  appError: null,
}

const defaultMaintenanceStatus: MaintenanceStatus = {
  enabled: false,
  message: '',
}

const normalizePersistedUsers = (users?: AppUser[]): AppUser[] => {
  const normalized = Array.isArray(users) ? users.filter(Boolean) : []

  const hasDevUser = normalized.some((user) => user.username?.toLowerCase() === 'nmasin')
  const merged = hasDevUser ? normalized : [...normalized, ...defaultUsers]

  return merged.map((user) => {
    if (user.username?.toLowerCase() === 'nmasin') {
      return {
        ...user,
        password: user.password?.trim() ? user.password : 'enermasin26',
        role: user.role ?? 'DEV',
        avatarUrl: user.avatarUrl ?? '',
      }
    }
    return {
      ...user,
      password: user.password ?? '',
      avatarUrl: user.avatarUrl ?? '',
    }
  })
}

export const getInitialAppState = (): AppState => {
  const persistedState = readLocalStorage<PersistedAppState>(STORAGE_KEY, defaultPersistedState)
  const safePersistedState: PersistedAppState = {
    ...defaultPersistedState,
    ...persistedState,
    users: persistedState.users ?? defaultPersistedState.users,
    fleetUnits: persistedState.fleetUnits ?? [],
    maintenancePlans: persistedState.maintenancePlans ?? [],
    audits: persistedState.audits ?? [],
    workOrders: persistedState.workOrders ?? [],
    repairs: persistedState.repairs ?? [],
    externalRequests: persistedState.externalRequests ?? [],
    movements: persistedState.movements ?? [],
    inventoryItems: persistedState.inventoryItems ?? [],
    featureFlags: { ...defaultFeatureFlags, ...(persistedState.featureFlags ?? {}) },
  }
  const fallbackUserId = typeof window !== 'undefined' ? window.localStorage.getItem(CURRENT_USER_KEY) : null
  const sessionUserId =
    typeof window !== 'undefined' ? window.sessionStorage.getItem(CURRENT_USER_SESSION_KEY) : null
  const users = normalizePersistedUsers(safePersistedState.users)
  const resolvedUserId = safePersistedState.currentUserId ?? fallbackUserId ?? sessionUserId
  const token = getAuthToken()
  const currentUser = token
    ? users.find((user) => user.id === resolvedUserId) ?? null
    : null

  return {
    ...safePersistedState,
    users,
    currentUserId: token ? resolvedUserId ?? null : null,
    currentUser,
    ...defaultRuntimeState,
    maintenanceStatus: defaultMaintenanceStatus,
  }
}

export const toPersistedState = (state: AppState): PersistedAppState => ({
  currentUserId: state.currentUserId,
  users: state.users,
  fleetUnits: state.fleetUnits,
  maintenancePlans: state.maintenancePlans,
  audits: state.audits,
  workOrders: state.workOrders,
  repairs: state.repairs,
  externalRequests: state.externalRequests,
  movements: state.movements,
  inventoryItems: state.inventoryItems,
  featureFlags: state.featureFlags,
})

export const persistAppState = (state: AppState): void => {
  writeLocalStorage(STORAGE_KEY, toPersistedState(state))
  if (typeof window !== 'undefined') {
    try {
      if (state.currentUserId) {
        window.localStorage.setItem(CURRENT_USER_KEY, state.currentUserId)
      } else {
        window.localStorage.removeItem(CURRENT_USER_KEY)
      }
    } catch {
      // ignore
    }

    try {
      if (state.currentUserId) {
        window.sessionStorage.setItem(CURRENT_USER_SESSION_KEY, state.currentUserId)
      } else {
        window.sessionStorage.removeItem(CURRENT_USER_SESSION_KEY)
      }
    } catch {
      // ignore
    }
  }
}
