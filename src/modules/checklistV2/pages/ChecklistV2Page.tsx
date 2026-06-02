import { useState } from 'react'
import { BackLink } from '../../../components/shared/BackLink'
import { ROUTE_PATHS } from '../../../core/routing/routePaths'

// ─── Types ───────────────────────────────────────────────────────────────────

type CheckStatus = 'B' | 'R' | 'RV' | 'C' | 'NA' | 'O' | 'F' | ''

interface ItemState {
  entrega: CheckStatus
  recibe: CheckStatus
  obs: string
}

const STATUS_OPTIONS: { value: CheckStatus; label: string; color: string }[] = [
  { value: 'B', label: 'B', color: 'bg-emerald-500 text-white' },
  { value: 'R', label: 'R', color: 'bg-rose-500 text-white' },
  { value: 'RV', label: 'RV', color: 'bg-amber-400 text-slate-900' },
  { value: 'C', label: 'C', color: 'bg-orange-500 text-white' },
  { value: 'NA', label: 'NA', color: 'bg-slate-400 text-white' },
  { value: 'O', label: 'O', color: 'bg-sky-500 text-white' },
  { value: 'F', label: 'F', color: 'bg-red-700 text-white' },
]

const STATUS_LABEL: Record<string, string> = {
  B: 'Bien', R: 'Reparar', RV: 'Revisar', C: 'Cambiar', NA: 'No Aplica', O: 'Observación', F: 'Falta',
}

// ─── Checklist data ──────────────────────────────────────────────────────────

interface CheckItem { code: string; desc: string }
interface CheckSection { name: string; items: CheckItem[] }

const HIDROGUA_SECTIONS: CheckSection[] = [
  {
    name: 'PLUMA',
    items: [
      { code: 'C-01', desc: 'Ausencia de golpes severos, torceduras o rajaduras' },
      { code: 'C-02', desc: 'Suavidad del accionamiento hidráulico de todos sus tramos' },
      { code: 'C-03', desc: 'Cartelería de modelo, marca, carga máxima y certificación vigente' },
      { code: 'C-04', desc: 'Ausencia de rajaduras, deformaciones significativas y/o desgastes excesivos' },
      { code: 'C-05', desc: 'Seguro y resorte en buen estado y funcionando correctamente' },
    ],
  },
  {
    name: 'GANCHO',
    items: [
      { code: 'C-06', desc: 'Sin marcas de modificación o reparación, amolado, soldadura, pintura nueva' },
      { code: 'C-07', desc: 'Funcionamiento adecuado de crapodina, giro con carga sin trabarse' },
      { code: 'C-08', desc: 'Presencia de precinto de certificación de Gancho y Grilletes' },
      { code: 'C-09', desc: 'Marca, Modelo, Capacidad, en relieve legibles y en buen estado' },
    ],
  },
  {
    name: 'CILINDROS HIDRÁULICOS',
    items: [
      { code: 'C-10', desc: 'Ausencia de pérdida de aceite hidráulico, estado de empaquetadura y buje' },
      { code: 'C-11', desc: 'Pernos, seguros, Alemites, ruidos o golpes cuando opera' },
      { code: 'C-12', desc: 'Horquilla sin rajaduras, deformaciones, o reparaciones sin certificar' },
      { code: 'C-13', desc: 'Vástagos Rectos, sin deformaciones, golpes o rayones visibles' },
      { code: 'C-14', desc: 'Válvula de Seguridad, No se baja el Pistón solo, sin pérdidas o golpes' },
    ],
  },
  {
    name: 'SUPERESTRUCTURA GIRATORIA',
    items: [
      { code: 'C-15', desc: 'Suavidad en el movimiento' },
      { code: 'C-16', desc: 'Ausencia de ruidos de cremallera o crapodina cuando opera, engrase' },
      { code: 'C-17', desc: 'Pérdidas de aceite en Cremalleras o base de la estructura' },
    ],
  },
  {
    name: 'ESTABILIZADORES',
    items: [
      { code: 'C-18', desc: 'Se extienden correctamente al 100%, poseen marca de final de carrera' },
      { code: 'C-19', desc: 'Sin Golpes, Pérdidas, Rajaduras o marcas de reparación sin certificar' },
      { code: 'C-20', desc: 'Placas de expansión adecuadas al equipo en capacidad y cantidad' },
      { code: 'C-21', desc: 'Nivel de burbuja para estabilizar correctamente' },
    ],
  },
  {
    name: 'CHASIS, ANCLAJE, COMANDOS, MANGUERAS Y ACCESORIOS',
    items: [
      { code: 'C-22', desc: 'Chasis sin Rajaduras o Deformaciones, Anclaje de Equipo Ajustado' },
      { code: 'C-23', desc: 'Suavidad de accionamiento, Nivel de firmeza, posición adecuada' },
      { code: 'C-24', desc: 'Nivel de aceite, visor, fugas en Mangueras, acoples, tapa del Depósito' },
      { code: 'C-25', desc: 'Iluminación auxiliar, adecuada en cantidad y calidad' },
      { code: 'C-26', desc: 'Extintor, estado, anclaje adecuado — Tipo/Cap/Venc' },
      { code: 'C-27', desc: 'Tabla de carga, cartelería de advertencia del Riesgo' },
      { code: 'C-28', desc: 'Alarma indicadora de accionamiento de Hidrogrúa' },
    ],
  },
  {
    name: 'OTROS',
    items: [
      { code: 'C-29', desc: 'Especificar:' },
    ],
  },
]

