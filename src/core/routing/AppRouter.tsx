import type { ReactElement } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from '../layout/AppLayout'
import { ROUTE_PATHS } from './routePaths'
import { AuditsPage } from '../../modules/audits/pages/AuditsPage'
import { DashboardPage } from '../../modules/dashboard/pages/DashboardPage'
import { FleetCreatePage } from '../../modules/fleet/pages/FleetCreatePage'
import { FleetDetailPage } from '../../modules/fleet/pages/FleetDetailPage'
import { FleetEditPage } from '../../modules/fleet/pages/FleetEditPage'
import { FleetListPage } from '../../modules/fleet/pages/FleetListPage'
import { InventoryPage } from '../../modules/inventory/pages/InventoryPage'
import { MaintenancePage } from '../../modules/maintenance/pages/MaintenancePage'
import { RepairsPage } from '../../modules/repairs/pages/RepairsPage'
import { MovementsPage } from '../../modules/movements/pages/MovementsPage'
import { ClientsPage } from '../../modules/clients/pages/ClientsPage'
import { DeliveriesPage } from '../../modules/deliveries/pages/DeliveriesPage'
import { TasksPage } from '../../modules/tasks/pages/TasksPage'
import { WorkOrdersPage } from '../../modules/workOrders/pages/WorkOrdersPage'
import { ExternalRequestsPage } from '../../modules/externalRequests/pages/ExternalRequestsPage'
import { LoginPage } from '../../modules/auth/pages/LoginPage'
import { UsersPage } from '../../modules/users/pages/UsersPage'
import { ReportsPage } from '../../modules/reports/pages/ReportsPage'
import { SuppliersPage } from '../../modules/suppliers/pages/SuppliersPage'
import { ProfilePage } from '../../modules/users/pages/ProfilePage'
import { MaintenanceModePage } from '../../modules/system/pages/MaintenanceModePage'
import { NotificationsPage } from '../../modules/system/pages/NotificationsPage'
import { RequireAuth } from './RequireAuth'
import { RequirePermission } from './RequirePermission'
import { useAppContext } from '../hooks/useAppContext'
import type { FeatureFlags } from '../../types/domain'

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
          path={ROUTE_PATHS.clients}
          element={
            <RequireFeatureFlag flag="showClientsModule">
              <RequirePermission module="FLEET" action="view">
                <ClientsPage />
              </RequirePermission>
            </RequireFeatureFlag>
          }
        />
        <Route
          path={ROUTE_PATHS.deliveries}
          element={
            <RequireFeatureFlag flag="showDeliveriesModule">
              <RequirePermission module="FLEET" action="view">
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
          path={ROUTE_PATHS.suppliers}
          element={
            <RequireFeatureFlag flag="showSuppliersModule">
              <RequirePermission module="REPAIRS" action="view">
                <SuppliersPage />
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
  </BrowserRouter>
)
