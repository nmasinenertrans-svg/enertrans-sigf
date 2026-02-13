import { Router } from 'express'
import { z } from 'zod'
import { supabase, supabaseBucket } from '../storage/supabase.js'

const router = Router()

const uploadSchema = z.object({
  fileName: z.string().min(1),
  contentType: z.string().min(1),
  dataUrl: z.string().min(10),
  folder: z.string().optional(),
})

router.post('/upload', async (req, res) => {
  const parsed = uploadSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
  }

  const { fileName, contentType, dataUrl, folder } = parsed.data
  const base64Index = dataUrl.indexOf('base64,')
  const base64 = base64Index >= 0 ? dataUrl.slice(base64Index + 7) : dataUrl

  const buffer = Buffer.from(base64, 'base64')
  const safeFolder = folder?.trim() ? folder.trim() : 'uploads'
  const objectName = `${safeFolder}/${Date.now()}-${fileName}`

  const { error } = await supabase.storage
    .from(supabaseBucket)
    .upload(objectName, buffer, { contentType, upsert: false })

  if (error) {
    return res.status(500).json({ message: 'No se pudo subir el archivo.', detail: error.message })
  }

  const { data } = supabase.storage.from(supabaseBucket).getPublicUrl(objectName)

  return res.status(201).json({
    path: objectName,
    url: data.publicUrl,
  })
})

export default router