import { Navigate } from 'react-router-dom'
import { useAppContext } from '../hooks/useAppContext'
import { ROUTE_PATHS } from './routePaths'
import { getAuthToken } from '../../services/api/apiClient'

interface RequireAuthProps {
  children: React.ReactElement
}

export const RequireAuth = ({ children }: RequireAuthProps) => {
  const {
    state: { currentUser },
  } = useAppContext()
  const token = getAuthToken()

  if (!currentUser || !token) {
    return <Navigate to={ROUTE_PATHS.auth.login} replace />
  }

  return children
}
