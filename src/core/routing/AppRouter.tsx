import { lazy, Suspense, type ComponentType, type ReactElement } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from '../layout/AppLayout'
import { RouteTransitionLoader } from '../../components/shared/RouteTransitionLoader'
import { ROUTE_PATHS } from './routePaths'
import { RequireAuth } from './RequireAuth'
import { RequirePermission } from './RequirePermission'
import { useAppContext } from '../hooks/useAppContext'
import type { FeatureFlags } from '../../types/domain'

/**
 * Cada pagina se exporta como named export, no default — lazy() necesita un
 * default, asi que se mapea aca en un solo lugar en vez de repetir el .then()
 * en cada import. Esto es lo que permite que Vite parta el bundle por pagina
 * en vez de meter las ~25 paginas (y jspdf/xlsx que usan algunas) en el chunk
 * principal que se descarga siempre, aunque el usuario nunca las abra.
 */
const lazyPage = <TModule extends Record<string, ComponentType<any>>, TKey extends keyof TModule>(
  loader: () => Promise<TModule>,
  exportName: TKey,
) => lazy(() => loader().then((module) => ({ default: module[exportName] })))

const AuditsPage = lazyPage(() => import('../../modules/audits/pages/AuditsPage'), 'AuditsPage')
const DashboardPage = lazyPage(() => import('../../modules/dashboard/pages/DashboardPage'), 'DashboardPage')
const FleetCreatePage = lazyPage(() => import('../../modules/fleet/pages/FleetCreatePage'), 'FleetCreatePage')
const FleetDetailPage = lazyPage(() => import('../../modules/fleet/pages/FleetDetailPage'), 'FleetDetailPage')
const FleetEditPage = lazyPage(() => import('../../modules/fleet/pages/FleetEditPage'), 'FleetEditPage')
const FleetListPage = lazyPage(() => import('../../modules/fleet/pages/FleetListPage'), 'FleetListPage')
const InventoryPage = lazyPage(() => import('../../modules/inventory/pages/InventoryPage'), 'InventoryPage')
const MaintenancePage = lazyPage(() => import('../../modules/maintenance/pages/MaintenancePage'), 'MaintenancePage')
const RepairsPage = lazyPage(() => import('../../modules/repairs/pages/RepairsPage'), 'RepairsPage')
const RepairImportPage = lazyPage(() => import('../../modules/repairs/pages/RepairImportPage'), 'RepairImportPage')
const MovementsPage = lazyPage(() => import('../../modules/movements/pages/MovementsPage'), 'MovementsPage')
const ClientsPage = lazyPage(() => import('../../modules/clients/pages/ClientsPage'), 'ClientsPage')
const DeliveriesPage = lazyPage(() => import('../../modules/deliveries/pages/DeliveriesPage'), 'DeliveriesPage')
const TasksPage = lazyPage(() => import('../../modules/tasks/pages/TasksPage'), 'TasksPage')
const WorkOrdersPage = lazyPage(() => import('../../modules/workOrders/pages/WorkOrdersPage'), 'WorkOrdersPage')
const ExternalRequestsPage = lazyPage(
  () => import('../../modules/externalRequests/pages/ExternalRequestsPage'),
  'ExternalRequestsPage',
)
const LoginPage = lazyPage(() => import('../../modules/auth/pages/LoginPage'), 'LoginPage')
const UsersPage = lazyPage(() => import('../../modules/users/pages/UsersPage'), 'UsersPage')
const ReportsPage = lazyPage(() => import('../../modules/reports/pages/ReportsPage'), 'ReportsPage')
const SuppliersPage = lazyPage(() => import('../../modules/suppliers/pages/SuppliersPage'), 'SuppliersPage')
const SupplierDetailPage = lazyPage(
  () => import('../../modules/suppliers/pages/SupplierDetailPage'),
  'SupplierDetailPage',
)
const CrmPage = lazyPage(() => import('../../modules/crm/pages/CrmPage'), 'CrmPage')
const ProjectsPage = lazyPage(() => import('../../modules/projects/pages/ProjectsPage'), 'ProjectsPage')
const ProjectDetailPage = lazyPage(() => import('../../modules/projects/pages/ProjectDetailPage'), 'ProjectDetailPage')
const PostventaPage = lazyPage(() => import('../../modules/postventa/pages/PostventaPage'), 'PostventaPage')
const ServiceOrdersPage = lazyPage(
  () => import('../../modules/serviceOrders/pages/ServiceOrdersPage'),
  'ServiceOrdersPage',
)
const ServiceOrderDetailPage = lazyPage(
  () => import('../../modules/serviceOrders/pages/ServiceOrderDetailPage'),
  'ServiceOrderDetailPage',
)
const InvoicesPage = lazyPage(() => import('../../modules/invoices/pages/InvoicesPage'), 'InvoicesPage')
const ProfilePage = lazyPage(() => import('../../modules/users/pages/ProfilePage'), 'ProfilePage')
const MaintenanceModePage = lazyPage(
  () => import('../../modules/system/pages/MaintenanceModePage'),
  'MaintenanceModePage',
)
const NotificationsPage = lazyPage(() => import('../../modules/system/pages/NotificationsPage'), 'NotificationsPage')

