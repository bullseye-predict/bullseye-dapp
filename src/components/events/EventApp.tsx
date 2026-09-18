import '../../styles/home.css'
import '../../styles/home-hero.css'
import '../../styles/home-markets.css'
import '../../styles/events.css'
import { ArrowUpRight, Bookmark, Check, ChevronRight, Eye, Link as LinkIcon, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createSolzDataSource } from '../solz/solzDataSource'
import type { ArenaMarket, ArenaMarketOutcome, SolzDataSource, SolzMatch, SolzSnapshot } from '../solz/model'
import { OverlayLayer } from '../home/alerts/OverlayLayer'
import { useHomeData } from '../home/useHomeData'
import { reservedSolanaView, resolveQuestionEvent, useQuestionIdentity, useReservedSolanaQuestions, type ReservedSolanaQuestion, type ReservedSolanaView } from '../home/solanaQuestionMarkets'
import type { PublicPredictionVenue } from '../../../packages/prediction-core/market-data'
import { useSolanaVenue } from '../home/useSolanaVenue'
import { useSolanaMarketPrices } from '../home/useSolanaMarketPrices'
import { InteractionConsole, type ConsoleSection } from '../home/InteractionConsole'
import { compact, percent, StatusDot, TeamMark } from '../home/HomePrimitives'
import { MatchAvatar } from '../portfolio/matchIdentity'
import { AppShell } from '../solz/AppShell'
import { EventStage, type EventView } from './EventStage'
import { EventMarkets } from './EventMarkets'
import { EventComments, EventCommunity } from './EventCommunity'
import { EventAgentRail, EventMarketRail } from './EventRails'
import { eventAnswerMarket, eventHref, linkedEventMarket, resolveEvent, resolveEventPrediction, type EventPaths, type EventVariant } from './eventModel'
import { baseOutcomeId, isNoContract, predictionContract } from '../solz/predictionContracts'
import { matchLabel } from '../home/heroMarket'
import { isMiawPrixMatchId } from '../miawprix/MiawPrixEventApp'
import { miawPrixSource, type MiawPrixMatch } from '../miawprix/miawPrixSource'
import { miawPrixEventView } from '../miawprix/miawPrixEventView'
import { useTokenMeta } from '../solz/tokenMeta'
import { resolvedTokenLogo } from '../solz/tokenIcon'
import { catalogueQuestions, eventCatalogueItems } from '../markets/marketList'
import { useMarketCatalogue } from '../markets/useMarketCatalogue'
import { eventTimingLabel } from './eventTiming'

type Props = { apiUrl?: string; eventId: string; predictionId?: string; initialOutcomeId?: string; variant: EventVariant; paths: EventPaths }

export function EventApp(props: Props) {
  return <ArenaEventApp {...props} />
}

