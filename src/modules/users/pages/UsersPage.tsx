import { useState } from 'react'
import { useAppContext } from '../../../core/hooks/useAppContext'
import { ROUTE_PATHS } from '../../../core/routing/routePaths'
import { BackLink } from '../../../components/shared/BackLink'
import { ConfirmModal } from '../../../components/shared/ConfirmModal'
import { ApiRequestError, apiRequest } from '../../../services/api/apiClient'
import { permissionActions, permissionModules, userRoles, type PermissionAction, type PermissionModule, type UserPermissions, type UserRole } from '../../../types/domain'
import { getRolePermissions } from '../../../core/auth/permissions'

const buildEmptyPermissions = (): UserPermissions => getRolePermissions('AUDITOR')

const permissionModuleLabelMap: Record<PermissionModule, string> = {
  FLEET: 'Flota',
  MAINTENANCE: 'Plan de mantenimiento',
  AUDITS: 'Inspecciones',
  WORK_ORDERS: 'Ordenes de trabajo',
  TASKS: 'Tareas',
  REPAIRS: 'Reparaciones',
  CRM: 'CRM Comercial',
  INVENTORY: 'Inventario',
  REPORTS: 'Reportes',
  USERS: 'Usuarios',
  MAINTENANCE_MODE: 'Mantenimiento app',
}

const normalizePermissions = (permissions: UserPermissions | undefined, role: UserRole): UserPermissions => {
  const base = getRolePermissions(role)
  if (!permissions) {
    return base
  }
  return permissionModules.reduce((accumulator, moduleKey) => {
    accumulator[moduleKey] = {
      ...base[moduleKey],
      ...(permissions[moduleKey] ?? {}),
    }
    return accumulator
  }, {} as UserPermissions)
}

const createUserId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `user-${Date.now()}`
}

const formatLastLogin = (value?: string): string => {
  if (!value) {
    return 'Sin registro'
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return 'Sin registro'
  }
  return new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date)
}

const resolveAccessTimestamp = (lastActivityAt?: string, lastLoginAt?: string): string | undefined =>
  lastActivityAt || lastLoginAt

const getAccessStateLabel = (timestamp?: string): { label: string; className: string } => {
  if (!timestamp) {
    return { label: 'Sin actividad', className: 'text-slate-500' }
  }
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) {
    return { label: 'Sin actividad', className: 'text-slate-500' }
  }

  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const oneDay = 24 * 60 * 60 * 1000

  if (diffMs < oneDay) {
    return { label: 'Activo hoy', className: 'text-emerald-700' }
  }
  if (diffMs < 7 * oneDay) {
    return { label: 'Activo reciente', className: 'text-amber-700' }
  }
  return { label: 'Inactivo', className: 'text-rose-700' }
}

const getApiErrorMessage = (error: unknown, fallback: string): string => {
  if (!(error instanceof ApiRequestError)) {
    return fallback
  }
  try {
    const parsed = JSON.parse(error.responseBody) as { message?: string }
    if (parsed?.message) {
      return parsed.message
    }
  } catch {
    // ignore
  }
  return fallback
}

