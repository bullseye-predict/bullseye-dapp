import type { ArenaMarket, ArenaMarketOutcome, SolzSnapshot } from '../solz/model'
import { outcomeColor } from '../home/heroMarket'
import { logoHue } from './logoIdentity'

/** A moneyline is a two-sided TEAM market: its outcomes are the teams
 *  themselves, so "Yes" and "No" are not what the trader is choosing between.
 *  There — and only there — the trading controls carry team identity.
 *
 *  On a multi-outcome market the answer is a candidate and each row is its own
 *  independent Yes/No book, so the team colour belongs to the answer's text and
 *  mark while the Buy controls keep the green/red pair. */
export const isMoneyline = (market: ArenaMarket) =>
  market.presentation?.kind === 'head-to-head' && market.outcomes.length === 2

/**
 * A head-to-head side needs one portable identity, even when its logo arrives
 * from a different source on the directory and event screens. Hashing the
 * canonical displayed team name gives the same vivid, readable hex everywhere
 * without waiting for an image download or depending on its CORS policy.
 *
 * WHEN THE CREST HAS BEEN READ, ITS HUE WINS. The hash's hue is arbitrary - an
 * orange cat drew a blue-violet button - so a sampled crest replaces it while
 * the hash keeps deciding saturation and lightness. That band (58-68% / 44-51%)
 * is what makes every control on the board one weight and keeps `pickInk` able
 * to find a readable ink, which a raw sampled colour cannot promise. Sampling is
 * asynchronous, so the hash hue is also the answer on first paint and for any
 * crest that is missing, greyscale, or on a host this site will not proxy: see
 * src/components/markets/logoIdentity.ts.
 *
 * This is intentionally for team-versus-team markets only. Yes/No contracts
 * remain semantic green/red rather than acquiring a decorative identity.
 */
export function teamIdentityColor(name: string, logoUrl?: string) {
  const input = name.trim().toLocaleUpperCase() || 'TEAM'
  let hash = 2_166_136_261
  for (const character of input) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16_777_619)
  }
  const hue = logoHue(logoUrl) ?? (hash >>> 0) % 360
  const saturation = 58 + ((hash >>> 9) % 11)
  const lightness = 44 + ((hash >>> 17) % 7)
  const chroma = (1 - Math.abs(2 * lightness / 100 - 1)) * saturation / 100
  const segment = hue / 60
  const x = chroma * (1 - Math.abs(segment % 2 - 1))
  const [red, green, blue] = segment < 1 ? [chroma, x, 0] : segment < 2 ? [x, chroma, 0] : segment < 3 ? [0, chroma, x] : segment < 4 ? [0, x, chroma] : segment < 5 ? [x, 0, chroma] : [chroma, 0, x]
  const offset = lightness / 100 - chroma / 2
  const channel = (value: number) => Math.round((value + offset) * 255).toString(16).padStart(2, '0')
  return `#${channel(red)}${channel(green)}${channel(blue)}`
}

/** What a chart should draw for this market.
 *
 *  The one place that answers it. Four different signals each half-answered it
 *  before — `outcomes.length > 2`, `presentation.kind`, `ArenaMarketKind`, and a
 *  `nested` prop — at four different layers, so a binary market could be drawn
 *  as one series on one surface and two on another.
 *
 *  - `both-sides`: one market, two complementary books. NO is 1 - YES, so both
 *    lines belong on one axis at once with no toggle between them.
 *  - `all-answers`: a field of independent books, one line per answer.
 *  - `single-answer`: one answer of a field, viewed on its own. Its NO leg is a
 *    mirror of its YES leg, so drawing both would be one line rendered twice.
 */
export type ChartShape = 'both-sides' | 'all-answers' | 'single-answer'

export function chartShape(market: ArenaMarket, { nested = false }: { nested?: boolean } = {}): ChartShape {
  if (nested) return 'single-answer'
  if (isMoneyline(market)) return 'both-sides'
  if (market.outcomes.length > 2) return 'all-answers'
  if (market.outcomes.length === 2) return 'both-sides'
  return 'single-answer'
}

/** The colour a trading control should take, or undefined when the default
 *  green/red trading semantics apply. One rule, called from every list and from
 *  the trade ticket, so the three surfaces cannot disagree about a market. */
export function pickColor(market: ArenaMarket, outcome: ArenaMarketOutcome, snapshot: SolzSnapshot, index: number) {
  // Kept in the signature so every existing surface can call this one policy
  // function. Head-to-head identity is intentionally independent of the current
  // snapshot; `index` is only a positional fallback for finding this side's
  // crest, never an input to the colour itself.
  void snapshot
  if (!isMoneyline(market)) return undefined
  return teamIdentityColor(outcome.label, outcomeLogo(market, outcome, index))
}

/** This side's crest, as the presentation published it. Matched by label first
 *  because that is what the colour is keyed on everywhere else, and by position
 *  only when a label has been renamed under us - `useQuestionIdentity` rewrites
 *  a bare ticker to the registry's symbol, so the two can briefly disagree. */
function outcomeLogo(market: ArenaMarket, outcome: ArenaMarketOutcome, index: number) {
  const sides = market.presentation?.kind === 'head-to-head' ? market.presentation.outcomes : undefined
  if (!sides) return undefined
  return (sides.find((side) => side.label === outcome.label) ?? sides[index])?.imageUrl
}

/** The display name for a market line. Head-to-head questions are written as a
 *  sentence ("Who will win: JUP or ANSEM?") but read as a sportsbook line; the
 *  event title already names the fixture above it. */
export function marketLineTitle(market: ArenaMarket) {
  return market.presentation?.kind === 'head-to-head' ? 'Moneyline' : market.title
}

/** Readable ink for a fill of an arbitrary team colour. A moneyline button is
 *  painted with whatever hex the presentation supplies, so a hard-coded
 *  near-black foreground was unreadable on a dark team colour and a near-white
 *  one unreadable on a bright one. */
export function pickInk(color: string | undefined) {
  if (!color) return undefined
  const hex = color.replace('#', '')
  if (hex.length !== 6) return undefined
  const channel = (at: number) => {
    const value = parseInt(hex.slice(at, at + 2), 16) / 255
    return value <= .03928 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4
  }
  const luminance = .2126 * channel(0) + .7152 * channel(2) + .0722 * channel(4)
  return luminance > .35 ? '#0b1410' : '#f6fbff'
}
