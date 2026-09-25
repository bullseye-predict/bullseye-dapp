import '../../styles/home.css'
import '../../styles/events.css'
import '../../styles/general-questions.css'
import '../../styles/panta-event.css'
import { ArrowUpRight, ChevronRight } from 'lucide-react'
import { pantaMarketUrl, type PantaMarket, type PantaTrackedMarket } from '../../../packages/prediction-core/panta'
import { AppShell } from '../solz/AppShell'
import { MeasuredLineChart } from '../events/StockMeasurePanel'
import { usePantaEvent, type PantaEventState, type PantaEventView } from './pantaApi'
import { brand } from '../solz/brand'

/**
 * /events-panta/<id>: a PANTA market, or a ColaCat group of PANTA markets,
 * inside ColaCat. PANTA resolves it with its own AI agent and trades it on
 * panta.market; ColaCat lists it, shows its price, and keeps the history
 * PANTA does not publish.
 */

const PHASE = { primary: 'Primary phase · buy only', secondary: 'Order book open', resolved: 'Resolved', cancelled: 'Cancelled' } as const
const dateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' })
const utc = (seconds: number) => `${dateFormat.format(seconds * 1000)} UTC`
const usdc = (value: string | null) => value === null ? '—' : `$${Number(value).toFixed(Number(value) < 1 ? 3 : 2)}`
const short = (wallet: string) => `${wallet.slice(0, 4)}…${wallet.slice(-4)}`

function PriceTiles({ yes, no, asOf }: { yes: string | null; no: string | null; asOf: string | null }) {
  return <div className="pe-prices">
    <div className="is-yes"><span>Yes</span><b>{usdc(yes)}</b></div>
    <div className="is-no"><span>No</span><b>{usdc(no)}</b></div>
    <p>USDC per share on PANTA.{asOf ? ` Last recorded ${utc(Date.parse(asOf) / 1000)}.` : ''} Payouts follow PANTA’s rules.</p>
  </div>
}

function MarketView({ view }: { view: Extract<PantaEventView, { kind: 'market' }> }) {
  const market: PantaMarket | null = view.market
  const tracked = view.tracked
  const title = market?.title ?? tracked?.title ?? 'PANTA market'
  const phase = market?.phase ?? tracked?.phase
  const endTime = market?.endTime ?? tracked?.endTime
  const points = view.history.filter(point => point[1] !== null).map(([t, yes]) => ({ t, v: Number(yes) }))
  const trackedSince = tracked ? Date.parse(tracked.trackedSince) / 1000 : null
  return <>
    <div className="ev-breadcrumb"><span>PANTA</span><ChevronRight size={11}/><span>{market?.category ?? tracked?.category ?? 'market'}</span>{tracked?.groupId && <><ChevronRight size={11}/><a href={`/events-panta/${tracked.groupId}`}>{tracked.groupTitle ?? tracked.groupId}</a></>}</div>
    <h1 className="pe-title">{title}</h1>
    <div className="pe-status">
      {phase && <span>{PHASE[phase]}</span>}
      {endTime && <span>{phase === 'resolved' || phase === 'cancelled' ? 'Ended' : 'Ends'} {utc(endTime)}</span>}
      {market && <span>Resolves after {utc(market.resolutionTime)}</span>}
      {market?.volumeUsdc && <span>${Number(market.volumeUsdc).toLocaleString('en-US')} volume</span>}
    </div>
    {view.live === 'unavailable' && <p className="pe-notice" role="status">PANTA is not answering right now. Prices below are {brand.name}’s last recorded snapshot.</p>}
    <PriceTiles yes={market?.yesPrice ?? tracked?.lastYes ?? null} no={market?.noPrice ?? tracked?.lastNo ?? null} asOf={market ? null : tracked?.lastAt ?? null}/>
    <section className="pe-section" aria-labelledby="pe-history">
      <div className="ev-section-title"><h2 id="pe-history">Price history <span>PANTA</span></h2>{trackedSince && <span>Tracked since {utc(trackedSince)}</span>}</div>
      {tracked ? <MeasuredLineChart series={[{ key: view.marketId, color: '#c7ff00', points }]} unit="usd" label="PANTA Yes price over time"/>
        : <p className="pe-muted">{brand.name} is not recording this market yet, so there is no history to draw. PANTA publishes no price history of its own.</p>}
      <p className="pe-muted">One price for everyone: trades on panta.market and anywhere else move the same market, and each snapshot includes all of them. Sampled every 15 minutes from the moment {brand.name} started tracking.</p>
    </section>
    {market?.description && <section className="pe-section" aria-labelledby="pe-rules"><div className="ev-section-title"><h2 id="pe-rules">Rules</h2></div><p className="pe-rules">{market.description}</p></section>}
    <section className="pe-section" aria-labelledby="pe-resolution">
      <div className="ev-section-title"><h2 id="pe-resolution">How it resolves</h2></div>
      <p className="pe-muted">PANTA’s AI agent reads the market’s sources of truth after it ends and resolves Yes or No. A one-hour dispute window follows; a dispute posts a bond and is reviewed by the PANTA team.</p>
      {tracked?.source === 'created' && tracked.creatorWallet && <p className="pe-muted">Created on {brand.name} by {short(tracked.creatorWallet)}, who earns PANTA’s creator royalty.</p>}
    </section>
    <div className="pe-actions">
      <a className="gq-primary" href={view.tradeUrl} target="_blank" rel="noopener noreferrer">{phase === 'resolved' || phase === 'cancelled' ? 'View result on PANTA' : 'Trade on PANTA'}<ArrowUpRight size={15}/></a>
      <a className="pe-credit" href="https://www.panta.market/how-it-works" target="_blank" rel="noopener noreferrer">Powered by PANTA<ArrowUpRight size={13}/></a>
    </div>
  </>
}

