import { NavLink } from 'react-router-dom'
import { ROUTE_PATHS } from '../routing/routePaths'
import { usePermissions } from '../auth/usePermissions'
import type { PermissionModule } from '../../types/domain'

const navigationItems: Array<{ path: string; label: string; module: PermissionModule }> = [
  { path: ROUTE_PATHS.fleet.list, label: 'Flota', module: 'FLEET' },
  { path: ROUTE_PATHS.maintenance, label: 'Plan de Mantenimiento', module: 'MAINTENANCE' },
  { path: ROUTE_PATHS.audits, label: 'Auditorias', module: 'AUDITS' },
  { path: ROUTE_PATHS.workOrders, label: 'Ordenes de Trabajo', module: 'WORK_ORDERS' },
  { path: ROUTE_PATHS.externalRequests, label: 'Notas de pedido externo', module: 'WORK_ORDERS' },
  { path: ROUTE_PATHS.repairs, label: 'Reparaciones', module: 'REPAIRS' },
  { path: ROUTE_PATHS.inventory, label: 'Inventario', module: 'INVENTORY' },
  { path: ROUTE_PATHS.reports, label: 'Reportes', module: 'REPORTS' },
  { path: ROUTE_PATHS.users, label: 'Usuarios', module: 'USERS' },
  { path: ROUTE_PATHS.maintenanceMode, label: 'Mantenimiento app', module: 'MAINTENANCE_MODE' },
]

const getNavItemClassName = ({ isActive }: { isActive: boolean }) =>
  [
    'block rounded-lg border px-4 py-3 text-sm font-semibold transition-colors',
    isActive
      ? 'border-amber-300 bg-amber-300/15 text-amber-200'
      : 'border-transparent text-slate-300 hover:border-slate-600 hover:bg-slate-800/60 hover:text-white',
  ].join(' ')

interface SidebarProps {
  isOpen: boolean
  onClose: () => void
}

export const Sidebar = ({ isOpen, onClose }: SidebarProps) => {
  const { can } = usePermissions()

  const navItems = navigationItems.filter((item) => can(item.module, 'view'))

  return (
    <>
      <div
        className={[
          'fixed inset-0 z-40 bg-slate-900/60 transition-opacity',
          isOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
        ].join(' ')}
        onClick={onClose}
      />

      <aside
        className={[
          'fixed inset-y-0 left-0 z-50 h-screen w-72 shrink-0 border-r border-slate-700 bg-slate-800 text-white transition-transform',
          isOpen ? 'translate-x-0' : '-translate-x-full',
          isOpen ? 'lg:translate-x-0' : 'lg:-translate-x-full',
        ].join(' ')}
      >
        <div className="flex h-full flex-col px-5 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-bold tracking-wide text-amber-300">ENERTRANS</h1>
              <p className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-400">Sistema de Gestion de Flota</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-600 bg-slate-800/70 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 lg:hidden"
            >
              Cerrar
            </button>
          </div>

          <nav className="mt-10 flex flex-col gap-2">
            {navItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                className={getNavItemClassName}
                end
                onClick={onClose}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </aside>
    </>
  )
}
