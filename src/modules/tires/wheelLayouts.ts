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
  width: number
  height: number
}

interface DiffJoint {
  cx: number
  cy: number
  r: number
}

export interface WheelLayoutConfig {
  viewBox: string
  // Chasis/carroceria: rectangulo exterior.
  body: { x: number; y: number; width: number; height: number; rx: number }
  // Largueros del chasis (solo camiones) - dan el efecto de chasis de escalera.
  rails?: { x1: number; x2: number; y1: number; y2: number }[]
  // Cabina (solo camiones).
  cab?: { x: number; y: number; width: number; height: number; rx: number }
  // Caja/transfer detras de la cabina.
  gearbox?: { x: number; y: number; width: number; height: number; rx: number }
  // Parabrisas (solo autos/camionetas).
  windshield?: { points: string }
  // Linea de cardan + diferenciales, imitando el dibujo de referencia.
  driveshaft?: { x: number; y1: number; y2: number; joints: DiffJoint[] }
  slots: WheelSlot[]
}

export const wheelLayoutConfigs: Record<WheelLayout, WheelLayoutConfig> = {
  CAR_4: {
    viewBox: '0 0 180 260',
    body: { x: 40, y: 12, width: 100, height: 236, rx: 26 },
    windshield: { points: '62,34 118,34 108,58 72,58' },
    driveshaft: {
      x: 90,
      y1: 72,
      y2: 188,
      joints: [
        { cx: 90, cy: 82, r: 5 },
        { cx: 90, cy: 130, r: 9 },
        { cx: 90, cy: 178, r: 5 },
      ],
    },
    slots: [
      { code: 'DI', label: 'Delantera izquierda', cx: 27, cy: 55, width: 18, height: 36 },
      { code: 'DD', label: 'Delantera derecha', cx: 153, cy: 55, width: 18, height: 36 },
      { code: 'TI', label: 'Trasera izquierda', cx: 27, cy: 205, width: 18, height: 36 },
      { code: 'TD', label: 'Trasera derecha', cx: 153, cy: 205, width: 18, height: 36 },
    ],
  },
  TRUCK_6: {
    viewBox: '0 0 180 380',
    body: { x: 58, y: 8, width: 64, height: 364, rx: 6 },
    rails: [
      { x1: 66, x2: 66, y1: 75, y2: 362 },
      { x1: 114, x2: 114, y1: 75, y2: 362 },
    ],
    cab: { x: 61, y: 13, width: 58, height: 56, rx: 8 },
    gearbox: { x: 80, y: 72, width: 20, height: 16, rx: 3 },
    driveshaft: {
      x: 90,
      y1: 88,
      y2: 296,
      joints: [
        { cx: 90, cy: 130, r: 4 },
        { cx: 90, cy: 296, r: 9 },
      ],
    },
    slots: [
      { code: 'DI', label: 'Delantera izquierda', cx: 32, cy: 55, width: 16, height: 34 },
      { code: 'DD', label: 'Delantera derecha', cx: 148, cy: 55, width: 16, height: 34 },
      { code: 'TI-E', label: 'Trasera izq. exterior', cx: 17, cy: 305, width: 14, height: 30 },
      { code: 'TI-I', label: 'Trasera izq. interior', cx: 47, cy: 305, width: 14, height: 30 },
      { code: 'TD-I', label: 'Trasera der. interior', cx: 133, cy: 305, width: 14, height: 30 },
      { code: 'TD-E', label: 'Trasera der. exterior', cx: 163, cy: 305, width: 14, height: 30 },
    ],
  },
  TRUCK_10: {
    viewBox: '0 0 180 380',
    body: { x: 58, y: 8, width: 64, height: 364, rx: 6 },
    rails: [
      { x1: 66, x2: 66, y1: 70, y2: 362 },
      { x1: 114, x2: 114, y1: 70, y2: 362 },
    ],
    cab: { x: 61, y: 12, width: 58, height: 48, rx: 8 },
    gearbox: { x: 80, y: 64, width: 20, height: 14, rx: 3 },
    driveshaft: {
      x: 90,
      y1: 78,
      y2: 305,
      joints: [
        { cx: 90, cy: 120, r: 4 },
        { cx: 90, cy: 225, r: 9 },
        { cx: 90, cy: 305, r: 9 },
      ],
    },
    slots: [
      { code: 'DI', label: 'Delantera izquierda', cx: 32, cy: 50, width: 16, height: 32 },
      { code: 'DD', label: 'Delantera derecha', cx: 148, cy: 50, width: 16, height: 32 },
      { code: 'E1-TI-E', label: 'Eje 1 tras. izq. exterior', cx: 17, cy: 225, width: 13, height: 28 },
      { code: 'E1-TI-I', label: 'Eje 1 tras. izq. interior', cx: 47, cy: 225, width: 13, height: 28 },
      { code: 'E1-TD-I', label: 'Eje 1 tras. der. interior', cx: 133, cy: 225, width: 13, height: 28 },
      { code: 'E1-TD-E', label: 'Eje 1 tras. der. exterior', cx: 163, cy: 225, width: 13, height: 28 },
      { code: 'E2-TI-E', label: 'Eje 2 tras. izq. exterior', cx: 17, cy: 310, width: 13, height: 28 },
      { code: 'E2-TI-I', label: 'Eje 2 tras. izq. interior', cx: 47, cy: 310, width: 13, height: 28 },
      { code: 'E2-TD-I', label: 'Eje 2 tras. der. interior', cx: 133, cy: 310, width: 13, height: 28 },
      { code: 'E2-TD-E', label: 'Eje 2 tras. der. exterior', cx: 163, cy: 310, width: 13, height: 28 },
    ],
  },
}
