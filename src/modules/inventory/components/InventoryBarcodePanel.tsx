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
  const [cameraError, setCameraError] = useState('')
  const cameraCheckRef = useRef<number | null>(null)

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
    if (cameraCheckRef.current !== null) {
      window.clearTimeout(cameraCheckRef.current)
      cameraCheckRef.current = null
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

  const submitBarcode = (value: string, quantity = quantityInput) => {
    const normalizedBarcode = value.trim()

    if (normalizedBarcode.length < minBarcodeLength || quantity <= 0) {
      return
    }

    onSubmitBarcode({
      barcode: normalizedBarcode,
      quantity: Math.floor(quantity),
    })

    setBarcodeInput('')
    setQuantityInput(1)
  }

  const handleSubmit = () => submitBarcode(barcodeInput)

  const startCamera = async () => {
    if (!hasCameraSupport || !barcodeDetectorCtor) {
      return
    }

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
      setCameraError('No se pudo acceder a la cámara. Revisa permisos del navegador.')
      return
    }

    streamRef.current = mediaStream

    if (videoRef.current) {
      videoRef.current.srcObject = mediaStream
      videoRef.current.muted = true
      videoRef.current.autoplay = true
      videoRef.current.playsInline = true
      await new Promise<void>((resolve) => {
        if (!videoRef.current) {
          resolve()
          return
        }
        videoRef.current.onloadedmetadata = () => resolve()
      })
      try {
        await videoRef.current.play()
      } catch {
        setCameraError('No se pudo iniciar la cámara. Revisa permisos del navegador.')
        stopCamera()
        return
      }
    }

    cameraCheckRef.current = window.setTimeout(() => {
      if (videoRef.current && (videoRef.current.videoWidth === 0 || videoRef.current.videoHeight === 0)) {
        setCameraError('La cámara no entregó imagen. Probá cerrar y abrir nuevamente.')
        stopCamera()
      }
    }, 1200)

    const detector = new barcodeDetectorCtor({
      formats: ['code_128', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_39', 'qr_code'],
    })

    scanIntervalRef.current = window.setInterval(async () => {
      if (!videoRef.current) {
        return
      }

      try {
        const detections = await detector.detect(videoRef.current)
        const rawValue = detections[0]?.rawValue?.trim()

        if (rawValue && rawValue.length >= minBarcodeLength) {
          submitBarcode(rawValue)
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

      {cameraError ? (
        <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
          {cameraError}
        </p>
      ) : null}

      {isCameraScanning ? (
        <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-slate-900">
          <video ref={videoRef} className="h-56 w-full object-cover" muted playsInline autoPlay />
        </div>
      ) : null}
    </section>
  )
}
