import { useEffect, useRef, useState } from 'react'
import type { InventoryItem } from '../../../types/domain'
import { findInventoryItemByBarcode, formatStock, unitLabel } from '../services/inventoryService'

interface InventoryLookupPanelProps {
  inventoryItems: InventoryItem[]
}

const inputClassName =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-colors focus:border-amber-400'

const minCodeLength = 3

export const InventoryLookupPanel = ({ inventoryItems }: InventoryLookupPanelProps) => {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const scanControlsRef = useRef<{ stop: () => void } | null>(null)

  const [codeInput, setCodeInput] = useState('')
  const [isCameraScanning, setIsCameraScanning] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const [lastQuery, setLastQuery] = useState('')
  const [result, setResult] = useState<InventoryItem | null | undefined>(undefined)

  const hasCameraSupport = Boolean(navigator.mediaDevices?.getUserMedia)

  const stopCamera = () => {
    if (scanControlsRef.current) {
      scanControlsRef.current.stop()
      scanControlsRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    setIsCameraScanning(false)
  }

  useEffect(() => stopCamera, [])

  const runLookup = (value: string) => {
    const normalized = value.trim()
    if (normalized.length < minCodeLength) return
    setLastQuery(normalized)
    setResult(findInventoryItemByBarcode(inventoryItems, normalized) ?? null)
    setCodeInput('')
  }

  const startCamera = async () => {
    setCameraError('')

    const videoConstraints: MediaStreamConstraints[] = [
      { video: { facingMode: { exact: 'environment' } }, audio: false },
      { video: { facingMode: 'environment' }, audio: false },
      { video: true, audio: false },
    ]

    let mediaStream: MediaStream | null = null
    for (const constraints of videoConstraints) {
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia(constraints)
        break
      } catch {
        // try next
      }
    }

    if (!mediaStream) {
      setCameraError('No se pudo acceder a la cámara. Revisá los permisos del navegador.')
      return
    }

    streamRef.current = mediaStream

    const video = videoRef.current
    if (!video) {
      mediaStream.getTracks().forEach((t) => t.stop())
      return
    }

    video.srcObject = mediaStream
    await video.play().catch(() => null)
    setIsCameraScanning(true)

    const { BrowserMultiFormatReader } = await import('@zxing/browser')
    const reader = new BrowserMultiFormatReader()

    const controls = await reader.decodeFromVideoElement(video, (scanResult, err) => {
      if (scanResult) {
        const value = scanResult.getText().trim()
        if (value.length >= minCodeLength) {
          runLookup(value)
          stopCamera()
        }
      }
      void err
    })
    scanControlsRef.current = controls
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <header>
        <h3 className="text-lg font-bold text-slate-900">Consultor de productos</h3>
        <p className="mt-1 text-sm text-slate-600">
          Escaneá o ingresá un código de barras / SKU para saber qué producto es. No modifica el stock.
        </p>
      </header>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        <label className="flex flex-col gap-2 md:col-span-2">
          <span className="text-sm font-semibold text-slate-700">Código de barras / SKU</span>
          <input
            className={inputClassName}
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value)}
            placeholder="Escaneá o ingresá el código"
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); runLookup(codeInput) }
            }}
          />
        </label>
        <div className="flex items-end">
          <button
            type="button"
            onClick={() => runLookup(codeInput)}
            className="w-full rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-500"
          >
            Consultar
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {hasCameraSupport ? (
          isCameraScanning ? (
            <button
              type="button"
              onClick={stopCamera}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              Detener cámara
            </button>
          ) : (
            <button
              type="button"
              onClick={() => { void startCamera() }}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              Escanear con cámara
            </button>
          )
        ) : (
          <span className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            Cámara no disponible en este navegador.
          </span>
        )}
      </div>

      {cameraError && (
        <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
          {cameraError}
        </p>
      )}

      {/* Siempre en el DOM para que el ref esté disponible al iniciar la cámara */}
      <div className={`mt-4 overflow-hidden rounded-lg border border-slate-200 bg-slate-900 ${isCameraScanning ? '' : 'hidden'}`}>
        <video ref={videoRef} className="h-56 w-full object-cover" muted playsInline />
      </div>

      {result === undefined ? null : result === null ? (
        <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          No se encontró ningún producto con el código <span className="font-mono font-semibold">{lastQuery}</span>.
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-xs font-semibold text-emerald-700">Código consultado: {lastQuery}</p>
          <p className="mt-1 text-lg font-bold text-slate-900">{result.productName}</p>
          {result.description ? <p className="mt-1 text-sm text-slate-700">{result.description}</p> : null}
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-slate-700">
            <dt className="font-semibold text-slate-500">SKU interno</dt>
            <dd className="font-mono">{result.sku}</dd>
            {result.externalBarcode ? (
              <>
                <dt className="font-semibold text-slate-500">Código de barras</dt>
                <dd className="font-mono">{result.externalBarcode}</dd>
              </>
            ) : null}
            <dt className="font-semibold text-slate-500">Stock actual</dt>
            <dd>{formatStock(result.stock, result.unit ?? 'UNIDAD')}</dd>
            {result.unitPrice != null ? (
              <>
                <dt className="font-semibold text-slate-500">Precio unitario</dt>
                <dd>
                  {result.unitPrice.toLocaleString('es-AR', { style: 'currency', currency: result.currency ?? 'ARS' })} /{' '}
                  {unitLabel(result.unit ?? 'UNIDAD')}
                </dd>
              </>
            ) : null}
          </dl>
        </div>
      )}
    </section>
  )
}
