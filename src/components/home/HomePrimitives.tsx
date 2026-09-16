import { useState, type CSSProperties } from 'react'

export const compact = (value: number) => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
export const amountLabel = (value: number) => value.toLocaleString('en', { maximumFractionDigits: 3 })
export const percent = (value: number) => `${Math.round(value * 100)}%`
export const accentStyle = (color: string): CSSProperties => ({ '--team-color': color } as CSSProperties)

/** A team's crest. A registered coin brings its own logo; the built-in marks
 *  cover the seeded simulation teams, and anything unknown gets the generic
 *  mark rather than an empty box.
 *
 *  A LOGO URL THAT DOES NOT LOAD FALLS BACK TO THE MARK. The wire carries
 *  whatever the upstream registry recorded, and a root-relative path like
 *  `/solz_logo.svg` resolves against THIS origin rather than the one that
 *  published it - so the board rendered the browser's broken-image glyph as a
 *  coin's crest. A crest that cannot be fetched is a missing picture, not a
 *  missing coin, and the generic mark says the second thing correctly. */
export function TeamMark({ id, color, logoUrl, className = '' }: { id: string; color?: string; logoUrl?: string; className?: string }) {
  // WHICH url failed, not WHETHER one did. A boolean latched on the first
  // render and never cleared, so a row that started with an unreachable logo and
  // was later handed a working one - which is exactly what the token overlay
  // does a moment after the board lands - kept the fallback mark forever.
  const [failed, setFailed] = useState('')
  if (logoUrl && failed !== logoUrl) return (
    <img
      className={`sh-team-mark sh-team-mark--logo ${className}`}
      src={logoUrl}
      alt=""
      aria-hidden="true"
      loading="lazy"
      style={color ? { color } : undefined}
      onError={() => setFailed(logoUrl)}
    />
  )
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

