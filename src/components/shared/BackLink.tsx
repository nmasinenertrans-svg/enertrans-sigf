import { Link } from 'react-router-dom'

interface BackLinkProps {
  to: string
  label?: string
}

export const BackLink = ({ to, label = 'Volver' }: BackLinkProps) => (
  <Link
    to={to}
    className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
  >
    <span className="text-base leading-none">←</span>
    {label}
  </Link>
)
