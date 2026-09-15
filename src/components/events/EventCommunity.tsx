import { ArrowUp, ArrowUpRight, Bot, ChevronDown, Heart, MessageSquare, Send, ShieldCheck, X } from 'lucide-react'
import { useRef, useState, type CSSProperties } from 'react'
import type { ArenaMarket, ArenaMarketOutcome, ChatMessage, SolzDataSource, SolzMatch, SolzSnapshot } from '../solz/model'
import { Tabs, TabPanel } from '../solz/ui'
import { amountLabel, StatusDot } from '../home/HomePrimitives'
import { outcomeColor } from '../home/heroMarket'
import { baseOutcomeId } from '../solz/predictionContracts'
import { useSolanaWallet } from '../session/store'
import { useVenueActivity } from '../home/venue/useVenueActivity'
import { useVenueHolders, type VenueHoldersView } from '../home/venue/useVenueHolders'
import { venueBinding } from '../home/venue/useVenueMarket'
import { eventActivity, eventAnswerMarket, eventHoldings, nameSeed, relativeTime } from './eventModel'

/** Wallets are rendered truncated, the same shape the activity feed uses. */
const shortAddress = (value: string) => value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value

const communityColor = (outcome: ArenaMarketOutcome, snapshot: SolzSnapshot, index = 0) => outcome.label === 'Yes' ? '#87dfb4' : outcome.label === 'No' ? '#f793a3' : outcomeColor(outcome, snapshot, index)

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
  return <>
    <div className="ev-table-toolbar"><span>{market.title}</span><div><label><span className="sr-only">Filter holders</span><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All outcomes</option>{market.outcomes.map((outcome) => <option value={outcome.id} key={outcome.id}>{outcome.label}</option>)}</select></label></div></div>
    {/* One live region for the whole grid, mounted empty so a later message is
        announced, and polite because a background read failing is not worth
        interrupting a screen reader. It used to sit inside the column map, which
        announced the same sentence once per outcome — and, worse, replaced the
        rows the hook deliberately preserves across a throttled read. */}
    <p className="ev-holders-status" role="status">{holders.error || (rows === null && holders.supported ? 'Reading holders from chain…' : '')}</p>
    <div className="ev-holders-grid">{outcomes.map((outcome, index) => {
      const column = (rows ?? []).filter((item) => item.outcomeId === outcome.id)
      return <section className="ev-holder-column" key={outcome.id}><h3><i style={{ background: communityColor(outcome, snapshot, index) }}/>{outcome.label}<span>SHARES</span></h3>
        {/* Four different silences, told apart: no venue to ask, a read that has
            not answered yet, a scan that could not complete, and a read that came
            back with nobody holding this side. */}
        {!holders.supported ? <p className="ev-empty">This venue does not publish per-wallet holdings.</p>
          : rows === null ? <p className="ev-empty">Reading holders from chain…</p>
          : column.length ? column.map((row, rank) => <div className={`ev-holder-row ${row.self ? 'is-self' : ''}`} key={`${outcome.id}:${row.owner}`}><span className="ev-ranked-avatar"><SpectatorAvatar name={row.owner}/><b className={rank < 3 ? `is-rank-${rank + 1}` : ''}>{rank + 1}</b></span><span className="ev-holder-name">{row.self ? 'YOU' : shortAddress(row.owner)}</span><strong style={{ color: communityColor(outcome, snapshot, index) }}>{amountLabel(row.shares)}</strong></div>)
          : holders.partial ? <p className="ev-empty">No {outcome.label} holders found, but part of the scan did not complete.</p>
          : <p className="ev-empty">Nobody holds {outcome.label} yet.</p>}
      </section>
    })}</div>
    <p className="ev-data-note">{holders.supported
      ? `On-chain holders · shares held in the wallet, the venue seat, resting sell orders and the ${collateral} position account${holders.partial ? ' · some accounts could not be scanned, so this list is a floor' : ''}`
      : 'Holder data comes from the venue this market settles on.'}</p>
  </>
}

