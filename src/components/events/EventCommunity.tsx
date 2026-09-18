import { ArrowUp, ArrowUpRight, Bot, ChevronDown, Heart, MessageSquare, Send, ShieldCheck, X } from 'lucide-react'
import { useRef, useState, type CSSProperties } from 'react'
import type { ArenaMarket, ArenaMarketOutcome, ChatMessage, SolzDataSource, SolzMatch, SolzSnapshot } from '../solz/model'
import { Tabs, TabPanel } from '../solz/ui'
import { amountLabel, Spinner, StatusDot } from '../home/HomePrimitives'
import { outcomeColor } from '../home/heroMarket'
import { baseOutcomeId } from '../solz/predictionContracts'
import { useSolanaWallet } from '../session/store'
import { TraderAvatar, TraderIdentity } from '../identity/TraderIdentity'
import { formatUnitsExact, sharePrice } from '../prediction/amounts'
import { profileHref, solanaNetwork } from '../portfolio/profileRoute'
import { useVenueActivity } from '../home/venue/useVenueActivity'
import { useVenueHolders, type VenueHoldersView } from '../home/venue/useVenueHolders'
import { useVenuePositions, type VenuePositionsView } from '../home/venue/useVenuePositions'
import { venueBinding } from '../home/venue/useVenueMarket'
import { eventActivity, eventAnswerMarket, eventHoldings, nameSeed, relativeTime } from './eventModel'

const communityColor = (outcome: ArenaMarketOutcome, snapshot: SolzSnapshot, index = 0) => outcome.label === 'Yes' ? '#87dfb4' : outcome.label === 'No' ? '#f793a3' : outcomeColor(outcome, snapshot, index)

/** A wallet's page on this app, when the market's venue says which cluster it
 *  settles on. Without a network the route cannot be built, so the name is left
 *  as plain text rather than linked somewhere wrong. */
function traderHref(market: ArenaMarket) {
  const binding = venueBinding(market)
  const network = binding?.family === 'SOLANA' ? solanaNetwork(binding.genesisHash) : undefined
  return (address: string) => network ? profileHref('solana', network, address) : undefined
}

/** Placeholders shaped like the rows they stand in for.
 *
 *  AGENTS.md: loading keeps the surface's structure. These panels used to swap a
 *  column of rows for one grey sentence, which reflows the page twice and reads
 *  as an error at a glance. The sentence is not lost — each panel has exactly
 *  one live region, and that is where it is announced. */
function HolderSkeleton({ rows = 3 }: { rows?: number }) {
  return <div aria-hidden="true">{Array.from({ length: rows }, (_row, index) =>
    <div className="ev-holder-row" key={index}>
      <span className="ev-sk ev-sk-avatar"/>
      <span className="ev-holder-identity"><span className="ev-sk ev-sk-line" style={{ width: `${62 - index * 9}%` }}/></span>
      <span className="ev-sk ev-sk-line" style={{ width: 42 }}/>
    </div>)}</div>
}

function ActivitySkeleton({ rows = 4 }: { rows?: number }) {
  return <div aria-hidden="true">{Array.from({ length: rows }, (_row, index) =>
    <article key={index}>
      <span className="ev-sk ev-sk-avatar"/>
      <div><span className="ev-sk ev-sk-line" style={{ width: `${78 - index * 11}%` }}/></div>
      <span className="ev-sk ev-sk-line" style={{ width: 38 }}/>
    </article>)}</div>
}

export function SpectatorAvatar({ name }: { name: string }) {
  return <span className="ev-avatar" aria-hidden="true" style={{ '--avatar-color': ['#c7ff00', '#ff91be', '#7da9ff', '#63d5cf', '#e9bd68', '#c6a4eb'][nameSeed(name) % 6] } as CSSProperties}>{name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase()}</span>
}

type CommunityProps = { snapshot: SolzSnapshot; match: SolzMatch; source: SolzDataSource; market: ArenaMarket }

