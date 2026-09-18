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
  // ONE RETRY BEFORE GIVING UP, counted per url.
  //
  // Giving up on the first error is what made the crests look random. A crest is
  // fetched through /api/token-icon, so any single blip on that hop - a cold
  // serverless start, an upstream rate-limit, a dropped connection - does not
  // cost one frame, it costs that coin its picture for the whole session, and the
  // next load misses a different row. The route retries its own upstream fetch;
  // this covers the hop the route cannot see, the browser's request to us.
  //
  // The key carries the attempt, because re-rendering an <img> whose src has not
  // changed does not re-request it - React writes no attribute, so the browser
  // has nothing to act on. Remounting does.
  const [retry, setRetry] = useState({ url: '', attempts: 0 })
  const attempts = retry.url === logoUrl ? retry.attempts : 0
  if (logoUrl && failed !== logoUrl) return (
    <img
      key={`${logoUrl}#${attempts}`}
      className={`sh-team-mark sh-team-mark--logo ${className}`}
      src={logoUrl}
      alt=""
      aria-hidden="true"
      loading="lazy"
      style={color ? { color } : undefined}
      onError={() => attempts === 0 ? setRetry({ url: logoUrl, attempts: 1 }) : setFailed(logoUrl)}
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

/** Genesis slot order is the numeral each agent carries — c0ke is 0 through to
 *  12ed 13u11 — so `genesis_agents.slot`, the seed order and this list are the
 *  same sequence. A caller that already holds the agent passes `slug` instead. */
export const GENESIS_SKIN_SLUGS = [
  'c0ke', 'peps1', '2up', 'monst3r', 'fant4', '5prite',
  '6uiness', '7iger', 'bintan8', 'hei9ken', 'moun10-dew', '12ed-13u11',
] as const

/** The plain SOLANA ZERO wrap a player's own can wears until they switch it. */
export const DEFAULT_SKIN_SLUG = 'default'

export function agentSkinSlug(number: number) {
  const index = Math.max(0, Math.min(11, Number.isFinite(number) ? Math.floor(number) - 1 : 0))
  return GENESIS_SKIN_SLUGS[index]!
}

/** Each agent's own soda can — the showcase body wearing that agent's wrap, so
 *  the tile is the can and nothing else. `slug` wins when the caller has one, so
 *  an agent whose artwork the database has switched shows the new can without
 *  touching the slot table.
 *
 *  The URL goes out as `--portrait-image`, not `background-image`: the tile
 *  layers the can over a wash of the agent's own accent, and an inline
 *  `background-image` would replace that whole layer list. */
export function AgentPortrait({ number, slug, className = '' }: { number: number; slug?: string; className?: string }) {
  const resolved = slug || agentSkinSlug(number)
  const image = { '--portrait-image': `url('/images/solz/genesis/body/${resolved}.png')` } as CSSProperties
  return <div className={`sh-portrait ${className}`} aria-hidden="true" style={image} />
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

