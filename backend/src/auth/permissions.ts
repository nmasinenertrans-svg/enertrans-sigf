import type { User, UserRole } from '@prisma/client'

export type PermissionModule =
  | 'FLEET'
  | 'MAINTENANCE'
  | 'AUDITS'
  | 'WORK_ORDERS'
  | 'TASKS'
  | 'REPAIRS'
  | 'CRM'
  | 'INVENTORY'
  | 'REPORTS'
  | 'USERS'
  | 'MAINTENANCE_MODE'

export type PermissionAction = 'view' | 'create' | 'edit' | 'delete'

export type ModulePermissionSet = Record<PermissionAction, boolean>
export type UserPermissions = Record<PermissionModule, ModulePermissionSet>

const permissionModules: PermissionModule[] = [
  'FLEET',
  'MAINTENANCE',
  'AUDITS',
  'WORK_ORDERS',
  'TASKS',
  'REPAIRS',
  'CRM',
  'INVENTORY',
  'REPORTS',
  'USERS',
  'MAINTENANCE_MODE',
]

const permissionActions: PermissionAction[] = ['view', 'create', 'edit', 'delete']

const buildEmptyPermissions = (): UserPermissions =>
  permissionModules.reduce((acc, moduleKey) => {
    acc[moduleKey] = permissionActions.reduce((actions, action) => {
      actions[action] = false
      return actions
    }, {} as ModulePermissionSet)
    return acc
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
    allowModule(permissions, 'MAINTENANCE', ['view', 'create', 'edit'])
    allowModule(permissions, 'AUDITS', ['view', 'create'])
    allowModule(permissions, 'WORK_ORDERS', ['view', 'create', 'edit'])
    allowModule(permissions, 'TASKS', ['view'])
    allowModule(permissions, 'REPAIRS', ['view', 'create', 'edit'])
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
    allowModule(permissions, 'TASKS', ['view', 'edit'])
    allowModule(permissions, 'REPAIRS', ['view', 'create', 'edit'])
    allowModule(permissions, 'MAINTENANCE', ['view', 'create', 'edit'])
    allowModule(permissions, 'INVENTORY', ['view'])
    allowModule(permissions, 'REPORTS', ['view'])
    return permissions
  }

  return permissions
}

const isOverrideActive = (override: { expiresAt?: string }) => {
  if (!override.expiresAt) {
    return true
  }
  const expires = new Date(override.expiresAt)
  if (Number.isNaN(expires.getTime())) {
    return false
  }
  return expires.getTime() >= Date.now()
}

export const resolveUserPermissions = (user: User | null): UserPermissions => {
  const roleDefaults = user ? getRolePermissions(user.role) : buildEmptyPermissions()
  const stored = user?.permissions as UserPermissions | undefined
  const base = permissionModules.reduce((acc, moduleKey) => {
    acc[moduleKey] = {
      ...roleDefaults[moduleKey],
      ...(stored?.[moduleKey] ?? {}),
    }
    return acc
  }, {} as UserPermissions)
  const overrides = ((user?.permissionOverrides as Array<{ module: PermissionModule; action: PermissionAction; allow: boolean; expiresAt?: string }> | undefined) ?? [])
    .filter((override) => isOverrideActive(override))

  const resolved = permissionModules.reduce((acc, moduleKey) => {
    acc[moduleKey] = { ...base[moduleKey] }
    return acc
  }, {} as UserPermissions)

  overrides.forEach((override) => {
    resolved[override.module][override.action] = override.allow
  })

  return resolved
}

export const canUser = (user: User | null, moduleKey: PermissionModule, action: PermissionAction): boolean => {
  const permissions = resolveUserPermissions(user)
  return Boolean(permissions[moduleKey]?.[action])
}