export function EventComments({ snapshot, match, source, market, rail = false }: CommunityProps & { rail?: boolean }) {
  const [text, setText] = useState('')
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null)
  const [sort, setSort] = useState('newest')
  const [liked, setLiked] = useState<string[]>([])
  const [expanded, setExpanded] = useState<string[]>([])
  const [feedback, setFeedback] = useState('')
  const input = useRef<HTMLTextAreaElement>(null)
  const messages = snapshot.chat.filter((message) => message.matchId === match.id && message.kind === 'viewer')
  // Your own positions, used to tag your own comment. There is deliberately no
  // "holders only" filter any more: comment authors are display names on a local
  // preview and holders are wallet addresses read from chain, so the two sets can
  // never intersect. The control used to appear to work only because the sample
  // holder pool was seeded from the same names as the sample comments.
  const holdings = eventHoldings(snapshot, market)
  const score = (message: ChatMessage) => (message.self ? 0 : nameSeed(message.id) % 19) + (liked.includes(message.id) ? 1 : 0)
  const threads: Array<{ message: ChatMessage; replies: ChatMessage[] }> = []
  for (const message of [...messages].sort((a, b) => a.at - b.at)) {
    const parent = message.replyToId ? threads.find((thread) => thread.message.id === message.replyToId || thread.replies.some((reply) => reply.id === message.replyToId)) : undefined
    if (parent) parent.replies.push(message)
    else threads.push({ message, replies: [] })
  }
  const visible = [...threads].sort((a, b) => sort === 'top' ? score(b.message) - score(a.message) : b.message.at - a.message.at)
  const reply = (message: ChatMessage) => { setReplyTo(message); input.current?.focus() }
  const comment = (message: ChatMessage, nested = false) => {
    const position = holdings.find((item) => item.author === message.author)
    const outcome = market.outcomes.find((item) => item.id === position?.outcomeId)
    const positionLabel = outcome && ['Yes', 'No'].includes(outcome.label) ? `${outcome.label} · ${market.title.split(' · ')[0]}` : outcome?.label
    return <article className={`ev-comment ${message.self ? 'is-self' : ''} ${nested ? 'is-reply' : ''}`} key={message.id}>
      <SpectatorAvatar name={message.author}/><div><header><strong>{message.author}</strong>{message.self && <span className="ev-you">YOU</span>}<time>{relativeTime(message.at, snapshot.updatedAt)}</time></header><p>{message.text}</p>
        {rail && position && outcome && <div className="ev-comment-position"><span><i style={{ background: communityColor(outcome, snapshot) }}/>{positionLabel}<small>POSITION</small></span><b>{amountLabel(position.shares)}<small>SHARES</small></b></div>}
        <div className="ev-comment-actions"><button aria-label={`${liked.includes(message.id) ? 'Unlike' : 'Like'} comment by ${message.author}`} aria-pressed={liked.includes(message.id)} onClick={() => setLiked((previous) => previous.includes(message.id) ? previous.filter((id) => id !== message.id) : [...previous, message.id])}><Heart size={13} fill={liked.includes(message.id) ? 'currentColor' : 'none'}/>{score(message)}</button><button onClick={() => reply(message)}><MessageSquare size={13}/>Reply</button>{!rail && position && outcome && <span style={{ color: communityColor(outcome, snapshot) }}>{positionLabel} holder</span>}</div>
      </div>
    </article>
  }
  return <section className={`ev-comments ${rail ? 'ev-comments--rail' : ''}`} aria-label={rail ? 'Live event comments' : 'Event comments'}>
    {rail && <div className="ev-rail-heading"><h2><MessageSquare size={15}/> THE SIDELINE</h2><StatusDot>{messages.length}</StatusDot></div>}
    <div className="ev-comment-compose">
      {replyTo && <div className="ev-replying">Replying to {replyTo.author}<button aria-label="Cancel reply" onClick={() => setReplyTo(null)}><X size={13}/></button></div>}
      <form onSubmit={(event) => { event.preventDefault(); if (!text.trim()) return; try { source.sendChat(match.id, `${replyTo ? `@${replyTo.author} ` : ''}${text.trim()}`, replyTo?.id); if (replyTo) setExpanded((previous) => [...previous, replyTo.id]); setText(''); setReplyTo(null); setFeedback('Comment posted to this local preview.') } catch (reason) { setFeedback(reason instanceof Error ? reason.message : 'Your comment could not be posted.') } }}>
        <label className="sr-only" htmlFor={rail ? 'rail-comment' : 'event-comment'}>Add a comment</label><textarea ref={input} id={rail ? 'rail-comment' : 'event-comment'} value={text} onChange={(event) => setText(event.target.value)} placeholder={rail ? 'Make your call…' : 'Add a comment…'} maxLength={replyTo ? 220 - replyTo.author.length : 240} rows={1} required/><button disabled={!text.trim() || !snapshot.capabilities.chat.ready} aria-label="Post comment">{rail ? <Send size={15}/> : <>Post <ArrowUpRight size={14}/></>}</button>
      </form>
      {feedback && <p className="ev-comment-feedback" role="status">{feedback}</p>}
    </div>
    <div className="ev-comments-toolbar"><label><span className="sr-only">Sort comments</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="newest">Newest</option><option value="top">Top comments</option></select><ChevronDown size={12}/></label>{!rail && <span><ShieldCheck size={13}/>Keep it in the arena.</span>}</div>
    <div className="ev-comment-feed">{visible.length ? visible.map(({ message, replies }) => <div className="ev-thread" key={message.id}>{comment(message)}{replies.length > 0 && <><button className="ev-reply-toggle" aria-expanded={expanded.includes(message.id)} onClick={() => setExpanded((previous) => previous.includes(message.id) ? previous.filter((id) => id !== message.id) : [...previous, message.id])}>{replies.length} {replies.length === 1 ? 'reply' : 'replies'}<ChevronDown size={12}/></button>{expanded.includes(message.id) && replies.map((response) => comment(response, true))}</>}</div>) : <p className="ev-empty">First in the stands. Make your call.</p>}</div>
    {rail && <div className="ev-rail-foot"><span>LOCAL PREVIEW</span><span>EVERY VOICE IN THE GAME ↗</span></div>}
  </section>
}

