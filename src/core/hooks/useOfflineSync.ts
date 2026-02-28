import { useEffect, useRef, useState } from 'react'
import { getQueueItems } from '../../services/offline/queue'
import { syncQueue } from '../../services/offline/sync'

export const useOfflineSync = () => {
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true)
  const [pendingCount, setPendingCount] = useState(0)
  const [blockedCount, setBlockedCount] = useState(0)
  const [isSyncing, setIsSyncing] = useState(false)
  const syncingRef = useRef(false)

  useEffect(() => {
    let mounted = true

    const refreshCount = async () => {
      try {
        const items = await getQueueItems()
        if (mounted) {
          setPendingCount(items.length)
          setBlockedCount(items.filter((item) => Boolean(item.blocked)).length)
        }
      } catch {
        if (mounted) {
          setPendingCount(0)
          setBlockedCount(0)
        }
      }
    }

    const handleOnline = async () => {
      setIsOnline(true)
      try {
        await triggerSync()
      } catch {
        // keep hook stable on transient sync failures
      }
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
      try {
        setIsSyncing(true)
        syncingRef.current = true
        await syncQueue()
      } finally {
        await refreshCount()
        setIsSyncing(false)
        syncingRef.current = false
      }
    }

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void triggerSync().catch(() => {
          // keep hook stable on transient sync failures
        })
      }
    }

    refreshCount()

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    document.addEventListener('visibilitychange', handleVisibility)

    const interval = setInterval(async () => {
      try {
        await triggerSync()
      } catch {
        // keep hook stable on transient sync failures
      }
    }, 15000)

    return () => {
      mounted = false
      clearInterval(interval)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])

  return { isOnline, pendingCount, blockedCount, isSyncing }
}
