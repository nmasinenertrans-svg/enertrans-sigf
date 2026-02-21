import { useEffect, useRef, useState } from 'react'
import { getQueueItems } from '../../services/offline/queue'
import { syncQueue } from '../../services/offline/sync'

export const useOfflineSync = () => {
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true)
  const [pendingCount, setPendingCount] = useState(0)
  const [isSyncing, setIsSyncing] = useState(false)
  const syncingRef = useRef(false)

  useEffect(() => {
    let mounted = true

    const refreshCount = async () => {
      const items = await getQueueItems()
      if (mounted) {
        setPendingCount(items.length)
      }
    }

    const handleOnline = async () => {
      setIsOnline(true)
      await triggerSync()
    }

    const handleOffline = () => {
      setIsOnline(false)
    }

    const triggerSync = async () => {
      if (syncingRef.current) {
        return
      }
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        return
      }
      const items = await getQueueItems()
      if (items.length === 0) {
        await refreshCount()
        return
      }
      setIsSyncing(true)
      syncingRef.current = true
      await syncQueue()
      await refreshCount()
      setIsSyncing(false)
      syncingRef.current = false
    }

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void triggerSync()
      }
    }

    refreshCount()

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    document.addEventListener('visibilitychange', handleVisibility)

    const interval = setInterval(async () => {
      await triggerSync()
    }, 15000)

    return () => {
      mounted = false
      clearInterval(interval)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])

  return { isOnline, pendingCount, isSyncing }
}
