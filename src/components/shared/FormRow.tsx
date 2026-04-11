import type { ReactNode } from 'react'

interface FormRowProps {
  label: string
  errorMessage?: string
  children: ReactNode
}

export const FormRow = ({ label, errorMessage, children }: FormRowProps) => (
  <label className="flex flex-col gap-2">
    <span className="text-sm font-semibold text-slate-700">{label}</span>
    {children}
    {errorMessage ? <span className="text-xs font-semibold text-rose-700">{errorMessage}</span> : null}
  </label>
)
