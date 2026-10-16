import type { LucideIcon } from 'lucide-react'

interface Props {
  icon: LucideIcon
  title: string
  description: string
}

export default function EmptyState({ icon: Icon, title, description }: Props) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      <Icon className="h-10 w-10 text-slate-400" aria-hidden />
      <h2 className="mt-3 text-base font-semibold text-slate-800">{title}</h2>
      <p className="mt-1 max-w-md text-sm text-slate-500">{description}</p>
    </div>
  )
}
