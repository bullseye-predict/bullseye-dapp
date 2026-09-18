import { ArrowDownRight, ArrowRight, ArrowUpRight, Check, Copy, Eye } from 'lucide-react'
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import type { CatwalkLane, SolzMatch, SolzSnapshot } from '../solz/model'
import { Tabs, TabPanel, formatClock } from '../solz/ui'
import { amountLabel, StatusDot, TeamMark } from './HomePrimitives'
import type { SolzWatchMatch } from './useSolzWatchMatches'
import type { ArenaScheduleEntry } from '../agent-arena/model'
import { matchIdLabel } from './heroMarket'
import {
  countdown, EM_DASH, isWinner, kickoffParts, matchState, programmeLabel, rankStandings, seasonLabel, splitMatches,
} from '../miawprix/board'
import type { MiawPrixBoard, MiawPrixCoinSide, MiawPrixMatch } from '../miawprix/miawPrixSource'
import { identify } from './useMiawPrixHighlight'
import { eventHref } from '../events/eventModel'
import { overlayTokenMeta, useTokenMeta } from '../solz/tokenMeta'
import { resolvedTokenLogo } from '../solz/tokenIcon'
import { teamIdentityColor } from '../markets/moneyline'
import { useLogoPalette } from '../markets/logoIdentity'
import { buildBoard, cheapestSeat, pad, type CatwalkRow } from '../catwalk/catwalkBands'
import type { CatwalkFeed } from '../catwalk/useCatwalkBoard'
import { usdLabel } from '../solz/catwalkSource'
import '../../styles/home-community.css'

function matchTeams(match: SolzMatch) {
  return match.teams.length > 2
    ? `${match.teams.length}-TEAM FREE FOR ALL`
    : match.teams.map((team) => team.symbol).join(' VS ')
}

function matchStart(match: SolzMatch, now: number) {
  const remaining = Math.max(0, match.startedAt - now)
  if (remaining < 60_000) return 'NOW'
  if (remaining < 3_600_000) return `IN ${formatClock(remaining)}`
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(match.startedAt)
}

/** The two identity colours this card is drawn with, as SEPARATE properties.
 *
 *  Deliberately not a ready-made gradient. The card used to be washed in
 *  `linear-gradient(105deg, a, b)`, which blends two coin colours into a third
 *  that belongs to neither side - and five cards of it read as one long smear
 *  with the text fighting whatever landed underneath. The card paints these as
 *  a hard split instead, half the top edge each, so the two sides stay two.
 *
 *  A free-for-all has more than two teams and takes the first two; the rail is
 *  a glance, not a legend. */
function matchSides(match: SolzMatch): CSSProperties {
  const [first, second] = match.teams.map((team) => team.color).filter(Boolean)
  return { '--side-a': first ?? '#5b7288', '--side-b': second ?? first ?? '#3b4b5c' } as CSSProperties
}

/** How many cards the rail shows, including the leading live one. */
const RAIL_CARDS = 5

/** The readable half of the card's meta line.
 *
 * The line used to print `matchIdLabel` unconditionally, and that label falls
 * back to the raw service id - `GM-DM_DR-20_TS-1789685276_ID-EF27D924` - which
 * filled the card with a blob nobody can read, directly beside a copy chip
 * carrying a SECOND, different id. Only a humanised label earns the line; the
 * machine identity stays in the chip, where it can be copied. */
function highlightMeta(match: SolzMatch, season: string) {
  const label = matchIdLabel(match)
  const parts = /^MATCH #[0-9A-Z]+$/.test(label)
    ? [season, label]
    : [season, match.mode, match.map]
  return parts.filter(Boolean).map((part) => part.toUpperCase()).join(' · ')
}

/** The match this page is built around, as the rail's leading card.
 *
 * This carries the identity the old header row used to show - series, season,
 * match ID and its copy control - because the header row is gone and the rail
 * is the one strip visible from every tab. A LIVE card also carries the running
 * clock and the viewer count: on a strip that says a match is happening right
 * now, "how far in" is the first thing a reader asks, and it was not on it. */
