import { Suspense, lazy, type ReactElement } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ROUTE_PATHS } from './routePaths'
import { RequireAuth } from './RequireAuth'
import { RequirePermission } from './RequirePermission'
import { useAppContext } from '../hooks/useAppContext'
import type { FeatureFlags } from '../../types/domain'

const AppLayout = lazy(() => import('../layout/AppLayout').then((module) => ({ default: module.AppLayout })))
const LoginPage = lazy(() => import('../../modules/auth/pages/LoginPage').then((module) => ({ default: module.LoginPage })))
const DashboardPage = lazy(() =>
  import('../../modules/dashboard/pages/DashboardPage').then((module) => ({ default: module.DashboardPage })),
)
const FleetListPage = lazy(() =>
  import('../../modules/fleet/pages/FleetListPage').then((module) => ({ default: module.FleetListPage })),
)
const FleetCreatePage = lazy(() =>
  import('../../modules/fleet/pages/FleetCreatePage').then((module) => ({ default: module.FleetCreatePage })),
)
const FleetEditPage = lazy(() =>
  import('../../modules/fleet/pages/FleetEditPage').then((module) => ({ default: module.FleetEditPage })),
)
const FleetDetailPage = lazy(() =>
  import('../../modules/fleet/pages/FleetDetailPage').then((module) => ({ default: module.FleetDetailPage })),
)
const MaintenancePage = lazy(() =>
  import('../../modules/maintenance/pages/MaintenancePage').then((module) => ({ default: module.MaintenancePage })),
)
const AuditsPage = lazy(() => import('../../modules/audits/pages/AuditsPage').then((module) => ({ default: module.AuditsPage })))
const TasksPage = lazy(() => import('../../modules/tasks/pages/TasksPage').then((module) => ({ default: module.TasksPage })))
const MovementsPage = lazy(() =>
  import('../../modules/movements/pages/MovementsPage').then((module) => ({ default: module.MovementsPage })),
)
const WorkOrdersPage = lazy(() =>
  import('../../modules/workOrders/pages/WorkOrdersPage').then((module) => ({ default: module.WorkOrdersPage })),
)
const ExternalRequestsPage = lazy(() =>
  import('../../modules/externalRequests/pages/ExternalRequestsPage').then((module) => ({ default: module.ExternalRequestsPage })),
)
const RepairsPage = lazy(() => import('../../modules/repairs/pages/RepairsPage').then((module) => ({ default: module.RepairsPage })))
const InventoryPage = lazy(() =>
  import('../../modules/inventory/pages/InventoryPage').then((module) => ({ default: module.InventoryPage })),
)
const ReportsPage = lazy(() => import('../../modules/reports/pages/ReportsPage').then((module) => ({ default: module.ReportsPage })))
const UsersPage = lazy(() => import('../../modules/users/pages/UsersPage').then((module) => ({ default: module.UsersPage })))
const ProfilePage = lazy(() => import('../../modules/users/pages/ProfilePage').then((module) => ({ default: module.ProfilePage })))
const NotificationsPage = lazy(() =>
  import('../../modules/system/pages/NotificationsPage').then((module) => ({ default: module.NotificationsPage })),
)
const MaintenanceModePage = lazy(() =>
  import('../../modules/system/pages/MaintenanceModePage').then((module) => ({ default: module.MaintenanceModePage })),
)

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
    <Suspense fallback={<div className="p-4 text-sm text-slate-600">Cargando...</div>}>
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
                <RequirePermission module="FLEET" action="view">
                  <MovementsPage />
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
                <RequirePermission module="WORK_ORDERS" action="view">
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
          <Route path="*" element={<Navigate to={ROUTE_PATHS.dashboard} replace />} />
        </Route>
      </Routes>
    </Suspense>
  </BrowserRouter>
)

