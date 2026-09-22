import { wearLevelColor, type TireViewItem } from '../services/tiresService'
import { wheelLayoutConfigs, type WheelLayout } from '../wheelLayouts'

const EMPTY_COLOR = '#94a3b8'
const SELECTED_STROKE = '#0f172a'

interface WheelDiagramProps {
  layout: WheelLayout
  tiresByPosition: Map<string, TireViewItem>
  selectedCode?: string | null
  onSelectSlot: (code: string) => void
}

export const WheelDiagram = ({ layout, tiresByPosition, selectedCode, onSelectSlot }: WheelDiagramProps) => {
  const config = wheelLayoutConfigs[layout]

  return (
    <svg
      viewBox={`0 0 ${config.imageWidth} ${config.imageHeight}`}
      className="mx-auto w-full max-w-[420px]"
      role="img"
      aria-label="Diagrama de ruedas"
    >
      <image href={config.image} x={0} y={0} width={config.imageWidth} height={config.imageHeight} />

      {config.slots.map((slot) => {
        const tire = tiresByPosition.get(slot.code)
        const fill = tire ? (tire.isActive ? wearLevelColor[tire.wearLevel] : '#64748b') : EMPTY_COLOR
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
              fillOpacity={tire ? 0.72 : 0.4}
              stroke={isSelected ? SELECTED_STROKE : 'transparent'}
              strokeWidth={isSelected ? 2.5 : 0}
            />
            {tire ? (
              <text x={slot.cx} y={slot.cy + 3} textAnchor="middle" fontSize={9} fontWeight={700} fill="#0f172a">
                {tire.wearPercent}%
              </text>
            ) : (
              <text x={slot.cx} y={slot.cy + 4} textAnchor="middle" fontSize={13} fontWeight={700} fill="#1e293b">
                +
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}