/** Every wallet holding this market, read from chain.
 *
 *  Deliberately no average price and no P&L column. Nothing on this venue stores
 *  a cost basis — the position PDA carries quantities only, and the Manifest
 *  seat's quoteVolume is a lifetime bidirectional sum that cannot separate a buy
 *  from a sell — so a third party's entry price is not derivable and the old
 *  "avg 42.3¢" beside a stranger's name was arithmetic on an invented number.
 *  Your own basis is tracked by the app, and lives in Positions. */
function TopHolders({ snapshot, market, holders, collateral }: { snapshot: SolzSnapshot; market: ArenaMarket; holders: VenueHoldersView; collateral: string }) {
  const [filter, setFilter] = useState('all')
  const outcomes = market.outcomes.filter((outcome) => filter === 'all' || outcome.id === filter)
  const rows = holders.rows
  const profile = traderHref(market)
  return <>
    <div className="ev-table-toolbar"><span>{market.title}</span><div><label><span className="sr-only">Filter holders</span><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All outcomes</option>{market.outcomes.map((outcome) => <option value={outcome.id} key={outcome.id}>{outcome.label}</option>)}</select></label></div></div>
    {/* One live region for the whole grid, mounted empty so a later message is
        announced, and polite because a background read failing is not worth
        interrupting a screen reader. It used to sit inside the column map, which
        announced the same sentence once per outcome — and, worse, replaced the
        rows the hook deliberately preserves across a throttled read. */}
    <p className="ev-holders-status" role="status">{holders.error || (rows === null && holders.supported ? <><Spinner small/> Reading holders from chain…</> : '')}</p>
    <div className="ev-holders-grid">{outcomes.map((outcome, index) => {
      const column = (rows ?? []).filter((item) => item.outcomeId === outcome.id)
      return <section className="ev-holder-column" key={outcome.id}><h3><i style={{ background: communityColor(outcome, snapshot, index) }}/>{outcome.label}<span>SHARES</span></h3>
        {/* Four different silences, told apart: no venue to ask, a read that has
            not answered yet, a scan that could not complete, and a read that came
            back with nobody holding this side. */}
        {!holders.supported ? <p className="ev-empty">This venue does not publish per-wallet holdings.</p>
          : rows === null ? <HolderSkeleton/>
          : column.length ? column.map((row, rank) => <div className={`ev-holder-row ${row.self ? 'is-self' : ''}`} key={`${outcome.id}:${row.owner}`}><TraderIdentity className="ev-holder-identity" address={row.owner} self={row.self} label={row.self ? 'YOU' : undefined} href={profile(row.owner)} avatarClassName="ev-avatar" badgeClassName="ev-ranked-avatar" badge={<b className={rank < 3 ? `is-rank-${rank + 1}` : ''}>{rank + 1}</b>}/><strong style={{ color: communityColor(outcome, snapshot, index) }}>{amountLabel(row.shares)}</strong></div>)
          : holders.partial ? <p className="ev-empty">No {outcome.label} holders found, but part of the scan did not complete.</p>
          : <p className="ev-empty">Nobody holds {outcome.label} yet.</p>}
      </section>
    })}</div>
    <p className="ev-data-note">{holders.supported
      ? `On-chain holders · shares held in the wallet, the venue seat, resting sell orders and the ${collateral} position account${holders.partial ? ' · some accounts could not be scanned, so this list is a floor' : ''}`
      : 'Holder data comes from the venue this market settles on.'}</p>
  </>
}

