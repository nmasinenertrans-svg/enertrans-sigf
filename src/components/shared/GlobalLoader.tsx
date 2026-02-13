import { useAppContext } from '../../core/hooks/useAppContext'

export const GlobalLoader = () => {
  const {
    state: { isGlobalLoading },
  } = useAppContext()

  if (!isGlobalLoading) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-sm" role="status" aria-live="polite">
      <div className="rounded-xl border border-slate-600 bg-slate-900 px-6 py-4 text-sm font-semibold text-slate-100">
        Cargando datos globales...
      </div>
    </div>
  )
}
