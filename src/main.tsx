import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import App from './App'
import './index.css'

const sentryDsn = import.meta.env.VITE_SENTRY_DSN || ''
const sentryEnvironment = import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE || 'development'
const sentryRelease = import.meta.env.VITE_SENTRY_RELEASE || undefined
const tracesSampleRate = Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE ?? '0')
const normalizedTracesSampleRate = Number.isFinite(tracesSampleRate) ? tracesSampleRate : 0

Sentry.init({
  dsn: sentryDsn || undefined,
  enabled: Boolean(sentryDsn),
  environment: sentryEnvironment,
  release: sentryRelease,
  tracesSampleRate: normalizedTracesSampleRate,
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={<div>Ocurrio un error inesperado.</div>}>
      <App />
    </Sentry.ErrorBoundary>
  </StrictMode>,
)

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // Hard-disable SW to avoid stale chunk/navigation cache issues in production.
    navigator.serviceWorker
      .getRegistrations()
      .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
      .catch(() => null)

    if ('caches' in window) {
      caches
        .keys()
        .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
        .catch(() => null)
    }
  })
}