function ArenaEventApp(props: Props) {
  // The page ships a server-rendered skeleton because this island is
  // client:only. Drop it synchronously as this tree takes over, so the two
  // never paint in the same frame.
  useLayoutEffect(() => { document.getElementById('boot-skeleton')?.remove() }, [])
  const source = useMemo(() => createSolzDataSource(), [])
  const { snapshot, referenceSnapshot, error, retry } = useHomeData(source)
  // A canonical Solana question is not an arena match, so it is absent from the
  // arena snapshot. Load the question catalogue alongside it so /events/<id>
  // can open a standalone question exactly like a match-backed market.
  const predictionApiUrl = props.apiUrl?.trim() || '/api/prediction'
  const solanaVenue = useSolanaVenue(predictionApiUrl)
  const reserved = useReservedSolanaQuestions(predictionApiUrl, solanaVenue, true, snapshot?.matches ?? [])
  // THE CATALOGUE IS HERE TO RESOLVE ONE EVENT, NOT TO BE REBUILT WHOLE.
  //
  // /market/list?status=all is the entire inventory - ~4,600 rows and ~3.7MB
  // across six cursor pages here - and the walk publishes after every page, so
  // one poll is six downstream rebuilds. Rebuilding meant a market PDA, a token
  // identity pass and a synthetic SolzMatch + ArenaMarket for every row, which
  // is what stopped this page answering the mouse and made the browser offer to
  // kill it. Narrow to this event's rows before any of that runs; the dozen
  // markets the page actually shows cost nothing to build.
  //
  // Ten seconds was also the wrong cadence for it. These rows are catalogue
  // identity - a title, a schedule, a settlement status - and every number that
  // moves comes from the chain reader below or from /solana/questions, both of
  // which still poll on their own clock.
  //
  // 'inventory' because the event this page resolves may be anywhere in the
  // chain, including its settled tail, so the head page alone cannot answer it.
  // The walk now runs ONCE per mount and the 120s poll re-reads only the head,
  // instead of re-crawling all six pages every cycle.
  const catalogue = useMarketCatalogue(predictionApiUrl, 'all', 120_000, 'inventory')
  const eventItems = useMemo(() => eventCatalogueItems(catalogue.items, props.eventId), [catalogue.items, props.eventId])
  const cataloguedQuestions = useMemo(() => catalogueQuestions(eventItems, solanaVenue), [eventItems, solanaVenue])
  const identifiedCatalogue = useQuestionIdentity(cataloguedQuestions)
  const catalogued = useMemo<ReservedSolanaView[]>(() => identifiedCatalogue
    .map(question => ({ ...reservedSolanaView(question, Date.now(), solanaVenue), question })), [identifiedCatalogue, solanaVenue])
  const questions = useMemo(() => {
    const key = (view: ReservedSolanaView) => `${view.question.matchId}:${view.question.questionId}`
    const merged = new Map(catalogued.map(view => [key(view), view]))
    // The dedicated question endpoint enriches currently tradable rows with
    // token metadata. It wins for those rows; the all-status catalogue keeps
    // historical and not-yet-opened match IDs behind it.
    for (const view of reserved.questions) merged.set(key(view), view)
    return [...merged.values()]
  }, [catalogued, reserved.questions])
  const questionCatalogue = useMemo<QuestionCatalogue>(() => ({ questions, loaded: catalogue.loaded || reserved.loaded }), [questions, catalogue.loaded, reserved.loaded])
  const miaw = useMiawPrixEvent(props.eventId)
  // A standalone Solana question is not in the arena snapshot, so this page has
  // to render before the arena feed answers. It used to borrow the local
  // reference fixture for that, which put seeded matches, seeded order flow and
  // seeded chat on screen whenever the feed was slow or down - presented
  // exactly like live rows, with no way for a reader to tell. Borrow the SHAPE
  // of the fixture and none of its content: every list is emptied, so a rail
  // with nothing real behind it renders empty instead of inventing a match.
  const hollow = useMemo(() => referenceSnapshot && hollowSnapshot(referenceSnapshot), [referenceSnapshot])
  return <>
    {/* Per-transaction toasts and the alert log. TradeTicket and
        MarketErrorBoundary raise both, and without this host they were being
        raised into nothing on this page while the home page showed them. */}
    <OverlayLayer />
    <EventShell {...props} apiUrl={predictionApiUrl} reserved={questionCatalogue} solanaVenue={solanaVenue} source={source} snapshot={snapshot ?? hollow} error={error} retry={retry} miaw={miaw}/>
  </>
}

function useMiawPrixEvent(matchId: string) {
  const enabled = isMiawPrixMatchId(matchId)
  const source = useMemo(() => miawPrixSource('/api/agent-arena', '/api/prediction'), [])
  const [match, setMatch] = useState<MiawPrixMatch | null>(null)
  const [loaded, setLoaded] = useState(!enabled)
  useEffect(() => {
    setMatch(null)
    setLoaded(!enabled)
    if (!enabled) return
    const controller = new AbortController()
    source.match(matchId, controller.signal)
      .then((value) => { if (!controller.signal.aborted) setMatch(value) })
      .catch(() => { /* The canonical question may still resolve this event. */ })
      .finally(() => { if (!controller.signal.aborted) setLoaded(true) })
    return () => controller.abort()
  }, [enabled, matchId, source])
  const tokenMeta = useTokenMeta(match?.sides.map((side) => side.mint) ?? [])
  const identified = useMemo(() => match ? {
    ...match,
    sides: match.sides.map((side) => {
      const meta = tokenMeta.get(side.mint)
      return {
        ...side,
        symbol: meta?.symbol || side.symbol,
        name: meta?.name || side.name,
        logoUrl: resolvedTokenLogo(side.logoUrl, meta?.icon) || undefined,
      }
    }),
  } : null, [match, tokenMeta])
  return useMemo(() => ({
    loaded,
    view: identified ? miawPrixEventView(identified) : null,
  }), [identified, loaded])
}