/** One position row, whichever side produced it: the accounting service for a
 *  market with a venue, the local arena preview for one without. */
type PositionRow = { id: string; outcomeId: string; owner?: string; name: string; entry: string; amount: string; sign: number | null; note?: string }

/**
 * Your own positions in this market, with the P&L the accounting service works out.
 *
 * This tab used to read `snapshot.account.positions` — the local arena preview's
 * play account — which is why it was empty on every Solana question no matter
 * how much you had traded: nothing you did on chain was ever in it. Entry price
 * and P&L genuinely cannot be read from the chain at any one moment (the
 * position account carries quantities only, and the venue seat's quoteVolume is
 * a lifetime bidirectional sum), so they come from the indexer that replays this
 * wallet's own fills in order — the same figures the profile page shows.
 *
 * A market with no venue still shows the local preview's holdings: that is what
 * the arena demo has, and it is labelled as such.
 */
function Positions({ snapshot, market, collateral, positions, connected }: { snapshot: SolzSnapshot; market: ArenaMarket; collateral: string; positions: VenuePositionsView; connected: boolean }) {
  const [filter, setFilter] = useState('all')
  const [order, setOrder] = useState('desc')
  const outcomes = market.outcomes.filter((outcome) => filter === 'all' || outcome.id === filter)
  const decimals = positions.decimals
  const rows: PositionRow[] = positions.supported
    ? (positions.rows ?? [])
      // A fully exited outcome keeps its row: realised P&L is the whole record
      // of a trade that is over, and dropping it hides a loss.
      .filter((row) => row.quantity > 0n || (row.realized !== null && row.realized !== 0n))
      .map((row) => {
        const value = row.quantity > 0n ? row.pnl : row.realized
        return {
          id: `${row.outcomeId}:${row.outcome}`,
          outcomeId: row.outcomeId,
          owner: positions.owner,
          name: row.quantity > 0n ? `${formatUnitsExact(row.quantity, decimals, 4)} shares` : 'Closed',
          entry: row.quantity > 0n ? `entry ${sharePrice(row.average, decimals)}` : `realised on ${formatUnitsExact(row.disposed, decimals, 4)} shares`,
          amount: value === null ? 'P&L unavailable' : `${value > 0n ? '+' : ''}${formatUnitsExact(value, decimals, 2)}`,
          // Unknown is its own state. A position the service could not account
          // for is not a flat one, and painting it the colour of break-even
          // would be the invented number this panel exists to avoid.
          sign: value === null ? null : value > 0n ? 1 : value < 0n ? -1 : 0,
          ...(row.complete ? {} : { note: row.reason ?? 'Part of this wallet’s history could not be replayed.' }),
        }
      })
    : eventHoldings(snapshot, market).map((row) => ({
      id: row.id, outcomeId: row.outcomeId, name: `${amountLabel(row.shares)} shares`,
      entry: `entry ${(row.averagePrice * 100).toFixed(1)}¢`,
      amount: `${row.pnl > 0 ? '+' : ''}${amountLabel(row.pnl)}`, sign: Math.sign(row.pnl),
    }))
  // Rows with no P&L sort last either way rather than pretending to be zero.
  const sorted = [...rows].sort((a, b) => a.sign === null || b.sign === null ? (a.sign === null ? 1 : 0) - (b.sign === null ? 1 : 0) : (a.sign - b.sign) * (order === 'desc' ? -1 : 1))
  return <>
    <div className="ev-table-toolbar"><span>{market.title}</span><div><label><span className="sr-only">Filter positions</span><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All outcomes</option>{market.outcomes.map((outcome) => <option value={outcome.id} key={outcome.id}>{outcome.label}</option>)}</select></label><label><span className="sr-only">Sort profit and loss</span><select value={order} onChange={(event) => setOrder(event.target.value)}><option value="desc">Highest P&amp;L</option><option value="asc">Lowest P&amp;L</option></select></label></div></div>
    {/* One live region for the grid, for the same reason the holders board has
        one: a message per column announces the same sentence twice. */}
    <p className="ev-holders-status" role="status">{positions.error || (positions.loading && !positions.rows ? <><Spinner small/> Replaying your fills…</> : '')}</p>
    <div className="ev-holders-grid">{outcomes.map((outcome, index) => {
      const column = sorted.filter((item) => item.outcomeId === outcome.id)
      return <section className="ev-holder-column" key={outcome.id}><h3><i style={{ background: communityColor(outcome, snapshot, index) }}/>{outcome.label}<span>P&L · {collateral}</span></h3>
        {/* The four silences told apart, as on the holders board: no wallet, a
            read still running, a read that failed, and a read that came back
            saying you hold nothing here. */}
        {positions.supported && !connected ? <p className="ev-empty">Connect a wallet to see your positions in {outcome.label}.</p>
          : positions.error ? <p className="ev-empty">Your {outcome.label} position could not be read.</p>
          : positions.supported && positions.rows === null ? <HolderSkeleton rows={2}/>
          : column.length ? column.map((row) => <div className="ev-holder-row" key={row.id}>
            {row.owner
              ? <TraderIdentity className="ev-holder-identity" address={row.owner} self label="YOU" sub={row.entry} avatarClassName="ev-avatar" badgeClassName="ev-ranked-avatar"/>
              : <span className="ev-holder-name">YOU<small>{row.entry}</small></span>}
            <strong className={row.sign === null ? '' : row.sign >= 0 ? 'ev-positive' : 'ev-negative'} title={row.note}>{row.amount}<small>{row.name}</small></strong>
          </div>)
          : <p className="ev-empty">No position in {outcome.label}. Choose an outcome above to start.</p>}
      </section>
    })}</div>
    <p className="ev-data-note">{positions.supported
      ? `Your entry price and P&L, replayed from your own confirmed fills${positions.complete ? '' : ` · ${positions.reason ?? 'part of this wallet’s history is still being backfilled, so these figures are partial'}`}. Other holders' share counts are on chain in Top holders; their entry price is not — no account on this venue stores a cost basis.`
      : 'Positions from the local arena preview. A market settling on chain reports your real entry price and P&L here.'}</p>
  </>
}

