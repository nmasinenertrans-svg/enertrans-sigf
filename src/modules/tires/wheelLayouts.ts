import carImage from './assets/wheel-layout-car-4.png'
import truck6Image from './assets/wheel-layout-truck-6.png'
import truck10Image from './assets/wheel-layout-truck-10.png'

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

export interface WheelLayoutConfig {
  image: string
  // Dimensiones nativas del PNG de referencia - el viewBox del SVG usa estos
  // mismos valores para que las coordenadas de cada rueda calcen 1 a 1 con la
  // imagen real (medidas a mano, pixel a pixel, sobre las fotos que mando
  // Nicolas).
  imageWidth: number
  imageHeight: number
  slots: WheelSlot[]
}

export const wheelLayoutConfigs: Record<WheelLayout, WheelLayoutConfig> = {
  CAR_4: {
    image: carImage,
    imageWidth: 419,
    imageHeight: 199,
    slots: [
      { code: 'DI', label: 'Delantera izquierda', cx: 79, cy: 13, width: 62, height: 23 },
      { code: 'DD', label: 'Delantera derecha', cx: 79, cy: 183, width: 62, height: 23 },
      { code: 'TI', label: 'Trasera izquierda', cx: 337, cy: 13, width: 65, height: 23 },
      { code: 'TD', label: 'Trasera derecha', cx: 337, cy: 183, width: 65, height: 23 },
    ],
  },
  TRUCK_6: {
    image: truck6Image,
    imageWidth: 410,
    imageHeight: 195,
    slots: [
      { code: 'DI', label: 'Delantera izquierda', cx: 87, cy: 14, width: 65, height: 23 },
      { code: 'DD', label: 'Delantera derecha', cx: 87, cy: 181, width: 65, height: 23 },
      { code: 'TI-E', label: 'Trasera izq. exterior', cx: 335, cy: 13, width: 70, height: 26 },
      { code: 'TI-I', label: 'Trasera izq. interior', cx: 335, cy: 40, width: 70, height: 26 },
      { code: 'TD-I', label: 'Trasera der. interior', cx: 335, cy: 152, width: 70, height: 26 },
      { code: 'TD-E', label: 'Trasera der. exterior', cx: 335, cy: 179, width: 70, height: 26 },
    ],
  },
  TRUCK_10: {
    image: truck10Image,
    imageWidth: 413,
    imageHeight: 190,
    slots: [
      { code: 'DI', label: 'Delantera izquierda', cx: 79, cy: 13, width: 62, height: 24 },
      { code: 'DD', label: 'Delantera derecha', cx: 79, cy: 168, width: 62, height: 24 },
      { code: 'E1-TI-E', label: 'Eje 1 tras. izq. exterior', cx: 262, cy: 11, width: 75, height: 24 },
      { code: 'E1-TI-I', label: 'Eje 1 tras. izq. interior', cx: 262, cy: 35, width: 75, height: 24 },
      { code: 'E1-TD-I', label: 'Eje 1 tras. der. interior', cx: 262, cy: 150, width: 75, height: 24 },
      { code: 'E1-TD-E', label: 'Eje 1 tras. der. exterior', cx: 262, cy: 176, width: 75, height: 24 },
      { code: 'E2-TI-E', label: 'Eje 2 tras. izq. exterior', cx: 341, cy: 11, width: 73, height: 24 },
      { code: 'E2-TI-I', label: 'Eje 2 tras. izq. interior', cx: 341, cy: 35, width: 73, height: 24 },
      { code: 'E2-TD-I', label: 'Eje 2 tras. der. interior', cx: 341, cy: 150, width: 73, height: 24 },
      { code: 'E2-TD-E', label: 'Eje 2 tras. der. exterior', cx: 341, cy: 176, width: 73, height: 24 },
    ],
  },
}
