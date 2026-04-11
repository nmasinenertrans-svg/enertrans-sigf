import { useCallback, useEffect, useRef, useState } from 'react'

interface UseAsyncLoaderResult {
  isLoading: boolean
  reload: () => void
}

/**
 * Runs an async loader on mount and whenever deps change.
 * Manages isLoading state and handles unmount cleanup automatically.
 *
 * @param fn - Async function to run. Receives getMounted() — returns false if the component unmounted.
 * @param deps - Effect dependencies (same as useEffect deps)
 * @param initialLoading - Whether isLoading starts as true on first render (default: true)
 */
export function useAsyncLoader(
  fn: (getMounted: () => boolean) => Promise<void>,
  deps: ReadonlyArray<unknown>,
  initialLoading = true,
): UseAsyncLoaderResult {
  const [isLoading, setIsLoading] = useState(initialLoading)
  const fnRef = useRef(fn)
  fnRef.current = fn

  const run = useCallback(() => {
    let mounted = true
    setIsLoading(true)
    void fnRef.current(() => mounted).finally(() => {
      if (mounted) setIsLoading(false)
    })
    return () => {
      mounted = false
    }
  }, [])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => run(), deps)

  return {
    isLoading,
    reload: useCallback(() => {
      void run()
    }, [run]),
  }
}
