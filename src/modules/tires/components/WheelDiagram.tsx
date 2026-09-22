import { wearLevelColor, type TireViewItem } from '../services/tiresService'
import { wheelLayoutConfigs, type WheelLayout } from '../wheelLayouts'

const EMPTY_COLOR = '#cbd5e1'
const SELECTED_STROKE = '#1e293b'

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
      <rect
        x={config.body.x}
        y={config.body.y}
        width={config.body.width}
        height={config.body.height}
        rx={config.body.rx}
        fill="#e2e8f0"
        stroke="#94a3b8"
        strokeWidth={2}
      />
      {config.slots.map((slot) => {
        const tire = tiresByPosition.get(slot.code)
        const fill = tire ? (tire.isActive ? wearLevelColor[tire.wearLevel] : '#94a3b8') : EMPTY_COLOR
        const isSelected = selectedCode === slot.code
        return (
          <g
            key={slot.code}
            onClick={() => onSelectSlot(slot.code)}
            className="cursor-pointer"
            role="button"
            aria-label={`${slot.label}${tire ? ` - ${tire.wearPercent}% de desgaste` : ' - sin cubierta cargada'}`}
          >
            <circle
              cx={slot.cx}
              cy={slot.cy}
              r={slot.r}
              fill={fill}
              stroke={isSelected ? SELECTED_STROKE : '#475569'}
              strokeWidth={isSelected ? 3 : 1.5}
            />
            {tire ? (
              <text
                x={slot.cx}
                y={slot.cy + 4}
                textAnchor="middle"
                fontSize={9}
                fontWeight={700}
                fill="#0f172a"
              >
                {tire.wearPercent}%
              </text>
            ) : (
              <text x={slot.cx} y={slot.cy + 4} textAnchor="middle" fontSize={14} fill="#475569">
                +
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}