/** Confirmed receipts from the market's own venue.
 *
 *  The filters are the ones VenueActivityRow can answer. The chain does carry a
 *  side and a size — decodeBookActivity reads takerIsBuy, isBid and baseAtoms —
 *  but it formats them into the label and detail prose, so the shared row shape
 *  has no field to filter on; restoring those selects means widening that type,
 *  not asking the chain for more. The currency select is genuinely gone: every
 *  row on this venue settles in one collateral. */
function VenueActivity({ market, active, snapshot }: { market: ArenaMarket; active: boolean; snapshot: SolzSnapshot }) {
  const [kind, setKind] = useState('all')
  const { rows, error, loading } = useVenueActivity(market, active)
  // Rows arrive de-duplicated: the reader merges a decoded-receipt cache with
  // each fresh page, and mergeActivity() is the one place that collapses a
  // receipt seen twice — before it can become two React children under one key.
  const visible = rows.filter((row) => kind === 'all' || row.kind === kind)
  const profile = traderHref(market)
  return <>
    {/* The poll re-reads every ten seconds. The chip carries that, in place, so
        a refresh never pushes a second status line under the feed or replaces
        rows that are still on screen with a loading sentence. */}
    <div className="ev-activity-toolbar"><label><span className="sr-only">Activity type</span><select value={kind} onChange={(event) => setKind(event.target.value)}><option value="all">All activity</option><option value="fill">Fills</option><option value="order">Placed orders</option><option value="cancel">Cancels</option></select></label><StatusDot pink={!rows.length}>{loading ? <><Spinner small/> READING</> : 'ON-CHAIN'}</StatusDot></div>
    <div className="ev-activity-feed" aria-busy={loading}>{loading && !rows.length ? <><p className="sr-only" role="status">Reading market activity from chain…</p><ActivitySkeleton/></>
      : error && !rows.length ? <p className="ev-empty" role="alert">{error}</p>
      : visible.length ? <>
        {error && <p className="ev-empty" role="alert">{error}</p>}
        {visible.map((row) => <article key={row.id}>{row.owner ? <TraderAvatar address={row.owner} className="ev-avatar"/> : <span className="ev-avatar" aria-hidden="true"/>}<div><p><strong>{row.owner ? <TraderIdentity address={row.owner} avatar={false} href={profile(row.owner)}/> : 'Market'}</strong> {row.label.toLowerCase()} <span>({row.detail})</span></p></div><time>{relativeTime(row.at, snapshot.updatedAt)}</time></article>)}
      </>
      : <p className="ev-empty">No confirmed {kind === 'all' ? 'activity' : `${kind}s`} on this market yet.</p>}</div>
  </>
}