function HighlightCard({ match, season, seasonName, copied, onCopy }: { match: SolzMatch; season: boolean; seasonName: string; copied: boolean; onCopy: () => void }) {
  const live = match.phase === 'live'
  const shortId = match.id.replace(/^arena-/, '')
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!live) return
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [live])
  // A countdown match shows the time it has LEFT, an open-ended one the time it
  // has run. Both read off the same second tick.
  const countdown = match.timingType !== 'open-ended' && match.endsAt > match.startedAt
  const clock = live
    ? countdown
      ? `${formatClock(Math.max(0, match.endsAt - now))} LEFT`
      : formatClock(Math.max(0, now - match.startedAt))
    : null
  return <div role="listitem" className="sh-next-match sh-next-match--live" style={matchSides(match)}>
    <div>
      <StatusDot pink={!live}>{live ? 'LIVE MATCH' : season ? 'SEASON HIGHLIGHT' : 'HIGHLIGHT MATCH'}</StatusDot>
      {clock && <span className="sh-next-clock"><time dateTime={new Date(match.startedAt).toISOString()}>{clock}</time></span>}
      {match.viewers > 0 && <span className="sh-next-viewers" title={`${amountLabel(match.viewers)} watching`}><Eye size={11} aria-hidden="true"/>{amountLabel(match.viewers)}</span>}
      <a href="#highlight" aria-label="Jump to the highlighted match"><ArrowUpRight size={15}/></a>
    </div>
    <div className="sh-next-matchup">
      <span className="sh-next-teams" aria-hidden="true">{match.teams.map((team) => <TeamMark key={team.teamId} id={team.teamId} color={team.color} logoUrl={team.logoUrl}/>)}</span>
      <strong>{matchTeams(match)}</strong>
    </div>
    <span className="sh-next-detail">
      <span>{highlightMeta(match, seasonName)}</span>
      <button className="sh-match-id" type="button" title={`Copy full match ID${match.displayMatchId ? ` · ${match.displayMatchId}` : ''}`} aria-label={`Copy match ID ${shortId}`} onClick={onCopy}>
        {copied ? <Check size={11} aria-hidden="true"/> : <Copy size={11} aria-hidden="true"/>}
        <code>{shortId.slice(0, 4)}…{shortId.slice(-4)}</code>
      </button>
    </span>
  </div>
}

/** Scheduled matches remain a horizontal browse surface so the arena stays the page focus. */
export function NextMatches({ snapshot, schedule, programme, seasonName = 'SEASON 01', eventBasePath, highlight, season = false, matchIdCopied = false, onCopyMatchId }: {
  snapshot: SolzSnapshot | null
  schedule: ArenaScheduleEntry[]
  /** The MIAW PRIX cards after the highlight, kickoff first. When the programme
   *  answers, the rail IS the programme: a Genesis arena room and an arena
   *  planning slot are a different show, and mixing them into the same five
   *  cards would read as the next coin fixtures. */
  programme?: SolzMatch[]
  /** How the programme numbers its season. MIAW PRIX opens at SEASON 00. */
  seasonName?: string
  eventBasePath: string
  highlight?: SolzMatch
  season?: boolean
  matchIdCopied?: boolean
  onCopyMatchId?: () => void
}) {
  // Five cards, always. The rail used to run to nine and scroll sideways, which
  // put the match this page is about inside a scroller and left the row ending
  // on a half-cut chevron. A fixed budget is what lets it be a finished shape.
  const slots = RAIL_CARDS - (highlight ? 1 : 0)
  const scheduled = programme?.length ? programme : null
  const matches = (scheduled ?? (snapshot?.matches ?? [])
    .filter((match) => match.phase === 'countdown' || match.phase === 'queued'))
    // The leading card already is the highlight; listing it again as UP NEXT
    // would say the match both is running and has not started.
    .filter((match) => match.id !== highlight?.id)
    .slice()
    .sort((a, b) => a.startedAt - b.startedAt)
    .slice(0, slots)
  const planned = scheduled ? [] : schedule.filter((entry) =>
    entry.state === 'planned' || !matches.some((match) => match.roomId === entry.roomId),
  ).slice(0, Math.max(0, slots - matches.length))
  return <section className="sh-next-matches" aria-label="Upcoming match markets">
    <div className="sh-next-match-rail" role="list">
      {highlight && <HighlightCard match={highlight} season={season} seasonName={seasonName} copied={matchIdCopied} onCopy={() => onCopyMatchId?.()}/>}
      {matches.map((match) => <a key={match.id} role="listitem" className="sh-next-match" style={matchSides(match)} href={`${eventBasePath}/${encodeURIComponent(match.id)}`} aria-label={`Open early prediction market for ${matchTeams(match)}`}>
        {/* The programme's own clock, not the arena snapshot's: a MIAW PRIX
            card comes from a separate read that can land first. */}
        <div><span className="sh-next-status">UP NEXT · {matchStart(match, snapshot?.updatedAt ?? Date.now())}</span><ArrowUpRight size={15}/></div>
        <div className="sh-next-matchup"><span className="sh-next-teams" aria-hidden="true">{match.teams.map((team) => <TeamMark key={team.teamId} id={team.teamId} color={team.color} logoUrl={team.logoUrl}/>)}</span><strong>{matchTeams(match)}</strong></div>
      </a>)}
      {planned.map((entry, index) => <div key={`${entry.definition.id}:${entry.roomId ?? entry.state}:${index}`} role="listitem" className="sh-next-match" style={{ '--side-a': '#c7ff00', '--side-b': '#65cfff' } as CSSProperties} aria-label={`Upcoming ${entry.definition.title}: ${entry.definition.requiredPlayers} agents, ${formatClock(entry.definition.matchDurationMs)}`}>
        <div><span className="sh-next-status">UP NEXT · {entry.definition.title}</span></div>
        <div className="sh-next-matchup"><span className="sh-next-teams" aria-hidden="true"><TeamMark id="team-1" color="#c7ff00"/><TeamMark id="team-2" color="#65cfff"/></span><strong>{entry.definition.teamFormat === 'ffa' ? `${entry.definition.requiredPlayers} AGENTS FFA` : `${entry.definition.playersPerTeam}V${entry.definition.playersPerTeam} TEAM MATCH`}</strong></div>
      </div>)}
      {Array.from({ length: Math.max(0, slots - matches.length - planned.length) }, (_, index) => <div key={`pending-${index}`} role="listitem" className="sh-next-match sh-next-match--empty">
        <span className="sh-next-status">UP NEXT · TO BE ANNOUNCED</span>
        <strong>COMING NEXT</strong>
      </div>)}
    </div>
  </section>
}