/** Your own positions in this market, with the basis the app actually tracks. */
function Positions({ snapshot, market, collateral }: { snapshot: SolzSnapshot; market: ArenaMarket; collateral: string }) {
  const [filter, setFilter] = useState('all')
  const [order, setOrder] = useState('desc')
  const holdings = eventHoldings(snapshot, market)
  const outcomes = market.outcomes.filter((outcome) => filter === 'all' || outcome.id === filter)
  return <>
    <div className="ev-table-toolbar"><span>{market.title}</span><div><label><span className="sr-only">Filter positions</span><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All outcomes</option>{market.outcomes.map((outcome) => <option value={outcome.id} key={outcome.id}>{outcome.label}</option>)}</select></label><label><span className="sr-only">Sort profit and loss</span><select value={order} onChange={(event) => setOrder(event.target.value)}><option value="desc">Highest P&amp;L</option><option value="asc">Lowest P&amp;L</option></select></label></div></div>
    <div className="ev-holders-grid">{outcomes.map((outcome, index) => {
      const rows = holdings.filter((item) => item.outcomeId === outcome.id).sort((a, b) => (a.pnl - b.pnl) * (order === 'desc' ? -1 : 1))
      return <section className="ev-holder-column" key={outcome.id}><h3><i style={{ background: communityColor(outcome, snapshot, index) }}/>{outcome.label}<span>P&L · {collateral}</span></h3>{rows.length ? rows.map((row) => <div className="ev-holder-row" key={row.id}><span className="ev-ranked-avatar"><SpectatorAvatar name={row.author}/></span><span className="ev-holder-name">{row.author}<small>avg {(row.averagePrice * 100).toFixed(1)}¢</small></span><strong className={row.pnl >= 0 ? 'ev-positive' : 'ev-negative'}>{row.pnl > 0 ? '+' : ''}{amountLabel(row.pnl)}</strong></div>) : <p className="ev-empty">No position in {outcome.label}. Choose an outcome above to start.</p>}</section>
    })}</div>
    <p className="ev-data-note">Your positions and their entry price. Other holders' share counts are on chain in Top holders; their entry price is not — no account on this venue stores a cost basis.</p>
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
  const visible = rows.filter((row) => kind === 'all' || row.kind === kind)
  const short = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`
  return <>
    <div className="ev-activity-toolbar"><label><span className="sr-only">Activity type</span><select value={kind} onChange={(event) => setKind(event.target.value)}><option value="all">All activity</option><option value="fill">Fills</option><option value="order">Placed orders</option><option value="cancel">Cancels</option></select></label><StatusDot pink={!rows.length}>ON-CHAIN</StatusDot></div>
    <div className="ev-activity-feed">{loading && !rows.length ? <p className="ev-empty" role="status">Reading market activity from chain…</p>
      : error ? <p className="ev-empty" role="alert">{error}</p>
      : visible.length ? visible.map((row) => <article key={row.id}>{row.owner ? <SpectatorAvatar name={row.owner}/> : <span className="ev-avatar" aria-hidden="true"/>}<div><p><strong>{row.owner ? short(row.owner) : 'Market'}</strong> {row.label.toLowerCase()} <span>({row.detail})</span></p></div><time>{relativeTime(row.at, snapshot.updatedAt)}</time></article>)
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

export function EventCommunity({ snapshot, match, source, market, hideComments, prediction, priced, collateral = 'COOLA' }: CommunityProps & { hideComments: boolean; prediction?: ArenaMarket; priced?: ArenaMarket[]; collateral?: string }) {
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
  const communityMarket = prediction ? market : group.outcomes.length > 2 ? eventAnswerMarket(group, answer) : group
  // One read for the whole section. TabPanel mounts its children whether or not
  // they are the active tab, so a hook inside each panel would scan the program
  // twice for the same question.
  const wallet = useSolanaWallet()
  const holders = useVenueHolders(communityMarket, wallet?.address, tab === 'holders')
  const section = useRef<HTMLElement>(null)
  return <section className="ev-community" ref={section} id="event-community" aria-label="Event community">
    <Tabs idPrefix="event-community" label="Event community" value={tab} onChange={setTab} tabs={[...(!hideComments ? [{ id: 'comments', label: <>Comments <span>{snapshot.chat.filter((item) => item.matchId === match.id && item.kind === 'viewer').length}</span></> }] : []), { id: 'holders', label: 'Top holders' }, { id: 'positions', label: 'Positions' }, { id: 'activity', label: 'Activity' }]}/>
    {(tab === 'holders' || tab === 'positions') && <div className="ev-community-market">{prediction ? <span className="ev-community-answer">{market.title.split(' · ')[0]} · Yes / No</span> : <label><span className="sr-only">Community market</span><select value={communityMarket.id} onChange={(event) => setMarketId(event.target.value)}>{markets.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}{!prediction && group.outcomes.length > 2 && <label><span className="sr-only">Community answer</span><select value={answer.id} onChange={(event) => setAnswerId(event.target.value)}>{group.outcomes.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}{/* The chip described the whole section as simulated whatever it was
      showing. It now names the source the holders list actually came from. */}
      <span className="ch-simulation">{holders.supported && tab === 'holders' ? 'ON-CHAIN' : 'SIMULATION'}</span></div>}
    {!hideComments && <TabPanel id="comments" idPrefix="event-community" active={tab === 'comments'}><EventComments snapshot={snapshot} match={match} source={source} market={communityMarket}/></TabPanel>}
    <TabPanel id="holders" idPrefix="event-community" active={tab === 'holders'}><TopHolders key={`${communityMarket.id}:${communityMarket.outcomes[0].id}`} snapshot={snapshot} market={communityMarket} holders={holders} collateral={collateral}/></TabPanel>
    <TabPanel id="positions" idPrefix="event-community" active={tab === 'positions'}><Positions key={`${communityMarket.id}:${communityMarket.outcomes[0].id}`} snapshot={snapshot} market={communityMarket} collateral={collateral}/></TabPanel>
    {/* A market with a venue has real receipts; one without is still the local
        arena preview, and the tape is what that preview has. */}
    <TabPanel id="activity" idPrefix="event-community" active={tab === 'activity'}>{venueBinding(communityMarket) ? <VenueActivity market={communityMarket} active={tab === 'activity'} snapshot={snapshot}/> : <Activity snapshot={snapshot} match={match} prediction={prediction}/>}</TabPanel>
    <a className="ev-back-top" href="#event-title">Back to top <ArrowUp size={14}/></a>
  </section>
}
