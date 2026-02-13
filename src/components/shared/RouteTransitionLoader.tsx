import logo from '../../assets/enertrans-logo.png'

interface RouteTransitionLoaderProps {
  isActive: boolean
}

export const RouteTransitionLoader = ({ isActive }: RouteTransitionLoaderProps) => {
  if (!isActive) {
    return null
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 backdrop-blur-sm"
      role="status"
      aria-live="polite"
    >
      <div className="relative flex w-full max-w-sm flex-col items-center gap-6 rounded-3xl border border-amber-400/30 bg-slate-950/80 px-8 py-10 text-center shadow-[0_20px_60px_rgba(0,0,0,0.5)]">
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-3xl">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_#fbbf24_0%,_rgba(15,23,42,0.6)_45%,_rgba(2,6,23,1)_75%)]" />
        </div>

        <div className="relative z-10 flex flex-col items-center gap-4">
          <div className="rounded-full border border-amber-400/40 bg-slate-900/80 p-4">
            <img src={logo} alt="Enertrans" className="h-12 w-auto enertrans-spin-slow" />
          </div>
          <div className="text-xs font-semibold uppercase tracking-[0.35em] text-amber-300">Enertrans</div>
        </div>

        <div className="relative z-10 flex flex-col items-center gap-2">
          <div className="h-10 w-24 overflow-hidden">
            <div className="enertrans-truck-move text-amber-300">
              <svg viewBox="0 0 120 48" className="h-10 w-24" fill="currentColor">
                <rect x="8" y="14" width="54" height="20" rx="3" />
                <rect x="62" y="18" width="24" height="16" rx="2" />
                <rect x="86" y="22" width="18" height="12" rx="2" />
                <circle cx="26" cy="38" r="6" />
                <circle cx="56" cy="38" r="6" />
                <circle cx="82" cy="38" r="6" />
                <circle cx="104" cy="38" r="6" />
              </svg>
            </div>
          </div>
          <p className="text-xs font-semibold text-slate-200">Cargando modulo...</p>
        </div>
      </div>
    </div>
  )
}