type QuestionCatalogue = { questions: ReservedSolanaView[]; loaded: boolean }

/**
 * The reference fixture with every seeded record removed. The account, the
 * capability flags and the timestamp survive because they are this visitor's
 * own state, not invented arena inventory; everything a reader could mistake
 * for a real match, market, agent, trade or comment does not.
 */
export function hollowSnapshot(reference: SolzSnapshot): SolzSnapshot {
  return {
    ...reference,
    highlightMatchId: '',
    matches: [], markets: [], teams: [], agents: [],
    prompts: [], chat: [], automation: [], tape: [],
    timeline: [], queue: [], bids: [], results: [],
  }
}

function EventShell({ apiUrl, eventId, predictionId, initialOutcomeId, variant, paths, source, snapshot, error, retry, reserved, solanaVenue, miaw }: Props & { source: SolzDataSource; snapshot: SolzSnapshot | null; error: string; retry: () => void; reserved: QuestionCatalogue; solanaVenue: PublicPredictionVenue | null; miaw: { loaded: boolean; view: ReturnType<typeof miawPrixEventView> } }) {
  const arenaMatch = snapshot ? resolveEvent(snapshot, eventId) : undefined
  // The arena match supplies the match presentation. Its canonical Solana
  // question supplies the executable market. Keeping both is essential: a
  // healthy game feed must not erase an already opened on-chain CLOB market.
  const question = useMemo(
    () => resolveQuestionEvent(reserved.questions, eventId),
    [reserved.questions, eventId],
  )
  const fallback = !arenaMatch && !question ? miaw.view : null
  const match = arenaMatch ?? question?.match ?? fallback?.match
  const questionMarkets = question?.markets ?? (fallback ? [fallback.market] : undefined)
  const prediction = snapshot && arenaMatch ? resolveEventPrediction(snapshot, arenaMatch.id, predictionId ?? eventId) : undefined
  const valid = match && (!predictionId || prediction || !!question || !!fallback)
  // The catalogue is fetched separately from the arena snapshot; announcing
  // EVENT NOT FOUND before it settles would flash on every standalone question.
  const pending = !match && (!reserved.loaded || (isMiawPrixMatchId(eventId) && !miaw.loaded))
  const miawPrix = isMiawPrixMatchId(eventId)
  const eventSnapshot = snapshot && fallback
    ? {
        ...snapshot,
        matches: [fallback.match, ...snapshot.matches.filter((item) => item.id !== fallback.match.id)],
        markets: [fallback.market, ...snapshot.markets.filter((item) => item.id !== fallback.market.id)],
      }
    : snapshot
  return <AppShell className={`solz-home ev-app ev-app--${variant}`} mainId="event-content" mainClassName="ev-main" homeHref={paths.home} marketsHref="/markets" active={miawPrix ? 'miawprix' : 'highlight'} skipTo="#event-content" skipLabel="Skip to event" backToTopHref="#event-content">
    {!eventSnapshot || pending ? <EventSkeleton/> : valid ? <EventDetail apiUrl={apiUrl} key={`${match.id}:${prediction?.id ?? 'match'}`} eventId={eventId} predictionId={prediction?.id} initialOutcomeId={initialOutcomeId} variant={variant} paths={paths} source={source} snapshot={eventSnapshot} match={match} questionMarkets={questionMarkets} solanaQuestions={question?.questions} solanaVenue={solanaVenue} forceReadOnly={!!fallback}/> : error ? <div className="ev-load-state"><h1 className="sz-page-title">The event couldn’t load.</h1><p role="alert">{error}</p><button className="sh-button" onClick={retry}>Try again</button></div> : <div className="ev-load-state"><span className="ch-simulation">EVENT NOT FOUND</span><h1 className="sz-page-title">This event isn’t in the arena.</h1><p>Choose a current event to watch the agents and explore its markets.</p>{eventSnapshot.highlightMatchId
      ? <a className="sh-button" href={eventHref(paths.variants[variant], eventSnapshot.highlightMatchId)}>Open the highlight match <ArrowUpRight size={17}/></a>
      // No arena feed means no highlight match to point at. The catalogue is a
      // real destination; a fixture match id was not.
      : <a className="sh-button" href="/markets">Browse the markets <ArrowUpRight size={17}/></a>}</div>}
  </AppShell>
}

