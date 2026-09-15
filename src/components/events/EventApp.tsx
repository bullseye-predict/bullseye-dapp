import '../../styles/home.css'
import '../../styles/home-hero.css'
import '../../styles/home-markets.css'
import '../../styles/events.css'
import { ArrowLeft, ArrowUpRight, Bookmark, Check, ChevronRight, Eye, Link as LinkIcon, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createSolzDataSource } from '../solz/solzDataSource'
import type { ArenaMarket, ArenaMarketOutcome, SolzDataSource, SolzMatch, SolzSnapshot } from '../solz/model'
import { OverlayLayer } from '../home/alerts/OverlayLayer'
import { useHomeData } from '../home/useHomeData'
import { resolveQuestionEvent, useReservedSolanaQuestions, type ReservedSolanaQuestion } from '../home/solanaQuestionMarkets'
import type { PublicPredictionVenue } from '../../../packages/prediction-core/market-data'
import { useSolanaVenue } from '../home/useSolanaVenue'
import { useSolanaMarketPrices } from '../home/useSolanaMarketPrices'
import { InteractionConsole, type ConsoleSection } from '../home/InteractionConsole'
import { compact, percent, StatusDot, TeamMark } from '../home/HomePrimitives'
import { AppShell } from '../solz/AppShell'
import { TradeContextBar } from '../home/TradeContextBar'
import { EventStage, type EventView } from './EventStage'
import { EventMarkets } from './EventMarkets'
import { EventComments, EventCommunity } from './EventCommunity'
import { EventAgentRail, EventMarketRail } from './EventRails'
import { eventAnswerMarket, eventHref, eventMarketVolume, linkedEventMarket, resolveEvent, resolveEventPrediction, type EventPaths, type EventVariant } from './eventModel'
import { baseOutcomeId, isNoContract, predictionContract } from '../solz/predictionContracts'
import { matchLabel } from '../home/heroMarket'

type Props = { apiUrl?: string; eventId: string; predictionId?: string; initialOutcomeId?: string; variant: EventVariant; paths: EventPaths }

export function EventApp(props: Props) {
  // The page ships a server-rendered skeleton because this island is
  // client:only. Drop it synchronously as this tree takes over, so the two
  // never paint in the same frame.
  useLayoutEffect(() => { document.getElementById('boot-skeleton')?.remove() }, [])
  const source = useMemo(() => createSolzDataSource(), [])
  const { snapshot, error, retry } = useHomeData(source)
  // A canonical Solana question is not an arena match, so it is absent from the
  // arena snapshot. Load the question catalogue alongside it so /events/<id>
  // can open a standalone question exactly like a match-backed market.
  const solanaVenue = useSolanaVenue(props.apiUrl ?? '')
  const reserved = useReservedSolanaQuestions(props.apiUrl ?? '', solanaVenue)
  return <>
    {/* Per-transaction toasts and the alert log. TradeTicket and
        MarketErrorBoundary raise both, and without this host they were being
        raised into nothing on this page while the home page showed them. */}
    <OverlayLayer />
    <EventShell {...props} reserved={reserved} solanaVenue={solanaVenue} source={source} snapshot={snapshot} error={error} retry={retry}/>
  </>
}

type ReservedCatalogue = ReturnType<typeof useReservedSolanaQuestions>

function EventShell({ apiUrl, eventId, predictionId, initialOutcomeId, variant, paths, source, snapshot, error, retry, reserved, solanaVenue }: Props & { source: SolzDataSource; snapshot: SolzSnapshot | null; error: string; retry: () => void; reserved: ReservedCatalogue; solanaVenue: PublicPredictionVenue | null }) {
  const arenaMatch = snapshot ? resolveEvent(snapshot, eventId) : undefined
  // Only consult the question catalogue when the arena has no such event, so a
  // real match is never shadowed by a reservation that shares its id.
  const question = useMemo(
    () => (arenaMatch ? undefined : resolveQuestionEvent(reserved.questions, eventId)),
    [arenaMatch, reserved.questions, eventId],
  )
  const match = arenaMatch ?? question?.match
  const questionMarkets = question?.markets
  const prediction = snapshot && arenaMatch ? resolveEventPrediction(snapshot, arenaMatch.id, predictionId ?? eventId) : undefined
  const valid = match && (!predictionId || prediction || !!question)
  // The catalogue is fetched separately from the arena snapshot; announcing
  // EVENT NOT FOUND before it settles would flash on every standalone question.
  const pending = !match && !reserved.loaded
  return <AppShell className={`solz-home ev-app ev-app--${variant}`} mainId="event-content" mainClassName="ev-main" homeHref={paths.home} marketsHref="/markets" active="highlight" skipTo="#event-content" skipLabel="Skip to event" backToTopHref="#event-content">
    {error ? <div className="ev-load-state"><h1 className="sz-page-title">The event couldn’t load.</h1><p role="alert">{error}</p><button className="sh-button" onClick={retry}>Try again</button></div> : !snapshot || pending ? <EventSkeleton/> : valid ? <EventDetail apiUrl={apiUrl} key={`${match.id}:${prediction?.id ?? 'match'}`} eventId={eventId} predictionId={prediction?.id} initialOutcomeId={initialOutcomeId} variant={variant} paths={paths} source={source} snapshot={snapshot} match={match} questionMarkets={questionMarkets} solanaQuestions={question?.questions} solanaVenue={solanaVenue}/> : <div className="ev-load-state"><span className="ch-simulation">EVENT NOT FOUND</span><h1 className="sz-page-title">This event isn’t in the arena.</h1><p>Choose a current event to watch the agents and explore its markets.</p><a className="sh-button" href={eventHref(paths.variants[variant], snapshot.highlightMatchId)}>Open the highlight match <ArrowUpRight size={17}/></a></div>}
  </AppShell>
}