export function LiveMatches({ feed, watchHref }: { feed: { matches: SolzWatchMatch[]; loading: boolean; error: string }; watchHref: string }) {
  const [page, setPage] = useState(0)
  const pageSize = 10
  const liveCount = feed.matches.filter((match) => match.phase === 'live').length
  const pageCount = Math.max(1, Math.ceil(feed.matches.length / pageSize))
  const visible = feed.matches.slice(page * pageSize, (page + 1) * pageSize)
  useEffect(() => { if (page >= pageCount) setPage(pageCount - 1) }, [page, pageCount])
  return <section className="sh-live-section" id="matches">
    <div className="sh-section-heading"><h2>LIVE ARENA<span>{liveCount} LIVE</span></h2>{watchHref && <a className="sh-section-meta" href={watchHref} target="_blank" rel="noreferrer">OPEN SOLZ WATCH <ArrowDownRight size={16}/></a>}</div>
    <div className="ch-live-list" aria-busy={feed.loading}>{visible.map((match) => <a key={`${match.region}:${match.id}`} href={match.watchUrl} target="_blank" rel="noreferrer" className="ch-live-row" aria-label={`Watch ${match.id} in ${match.region}`}>
      <StatusDot pink={match.phase !== 'live'}>{match.phase === 'live' ? 'LIVE' : match.phase.toUpperCase()}</StatusDot><strong>{match.id}</strong><span>{match.region} · {match.mode}</span><span>{match.players}/{match.capacity} players</span><span><Eye size={13}/>{match.spectators} watching</span><b>WATCH MATCH <ArrowUpRight size={15}/></b>
    </a>)}{!feed.loading && !feed.matches.length && <div className="ch-live-empty" role={feed.error ? 'alert' : 'status'}><strong>{feed.error ? 'SOLZ match feed is reconnecting.' : 'No watchable SOLZ rooms yet.'}</strong><span>{feed.error || 'The authoritative arena feed currently has no live room.'}</span></div>}</div>
    {pageCount > 1 && <nav className="ch-live-pages" aria-label="Live match pages"><button type="button" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>Previous</button><span>{page + 1} / {pageCount}</span><button type="button" disabled={page + 1 >= pageCount} onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}>Next</button></nav>}
  </section>
}

/* ========================================================================
 * THE PROGRAMME, AND THE BOARD THAT FEEDS IT.
 *
 * These two panels used to be a simulated league table and a simulated bid
 * form: TEAM STANDINGS ranked `snapshot.teams` by a rating nothing computes,
 * and MAKE YOUR TEAM MATTER sold a "highlight queue slot" that does not exist,
 * under copy promising "spotlight" and "exposure" in exchange for it.
 *
 * Both now state the product as it is actually built. The left panel is MIAW
 * PRIX - the settled cards first, because a result is the one thing on this
 * page that has already happened. The right panel is CATWALK, which is the ONLY
 * door into MIAW PRIX: a card is drawn from the board, so a coin that is not on
 * the board cannot be on a card. There are two ways onto it and the panel names
 * both - qualify into a lane, or take a seat off somebody on the ladder.
 * ===================================================================== */

