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
import { WorkOrdersPage } from '../../modules/workOrders/pages/WorkOrdersPage'
import { ExternalRequestsPage } from '../../modules/externalRequests/pages/ExternalRequestsPage'
import { LoginPage } from '../../modules/auth/pages/LoginPage'
import { UsersPage } from '../../modules/users/pages/UsersPage'
import { ReportsPage } from '../../modules/reports/pages/ReportsPage'
import { ProfilePage } from '../../modules/users/pages/ProfilePage'
import { MaintenanceModePage } from '../../modules/system/pages/MaintenanceModePage'
import { RequireAuth } from './RequireAuth'
import { RequirePermission } from './RequirePermission'

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
            <RequirePermission module="FLEET" action="view">
              <FleetListPage />
            </RequirePermission>
          }
        />
        <Route
          path={ROUTE_PATHS.fleet.create}
          element={
            <RequirePermission module="FLEET" action="create">
              <FleetCreatePage />
            </RequirePermission>
          }
        />
        <Route
          path={ROUTE_PATHS.fleet.edit}
          element={
            <RequirePermission module="FLEET" action="edit">
              <FleetEditPage />
            </RequirePermission>
          }
        />
        <Route
          path={ROUTE_PATHS.fleet.detail}
          element={
            <RequirePermission module="FLEET" action="view">
              <FleetDetailPage />
            </RequirePermission>
          }
        />
        <Route
          path={ROUTE_PATHS.maintenance}
          element={
            <RequirePermission module="MAINTENANCE" action="view">
              <MaintenancePage />
            </RequirePermission>
          }
        />
        <Route
          path={ROUTE_PATHS.audits}
          element={
            <RequirePermission module="AUDITS" action="view">
              <AuditsPage />
            </RequirePermission>
          }
        />
        <Route
          path={ROUTE_PATHS.workOrders}
          element={
            <RequirePermission module="WORK_ORDERS" action="view">
              <WorkOrdersPage />
            </RequirePermission>
          }
        />
        <Route
          path={ROUTE_PATHS.externalRequests}
          element={
            <RequirePermission module="WORK_ORDERS" action="view">
              <ExternalRequestsPage />
            </RequirePermission>
          }
        />
        <Route
          path={ROUTE_PATHS.repairs}
          element={
            <RequirePermission module="REPAIRS" action="view">
              <RepairsPage />
            </RequirePermission>
          }
        />
        <Route
          path={ROUTE_PATHS.inventory}
          element={
            <RequirePermission module="INVENTORY" action="view">
              <InventoryPage />
            </RequirePermission>
          }
        />
        <Route
          path={ROUTE_PATHS.reports}
          element={
            <RequirePermission module="REPORTS" action="view">
              <ReportsPage />
            </RequirePermission>
          }
        />
        <Route
          path={ROUTE_PATHS.users}
          element={
            <RequirePermission module="USERS" action="view">
              <UsersPage />
            </RequirePermission>
          }
        />
        <Route path={ROUTE_PATHS.profile} element={<ProfilePage />} />
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
