import { useState, useCallback, useMemo } from 'react'
import { useAppContext } from '../../../core/hooks/useAppContext'
import { usePermissions } from '../../../core/auth/usePermissions'
import { useAsyncLoader } from '../../../core/hooks/useAsyncLoader'
import { BackLink } from '../../../components/shared/BackLink'
import { ROUTE_PATHS } from '../../../core/routing/routePaths'
import type { PostventaEvent, WorkOrder } from '../../../types/domain'
import { apiRequest } from '../../../services/api/apiClient'
import { fetchEvents, createEvent, updateEvent, deleteEvent } from '../services/postventaService'

// ─── date helpers ────────────────────────────────────────────────────────────

const toDateStr = (d: Date): string => d.toISOString().split('T')[0]
const parseDate = (s: string): Date => new Date(`${s}T12:00:00`)
const addDays = (d: Date, n: number): Date => { const r = new Date(d); r.setDate(r.getDate() + n); return r }
const diffDays = (a: Date, b: Date): number =>
  Math.round((b.getTime() - a.getTime()) / 86400000)

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

function buildCalendarWeeks(year: number, month: number): Date[][] {
  // month: 0-based
  const firstDay = new Date(year, month, 1)
  // week starts on Monday (1); Sunday = 0 → shift
  const startOffset = (firstDay.getDay() + 6) % 7
  const start = addDays(firstDay, -startOffset)
  const weeks: Date[][] = []
  let cur = start
  while (weeks.length < 6) {
    const week: Date[] = []
    for (let i = 0; i < 7; i++) { week.push(new Date(cur)); cur = addDays(cur, 1) }
    weeks.push(week)
    if (cur.getMonth() > month && cur.getFullYear() >= year) break
    if (weeks.length === 6) break
  }
  return weeks
}

// ─── event layout ─────────────────────────────────────────────────────────────

interface EventPosition {
  event: PostventaEvent
  lane: number
  startCol: number
  endCol: number
  continuesBefore: boolean
  continuesAfter: boolean
}

function computeWeekPositions(weekDays: Date[], events: PostventaEvent[]): EventPosition[] {
  const weekStart = weekDays[0]
  const weekEnd = weekDays[6]

  const overlapping = events.filter((e) => {
    const s = parseDate(e.startDate)
    const end = e.endDate ? parseDate(e.endDate) : s
    return s <= weekEnd && end >= weekStart
  })

  overlapping.sort((a, b) => {
    const as = parseDate(a.startDate).getTime()
    const bs = parseDate(b.startDate).getTime()
    if (as !== bs) return as - bs
    const ae = (a.endDate ? parseDate(a.endDate) : parseDate(a.startDate)).getTime()
    const be = (b.endDate ? parseDate(b.endDate) : parseDate(b.startDate)).getTime()
    return be - ae
  })

  const laneLastCol: number[] = []
  const positions: EventPosition[] = []

  for (const event of overlapping) {
    const s = parseDate(event.startDate)
    const end = event.endDate ? parseDate(event.endDate) : s
    const startCol = Math.max(0, diffDays(weekStart, s))
    const endCol = Math.min(6, diffDays(weekStart, end))

    let lane = 0
    while (laneLastCol[lane] !== undefined && laneLastCol[lane] >= startCol) lane++
    laneLastCol[lane] = endCol

    positions.push({
      event,
      lane,
      startCol,
      endCol,
      continuesBefore: s < weekStart,
      continuesAfter: end > weekEnd,
    })
  }
  return positions
}

// ─── color map ────────────────────────────────────────────────────────────────

const COLOR_BG: Record<string, string> = {
  amber: 'bg-amber-400 text-slate-900',
  sky: 'bg-sky-500 text-white',
  emerald: 'bg-emerald-500 text-white',
  rose: 'bg-rose-500 text-white',
  violet: 'bg-violet-500 text-white',
  slate: 'bg-slate-500 text-white',
}
const COLOR_OPTIONS = Object.keys(COLOR_BG)
const COLOR_LABELS: Record<string, string> = { amber: 'Amarillo', sky: 'Celeste', emerald: 'Verde', rose: 'Rojo', violet: 'Violeta', slate: 'Gris' }

