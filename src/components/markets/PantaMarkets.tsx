import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, ArrowUpRight, RefreshCw } from 'lucide-react'
import { PANTA_CATEGORIES, pantaMarketUrl, type PantaMarket, type PantaPage } from '../../../packages/prediction-core/panta'
import { createGeneralQuestionsApi, GeneralQuestionsError, type GeneralQuestionsApi } from './generalQuestionsApi'
import { createPantaApi } from '../panta/pantaApi'
import type { PantaTrackedMarket } from '../../../packages/prediction-core/panta'
import { brand } from '../solz/brand'

const formatTime = (seconds: number) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(seconds * 1000)
const dollars = (value: string | null) => value === null ? '—' : new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }).format(Number(value))
const phaseLabel = { primary: 'Primary market', secondary: 'Secondary market', resolved: 'Resolved', cancelled: 'Cancelled' }

export function PantaMarketCard({ market, api }: { market: PantaMarket; api: GeneralQuestionsApi }) {
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState<PantaMarket | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setError(''); setDetail(null)
    void api.market(market.marketId, controller.signal).then(value => {
      if (!controller.signal.aborted) setDetail(value)
    }).catch(() => { if (!controller.signal.aborted) setError('Live prices could not load.') })
    return () => controller.abort()
  }, [api, market.marketId, open, attempt])
  const shown = detail ?? market
  return <article className="gq-panta-card">
    <div className="gq-card-meta"><span>{market.category}</span><span>{phaseLabel[shown.phase]}</span></div>
    <h3><a href={`/events-panta/${market.marketId}`}>{market.title}<ArrowUpRight size={17}/></a></h3>
    <p className="gq-card-description">{market.description || 'A Yes / No question on PANTA.'}</p>
    <div className="gq-card-facts"><span>Closes <time dateTime={new Date(shown.endTime * 1000).toISOString()}>{formatTime(shown.endTime)}</time></span><span>{dollars(shown.volumeUsdc)} volume</span></div>
    {open && <div className="gq-market-detail" id={`panta-${market.marketId}`}>
      <div className="gq-prices" aria-busy={!detail && !error}>
        <div className="is-yes"><span>Yes</span><b>{!detail && !error ? <span className="gq-skeleton"/> : dollars(detail?.yesPrice ?? null)}</b></div>
        <div className="is-no"><span>No</span><b>{!detail && !error ? <span className="gq-skeleton"/> : dollars(detail?.noPrice ?? null)}</b></div>
      </div>
      {!detail && !error && <span className="gq-sr-only" role="status">Loading PANTA prices</span>}
      {error ? <p role="alert">{error} <button type="button" className="gq-text-button" onClick={() => setAttempt(value => value + 1)}>Try again</button></p>
        : <p>USDC per share. {detail && (detail.yesPrice === null || detail.noPrice === null) ? 'Some prices are unavailable. ' : ''}Final payouts follow PANTA’s market rules.</p>}
      <p>Resolution scheduled for {formatTime(shown.resolutionTime)}.</p>
      <a className="gq-primary" href={pantaMarketUrl(market.marketId)} target="_blank" rel="noopener noreferrer">{shown.phase === 'resolved' || shown.phase === 'cancelled' ? 'View result on PANTA' : 'Trade on PANTA'}<ArrowUpRight size={15}/></a>
    </div>}
    <button className="gq-text-button gq-card-toggle" type="button" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-controls={`panta-${market.marketId}`}>{open ? 'Hide details' : 'View prices & details'}</button>
  </article>
}

/**
 * PANTA markets ColaCat has imported or created, with our own latest recorded
 * price. Nothing renders when there are none or PANTA is not connected: this
 * list is an addition to the catalogue below it, never a state of its own.
 */
export function PantaTrackedList({ apiUrl }: { apiUrl: string }) {
  const [items, setItems] = useState<PantaTrackedMarket[] | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    void createPantaApi(apiUrl).tracked(controller.signal).then(value => { if (!controller.signal.aborted) setItems(value) }, () => { if (!controller.signal.aborted) setItems([]) })
    return () => controller.abort()
  }, [apiUrl])
  if (!items?.length) return null
  return <section className="gq-panta gq-tracked" aria-labelledby="panta-tracked-title">
    <header className="gq-section-heading"><div><h2 id="panta-tracked-title">Tracked on {brand.name}</h2><p>PANTA markets with their price history recorded here. Open one to see its chart.</p></div></header>
    <div className="gq-panta-grid">{items.map(item => <article className="gq-panta-card" key={item.marketId}>
      <div className="gq-card-meta"><span>{item.category}</span><span>{phaseLabel[item.phase]}</span></div>
      <h3><a href={`/events-panta/${item.marketId}`}>{item.title}<ArrowUpRight size={17}/></a></h3>
      <div className="gq-card-facts"><span>Yes {item.lastYes === null ? '—' : dollars(item.lastYes)}</span><span>Closes <time dateTime={new Date(item.endTime * 1000).toISOString()}>{formatTime(item.endTime)}</time></span></div>
    </article>)}</div>
  </section>
}

