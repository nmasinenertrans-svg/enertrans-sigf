import { wearLevelColor, type TireViewItem } from '../services/tiresService'
import { wheelLayoutConfigs, type WheelLayout } from '../wheelLayouts'

const EMPTY_COLOR = '#cbd5e1'
const SELECTED_STROKE = '#1e293b'
const CHASSIS_FILL = '#e2e8f0'
const CHASSIS_STROKE = '#94a3b8'
const DARK_FILL = '#475569'

interface WheelDiagramProps {
  layout: WheelLayout
  tiresByPosition: Map<string, TireViewItem>
  selectedCode?: string | null
  onSelectSlot: (code: string) => void
}

export const WheelDiagram = ({ layout, tiresByPosition, selectedCode, onSelectSlot }: WheelDiagramProps) => {
  const config = wheelLayoutConfigs[layout]

  return (
    <svg viewBox={config.viewBox} className="mx-auto w-full max-w-[220px]" role="img" aria-label="Diagrama de ruedas">
      {/* Chasis / carroceria */}
      <rect
        x={config.body.x}
        y={config.body.y}
        width={config.body.width}
        height={config.body.height}
        rx={config.body.rx}
        fill={CHASSIS_FILL}
        stroke={CHASSIS_STROKE}
        strokeWidth={2}
      />

      {/* Largueros del chasis (camiones) */}
      {config.rails?.map((rail, index) => (
        <line
          key={`rail-${index}`}
          x1={rail.x1}
          x2={rail.x2}
          y1={rail.y1}
          y2={rail.y2}
          stroke={CHASSIS_STROKE}
          strokeWidth={1.5}
        />
      ))}

      {/* Parabrisas (autos/camionetas) */}
      {config.windshield ? <polygon points={config.windshield.points} fill="#cbd5e1" stroke={CHASSIS_STROKE} strokeWidth={1} /> : null}

      {/* Cardan + diferenciales */}
      {config.driveshaft ? (
        <>
          <line
            x1={config.driveshaft.x}
            x2={config.driveshaft.x}
            y1={config.driveshaft.y1}
            y2={config.driveshaft.y2}
            stroke={CHASSIS_STROKE}
            strokeWidth={2.5}
          />
          {config.driveshaft.joints.map((joint, index) => (
            <circle key={`joint-${index}`} cx={joint.cx} cy={joint.cy} r={joint.r} fill="#94a3b8" stroke={CHASSIS_STROKE} strokeWidth={1} />
          ))}
        </>
      ) : null}

      {/* Caja (detras de la cabina) */}
      {config.gearbox ? (
        <rect
          x={config.gearbox.x}
          y={config.gearbox.y}
          width={config.gearbox.width}
          height={config.gearbox.height}
          rx={config.gearbox.rx}
          fill="#94a3b8"
          stroke={CHASSIS_STROKE}
          strokeWidth={1}
        />
      ) : null}

      {/* Cabina */}
      {config.cab ? (
        <rect
          x={config.cab.x}
          y={config.cab.y}
          width={config.cab.width}
          height={config.cab.height}
          rx={config.cab.rx}
          fill={DARK_FILL}
          stroke="#1e293b"
          strokeWidth={1.5}
        />
      ) : null}

      {config.slots.map((slot) => {
        const tire = tiresByPosition.get(slot.code)
        const fill = tire ? (tire.isActive ? wearLevelColor[tire.wearLevel] : '#94a3b8') : EMPTY_COLOR
        const isSelected = selectedCode === slot.code
        const x = slot.cx - slot.width / 2
        const y = slot.cy - slot.height / 2
        return (
          <g
            key={slot.code}
            onClick={() => onSelectSlot(slot.code)}
            className="cursor-pointer"
            role="button"
            aria-label={`${slot.label}${tire ? ` - ${tire.wearPercent}% de desgaste` : ' - sin cubierta cargada'}`}
          >
            <rect
              x={x}
              y={y}
              width={slot.width}
              height={slot.height}
              rx={Math.min(slot.width, slot.height) / 3}
              fill={fill}
              stroke={isSelected ? SELECTED_STROKE : '#1e293b'}
              strokeWidth={isSelected ? 3 : 1.5}
            />
            {tire ? (
              <text x={slot.cx} y={slot.cy + 3} textAnchor="middle" fontSize={7.5} fontWeight={700} fill="#f8fafc">
                {tire.wearPercent}%
              </text>
            ) : (
              <text x={slot.cx} y={slot.cy + 4} textAnchor="middle" fontSize={13} fill="#f8fafc">
                +
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}
