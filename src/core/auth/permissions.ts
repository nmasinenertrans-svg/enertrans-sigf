import type {
  AppUser,
  ModulePermissionSet,
  PermissionAction,
  PermissionModule,
  PermissionOverride,
  UserPermissions,
  UserRole,
} from '../../types/domain'
import { permissionActions, permissionModules } from '../../types/domain'

const buildEmptyPermissions = (): UserPermissions =>
  permissionModules.reduce((accumulator, moduleKey) => {
    accumulator[moduleKey] = permissionActions.reduce((actions, action) => {
      actions[action] = false
      return actions
    }, {} as ModulePermissionSet)
    return accumulator
  }, {} as UserPermissions)

const setAll = (permissions: UserPermissions, value: boolean): UserPermissions => {
  permissionModules.forEach((moduleKey) => {
    permissionActions.forEach((action) => {
      permissions[moduleKey][action] = value
    })
  })
  return permissions
}

const allowModule = (permissions: UserPermissions, moduleKey: PermissionModule, actions: PermissionAction[]) => {
  actions.forEach((action) => {
    permissions[moduleKey][action] = true
  })
}

export const getRolePermissions = (role: UserRole): UserPermissions => {
  const permissions = buildEmptyPermissions()

  if (role === 'DEV') {
    return setAll(permissions, true)
  }

  if (role === 'GERENTE') {
    setAll(permissions, true)
    permissions.USERS.view = false
    permissions.USERS.create = false
    permissions.USERS.edit = false
    permissions.USERS.delete = false
    permissions.MAINTENANCE_MODE.view = false
    permissions.MAINTENANCE_MODE.create = false
    permissions.MAINTENANCE_MODE.edit = false
    permissions.MAINTENANCE_MODE.delete = false
    return permissions
  }

  if (role === 'COORDINADOR') {
    allowModule(permissions, 'FLEET', ['view', 'create', 'edit'])
    allowModule(permissions, 'PROJECTS', ['view', 'create', 'edit'])
    allowModule(permissions, 'CLIENTS', ['view', 'create', 'edit'])
    allowModule(permissions, 'DELIVERIES', ['view', 'create', 'edit'])
    allowModule(permissions, 'MOVEMENTS', ['view', 'create', 'edit'])
    allowModule(permissions, 'MAINTENANCE', ['view', 'create', 'edit'])
    allowModule(permissions, 'AUDITS', ['view', 'create'])
    allowModule(permissions, 'WORK_ORDERS', ['view', 'create', 'edit'])
    allowModule(permissions, 'EXTERNAL_REQUESTS', ['view', 'create', 'edit'])
    allowModule(permissions, 'TASKS', ['view'])
    allowModule(permissions, 'REPAIRS', ['view', 'create', 'edit'])
    allowModule(permissions, 'SUPPLIERS', ['view', 'create', 'edit'])
    allowModule(permissions, 'CRM', ['view', 'create', 'edit'])
    allowModule(permissions, 'INVENTORY', ['view', 'create', 'edit'])
    allowModule(permissions, 'REPORTS', ['view'])
    return permissions
  }

  if (role === 'AUDITOR') {
    allowModule(permissions, 'FLEET', ['view'])
    allowModule(permissions, 'AUDITS', ['view', 'create'])
    allowModule(permissions, 'TASKS', ['view', 'edit'])
    allowModule(permissions, 'REPORTS', ['view'])
    return permissions
  }

  if (role === 'MECANICO') {
    allowModule(permissions, 'FLEET', ['view'])
    allowModule(permissions, 'WORK_ORDERS', ['view', 'create', 'edit'])
    allowModule(permissions, 'EXTERNAL_REQUESTS', ['view'])
    allowModule(permissions, 'TASKS', ['view', 'edit'])
    allowModule(permissions, 'REPAIRS', ['view', 'create', 'edit'])
    allowModule(permissions, 'MAINTENANCE', ['view', 'create', 'edit'])
    allowModule(permissions, 'INVENTORY', ['view'])
    allowModule(permissions, 'REPORTS', ['view'])
    return permissions
  }

  return permissions
}

const isOverrideActive = (override: PermissionOverride): boolean => {
  if (!override.expiresAt) {
    return true
  }
  const expires = new Date(override.expiresAt)
  if (Number.isNaN(expires.getTime())) {
    return false
  }
  return expires.getTime() >= Date.now()
}

export const resolveUserPermissions = (user: AppUser | null): UserPermissions => {
  const roleDefaults = user ? getRolePermissions(user.role) : buildEmptyPermissions()
  const stored = user?.permissions
  const base = permissionModules.reduce((accumulator, moduleKey) => {
    accumulator[moduleKey] = {
      ...roleDefaults[moduleKey],
      ...(stored?.[moduleKey] ?? {}),
    }
    return accumulator
  }, {} as UserPermissions)
  const overrides = (user?.permissionOverrides ?? []).filter((override) => isOverrideActive(override))

  const resolved = permissionModules.reduce((accumulator, moduleKey) => {
    accumulator[moduleKey] = { ...base[moduleKey] }
    return accumulator
  }, {} as UserPermissions)

  overrides.forEach((override) => {
    resolved[override.module][override.action] = override.allow
  })

  return resolved
}

export const canUser = (user: AppUser | null, moduleKey: PermissionModule, action: PermissionAction): boolean => {
  const permissions = resolveUserPermissions(user)
  return Boolean(permissions[moduleKey]?.[action])
}
