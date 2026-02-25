import { useState } from 'react'
import { useAppContext } from '../../../core/hooks/useAppContext'
import { ROUTE_PATHS } from '../../../core/routing/routePaths'
import { BackLink } from '../../../components/shared/BackLink'
import { apiRequest } from '../../../services/api/apiClient'
import { permissionActions, permissionModules, userRoles, type PermissionAction, type PermissionModule, type UserPermissions, type UserRole } from '../../../types/domain'
import { getRolePermissions } from '../../../core/auth/permissions'

const buildEmptyPermissions = (): UserPermissions => getRolePermissions('AUDITOR')

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

export const UsersPage = () => {
  const {
    state: { users },
    actions: { setUsers, setAppError },
  } = useAppContext()

  const [editingUserId, setEditingUserId] = useState<string | null>(null)
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
      password: user.password,
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
    if (!formData.username.trim() || !formData.fullName.trim() || !formData.password.trim()) {
      return
    }

    if (editingUserId) {
      const nextUsers = users.map((user) =>
        user.id === editingUserId
          ? {
              ...user,
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
          : user,
      )
      setUsers(nextUsers)
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        apiRequest(`/users/${editingUserId}`, {
          method: 'PATCH',
          body: {
            fullName: formData.fullName.trim(),
            role: formData.role,
            password: formData.password,
            permissions: formData.permissions,
            permissionOverrides: formData.permissionOverrides.map((override) => ({
              ...override,
              expiresAt: override.expiresAt ? override.expiresAt : undefined,
            })),
          },
        }).catch(() => null)
      }
      resetForm()
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
    setUsers([newUser, ...users])
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      apiRequest('/users', {
        method: 'POST',
        body: {
          username: newUser.username,
          fullName: newUser.fullName,
          role: newUser.role,
          password: newUser.password,
          permissions: newUser.permissions,
          permissionOverrides: newUser.permissionOverrides,
        },
      }).catch(() => null)
    }
    resetForm()
  }

  const handleDeleteUser = (userId: string) => {
    setUsers(users.filter((user) => user.id !== userId))
    if (editingUserId === userId) {
      resetForm()
    }
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      apiRequest(`/users/${userId}`, { method: 'DELETE' }).catch(() => null)
    }
  }

  const handleResetPassword = (userId: string) => {
    const newPassword = window.prompt('Nueva contraseña temporal (min 6 caracteres):')
    if (!newPassword || newPassword.trim().length < 6) {
      setAppError('La contraseña debe tener al menos 6 caracteres.')
      return
    }
    setUsers(
      users.map((user) =>
        user.id === userId
          ? { ...user, password: newPassword.trim() }
          : user,
      ),
    )
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      apiRequest(`/users/${userId}`, { method: 'PATCH', body: { password: newPassword.trim() } }).catch(() => null)
    }
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
            Contraseña
            <input
              type="password"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
              value={formData.password}
              onChange={(event) => setFormData((prev) => ({ ...prev, password: event.target.value }))}
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
                  <span className="font-semibold text-slate-700">{moduleKey}</span>
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
                          {moduleKey}
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
              <p className="text-sm font-semibold text-slate-900">{user.fullName}</p>
              <p className="text-xs text-slate-600">{user.username}</p>
              <p className="text-xs text-slate-500">Rol: {user.role}</p>
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
                  onClick={() => handleDeleteUser(user.id)}
                  className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                >
                  Eliminar
                </button>
                <button
                  type="button"
                  onClick={() => handleResetPassword(user.id)}
                  className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-100"
                >
                  Resetear contraseña
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </section>
  )
}
