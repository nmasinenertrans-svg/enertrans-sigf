import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import * as Sentry from '@sentry/node'
import { prisma } from './db.js'
import authRoutes from './routes/auth.js'
import usersRoutes from './routes/users.js'
import fleetRoutes from './routes/fleet.js'
import maintenanceRoutes from './routes/maintenance.js'
import auditsRoutes from './routes/audits.js'
import workOrdersRoutes from './routes/workOrders.js'
import repairsRoutes from './routes/repairs.js'
import inventoryRoutes from './routes/inventory.js'
import filesRoutes from './routes/files.js'
import externalRequestsRoutes from './routes/externalRequests.js'
import movementsRoutes from './routes/movements.js'
import tasksRoutes from './routes/tasks.js'
import settingsRoutes from './routes/settings.js'
import profileRoutes from './routes/profile.js'
import { hashPassword } from './utils/password.js'
import { requireAuth } from './middleware/auth.js'
import { requirePermission } from './middleware/permissions.js'
import { maintenanceGuard } from './middleware/maintenance.js'

const sentryDsn = process.env.SENTRY_DSN || ''
const sentryEnvironment = process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development'
const sentryRelease = process.env.SENTRY_RELEASE || undefined
const tracesSampleRate = Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0')
const normalizedTracesSampleRate = Number.isFinite(tracesSampleRate) ? tracesSampleRate : 0

Sentry.init({
  dsn: sentryDsn || undefined,
  enabled: Boolean(sentryDsn),
  environment: sentryEnvironment,
  release: sentryRelease,
  integrations: [Sentry.expressIntegration(), Sentry.prismaIntegration()],
  tracesSampleRate: normalizedTracesSampleRate,
})

const app = express()

app.use(cors())
app.use(express.json({ limit: '50mb' }))
app.use(express.urlencoded({ extended: true, limit: '50mb' }))

app.get('/health', (_req, res) => res.json({ status: 'ok' }))

app.use('/auth', authRoutes)
app.use(maintenanceGuard)

app.use('/settings', requireAuth, settingsRoutes)
app.use('/users/me', requireAuth, profileRoutes)
app.use('/users', requireAuth, requirePermission('USERS', 'view'), usersRoutes)
app.use('/fleet', requireAuth, requirePermission('FLEET', 'view'), fleetRoutes)
app.use('/maintenance', requireAuth, requirePermission('MAINTENANCE', 'view'), maintenanceRoutes)
app.use('/audits', requireAuth, requirePermission('AUDITS', 'view'), auditsRoutes)
app.use('/work-orders', requireAuth, requirePermission('WORK_ORDERS', 'view'), workOrdersRoutes)
app.use('/external-requests', requireAuth, requirePermission('WORK_ORDERS', 'view'), externalRequestsRoutes)
app.use('/repairs', requireAuth, requirePermission('REPAIRS', 'view'), repairsRoutes)
app.use('/inventory', requireAuth, requirePermission('INVENTORY', 'view'), inventoryRoutes)
app.use('/movements', requireAuth, requirePermission('FLEET', 'view'), movementsRoutes)
app.use('/tasks', requireAuth, requirePermission('TASKS', 'view'), tasksRoutes)
app.use('/files', requireAuth, filesRoutes)

Sentry.setupExpressErrorHandler(app)

const ensureDevUser = async () => {
  const count = await prisma.user.count()
  if (count > 0) {
    return
  }

  const passwordHash = await hashPassword('enermasin26')
  await prisma.user.create({
    data: {
      username: 'Nmasin',
      fullName: 'Nicolas Masin',
      role: 'DEV',
      passwordHash,
    },
  })
}

const port = process.env.PORT ? Number(process.env.PORT) : 4000

ensureDevUser()
  .then(() => {
    app.listen(port, () => {
      console.log(`Backend listo en http://localhost:${port}`)
    })

    setInterval(async () => {
      try {
        await prisma.$queryRaw`SELECT 1`
      } catch (error) {
        console.warn('Ping DB fallido:', error)
      }
    }, 5 * 60 * 1000)
  })
  .catch((error) => {
    console.error('Fallo el bootstrap del backend', error)
    process.exit(1)
  })
