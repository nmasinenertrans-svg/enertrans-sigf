import { useEffect, useRef, useState } from 'react'
import type { BarcodeEntryPayload } from '../types'

interface InventoryBarcodePanelProps {
  onSubmitBarcode: (payload: BarcodeEntryPayload) => void
}

const inputClassName =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-colors focus:border-amber-400'

const minBarcodeLength = 3

export const InventoryBarcodePanel = ({ onSubmitBarcode }: InventoryBarcodePanelProps) => {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const readerRef = useRef<import('@zxing/browser').BrowserMultiFormatReader | null>(null)

  const [barcodeInput, setBarcodeInput] = useState('')
  const [quantityInput, setQuantityInput] = useState(1)
  const [isCameraScanning, setIsCameraScanning] = useState(false)
  const [cameraError, setCameraError] = useState('')

  const hasCameraSupport = Boolean(navigator.mediaDevices?.getUserMedia)

  const stopCamera = () => {
    if (readerRef.current) {
      readerRef.current.reset()
      readerRef.current = null
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

  const submitBarcode = (value: string, quantity = quantityInput) => {
    const normalized = value.trim()
    if (normalized.length < minBarcodeLength || quantity <= 0) return
    onSubmitBarcode({ barcode: normalized, quantity: Math.floor(quantity) })
    setBarcodeInput('')
    setQuantityInput(1)
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
    readerRef.current = reader

    reader.decodeFromVideoElement(video, (result, err) => {
      if (result) {
        const value = result.getText().trim()
        if (value.length >= minBarcodeLength) {
          submitBarcode(value)
          stopCamera()
        }
      }
      // err is expected when no barcode found in frame — ignore
      void err
    })
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
            onChange={(e) => setBarcodeInput(e.target.value)}
            placeholder="Escanea o ingresa codigo"
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); submitBarcode(barcodeInput) }
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
            onChange={(e) => setQuantityInput(Number(e.target.value))}
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => submitBarcode(barcodeInput)}
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
              onClick={() => { void startCamera() }}
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

      {cameraError && (
        <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
          {cameraError}
        </p>
      )}

      {/* Siempre en el DOM para que el ref esté disponible al iniciar la cámara */}
      <div className={`mt-4 overflow-hidden rounded-lg border border-slate-200 bg-slate-900 ${isCameraScanning ? '' : 'hidden'}`}>
        <video ref={videoRef} className="h-56 w-full object-cover" muted playsInline />
      </div>
    </section>
  )
}
