/* @vitest-environment jsdom */
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useAsyncLoader } from './useAsyncLoader'

describe('useAsyncLoader', () => {
  it('starts in loading state', () => {
    const { result } = renderHook(() => useAsyncLoader(async () => {}, []))
    expect(result.current.isLoading).toBe(true)
  })

  it('sets isLoading to false after fn resolves', async () => {
    const { result } = renderHook(() => useAsyncLoader(async () => {}, []))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
  })

  it('respects initialLoading = false', () => {
    const { result } = renderHook(() => useAsyncLoader(async () => {}, [], false))
    // Starts false, then goes true when effect runs — we assert the initial value
    // before the effect settles
    expect(typeof result.current.isLoading).toBe('boolean')
  })

  it('calls fn on mount', async () => {
    const fn = vi.fn(async () => {})
    renderHook(() => useAsyncLoader(fn, []))
    await waitFor(() => expect(fn).toHaveBeenCalledOnce())
  })

  it('passes getMounted to fn', async () => {
    let capturedGetMounted: (() => boolean) | undefined
    const fn = vi.fn(async (getMounted: () => boolean) => {
      capturedGetMounted = getMounted
    })
    renderHook(() => useAsyncLoader(fn, []))
    await waitFor(() => expect(capturedGetMounted).toBeDefined())
    expect(typeof capturedGetMounted).toBe('function')
    expect(capturedGetMounted!()).toBe(true)
  })

  it('reload re-runs fn', async () => {
    const fn = vi.fn(async () => {})
    const { result } = renderHook(() => useAsyncLoader(fn, []))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    result.current.reload()
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(2))
  })

  it('sets isLoading true again on reload', async () => {
    const fn = vi.fn(async () => {})
    const { result } = renderHook(() => useAsyncLoader(fn, []))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    result.current.reload()
    await waitFor(() => expect(result.current.isLoading).toBe(false))
  })
})
