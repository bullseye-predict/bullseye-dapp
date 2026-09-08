import type { ReactNode } from 'react'

export function AnimatedCollapse({ open, id, labelledBy, className = '', children }: { open: boolean; id?: string; labelledBy?: string; className?: string; children: ReactNode }) {
  return <div id={id} className={`ch-collapse ${open ? 'is-expanded' : ''} ${className}`} role={labelledBy ? 'region' : undefined} aria-labelledby={labelledBy} aria-hidden={!open} inert={!open}>
    <div className="ch-collapse-inner">{children}</div>
  </div>
}
