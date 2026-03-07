import { PrismaClient } from '@prisma/client'
import { createClient } from '@supabase/supabase-js'

type StorageEntry = {
  path: string
  size: number
}

const bucket = process.env.SUPABASE_BUCKET || 'enertrans-files'
const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const shouldDelete = process.argv.includes('--delete')
const schemaArg = process.argv.find((arg) => arg.startsWith('--schema='))?.split('=')[1]?.trim()
const targetSchema = schemaArg || process.env.APP_DB_SCHEMA || ''

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY')
}

if (targetSchema) {
  const current = process.env.DATABASE_URL || ''
  if (current) {
    const withSchema = current.includes('schema=')
      ? current.replace(/schema=[^&]+/, `schema=${targetSchema}`)
      : `${current}${current.includes('?') ? '&' : '?'}schema=${targetSchema}`
    process.env.DATABASE_URL = withSchema
  }
}

const prisma = new PrismaClient()
const supabase = createClient(supabaseUrl, supabaseKey)

const listFolder = async (folder: string): Promise<StorageEntry[]> => {
  const result: StorageEntry[] = []
  let offset = 0
  const limit = 1000

  while (true) {
    const { data, error } = await supabase.storage.from(bucket).list(folder, {
      limit,
      offset,
      sortBy: { column: 'created_at', order: 'desc' },
    })

    if (error) {
      throw new Error(`No se pudo listar ${folder}: ${error.message}`)
    }

    if (!data || data.length === 0) {
      break
    }

    data.forEach((entry) => {
      if (!entry.name) {
        return
      }
      result.push({
        path: `${folder}/${entry.name}`,
        size: entry.metadata?.size || 0,
      })
    })

    if (data.length < limit) {
      break
    }

    offset += limit
  }

  return result
}

const extractPathFromPublicUrl = (url: string): string | null => {
  const marker = `/storage/v1/object/public/${bucket}/`
  const markerIndex = url.indexOf(marker)
  if (markerIndex < 0) {
    return null
  }
  return url.slice(markerIndex + marker.length)
}

const main = async () => {
  const audits = await prisma.auditRecord.findMany({
    select: {
      id: true,
      photoUrls: true,
      checklist: true,
    },
  })

  const referenced = new Set<string>()

  audits.forEach((audit) => {
    if (Array.isArray(audit.photoUrls)) {
      audit.photoUrls.forEach((value) => {
        if (typeof value !== 'string') {
          return
        }
        const path = extractPathFromPublicUrl(value)
        if (path) {
          referenced.add(path)
        }
      })
    }

    const pdfUrl =
      audit.checklist && typeof audit.checklist === 'object' && !Array.isArray(audit.checklist)
        ? (audit.checklist as any)?.meta?.reportPdfFileUrl
        : null
    if (typeof pdfUrl === 'string') {
      const path = extractPathFromPublicUrl(pdfUrl)
      if (path) {
        referenced.add(path)
      }
    }
  })

  const storageEntries = await listFolder('audits')
  const orphanEntries = storageEntries.filter((entry) => !referenced.has(entry.path))
  const orphanBytes = orphanEntries.reduce((acc, entry) => acc + entry.size, 0)

  console.log(
    JSON.stringify(
      {
        mode: shouldDelete ? 'delete' : 'report',
        auditsInDb: audits.length,
        referencedFiles: referenced.size,
        filesInStorageFolder: storageEntries.length,
        orphanFiles: orphanEntries.length,
        orphanMB: Number((orphanBytes / (1024 * 1024)).toFixed(2)),
      },
      null,
      2,
    ),
  )

  if (!shouldDelete || orphanEntries.length === 0) {
    return
  }

  let deleted = 0
  for (let index = 0; index < orphanEntries.length; index += 100) {
    const chunk = orphanEntries.slice(index, index + 100).map((entry) => entry.path)
    const { error } = await supabase.storage.from(bucket).remove(chunk)
    if (error) {
      throw new Error(`No se pudieron eliminar archivos: ${error.message}`)
    }
    deleted += chunk.length
  }

  console.log(JSON.stringify({ deletedOrphans: deleted }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
