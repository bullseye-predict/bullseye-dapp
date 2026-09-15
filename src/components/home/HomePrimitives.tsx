import type { CSSProperties } from 'react'

export const compact = (value: number) => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
export const amountLabel = (value: number) => value.toLocaleString('en', { maximumFractionDigits: 3 })
export const percent = (value: number) => `${Math.round(value * 100)}%`
export const accentStyle = (color: string): CSSProperties => ({ '--team-color': color } as CSSProperties)

export function TeamMark({ id, color, className = '' }: { id: string; color?: string; className?: string }) {
  const shapes: Record<string, React.ReactNode> = {
    'team-bonk': <><path d="M6 18 18 6h10l8 8-14 14H6Z"/><path d="m22 28 14-14v22H22Z"/></>,
    'team-wif': <><path d="M5 12h8v17h6V19h7v10h6V12h7v25H5Z"/><path d="M16 5h13v8H16Z"/></>,
    'team-jup': <><path d="m4 10 31-5 5 7L9 18Zm0 13 31-5 5 7L9 31Zm0 13 31-5 5 7-31 5Z"/></>,
    'team-ansem': <><path d="M4 32 22 4l18 28h-9l-9-14-9 14Z"/><path d="M16 32h12v8H16Z"/></>,
    'team-pengu': <><path d="M10 5h24v8H10Zm-6 9h36v21H4Z"/><path d="M10 36h8v6h-8Zm16 0h8v6h-8Z"/><path d="M12 19h5v5h-5Zm15 0h5v5h-5Z" fill="var(--mark-cutout, #111215)"/></>,
    'team-solz': <><path d="M3 5h35L27 16H3Zm14 14h24L30 30H6ZM3 33h35L27 44H3Z"/></>,
  }
  return <svg className={`sh-team-mark ${className}`} viewBox="0 0 44 48" fill="currentColor" style={color ? { color } : undefined} aria-hidden="true">{shapes[id] ?? <path d="M4 8h14v14H4Zm22 0h14v14H26ZM15 28h14v14H15Z"/>}</svg>
}

export function AgentPortrait({ number, className = '' }: { number: number; className?: string }) {
  const index = Math.max(0, Math.min(11, Number.isFinite(number) ? Math.floor(number) - 1 : 0))
  // The generated atlas has slightly different row boundaries; crop within each row.
  const row = [{ top: 0, height: 336 }, { top: 340, height: 336 }, { top: 680, height: 344 }][Math.floor(index / 4)]
  return <div className={`sh-portrait ${className}`} aria-hidden="true" style={{ backgroundSize: `400% ${1024 / row.height * 100}%`, backgroundPosition: `${(index % 4) * 100 / 3}% ${row.top / (1024 - row.height) * 100}%` }} />
}

export function StatusDot({ children, pink = false }: { children: React.ReactNode; pink?: boolean }) {
  return <span className={`sh-status ${pink ? 'sh-status--pink' : ''}`}><i aria-hidden="true"/>{children}</span>
}

/** The app's one in-place spinner, for a panel that is re-reading rather than a
 *  page that is booting. Styled in site-loading.css, which SiteLayout already
 *  loads on every page, so no surface has to ship its own keyframes. */
export function Spinner({ small = false, label }: { small?: boolean; label?: string }) {
  return <i className={`cc-spinner ${small ? 'cc-spinner--sm' : ''}`} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}/>
}

