import type { MaintenanceSettings } from '../types'

interface MaintenanceSettingsPanelProps {
  settings: MaintenanceSettings
  onSettingsChange: (settings: MaintenanceSettings) => void
}

const inputClassName =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-colors focus:border-amber-400'

export const MaintenanceSettingsPanel = ({ settings, onSettingsChange }: MaintenanceSettingsPanelProps) => (
  <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
    <header>
      <h3 className="text-lg font-bold text-slate-900">Configuración editable</h3>
      <p className="mt-1 text-sm text-slate-600">Ajustes de alerta y listas por defecto para aceites y filtros.</p>
    </header>

    <div className="mt-5 grid grid-cols-1 gap-4">
      <label className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-slate-700">Umbral por vencer (KM)</span>
        <input
          type="number"
          min={0}
          className={inputClassName}
          value={settings.dueSoonKilometersThreshold}
          onChange={(event) =>
            onSettingsChange({
              ...settings,
              dueSoonKilometersThreshold: Number(event.target.value),
            })
          }
        />
      </label>

      <label className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-slate-700">Umbral por vencer (Horas)</span>
        <input
          type="number"
          min={0}
          className={inputClassName}
          value={settings.dueSoonHoursThreshold}
          onChange={(event) =>
            onSettingsChange({
              ...settings,
              dueSoonHoursThreshold: Number(event.target.value),
            })
          }
        />
      </label>

      <label className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-slate-700">Aceites por defecto (coma)</span>
        <input
          className={inputClassName}
          value={settings.defaultOilList.join(', ')}
          onChange={(event) =>
            onSettingsChange({
              ...settings,
              defaultOilList: event.target.value
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean),
            })
          }
        />
      </label>

      <label className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-slate-700">Filtros por defecto (coma)</span>
        <input
          className={inputClassName}
          value={settings.defaultFilterList.join(', ')}
          onChange={(event) =>
            onSettingsChange({
              ...settings,
              defaultFilterList: event.target.value
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean),
            })
          }
        />
      </label>
    </div>
  </section>
)
