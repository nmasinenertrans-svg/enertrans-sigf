import { useEffect, useState } from 'react'
import { apiRequest } from '../../../services/api/apiClient'
import { getQueueItems } from '../../../services/offline/queue'
import { useAppContext } from '../../../core/hooks/useAppContext'
import { BackLink } from '../../../components/shared/BackLink'
import { ROUTE_PATHS } from '../../../core/routing/routePaths'

export const MaintenanceModePage = () => {
  const {
    state: { maintenanceStatus, featureFlags },
    actions: { setMaintenanceStatus, setFeatureFlags, setAppError },
  } = useAppContext()

  const [enabled, setEnabled] = useState(maintenanceStatus.enabled)
  const [message, setMessage] = useState(maintenanceStatus.message)
  const [flags, setFlags] = useState(featureFlags)
  const [isSaving, setIsSaving] = useState(false)
  const [isSavingFlags, setIsSavingFlags] = useState(false)
  const [diagnosticRunning, setDiagnosticRunning] = useState(false)
  const [diagnosticResults, setDiagnosticResults] = useState<
    Array<{ label: string; status: 'ok' | 'error'; detail?: string }>
  >([])

  useEffect(() => {
    const load = async () => {
      try {
        const response = await apiRequest<{ enabled: boolean; message?: string }>('/settings/maintenance')
        setMaintenanceStatus({ enabled: response.enabled, message: response.message ?? '' })
        setEnabled(response.enabled)
        setMessage(response.message ?? '')
        const flagsResponse = await apiRequest<typeof featureFlags>('/settings/features')
        setFeatureFlags({ ...featureFlags, ...flagsResponse })
        setFlags({ ...featureFlags, ...flagsResponse })
      } catch {
        // ignore
      }
    }
    void load()
  }, [setMaintenanceStatus])

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const response = await apiRequest<{ enabled: boolean; message?: string }>('/settings/maintenance', {
        method: 'PUT',
        body: { enabled, message: message.trim() },
      })
      const next = { enabled: response.enabled, message: response.message ?? '' }
      setMaintenanceStatus(next)
      setEnabled(next.enabled)
      setMessage(next.message)
      setAppError(next.enabled ? 'Modo mantenimiento activado.' : 'Modo mantenimiento desactivado.')
    } catch {
      setAppError('No se pudo actualizar el modo mantenimiento.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleSaveFlags = async () => {
    setIsSavingFlags(true)
    try {
      const response = await apiRequest<typeof featureFlags>('/settings/features', {
        method: 'PUT',
        body: flags,
      })
      setFeatureFlags({ ...featureFlags, ...response })
      setFlags({ ...featureFlags, ...response })
      setAppError('Configuración de módulos actualizada.')
    } catch {
      setAppError('No se pudo actualizar la configuración de módulos.')
    } finally {
      setIsSavingFlags(false)
    }
  }

  const runDiagnostics = async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setAppError('Sin conexión. El diagnóstico completo requiere internet.')
      return
    }

    setDiagnosticRunning(true)
    setDiagnosticResults([])
    const results: Array<{ label: string; status: 'ok' | 'error'; detail?: string }> = []

    const pushResult = (label: string, status: 'ok' | 'error', detail?: string) => {
      results.push({ label, status, detail })
      setDiagnosticResults([...results])
    }

    try {
      const health = await fetch(`${import.meta.env.VITE_API_BASE_URL}/health`)
      if (health.ok) {
        pushResult('Backend /health', 'ok')
      } else {
        pushResult('Backend /health', 'error', `Status ${health.status}`)
      }
    } catch (error) {
      pushResult('Backend /health', 'error', String((error as Error)?.message ?? 'Error'))
    }

    try {
      await apiRequest('/settings/maintenance')
      pushResult('Auth + DB (settings)', 'ok')
    } catch (error) {
      pushResult('Auth + DB (settings)', 'error', String((error as Error)?.message ?? 'Error'))
    }

    try {
      await apiRequest('/fleet')
      pushResult('Lectura Flota', 'ok')
    } catch (error) {
      pushResult('Lectura Flota', 'error', String((error as Error)?.message ?? 'Error'))
    }

    try {
      const queueItems = await getQueueItems()
      pushResult('Cola offline', 'ok', `Pendientes: ${queueItems.length}`)
    } catch (error) {
      pushResult('Cola offline', 'error', String((error as Error)?.message ?? 'Error'))
    }

    try {
      const tinyPng =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIW2P8z8BQDwAF/AL+7AfQGQAAAABJRU5ErkJggg=='
      const response = await apiRequest<{ url: string }>('/files/upload', {
        method: 'POST',
        body: {
          fileName: `diagnostic-${Date.now()}.png`,
          contentType: 'image/png',
          dataUrl: tinyPng,
          folder: 'diagnostics',
        },
      })
      pushResult('Storage (upload)', 'ok', response.url)
    } catch (error) {
      pushResult('Storage (upload)', 'error', String((error as Error)?.message ?? 'Error'))
    }

    setDiagnosticRunning(false)
  }

  return (
    <section className="space-y-6">
      <header className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <BackLink to={ROUTE_PATHS.dashboard} label="Volver al inicio" />
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-amber-500">Mantenimiento</p>
          <h2 className="mt-2 text-2xl font-bold text-slate-900">Estado de la aplicación</h2>
          <p className="mt-1 text-sm text-slate-600">
            Solo los usuarios DEV pueden activar o desactivar el mantenimiento global.
          </p>
        </div>
      </header>

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <label className="inline-flex items-center gap-2 text-sm font-semibold text-amber-900">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
              className="h-4 w-4"
            />
            Activar mantenimiento
          </label>
          <button
            type="button"
            onClick={handleSave}
            className="rounded-lg bg-amber-400 px-4 py-2 text-xs font-semibold text-slate-900 hover:bg-amber-500"
            disabled={isSaving}
          >
            {isSaving ? 'Guardando...' : 'Guardar mantenimiento'}
          </button>
        </div>
        <label className="mt-4 flex flex-col gap-2 text-sm font-semibold text-amber-900">
          Mensaje para usuarios
          <textarea
            className="min-h-[110px] rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Ej: La aplicación se encuentra en mantenimiento, contacte con el área de soporte."
          />
        </label>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-800">Panel DEV - Módulos y botones</h3>
        <p className="mt-1 text-xs text-slate-500">Oculta módulos y acciones en producción.</p>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">
            Mostrar botón “Cargar unidad demo”
            <input
              type="checkbox"
              checked={flags.showDemoUnitButton}
              onChange={(event) => setFlags((prev) => ({ ...prev, showDemoUnitButton: event.target.checked }))}
              className="h-4 w-4"
            />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">
            Mostrar módulo Inventario
            <input
              type="checkbox"
              checked={flags.showInventoryModule}
              onChange={(event) => setFlags((prev) => ({ ...prev, showInventoryModule: event.target.checked }))}
              className="h-4 w-4"
            />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">
            Mostrar módulo Reportes
            <input
              type="checkbox"
              checked={flags.showReportsModule}
              onChange={(event) => setFlags((prev) => ({ ...prev, showReportsModule: event.target.checked }))}
              className="h-4 w-4"
            />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">
            Mostrar módulo Notas de pedido externo
            <input
              type="checkbox"
              checked={flags.showExternalRequestsModule}
              onChange={(event) => setFlags((prev) => ({ ...prev, showExternalRequestsModule: event.target.checked }))}
              className="h-4 w-4"
            />
          </label>
        </div>

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={handleSaveFlags}
            className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700"
            disabled={isSavingFlags}
          >
            {isSavingFlags ? 'Guardando...' : 'Guardar configuración'}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-800">Diagnóstico completo</h3>
        <p className="mt-1 text-xs text-slate-500">Prueba backend, auth, base, storage y cola offline.</p>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={runDiagnostics}
            className="rounded-lg bg-amber-400 px-4 py-2 text-xs font-semibold text-slate-900 hover:bg-amber-500"
            disabled={diagnosticRunning}
          >
            {diagnosticRunning ? 'Ejecutando...' : 'Ejecutar diagnóstico'}
          </button>
        </div>

        <div className="mt-4 space-y-2">
          {diagnosticResults.length === 0 ? (
            <p className="text-xs text-slate-500">Sin resultados.</p>
          ) : (
            diagnosticResults.map((item) => (
              <div
                key={`${item.label}-${item.status}`}
                className={[
                  'flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs',
                  item.status === 'ok'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-rose-200 bg-rose-50 text-rose-700',
                ].join(' ')}
              >
                <span className="font-semibold">{item.label}</span>
                <span className="text-[11px]">{item.detail ?? (item.status === 'ok' ? 'OK' : 'Error')}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  )
}