/** Mirrors the real three-column layout so the page does not reflow when data
 *  arrives. The page is client:only, so this is the first structure a visitor
 *  sees; a single grey box read as a broken page. */
function EventSkeleton() {
  return <div className="ev-loading" aria-busy="true">
    <p className="sr-only" role="status">Loading the event…</p>
    <div className="ev-layout" aria-hidden="true">
      <aside className="ev-left-rail"><div className="ev-sk-rail">
        <span className="ev-sk ev-sk-line" style={{ width: '60%' }}/>
        {[0, 1, 2, 3].map((key) => <span className="ev-sk ev-sk-row" key={key}/>)}
      </div></aside>
      <div className="ev-center">
        <div className="ev-sk-heading">
          <span className="ev-sk ev-sk-line" style={{ width: 168 }}/>
          <span className="ev-sk ev-sk-title"/>
          <span className="ev-sk ev-sk-line" style={{ width: '46%' }}/>
        </div>
        <span className="ev-sk ev-sk-stage"/>
        <div className="ev-sk-markets">{[0, 1, 2].map((key) => <span className="ev-sk ev-sk-market" key={key}/>)}</div>
      </div>
      <aside className="ev-right-rail"><div className="ev-sk-ticket">
        <span className="ev-sk ev-sk-line" style={{ width: '70%' }}/>
        <div className="ev-sk-pair"><span className="ev-sk ev-sk-chip"/><span className="ev-sk ev-sk-chip"/></div>
        <span className="ev-sk ev-sk-line" style={{ width: '40%' }}/>
        <span className="ev-sk ev-sk-button"/>
      </div></aside>
    </div>
  </div>
}