export const UsersPage = () => {
  const {
    state: { users },
    actions: { setUsers, setAppError },
  } = useAppContext()

  const [editingUserId, setEditingUserId] = useState<string | null>(null)
  const [userIdPendingDelete, setUserIdPendingDelete] = useState<string | null>(null)
  const [formData, setFormData] = useState(() => ({
    username: '',
    fullName: '',
    role: 'AUDITOR' as UserRole,
    password: '',
    permissions: buildEmptyPermissions(),
    permissionOverrides: [] as Array<{
      module: PermissionModule
      action: PermissionAction
      allow: boolean
      expiresAt: string
    }>,
  }))

  const resetForm = () => {
    setEditingUserId(null)
    setFormData({
      username: '',
      fullName: '',
      role: 'AUDITOR',
      password: '',
      permissions: buildEmptyPermissions(),
      permissionOverrides: [],
    })
  }

  const handleEditUser = (userId: string) => {
    const user = users.find((item) => item.id === userId)
    if (!user) {
      return
    }
    setEditingUserId(userId)
    setFormData({
      username: user.username,
      fullName: user.fullName,
      role: user.role,
      password: '',
      permissions: normalizePermissions(user.permissions, user.role),
      permissionOverrides:
        user.permissionOverrides?.map((override) => ({
          module: override.module,
          action: override.action,
          allow: override.allow,
          expiresAt: override.expiresAt ?? '',
        })) ?? [],
    })
  }

  const handleSaveUser = async () => {
    if (!formData.username.trim() || !formData.fullName.trim()) {
      return
    }

    if (editingUserId) {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setAppError('No podés editar usuarios sin conexión.')
        return
      }

      const trimmedPassword = formData.password.trim()
      if (trimmedPassword && trimmedPassword.length < 6) {
        setAppError('La contraseña debe tener al menos 6 caracteres.')
        return
      }

      const permissionOverrides = formData.permissionOverrides.map((override) => ({
        ...override,
        expiresAt: override.expiresAt ? override.expiresAt : undefined,
      }))

      try {
        const response = await apiRequest<{
          id: string
          username: string
          fullName: string
          role: UserRole
          avatarUrl?: string
          permissions?: UserPermissions
          permissionOverrides?: Array<{
            module: PermissionModule
            action: PermissionAction
            allow: boolean
            expiresAt?: string
          }>
        }>(`/users/${editingUserId}`, {
          method: 'PATCH',
          body: {
            fullName: formData.fullName.trim(),
            role: formData.role,
            ...(trimmedPassword ? { password: trimmedPassword } : {}),
            permissions: formData.permissions,
            permissionOverrides,
          },
        })

        setUsers(
          users.map((user) =>
            user.id === editingUserId
              ? {
                  ...user,
                  username: response.username,
                  fullName: response.fullName,
                  role: response.role,
                  avatarUrl: response.avatarUrl,
                  permissions: normalizePermissions(response.permissions, response.role),
                  permissionOverrides: response.permissionOverrides,
                  ...(trimmedPassword ? { password: trimmedPassword } : {}),
                }
              : user,
          ),
        )
        resetForm()
      } catch (error) {
        setAppError(getApiErrorMessage(error, 'No se pudo guardar la edición del usuario.'))
      }
      return
    }

    if (!formData.password.trim()) {
      return
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setAppError('No podés crear usuarios sin conexión.')
      return
    }

    const newUser = {
      id: createUserId(),
      username: formData.username.trim(),
      fullName: formData.fullName.trim(),
      role: formData.role,
      password: formData.password,
      permissions: formData.permissions,
      permissionOverrides: formData.permissionOverrides.map((override) => ({
        ...override,
        expiresAt: override.expiresAt ? override.expiresAt : undefined,
      })),
    }
    try {
      const response = await apiRequest<{
        id: string
        username: string
        fullName: string
        role: UserRole
        avatarUrl?: string
        permissions?: UserPermissions
        permissionOverrides?: Array<{
          module: PermissionModule
          action: PermissionAction
          allow: boolean
          expiresAt?: string
        }>
      }>('/users', {
        method: 'POST',
        body: {
          username: newUser.username,
          fullName: newUser.fullName,
          role: newUser.role,
          password: newUser.password,
          permissions: newUser.permissions,
          permissionOverrides: newUser.permissionOverrides,
        },
      })

      setUsers([
        {
          ...newUser,
          id: response.id,
          username: response.username,
          fullName: response.fullName,
          role: response.role,
          avatarUrl: response.avatarUrl,
          permissions: normalizePermissions(response.permissions, response.role),
          permissionOverrides: response.permissionOverrides,
        },
        ...users,
      ])
      resetForm()
    } catch (error) {
      setAppError(getApiErrorMessage(error, 'No se pudo crear el usuario.'))
    }
  }

  const handleDeleteUser = async (userId: string) => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setAppError('No podés eliminar usuarios sin conexión.')
      return
    }

    try {
      await apiRequest(`/users/${userId}`, { method: 'DELETE' })
      setUsers(users.filter((user) => user.id !== userId))
      if (editingUserId === userId) {
        resetForm()
      }
    } catch (error) {
      setAppError(getApiErrorMessage(error, 'No se pudo eliminar el usuario.'))
    }
  }

  const handleRequestDeleteUser = (userId: string) => {
    setUserIdPendingDelete(userId)
  }

  const handleResetPassword = (userId: string) => {
    const newPassword = window.prompt('Nueva contraseña temporal (mínimo 6 caracteres):')
    if (!newPassword || newPassword.trim().length < 6) {
      setAppError('La contraseña debe tener al menos 6 caracteres.')
      return
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setAppError('No podés resetear contraseñas sin conexión.')
      return
    }
    apiRequest(`/users/${userId}`, { method: 'PATCH', body: { password: newPassword.trim() } })
      .then(() => {
        setUsers(
          users.map((user) =>
            user.id === userId
              ? { ...user, password: newPassword.trim() }
              : user,
          ),
        )
      })
      .catch((error) => {
        setAppError(getApiErrorMessage(error, 'No se pudo resetear la contraseña.'))
      })
  }

  const handleRoleChange = (role: UserRole) => {
    setFormData((previous) => ({
      ...previous,
      role,
      permissions: getRolePermissions(role),
    }))
  }

  const handlePermissionToggle = (moduleKey: PermissionModule, action: PermissionAction) => {
    setFormData((previous) => ({
      ...previous,
      permissions: {
        ...previous.permissions,
        [moduleKey]: {
          ...previous.permissions[moduleKey],
          [action]: !previous.permissions[moduleKey][action],
        },
      },
    }))
  }

  const handleAddOverride = () => {
    setFormData((previous) => ({
      ...previous,
      permissionOverrides: [
        ...previous.permissionOverrides,
        {
          module: 'FLEET',
          action: 'view',
          allow: true,
          expiresAt: '',
        },
      ],
    }))
  }

  const handleOverrideChange = (
    index: number,
    changes: Partial<{ module: PermissionModule; action: PermissionAction; allow: boolean; expiresAt: string }>,
  ) => {
    setFormData((previous) => ({
      ...previous,
      permissionOverrides: previous.permissionOverrides.map((override, idx) =>
        idx === index
          ? {
              ...override,
              ...changes,
            }
          : override,
      ),
    }))
  }

  const handleRemoveOverride = (index: number) => {
    setFormData((previous) => ({
      ...previous,
      permissionOverrides: previous.permissionOverrides.filter((_, idx) => idx !== index),
    }))
  }

  return (
    <section className="space-y-5">
      <header>
        <BackLink to={ROUTE_PATHS.dashboard} label="Volver al inicio" />
        <h2 className="text-2xl font-bold text-slate-900">Usuarios y permisos</h2>
        <p className="text-sm text-slate-600">Gestión de usuarios, roles y permisos por módulo.</p>
      </header>

      <div className="grid gap-4 xl:grid-cols-3">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-1">
          <h3 className="text-lg font-bold text-slate-900">{editingUserId ? 'Editar usuario' : 'Nuevo usuario'}</h3>

          <label className="mt-4 flex flex-col gap-2 text-sm font-semibold text-slate-700">
            Usuario
            <input
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
              value={formData.username}
              onChange={(event) => setFormData((prev) => ({ ...prev, username: event.target.value }))}
            />
          </label>

          <label className="mt-4 flex flex-col gap-2 text-sm font-semibold text-slate-700">
            Nombre completo
            <input
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
              value={formData.fullName}
              onChange={(event) => setFormData((prev) => ({ ...prev, fullName: event.target.value }))}
            />
          </label>

          <label className="mt-4 flex flex-col gap-2 text-sm font-semibold text-slate-700">
            {editingUserId ? 'Contraseña (opcional)' : 'Contraseña'}
            <input
              type="password"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
              value={formData.password}
              onChange={(event) => setFormData((prev) => ({ ...prev, password: event.target.value }))}
              placeholder={editingUserId ? 'Dejar vacía para conservar la actual' : ''}
            />
          </label>

          <label className="mt-4 flex flex-col gap-2 text-sm font-semibold text-slate-700">
            Rol
            <select
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
              value={formData.role}
              onChange={(event) => handleRoleChange(event.target.value as UserRole)}
            >
              {userRoles.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </label>

          <div className="mt-5 flex flex-wrap justify-end gap-2">
            {editingUserId ? (
              <button
                type="button"
                onClick={resetForm}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                Cancelar
              </button>
            ) : null}
            <button
              type="button"
              onClick={handleSaveUser}
              className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-500"
            >
              {editingUserId ? 'Guardar cambios' : 'Crear usuario'}
            </button>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-2">
          <h3 className="text-lg font-bold text-slate-900">Permisos por módulo</h3>
          <div className="mt-4 overflow-x-auto">
            <div className="min-w-[640px]">
              <div className="grid grid-cols-[180px_repeat(4,1fr)] gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                <span>Módulo</span>
                {permissionActions.map((action) => (
                  <span key={action} className="text-center">
                    {action}
                  </span>
                ))}
              </div>
              {permissionModules.map((moduleKey) => (
                <div key={moduleKey} className="grid grid-cols-[180px_repeat(4,1fr)] gap-2 border-b border-slate-200 px-3 py-2 text-sm">
                  <span className="font-semibold text-slate-700">{permissionModuleLabelMap[moduleKey]}</span>
                  {permissionActions.map((action) => (
                    <button
                      key={`${moduleKey}-${action}`}
                      type="button"
                      onClick={() => handlePermissionToggle(moduleKey, action)}
                      className={[
                        'rounded border px-2 py-1 text-xs font-semibold',
                        formData.permissions[moduleKey]?.[action]
                          ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                          : 'border-slate-200 bg-white text-slate-600',
                      ].join(' ')}
                    >
                      {formData.permissions[moduleKey]?.[action] ? 'SI' : 'NO'}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-slate-900">Permisos temporales</h4>
              <button
                type="button"
                onClick={handleAddOverride}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                Agregar
              </button>
            </div>

            <div className="mt-3 space-y-2">
              {formData.permissionOverrides.length === 0 ? (
                <p className="text-xs text-slate-500">Sin permisos temporales configurados.</p>
              ) : (
                formData.permissionOverrides.map((override, index) => (
                  <div key={`${override.module}-${override.action}-${index}`} className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 md:grid-cols-5">
                    <select
                      className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                      value={override.module}
                      onChange={(event) =>
                        handleOverrideChange(index, { module: event.target.value as PermissionModule })
                      }
                    >
                      {permissionModules.map((moduleKey) => (
                        <option key={moduleKey} value={moduleKey}>
                          {permissionModuleLabelMap[moduleKey]}
                        </option>
                      ))}
                    </select>
                    <select
                      className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                      value={override.action}
                      onChange={(event) =>
                        handleOverrideChange(index, { action: event.target.value as PermissionAction })
                      }
                    >
                      {permissionActions.map((action) => (
                        <option key={action} value={action}>
                          {action}
                        </option>
                      ))}
                    </select>
                    <select
                      className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                      value={override.allow ? 'allow' : 'deny'}
                      onChange={(event) => handleOverrideChange(index, { allow: event.target.value === 'allow' })}
                    >
                      <option value="allow">Permitir</option>
                      <option value="deny">Denegar</option>
                    </select>
                    <input
                      type="date"
                      className="rounded border border-slate-300 px-2 py-1 text-xs"
                      value={override.expiresAt}
                      onChange={(event) => handleOverrideChange(index, { expiresAt: event.target.value })}
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveOverride(index)}
                      className="rounded border border-rose-300 bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                    >
                      Eliminar
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-lg font-bold text-slate-900">Listado de usuarios</h3>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {users.map((user) => (
            <div key={user.id} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              {(() => {
                const lastAccess = resolveAccessTimestamp(user.lastActivityAt, user.lastLoginAt)
                const accessState = getAccessStateLabel(lastAccess)
                return (
                  <>
                    <p className="text-sm font-semibold text-slate-900">{user.fullName}</p>
                    <p className="text-xs text-slate-600">{user.username}</p>
                    <p className="text-xs text-slate-500">Rol: {user.role}</p>
                    <p className="text-xs text-slate-500">Último acceso: {formatLastLogin(lastAccess)}</p>
                    <p className={`text-xs font-semibold ${accessState.className}`}>Uso: {accessState.label}</p>
                  </>
                )
              })()}
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => handleEditUser(user.id)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Editar
                </button>
                <button
                  type="button"
                  onClick={() => handleRequestDeleteUser(user.id)}
                  className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                >
                  Eliminar
                </button>
                <button
                  type="button"
                  onClick={() => handleResetPassword(user.id)}
                  className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-100"
                >
                  Resetear contraseña</button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <ConfirmModal
        isOpen={Boolean(userIdPendingDelete)}
        title="Eliminar usuario"
        message={`¿Estás seguro de que deseas eliminar a ${
          users.find((user) => user.id === userIdPendingDelete)?.fullName ?? 'este usuario'
        }?`}
        onCancel={() => setUserIdPendingDelete(null)}
        onConfirm={async () => {
          if (!userIdPendingDelete) {
            return
          }
          await handleDeleteUser(userIdPendingDelete)
          setUserIdPendingDelete(null)
        }}
      />
    </section>
  )
}