/** How many settled cards the reel carries.
 *
 *  The programme answers with the whole season - a hundred and eighty settled
 *  cards by mid-season - and a reel that long is a list nobody reaches the end
 *  of AND one registry lookup per coin in it. Two dozen is what "recent" means
 *  here; the whole season is one click away at /miaw-prix. */
const REEL_CARDS = 24

/** Seconds of travel per row. The reel has to read at ONE speed whatever it is
 *  carrying: a fixed duration crawls over six rows and blurs over twenty-four. */
const REEL_SECONDS_PER_ROW = 2.4

/** Under this many rows the list fits its frame, so there is nothing to scroll:
 *  no second copy is rendered and no animation runs. */
const REEL_MIN_ROWS = 7

/** Countdowns on this panel are read in minutes, so a half-minute tick is
 *  enough and keeps two dozen rows from re-rendering once a second. */
function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs])
  return now
}

/**
 * A COIN, AS ONE CHIP: its crest and its ticker.
 *
 * Both, always. The crest alone is unreadable at this size for the dozens of
 * coins whose logo is a circle with a letter in it, and the ticker alone throws
 * away the one thing that makes a row scannable while it slides past.
 */
function CoinChip({ side, tone = 'plain' }: { side: MiawPrixCoinSide; tone?: 'won' | 'lost' | 'plain' }) {
  return <span className={`ch-coin ch-coin--${tone}`}>
    <TeamMark id={side.mint} color={side.color} logoUrl={side.logoUrl} className="ch-coin-mark" />
    <b style={side.color && tone !== 'lost' ? { color: side.color } : undefined}>{side.symbol}</b>
  </span>
}

/**
 * ONE SETTLED CARD, WINNER FIRST.
 *
 * Reordering the pair is the whole result: on a strip that moves, a reader gets
 * one glance per row, and "who won" has to survive that glance without a score
 * column - which this programme does not publish anyway. The loser keeps its
 * crest and its ticker and loses only its colour, because it played the match.
 *
 * A card whose winner cannot be identified is NOT reordered and says so. That
 * is `isWinner`'s whole job: it matches on the winning MINT, and a result
 * naming a coin neither side played is no highlight rather than side one.
 */
function ResultRow({ match }: { match: MiawPrixMatch }) {
  const state = matchState(match)
  const winner = match.sides.find((side) => isWinner(match, side)) ?? null
  const loser = winner ? match.sides.find((side) => side.mint !== winner.mint) ?? null : null
  const when = kickoffParts(match.scheduledStartAt)
  const pair: [MiawPrixCoinSide | undefined, MiawPrixCoinSide | undefined] = winner && loser
    ? [winner, loser]
    : [match.sides[0], match.sides[1]]
  const decided = Boolean(winner && loser) && state !== 'cancelled'
  return <li className="ch-reel-row">
    <a
      href={eventHref('/events', match.matchId)}
      title={programmeLabel(match)}
      aria-label={decided
        ? `${pair[0]?.symbol} beat ${pair[1]?.symbol} on ${when.date}`
        : `${pair[0]?.symbol ?? 'A coin'} against ${pair[1]?.symbol ?? 'a coin'} on ${when.date}: ${state === 'cancelled' ? 'void' : 'no result recorded'}`}
    >
      <span className="ch-reel-when"><b>{when.time}</b><small>{when.date}</small></span>
      <span className="ch-reel-pair">
        {pair[0] && <CoinChip side={pair[0]} tone={decided ? 'won' : 'plain'} />}
        <em>{state === 'cancelled' ? 'VOID' : decided ? 'BEAT' : 'VS'}</em>
        {pair[1] && <CoinChip side={pair[1]} tone={decided ? 'lost' : 'plain'} />}
      </span>
      <span className={`ch-reel-tag ${decided ? 'is-final' : ''}`}>{state === 'cancelled' ? 'VOID' : decided ? 'FINAL' : 'NO RESULT'}</span>
    </a>
  </li>
}

/** One card still to be played. It carries a countdown rather than a result,
 *  and never a winner-first order, because nothing has been decided. */
