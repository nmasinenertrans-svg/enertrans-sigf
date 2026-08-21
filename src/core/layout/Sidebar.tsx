import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { ROUTE_PATHS } from '../routing/routePaths'
import { usePermissions } from '../auth/usePermissions'
import { useAppContext } from '../hooks/useAppContext'
import type { FeatureFlags, PermissionModule } from '../../types/domain'

type NavItem = { path: string; label: string; module: PermissionModule; flagKey?: keyof FeatureFlags; devOnly?: boolean }
type NavGroup = { id: string; label: string; items: NavItem[] }

const navigationGroups: NavGroup[] = [
  {
    id: 'fleet',
    label: 'Flota',
    items: [
      { path: ROUTE_PATHS.fleet.list, label: 'Flota', module: 'FLEET', flagKey: 'showFleetModule' },
      { path: ROUTE_PATHS.projects.list, label: 'Proyectos de Modificación', module: 'PROJECTS' },
    ],
  },
  {
    id: 'workshop',
    label: 'Taller / Mantenimiento',
    items: [
      { path: ROUTE_PATHS.maintenance, label: 'Plan de Mantenimiento', module: 'MAINTENANCE', flagKey: 'showMaintenanceModule' },
      { path: ROUTE_PATHS.tires, label: 'Cubiertas (prueba)', module: 'MAINTENANCE', devOnly: true },
      { path: ROUTE_PATHS.audits, label: 'Inspecciones', module: 'AUDITS', flagKey: 'showAuditsModule' },
      { path: ROUTE_PATHS.tasks, label: 'Tareas', module: 'TASKS', flagKey: 'showTasksModule' },
      { path: ROUTE_PATHS.workOrders, label: 'Órdenes de Trabajo', module: 'WORK_ORDERS', flagKey: 'showWorkOrdersModule' },
      {
        path: ROUTE_PATHS.externalRequests,
        label: 'Notas de Pedido Externo',
        module: 'EXTERNAL_REQUESTS',
        flagKey: 'showExternalRequestsModule',
      },
      { path: ROUTE_PATHS.repairs, label: 'Reparaciones', module: 'REPAIRS', flagKey: 'showRepairsModule' },
      { path: ROUTE_PATHS.invoices, label: 'Facturas', module: 'INVOICES' },
      { path: ROUTE_PATHS.suppliers, label: 'Proveedores', module: 'SUPPLIERS', flagKey: 'showSuppliersModule' },
    ],
  },
  {
    id: 'commercial',
    label: 'Comercial',
    items: [
      { path: ROUTE_PATHS.clients, label: 'Clientes', module: 'CLIENTS', flagKey: 'showClientsModule' },
      { path: ROUTE_PATHS.crm, label: 'CRM Comercial', module: 'CRM', flagKey: 'showCrmModule' },
      { path: ROUTE_PATHS.contracts, label: 'Contratos (prueba)', module: 'CRM', devOnly: true },
      { path: ROUTE_PATHS.serviceOrders.list, label: 'Órdenes de Servicio', module: 'SERVICE_ORDERS' },
      { path: ROUTE_PATHS.postventa, label: 'Postventa', module: 'POSTVENTA' },
    ],
  },
  {
    id: 'logistics',
    label: 'Logística',
    items: [
      { path: ROUTE_PATHS.deliveries, label: 'Entregas/Devoluciones', module: 'DELIVERIES', flagKey: 'showDeliveriesModule' },
      { path: ROUTE_PATHS.movements, label: 'Remitos', module: 'MOVEMENTS', flagKey: 'showMovementsModule' },
      { path: ROUTE_PATHS.handoverChecklists, label: 'Checklist entrega/devolución (prueba)', module: 'DELIVERIES', devOnly: true },
    ],
  },
  {
    id: 'system',
    label: 'Sistema',
    items: [
      { path: ROUTE_PATHS.inventory, label: 'Inventario', module: 'INVENTORY', flagKey: 'showInventoryModule' },
      { path: ROUTE_PATHS.reports, label: 'Reportes', module: 'REPORTS', flagKey: 'showReportsModule' },
      { path: ROUTE_PATHS.users, label: 'Usuarios', module: 'USERS', flagKey: 'showUsersModule' },
      { path: ROUTE_PATHS.maintenanceMode, label: 'Mantenimiento app', module: 'MAINTENANCE_MODE' },
    ],
  },
]

