import type { CSSProperties, ReactNode } from 'react'
import { matchGlyph } from '../portfolio/matchIdentity'
import { shortAddress, traderName } from './profile'
import { useTraderProfile } from './store'

/**
 * How a wallet is drawn — the one place in the app that does it.
 *
 * Every surface showing a trader mounts this: the holders board, the tape,
 * positions, the portfolio header, the wallet chip. Comment out the body here
 * and the whole app loses trader identity at once, which is the point; a helper
 * each surface remembers to call is not one mount point.
 *
 * The address is never hidden, only demoted: it is the accessible name and the
 * hover title on every row, so a handle can never be mistaken for proof of who
 * a wallet belongs to.
 */

export function TraderGlyph({ address, className = '' }: { address: string; className?: string }) {
  const { hue, cells } = matchGlyph(address)
  return <svg className={`id-glyph ${className}`.trim()} viewBox="0 0 7 7" aria-hidden="true">
    <rect width="7" height="7" fill={`hsl(${hue} 28% 18%)`}/>
    {cells.map(([x, y]) => <rect key={`${x}:${y}`} x={x + 1} y={y + 1} width="1" height="1" fill={`hsl(${hue} 66% 68%)`}/>)}
  </svg>
}

/** Avatar only. `className` is the host surface's own avatar class, so the ring
 *  and the per-breakpoint sizing each panel already has keep applying — which is
 *  why the identicon's hue is published as `--avatar-color` rather than painted
 *  here: that is the variable those panels already style themselves from. */
export function TraderAvatar({ address, className = '' }: { address: string; className?: string }) {
  const { profile } = useTraderProfile(address)
  const { hue } = matchGlyph(address)
  return <span className={`id-avatar ${className || 'id-avatar--bare'}`} aria-hidden="true" style={{ '--avatar-color': `hsl(${hue} 62% 66%)` } as CSSProperties}>
    {profile?.imageUrl
      ? <img src={profile.imageUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer"/>
      : <TraderGlyph address={address}/>}
  </span>
}

type Props = {
  address: string
  /** Shown instead of the resolved name. "YOU" on your own row. */
  label?: ReactNode
  self?: boolean
  /** A second line under the name: share count, entry price, whatever the panel
   *  already showed there. */
  sub?: ReactNode
  /** Where the name links. Omitted, the name is plain text — deliberately: this
   *  renders inside a <summary> and inside a <strong> in existing panels, and a
   *  component that decided on its own to emit an anchor would put one in both.
   *  The directory's own profile URL is on `useTraderProfile(...).profile.href`
   *  for a caller that wants to offer it. */
  href?: string
  avatar?: boolean
  /** The host surface's avatar class, e.g. `ev-avatar`. */
  avatarClassName?: string
  /** Decoration drawn over the avatar — the rank pip on a leaderboard. Wrapped
   *  together with the avatar in `badgeClassName`, which is the host panel's own
   *  positioning class. */
  badge?: ReactNode
  badgeClassName?: string
  className?: string
}

export function TraderIdentity({ address, label, self, sub, href, avatar = true, avatarClassName = '', badge, badgeClassName = '', className = '' }: Props) {
  const { profile } = useTraderProfile(address)
  const short = shortAddress(address)
  const body = label ?? traderName(address, profile)
  const face = avatar ? <TraderAvatar address={address} className={avatarClassName}/> : null
  return <span className={`id-trader ${self ? 'is-self' : ''} ${className}`.trim()} title={address}>
    {face && (badge ? <span className={badgeClassName}>{face}{badge}</span> : face)}
    <span className="id-body">
      <span className="id-name">
        {href ? <a href={href}>{body}</a> : body}
        {/* A handle, or a "YOU", stands in front of the wallet it belongs to, so
            the address is read out after it rather than being reachable only by
            hovering. Omitted when the name already IS the address: saying it
            twice is not an accommodation. */}
        {body !== short && <span className="sr-only"> ({short})</span>}
      </span>
      {sub !== undefined && sub !== null && <small className="id-sub">{sub}</small>}
    </span>
  </span>
}
