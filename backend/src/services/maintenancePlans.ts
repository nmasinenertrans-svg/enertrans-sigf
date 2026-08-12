import { prisma } from '../db.js'
import { sendPushToAllUsers } from './webPush.js'

export const maintenanceTypeValues = [
  'MOTOR',
  'DISTRIBUTION',
  'GEARBOX',
  'COOLING',
  'DIFFERENTIAL',
  'STEERING',
  'CLUTCH',
  'BRAKES',
  'HYDRO_CRANE',
] as const

export type MaintenanceTypeValue = (typeof maintenanceTypeValues)[number]

export const maintenanceTypeLabels: Record<MaintenanceTypeValue, string> = {
  MOTOR: 'Motor',
  DISTRIBUTION: 'Distribución',
  GEARBOX: 'Caja',
  COOLING: 'Refrigeración',
  DIFFERENTIAL: 'Diferencial',
  STEERING: 'Dirección',
  CLUTCH: 'Embrague',
  BRAKES: 'Frenos',
  HYDRO_CRANE: 'Hidrogrúa',
}

const HOUR_BASED_UNIT_TYPES = new Set(['CHASSIS', 'CHASSIS_WITH_HYDROCRANE', 'TRACTOR', 'TRACTOR_WITH_HYDROCRANE'])

const DEFAULT_DUE_SOON_KILOMETERS = 1500
const DEFAULT_DUE_SOON_HOURS = 50

type MeasurementUnit = 'KILOMETERS' | 'HOURS'
type MaintenanceStatus = 'OVERDUE' | 'OK' | 'DUE_SOON'

export const getMeasurementUnit = (unitType: string | undefined | null, maintenanceType: string): MeasurementUnit => {
  if (maintenanceType === 'HYDRO_CRANE') {
    return 'HOURS'
  }
  return unitType && HOUR_BASED_UNIT_TYPES.has(unitType) ? 'HOURS' : 'KILOMETERS'
}

export const calculateMaintenanceStatus = (
  measurementUnit: MeasurementUnit,
  current: number,
  nextServiceBy: number,
): MaintenanceStatus => {
  const remaining = nextServiceBy - current
  const threshold = measurementUnit === 'KILOMETERS' ? DEFAULT_DUE_SOON_KILOMETERS : DEFAULT_DUE_SOON_HOURS

  if (remaining <= 0) {
    return 'OVERDUE'
  }
  if (remaining <= threshold) {
    return 'DUE_SOON'
  }
  return 'OK'
}

export const notifyMaintenanceStatus = async (
  unitId: string,
  maintenanceType: string,
  status: string,
  unitInternalCode?: string | null,
) => {
  if (status !== 'OVERDUE' && status !== 'DUE_SOON') {
    return
  }
  try {
    let code = unitInternalCode
    if (!code) {
      const unit = await prisma.fleetUnit.findUnique({ where: { id: unitId }, select: { internalCode: true } })
      code = unit?.internalCode
    }
    const typeLabel = maintenanceTypeLabels[maintenanceType as MaintenanceTypeValue] ?? maintenanceType
    void sendPushToAllUsers({
      title: status === 'OVERDUE' ? 'Service vencido' : 'Service próximo a vencer',
      body: `${code ?? 'Unidad'} - ${typeLabel}`,
      url: '/maintenance',
      tag: 'maintenance-status',
    }).catch(() => undefined)
  } catch (error) {
    console.warn('MaintenancePlan notify error:', error)
  }
}

/**
 * Recalcula el estado de los planes de mantenimiento de una unidad usando el km/horas
 * recien actualizado (ej. desde una auditoria o una edicion manual de la unidad), y
 * avisa por push si algun plan paso a DUE_SOON/OVERDUE. Antes, el estado del plan solo
 * cambiaba si alguien editaba el plan a mano, aunque la unidad ya hubiera acumulado
 * kilometros/horas reales — la alerta podia quedar mostrando "OK" con la unidad vencida.
 */
export const recalculateMaintenancePlansForUnit = async (
  unitId: string,
  liveValues: { unitKilometers?: number; engineHours?: number; hydroHours?: number },
): Promise<void> => {
  try {
    const [unit, plans] = await Promise.all([
      prisma.fleetUnit.findUnique({ where: { id: unitId }, select: { unitType: true, internalCode: true } }),
      prisma.maintenancePlan.findMany({ where: { unitId } }),
    ])
    if (!unit || plans.length === 0) {
      return
    }

    await Promise.all(
      plans.map(async (plan) => {
        const maintenanceType = plan.maintenanceType ?? 'MOTOR'
        const measurementUnit = getMeasurementUnit(unit.unitType, maintenanceType)
        const isHydro = maintenanceType === 'HYDRO_CRANE'

        const current =
          measurementUnit === 'KILOMETERS'
            ? liveValues.unitKilometers ?? plan.currentKilometers
            : isHydro
              ? liveValues.hydroHours ?? plan.currentHours
              : liveValues.engineHours ?? plan.currentHours

        const nextServiceBy = measurementUnit === 'KILOMETERS' ? plan.nextServiceByKilometers : plan.nextServiceByHours
        const nextStatus = calculateMaintenanceStatus(measurementUnit, current, nextServiceBy)

        const nextCurrentKilometers = measurementUnit === 'KILOMETERS' ? current : plan.currentKilometers
        const nextCurrentHours = measurementUnit === 'HOURS' ? current : plan.currentHours

        const needsUpdate =
          nextStatus !== plan.status ||
          nextCurrentKilometers !== plan.currentKilometers ||
          nextCurrentHours !== plan.currentHours

        if (!needsUpdate) {
          return
        }

        await prisma.maintenancePlan.update({
          where: { id: plan.id },
          data: { status: nextStatus, currentKilometers: nextCurrentKilometers, currentHours: nextCurrentHours },
        })

        if (nextStatus !== plan.status) {
          void notifyMaintenanceStatus(unitId, maintenanceType, nextStatus, unit.internalCode)
        }
      }),
    )
  } catch (error) {
    console.warn('recalculateMaintenancePlansForUnit error:', error)
  }
}
