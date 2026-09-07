import { randomUUID } from 'node:crypto'
import { scanInspectionImages, type ScanResult } from './inspectionScan.js'

interface ScanJob {
  id: string
  userId: string
  status: 'PENDING' | 'DONE' | 'ERROR'
  result?: ScanResult
  message?: string
  createdAt: number
}

const jobs = new Map<string, ScanJob>()
const JOB_TTL_MS = 15 * 60 * 1000

const cleanupExpiredJobs = () => {
  const now = Date.now()
  for (const [id, job] of jobs) {
    if (now - job.createdAt > JOB_TTL_MS) {
      jobs.delete(id)
    }
  }
}

/**
 * El escaneo con IA puede tardar bastante (arranque en frio de Render +
 * tiempo real de la IA generando la respuesta), y una sola conexion HTTP
 * larga es fragil: puede morir por un timeout del navegador, del proxy de
 * Render, o de cualquier capa intermedia, sin que nuestro codigo lo pueda
 * evitar -- y aun asi seguiamos pagandole a la IA por una respuesta que se
 * tiraba a la basura. En vez de eso, esto arranca el trabajo en segundo
 * plano y el frontend pregunta el estado cada pocos segundos con pedidos
 * cortos, que nunca dependen de cuanto tarde la IA.
 */
export const startInspectionScanJob = (dataUrls: string[], userId: string): string => {
  cleanupExpiredJobs()
  const id = randomUUID()
  const job: ScanJob = { id, userId, status: 'PENDING', createdAt: Date.now() }
  jobs.set(id, job)

  scanInspectionImages(dataUrls)
    .then((result) => {
      job.status = 'DONE'
      job.result = result
    })
    .catch((error) => {
      job.status = 'ERROR'
      job.message = error instanceof Error ? error.message : 'No se pudo leer la imagen.'
      console.error('Inspection scan job error:', error)
    })

  return id
}

export const getInspectionScanJob = (id: string, userId: string): ScanJob | undefined => {
  const job = jobs.get(id)
  if (!job || job.userId !== userId) {
    return undefined
  }
  return job
}
