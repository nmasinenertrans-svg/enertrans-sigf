import { Navigate } from 'react-router-dom'
import { useAppContext } from '../hooks/useAppContext'
import { ROUTE_PATHS } from './routePaths'
import { getAuthToken } from '../../services/api/apiClient'

interface RequireAuthProps {
  children: React.ReactElement
}

export const RequireAuth = ({ children }: RequireAuthProps) => {
  const {
    state: { currentUser, maintenanceStatus },
  } = useAppContext()
  const token = getAuthToken()

  const isOffline = typeof navigator !== 'undefined' && !navigator.onLine

  if (!currentUser || (!token && !isOffline)) {
    return <Navigate to={ROUTE_PATHS.auth.login} replace />
  }

  if (maintenanceStatus.enabled && currentUser.role !== 'DEV') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-6 py-12 text-center">
        <div className="max-w-lg rounded-2xl border border-amber-400/30 bg-slate-950/80 p-8 text-slate-100 shadow-[0_20px_60px_rgba(0,0,0,0.45)]">
          <h2 className="text-2xl font-bold text-amber-300">Mantenimiento en curso</h2>
          <p className="mt-4 text-sm text-slate-300">
            {maintenanceStatus.message ||
              'La aplicacion se encuentra en mantenimiento, contacte con el area de soporte.'}
          </p>
        </div>
      </div>
    )
  }

  return children
}
