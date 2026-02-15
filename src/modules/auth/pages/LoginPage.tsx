import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { authenticateUser } from '../../../core/auth/authService'
import { useAppContext } from '../../../core/hooks/useAppContext'
import { ROUTE_PATHS } from '../../../core/routing/routePaths'
import { apiRequest, setAuthToken } from '../../../services/api/apiClient'
import logo from '../../../assets/enertrans-logo.png'

export const LoginPage = () => {
  const navigate = useNavigate()
  const {
    state: { users },
    actions: { setCurrentUser, setAppError },
  } = useAppContext()

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [lastUser, setLastUser] = useState(() => {
    if (typeof window === 'undefined') {
      return null
    }
    try {
      const raw = window.localStorage.getItem('enertrans.sigf.last-user')
      return raw ? (JSON.parse(raw) as any) : null
    } catch {
      return null
    }
  })

  const saveLastUser = (user: any) => {
    if (typeof window === 'undefined') {
      return
    }
    try {
      window.localStorage.setItem('enertrans.sigf.last-user', JSON.stringify(user))
      setLastUser(user)
    } catch {
      // ignore
    }
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setErrorMessage('')
    setAppError(null)

    if (typeof navigator !== 'undefined' && navigator.onLine) {
      try {
        const response = await apiRequest<{
          token: string
          user: {
            id: string
            username: string
            fullName: string
            role: string
            avatarUrl?: string
            permissions?: any
            permissionOverrides?: any
          }
        }>('/auth/login', {
          method: 'POST',
          body: { username, password },
          token: null,
        })

        setAuthToken(response.token)
        const nextUser = {
          id: response.user.id,
          username: response.user.username,
          fullName: response.user.fullName,
          role: response.user.role as any,
          avatarUrl: response.user.avatarUrl,
          password,
          permissions: response.user.permissions,
          permissionOverrides: response.user.permissionOverrides,
        }
        setCurrentUser(nextUser)
        saveLastUser(nextUser)
        navigate(ROUTE_PATHS.dashboard, { replace: true })
        return
      } catch (error) {
        setErrorMessage('No se pudo autenticar en el servidor. Probando modo local...')
      }
    }

    const user = authenticateUser(username, password, users)
    if (!user) {
      setErrorMessage('Usuario o contrasena incorrectos.')
      return
    }

    setCurrentUser(user)
    saveLastUser(user)
    navigate(ROUTE_PATHS.dashboard, { replace: true })
  }

  return (
    <section className="relative flex min-h-screen items-center justify-center bg-slate-950 px-4 py-12">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_#fbbf24_0%,_rgba(15,23,42,0.6)_40%,_rgba(2,6,23,1)_75%)]" />
        <div className="absolute bottom-0 left-0 h-40 w-40 rounded-full bg-amber-500/20 blur-3xl" />
        <div className="absolute right-0 top-10 h-64 w-64 rounded-full bg-amber-400/10 blur-[120px]" />
      </div>

      <form
        onSubmit={handleSubmit}
        className="relative w-full max-w-md rounded-2xl border border-amber-400/30 bg-slate-950/80 p-8 shadow-[0_20px_60px_rgba(0,0,0,0.45)] backdrop-blur"
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="rounded-full border border-amber-400/30 bg-slate-900/70 p-3">
            <img src={logo} alt="Enertrans" className="h-10 w-auto" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-amber-300">ENERTRANS</h2>
            <p className="mt-1 text-xs uppercase tracking-[0.3em] text-slate-400">Sistema de Gestion de Flota</p>
          </div>
        </div>

        <div className="mt-8 space-y-4">
          <label className="flex flex-col gap-2 text-sm font-semibold text-amber-200">
            Usuario
            <input
              className="w-full rounded-lg border border-amber-400/30 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-400/30"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="Usuario"
              autoComplete="username"
            />
          </label>

          <label className="flex flex-col gap-2 text-sm font-semibold text-amber-200">
            Contrasena
            <input
              type="password"
              className="w-full rounded-lg border border-amber-400/30 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-400/30"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Contrasena"
              autoComplete="current-password"
            />
          </label>
        </div>

        {errorMessage ? <p className="mt-4 text-sm font-semibold text-rose-300">{errorMessage}</p> : null}

        <button
          type="submit"
          className="mt-6 w-full rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-950 shadow-lg shadow-amber-500/20 transition hover:bg-amber-300"
        >
          Ingresar
        </button>

        {typeof navigator !== 'undefined' && !navigator.onLine && lastUser ? (
          <button
            type="button"
            onClick={() => {
              setAuthToken(null)
              setCurrentUser(lastUser)
              navigate(ROUTE_PATHS.dashboard, { replace: true })
            }}
            className="mt-3 w-full rounded-lg border border-amber-400/30 bg-transparent px-4 py-2 text-xs font-semibold text-amber-200 hover:border-amber-400 hover:text-amber-100"
          >
            Entrar en modo offline
          </button>
        ) : null}

        <p className="mt-4 text-center text-xs text-slate-500">Acceso privado Enertrans. Usa tu usuario asignado.</p>

        <button
          type="button"
          onClick={() => {
            if (typeof window !== 'undefined') {
              window.localStorage.removeItem('enertrans.sigf.app-state.v1')
              window.location.reload()
            }
          }}
          className="mt-4 w-full rounded-lg border border-amber-400/30 bg-transparent px-4 py-2 text-xs font-semibold text-amber-200 hover:border-amber-400 hover:text-amber-100"
        >
          Restablecer acceso en este navegador
        </button>
      </form>
    </section>
  )
}