function GroupView({ view }: { view: Extract<PantaEventView, { kind: 'group' }> }) {
  return <>
    <div className="ev-breadcrumb"><span>PANTA</span><ChevronRight size={11}/><span>Linked questions</span></div>
    <h1 className="pe-title">{view.title}</h1>
    <p className="pe-muted">Each answer is its own Yes/No market on PANTA, listed together here. Prices are {brand.name}’s latest snapshot.</p>
    <ol className="pe-group">
      {view.markets.map((market: PantaTrackedMarket) => <li key={market.marketId}>
        <a href={`/events-panta/${market.marketId}`}><span>{market.title}</span><b className="is-yes">{usdc(market.lastYes)}</b><small>{PHASE[market.phase]}</small></a>
      </li>)}
    </ol>
    <a className="pe-credit" href="https://www.panta.market/how-it-works" target="_blank" rel="noopener noreferrer">Powered by PANTA<ArrowUpRight size={13}/></a>
  </>
}

/** Shaped like the loaded page, so nothing moves when it lands. */
function Skeleton() {
  return <div aria-hidden="true" className="pe-skeleton">
    <span className="ev-sk ev-sk-line" style={{ width: '18%' }}/>
    <span className="ev-sk ev-sk-title"/>
    <span className="ev-sk ev-sk-line" style={{ width: '46%' }}/>
    <div className="pe-prices"><span className="ev-sk sm-sk-row"/><span className="ev-sk sm-sk-row"/></div>
    <span className="ev-sk sm-sk-chart"/>
  </div>
}

export function PantaEventView({ state, id }: { state: PantaEventState; id: string }) {
  return <div className="pe-page">
    {state.phase === 'loading' ? <><Skeleton/><span className="sm-sr-only" role="status">Loading PANTA market</span></>
      : state.phase === 'missing' ? <div className="ev-load-state"><h1 className="sz-page-title">This PANTA market isn’t available.</h1><p>It may have been removed, or the address is wrong.</p><a href="/markets">Browse markets</a></div>
        : state.phase === 'unavailable' ? <div className="ev-load-state"><h1 className="sz-page-title">PANTA is unavailable.</h1><p role="status">{state.message}</p><a href={pantaMarketUrl(id)} target="_blank" rel="noopener noreferrer">Open it on PANTA</a></div>
          : state.view.kind === 'group' ? <GroupView view={state.view}/> : <MarketView view={state.view}/>}
  </div>
}

export function PantaEventApp({ apiUrl, id }: { apiUrl: string; id: string }) {
  const state = usePantaEvent(apiUrl, id)
  return <AppShell className="solz-home pe-app" mainId="panta-event" mainClassName="pe-main" marketsHref="/markets" active="markets" skipTo="#panta-event" skipLabel="Skip to market" backToTopHref="#panta-event">
    <PantaEventView state={state} id={id}/>
  </AppShell>
}
