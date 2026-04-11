/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => { cleanup() })
import { ConfirmModal } from './ConfirmModal'

const baseProps = {
  isOpen: true,
  title: 'Confirmar eliminacion',
  message: '¿Estas seguro de eliminar este registro?',
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
}

describe('ConfirmModal', () => {
  it('renders nothing when isOpen is false', () => {
    const { container } = render(<ConfirmModal {...baseProps} isOpen={false} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders title and message when open', () => {
    render(<ConfirmModal {...baseProps} />)
    expect(screen.getByText('Confirmar eliminacion')).toBeTruthy()
    expect(screen.getByText('¿Estas seguro de eliminar este registro?')).toBeTruthy()
  })

  it('calls onConfirm when confirm button is clicked', () => {
    const onConfirm = vi.fn()
    render(<ConfirmModal {...baseProps} onConfirm={onConfirm} />)
    fireEvent.click(screen.getByText('Confirmar'))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('calls onCancel when cancel button is clicked', () => {
    const onCancel = vi.fn()
    render(<ConfirmModal {...baseProps} onCancel={onCancel} />)
    fireEvent.click(screen.getByText('Cancelar'))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('does not call onConfirm when cancel is clicked', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<ConfirmModal {...baseProps} onConfirm={onConfirm} onCancel={onCancel} />)
    fireEvent.click(screen.getByText('Cancelar'))
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
