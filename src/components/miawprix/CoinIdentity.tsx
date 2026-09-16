import { useState } from 'react'
import { Check, Copy, ExternalLink } from 'lucide-react'
import { TeamMark } from '../home/HomePrimitives'
import { explorerAddressUrl, type ExplorerVenue } from './explorerLink'

/**
 * A team on this page is a coin, so every row leads with the coin's own CREST,
 * ticker and name. "Team 1" is never rendered: the mint is the identity and the
 * symbol is how a reader recognises it.
 *
 * The crest is sized from `--mp-crest`, which now matches CATWALK's `--cw-crest`
 * and carries the same team-coloured ring. The two pages are read one after the
 * other — CATWALK is the lineup, this is the programme it feeds — and a coin
 * that shrank between them read as a different, lesser thing.
 */
export function CoinIdentity({ mint, symbol, name, logoUrl, color, muted = false, address = false, onLight = false, venue }: {
  mint: string
  symbol: string
  name: string
  logoUrl?: string
  color?: string
  /** A side that did not win. Its colour recedes but its identity stays whole. */
  muted?: boolean
  /** Publish the contract address under the name, copyable and linked out.
   *  On for the surfaces that list a coin once (standings, champion); off in a
   *  pairing cell, where two of them would bury the fixture. */
  address?: boolean
  /** This coin is drawn on the light --sh-gray standings table rather than on
   *  the page's dark panel.
   *
   *  IDENTITY MOVES TO THE CREST, IT DOES NOT DISAPPEAR. The ticker colours are
   *  chosen against #191a1e, and half of them - every lime, sky and violet the
   *  board issues - drop to near-invisible on #a6a8b3. The crest keeps the coin's
   *  colour at full strength on a surface it still works on, and the ticker takes
   *  the table's ink so the row can actually be read. The alternative is a second
   *  colour per coin per surface, which is two sources of truth for one identity. */
  onLight?: boolean
  /** Venue record for the explorer link. Absent means no link is rendered —
   *  never a guessed one. */
  venue?: ExplorerVenue | null
}) {
  return <span className={`mp-coin ${muted ? 'is-muted' : ''}`}>
    <TeamMark id={mint} color={color} logoUrl={logoUrl} className="mp-crest" />
    <span className="mp-coin-text">
      <b style={color && !muted && !onLight ? { color } : undefined}>{symbol}</b>
      <small>{name}</small>
      {address && mint ? <CoinAddress mint={mint} symbol={symbol} venue={venue} /> : null}
    </span>
  </span>
}

/**
 * The contract address, in full, copyable, and linked to the explorer.
 *
 * IN FULL, deliberately. A truncated mint is a convenience for the eye and a
 * hazard for the hand: two coins can share a 4-and-4 abbreviation, and this page
 * carries a copy control that puts a real address on somebody's clipboard. What
 * is shown and what is copied are therefore the same string.
 *
 * The link is built by the explorer adapter from the venue record. No venue
 * means no link — not a link to whichever chain happened to be hardcoded.
 */
export function CoinAddress({ mint, symbol, venue }: { mint: string; symbol: string; venue?: ExplorerVenue | null }) {
  const [copied, setCopied] = useState(false)
  const href = explorerAddressUrl(venue, mint)
  return <span className="mp-mint">
    <button
      type="button"
      className="mp-mint-copy"
      // The visible code is the whole address, so the accessible name states
      // what the control DOES rather than re-reading 44 base58 characters.
      aria-label={copied ? `Contract address for ${symbol} copied` : `Copy the contract address for ${symbol}`}
      title={copied ? 'Copied' : 'Copy contract address'}
      onClick={(event) => {
        event.stopPropagation()
        try {
          void navigator.clipboard?.writeText(mint).then(() => {
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1_600)
          })
        } catch { /* a clipboard the browser refuses is not worth an error state */ }
      }}
    >
      <code>{mint}</code>
      {copied ? <Check size={11} aria-hidden="true" /> : <Copy size={11} aria-hidden="true" />}
    </button>
    {href && <a className="mp-mint-link" href={href} target="_blank" rel="noreferrer" aria-label={`Open ${symbol} in the block explorer`}>
      <ExternalLink size={11} aria-hidden="true" />
    </a>}
  </span>
}
