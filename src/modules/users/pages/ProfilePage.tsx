import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ROUTE_PATHS } from '../../../core/routing/routePaths'
import { useAppContext } from '../../../core/hooks/useAppContext'
import { apiRequest } from '../../../services/api/apiClient'
import { clearQueue } from '../../../services/offline/queue'
import { BackLink } from '../../../components/shared/BackLink'

export const ProfilePage = () => {
  const navigate = useNavigate()
  const {
    state: { currentUser, users },
    actions: { setCurrentUser, setUsers, setAppError },
  } = useAppContext()

  const user = currentUser

  const [fullName, setFullName] = useState(user?.fullName ?? '')
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl ?? '')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const initials = useMemo(() => {
    const name = user?.fullName?.trim() || user?.username || ''
    const parts = name.split(' ').filter(Boolean)
    const letters = parts.slice(0, 2).map((part) => part[0])
    return letters.join('').toUpperCase() || 'U'
  }, [user])

  if (!user) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-bold text-slate-900">Perfil no disponible</h2>
        <p className="mt-2 text-sm text-slate-600">Inicia sesión para ver tu perfil.</p>
      </section>
    )
  }

  const updateLocalUser = (updates: Partial<typeof user>) => {
    const nextUser = { ...user, ...updates }
    setCurrentUser(nextUser)
    setUsers(users.map((item) => (item.id === user.id ? { ...item, ...updates } : item)))
  }

  const handleSaveProfile = async () => {
    const safeFullName = (fullName ?? '').trim()
    const safeAvatarUrl = (avatarUrl ?? '').trim()
    if (!safeFullName) {
      setAppError('El nombre completo es obligatorio.')
      return
    }

    if (newPassword && newPassword.length < 6) {
      setAppError('La contrasena debe tener al menos 6 caracteres.')
      return
    }

    if (newPassword && newPassword !== confirmPassword) {
      setAppError('Las contrasenas no coinciden.')
      return
    }

    setIsSaving(true)
    const payload: any = {
      fullName: safeFullName,
      avatarUrl: safeAvatarUrl,
    }

    if (newPassword) {
      payload.password = newPassword
    }

    updateLocalUser({ fullName: payload.fullName, avatarUrl: payload.avatarUrl, password: newPassword || user.password })

    if (typeof navigator !== 'undefined' && navigator.onLine) {
      try {
        await apiRequest('/users/me', { method: 'PATCH', body: payload })
      } catch {
        setAppError('No se pudo guardar el perfil en el servidor.')
      }
    }

    setNewPassword('')
    setConfirmPassword('')
    setIsSaving(false)
  }

  const handleAvatarUpload = async (file?: File | null) => {
    if (!file) {
      return
    }

    const reader = new FileReader()
    reader.onload = async () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : ''
      if (!dataUrl) {
        return
      }

      if (typeof navigator !== 'undefined' && navigator.onLine) {
        try {
          const response = await apiRequest<{ url: string }>('/files/upload', {
            method: 'POST',
            body: {
              fileName: `${user.id}-${file.name}`,
              contentType: file.type || 'application/octet-stream',
              dataUrl,
              folder: 'avatars',
            },
          })
          setAvatarUrl(response.url)
          updateLocalUser({ avatarUrl: response.url })
          await apiRequest('/users/me', { method: 'PATCH', body: { avatarUrl: response.url } })
          return
        } catch {
          setAppError('No se pudo subir la foto en la nube. Se guardo localmente.')
        }
      }

      setAvatarUrl(dataUrl)
      updateLocalUser({ avatarUrl: dataUrl })
    }
    reader.readAsDataURL(file)
  }

  return (
    <section className="space-y-6">
      <header className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <BackLink to={ROUTE_PATHS.users} label="Volver a usuarios" />
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-amber-500">Perfil</p>
            <h2 className="mt-2 text-2xl font-bold text-slate-900">Mi cuenta</h2>
            <p className="mt-1 text-sm text-slate-600">Gestiona tu informacion y credenciales.</p>
          </div>
          <button
            type="button"
            onClick={() => navigate(ROUTE_PATHS.dashboard)}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
          >
            Volver
          </button>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col items-center gap-3 text-center">
            {avatarUrl ? (
              <img src={avatarUrl} alt={user.fullName} className="h-24 w-24 rounded-full border border-slate-200 object-cover" />
            ) : (
              <div className="flex h-24 w-24 items-center justify-center rounded-full bg-amber-100 text-2xl font-bold text-amber-700">
                {initials}
              </div>
            )}
            <div>
              <p className="text-lg font-semibold text-slate-900">{user.fullName}</p>
              <p className="text-xs font-semibold uppercase text-slate-500">{user.role}</p>
            </div>
            <label className="mt-2 inline-flex cursor-pointer items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 hover:border-amber-300 hover:bg-amber-100">
              Cambiar foto
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => handleAvatarUpload(event.target.files?.[0] ?? null)}
              />
            </label>
          </div>

          <div className="mt-6 space-y-3 text-sm text-slate-600">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Usuario</p>
              <p className="font-semibold text-slate-900">{user.username}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Rol</p>
              <p className="font-semibold text-slate-900">{user.role}</p>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-800">Datos personales</h3>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
                Nombre completo
                <input
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                />
              </label>
              <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
                Email (opcional)
                <input
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500"
                  value=""
                  placeholder="Sin configurar"
                  disabled
                />
              </label>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-800">Cambiar contrasena</h3>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
                Nueva contrasena
                <input
                  type="password"
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
              </label>
              <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
                Confirmar contrasena
                <input
                  type="password"
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                />
              </label>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleSaveProfile}
              className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-500"
              disabled={isSaving}
            >
              {isSaving ? 'Guardando...' : 'Guardar cambios'}
            </button>
            <button
              type="button"
              onClick={async () => {
                await clearQueue()
                window.location.reload()
              }}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              Limpiar cola offline
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