/** Mirrors the real three-column layout so the page does not reflow when data
 *  arrives. The page is client:only, so this is the first structure a visitor
 *  sees; a single grey box read as a broken page. */
function EventSkeleton() {
  return <div className="ev-loading" aria-busy="true">
    <p className="sr-only" role="status">Loading the event…</p>
    <div className="ev-layout-bar"><span className="ev-sk ev-sk-line" style={{ width: 96 }}/></div>
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

function EventDetail({ apiUrl = '', eventId, predictionId, initialOutcomeId, variant, paths, source, snapshot, match, questionMarkets, solanaQuestions, solanaVenue }: Props & { source: SolzDataSource; snapshot: SolzSnapshot; match: SolzMatch; questionMarkets?: ArenaMarket[]; solanaQuestions?: ReservedSolanaQuestion[]; solanaVenue?: PublicPredictionVenue | null }) {
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
  const [simulation, setSimulation] = useState(!solanaQuestions?.length)
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
  const tradeRail = useRef<HTMLElement>(null)
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
  const ticketMarket = market && answer && market.outcomes.length > 2 ? eventAnswerMarket(market, answer) : market
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
    <div className="ev-layout-bar"><a href={prediction ? eventHref(paths.variants[variant], match.id) : '/markets'}><ArrowLeft size={13}/>{prediction ? 'BACK TO MATCH' : 'ALL MARKETS'}</a></div>
    <div className="ev-mobile-actions"><button onClick={() => setMobileRail(!mobileRail)} aria-expanded={mobileRail} aria-controls="event-left-rail">{variant === 'community' ? 'Comments' : variant === 'agents' ? 'Agents & prompts' : 'Explore events'}<ChevronRight size={14}/></button><button onClick={() => setMobileTrade(!mobileTrade)} aria-expanded={mobileTrade} aria-controls="event-trade-rail">Trade {market.outcomes.length > 2 ? `${answer.label} · ${outcome.label}` : outcome.label} <span>{percent(outcome.probability)}</span></button></div>
    <div className="ev-layout" id="event-detail" aria-label="Event details">
      <aside id="event-left-rail" className={`ev-left-rail ${mobileRail ? 'is-mobile-open' : ''}`} aria-label={variant === 'community' ? 'Event discussion' : variant === 'agents' ? 'Agent controls' : 'Event navigation'}><div className="ev-sticky-rail">{variant === 'markets' ? <EventMarketRail snapshot={snapshot} match={match} paths={paths} variant={variant} predictionId={prediction?.id}/> : variant === 'community' ? <EventComments snapshot={snapshot} match={match} market={ticketMarket} source={source} rail/> : <EventAgentRail snapshot={snapshot} match={match} source={source}/>}</div></aside>
      <div className="ev-event-heading" id="event-title"><div className="ev-breadcrumb"><span>Genesis Series</span>{parentCrumb && <><ChevronRight size={11}/><a href={eventHref(paths.variants[variant], match.id)}>{parentCrumb}</a></>}<ChevronRight size={11}/><span>{prediction ? 'Prediction' : match.mode}</span></div><div className="ev-title-row"><h1>{prediction?.title ?? heading}</h1></div><p><StatusDot pink={match.phase !== 'live'}>{match.phase === 'live' ? 'LIVE NOW' : match.phase.toUpperCase()}</StatusDot><span>{match.map}</span><span>{compact(linkedOverview?.volume.COOLA ?? eventMarketVolume(market))} {solanaQuestions?.length ? 'fUSDC' : 'COOLA'} VOL.</span>{match.roster.length ? <span>{match.roster.length} agents · {match.round}</span> : !match.round.startsWith('LIVE') && <span>{match.round}</span>}</p></div>
      <TradeContextBar simulation={simulation} onSimulationChange={setSimulation} liveMatchCount={snapshot.matches.filter((item) => item.phase === 'live').length}/>
      <div className="ev-center">
        <EventStage simulation={simulation} referenceMarket={linkedOverview ? undefined : referenceSnapshot.markets.find((item) => item.id === market.id)} view={view} match={match} market={linkedOverview ?? market} snapshot={snapshot} outcome={linkedOverview?.outcomes.find((item) => item.id === market.id) ?? answer} onOutcome={(pick) => { const linkedMarket = linkedOverview && markets.find((item) => item.id === pick.id); if (linkedMarket) select(linkedMarket, linkedMarket.outcomes[0]!, false); else { setOutcomeId(pick.id); setSection('trade') } }} prediction={!!prediction} broadcast={hasBroadcast} collateral={solanaQuestions?.length ? 'fUSDC' : 'COOLA'}/>
        <EventMarkets simulation={simulation} collateral={solanaQuestion ? 'fUSDC' : 'COOLA'} actions={<div className="ev-market-actions"><button aria-label={saved ? 'Unsave event' : 'Save event'} aria-pressed={saved} onClick={toggleSaved}><Bookmark size={18} fill={saved ? 'currentColor' : 'none'}/></button><button aria-label="Copy event link" onClick={() => void copyLink()}><LinkIcon size={18}/></button></div>} markets={prediction ? [prediction] : markets} market={market} outcome={outcome} snapshot={snapshot} onSelect={select} prediction={prediction && prediction.outcomes.length > 2 ? prediction : undefined} predictionHref={(item) => eventHref(paths.variants[variant], match.id, item.id)}/>
        <EventCommunity snapshot={snapshot} match={match} source={source} market={ticketMarket} prediction={prediction} priced={markets} collateral={solanaQuestions?.length ? 'fUSDC' : 'COOLA'} hideComments={variant === 'community'}/>
        <RelatedEvents snapshot={snapshot} match={match} prefix={paths.variants[variant]}/>
      </div>
      <aside ref={tradeRail} id="event-trade-rail" className={`ev-right-rail ${mobileTrade ? 'is-mobile-open' : ''}`} aria-label="Trade and interact"><div className="ev-sticky-rail"><div className="ev-mobile-rail-heading"><span>TRADE &amp; INTERACT</span><button aria-label="Close trade panel" onClick={() => setMobileTrade(false)}><X size={18}/></button></div><InteractionConsole source={source} snapshot={snapshot} match={match} market={market} outcome={answer} onOutcome={(pick) => setOutcomeId(pick.id)} answer={isNoContract(outcome.id) ? 'no' : 'yes'} onAnswer={(side) => setOutcomeId((current) => predictionContract(market.outcomes.find((item) => item.id === baseOutcomeId(current)) ?? answer, side).id)} solana={!!solanaQuestion} solanaVenue={solanaVenue} solanaQuestion={solanaQuestion} predictionApiUrl={apiUrl} collateralSymbol={solanaQuestion ? 'fUSDC' : undefined} simulation={!solanaQuestion} section={section} onSection={setSection} intermission={match.phase !== 'live'} hideChat={variant === 'community'} hidePrompt={variant === 'agents'}/></div></aside>
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
          <div className="ev-related-teams"><div><TeamMark id={home.teamId} color={home.color}/><strong>{home.symbol}</strong></div><span>VS</span><div><TeamMark id={away.teamId} color={away.color}/><strong>{away.symbol}</strong></div></div>
          <div className="sh-match-odds"><span style={{ color: home.color }}>{percent(chance)}</span><span style={{ color: away.color }}>{percent(1 - chance)}</span></div>
          <div className="sh-odds-bar" style={{ background: away.color }}><i style={{ width: percent(chance), background: home.color }}/></div>
        </>
        : <div className="ev-related-field"><strong>{matchLabel(item.teams) || item.map}</strong><span>{item.roster.length ? `${item.roster.length} agents · ${item.mode}` : item.mode}</span></div>}
      <div className="sh-match-card-bottom"><span>{compact(item.volume.COOLA)} VOL.</span><span><Eye size={12}/>{compact(item.viewers)}</span></div></a>
  })}</div></section>
}