const RequireFeatureFlag = ({
  flag,
  children,
}: {
  flag: keyof FeatureFlags
  children: ReactElement
}) => {
  const {
    state: { featureFlags },
  } = useAppContext()

  if (!featureFlags[flag]) {
    return <Navigate to={ROUTE_PATHS.dashboard} replace />
  }

  return children
}

export const AppRouter = () => (
  <BrowserRouter>
    <Suspense fallback={<RouteTransitionLoader isActive />}>
      <Routes>
        <Route path={ROUTE_PATHS.auth.login} element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to={ROUTE_PATHS.dashboard} replace />} />
        <Route
          path={ROUTE_PATHS.dashboard}
          element={
            <RequirePermission module="FLEET" action="view">
              <DashboardPage />
            </RequirePermission>
          }
        />
        <Route
          path={ROUTE_PATHS.fleet.list}
          element={
            <RequireFeatureFlag flag="showFleetModule">
              <RequirePermission module="FLEET" action="view">
                <FleetListPage />
              </RequirePermission>
            </RequireFeatureFlag>
          }
        />
        <Route
          path={ROUTE_PATHS.fleet.create}
          element={
            <RequireFeatureFlag flag="showFleetModule">
              <RequirePermission module="FLEET" action="create">
                <FleetCreatePage />
              </RequirePermission>
            </RequireFeatureFlag>
          }
        />
        <Route
          path={ROUTE_PATHS.fleet.edit}
          element={
            <RequireFeatureFlag flag="showFleetModule">
              <RequirePermission module="FLEET" action="edit">
                <FleetEditPage />
              </RequirePermission>
            </RequireFeatureFlag>
          }
        />
        <Route
          path={ROUTE_PATHS.fleet.detail}
          element={
            <RequireFeatureFlag flag="showFleetModule">
              <RequirePermission module="FLEET" action="view">
                <FleetDetailPage />
              </RequirePermission>
            </RequireFeatureFlag>
          }
        />
        <Route
          path={ROUTE_PATHS.maintenance}
          element={
            <RequireFeatureFlag flag="showMaintenanceModule">
              <RequirePermission module="MAINTENANCE" action="view">
                <MaintenancePage />
              </RequirePermission>
            </RequireFeatureFlag>
          }
        />
        <Route
          path={ROUTE_PATHS.audits}
          element={
            <RequireFeatureFlag flag="showAuditsModule">
              <RequirePermission module="AUDITS" action="view">
                <AuditsPage />
              </RequirePermission>
            </RequireFeatureFlag>
          }
        />
        <Route
          path={ROUTE_PATHS.tasks}
          element={
            <RequireFeatureFlag flag="showTasksModule">
              <RequirePermission module="TASKS" action="view">
                <TasksPage />
              </RequirePermission>
            </RequireFeatureFlag>
          }
        />
        <Route
          path={ROUTE_PATHS.movements}
          element={
            <RequireFeatureFlag flag="showMovementsModule">
              <RequirePermission module="MOVEMENTS" action="view">
                <MovementsPage />
              </RequirePermission>
            </RequireFeatureFlag>
          }
        />
        <Route
          path={ROUTE_PATHS.clients}
          element={
            <RequireFeatureFlag flag="showClientsModule">
              <RequirePermission module="CLIENTS" action="view">
                <ClientsPage />
              </RequirePermission>
            </RequireFeatureFlag>
          }
        />
        <Route
          path={ROUTE_PATHS.deliveries}
          element={
            <RequireFeatureFlag flag="showDeliveriesModule">
              <RequirePermission module="DELIVERIES" action="view">
                <DeliveriesPage />
              </RequirePermission>
            </RequireFeatureFlag>
          }
        />
        <Route
          path={ROUTE_PATHS.workOrders}
          element={
            <RequireFeatureFlag flag="showWorkOrdersModule">
              <RequirePermission module="WORK_ORDERS" action="view">
                <WorkOrdersPage />
              </RequirePermission>
            </RequireFeatureFlag>
          }
        />
        <Route
          path={ROUTE_PATHS.externalRequests}
          element={
            <RequireFeatureFlag flag="showExternalRequestsModule">
              <RequirePermission module="EXTERNAL_REQUESTS" action="view">
                <ExternalRequestsPage />
              </RequirePermission>
            </RequireFeatureFlag>
          }
        />
        <Route
          path={ROUTE_PATHS.repairs}
          element={
            <RequireFeatureFlag flag="showRepairsModule">
              <RequirePermission module="REPAIRS" action="view">
                <RepairsPage />
              </RequirePermission>
            </RequireFeatureFlag>
          }
        />
        <Route
          path={ROUTE_PATHS.repairsImport}
          element={
            <RequireFeatureFlag flag="showRepairsModule">
              <RequirePermission module="REPAIRS" action="create">
                <RepairImportPage />
              </RequirePermission>
            </RequireFeatureFlag>
          }
        />
        <Route
          path={ROUTE_PATHS.suppliers}
          element={
            <RequireFeatureFlag flag="showSuppliersModule">
              <RequirePermission module="SUPPLIERS" action="view">
                <SuppliersPage />
              </RequirePermission>
            </RequireFeatureFlag>
          }
        />
        <Route
          path={ROUTE_PATHS.supplierDetail}
          element={
            <RequireFeatureFlag flag="showSuppliersModule">
              <RequirePermission module="SUPPLIERS" action="view">
                <SupplierDetailPage />
              </RequirePermission>
            </RequireFeatureFlag>
          }
        />
        <Route
          path={ROUTE_PATHS.crm}
          element={
            <RequireFeatureFlag flag="showCrmModule">
              <RequirePermission module="CRM" action="view">
                <CrmPage />
              </RequirePermission>
            </RequireFeatureFlag>
          }
        />
        <Route
          path={ROUTE_PATHS.inventory}
          element={
            <RequireFeatureFlag flag="showInventoryModule">
              <RequirePermission module="INVENTORY" action="view">
                <InventoryPage />
              </RequirePermission>
            </RequireFeatureFlag>
          }
        />
        <Route
          path={ROUTE_PATHS.reports}
          element={
            <RequireFeatureFlag flag="showReportsModule">
              <RequirePermission module="REPORTS" action="view">
                <ReportsPage />
              </RequirePermission>
            </RequireFeatureFlag>
          }
        />
        <Route
          path={ROUTE_PATHS.users}
          element={
            <RequireFeatureFlag flag="showUsersModule">
              <RequirePermission module="USERS" action="view">
                <UsersPage />
              </RequirePermission>
            </RequireFeatureFlag>
          }
        />
        <Route path={ROUTE_PATHS.profile} element={<ProfilePage />} />
        <Route path={ROUTE_PATHS.notifications} element={<NotificationsPage />} />
        <Route
          path={ROUTE_PATHS.maintenanceMode}
          element={
            <RequirePermission module="MAINTENANCE_MODE" action="view">
              <MaintenanceModePage />
            </RequirePermission>
          }
        />
        <Route
          path={ROUTE_PATHS.projects.list}
          element={
            <RequirePermission module="PROJECTS" action="view">
              <ProjectsPage />
            </RequirePermission>
          }
        />
        <Route
          path={ROUTE_PATHS.projects.detail}
          element={
            <RequirePermission module="PROJECTS" action="view">
              <ProjectDetailPage />
            </RequirePermission>
          }
        />
        <Route
          path={ROUTE_PATHS.postventa}
          element={
            <RequirePermission module="POSTVENTA" action="view">
              <PostventaPage />
            </RequirePermission>
          }
        />
        <Route
          path={ROUTE_PATHS.serviceOrders.list}
          element={
            <RequirePermission module="SERVICE_ORDERS" action="view">
              <ServiceOrdersPage />
            </RequirePermission>
          }
        />
        <Route
          path={ROUTE_PATHS.serviceOrders.detail}
          element={
            <RequirePermission module="SERVICE_ORDERS" action="view">
              <ServiceOrderDetailPage />
            </RequirePermission>
          }
        />
        <Route
          path={ROUTE_PATHS.invoices}
          element={
            <RequirePermission module="INVOICES" action="view">
              <InvoicesPage />
            </RequirePermission>
          }
        />
        <Route path="*" element={<Navigate to={ROUTE_PATHS.dashboard} replace />} />
      </Route>
      </Routes>
    </Suspense>
  </BrowserRouter>
)