function EventDetail({ apiUrl = '', eventId, predictionId, initialOutcomeId, variant, paths, source, snapshot, match, questionMarkets, solanaQuestions, solanaVenue, forceReadOnly = false }: Props & { source: SolzDataSource; snapshot: SolzSnapshot; match: SolzMatch; questionMarkets?: ArenaMarket[]; solanaQuestions?: ReservedSolanaQuestion[]; solanaVenue?: PublicPredictionVenue | null; forceReadOnly?: boolean }) {
  // A standalone question has no row in the arena snapshot; its markets are
  // supplied directly and are the only markets this event has.
  const catalogue = questionMarkets ?? snapshot.markets.filter((item) => item.matchId === match.id)
  // Identity only. Prices arrive below; market ids do not change with them, so
  // the selection state can settle before the first book read returns.
  const cataloguePrediction = catalogue.find((item) => item.id === predictionId)
  // A standalone question has no game behind it: no teams, no roster, nothing
  // to broadcast. Everything match-shaped is gated on this rather than on the
  // venue, so any team-less event renders as a question.
  // A question backed by a real venue opens live, not in simulation, so its
  // book is the on-chain one rather than sample depth.
  const simulation = !forceReadOnly && !solanaQuestions?.length
  // One collateral symbol for the whole page. COOLA is the off-chain
  // simulation's own credit, not a ticker, so it must never appear on a page
  // that is not the simulation: the wallet header beside this rail already
  // shows the venue collateral, and a second, different symbol on the same
  // screen reads as a mockup. A recorded Colosseum card is read-only rather
  // than simulated, so it quotes the configured Solana collateral too.
  const collateralSymbol = simulation ? 'COOLA' : (solanaVenue?.collateralSymbol ?? 'USDC')
  const referenceSnapshot = useRef(snapshot).current
  const hasBroadcast = match.roster.length > 0
  const view: EventView = cataloguePrediction || !hasBroadcast ? 'market' : 'live'
  const [marketId, setMarketId] = useState(cataloguePrediction?.id ?? catalogue.find((item) => item.id === eventId)?.id ?? match.marketId)
  // This page had no pricing stage at all, so every Solana question rendered the
  // literal 50/50 seed from the question catalogue however many orders were
  // resting on its books. One producer for the page, batching every question's
  // books into two account reads — never one reader per market panel.
  const markets = useSolanaMarketPrices(catalogue, solanaVenue, !!solanaQuestions?.length, marketId).markets
  const prediction = markets.find((item) => item.id === predictionId)
  const [outcomeId, setOutcomeId] = useState(initialOutcomeId ?? '')
  const [section, setSection] = useState<ConsoleSection | null>('trade')
  const [saved, setSaved] = useState(false)
  const [notice, setNotice] = useState('')
  const [mobileRail, setMobileRail] = useState(false)
  const [mobileTrade, setMobileTrade] = useState(false)
  const [tradeRequest, setTradeRequest] = useState(0)
  const [clock, setClock] = useState(() => Date.now())
  const tradeRail = useRef<HTMLElement>(null)
  useEffect(() => {
    setClock(Date.now())
    if (match.phase === 'settled') return
    const timer = window.setInterval(() => setClock(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [match.id, match.phase, match.startedAt, match.endsAt])
  useEffect(() => {
    if (mobileTrade && window.matchMedia('(max-width: 760px)').matches) tradeRail.current?.scrollIntoView({ block: 'start', behavior: 'instant' })
  }, [mobileTrade, tradeRequest])
  const market = prediction ?? markets.find((item) => item.id === marketId) ?? markets[0]
  const linkedOverview = linkedEventMarket(markets)
  // reservedSolanaView keys each market by its questionId, so the selected
  // market names its own question. Without this the ticket would activate the
  // event's first market whichever of the twelve is on screen.
  const solanaQuestion = solanaQuestions?.find((item) => item.questionId.toLowerCase() === market?.id.toLowerCase())
  const answer = market?.outcomes.find((item) => item.id === baseOutcomeId(outcomeId)) ?? market?.outcomes[0]
  const ticketMarket = market && answer && market.outcomes.length > 2 ? eventAnswerMarket(market, answer, collateralSymbol) : market
  const outcome = ticketMarket?.outcomes.find((item) => item.id === outcomeId) ?? ticketMarket?.outcomes[0]
  const savedId = prediction?.id ?? match.id
  const selectionHref = (base: string) => `${eventHref(base, match.id, prediction?.id)}${outcome ? `?outcome=${encodeURIComponent(outcome.id)}` : ''}`
  useEffect(() => { try { setSaved(localStorage.getItem(`coola.saved-event.${savedId}`) === 'true') } catch { /* Saving is optional when storage is disabled. */ } }, [savedId])
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 3200); return () => window.clearTimeout(timer) }, [notice])
  const select = (next: ArenaMarket, pick: ArenaMarketOutcome, openTrade = true) => { setMarketId(next.id); setOutcomeId(pick.id); setSection('trade'); if (openTrade) { setMobileTrade(true); setTradeRequest((request) => request + 1) } }
  const toggleSaved = () => { try { localStorage.setItem(`coola.saved-event.${savedId}`, String(!saved)); setSaved(!saved); setNotice(saved ? 'Event removed from saved events.' : 'Event saved on this device.') } catch { setNotice('This browser can’t save events right now.') } }
  async function copyLink() { try { await navigator.clipboard.writeText(new URL(selectionHref(paths.variants[variant]), window.location.origin).href); setNotice('Event link copied.') } catch { setNotice('Copy the event link from your address bar.') } }
  if (!market || !outcome || !answer || !ticketMarket) return <div className="ev-load-state"><h1 className="sz-page-title">Markets are being prepared.</h1><a href={paths.home}>Back to the arena</a></div>
  // A standalone question has no teams, so the usual "A vs. B" heading would
  // render empty; the question itself is the title.
  const heading = market.presentation?.eventTitle ?? (!match.teams.length
    ? linkedOverview?.title ?? market.title
    : match.teams.length > 2 ? `${match.teams.length}-TEAM FREE FOR ALL` : match.teams.map((team) => team.symbol).join(' vs. '))
  // The H1 and the breadcrumb's middle crumb are the same string whenever the
  // event resolved from the question catalogue rather than the arena, because
  // both fall back to presentation.eventTitle. A crumb that links to the page
  // you are already on is not navigation.
  const parentCrumb = prediction && prediction.title !== heading ? heading : null
  return <div>
    <div className="ev-mobile-actions"><button onClick={() => setMobileRail(!mobileRail)} aria-expanded={mobileRail} aria-controls="event-left-rail">{variant === 'community' ? 'Comments' : variant === 'agents' ? 'Agents & prompts' : 'Explore events'}<ChevronRight size={14}/></button><button onClick={() => setMobileTrade(!mobileTrade)} aria-expanded={mobileTrade} aria-controls="event-trade-rail">Trade {market.outcomes.length > 2 ? `${answer.label} · ${outcome.label}` : outcome.label} <span>{percent(outcome.probability)}</span></button></div>
    <div className="ev-layout" id="event-detail" aria-label="Event details">
      <aside id="event-left-rail" className={`ev-left-rail ${mobileRail ? 'is-mobile-open' : ''}`} aria-label={variant === 'community' ? 'Event discussion' : variant === 'agents' ? 'Agent controls' : 'Event navigation'}><div className="ev-sticky-rail">{variant === 'markets' ? <EventMarketRail snapshot={snapshot} match={match} paths={paths} variant={variant} predictionId={prediction?.id}/> : variant === 'community' ? <EventComments snapshot={snapshot} match={match} market={ticketMarket} source={source} rail/> : <EventAgentRail snapshot={snapshot} match={match} source={source}/>}</div></aside>
      <div className="ev-event-heading" id="event-title"><div className="ev-breadcrumb"><span>{isMiawPrixMatchId(match.id) ? 'MIAW PRIX' : 'Genesis Series'}</span>{parentCrumb && <><ChevronRight size={11}/><a href={eventHref(paths.variants[variant], match.id)}>{parentCrumb}</a></>}<ChevronRight size={11}/><span>{prediction ? 'Prediction' : match.mode}</span></div><div className="ev-title-row"><h1>{prediction?.title ?? heading}</h1></div></div>
      {/* Was a "Chart simulation OFF" switch beside a count of unrelated live
          matches — a developer toggle and a number about other events. What a
          reader needs here is whether THIS event is live, and which one it is. */}
      <div className="ev-event-status">
        <MatchAvatar id={match.id}/>
        <span className="ev-phase-clock" role="timer" aria-label={eventTimingLabel(match, clock)}><StatusDot pink={match.phase !== 'live'}>{eventTimingLabel(match, clock)}</StatusDot></span>
        <span>{match.map}</span>
        {match.roster.length > 0 && <span>{match.roster.length} agents</span>}
      </div>
      <div className="ev-center">
        <EventStage simulation={simulation} referenceMarket={linkedOverview ? undefined : referenceSnapshot.markets.find((item) => item.id === market.id)} view={view} match={match} market={linkedOverview ?? market} snapshot={snapshot} outcome={linkedOverview?.outcomes.find((item) => item.id === market.id) ?? answer} onOutcome={(pick) => { const linkedMarket = linkedOverview && markets.find((item) => item.id === pick.id); if (linkedMarket) select(linkedMarket, linkedMarket.outcomes[0]!, false); else { setOutcomeId(pick.id); setSection('trade') } }} prediction={!!prediction} broadcast={hasBroadcast} collateral={collateralSymbol}/>
        <EventMarkets simulation={simulation} collateral={collateralSymbol} actions={<div className="ev-market-actions"><button aria-label={saved ? 'Unsave event' : 'Save event'} aria-pressed={saved} onClick={toggleSaved}><Bookmark size={18} fill={saved ? 'currentColor' : 'none'}/></button><button aria-label="Copy event link" onClick={() => void copyLink()}><LinkIcon size={18}/></button></div>} markets={prediction ? [prediction] : markets} market={market} outcome={outcome} snapshot={snapshot} onSelect={select} prediction={prediction && prediction.outcomes.length > 2 ? prediction : undefined} predictionHref={(item) => eventHref(paths.variants[variant], match.id, item.id)}/>
        <EventCommunity snapshot={snapshot} match={match} source={source} market={ticketMarket} prediction={prediction} priced={markets} collateral={collateralSymbol} apiUrl={apiUrl} hideComments={variant === 'community'}/>
        <RelatedEvents snapshot={snapshot} match={match} prefix={paths.variants[variant]}/>
      </div>
      <aside ref={tradeRail} id="event-trade-rail" className={`ev-right-rail ${mobileTrade ? 'is-mobile-open' : ''}`} aria-label="Trade and interact"><div className="ev-sticky-rail"><div className="ev-mobile-rail-heading"><span>TRADE &amp; INTERACT</span><button aria-label="Close trade panel" onClick={() => setMobileTrade(false)}><X size={18}/></button></div><InteractionConsole source={source} snapshot={snapshot} match={match} market={market} outcome={answer} onOutcome={(pick) => setOutcomeId(pick.id)} answer={isNoContract(outcome.id) ? 'no' : 'yes'} onAnswer={(side) => setOutcomeId((current) => predictionContract(market.outcomes.find((item) => item.id === baseOutcomeId(current)) ?? answer, side).id)} solana={!!solanaQuestion} solanaVenue={solanaVenue} solanaQuestion={solanaQuestion} predictionApiUrl={apiUrl} collateralSymbol={collateralSymbol} simulation={simulation} marketAvailable={!forceReadOnly} marketNotice={{ title: 'No prediction market for this match.', detail: 'This match has no question on the prediction venue, so there is no book and no price. The ticket opens when a question exists. The other panels stay available.' }}  sections={section ? [section] : []} onSections={(next) => setSection(next.at(-1) ?? null)} intermission={match.phase !== 'live'} hideChat={variant === 'community'} hidePrompt={variant === 'agents'}/></div></aside>
    </div>
    {notice && <div className="ev-toast" role="status"><Check size={15}/>{notice}</div>}
  </div>
}

