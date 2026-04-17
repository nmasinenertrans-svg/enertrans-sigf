import { Link, useNavigate } from 'react-router-dom'

interface BackLinkProps {
  to?: string
  label?: string
  historyBack?: boolean
}

export const BackLink = ({ to, label = 'Volver', historyBack }: BackLinkProps) => {
  const navigate = useNavigate()
  const className =
    'inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100'
  if (historyBack) {
    return (
      <button type="button" onClick={() => navigate(-1)} className={className}>
        <span className="text-base leading-none">←</span>
        {label}
      </button>
    )
  }
  return (
    <Link to={to!} className={className}>
      <span className="text-base leading-none">←</span>
      {label}
    </Link>
  )
}