function FixtureRow({ match, now }: { match: MiawPrixMatch; now: number }) {
  const when = kickoffParts(match.scheduledStartAt)
  const live = matchState(match, now) === 'live'
  const away = match.scheduledStartAt - now
  return <li className="ch-reel-row">
    <a href={eventHref('/events', match.matchId)} title={programmeLabel(match)} aria-label={`${match.sides[0]?.symbol} against ${match.sides[1]?.symbol}, ${live ? 'live now' : `in ${countdown(away)}`}`}>
      <span className="ch-reel-when"><b>{when.time}</b><small>{when.date}</small></span>
      <span className="ch-reel-pair">
        {match.sides[0] && <CoinChip side={match.sides[0]} />}
        <em>VS</em>
        {match.sides[1] && <CoinChip side={match.sides[1]} />}
      </span>
      <span className={`ch-reel-tag ${live ? 'is-live' : ''}`}>{live ? 'LIVE' : away > 0 ? countdown(away) : 'STARTING'}</span>
    </a>
  </li>
}

/**
 * THE SCROLLING STRIP.
 *
 * A second, `aria-hidden` copy of the same rows sits under the first and the
 * track travels exactly its own half height, so the list arrives back where it
 * started and the loop has no seam. The duplicate is drawn only when there is
 * genuinely more than the frame holds - a six-row reel scrolling itself is
 * movement with nothing to reveal.
 *
 * IT STOPS WHEN SOMEBODY IS READING IT. Pointer over it or keyboard focus
 * inside it pauses the animation, and `prefers-reduced-motion` turns it into an
 * ordinary scrollable list, because a moving list is unusable for anyone who
 * needs to hold a row still.
 */
function Reel({ rows, label, children }: { rows: number; label: string; children: ReactNode }) {
  const rolling = rows >= REEL_MIN_ROWS
  return <div
    className={`ch-reel ${rolling ? 'is-rolling' : ''}`}
    style={{ '--ch-reel-duration': `${Math.round(rows * REEL_SECONDS_PER_ROW)}s` } as CSSProperties}
  >
    <div className="ch-reel-track">
      <ul className="ch-reel-list" aria-label={label}>{children}</ul>
      {rolling && <ul className="ch-reel-list" aria-hidden="true">{children}</ul>}
    </div>
  </div>
}

/** The frame the reel occupies before there is anything to put in it. Rows of
 *  the size the real ones will be, so the panel does not resize under the
 *  reader when the programme lands. */
function ReelSkeleton({ rows = 8 }: { rows?: number }) {
  return <div className="ch-reel">
    <ul className="ch-reel-list" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => <li key={index} className="ch-reel-row ch-reel-row--pending"><span /><span /><span /></li>)}
    </ul>
  </div>
}

/** Said once, in the panel head, rather than by every row. An empty reel under
 *  a live board is a fact about the programme; an empty reel under a board
 *  nobody could read is a fact about the network. */
function reelEmpty(loading: boolean, board: MiawPrixBoard | null, sentence: string) {
  if (loading) return 'Reading the programme…'
  if (!board) return 'The MIAW PRIX programme could not be read.'
  return sentence
}

/**
 * MIAW PRIX ON THE HOME PAGE: what has been decided, what is coming, and the
 * season table the two produce.
 *
 * Results lead. Everything else on this page is a market, a countdown or an
 * invitation - a settled card is the only thing here that has already happened,
 * and it is the evidence the rest of the page is asking to be believed on.
 */
