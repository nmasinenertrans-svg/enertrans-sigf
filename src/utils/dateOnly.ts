// Fechas "solo dia" (sin hora) -- vencimientos, fecha de emision, inicio/fin
// de un periodo, etc -- se guardan como DateTime en UTC medianoche (o llegan
// como string "YYYY-MM-DD" plano, que el motor de JS tambien interpreta como
// UTC medianoche). Leerlas con los getters locales (getDate/getMonth/
// toLocaleDateString) aplica el huso horario del navegador (UTC-3 en
// Argentina) y las corre un dia para atras. Esta es la unica funcion que
// hay que usar para mostrar ese tipo de fecha en toda la app -- si un modulo
// nuevo tiene un campo de fecha sin hora, usar esta, no reinventarla.
//
// Ojo: esto NO aplica a fechas que sí tienen hora real (creadas con
// `new Date()`, o con un selector de fecha+hora) -- esas se muestran
// correctamente con toLocaleDateString/toLocaleString en horario local.
export const formatDateOnly = (value?: string | null): string => {
  if (!value) {
    return '-'
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return String(value)
  }
  const day = String(date.getUTCDate()).padStart(2, '0')
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${day}/${month}/${date.getUTCFullYear()}`
}

const monthNamesEs = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

// Igual que formatDateOnly pero para agrupar/mostrar por mes (ej. reportes).
export const getDateOnlyMonthKey = (value?: string | null): string | null => {
  if (!value) {
    return null
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return null
  }
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

export const formatDateOnlyMonthLabel = (value?: string | null): string => {
  if (!value) {
    return 'Sin fecha'
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return 'Sin fecha'
  }
  return `${monthNamesEs[date.getUTCMonth()]} de ${date.getUTCFullYear()}`
}
