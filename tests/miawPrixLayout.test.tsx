import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { MiawPrixApp } from '../src/components/miawprix/MiawPrixApp'
import { ProgrammeLayout } from '../src/components/miawprix/ProgrammeLayout'
import { SeasonPanel } from '../src/components/miawprix/SeasonPanel'
import { StandingsTable } from '../src/components/miawprix/StandingsTable'
import { explorerAddressUrl } from '../src/components/miawprix/explorerLink'
import { champion, rankStandings } from '../src/components/miawprix/board'
import type { MiawPrixSeason } from '../src/components/miawprix/miawPrixSource'

const NOW = Date.parse('2026-09-16T12:00:00.000Z')

/** A devnet venue in the shape the prediction service publishes. Fixture only —
 *  no real mint is spelled anywhere in this file, because a wrong contract
 *  address beside a copy control costs somebody money. */
const DEVNET = { family: 'SOLANA', chainId: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG', explorerUrl: 'https://explorer.solana.com' }
const MAINNET = { ...DEVNET, chainId: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d' }

const season = (over: Partial<MiawPrixSeason> = {}): MiawPrixSeason => ({
  seasonId: 'solz-00', seasonIndex: 0, startsAt: NOW - 86_400_000, endsAt: NOW + 86_400_000, status: 'live', ...over,
})

const layout = (narrow: boolean) => renderToStaticMarkup(<ProgrammeLayout
  narrow={narrow}
  standings={<p>THE-STANDINGS</p>}
  schedule={<p>THE-SCHEDULE</p>}
  results={<p>THE-RESULTS</p>}
/>)

const standings = rankStandings([
  { mint: 'MintA', symbol: '$ALPHA', name: 'Alpha', wins: 5, losses: 3, matches: 8, marketCapUsd: 12_400_000 },
  // No capitalisation reported at all: the field is absent, not zero.
  { mint: 'MintB', symbol: '$BETA', name: 'Beta', wins: 2, losses: 4, matches: 6 },
])

/* ── The owner's layout ───────────────────────────────────────────────────── */
/* "miaw prix, on table and schedule can split col (3 and 2), and under schedule
 *  the results. thats for desktop, if on mobile just use tab." */

test('desktop splits the programme into two columns, with the results under the schedule', () => {
  const html = layout(false)
  expect(html).toContain('mp-board-main')
  expect(html).toContain('mp-board-side')
  // Standings lead; the schedule and the results share the second column, in
  // that order, so the results sit UNDER the schedule rather than beside it.
  expect(html.indexOf('THE-STANDINGS')).toBeLessThan(html.indexOf('THE-SCHEDULE'))
  expect(html.indexOf('THE-SCHEDULE')).toBeLessThan(html.indexOf('THE-RESULTS'))
  const side = html.slice(html.indexOf('mp-board-side'))
  expect(side).toContain('THE-SCHEDULE')
  expect(side).toContain('THE-RESULTS')
  expect(side).not.toContain('THE-STANDINGS')
})

test('a narrow viewport gets tabs, and the desktop columns are not merely hidden — they are gone', () => {
  const html = layout(true)
  expect(html).toContain('role="tablist"')
  expect(html).toContain('aria-label="MIAW PRIX programme"')
  expect(html).not.toContain('mp-board-main')
  expect(html).not.toContain('mp-board-side')
})

/* THE POINT OF DOING THIS IN JS RATHER THAN CSS.
 *
 * A tab panel that is only visually hidden still ships its rows: a screen reader
 * walks three tables, in-page find matches rows nobody can see, and the browser
 * lays all of them out. Only the selected panel's children are built. */
test('only the selected tab panel carries its surface; the other two are empty shells', () => {
  const html = layout(true)
  expect(html).toContain('THE-STANDINGS')
  expect(html).not.toContain('THE-SCHEDULE')
  expect(html).not.toContain('THE-RESULTS')
  // The empty panels still exist, so the tablist's aria-controls point at
  // something real and focus has somewhere to land when a tab is chosen.
  expect(html).toContain('id="mp-schedule-panel"')
  expect(html).toContain('id="mp-results-panel"')
  expect(html).toContain('hidden=""')
})

test('exactly one of the two layouts is in the DOM at a time', () => {
  const desktop = layout(false)
  const mobile = layout(true)
  // Desktop carries no tab machinery at all.
  expect(desktop).not.toContain('role="tablist"')
  expect(desktop).not.toContain('role="tabpanel"')
  // Mobile carries no column machinery at all.
  expect(mobile).not.toContain('mp-board-main')
  expect(mobile).not.toContain('mp-board-side')
  // And the three surfaces are never built twice in either.
  for (const html of [desktop, mobile]) {
    expect(html.match(/THE-STANDINGS/g) ?? []).toHaveLength(1)
  }
})

test('the page itself boots into the desktop columns, so a viewer without matchMedia still sees all three', () => {
  const html = renderToStaticMarkup(<MiawPrixApp endpoint="/api/agent-arena" predictionApiUrl="/api/prediction" />)
  expect(html).toContain('mp-board-main')
  expect(html).toContain('mp-board-side')
  expect(html).toContain('Standings')
  expect(html).toContain('Schedule')
  expect(html).toContain('Results')
  expect(html).not.toContain('role="tablist"')
})

/* ── The crest ────────────────────────────────────────────────────────────── */

test('a coin leads its row with a real crest, sized by the page token rather than by eye', () => {
  const html = renderToStaticMarkup(<StandingsTable rows={standings} loading={false} unavailable="" venue={DEVNET} />)
  expect(html).toContain('mp-crest')
  // The loading state stands in for the same mark, so nothing resizes when the
  // read lands.
  const pending = renderToStaticMarkup(<StandingsTable rows={[]} loading unavailable="" venue={DEVNET} />)
  expect(pending).toContain('mp-pending--mark')
  expect(pending).toContain('mp-pending--mint')
})

/* ── Contract address ─────────────────────────────────────────────────────── */

test('every coin publishes its symbol and its whole contract address, copyable', () => {
  const html = renderToStaticMarkup(<StandingsTable rows={standings} loading={false} unavailable="" venue={DEVNET} />)
  expect(html).toContain('$ALPHA')
  expect(html).toContain('<code>MintA</code>')
  expect(html).toContain('<code>MintB</code>')
  expect(html).toContain('Copy the contract address for $ALPHA')
})

test('the explorer link is built from the venue, and no venue means no link rather than a guessed one', () => {
  const linked = renderToStaticMarkup(<StandingsTable rows={standings} loading={false} unavailable="" venue={DEVNET} />)
  expect(linked).toContain('https://explorer.solana.com/address/MintA?cluster=devnet')
  expect(linked).toContain('mp-mint-link')

  const unlinked = renderToStaticMarkup(<StandingsTable rows={standings} loading={false} unavailable="" venue={null} />)
  expect(unlinked).not.toContain('mp-mint-link')
  expect(unlinked).not.toContain('explorer.solana.com')
  // The address is still published and still copyable without a link.
  expect(unlinked).toContain('<code>MintA</code>')
  expect(unlinked).toContain('mp-mint-copy')
})

test('an address link names the account, on the venue’s own cluster', () => {
  expect(explorerAddressUrl(DEVNET, 'MintA')).toBe('https://explorer.solana.com/address/MintA?cluster=devnet')
  // Mainnet-beta takes no cluster parameter.
  expect(explorerAddressUrl(MAINNET, 'MintA')).toBe('https://explorer.solana.com/address/MintA')
  // A trailing slash on the configured explorer must not double up in the path.
  expect(explorerAddressUrl({ ...DEVNET, explorerUrl: 'https://explorer.solana.com/' }, 'MintA'))
    .toBe('https://explorer.solana.com/address/MintA?cluster=devnet')
  // An EVM venue uses its own explorer rather than Solana's.
  expect(explorerAddressUrl({ family: 'EVM', chainId: '50312', explorerUrl: 'https://shannon-explorer.somnia.network' }, '0xabc'))
    .toBe('https://shannon-explorer.somnia.network/address/0xabc')
  // Nothing configured, nothing to link.
  expect(explorerAddressUrl(null, 'MintA')).toBeUndefined()
  expect(explorerAddressUrl({ family: 'SOLANA', chainId: 'x' }, 'MintA')).toBeUndefined()
  expect(explorerAddressUrl(DEVNET, '')).toBeUndefined()
})

/* ── Prediction aggregates ────────────────────────────────────────────────── */

test('standings reserve prediction pool and volume while market cap stays out', () => {
  const html = renderToStaticMarkup(<StandingsTable rows={standings} loading={false} unavailable="" venue={null} />)
  expect(html).toContain('Prediction pool')
  expect(html).toContain('Volume')
  expect(html).toContain('Prediction pool is not published yet')
  expect(html).toContain('Aggregate prediction volume is not published yet')
  expect(html).not.toContain('Market cap')
  expect(html).not.toContain('$12.4M')
  expect(html).not.toContain('$0')
})

test('empty prediction aggregates are unknown rather than invented liquidity', () => {
  const html = renderToStaticMarkup(<StandingsTable rows={standings} loading={false} unavailable="" venue={null} />)
  expect(html).toContain('mp-unknown')
  expect(html).not.toContain('mp-cap')
  expect(html).not.toContain('mp-volume')
})

/* ── Middle dots ──────────────────────────────────────────────────────────── */

test('the page separates facts with layout and labels, not with middle dots', () => {
  const booting = renderToStaticMarkup(<MiawPrixApp endpoint="/api/agent-arena" predictionApiUrl="/api/prediction" />)
  expect(booting).not.toContain('·')

  const picker = renderToStaticMarkup(<SeasonPanel
    season={season()} seasons={[season(), season({ seasonId: 'solz-01', seasonIndex: 1, status: 'upcoming' })]}
    champion={null} now={NOW} loading={false} onSelect={() => {}}
  />)
  expect(picker).not.toContain('·')
  expect(picker).toContain('SEASON 01 (Not started)')

  const closed = season({ status: 'closed' })
  const rows = rankStandings([{ mint: 'MintA', symbol: '$ALPHA', name: 'Alpha', wins: 7, losses: 4, matches: 11 }])
  const winner = renderToStaticMarkup(<SeasonPanel
    season={closed} seasons={[]} champion={champion(closed, rows)} now={NOW} loading={false} venue={DEVNET} onSelect={() => {}}
  />)
  expect(winner).not.toContain('·')
  // The record is three labelled figures now, not "7—4 from 11 matches".
  expect(winner).toContain('mp-figure')
  expect(winner).toContain('Won')
  expect(winner).toContain('Lost')
  // ...and the em dash is not spent as a separator between two numbers that are
  // perfectly well known. On this page an em dash means UNKNOWN.
  expect(winner).not.toContain('7—4')
  expect(winner).toContain('Matches')
})
