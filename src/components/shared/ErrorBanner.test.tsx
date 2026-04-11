/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

afterEach(() => { cleanup() })
import { ErrorBanner } from './ErrorBanner'

const mockSetAppError = vi.fn()
let mockAppError: string | null = null

vi.mock('../../core/hooks/useAppContext', () => ({
  useAppContext: () => ({
    state: { appError: mockAppError },
    actions: { setAppError: mockSetAppError },
  }),
}))

describe('ErrorBanner', () => {
  beforeEach(() => {
    mockAppError = null
    mockSetAppError.mockClear()
  })

  it('renders nothing when there is no error', () => {
    mockAppError = null
    const { container } = render(<ErrorBanner />)
    expect(container.firstChild).toBeNull()
  })

  it('displays the error message', () => {
    mockAppError = 'No se pudo conectar al servidor.'
    render(<ErrorBanner />)
    expect(screen.getByText('No se pudo conectar al servidor.')).toBeTruthy()
  })

  it('calls setAppError(null) when close button is clicked', () => {
    mockAppError = 'Error de conexión.'
    render(<ErrorBanner />)
    fireEvent.click(screen.getByText('Cerrar'))
    expect(mockSetAppError).toHaveBeenCalledWith(null)
  })

  it('does not call setAppError when there is no error', () => {
    mockAppError = null
    render(<ErrorBanner />)
    expect(mockSetAppError).not.toHaveBeenCalled()
  })
})
