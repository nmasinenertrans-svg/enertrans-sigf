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
      setIsSyncing(true)
      syncingRef.current = true
      await syncQueue()
      await refreshCount()
      setIsSyncing(false)
      syncingRef.current = false
    }

    const handleOffline = () => {
      setIsOnline(false)
    }

    refreshCount()

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    const interval = setInterval(async () => {
      await refreshCount()
      if (navigator.onLine && !syncingRef.current) {
        const items = await getQueueItems()
        if (items.length > 0) {
          setIsSyncing(true)
          syncingRef.current = true
          await syncQueue()
          await refreshCount()
          setIsSyncing(false)
          syncingRef.current = false
        }
      }
    }, 5000)

    return () => {
      mounted = false
      clearInterval(interval)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  return { isOnline, pendingCount, isSyncing }
}
