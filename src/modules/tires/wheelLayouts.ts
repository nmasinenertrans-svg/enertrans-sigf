export const wheelLayoutValues = ['CAR_4', 'TRUCK_6', 'TRUCK_10'] as const
export type WheelLayout = (typeof wheelLayoutValues)[number]

export const wheelLayoutLabels: Record<WheelLayout, string> = {
  CAR_4: 'Camioneta / auto (4 ruedas)',
  TRUCK_6: 'Camión 4x2 (6 ruedas)',
  TRUCK_10: 'Camión 6x2 / 6x4 (10 ruedas)',
}

export interface WheelSlot {
  code: string
  label: string
  cx: number
  cy: number
  r: number
}

export interface WheelLayoutConfig {
  viewBox: string
  body: { x: number; y: number; width: number; height: number; rx: number }
  slots: WheelSlot[]
}

export const wheelLayoutConfigs: Record<WheelLayout, WheelLayoutConfig> = {
  CAR_4: {
    viewBox: '0 0 180 260',
    body: { x: 40, y: 15, width: 100, height: 230, rx: 20 },
    slots: [
      { code: 'DI', label: 'Delantera izquierda', cx: 28, cy: 55, r: 17 },
      { code: 'DD', label: 'Delantera derecha', cx: 152, cy: 55, r: 17 },
      { code: 'TI', label: 'Trasera izquierda', cx: 28, cy: 205, r: 17 },
      { code: 'TD', label: 'Trasera derecha', cx: 152, cy: 205, r: 17 },
    ],
  },
  TRUCK_6: {
    viewBox: '0 0 180 380',
    body: { x: 55, y: 10, width: 70, height: 360, rx: 10 },
    slots: [
      { code: 'DI', label: 'Delantera izquierda', cx: 33, cy: 55, r: 16 },
      { code: 'DD', label: 'Delantera derecha', cx: 147, cy: 55, r: 16 },
      { code: 'TI-E', label: 'Trasera izq. exterior', cx: 18, cy: 305, r: 14 },
      { code: 'TI-I', label: 'Trasera izq. interior', cx: 47, cy: 305, r: 14 },
      { code: 'TD-I', label: 'Trasera der. interior', cx: 133, cy: 305, r: 14 },
      { code: 'TD-E', label: 'Trasera der. exterior', cx: 162, cy: 305, r: 14 },
    ],
  },
  TRUCK_10: {
    viewBox: '0 0 180 380',
    body: { x: 55, y: 10, width: 70, height: 360, rx: 10 },
    slots: [
      { code: 'DI', label: 'Delantera izquierda', cx: 33, cy: 50, r: 16 },
      { code: 'DD', label: 'Delantera derecha', cx: 147, cy: 50, r: 16 },
      { code: 'E1-TI-E', label: 'Eje 1 tras. izq. exterior', cx: 18, cy: 230, r: 13 },
      { code: 'E1-TI-I', label: 'Eje 1 tras. izq. interior', cx: 47, cy: 230, r: 13 },
      { code: 'E1-TD-I', label: 'Eje 1 tras. der. interior', cx: 133, cy: 230, r: 13 },
      { code: 'E1-TD-E', label: 'Eje 1 tras. der. exterior', cx: 162, cy: 230, r: 13 },
      { code: 'E2-TI-E', label: 'Eje 2 tras. izq. exterior', cx: 18, cy: 310, r: 13 },
      { code: 'E2-TI-I', label: 'Eje 2 tras. izq. interior', cx: 47, cy: 310, r: 13 },
      { code: 'E2-TD-I', label: 'Eje 2 tras. der. interior', cx: 133, cy: 310, r: 13 },
      { code: 'E2-TD-E', label: 'Eje 2 tras. der. exterior', cx: 162, cy: 310, r: 13 },
    ],
  },
}