const LANE_H = 24
const DAY_H = 32

// ─── main component ──────────────────────────────────────────────────────────

interface EventForm {
  title: string
  startDate: string
  endDate: string
  notes: string
  vehicleMode: 'fleet' | 'external'
  unitId: string
  externalVehicle: string
  workOrderId: string
  color: string
}

const emptyForm = (date?: string): EventForm => ({
  title: '',
  startDate: date ?? toDateStr(new Date()),
  endDate: '',
  notes: '',
  vehicleMode: 'fleet',
  unitId: '',
  externalVehicle: '',
  workOrderId: '',
  color: 'amber',
})

export const PostventaPage = () => {
  const { can } = usePermissions()
  const { state: { fleetUnits }, actions: { setAppError } } = useAppContext()

  const [events, setEvents] = useState<PostventaEvent[]>([])
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([])

  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())

  const [showForm, setShowForm] = useState(false)
  const [editingEvent, setEditingEvent] = useState<PostventaEvent | null>(null)
  const [form, setForm] = useState<EventForm>(emptyForm())
  const [saving, setSaving] = useState(false)

  const [selectedEvent, setSelectedEvent] = useState<PostventaEvent | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const canEdit = can('POSTVENTA', 'edit')
  const canDelete = can('POSTVENTA', 'delete')

  // date range for the visible calendar grid
  const weeks = useMemo(() => buildCalendarWeeks(year, month), [year, month])
  const rangeFrom = useMemo(() => toDateStr(weeks[0][0]), [weeks])
  const rangeTo = useMemo(() => toDateStr(weeks[weeks.length - 1][6]), [weeks])

  const load = useCallback(async (getMounted: () => boolean) => {
    if (!can('POSTVENTA', 'view')) return
    try {
      const [evts, wos] = await Promise.all([
        fetchEvents(rangeFrom, rangeTo),
        apiRequest<WorkOrder[]>('/work-orders'),
      ])
      if (!getMounted()) return
      setEvents(Array.isArray(evts) ? evts : [])
      setWorkOrders(Array.isArray(wos) ? wos.filter((w) => w.status !== 'CLOSED') : [])
    } catch {
      setAppError('Error al cargar calendario')
    }
  }, [can, rangeFrom, rangeTo, setAppError])

  const { isLoading } = useAsyncLoader(load, [load])

  const prevMonth = () => { if (month === 0) { setYear(y => y - 1); setMonth(11) } else setMonth(m => m - 1) }
  const nextMonth = () => { if (month === 11) { setYear(y => y + 1); setMonth(0) } else setMonth(m => m + 1) }

  const openCreate = (date?: string) => {
    setEditingEvent(null)
    setForm(emptyForm(date))
    setShowForm(true)
    setSelectedEvent(null)
  }

  const openEdit = (ev: PostventaEvent) => {
    setEditingEvent(ev)
    setForm({
      title: ev.title,
      startDate: ev.startDate,
      endDate: ev.endDate ?? '',
      notes: ev.notes,
      vehicleMode: ev.unitId ? 'fleet' : 'external',
      unitId: ev.unitId ?? '',
      externalVehicle: ev.externalVehicle ?? '',
      workOrderId: ev.workOrderId ?? '',
      color: ev.color,
    })
    setShowForm(true)
    setSelectedEvent(null)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title.trim() || !form.startDate) return
    setSaving(true)
    const payload = {
      title: form.title.trim(),
      startDate: form.startDate,
      endDate: form.endDate || null,
      notes: form.notes.trim(),
      unitId: form.vehicleMode === 'fleet' ? form.unitId || null : null,
      externalVehicle: form.vehicleMode === 'external' ? form.externalVehicle.trim() || null : null,
      workOrderId: form.workOrderId || null,
      color: form.color,
    }
    try {
      if (editingEvent) {
        const updated = await updateEvent(editingEvent.id, payload)
        setEvents(prev => prev.map(ev => ev.id === updated.id ? updated : ev))
      } else {
        const created = await createEvent(payload)
        setEvents(prev => [...prev, created])
      }
      setShowForm(false)
      setEditingEvent(null)
    } catch {
      setAppError('Error al guardar evento')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    setDeleting(true)
    try {
      await deleteEvent(id)
      setEvents(prev => prev.filter(ev => ev.id !== id))
      setSelectedEvent(null)
      setConfirmDeleteId(null)
    } catch {
      setAppError('Error al eliminar evento')
    } finally {
      setDeleting(false)
    }
  }

  const todayStr = toDateStr(today)

  return (
    <section className="space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <BackLink to={ROUTE_PATHS.dashboard} label="Inicio" />
          <h2 className="text-2xl font-bold text-slate-900">Postventa</h2>
          <p className="mt-1 text-sm text-slate-500">Calendario de reparaciones y servicios</p>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={() => openCreate()}
            className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-500"
          >
            + Nuevo evento
          </button>
        )}
      </header>

      {/* Month nav */}
      <div className="flex items-center gap-3">
        <button type="button" onClick={prevMonth} className="rounded-lg border border-slate-300 p-2 hover:bg-slate-50">
          <span className="text-slate-600">‹</span>
        </button>
        <h3 className="min-w-[180px] text-center text-lg font-bold text-slate-900">
          {MONTHS[month]} {year}
        </h3>
        <button type="button" onClick={nextMonth} className="rounded-lg border border-slate-300 p-2 hover:bg-slate-50">
          <span className="text-slate-600">›</span>
        </button>
        <button
          type="button"
          onClick={() => { setYear(today.getFullYear()); setMonth(today.getMonth()) }}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
        >
          Hoy
        </button>
      </div>

      <div className="flex gap-5">
        {/* Calendar */}
        <div className="min-w-0 flex-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {/* Day headers */}
          <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
            {WEEKDAYS.map((d) => (
              <div key={d} className="py-2 text-center text-xs font-semibold uppercase tracking-wide text-slate-500">
                {d}
              </div>
            ))}
          </div>

          {isLoading ? (
            <div className="py-20 text-center text-sm text-slate-400">Cargando...</div>
          ) : (
            weeks.map((week, wi) => {
              const positions = computeWeekPositions(week, events)
              const laneCount = positions.length > 0 ? Math.max(...positions.map(p => p.lane)) + 1 : 0
              const rowHeight = Math.max(80, DAY_H + laneCount * LANE_H + 8)

              return (
                <div
                  key={wi}
                  className="relative border-b border-slate-200 last:border-b-0"
                  style={{ height: rowHeight }}
                >
                  {/* Day cells */}
                  <div className="absolute inset-x-0 top-0 grid h-8 grid-cols-7">
                    {week.map((day, di) => {
                      const ds = toDateStr(day)
                      const isToday = ds === todayStr
                      const isCurrentMonth = day.getMonth() === month
                      return (
                        <div
                          key={di}
                          className={`flex cursor-pointer items-start justify-end border-r border-slate-100 px-1.5 pt-1 last:border-r-0 hover:bg-slate-50 ${!isCurrentMonth ? 'opacity-40' : ''}`}
                          onClick={() => canEdit && openCreate(ds)}
                        >
                          <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${isToday ? 'bg-amber-400 text-slate-900' : 'text-slate-600'}`}>
                            {day.getDate()}
                          </span>
                        </div>
                      )
                    })}
                  </div>

                  {/* Vertical dividers */}
                  <div className="pointer-events-none absolute inset-0 grid grid-cols-7">
                    {week.map((_, i) => (
                      <div key={i} className="border-r border-slate-100 last:border-r-0" />
                    ))}
                  </div>

                  {/* Events */}
                  {positions.map(({ event, lane, startCol, endCol, continuesBefore, continuesAfter }) => {
                    const colorCls = COLOR_BG[event.color] ?? COLOR_BG.amber
                    const leftPct = startCol / 7 * 100
                    const widthPct = (endCol - startCol + 1) / 7 * 100
                    return (
                      <button
                        key={event.id}
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setSelectedEvent(event); setShowForm(false) }}
                        className={`absolute flex items-center truncate rounded px-1.5 text-xs font-semibold shadow-sm hover:opacity-90 ${colorCls} ${continuesBefore ? 'rounded-l-none' : ''} ${continuesAfter ? 'rounded-r-none' : ''}`}
                        style={{
                          top: DAY_H + lane * LANE_H + 2,
                          left: `calc(${leftPct}% + 2px)`,
                          width: `calc(${widthPct}% - 4px)`,
                          height: LANE_H - 4,
                        }}
                      >
                        {continuesBefore && <span className="mr-1 opacity-70">«</span>}
                        <span className="truncate">{event.title}</span>
                        {continuesAfter && <span className="ml-1 opacity-70">»</span>}
                      </button>
                    )
                  })}
                </div>
              )
            })
          )}
        </div>

        {/* Side panel: detail or form */}
        {(selectedEvent || showForm) && (
          <div className="w-80 shrink-0">
            {/* Event detail */}
            {selectedEvent && !showForm && (
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className={`h-3 w-3 rounded-full ${selectedEvent.color === 'amber' ? 'bg-amber-400' : `bg-${selectedEvent.color}-500`}`} />
                    <h3 className="font-bold text-slate-900 leading-tight">{selectedEvent.title}</h3>
                  </div>
                  <button type="button" onClick={() => setSelectedEvent(null)} className="text-slate-400 hover:text-slate-600">✕</button>
                </div>

                <dl className="space-y-2 text-sm">
                  <div>
                    <dt className="text-xs font-semibold text-slate-500">Fechas</dt>
                    <dd className="text-slate-800">
                      {selectedEvent.startDate}
                      {selectedEvent.endDate && selectedEvent.endDate !== selectedEvent.startDate
                        ? ` → ${selectedEvent.endDate}`
                        : ''}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold text-slate-500">Vehículo</dt>
                    <dd className="text-slate-800">
                      {selectedEvent.unitLabel ?? selectedEvent.externalVehicle ?? '—'}
                      {!selectedEvent.unitId && selectedEvent.externalVehicle && (
                        <span className="ml-1 rounded-full border border-sky-300 bg-sky-50 px-1.5 py-0.5 text-xs text-sky-700">Externo</span>
                      )}
                    </dd>
                  </div>
                  {selectedEvent.workOrderId && (
                    <div>
                      <dt className="text-xs font-semibold text-slate-500">OT vinculada</dt>
                      <dd className="text-slate-800">
                        {workOrders.find(w => w.id === selectedEvent.workOrderId)?.code ?? selectedEvent.workOrderId}
                      </dd>
                    </div>
                  )}
                  {selectedEvent.notes && (
                    <div>
                      <dt className="text-xs font-semibold text-slate-500">Notas</dt>
                      <dd className="text-slate-700 whitespace-pre-line">{selectedEvent.notes}</dd>
                    </div>
                  )}
                  <div>
                    <dt className="text-xs font-semibold text-slate-500">Creado por</dt>
                    <dd className="text-slate-600">{selectedEvent.createdByUserName}</dd>
                  </div>
                </dl>

                {(canEdit || canDelete) && (
                  <div className="flex gap-2 pt-1 border-t border-slate-100">
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => openEdit(selectedEvent)}
                        className="flex-1 rounded-lg border border-slate-300 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Editar
                      </button>
                    )}
                    {canDelete && confirmDeleteId !== selectedEvent.id && (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(selectedEvent.id)}
                        className="flex-1 rounded-lg border border-rose-300 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50"
                      >
                        Eliminar
                      </button>
                    )}
                    {canDelete && confirmDeleteId === selectedEvent.id && (
                      <button
                        type="button"
                        disabled={deleting}
                        onClick={() => void handleDelete(selectedEvent.id)}
                        className="flex-1 rounded-lg bg-rose-500 py-1.5 text-xs font-semibold text-white hover:bg-rose-600 disabled:opacity-50"
                      >
                        {deleting ? 'Eliminando...' : 'Confirmar'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Event form */}
            {showForm && (
              <form onSubmit={(e) => void handleSave(e)} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-slate-900">{editingEvent ? 'Editar evento' : 'Nuevo evento'}</h3>
                  <button type="button" onClick={() => { setShowForm(false); setEditingEvent(null) }} className="text-slate-400 hover:text-slate-600">✕</button>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">Título *</label>
                  <input
                    value={form.title}
                    onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))}
                    placeholder="Ej: Reparación AC820SB"
                    autoFocus
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-amber-400"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">Inicio *</label>
                    <input
                      type="date"
                      value={form.startDate}
                      onChange={(e) => setForm(f => ({ ...f, startDate: e.target.value }))}
                      className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm outline-none focus:border-amber-400"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">Fin (opcional)</label>
                    <input
                      type="date"
                      value={form.endDate}
                      min={form.startDate}
                      onChange={(e) => setForm(f => ({ ...f, endDate: e.target.value }))}
                      className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm outline-none focus:border-amber-400"
                    />
                  </div>
                </div>

                {/* Vehicle toggle */}
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">Vehículo</label>
                  <div className="mb-2 flex gap-1">
                    {(['fleet', 'external'] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setForm(f => ({ ...f, vehicleMode: mode }))}
                        className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${form.vehicleMode === mode ? 'border-amber-400 bg-amber-400 text-slate-900' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'}`}
                      >
                        {mode === 'fleet' ? 'Flota' : 'Externo'}
                      </button>
                    ))}
                  </div>
                  {form.vehicleMode === 'fleet' ? (
                    <select
                      value={form.unitId}
                      onChange={(e) => setForm(f => ({ ...f, unitId: e.target.value }))}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-amber-400"
                    >
                      <option value="">Sin unidad específica</option>
                      {fleetUnits.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.brand} {u.model} — {u.internalCode}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={form.externalVehicle}
                      onChange={(e) => setForm(f => ({ ...f, externalVehicle: e.target.value }))}
                      placeholder="Ej: Ford F-100 — dominio ABC123"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-amber-400"
                    />
                  )}
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">OT vinculada (opcional)</label>
                  <select
                    value={form.workOrderId}
                    onChange={(e) => setForm(f => ({ ...f, workOrderId: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-amber-400"
                  >
                    <option value="">Sin OT</option>
                    {workOrders.map((wo) => (
                      <option key={wo.id} value={wo.id}>{wo.code}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">Notas</label>
                  <textarea
                    rows={3}
                    value={form.notes}
                    onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))}
                    placeholder="Tipo de reparación, detalles..."
                    className="w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-amber-400"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">Color</label>
                  <div className="flex gap-2">
                    {COLOR_OPTIONS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        title={COLOR_LABELS[c]}
                        onClick={() => setForm(f => ({ ...f, color: c }))}
                        className={`h-6 w-6 rounded-full transition-transform ${c === 'amber' ? 'bg-amber-400' : `bg-${c}-500`} ${form.color === c ? 'scale-125 ring-2 ring-offset-1 ring-slate-400' : 'hover:scale-110'}`}
                      />
                    ))}
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={saving || !form.title.trim() || !form.startDate}
                  className="w-full rounded-lg bg-amber-400 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-500 disabled:opacity-50"
                >
                  {saving ? 'Guardando...' : editingEvent ? 'Guardar cambios' : 'Crear evento'}
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