export function ProgrammeStandings({ board, loading, refreshing, programmeHref = '/miaw-prix' }: {
  /** The whole programme as read. Null while nothing has been read at all. */
  board: MiawPrixBoard | null
  /** Nothing has landed yet, in this realm or on the wire. */
  loading: boolean
  /** Rows are on screen and a read is in flight over them. */
  refreshing: boolean
  programmeHref?: string
}) {
  const [view, setView] = useState<'results' | 'next' | 'season'>('results')
  const now = useNow()
  const { upcoming, finished } = useMemo(() => splitMatches(board?.matches ?? [], now), [board, now])
  const results = useMemo(() => finished.slice(0, REEL_CARDS), [finished])
  const fixtures = useMemo(() => upcoming.slice(0, REEL_CARDS), [upcoming])
  const table = useMemo(() => rankStandings(board?.standings ?? []).slice(0, 8), [board])
  // Only the coins ON SCREEN are looked up. The board carries a whole season;
  // asking the registry about every mint in it would be a large read for rows
  // nobody is being shown. See the same rule in useMiawPrixHighlight.
  const mints = useMemo(() => [...new Set([
    ...results.flatMap((match) => match.sides.map((side) => side.mint)),
    ...fixtures.flatMap((match) => match.sides.map((side) => side.mint)),
    ...table.map((row) => row.mint),
  ].filter(Boolean))], [results, fixtures, table])
  const tokenMeta = useTokenMeta(mints)
  // A crest's hue is sampled off the image after it downloads; this is what
  // repaints the rows when it lands instead of leaving the name-hash colour.
  const palette = useLogoPalette()
  const shownResults = useMemo(() => results.map((match) => identify(match, tokenMeta)), [results, tokenMeta, palette])
  const shownFixtures = useMemo(() => fixtures.map((match) => identify(match, tokenMeta)), [fixtures, tokenMeta, palette])
  const shownTable = useMemo(() => table.map((row) => {
    const token = tokenMeta.get(row.mint)
    const logoUrl = resolvedTokenLogo(row.logoUrl, token?.icon) || undefined
    return { ...row, logoUrl, color: row.color || teamIdentityColor(row.symbol || row.mint, logoUrl) }
  }), [table, tokenMeta, palette])

  return <section className="sh-standings" id="teams">
    <div className="sh-section-heading">
      <h2>MIAW PRIX<span>{seasonLabel(board?.season ?? null)}</span></h2>
      <a className="sh-section-meta" href={programmeHref}>OPEN THE PROGRAMME <ArrowDownRight size={16} /></a>
    </div>
    <div className="sh-panel-title">
      <span>COIN VS COIN · AGENT COLOSSEUM</span>
      <span className="ch-panel-state">{refreshing ? 'REFRESHING' : loading ? 'READING' : `${finished.length} SETTLED`}</span>
    </div>
    <p className="ch-standings-note">Every card is two coins drawn from the CATWALK board. A win is a win on the card — the season is won on raw win count, not on a rating.</p>
    <Tabs
      idPrefix="standings"
      label="MIAW PRIX programme"
      value={view}
      onChange={setView}
      tabs={[{ id: 'results', label: 'Recent matches' }, { id: 'next', label: 'Up next' }, { id: 'season', label: 'Season table' }]}
    />
    <TabPanel id="results" idPrefix="standings" active={view === 'results'}>
      {loading && !shownResults.length
        ? <ReelSkeleton />
        : shownResults.length
          ? <Reel rows={shownResults.length} label="Recent MIAW PRIX results">
              {shownResults.map((match) => <ResultRow key={match.matchId} match={match} />)}
            </Reel>
          : <p className="ch-reel-empty" role="status">{reelEmpty(loading, board, 'No card has been settled this season yet.')}</p>}
    </TabPanel>
    <TabPanel id="next" idPrefix="standings" active={view === 'next'}>
      {loading && !shownFixtures.length
        ? <ReelSkeleton />
        : shownFixtures.length
          ? <Reel rows={shownFixtures.length} label="Upcoming MIAW PRIX cards">
              {shownFixtures.map((match) => <FixtureRow key={match.matchId} match={match} now={now} />)}
            </Reel>
          : <p className="ch-reel-empty" role="status">{reelEmpty(loading, board, 'No card is scheduled right now.')}</p>}
    </TabPanel>
    <TabPanel id="season" idPrefix="standings" active={view === 'season'}>
      {loading && !shownTable.length
        ? <ReelSkeleton rows={6} />
        : shownTable.length
          ? <table className="sh-team-table">
              <thead><tr><th scope="col">RANK</th><th scope="col">COIN</th><th scope="col">W / L</th><th scope="col">PLAYED</th></tr></thead>
              <tbody>{shownTable.map((row) => <tr key={row.mint} className={row.rank === 1 ? 'sh-top-team' : ''}>
                <td><span>{String(row.rank).padStart(2, '0')}</span></td>
                <th scope="row"><span className="ch-table-coin">
                  <TeamMark id={row.mint} color={row.color} logoUrl={row.logoUrl} />
                  <span>{row.symbol}<small>{row.name}</small></span>
                </span></th>
                <td>{row.wins}<span> / {row.losses}</span>{row.tiedOnWins && <small title="Level on wins with the row above; the order is decided on losses, then on who reached the count first">TIED ON WINS</small>}</td>
                <td>{row.matches}</td>
              </tr>)}</tbody>
            </table>
          : <p className="ch-reel-empty" role="status">{reelEmpty(loading, board, 'No coin has a record this season yet.')}</p>}
    </TabPanel>
    <div className="sh-panel-foot"><span>COINS ARE THE TEAMS. AGENTS ARE THE PLAYERS.</span><a href={programmeHref}>THE FULL SEASON ↗</a></div>
  </section>
}

/** What a lane is called out loud, so a row can say how its coin arrived. */
const LANE_LABEL: Record<CatwalkLane, string> = {
  outbid: 'OUTBID',
  champion: 'CHAMPION',
  ranked: 'SOLZ RANKED',
}

