import '../../styles/home.css'
import '../../styles/home-markets.css'
import '../../styles/markets-directory.css'
import '../../styles/general-questions.css'
import { PantaMarkets, PantaTrackedList } from './PantaMarkets'
import { ArrowLeft, ArrowRight, ArrowUpRight, Eye, Users, Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { AgentPortrait, StatusDot, TeamMark, compact } from '../home/HomePrimitives'
import { useHomeData } from '../home/useHomeData'
import { linkedAnswerLabel, linkedQuestionTitle, questionEvents, reservedSolanaView, useQuestionIdentity, useReservedSolanaQuestions } from '../home/solanaQuestionMarkets'
import { useSolanaMarketPrices } from '../home/useSolanaMarketPrices'
import { useSolanaVenue } from '../home/useSolanaVenue'
import { AppShell } from '../solz/AppShell'
import { brand, brands, showsSection } from '../solz/brand'
import { createSolzDataSource } from '../solz/solzDataSource'
import type { ArenaMarket, SolzMatch, SolzSnapshot } from '../solz/model'
import { eventMarketVolume } from '../events/eventModel'
import { normalisedChances } from './chance'
import { catalogueQuestions, type CatalogueItem } from './marketList'
import { useMarketCatalogue } from './useMarketCatalogue'
import { eventTimingLabel } from '../events/eventTiming'
import { pickInk, teamIdentityColor } from './moneyline'
import { useLogoPalette } from './logoIdentity'

type Props = { apiUrl?: string }

/** A directory entry. A standalone question is not match-backed, so its title,
 *  status and market are supplied rather than derived from teams. */
export type DirectoryRow = {
  match: SolzMatch
  market?: ArenaMarket
  markets?: ArenaMarket[]
  title?: string
  detail?: string
  status?: string
  collateral?: string
  kind?: 'match' | 'general'
  opened?: boolean
  eventType?: CatalogueItem['eventType']
  agentPerformance?: boolean
  matchNumber?: number
  hasHumans?: boolean
  gameMode?: string
  teamFormat?: string
  /** A general question's topic from the catalogue, such as `stocks`. */
  category?: string
}

// All/Live/Upcoming/Settled are statuses; General is a kind (MARKET_LIST_API.md:38
// gives `kind` as its own axis). Naming it after the axis stops it reading as a
// fifth status - every item here is a question, so 'Questions' excluded nothing.
const filters = ['Featured', 'Live', 'Upcoming', 'History', 'All'] as const
type MarketFilter = typeof filters[number]
type EventTypeFilter = 'all' | NonNullable<DirectoryRow['eventType']>
const PAGE_SIZE = 12
const AGENT_COLORS = ['#c7ff00', '#ff579d', '#65cfff', '#ffac57', '#bd9afa', '#f9e071']

const percent = (value: number) => `${Math.round(value * 100)}%`

function scheduleLabel(match: SolzMatch, now: number) {
  return eventTimingLabel(match, now)
}

const eventTypeLabel = (row: DirectoryRow) => row.agentPerformance ? 'AGENT PERFORMANCE · OUR ORACLE'
  : row.category === 'stocks' ? 'PRESTOCKS · OUR VENUE'
  : row.hasHumans ? 'HUMAN MATCH' : row.eventType === 'genesis-ffa'
  ? 'GENESIS AGENT FFA'
  : row.eventType === 'miaw-prix' ? 'MIAW PRIX · COLOSSEUM'
    : row.eventType === 'general' ? (row.category === 'stocks' ? 'STOCKS · PRESTOCKS' : 'GENERAL MARKET') : 'RANKED / STAKE MATCH'

/** General is a market taxonomy, not a game mode. A two-sided general question
 * may be a future human match, but it must never be marketed as a token duel
 * until that product actually exists. */
const cardProgram = (row: DirectoryRow) => row.eventType === 'miaw-prix'
  ? 'MIAW PRIX GAME'
    : row.hasHumans || row.eventType === 'match' ? 'SOLZ.FUN GAME' : null

const absoluteTime = (match: SolzMatch, now: number) => {
  const terminal = match.phase === 'settled' || (match.timingType !== 'open-ended' && match.endsAt <= now)
  const at = terminal ? match.endsAt : match.phase === 'live' ? match.endsAt : match.startedAt
  if (!Number.isFinite(at)) return ''
  const label = terminal ? 'Finished' : match.phase === 'live' ? 'Ends' : 'Begins'
  return `${label} ${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(at)}`
}

const absoluteTimeAt = (match: SolzMatch, now: number) => match.phase === 'settled'
  || (match.timingType !== 'open-ended' && match.endsAt <= now) || match.phase === 'live' ? match.endsAt : match.startedAt

const agentNumber = (participantId?: string) => {
  const parsed = /^genesis-(\d{1,2})$/i.exec(participantId ?? '')
  return parsed ? Number(parsed[1]) : undefined
}

const agentColor = (number?: number) => number ? AGENT_COLORS[(number - 1) % AGENT_COLORS.length] : undefined

/** teamIdentityColor hashes into a 44-50% lightness band (moneyline.ts:31), which
 *  is tuned for a control that lights up when you pick it. A directory card has
 *  nothing to pick, so every outcome here is drawn already lit: the same x1.18
 *  the button's :hover used to apply, applied once, up front, to all of them.
 *
 *  Done here and not with a CSS filter because the ink is chosen from the fill's
 *  luminance - brightening after pickInk saw the colour could leave white ink on
 *  a fill that had crossed into needing dark. */
function litIdentity(hex: string, by = 1.18) {
  const raw = hex.replace('#', '')
  if (raw.length !== 6) return hex
  const channel = (at: number) => Math.min(255, Math.round(parseInt(raw.slice(at, at + 2), 16) * by))
  return `#${[0, 2, 4].map((at) => channel(at).toString(16).padStart(2, '0')).join('')}`
}

const phaseRank = (row: DirectoryRow) => {
  const realMatch = row.eventType !== 'general'
  if (row.match.phase === 'live') return row.hasHumans ? 0 : realMatch ? 1 : 2
  if (row.match.phase === 'countdown' || row.match.phase === 'queued') return row.hasHumans ? 3 : realMatch ? 4 : 5
  return 6
}

const rowVolume = (row: DirectoryRow) => row.markets?.reduce((sum, market) => sum + eventMarketVolume(market), 0) ?? (row.market ? eventMarketVolume(row.market) : row.match.volume.COOLA)
const isOpen = (row: DirectoryRow) => row.match.phase !== 'settled'

export const sorts = [['recommended', 'Recommended'], ['ending', 'Ending soon'], ['newest', 'Newest'], ['volume', 'Highest volume']] as const
export type MarketSort = typeof sorts[number][0]

/** Recommended is the curated order below. The others are plain orderings, and
 *  every one of them keeps settled markets behind open ones. */
export function sortRows(rows: readonly DirectoryRow[], sort: MarketSort) {
  if (sort === 'recommended') return sortMarketRows(rows)
  return [...rows].sort((a, b) => {
    const open = Number(isOpen(b)) - Number(isOpen(a))
    if (open) return open
    if (sort === 'volume') return rowVolume(b) - rowVolume(a)
    if (sort === 'newest') return b.match.startedAt - a.match.startedAt
    return isOpen(a) ? a.match.endsAt - b.match.endsAt : b.match.endsAt - a.match.endsAt
  })
}

export function sortMarketRows(rows: readonly DirectoryRow[]) {
  return [...rows].sort((a, b) => {
    const phase = phaseRank(a) - phaseRank(b)
    if (phase) return phase
    if (a.match.phase === 'settled' && b.match.phase === 'settled') return b.match.endsAt - a.match.endsAt
    return a.match.startedAt - b.match.startedAt
  })
}

/** What the card is asking, not who is standing in it. A team-less room reaches
 *  us as one synthetic side (predictionArena.ts:82), whose symbol is a roster
 *  label rather than a question - and the body would only repeat it. */
function matchTitle(match: SolzMatch) {
  if (match.teams.length > 2) return `${match.teams.length}-TEAM FREE FOR ALL`
  if (match.teams.length === 2) return match.teams.map((team) => team.symbol).join(' VS ')
  const mode = match.mode?.toLowerCase()
  return mode ? `Which agent wins the ${mode}?` : match.map
}

/** The dot beside this already states the phase, and predictionArena.ts:85 sets
 *  a live room's round to 'MATCH LIVE', stating it twice. Every other round -
 *  INTERMISSION, SETTLED - carries a fact the dot cannot. */
const matchDetail = (match: SolzMatch) => [match.mode, match.round === 'MATCH LIVE' ? '' : match.round].filter(Boolean).join(' · ')

/** Match outcome identities before falling back to order. Missing quotes stay
 *  indicative: team count cannot establish odds or imply a certain winner. */
function teamOdds(match: SolzMatch, market: ArenaMarket | undefined) {
  return match.teams.map((team, index) => {
    const outcome = market?.outcomes.find((item) => item.teamId === team.teamId) ?? market?.outcomes[index]
    return { team, probability: outcome?.probability ?? 1 / Math.max(1, match.teams.length), indicative: outcome?.indicative ?? !outcome }
  })
}

/** The question leads. Everything that qualifies it - status, mode, schedule -
 *  sits under it, so scanning the grid reads the markets and not the chrome. */
function CardFrame({ row, now, kind, children }: { row: DirectoryRow; now: number; kind: string; children: ReactNode }) {
  const { match } = row
  const marketVolume = rowVolume(row)
  const timing = scheduleLabel(match, now)
  const terminal = timing === 'CANCELLED' || timing.startsWith('SETTLED') || timing.startsWith('FINISHED')
  const detail = row.opened === undefined ? row.detail ?? matchDetail(match)
    : terminal ? row.opened ? 'ON-CHAIN · CLOSED' : 'OFF-CHAIN · NEVER OPENED'
      : row.opened ? 'ON-CHAIN' : 'OFF-CHAIN · OPENS ON FIRST TRADE'
  const href = `/events/${encodeURIComponent(match.id)}`
  const program = cardProgram(row)
  // The card's surface states which family it belongs to, so it keys off the
  // event type rather than off whether a programme badge happens to be printed.
  // A Genesis FFA round is a game and carries no badge; tying the two together
  // dropped it onto the general-market grey for want of a label it never has.
  const category = `${(row.eventType ?? row.kind) === 'general' ? 'is-general' : 'is-game'}${row.agentPerformance ? ' is-agent' : ''}`
  return <article className={`mk-card mk-card--${kind} ${category}${match.phase === 'live' ? ' is-live' : terminal ? ' is-past' : ''}`}>
    <div className="mk-card-kicker">
      <span>{eventTypeLabel(row)}</span>
      {row.matchNumber && <b>MATCH #{row.matchNumber}</b>}
    </div>
    <a className="mk-card-head" href={href} aria-label={`Open ${row.title ?? match.map}`}>
      <h3 className="mk-card-title">{row.title ?? match.map}{program && <small className="mk-card-program">{program}</small>}</h3>
      <ArrowUpRight className="mk-card-open" size={15}/>
    </a>
    <div className="mk-card-status">
      <StatusDot pink={match.phase !== 'live'}>{row.status ?? timing}</StatusDot>
      <span>{detail}</span>
    </div>
    {Number.isFinite(absoluteTimeAt(match, now)) && <time className={`mk-card-time${terminal ? ' is-past' : ''}`} dateTime={new Date(absoluteTimeAt(match, now)).toISOString()}>{absoluteTime(match, now)}</time>}
    {children}
    <div className="mk-card-bottom">
      <span className="mk-card-volume">{compact(marketVolume)} {row.collateral ?? 'COOLA'} Vol.</span>
      <span><Eye size={12}/>{compact(match.viewers)}</span>
    </div>
  </article>
}

function VersusPick({ team, probability, indicative, href }: { team: SolzMatch['teams'][number]; probability: number; indicative: boolean; href: string }) {
  // The fill spans from a dark indigo to a bright olive even before it is lit,
  // so the ink is read off the final colour rather than fixed - the same call
  // the market rows and the ticket make, on the value actually painted.
  // The crest beside the fill is what the fill is coloured from; it is read
  // asynchronously, so this card re-renders when its hue lands.
  useLogoPalette()
  const color = litIdentity(teamIdentityColor(team.symbol, team.logoUrl))
  return <div className="mk-versus-pick" style={{ '--mk-identity': color, '--mk-ink': pickInk(color) } as CSSProperties}>
    <div className="mk-versus-identity">
      <TeamMark id={team.teamId} color={color} logoUrl={team.logoUrl}/>
      <strong>{team.name || team.symbol}</strong>
      {!indicative && <span className="mk-versus-meter" aria-hidden="true"><i style={{ width: percent(probability), background: color }}/></span>}
    </div>
    <a className="mk-versus-button" href={href} aria-label={`Open ${team.symbol} market`}>
      <span>{team.symbol}</span>
      <b>{indicative ? '—' : percent(probability)}</b>
    </a>
  </div>
}

/** Two teams: identity stays in the card; its adjacent price control follows
 * the trade ticket's label-plus-quote treatment and is coloured from the crest. */
function VersusCard({ row, now }: { row: DirectoryRow; now: number }) {
  const odds = teamOdds(row.match, row.market)
  return <CardFrame row={row} now={now} kind="versus">
    <div className="mk-versus">
      {odds.map(({ team, probability, indicative }) => <VersusPick key={team.teamId} team={team} probability={probability} indicative={indicative} href={`/events/${encodeURIComponent(row.match.id)}`}/>) }
    </div>
  </CardFrame>
}

/** One ranked row per contender, highest first, tail collapsed into a count.
 *  Used for a team field and for a set of linked questions alike: both are a
 *  field with no head-to-head to split. */
function RankedCard({ row, now, kind, rows, note }: { row: DirectoryRow; now: number; kind: string; rows: { key: string; label: string; color?: string; imageUrl?: string; participantId?: string; probability: number; indicative?: boolean }[]; note: string }) {
  const ranked = [...rows].sort((a, b) => Number(a.indicative) - Number(b.indicative) || b.probability - a.probability)
  const shown = kind === 'linked' && row.agentPerformance && ranked.length > 4
    ? [ranked[0]!, ranked[Math.floor((ranked.length - 1) / 3)]!, ranked[Math.floor(2 * (ranked.length - 1) / 3)]!, ranked.at(-1)!]
    : ranked.slice(0, 4)
  return <CardFrame row={row} now={now} kind={kind}>
    {shown.length > 0 && <div className="mk-ffa">
      {shown.map((item) => <div className="mk-ffa-row" key={item.key}>
        {agentNumber(item.participantId)
          ? <AgentPortrait number={agentNumber(item.participantId)!} className="mk-agent-portrait"/>
          : item.color || item.imageUrl ? <TeamMark id={item.key} color={item.color} logoUrl={item.imageUrl}/> : <span className="mk-ffa-dot" aria-hidden="true"/>}
        <strong>{item.label}</strong>
        <span className="mk-ffa-bar"><i style={{ width: item.indicative ? '0%' : percent(item.probability), background: item.color ?? 'var(--sh-lime)' }}/></span>
        <b>{item.indicative ? '—' : percent(item.probability)}</b>
      </div>)}
    </div>}
    {row.agentPerformance && <a className="mk-card-parent" href={`/events/${encodeURIComponent(row.match.id.replace(/-agent$/, ''))}`}>View main question ↗</a>}
    <div className="mk-card-note"><Users size={11}/>{note}{ranked.length > shown.length ? ` · ${ranked.length - shown.length} more` : ''}</div>
  </CardFrame>
}

function FreeForAllCard({ row, now }: { row: DirectoryRow; now: number }) {
  // Zero real teams reach this card as one synthetic side (predictionArena.ts:82),
  // so a team count is invented arithmetic rather than a fact about the room -
  // and a room with one side is not a team fight to count sides in.
  const contested = row.match.teams.length >= 2
  const rows = contested ? teamOdds(row.match, row.market).map(({ team, probability, indicative }) => ({ key: team.teamId, label: team.symbol, color: team.color, imageUrl: team.logoUrl, probability, indicative })) : []
  const note = [contested ? `${row.match.teams.length} teams` : '', row.match.roster.length ? `${row.match.roster.length} agents` : ''].filter(Boolean).join(' · ')
  return <RankedCard row={row} now={now} kind="ffa" rows={rows} note={note}/>
}

/** Several linked questions under one event. Only one of them can win, so CHANCE
 *  is the normalised distribution over the whole field - the same reading the
 *  event page takes (EventMarkets.tsx:43) - and not each book's own YES price.
 *  Read raw, twelve independent books on this card summed past 300%. */
function LinkedQuestionsCard({ row, now }: { row: DirectoryRow; now: number }) {
  const markets = row.markets ?? []
  // Hoisted above the map: the divisor is the whole field, so a per-market pass
  // cannot compute it. A book that never opened sits out the total and stays
  // undefined here rather than reading as 0%.
  const chances = normalisedChances(markets.map((market) => market.outcomes[0]))
  const rows = markets.map((market, index) => {
    // Only a book that actually quoted stamps `indicative: false`
    // (useSolanaMarketPrices.ts:146). An arena draft leaves it undefined and
    // carries a .5 placeholder, which chance.ts:43 will happily price - and
    // twelve of those normalise to a tidy uniform 8% no book ever made.
    const chance = market.outcomes[0]?.indicative === false ? chances[index] : undefined
    const suppliedParticipant = market.presentation?.answer?.participantId
    const participantId = agentNumber(suppliedParticipant) ? suppliedParticipant
      : row.eventType === 'genesis-ffa' ? `genesis-${String(index + 1).padStart(2, '0')}` : suppliedParticipant
    return {
      key: market.id,
      // The subject is what differs between linked questions; the shared tail is
      // already the card title, so showing it on every row would be noise.
      label: market.presentation?.answer?.label ?? linkedAnswerLabel(market.title, row.title ?? ''),
      participantId,
      imageUrl: market.presentation?.answer?.imageUrl,
      color: market.presentation?.answer?.color ?? agentColor(agentNumber(participantId)),
      probability: chance ?? 0,
      indicative: chance === undefined,
    }
  })
  if (row.agentPerformance) rows.sort((a, b) =>
    (a.label.startsWith('All ') ? Number.POSITIVE_INFINITY : Number.parseInt(a.label, 10))
    - (b.label.startsWith('All ') ? Number.POSITIVE_INFINITY : Number.parseInt(b.label, 10)))
  else if (rows.every(item => /^\$[\d,]+/.test(item.label))) rows.sort((a, b) =>
    Number(a.label.replace(/[^\d.]/g, '')) - Number(b.label.replace(/[^\d.]/g, '')))
  return <RankedCard row={row} now={now} kind="linked" rows={rows} note={`${markets.length} linked questions`}/>
}

/** The two linked PreStock contracts still open as separate YES/NO books;
 *  this directory card uses the established duel layout to compare them. */
function LinkedDuelCard({ row, now }: { row: DirectoryRow; now: number }) {
  const markets = row.markets ?? []
  const chances = normalisedChances(markets.map(market => market.outcomes[0]))
  return <CardFrame row={row} now={now} kind="versus"><div className="mk-versus">
    {markets.map((market, index) => {
      const symbol = market.presentation?.answer?.label ?? market.title
      const logoUrl = market.presentation?.answer?.imageUrl
      const quoted = market.outcomes[0]?.indicative === false && chances[index] !== undefined
      const team = { teamId: market.id, symbol, name: symbol, logoUrl } as SolzMatch['teams'][number]
      return <VersusPick key={market.id} team={team} probability={chances[index] ?? 0} indicative={!quoted}
        href={`/events/${encodeURIComponent(row.match.id)}`}/>
    })}
  </div></CardFrame>
}

/** An agent forecast names itself `ColaCat agent: <SYMBOL> between ...`
 *  (solz-prediction-backend/apps/stake-api/general-events.ts:313). Yes means the
 *  agent is right, so the agent and its subject are the two sides of this card.
 *  Any brand's name matches, so a renamed backend title still reads as a forecast. */
const AGENT_FORECAST = new RegExp(`^(?:${Object.values(brands).map((item) => item.name).join('|')}) agent:\\s*(\\S+)`, 'i')

/** A standalone question has no teams, but it is still one side against another:
 *  Yes against No. It takes the head-to-head card's shape - identity on the left,
 *  the same filled buttons on the right - and the buttons stay semantic, lime for
 *  Yes and pink for No, because the outcomes are contracts and not teams. */
function QuestionCard({ row, now }: { row: DirectoryRow; now: number }) {
  const outcomes = row.market?.outcomes ?? []
  const presentation = row.market?.presentation
  const forecast = AGENT_FORECAST.exec(presentation?.eventTitle ?? row.title ?? '')
  const logoUrl = presentation?.imageUrl
  const href = `/events/${encodeURIComponent(row.match.id)}`
  return <CardFrame row={row} now={now} kind="question">
    <div className={`mk-question${logoUrl || forecast ? ' has-identity' : ''}`}>
      {(logoUrl || forecast) && <div className="mk-question-identity">
        <TeamMark id={row.market?.id ?? row.match.id} logoUrl={logoUrl}/>
        <div>
          {forecast && <strong>{forecast[1]}</strong>}
          {forecast && <span className="mk-question-agent"><img src={brand.badge} alt="" width={16} height={16}/>{brand.name} agent forecast</span>}
        </div>
      </div>}
      <div className="mk-question-picks">
        {outcomes.slice(0, 2).map((outcome, index) => <a className={`mk-versus-button ${index === 0 ? 'is-yes' : 'is-no'}`} key={outcome.id} href={href} aria-label={`Open ${outcome.label} market`}>
          <span>{outcome.label}</span><b>{outcome.indicative ? '—' : percent(outcome.probability)}</b>
        </a>)}
      </div>
    </div>
  </CardFrame>
}

/** Three shapes, chosen by what the market actually is: no teams is a plain
 *  question, exactly two is a head-to-head, anything else is a field - ranked
 *  when it has contenders to rank, named when it is one side of many agents. */
export function MarketCard({ row, now }: { row: DirectoryRow; now: number }) {
  // A team-less question and a one-synthetic-side arena room are the same shape:
  // no opponent to split against, but a set of linked questions to rank.
  if (row.match.teams.length < 2) {
    if ((row.markets?.length ?? 0) > 1) {
      if (!row.agentPerformance && row.markets?.length === 2 && row.markets.every(market => market.presentation?.answer?.imageUrl))
        return <LinkedDuelCard row={row} now={now}/>
      return <LinkedQuestionsCard row={row} now={now}/>
    }
    return row.match.teams.length ? <FreeForAllCard row={row} now={now}/> : <QuestionCard row={row} now={now}/>
  }
  if (row.match.teams.length === 2) return <VersusCard row={row} now={now}/>
  return <FreeForAllCard row={row} now={now}/>
}

/**
 * Does what the reader has selected need rows beyond the newest cursor page?
 *
 * Featured, Live and Upcoming are all about matches that have not finished, and
 * the catalogue is ordered newest-created first, so the head page answers them.
 * History is by definition the tail. All spans both. A search or an event-type
 * narrowing is defined across the inventory (MARKET_LIST_API.md), so it must be
 * able to reach rows the head page does not hold — answering it from one page
 * would quietly report "no matching markets" for markets that exist.
 */
export function needsInventory(filter: MarketFilter, eventType: EventTypeFilter, search: string) {
  return filter === 'History' || filter === 'All' || eventType !== 'all' || search.trim().length > 0
}

export function MarketDirectory({ snapshot, questions, loaded = true, error, retry, onScope, extending = false, apiUrl = '', initialGeneral = false }: {
  snapshot: SolzSnapshot | null
  questions: DirectoryRow[]
  loaded?: boolean
  error: string
  retry: () => void
  /** General questions use their own source-side scope; arena history may
   * widen to the full inventory when a selection needs it. */
  onScope?: (depth: 'head' | 'inventory', kind: 'all' | 'general') => void
  apiUrl?: string
  initialGeneral?: boolean
  /** The wider read is still running behind the rows already on screen. */
  extending?: boolean
}) {
  const [filter, setFilter] = useState<MarketFilter>(initialGeneral ? 'All' : 'Featured')
  const [eventType, setEventType] = useState<EventTypeFilter>(initialGeneral ? 'general' : 'all')
  // Topics exist only among general questions; a match has none.
  const [topic, setTopic] = useState<'all' | 'stocks'>('all')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<MarketSort>('recommended')
  const [page, setPage] = useState(1)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [])
  const allRows = useMemo(() => {
    const snapshotMatches = new Map((snapshot?.matches ?? []).map(match => [match.id, match]))
    const snapshotMarkets = new Map<string, ArenaMarket[]>()
    for (const market of snapshot?.markets ?? []) {
      if (!market.matchId) continue
      const current = snapshotMarkets.get(market.matchId) ?? []
      current.push(market)
      snapshotMarkets.set(market.matchId, current)
    }
    return sortRows(questions.map(row => {
      const match = snapshotMatches.get(row.match.id)
      if (!match) return row
      const markets = snapshotMarkets.get(match.id) ?? row.markets ?? []
      return { ...row, match, market: markets[0] ?? row.market, markets: markets.length ? markets : row.markets, title: row.title ?? matchTitle(match) }
    }).filter(row => {
      const phase = row.match.phase
      const selected = filter === 'All'
        || (filter === 'Featured' ? phase !== 'settled' && row.eventType !== 'genesis-ffa'
          : filter === 'Live' ? phase === 'live'
            : filter === 'History' ? phase === 'settled'
              : phase === 'countdown' || phase === 'queued')
      const typeSelected = eventType === 'all' || row.eventType === eventType
      const topicSelected = eventType !== 'general' || topic === 'all' || row.category === topic
      return selected && typeSelected && topicSelected && `${row.title ?? ''} ${row.match.mode} ${eventTypeLabel(row)} ${row.match.teams.map(team => team.name).join(' ')}`.toLowerCase().includes(search.trim().toLowerCase())
    }), sort)
  }, [snapshot, questions, filter, eventType, search, topic, sort])
  useEffect(() => setPage(1), [filter, eventType, search, topic, sort])
  // General questions must not trigger an unrelated walk through match history.
  useEffect(() => {
    if (eventType === 'general') onScope?.('head', 'general')
    else onScope?.(needsInventory(filter, eventType, search) ? 'inventory' : 'head', 'all')
  }, [filter, eventType, search, onScope])
  const pageCount = Math.max(1, Math.ceil(allRows.length / PAGE_SIZE))
  useEffect(() => setPage(current => Math.min(current, pageCount)), [pageCount])
  const rows = allRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const setStatusFilter = (value: MarketFilter) => { setFilter(value); setPage(1) }
  const setTypeFilter = (value: EventTypeFilter) => {
    setEventType(value)
    if (value === 'general') setSearch('')
    if (value === 'genesis-ffa' && filter === 'Featured') setFilter('All')
    setPage(1)
  }
  const movePage = (next: number) => {
    setPage(Math.max(1, Math.min(pageCount, next)))
    document.querySelector('#market-directory')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const pagination = pageCount > 1 && <nav className="mk-pagination" aria-label="Market pages">
    <button type="button" onClick={() => movePage(page - 1)} disabled={page === 1}><ArrowLeft size={16}/>Previous</button>
    <span>Page <b>{page}</b> of {pageCount}</span>
    <button type="button" onClick={() => movePage(page + 1)} disabled={page === pageCount}>Next<ArrowRight size={16}/></button>
  </nav>
  return <AppShell className="solz-home mk-app" mainId="market-directory" mainClassName="mk-main" marketsHref="/markets" active="markets" skipTo="#market-directory" skipLabel="Skip to markets" backToTopHref="#market-directory">
      {/* One band: what the page is and how many markets match on the left,
          every control that narrows or orders the grid on the right. */}
      <header className="mk-heading">
        <div className="mk-heading-copy">
          <span>EVENT CATALOGUE</span><h1 className="sz-page-title">{eventType === 'general' ? 'General questions' : 'Prediction markets'}</h1>
          <p>{eventType === 'general' ? `Explore real-world questions on PANTA and ${brand.name}.` : 'Follow live matches and explore general questions.'}</p>
          <div className="mk-results-meta">
            {!loaded && !questions.length ? <span className="mk-pending mk-pending--count" aria-hidden="true"/>
              : <span className="mk-result-count" role="status">{allRows.length ? `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, allRows.length)} of ${allRows.length}${extending ? ' so far' : ''}` : extending ? 'Reading the full catalogue…' : '0 markets'}</span>}
            {filter === 'Featured' && eventType === 'all' && <span className="mk-filter-note">Routine Genesis FFA rounds are hidden. <button type="button" onClick={() => setTypeFilter('genesis-ffa')}>Show them</button></span>}
          </div>
        </div>
        <div className="mk-heading-controls">
          <nav className="mk-segments" aria-label="Filter by status">{filters.map(item => <button type="button" key={item} aria-pressed={filter === item} onClick={() => setStatusFilter(item)}>{item}</button>)}</nav>
          <div className="mk-directory-tools">
            {eventType === 'general'
              ? <label className="mk-select"><span>Topic</span><select value={topic} onChange={event => setTopic(event.target.value as 'all' | 'stocks')}><option value="all">All topics</option><option value="stocks">Stocks</option></select></label>
              : <label className="mk-search"><Search size={15}/><input type="search" aria-label="Search markets" placeholder="Search markets" value={search} onChange={event => setSearch(event.target.value)}/></label>}
            <label className="mk-select"><span>Type</span><select value={eventType} onChange={event => setTypeFilter(event.target.value as EventTypeFilter)}>
              <option value="all">All events</option>{showsSection('miawprix') && <option value="miaw-prix">MIAW Prix · Colosseum</option>}<option value="match">Ranked / stake match</option><option value="general">General questions</option><option value="genesis-ffa">Genesis Agent FFA</option>
            </select></label>
            <label className="mk-select"><span>Sort</span><select value={sort} onChange={event => setSort(event.target.value as MarketSort)}>{sorts.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          </div>
        </div>
      </header>
      {eventType === 'general' && <><PantaTrackedList apiUrl={apiUrl}/><PantaMarkets apiUrl={apiUrl}/><header className="gq-section-heading"><div><h2>{brand.name} questions</h2><p>Community, season and stock questions from the {brand.name} catalogue, settled by their published rules.</p></div></header></>}
      {error && !questions.length && loaded ? <div className="mk-state" role="alert"><strong>Markets could not load.</strong><span>{error}</span><button className="sh-button" onClick={retry}>Try again</button></div> : !loaded && !questions.length ? <div className="mk-card-grid" role="status" aria-busy="true" aria-label="Loading markets">
        {/* Placeholders in the real grid, at the real card size: the row does not
            jump when the snapshot lands, and a slow upstream reads as the page
            filling in rather than as an empty bordered slab. */}
        {[0, 1, 2].map((slot) => <div className="mk-card mk-card--pending" key={slot} aria-hidden="true">
          <span className="mk-pending mk-pending--title"/>
          <span className="mk-pending mk-pending--detail"/>
          <span className="mk-pending mk-pending--row"/>
          <span className="mk-pending mk-pending--row"/>
          <span className="mk-pending mk-pending--row"/>
        </div>)}
      </div> : <>
        {/* A count taken while the wider read is still running is a count of
            what has arrived, not of what matches — so it says so rather than
            letting a partial number read as the answer. */}
        {pagination && <div className="mk-results-bar">{pagination}</div>}
        {rows.length ? <div className="mk-card-grid">{rows.map(row => <MarketCard key={row.match.id} row={row} now={now}/>)}</div>
          : extending ? <div className="mk-empty" role="status"><strong>Reading the full catalogue…</strong><span>History and search span every match ever listed, so this view is still loading the rest of them.</span></div>
          : <div className="mk-empty"><strong>{search || filter !== 'All' ? 'No matching markets' : 'No markets available yet'}</strong><span>{eventType === 'general' ? `${brand.name} questions will appear here when published.` : search || filter !== 'All' ? 'Try another filter or search.' : 'Every ranked or stake match appears here as soon as it has a match ID.'}</span></div>}
        {pagination && <div className="mk-pagination-bottom">{pagination}</div>}
      </>}
  </AppShell>
}

export function MarketsDirectoryApp({ apiUrl = '' }: Props) {
  const source = useMemo(() => createSolzDataSource({ simulationEnabled: () => false }), [])
  const { snapshot, error, retry } = useHomeData(source, apiUrl)
  const venue = useSolanaVenue(apiUrl)
  /**
   * HOW MUCH CATALOGUE THIS PAGE IS ALLOWED TO ASK FOR.
   *
   * 'open' is the default and is one request: status=eligible, selected at the
   * source, no cursor. It answers Featured, Live and Upcoming completely.
   *
   * It widens to 'inventory' - status=all, the whole cursor chain, walked once -
   * the first time the reader selects something that is defined across the
   * inventory: History, All, an event type, or a search. It never narrows back,
   * because the rows are already held and dropping them would throw away a walk
   * the reader just waited for.
   *
   * The page used to open directly on status=all and crawl the entire chain -
   * 15 requests, ~10,600 items, 77s a lap - and restart that crawl every ten
   * seconds. Every lap rebuilt a market PDA, a token identity pass and an
   * on-chain price read for every row, which is what kept the grid on its
   * skeletons: the commit that would have replaced them never got a free frame.
   */
  const [scope, setScope] = useState<'open' | 'inventory'>('open')
  const [kind, setKind] = useState<'all' | 'general'>('all')
  const widen = useCallback((depth: 'head' | 'inventory', nextKind: 'all' | 'general') => {
    setKind(nextKind)
    if (depth === 'inventory') setScope('inventory')
  }, [])
  const catalogue = useMarketCatalogue(
    apiUrl,
    kind === 'general' || scope === 'inventory' ? 'all' : 'eligible',
    30_000,
    kind === 'general' || scope === 'open' ? 'head' : 'inventory',
    kind,
  )
  const reserved = useReservedSolanaQuestions(apiUrl, venue, !catalogue.available)
  // GET /market/list is the catalogue (docs/MARKET_LIST_API.md). Its market
  // addresses are derived here from (programId, matchId, questionId) rather than
  // read off the wire, so a catalogue row can never point trading at another
  // market. `available` is false only when the backend says it has no such route,
  // which keeps the directory working against one that predates it.
  const rawCatalogueQuestions = useMemo(() => catalogueQuestions(catalogue.items, venue), [catalogue.items, venue])
  const identifiedCatalogueQuestions = useQuestionIdentity(rawCatalogueQuestions)
  const catalogued = useMemo(() => identifiedCatalogueQuestions.map(question => ({ ...reservedSolanaView(question, Date.now(), venue), question })), [identifiedCatalogueQuestions, venue])
  const questionCatalogue = catalogue.available ? catalogued : reserved.questions
  /**
   * ONLY TRADABLE MARKETS ARE PRICED FROM THE CHAIN.
   *
   * useSolanaMarketPrices derives a PDA and reads two book accounts per market,
   * every pass. Handed the whole catalogue that was ~21,000 account reads per
   * cycle for a grid of twelve cards, chunked into hundreds of RPC round trips —
   * the single largest thing blocking this page's main thread.
   *
   * A settled or cancelled market has no book worth reading and no price that
   * can still move: its card shows a result, not a quote. Narrowing to markets
   * whose trading has not locked is therefore not a sampling compromise, it is
   * the set that has a live price at all. Measured against the deployed
   * catalogue that is ~137 of ~10,610 rows.
   *
   * `phase === 'settled'` is the right test and not merely the convenient one:
   * reservedSolanaView (src/components/home/solanaQuestionMarkets.ts:179) sets
   * it from `cancelled || settled || past its trading window`, which is exactly
   * "no longer tradable" rather than "reported as resolved".
   */
  const tradableMarkets = useMemo(
    () => questionCatalogue.filter((view) => view.match.phase !== 'settled').map((view) => view.market),
    [questionCatalogue],
  )
  const priced = useSolanaMarketPrices(tradableMarkets, venue, true).markets
  const pricedById = useMemo(() => new Map(priced.map((market) => [`${market.matchId}:${market.id}`, market])), [priced])
  const metadataByEvent = useMemo(() => new Map(catalogue.items.map(item => [item.eventId, item])), [catalogue.items])
  // Every catalogue event gets one directory row. Market existence is not
  // conditional on a live arena snapshot or on somebody already paying to
  // create its PDA; the merge above replaces only its live match telemetry.
  const questions = useMemo<DirectoryRow[]>(
    () => questionEvents(questionCatalogue).map((views) => {
      const markets = views.map((view) => pricedById.get(`${view.market.matchId}:${view.market.id}`) ?? view.market)
      const opened = markets.some(market => market.onchain?.family === 'SOLANA' && market.onchain.opened)
      const metadata = metadataByEvent.get(views[0].question.eventId)
      return {
        match: views[0].match,
        market: markets[0],
        markets,
        title: views[0].question.presentation?.eventTitle ?? markets[0]?.presentation?.eventTitle ?? linkedQuestionTitle(markets.map((market) => market.title)),
        collateral: venue?.collateralSymbol ?? 'Collateral',
        opened,
        kind: metadata?.kind ?? (views[0].question.questionId.slice(12, 14) === '02' ? 'general' : 'match'),
        eventType: metadata?.eventType ?? (views[0].question.questionId.slice(12, 14) === '02' ? 'general' : 'match'),
        matchNumber: metadata?.matchNumber,
        hasHumans: metadata?.hasHumans ?? false,
        gameMode: metadata?.gameMode,
        teamFormat: metadata?.teamFormat,
        ...(metadata?.category ? { category: metadata.category } : {}),
        agentPerformance: views[0].question.eventId.endsWith('-agent'),
      }
    }),
    [questionCatalogue, pricedById, metadataByEvent],
  )
  return <MarketDirectory
    snapshot={snapshot}
    questions={questions}
    loaded={catalogue.available ? catalogue.loaded : reserved.loaded}
    error={catalogue.available ? catalogue.status === 'failed' ? 'The market catalogue is temporarily unavailable.' : '' : error}
    retry={() => { catalogue.retry(); retry() }}
    onScope={widen}
    extending={catalogue.extending}
    apiUrl={apiUrl}
  />
}
