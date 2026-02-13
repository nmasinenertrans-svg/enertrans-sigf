import { useAppContext } from '../../core/hooks/useAppContext'

export const ErrorBanner = () => {
  const {
    state: { appError },
    actions: { setAppError },
  } = useAppContext()

  if (!appError) {
    return null
  }

  return (
    <div className="mx-6 mt-4 flex items-center justify-between rounded-lg border border-rose-300 bg-rose-100 px-4 py-3 text-sm text-rose-800 md:mx-8">
      <span>{appError}</span>
      <button
        type="button"
        onClick={() => setAppError(null)}
        className="rounded bg-rose-700 px-2 py-1 text-xs font-semibold text-white hover:bg-rose-800"
      >
        Cerrar
      </button>
    </div>
  )
}