const OPEN_GROUPS_KEY = 'enertrans.sidebar.openGroups'

const readOpenGroups = (): Set<string> => {
  if (typeof window === 'undefined') {
    return new Set(navigationGroups.map((group) => group.id))
  }
  try {
    const stored = window.localStorage.getItem(OPEN_GROUPS_KEY)
    if (!stored) {
      return new Set(navigationGroups.map((group) => group.id))
    }
    const parsed = JSON.parse(stored)
    return Array.isArray(parsed) ? new Set(parsed) : new Set(navigationGroups.map((group) => group.id))
  } catch {
    return new Set(navigationGroups.map((group) => group.id))
  }
}

const persistOpenGroups = (groups: Set<string>) => {
  if (typeof window === 'undefined') {
    return
  }
  try {
    window.localStorage.setItem(OPEN_GROUPS_KEY, JSON.stringify(Array.from(groups)))
  } catch {
    // ignore
  }
}

const getNavItemClassName = ({ isActive }: { isActive: boolean }) =>
  [
    'block rounded-lg border px-4 py-2.5 text-sm font-semibold transition-colors',
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
  const location = useLocation()
  const {
    state: { featureFlags, currentUser },
  } = useAppContext()
  const [openGroupIds, setOpenGroupIds] = useState<Set<string>>(readOpenGroups)

  const visibleGroups = navigationGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (!can(item.module, 'view')) {
          return false
        }
        if (item.flagKey && !featureFlags[item.flagKey]) {
          return false
        }
        if (item.devOnly && currentUser?.role !== 'DEV') {
          return false
        }
        return true
      }),
    }))
    .filter((group) => group.items.length > 0)

  // Si navegan a un item cuyo grupo esta colapsado, lo abrimos para que no "desaparezca" del menu.
  useEffect(() => {
    const activeGroup = visibleGroups.find((group) => group.items.some((item) => location.pathname.startsWith(item.path)))
    if (activeGroup && !openGroupIds.has(activeGroup.id)) {
      setOpenGroupIds((previous) => {
        const next = new Set(previous)
        next.add(activeGroup.id)
        persistOpenGroups(next)
        return next
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname])

  const toggleGroup = (groupId: string) => {
    setOpenGroupIds((previous) => {
      const next = new Set(previous)
      if (next.has(groupId)) {
        next.delete(groupId)
      } else {
        next.add(groupId)
      }
      persistOpenGroups(next)
      return next
    })
  }

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
        <div className="flex h-full min-h-0 flex-col px-5 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-bold tracking-wide text-amber-300">ENERTRANS</h1>
              <p className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-400">Sistema de Gestion de Flota</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              data-basic-view-allow="true"
              className="rounded-lg border border-slate-600 bg-slate-800/70 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 lg:hidden"
            >
              Cerrar
            </button>
          </div>

          <nav className="mt-10 flex flex-1 min-h-0 flex-col gap-4 overflow-y-auto pr-1">
            {visibleGroups.map((group) => {
              const isGroupOpen = openGroupIds.has(group.id)
              return (
                <div key={group.id}>
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.id)}
                    className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-bold uppercase tracking-wider text-slate-400 hover:text-slate-200"
                  >
                    <span>{group.label}</span>
                    <span className={`transition-transform ${isGroupOpen ? 'rotate-90' : ''}`}>›</span>
                  </button>
                  {isGroupOpen ? (
                    <div className="mt-1 flex flex-col gap-1.5">
                      {group.items.map((item) => (
                        <NavLink key={item.path} to={item.path} className={getNavItemClassName} end onClick={onClose}>
                          {item.label}
                        </NavLink>
                      ))}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </nav>
        </div>
      </aside>
    </>
  )
}
