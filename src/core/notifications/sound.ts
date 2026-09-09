let audioContext: AudioContext | null = null

const getAudioContext = (): AudioContext | null => {
  if (typeof window === 'undefined') {
    return null
  }
  const AudioContextClass =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextClass) {
    return null
  }
  if (!audioContext) {
    audioContext = new AudioContextClass()
  }
  return audioContext
}

// Chime sintetizado (sin archivo de audio) para avisar de una notificacion
// nueva mientras la app esta abierta. Nunca debe romper el flujo de la app,
// por eso todo queda envuelto en try/catch.
export const playNotificationChime = () => {
  try {
    const ctx = getAudioContext()
    if (!ctx) {
      return
    }
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => undefined)
    }

    const now = ctx.currentTime
    const playTone = (frequency: number, start: number, duration: number) => {
      const oscillator = ctx.createOscillator()
      const gain = ctx.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(frequency, now + start)
      gain.gain.setValueAtTime(0, now + start)
      gain.gain.linearRampToValueAtTime(0.18, now + start + 0.02)
      gain.gain.linearRampToValueAtTime(0, now + start + duration)
      oscillator.connect(gain)
      gain.connect(ctx.destination)
      oscillator.start(now + start)
      oscillator.stop(now + start + duration)
    }

    playTone(880, 0, 0.14)
    playTone(1180, 0.16, 0.18)
  } catch {
    // el sonido es un extra, nunca debe romper el flujo de notificaciones
  }
}