const CAMION_ITEMS: CheckItem[] = [
  { code: 'A-01', desc: 'Nivel de Aceite' },
  { code: 'A-02', desc: 'Nivel de Líquido de Freno' },
  { code: 'A-03', desc: 'Nivel de Refrigerante/Anticongelante' },
  { code: 'A-04', desc: 'Nivel de Líquido de Dirección' },
  { code: 'A-05', desc: 'Motor — Pérdidas' },
  { code: 'A-06', desc: 'Faros Luz (Alta / Baja / Posición)' },
  { code: 'A-07', desc: 'Luces de Guiños (Delanteros / Traseros)' },
  { code: 'A-08', desc: 'Luces Stop / Luz y Alarma de Retroceso' },
  { code: 'A-09', desc: 'Bandas Retroreflectivas / Vel. Máxima' },
  { code: 'A-10', desc: 'Tapa del Tanque de Combustible' },
  { code: 'A-11', desc: 'Dirección / Tren Delantero / Amortiguación' },
  { code: 'A-12', desc: 'Parabrisas (Marcar desvío en Chequeo Visual)' },
  { code: 'A-13', desc: 'Limpiaparabrisas (Escobilla / Zorrino)' },
  { code: 'A-14', desc: 'Ventanas / Estado / Funcionamiento / Cierre' },
  { code: 'A-15', desc: 'Batería, Estado, Anclaje, Protección Externa' },
  { code: 'A-16', desc: 'Espejos / Estado / Cantidad / Funcionamiento' },
  { code: 'A-17', desc: 'Chapa de Patente Visible Del. y Post.' },
  { code: 'A-18', desc: 'Identificación Empresa / Logo / Nº Interno' },
  { code: 'A-19', desc: 'Cortinas / Estado / Cantidad / Limpieza' },
  { code: 'A-20', desc: 'Bloqueo de Diferencial / Freno de Motor' },
  { code: 'A-21', desc: 'Luces Interior (Tablero / Cabina)' },
  { code: 'A-22', desc: 'Parasoles / Estado / Cantidad' },
  { code: 'A-23', desc: 'Indicador de Combustible (Tablero)' },
  { code: 'A-24', desc: 'Asientos / Apoyacabezas' },
  { code: 'A-25', desc: 'Cinturones de Seguridad Chofer/Acomp.' },
  { code: 'A-26', desc: 'Bocina' },
  { code: 'A-27', desc: 'Velocímetro / Odómetro' },
  { code: 'A-28', desc: 'Calefacción / Aire Acondicionado' },
  { code: 'A-29', desc: 'Toma de Aire Interna / Pistola Sopletear' },
  { code: 'A-30', desc: 'Reflectores Traseros Auxiliares / Cantidad / Estado' },
  { code: 'A-31', desc: 'Busca Huellas / Rompe Niebla' },
  { code: 'A-32', desc: 'Criques, Llaves — Tacos — Balizas Reglamentarias' },
  { code: 'A-33', desc: 'Puertas / Cerradura' },
  { code: 'A-34', desc: 'Estado de Limpieza Interior' },
  { code: 'A-35', desc: 'Sistema de Frenos / Freno de Mano' },
  { code: 'A-36', desc: 'Botiquín Prim. Auxilios / Chaleco Reflectivo' },
  { code: 'A-37', desc: 'Extintores 1 kg — 5 kg — 10 kg Vencimiento' },
  { code: 'A-38', desc: 'Fijación de Extintor dentro de Cabina' },
  { code: 'A-39', desc: 'Equipo de Radio (Funcionamiento)' },
  { code: 'A-40', desc: 'Paragolpes (Delantero / Traseros)' },
  { code: 'A-41', desc: 'Tacógrafo / Funcionamiento / Modelo' },
  { code: 'A-42', desc: 'Barra de Remolque / Perno de Remolque' },
  { code: 'A-43', desc: 'Diferencial / Pérdidas / Temperatura / Ruidos' },
  { code: 'A-44', desc: 'Cardán / Crucetas / Manchón Centro Cardán' },
  { code: 'A-45', desc: 'Alineación y Balanceo' },
  { code: 'A-46', desc: 'Estado de Cubiertas' },
  { code: 'A-47', desc: 'Rueda de Auxilio / Soporte Rueda de Auxilio' },
  { code: 'A-48', desc: 'Espárragos y Tuercas de Ruedas' },
  { code: 'A-49', desc: 'Plato de Enganche / Tijera' },
  { code: 'A-50', desc: 'Llave de Cabina / Crique / Traba de Cabina' },
  { code: 'A-51', desc: 'Toma de Aire Externa' },
  { code: 'A-52', desc: 'Estado de Mangueras y Acoples de Aire' },
  { code: 'A-53', desc: 'Estado del Pulmón Aire de Freno (Fuelle)' },
  { code: 'A-54', desc: 'Cadena Cond. Climáticas Adversas Fís./Líq.' },
  { code: 'A-55', desc: 'Caja de Herramientas del Equipo' },
  { code: 'A-56', desc: 'Grasera' },
  { code: 'A-57', desc: 'Bomba de Toma de Fuerza' },
  { code: 'A-58', desc: 'Estado Mangueras Hidráulicas / Fugas' },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

const initItems = (codes: string[]): Record<string, ItemState> =>
  Object.fromEntries(codes.map((c) => [c, { entrega: '', recibe: '', obs: '' }]))

const allHidroguaCodes = HIDROGUA_SECTIONS.flatMap((s) => s.items.map((i) => i.code))
const allCamionCodes = CAMION_ITEMS.map((i) => i.code)

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatusPicker({ value, onChange }: { value: CheckStatus; onChange: (v: CheckStatus) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {STATUS_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(value === opt.value ? '' : opt.value)}
          title={STATUS_LABEL[opt.value]}
          className={`rounded px-1.5 py-0.5 text-xs font-bold transition-opacity ${opt.color} ${value === opt.value ? 'opacity-100 ring-2 ring-offset-1 ring-slate-400' : 'opacity-40 hover:opacity-80'}`}
        >
          {opt.value}
        </button>
      ))}
    </div>
  )
}

function FieldInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <label className="text-xs font-semibold text-slate-500">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-amber-400"
      />
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export const ChecklistV2Page = () => {
  const [type, setType] = useState<'hidrogua' | 'camion'>('hidrogua')

  // Header fields
  const [header, setHeader] = useState({
    fecha: '',
    dominio: '',
    nroUnidad: '',
    tipoMarcaModelo: '',
    horasTrabajo: '',
    kilometraje: '',
    choferEntrega: '',
    choferRecibe: '',
    ultimoService: '',
    proximoService: '',
    contratadoPor: '',
  })

  // Camion docs
  const [docs, setDocs] = useState({
    tarjetaVerde: '', tarjetaVerdeVenc: '',
    cedulaTransporte: '', cedulaTransporteVenc: '',
    permisosEspeciales: '', permisosEspecialesVenc: '',
    ruta: '', rutaVenc: '',
    seguro: '', seguroNroPol: '', seguroVenc: '',
    patente: '', patenteVenc: '',
    vtv: '', vtvVenc: '',
    docChofer: '', docChoferCat: '', docChoferVenc: '',
  })

  // Hidrogua certs
  const [certs, setCerts] = useState({
    ent1: '', entVenc1: '', entNro1: '', entCap1: '',
    rec1: '', recVenc1: '', recNro1: '', recCap1: '',
    izajeAnioModelo: '', izajeManual: '', izajeNroCertVenc: '',
    izajeNroSerie: '', izajeEnteCert: '', izajeCapMax: '',
  })

  // Item states
  const [hidroItems, setHidroItems] = useState<Record<string, ItemState>>(() => initItems(allHidroguaCodes))
  const [camionItems, setCamionItems] = useState<Record<string, ItemState>>(() => initItems(allCamionCodes))

  const [obsGenerales, setObsGenerales] = useState('')

  const updateHidro = (code: string, field: keyof ItemState, val: string) =>
    setHidroItems((prev) => ({ ...prev, [code]: { ...prev[code], [field]: val } }))
  const updateCamion = (code: string, field: keyof ItemState, val: string) =>
    setCamionItems((prev) => ({ ...prev, [code]: { ...prev[code], [field]: val } }))

  const items = type === 'hidrogua' ? hidroItems : camionItems
  const update = type === 'hidrogua' ? updateHidro : updateCamion

  return (
    <section className="space-y-5 pb-10">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <BackLink to={ROUTE_PATHS.dashboard} label="Inicio" />
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold text-slate-900">Check List Vehicular</h2>
            <span className="rounded-full border border-amber-400 bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-700">BETA</span>
          </div>
          <p className="mt-1 text-sm text-slate-500">Vista previa del nuevo formulario de inspección vehicular</p>
        </div>
      </div>

      {/* Type selector */}
      <div className="flex gap-2">
        {(['hidrogua', 'camion'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setType(t)}
            className={`rounded-lg border px-4 py-2 text-sm font-semibold transition-colors ${type === t ? 'border-amber-400 bg-amber-400 text-slate-900' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'}`}
          >
            {t === 'hidrogua' ? 'Hidrogrúas' : 'Camión'}
          </button>
        ))}
      </div>

      {/* ── Header fields ── */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-4 font-bold text-slate-900">Datos del formulario</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <FieldInput label="Fecha" value={header.fecha} onChange={(v) => setHeader((h) => ({ ...h, fecha: v }))} placeholder="DD/MM/AAAA" />
          <FieldInput label="Dominio" value={header.dominio} onChange={(v) => setHeader((h) => ({ ...h, dominio: v }))} />
          <FieldInput label="Nº Unidad" value={header.nroUnidad} onChange={(v) => setHeader((h) => ({ ...h, nroUnidad: v }))} />
          <FieldInput label={type === 'hidrogua' ? 'Tipo, Marca y Modelo' : 'Tipo de Vehículo / Marca'} value={header.tipoMarcaModelo} onChange={(v) => setHeader((h) => ({ ...h, tipoMarcaModelo: v }))} />
          <FieldInput label={type === 'hidrogua' ? 'Horas de Trabajo' : 'Kilometraje'} value={type === 'hidrogua' ? header.horasTrabajo : header.kilometraje} onChange={(v) => setHeader((h) => type === 'hidrogua' ? { ...h, horasTrabajo: v } : { ...h, kilometraje: v })} />
          <FieldInput label={type === 'hidrogua' ? 'Fecha/Horas Último Service' : 'Fecha/Km Último Service'} value={header.ultimoService} onChange={(v) => setHeader((h) => ({ ...h, ultimoService: v }))} />
          <FieldInput label={type === 'hidrogua' ? 'Fecha/Horas Próximo Service' : 'Fecha/Km Próximo Service'} value={header.proximoService} onChange={(v) => setHeader((h) => ({ ...h, proximoService: v }))} />
          <FieldInput label="Chofer que Entrega Unidad" value={header.choferEntrega} onChange={(v) => setHeader((h) => ({ ...h, choferEntrega: v }))} />
          <FieldInput label="Chofer que Recibe Unidad" value={header.choferRecibe} onChange={(v) => setHeader((h) => ({ ...h, choferRecibe: v }))} />
          <FieldInput label="Contratado Por" value={header.contratadoPor} onChange={(v) => setHeader((h) => ({ ...h, contratadoPor: v }))} />
        </div>
      </div>

      {/* ── Hidrogua: certifications ── */}
      {type === 'hidrogua' && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="mb-4 font-bold text-slate-900">Certificaciones</h3>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {[
              { label: 'Entrega', prefix: 'ent1', vencKey: 'entVenc1', nroKey: 'entNro1', capKey: 'entCap1' },
              { label: 'Recibe', prefix: 'rec1', vencKey: 'recVenc1', nroKey: 'recNro1', capKey: 'recCap1' },
            ].map(({ label, vencKey, nroKey, capKey }) => (
              <div key={label} className="rounded-lg border border-slate-100 p-3">
                <p className="mb-2 text-xs font-bold text-slate-500 uppercase">{label}</p>
                <div className="grid grid-cols-2 gap-2">
                  <FieldInput label="Ente Certificador" value={certs[vencKey as keyof typeof certs]} onChange={(v) => setCerts((c) => ({ ...c, [vencKey]: v }))} />
                  <FieldInput label="Vencimiento" value={certs[nroKey as keyof typeof certs]} onChange={(v) => setCerts((c) => ({ ...c, [nroKey]: v }))} placeholder="DD/MM/AAAA" />
                  <FieldInput label="Nº Certificado" value={certs[capKey as keyof typeof certs]} onChange={(v) => setCerts((c) => ({ ...c, [capKey]: v }))} />
                  <FieldInput label="Capacidad Certificada" value={certs[vencKey as keyof typeof certs]} onChange={(v) => setCerts((c) => ({ ...c, [vencKey]: v }))} />
                </div>
              </div>
            ))}
          </div>
          <p className="mt-4 mb-2 text-xs font-bold text-slate-500 uppercase">Equipo de Izaje</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <FieldInput label="Año / Modelo" value={certs.izajeAnioModelo} onChange={(v) => setCerts((c) => ({ ...c, izajeAnioModelo: v }))} />
            <FieldInput label="Posee Manual Operador (S/N)" value={certs.izajeManual} onChange={(v) => setCerts((c) => ({ ...c, izajeManual: v }))} />
            <FieldInput label="Nº Certificado / Vencimiento" value={certs.izajeNroCertVenc} onChange={(v) => setCerts((c) => ({ ...c, izajeNroCertVenc: v }))} />
            <FieldInput label="Número de Serie" value={certs.izajeNroSerie} onChange={(v) => setCerts((c) => ({ ...c, izajeNroSerie: v }))} />
            <FieldInput label="Ente Certificador" value={certs.izajeEnteCert} onChange={(v) => setCerts((c) => ({ ...c, izajeEnteCert: v }))} />
            <FieldInput label="Capacidad Máxima de Carga" value={certs.izajeCapMax} onChange={(v) => setCerts((c) => ({ ...c, izajeCapMax: v }))} />
          </div>
        </div>
      )}

      {/* ── Camion: documentation ── */}
      {type === 'camion' && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="mb-4 font-bold text-slate-900">Documentación</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ['Tarjeta Verde (S/N)', 'tarjetaVerde', 'Vencimiento', 'tarjetaVerdeVenc'],
              ['Cédula de Transporte (S/N)', 'cedulaTransporte', 'Vencimiento', 'cedulaTransporteVenc'],
              ['Permisos Especiales (S/N)', 'permisosEspeciales', 'Vencimiento', 'permisosEspecialesVenc'],
              ['Ruta (S/N)', 'ruta', 'Vencimiento', 'rutaVenc'],
              ['Seguro Nº Póliza', 'seguroNroPol', 'Vencimiento', 'seguroVenc'],
              ['Comp. Patente (S/N)', 'patente', 'Vencimiento', 'patenteVenc'],
              ['VTV (S/N)', 'vtv', 'Vencimiento', 'vtvVenc'],
              ['Doc. Chofer (S/N) Categoría', 'docChoferCat', 'Vencimiento', 'docChoferVenc'],
            ].map(([l1, k1, l2, k2]) => (
              <div key={k1} className="col-span-1 space-y-1">
                <FieldInput label={l1} value={docs[k1 as keyof typeof docs]} onChange={(v) => setDocs((d) => ({ ...d, [k1]: v }))} />
                <FieldInput label={l2} value={docs[k2 as keyof typeof docs]} onChange={(v) => setDocs((d) => ({ ...d, [k2]: v }))} placeholder="DD/MM/AAAA" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Inspection table ── */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-slate-200 bg-slate-700 px-5 py-3">
          <h3 className="font-bold text-white">
            {type === 'hidrogua' ? 'Inspección Técnica de Componentes' : 'Inspección Técnica del Vehículo'}
          </h3>
        </div>

        {/* Column headers */}
        <div className="grid grid-cols-[56px_1fr_160px_160px_180px] gap-0 border-b border-slate-200 bg-amber-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
          <span>Cód.</span>
          <span>Descripción</span>
          <span className="text-center">Entrega</span>
          <span className="text-center">Recibe</span>
          <span>Observaciones</span>
        </div>

        {type === 'hidrogua' ? (
          HIDROGUA_SECTIONS.map((section) => (
            <div key={section.name}>
              <div className="bg-slate-100 px-3 py-1.5">
                <span className="text-xs font-bold text-slate-600 uppercase tracking-wide">{section.name}</span>
              </div>
              {section.items.map((item) => (
                <div key={item.code} className="grid grid-cols-[56px_1fr_160px_160px_180px] gap-0 items-center border-b border-slate-100 px-3 py-2 hover:bg-slate-50">
                  <span className="text-xs font-mono font-semibold text-slate-500">{item.code}</span>
                  <span className="text-sm text-slate-700 pr-3">{item.desc}</span>
                  <div className="flex justify-center">
                    <StatusPicker value={items[item.code]?.entrega ?? ''} onChange={(v) => update(item.code, 'entrega', v)} />
                  </div>
                  <div className="flex justify-center">
                    <StatusPicker value={items[item.code]?.recibe ?? ''} onChange={(v) => update(item.code, 'recibe', v)} />
                  </div>
                  <input
                    value={items[item.code]?.obs ?? ''}
                    onChange={(e) => update(item.code, 'obs', e.target.value)}
                    placeholder="Obs..."
                    className="rounded border border-slate-200 px-2 py-1 text-xs outline-none focus:border-amber-400"
                  />
                </div>
              ))}
            </div>
          ))
        ) : (
          CAMION_ITEMS.map((item) => (
            <div key={item.code} className="grid grid-cols-[56px_1fr_160px_160px_180px] gap-0 items-center border-b border-slate-100 px-3 py-2 hover:bg-slate-50">
              <span className="text-xs font-mono font-semibold text-slate-500">{item.code}</span>
              <span className="text-sm text-slate-700 pr-3">{item.desc}</span>
              <div className="flex justify-center">
                <StatusPicker value={items[item.code]?.entrega ?? ''} onChange={(v) => update(item.code, 'entrega', v)} />
              </div>
              <div className="flex justify-center">
                <StatusPicker value={items[item.code]?.recibe ?? ''} onChange={(v) => update(item.code, 'recibe', v)} />
              </div>
              <input
                value={items[item.code]?.obs ?? ''}
                onChange={(e) => update(item.code, 'obs', e.target.value)}
                placeholder="Obs..."
                className="rounded border border-slate-200 px-2 py-1 text-xs outline-none focus:border-amber-400"
              />
            </div>
          ))
        )}
      </div>

      {/* ── Observaciones generales ── */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 font-bold text-slate-900">Observaciones realizadas</h3>
        <textarea
          rows={4}
          value={obsGenerales}
          onChange={(e) => setObsGenerales(e.target.value)}
          className="w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-amber-400"
          placeholder="Observaciones generales del chequeo visual y otras notas..."
        />
      </div>

      {/* ── References + signatures ── */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="mb-3 text-xs font-bold text-slate-500 uppercase">Referencias</p>
        <div className="flex flex-wrap gap-2 mb-5">
          {STATUS_OPTIONS.map((opt) => (
            <span key={opt.value} className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-bold ${opt.color}`}>
              {opt.value} <span className="font-normal">{STATUS_LABEL[opt.value]}</span>
            </span>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-5">
          {['Chofer que Entrega la Unidad', 'Contratado Por', 'Chofer que Recibe la Unidad'].map((label) => (
            <div key={label} className="flex flex-col items-center gap-1">
              <div className="h-16 w-full rounded-lg border border-dashed border-slate-300 bg-slate-50" />
              <span className="text-xs font-semibold text-slate-500">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