/**
 * THE WAY IN, AND THE BOARD IT LEADS TO.
 *
 * This panel replaces a form that took a "bid" for a "highlight queue slot"
 * against a simulated balance, under copy offering spotlight and exposure.
 * There is no highlight queue. What exists is the CATWALK board: `lineupSize`
 * numbered positions, of which the top `activeSlots` walk every rotation, and
 * MIAW PRIX draws its cards from them.
 *
 * So the panel answers exactly one question - HOW DOES MY COIN GET ONTO THAT
 * BOARD - with the two real answers: qualify into a lane, or take a ladder seat
 * off its current holder. Both end at /catwalk, which is where a seat is
 * actually bought; nothing is sold from here, because nothing here is a sale.
 */
export function CatwalkEntry({ feed, boardHref = '/catwalk' }: { feed: CatwalkFeed; boardHref?: string }) {
  const [view, setView] = useState<'earn' | 'board'>('earn')
  // src/pages/api/token-meta.ts caps a request at 50 mints and slices the tail
  // away without saying so, so the cap is spelled out here rather than met
  // silently. The board is thirty-six positions; this is headroom, not a cut.
  const mints = useMemo(
    () => [...new Set((feed.board?.lineup ?? []).map((entry) => entry.mint).filter(Boolean))].slice(0, 50),
    [feed.board],
  )
  const tokenMeta = useTokenMeta(mints)
  const board = useMemo(() => overlayTokenMeta(feed.board, tokenMeta), [feed.board, tokenMeta])
  const shape = useMemo(() => buildBoard({
    board,
    spots: feed.spots,
    outbidSpots: feed.outbidSpots,
    standings: feed.standings,
    standingsState: feed.standingsState,
    ladder: feed.ladder,
  }), [board, feed.spots, feed.outbidSpots, feed.standings, feed.standingsState, feed.ladder])
  // Only an OPEN ladder has a floor. A ladder that is shut, and a ladder nobody
  // could read, both have no price to state - and they are not the same fact,
  // which is why the sentence under the figure is chosen from all three.
  const seat = feed.ladder === 'open' ? cheapestSeat(shape.seats) : null
  const held = shape.rows.filter((row) => row.lane !== 'open')
  // The board reads top-down: position 01 is the front of the runway.
  const ranked = held.slice().sort((a, b) => a.spot - b.spot)
  const occupancy = shape.lineupSize > 0 ? Math.round((shape.claimed / shape.lineupSize) * 100) : 0
  /**
   * WHETHER THE BOARD WAS ACTUALLY READ.
   *
   * `shape` is built whether or not it was: `buildBoard` falls back to the
   * product's own 12-of-36 shape so the bands, the numbers and this panel's
   * step copy can be drawn before any read lands, exactly as /catwalk draws
   * them. What it CANNOT do is count - a board nobody could read has no coins
   * on it, and the counts would then publish "0/36 on the board · 36 open"
   * about a board that is in fact full. Occupancy waits for a read.
   */
  const boardRead = Boolean(feed.board)
  const pending = feed.loading && !boardRead

  return <section className="sh-entry" id="enter-arena">
    <div className="sh-section-heading">
      <h2>MAKE YOUR TEAM MATTER</h2>
      <a className="sh-section-meta" href={boardHref}>OPEN CATWALK <ArrowUpRight size={16} /></a>
    </div>
    <div className="sh-entry-panel">
      <div className="sh-entry-banner"><span>CATWALK · {shape.lineupSize} POSITIONS</span><span>{feed.refreshing ? '···' : '↗↗↗'}</span></div>
      <div className="sh-entry-intro">
        <h3>YOUR COIN.<br />ON THE RUNWAY.</h3>
        <p>MIAW PRIX draws every card from the CATWALK board.<br />Get on it, or take a seat off someone who is.</p>
      </div>
      <Tabs
        idPrefix="entry"
        label="How a coin joins MIAW PRIX"
        value={view}
        onChange={setView}
        tabs={[{ id: 'earn', label: 'How you get on' }, { id: 'board', label: 'Board leaderboard' }]}
      />
      <TabPanel id="earn" idPrefix="entry" active={view === 'earn'}>
        <ol className="sh-qualification-steps">
          <li><b>01</b><span><strong>GET ON THE BOARD</strong><small>Qualify into a lane — SOLZ RANKED or CHAMPION — or take a ladder seat in OUTBID.</small></span><ArrowRight size={16} /></li>
          <li><b>02</b><span><strong>STAND IN THE LINE-UP</strong><small>Positions {shape.activeSlots + 1}–{shape.lineupSize} walk the top {shape.activeSlots} in turn. One rotation away.</small></span><ArrowRight size={16} /></li>
          <li><b>03</b><span><strong>WALK THE RUNWAY</strong><small>The top {shape.activeSlots} walk every rotation, and MIAW PRIX pairs its cards from them.</small></span><Check size={16} /></li>
        </ol>
        <div className="sh-qualification-check">
          <div className="sh-progress-label">
            <span>BOARD OCCUPANCY</span>
            <strong>{boardRead ? `${shape.claimed}/${shape.lineupSize}` : EM_DASH}</strong>
          </div>
          <progress
            value={boardRead ? occupancy : 0}
            max="100"
            aria-label={boardRead
              ? `${shape.claimed} of ${shape.lineupSize} CATWALK positions held`
              : 'CATWALK board occupancy is unknown'}
          />
          <p>{boardRead
            ? `${shape.walkingClaimed}/${shape.activeSlots} on the runway · ${shape.claimed}/${shape.lineupSize} on the board · ${shape.lineupSize - shape.claimed} open`
            : pending
              ? 'Reading the CATWALK board…'
              : 'The CATWALK board could not be read, so how much of it is held is unknown.'}</p>
          <div className="ch-entry-actions">
            {seat
              ? <a className="sh-button sh-button--black" href={`${boardHref}#outbid`}>TAKE SEAT {pad(seat.seat)} — {usdLabel(seat.askUsdMicros)}<ArrowUpRight size={17} /></a>
              : <a className="sh-button sh-button--black" href={boardHref}>OPEN THE BOARD<ArrowUpRight size={17} /></a>}
            {/* FOUR DIFFERENT FACTS, never collapsed into one. A ladder that
                is shut is a claim; a ladder nobody could read is the absence of
                one; and a ladder that is open with every seat held is a third
                thing again. Only the first case may print a price. */}
            <small>{seat
              ? 'The cheapest seat nobody is standing on. Seats are bought on CATWALK, and the holder can be outbid again.'
              : feed.ladder === 'closed'
                ? 'The spot ladder is shut right now. Qualifying into a lane is the open door.'
                : feed.ladder === 'unknown'
                  ? 'The spot ladder could not be read just now, so no price is stated.'
                  : 'Every ladder seat is held. Qualifying into a lane is the open door.'}</small>
          </div>
        </div>
      </TabPanel>
      <TabPanel id="board" idPrefix="entry" active={view === 'board'}>
        {pending
          ? <p className="ch-board-empty" role="status">Reading the CATWALK board…</p>
          : ranked.length
            ? <>
                <div className="ch-board-head"><span>POSITION</span><span>COIN</span><span>LANE</span><span>W / L</span></div>
                <Reel rows={ranked.length} label="The CATWALK board, in position order">
                  {ranked.map((row) => <BoardRow key={row.spot} row={row} recordsKnown={shape.recordsKnown} />)}
                </Reel>
              </>
            : <p className="ch-board-empty" role="status">{feed.board ? 'No coin is standing on the board yet.' : 'The CATWALK board could not be read.'}</p>}
        <p className="ch-board-note">Positions 01–{shape.activeSlots} walk every rotation.{' '}
          {boardRead
            ? shape.lineupSize - shape.claimed > 0 ? `${shape.lineupSize - shape.claimed} positions are open.` : 'Every position is held.'
            : 'How many are open is unknown until the board is read.'}</p>
      </TabPanel>
    </div>
  </section>
}

