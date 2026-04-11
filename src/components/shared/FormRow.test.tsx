/* @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FormRow } from './FormRow'

describe('FormRow', () => {
  it('renders the label text', () => {
    render(<FormRow label="Nombre"><input /></FormRow>)
    expect(screen.getByText('Nombre')).toBeTruthy()
  })

  it('renders children inside the label', () => {
    render(
      <FormRow label="Campo">
        <input data-testid="field" />
      </FormRow>,
    )
    expect(document.querySelector('[data-testid="field"]')).toBeTruthy()
  })

  it('shows error message when provided', () => {
    render(<FormRow label="Campo" errorMessage="Campo requerido"><input /></FormRow>)
    expect(screen.getByText('Campo requerido')).toBeTruthy()
  })

  it('hides error message when not provided', () => {
    const { container } = render(<FormRow label="Campo"><input /></FormRow>)
    expect(container.querySelector('.text-rose-700')).toBeNull()
  })
})