function Activity({ snapshot, match, prediction }: { snapshot: SolzSnapshot; match: SolzMatch; prediction?: ArenaMarket }) {
  const [side, setSide] = useState('all')
  const [minimum, setMinimum] = useState('0')
  const [token, setToken] = useState('COOLA')
  const [selected, setSelected] = useState<string | null>(null)
  const activity = eventActivity(snapshot, match.id, prediction?.id).filter((entry) => (side === 'all' || entry.side === side) && entry.token === token && entry.size >= Number(minimum))
  return <>
    <div className="ev-activity-toolbar"><label><span className="sr-only">Activity type</span><select value={side} onChange={(event) => setSide(event.target.value)}><option value="all">All trades</option><option value="buy">Buys</option><option value="sell">Sells</option></select></label><label><span className="sr-only">Activity currency</span><select value={token} onChange={(event) => { setToken(event.target.value); setMinimum('0') }}><option value="COOLA">COOLA</option><option value="SOL">SOL</option></select></label><label><span className="sr-only">Minimum trade amount</span><select value={minimum} onChange={(event) => setMinimum(event.target.value)}><option value="0">Min. amount</option>{(token === 'COOLA' ? [100, 1000, 5000] : [.1, 1, 5]).map((value) => <option key={value} value={value}>{amountLabel(value)}+ {token}</option>)}</select></label><StatusDot pink={match.phase !== 'live'}>{match.phase === 'live' ? 'LIVE' : 'RECENT'}</StatusDot></div>
    <div className="ev-activity-feed">{activity.length ? activity.map((entry) => {
      const market = snapshot.markets.find((item) => item.matchId === match.id && item.outcomes.some((outcome) => outcome.id === baseOutcomeId(entry.outcomeId)))
      const color = snapshot.teams.find((team) => team.id === entry.teamId)?.color ?? 'var(--sh-lime)'
      return <article key={entry.id}><SpectatorAvatar name={entry.trader}/><div><p><strong>{entry.trader}</strong>{entry.automated && <Bot size={12}/>} {entry.side === 'buy' ? 'bought' : 'sold'} <b style={{ color }}>{amountLabel(entry.size / entry.price)} {entry.outcomeLabel}</b> for <strong>{market?.title}</strong> at {(entry.price * 100).toFixed(1)}¢ <span>({amountLabel(entry.size)} {entry.token})</span></p>{selected === entry.id && <div className="ev-activity-detail">Preview fill · {new Date(entry.at).toLocaleTimeString('en')} · {entry.automated ? 'Automated' : 'Manual'}<br/>Reference: {entry.id}</div>}</div><time>{relativeTime(entry.at, snapshot.updatedAt)}</time><button aria-label={`View trade by ${entry.trader}`} aria-expanded={selected === entry.id} onClick={() => setSelected(selected === entry.id ? null : entry.id)}><ArrowUpRight size={15}/></button></article>
    }) : <p className="ev-empty">No trades match these filters. New activity will appear here.</p>}</div>
  </>
}

