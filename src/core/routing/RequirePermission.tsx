import { Navigate } from 'react-router-dom'
import { ROUTE_PATHS } from './routePaths'
import type { PermissionAction, PermissionModule } from '../../types/domain'
import { usePermissions } from '../auth/usePermissions'

interface RequirePermissionProps {
  module: PermissionModule
  action: PermissionAction
  children: React.ReactElement
}

export const RequirePermission = ({ module, action, children }: RequirePermissionProps) => {
  const { can } = usePermissions()

  if (!can(module, action)) {
    return <Navigate to={ROUTE_PATHS.fleet.list} replace />
  }

  return children
}
