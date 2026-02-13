import { useMemo } from 'react'
import { useAppContext } from '../hooks/useAppContext'
import type { PermissionAction, PermissionModule, UserPermissions } from '../../types/domain'
import { canUser, resolveUserPermissions } from './permissions'

export const usePermissions = () => {
  const {
    state: { currentUser },
  } = useAppContext()

  const permissions = useMemo<UserPermissions>(() => resolveUserPermissions(currentUser), [currentUser])

  const can = (moduleKey: PermissionModule, action: PermissionAction): boolean =>
    canUser(currentUser, moduleKey, action)

  return { currentUser, permissions, can }
}