export function EventCommunity({ snapshot, match, source, market, hideComments, prediction, priced, collateral = 'COOLA', apiUrl = '' }: CommunityProps & { hideComments: boolean; prediction?: ArenaMarket; priced?: ArenaMarket[]; collateral?: string; apiUrl?: string }) {
  const [tab, setTab] = useState(hideComments ? 'holders' : 'comments')
  const [marketId, setMarketId] = useState('')
  const [answerId, setAnswerId] = useState('')
  // The priced list from the page, not the raw arena snapshot. snapshot.markets
  // carries no venue binding for a standalone question (it has no arena row at
  // all) and the pre-pricing seed for one that does, so deriving the community
  // market from it handed the holders read a market with nothing to read.
  const markets = priced ?? snapshot.markets.filter((item) => item.matchId === match.id)
  const group = markets.find((item) => item.id === marketId) ?? markets[0] ?? market
  const answer = group.outcomes.find((item) => item.id === answerId) ?? group.outcomes[0]
  const communityMarket = prediction ? market : group.outcomes.length > 2 ? eventAnswerMarket(group, answer, collateral) : group
  // One read for the whole section. TabPanel mounts its children whether or not
  // they are the active tab, so a hook inside each panel would scan the program
  // twice for the same question.
  const wallet = useSolanaWallet()
  const holders = useVenueHolders(communityMarket, wallet?.address, tab === 'holders')
  const positions = useVenuePositions(communityMarket, wallet?.address, apiUrl, tab === 'positions')
  const onChain = tab === 'holders' ? holders.supported : tab === 'positions' ? positions.supported : false
  const section = useRef<HTMLElement>(null)
  return <section className="ev-community" ref={section} id="event-community" aria-label="Event community">
    <Tabs idPrefix="event-community" label="Event community" value={tab} onChange={setTab} tabs={[...(!hideComments ? [{ id: 'comments', label: <>Comments <span>{snapshot.chat.filter((item) => item.matchId === match.id && item.kind === 'viewer').length}</span></> }] : []), { id: 'holders', label: 'Top holders' }, { id: 'positions', label: 'Positions' }, { id: 'activity', label: 'Activity' }]}/>
    {(tab === 'holders' || tab === 'positions') && <div className="ev-community-market">{prediction ? <span className="ev-community-answer">{market.title.split(' · ')[0]} · Yes / No</span> : <label><span className="sr-only">Community market</span><select value={communityMarket.id} onChange={(event) => setMarketId(event.target.value)}>{markets.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}{!prediction && group.outcomes.length > 2 && <label><span className="sr-only">Community answer</span><select value={answer.id} onChange={(event) => setAnswerId(event.target.value)}>{group.outcomes.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}{/* The chip once described the whole section as simulated whatever it was
      showing, which was wrong on both of these tabs the moment the market had a
      venue. It now marks on-chain data and says nothing at all otherwise: an
      absent chip is honest, a chip reading SIMULATION over a real holders list
      was not. */}
      {onChain && <span className="ch-simulation">ON-CHAIN</span>}</div>}
    {!hideComments && <TabPanel id="comments" idPrefix="event-community" active={tab === 'comments'}><EventComments snapshot={snapshot} match={match} source={source} market={communityMarket}/></TabPanel>}
    <TabPanel id="holders" idPrefix="event-community" active={tab === 'holders'}><TopHolders key={`${communityMarket.id}:${communityMarket.outcomes[0].id}`} snapshot={snapshot} market={communityMarket} holders={holders} collateral={collateral}/></TabPanel>
    <TabPanel id="positions" idPrefix="event-community" active={tab === 'positions'}><Positions key={`${communityMarket.id}:${communityMarket.outcomes[0].id}`} snapshot={snapshot} market={communityMarket} collateral={collateral} positions={positions} connected={Boolean(wallet?.address)}/></TabPanel>
    {/* A market with a venue has real receipts; one without is still the local
        arena preview, and the tape is what that preview has. */}
    <TabPanel id="activity" idPrefix="event-community" active={tab === 'activity'}>{venueBinding(communityMarket) ? <VenueActivity market={communityMarket} active={tab === 'activity'} snapshot={snapshot}/> : <Activity snapshot={snapshot} match={match} prediction={prediction}/>}</TabPanel>
    <a className="ev-back-top" href="#event-title">Back to top <ArrowUp size={14}/></a>
  </section>
}