function RelatedEvents({ snapshot, match, prefix }: { snapshot: SolzSnapshot; match: SolzMatch; prefix: string }) {
  const matches = snapshot.matches.filter((item) => item.id !== match.id).slice(0, 3)
  return <section className="ev-related" aria-labelledby="related-events-title"><div className="ev-section-title"><h2 id="related-events-title">Elsewhere in the arena <span>{matches.filter((item) => item.phase === 'live').length} LIVE</span></h2><ArrowUpRight size={16}/></div><div className="ev-related-grid">{matches.map((item) => {
    const market = snapshot.markets.find((row) => row.id === item.marketId)
    // A free-for-all has no two sides to put either end of a "VS" — an FFA
    // arena room ships no teams at all, and destructuring a second one out of
    // that array crashed the whole page the moment such a room appeared.
    const [home, away] = item.teams
    const chance = market?.outcomes[0]?.probability ?? .5
    return <a href={eventHref(prefix, item.id)} className="sh-match-card" key={item.id}><div className="sh-match-card-top"><StatusDot pink={item.phase !== 'live'}>{item.phase === 'live' ? 'LIVE' : 'UP NEXT'}</StatusDot><ArrowUpRight size={15}/></div>
      {home && away
        ? <>
          <div className="ev-related-teams"><div><TeamMark id={home.teamId} color={home.color} logoUrl={home.logoUrl}/><strong>{home.symbol}</strong></div><span>VS</span><div><TeamMark id={away.teamId} color={away.color} logoUrl={away.logoUrl}/><strong>{away.symbol}</strong></div></div>
          <div className="sh-match-odds"><span style={{ color: home.color }}>{percent(chance)}</span><span style={{ color: away.color }}>{percent(1 - chance)}</span></div>
          <div className="sh-odds-bar" style={{ background: away.color }}><i style={{ width: percent(chance), background: home.color }}/></div>
        </>
        : <div className="ev-related-field"><strong>{matchLabel(item.teams) || item.map}</strong><span>{item.roster.length ? `${item.roster.length} agents · ${item.mode}` : item.mode}</span></div>}
      <div className="sh-match-card-bottom"><span>{compact(item.volume.COOLA)} VOL.</span><span><Eye size={12}/>{compact(item.viewers)}</span></div></a>
  })}</div></section>
}
