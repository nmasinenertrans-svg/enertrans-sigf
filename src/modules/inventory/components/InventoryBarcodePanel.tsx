import { useEffect, useMemo, useRef, useState } from 'react'
import type { BarcodeEntryPayload } from '../types'

interface BarcodeDetectorInstance {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue?: string }>>
}

interface BarcodeDetectorCtor {
  new (options?: { formats?: string[] }): BarcodeDetectorInstance
}

interface WindowWithBarcodeDetector extends Window {
  BarcodeDetector?: BarcodeDetectorCtor
}

interface InventoryBarcodePanelProps {
  onSubmitBarcode: (payload: BarcodeEntryPayload) => void
}

const inputClassName =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-colors focus:border-amber-400'

const minBarcodeLength = 3

export const InventoryBarcodePanel = ({ onSubmitBarcode }: InventoryBarcodePanelProps) => {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const scanIntervalRef = useRef<number | null>(null)

  const [barcodeInput, setBarcodeInput] = useState('')
  const [quantityInput, setQuantityInput] = useState(1)
  const [isCameraScanning, setIsCameraScanning] = useState(false)

  const barcodeDetectorCtor = useMemo(
    () => (window as WindowWithBarcodeDetector).BarcodeDetector,
    [],
  )

  const hasCameraSupport = useMemo(
    () => Boolean(barcodeDetectorCtor && navigator.mediaDevices?.getUserMedia),
    [barcodeDetectorCtor],
  )

  const stopCamera = () => {
    if (scanIntervalRef.current !== null) {
      window.clearInterval(scanIntervalRef.current)
      scanIntervalRef.current = null
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null
    }

    setIsCameraScanning(false)
  }

  useEffect(() => stopCamera, [])

  const handleSubmit = () => {
    const normalizedBarcode = barcodeInput.trim()

    if (normalizedBarcode.length < minBarcodeLength || quantityInput <= 0) {
      return
    }

    onSubmitBarcode({
      barcode: normalizedBarcode,
      quantity: Math.floor(quantityInput),
    })

    setBarcodeInput('')
    setQuantityInput(1)
  }

  const startCamera = async () => {
    if (!hasCameraSupport || !barcodeDetectorCtor) {
      return
    }

    const mediaStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false,
    })

    streamRef.current = mediaStream

    if (videoRef.current) {
      videoRef.current.srcObject = mediaStream
      await videoRef.current.play()
    }

    const detector = new barcodeDetectorCtor({
      formats: ['code_128', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_39'],
    })

    scanIntervalRef.current = window.setInterval(async () => {
      if (!videoRef.current) {
        return
      }

      try {
        const detections = await detector.detect(videoRef.current)
        const rawValue = detections[0]?.rawValue?.trim()

        if (rawValue && rawValue.length >= minBarcodeLength) {
          setBarcodeInput(rawValue)
          stopCamera()
        }
      } catch {
        // Ignore transient detection errors.
      }
    }, 500)

    setIsCameraScanning(true)
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <header>
        <h3 className="text-lg font-bold text-slate-900">Lector de codigo de barras</h3>
        <p className="mt-1 text-sm text-slate-600">
          Si existe SKU: suma stock. Si no existe: habilita alta inmediata.
        </p>
      </header>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        <label className="flex flex-col gap-2 md:col-span-2">
          <span className="text-sm font-semibold text-slate-700">Codigo de barras / SKU</span>
          <input
            className={inputClassName}
            value={barcodeInput}
            onChange={(event) => setBarcodeInput(event.target.value)}
            placeholder="Escanea o ingresa codigo"
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                handleSubmit()
              }
            }}
          />
        </label>

        <label className="flex flex-col gap-2">
          <span className="text-sm font-semibold text-slate-700">Cantidad</span>
          <input
            type="number"
            min={1}
            className={inputClassName}
            value={quantityInput}
            onChange={(event) => setQuantityInput(Number(event.target.value))}
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleSubmit}
          className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-500"
        >
          Procesar lectura
        </button>

        {hasCameraSupport ? (
          isCameraScanning ? (
            <button
              type="button"
              onClick={stopCamera}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              Detener camara
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                void startCamera()
              }}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              Escanear con camara
            </button>
          )
        ) : (
          <span className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            Camara no disponible en este navegador.
          </span>
        )}
      </div>

      {isCameraScanning ? (
        <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-slate-900">
          <video ref={videoRef} className="h-56 w-full object-cover" muted playsInline />
        </div>
      ) : null}
    </section>
  )
}