export function PantaMarkets({ apiUrl }: { apiUrl: string }) {
  const api = useMemo(() => createGeneralQuestionsApi(apiUrl), [apiUrl])
  const [category, setCategory] = useState('')
  const [phase, setPhase] = useState('')
  const [cursors, setCursors] = useState<string[]>([])
  const [page, setPage] = useState<PantaPage | null>(null)
  const [error, setError] = useState('')
  const [notConfigured, setNotConfigured] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const cursor = cursors.at(-1) ?? ''
  useEffect(() => {
    const controller = new AbortController()
    setPage(null); setError(''); setNotConfigured(false)
    const query = new URLSearchParams({ limit: '12' })
    if (category) query.set('category', category)
    if (phase) query.set('status', phase)
    if (cursor) query.set('cursor', cursor)
    void api.markets(query, controller.signal).then(value => {
      if (!controller.signal.aborted) setPage(value)
    }).catch(reason => {
      if (controller.signal.aborted) return
      const unconfigured = reason instanceof GeneralQuestionsError && reason.code === 'PANTA_NOT_CONFIGURED'
      setNotConfigured(unconfigured)
      setError(unconfigured ? 'PANTA markets are not connected yet. You can still propose a question for review.' : 'PANTA markets could not load. Please try again.')
    })
    return () => controller.abort()
  }, [api, category, phase, cursor, attempt])
  return <section className="gq-panta" aria-labelledby="panta-title">
    <header className="gq-section-heading"><div><h2 id="panta-title">PANTA markets</h2><p>Questions across crypto, sports, culture, and the world.</p></div><a href="https://www.panta.market/how-it-works" target="_blank" rel="noopener noreferrer">Powered by PANTA<ArrowUpRight size={14}/></a></header>
    <div className="gq-provider-filters">
      <label>Category<select value={category} onChange={event => { setCategory(event.target.value); setCursors([]) }}><option value="">All categories</option>{PANTA_CATEGORIES.map(value => <option key={value} value={value}>{value[0]!.toUpperCase() + value.slice(1)}</option>)}</select></label>
      <label>Market phase<select value={phase} onChange={event => { setPhase(event.target.value); setCursors([]) }}><option value="">All phases</option>{Object.entries(phaseLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <button className="gq-text-button" type="button" aria-label="Refresh PANTA markets" onClick={() => setAttempt(value => value + 1)} disabled={!page && !error}><RefreshCw size={15}/>Refresh</button>
    </div>
    {error ? <div className="gq-unavailable" role={notConfigured ? 'status' : 'alert'}><strong>{notConfigured ? 'PANTA connection coming soon' : 'PANTA is unavailable'}</strong><p>{error}</p>{!notConfigured && <button className="gq-secondary" type="button" onClick={() => setAttempt(value => value + 1)}>Try again</button>}</div>
      : !page ? <div className="gq-panta-grid" role="status" aria-label="Loading PANTA markets" aria-busy="true">{[0, 1, 2].map(i => <div className="gq-panta-card gq-panta-pending" key={i} aria-hidden="true"><span className="gq-skeleton"/><span className="gq-skeleton"/><span className="gq-skeleton"/><span className="gq-skeleton"/></div>)}</div>
        : page.items.length ? <div className="gq-panta-grid">{page.items.map(market => <PantaMarketCard key={market.marketId} market={market} api={api}/>)}</div>
          : <div className="gq-unavailable"><strong>No PANTA markets in this view</strong><p>Try another category or market phase, or propose a question above.</p></div>}
    {(!error || cursors.length > 0) && <nav className="gq-pagination" aria-label="PANTA market pages"><button className="gq-secondary" type="button" disabled={!cursors.length || (!page && !error)} onClick={() => setCursors(values => values.slice(0, -1))}><ArrowLeft size={15}/>Previous</button><span>Page {cursors.length + 1}</span><button className="gq-secondary" type="button" disabled={!page?.nextCursor || page.nextCursor === cursor || cursors.includes(page.nextCursor)} onClick={() => { if (page?.nextCursor) setCursors(values => [...values, page.nextCursor!]) }}>Next<ArrowRight size={15}/></button></nav>}
  </section>
}