/** One held board position. The number is ABSOLUTE identity - never a rank
 *  within this filtered list, and never a ladder seat number, which is a
 *  different list with its own numbering. */
function BoardRow({ row, recordsKnown }: { row: CatwalkRow; recordsKnown: boolean }) {
  const team = row.entry?.team ?? null
  const symbol = team?.symbol || row.entry?.mint.slice(0, 4) || '—'
  const record = row.standing
  return <li className={`ch-board-row ${row.walks ? 'is-runway' : ''}`}>
    <span className="ch-board-spot">{pad(row.spot)}</span>
    <span className="ch-coin">
      <TeamMark id={row.entry?.mint ?? String(row.spot)} color={team?.color} logoUrl={team?.logoUrl} className="ch-coin-mark" />
      <b>{symbol}</b>
    </span>
    <span className={`ch-board-lane ch-board-lane--${row.lane}`}>{row.lane === 'open' ? 'OPEN' : LANE_LABEL[row.lane]}</span>
    {/* A record nobody could read is an em dash, never a 0-0: one is a fact
        about the network and the other is a claim about the coin. */}
    <span className="ch-board-record">{!recordsKnown && !record ? EM_DASH : record ? `${record.wins} / ${record.losses}` : '0 / 0'}</span>
  </li>
}
