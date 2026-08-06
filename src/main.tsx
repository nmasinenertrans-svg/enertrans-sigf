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

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    // sw.js usa estrategia network-first (ver public/sw.js): nunca sirve un bundle
    // viejo mientras haya conexion, asi que registrar el SW aca no reintroduce el
    // problema de cache stale que forzo a deshabilitarlo antes (commit 5fa7bb2).
    // Lo necesitamos vivo para poder recibir notificaciones push con la app cerrada.
    navigator.serviceWorker.register('/sw.js').catch(() => null)
  })
}

// When a lazy chunk fails after a new deploy, force reload once to pick the new manifest.
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  window.location.reload()
})
