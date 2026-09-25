import '../../styles/stock-measure.css'
import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import { useState } from 'react'
import type { GeneralEventPrices, GeneralEventPricesState, MeasuredCandidate } from './generalEventPrices'
import { brand } from '../solz/brand'

/**
 * What a stock question measures, shown beside its market: each candidate's
 * price from the pool the resolver reads, and how far it has moved. These are
 * measurements, not odds. The order book above prices the question; this
 * panel shows the number the question will be settled on.
 */

export const LINE_COLORS = ['#c7ff00', '#66caff', '#ff9f43', '#b58cff', '#ffd166', '#4dd4c4', '#ff79c6', '#9aa5b1', '#e8e8ea', '#7aa2ff', '#f7a8a8', '#a0e7a0', '#d4b483', '#8fd3ff', '#c3a6ff', '#ffc38a']
const dateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' })
const utc = (value: number | string) => `${dateFormat.format(typeof value === 'number' ? value : Date.parse(value))} UTC`
const usd = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: value >= 100 ? 2 : 4 }).format(value)
const pct = (micros: number) => `${micros >= 0 ? '+' : ''}${(micros / 10_000).toFixed(2)}%`
const SOLANA_POOL = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

/** Embed the same frozen pool that supplies oracle candles. The iframe is
 *  mounted only on demand, so passive viewers create no live-chart traffic. */
export function livePreStocksChartUrl(pool: string): string | null {
  if (!SOLANA_POOL.test(pool)) return null
  const url = new URL(`https://www.geckoterminal.com/solana/pools/${pool}`)
  url.search = new URLSearchParams({ embed: '1', info: '0', swaps: '0', light_chart: '0', chart_type: 'price', resolution: '15m', bg_color: '1a1d22' }).toString()
  return url.toString()
}

/** The pools that can be embedded, one per pool. */
export function liveChartCandidates(prices: GeneralEventPrices) {
  return prices.candidates.filter((candidate, index, all) => livePreStocksChartUrl(candidate.pool)
    && all.findIndex(other => other.pool === candidate.pool) === index)
}

/** The live pool chart, as a hero tab. The tab mounts it, so a visitor who
 *  never opens the tab creates no live-chart traffic. */
export function LivePreStocksChart({ prices }: { prices: GeneralEventPrices }) {
  const [selected, setSelected] = useState(0)
  const candidates = liveChartCandidates(prices)
  const current = candidates[selected] ?? candidates[0]
  if (!current) return null
  const src = livePreStocksChartUrl(current.pool)!
  return <div className="sm-live">
    {candidates.length > 1 && <div className="sm-live-assets" role="group" aria-label="PreStocks chart asset">{candidates.map((candidate, index) => <button key={candidate.questionId} type="button" aria-pressed={current.questionId === candidate.questionId} onClick={() => setSelected(index)}>{candidate.symbol}</button>)}</div>}
    <iframe className="sm-live-frame" title={`${current.symbol} live PreStocks pool chart`} src={src} loading="lazy" allowFullScreen/>
    <p className="sm-source">Live pool chart by <a href={`https://www.geckoterminal.com/solana/pools/${current.pool}`} target="_blank" rel="noopener noreferrer">GeckoTerminal</a>. It shows USD per base token. Oracle settlement uses the hourly closes and the cutoff in the Measured tab.</p>
  </div>
}

export type Series = { key: string; color: string; points: { t: number; v: number }[] }

/** A plain SVG line chart. `v` is already in the unit the axis shows. Shared
 *  with the PANTA page, which draws PANTA's price in USDC per share. */
export function MeasuredLineChart({ series, unit, band, marker, levels = [], label: ariaLabel }: { series: Series[]; unit: 'percent' | 'usd'; band?: { low: number; high: number }; marker?: number; levels?: number[]; label?: string }) {
  const all = series.flatMap(line => line.points)
  if (all.length < 2) return <div className="sm-chart sm-chart-empty">Not enough traded prices to draw yet.</div>
  const t0 = Math.min(...all.map(p => p.t)), t1 = Math.max(...all.map(p => p.t))
  const values = [...all.map(p => p.v), ...(band ? [band.low, band.high] : []), ...levels]
  let v0 = Math.min(...values), v1 = Math.max(...values)
  const pad = (v1 - v0) * 0.08 || Math.abs(v1) * 0.02 || 1
  v0 -= pad; v1 += pad
  const W = 600, H = 170
  const x = (t: number) => (t1 === t0 ? 0 : ((t - t0) / (t1 - t0)) * W)
  const y = (v: number) => H - ((v - v0) / (v1 - v0)) * H
  const label = (v: number) => unit === 'percent' ? `${v >= 0 ? '+' : ''}${v.toFixed(1)}%` : usd(v)
  return <figure className="sm-chart">
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={ariaLabel ?? (unit === 'percent' ? 'Return since the window opened, per candidate' : 'Price against the forecast band')}>
      {band && <rect className="sm-band" x={0} width={W} y={y(band.high)} height={Math.max(1, y(band.low) - y(band.high))}/>}
      {levels.map(level => <line key={level} className="sm-level" x1={0} x2={W} y1={y(level)} y2={y(level)}/>)}
      {unit === 'percent' && v0 < 0 && v1 > 0 && <line className="sm-zero" x1={0} x2={W} y1={y(0)} y2={y(0)}/>}
      {marker !== undefined && marker > t0 && marker < t1 && <line className="sm-marker" x1={x(marker)} x2={x(marker)} y1={0} y2={H}/>}
      {series.map(line => <polyline key={line.key} fill="none" stroke={line.color} strokeWidth={1.6} vectorEffect="non-scaling-stroke" points={line.points.map(p => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')}/>)}
    </svg>
    <figcaption><span>{label(v1)}</span><span>{label(v0)}</span></figcaption>
  </figure>
}

function Verdict({ candidate }: { candidate: MeasuredCandidate }) {
  if (!candidate.verdict) return null
  return <b className={`sm-verdict is-${candidate.verdict.toLowerCase()}`}>{candidate.verdict === 'VOID' ? 'Void' : candidate.verdict === 'YES' ? 'Resolved Yes' : 'Resolved No'}</b>
}

function TopReturn({ prices }: { prices: GeneralEventPrices & { rule: { kind: 'top-return' } } }) {
  const { rule } = prices
  const start = Date.parse(rule.windowStart) / 1000
  const ranked = prices.candidates.map((candidate, index) => ({ candidate, color: LINE_COLORS[index % LINE_COLORS.length]! }))
    .sort((a, b) => (b.candidate.returnMicros ?? -Infinity) - (a.candidate.returnMicros ?? -Infinity))
  // Judged at the moment the prices describe, not by the viewer's clock.
  const opened = (prices.asOf ?? Date.now()) / 1000 >= start
  const series: Series[] = ranked.map(({ candidate, color }) => {
    const base = candidate.start?.c ?? candidate.points.find(([t]) => t >= start)?.[1] ?? candidate.points[0]?.[1]
    return { key: candidate.questionId, color, points: base ? candidate.points.map(([t, c]) => ({ t, v: (c / base - 1) * 100 })) : [] }
  })
  return <>
    <p className="sm-note">{opened ? `Return since ${utc(rule.windowStart)}, measured to ${utc(rule.windowEnd)}.` : `Measurement starts ${utc(rule.windowStart)}. The chart shows the week before.`}</p>
    <MeasuredLineChart series={series} unit="percent" marker={start}/>
    <ol className="sm-rows">
      {ranked.map(({ candidate, color }) => <li key={candidate.questionId} className={candidate.verdict === 'YES' ? 'is-leader' : ''}>
        <i style={{ background: color }} aria-hidden="true"/>
        <span className="sm-symbol">{candidate.symbol}</span>
        <span className="sm-price">{candidate.start ? usd(candidate.start.c) : '—'}<small>start</small></span>
        <span className="sm-price">{candidate.latest ? usd(candidate.latest.c) : '—'}<small>{opened ? 'latest' : 'now'}</small></span>
        <span className="sm-return">{candidate.returnMicros === null ? <em>{opened ? 'no price yet' : 'not started'}</em> : <>{candidate.returnMicros >= 0 ? <ArrowUpRight size={13} aria-hidden="true"/> : <ArrowDownRight size={13} aria-hidden="true"/>}{pct(candidate.returnMicros)}</>}</span>
        <Verdict candidate={candidate}/>
      </li>)}
    </ol>
    <p className="sm-source">Settled on GeckoTerminal hourly closes in USD per base token, one frozen pool per token. The biggest gain wins; every tied leader resolves Yes. No trade within {rule.maxStalenessHours} hours of the start or the end voids every question in the event.</p>
  </>
}

function AgentBand({ prices }: { prices: GeneralEventPrices & { rule: { kind: 'agent-band' } } }) {
  const { rule } = prices
  const [candidate] = prices.candidates
  const latest = candidate?.latest?.c
  const inside = latest !== undefined && latest >= rule.low && latest <= rule.high
  return <>
    <p className="sm-note">The {brand.name} agent ({rule.model}) forecast on {utc(rule.madeAt)} that {candidate?.symbol} trades between <b>{usd(rule.low)}</b> and <b>{usd(rule.high)}</b> at {utc(rule.at)}, centred on {usd(rule.center)}. Yes means the agent is right.</p>
    <MeasuredLineChart series={candidate ? [{ key: candidate.questionId, color: LINE_COLORS[0]!, points: candidate.points.map(([t, c]) => ({ t, v: c })) }] : []} unit="usd" band={{ low: rule.low, high: rule.high }} marker={Date.parse(rule.madeAt) / 1000}/>
    <ol className="sm-rows">
      {candidate && <li>
        <i style={{ background: LINE_COLORS[0] }} aria-hidden="true"/>
        <span className="sm-symbol">{candidate.symbol}</span>
        <span className="sm-price">{usd(rule.lastClose)}<small>at forecast</small></span>
        <span className="sm-price">{latest !== undefined ? usd(latest) : '—'}<small>latest</small></span>
        <span className="sm-return">{latest === undefined ? <em>no price yet</em> : inside ? 'inside the band' : 'outside the band'}</span>
        <Verdict candidate={candidate}/>
      </li>}
    </ol>
    <p className="sm-source">Settled on the GeckoTerminal hourly close before {utc(rule.at)}, in USD per base token. Both edges of the band count as inside. No trade within {rule.maxStalenessHours} hours before that moment voids the question.</p>
  </>
}

function Above({ prices }: { prices: GeneralEventPrices & { rule: { kind: 'above' } } }) {
  const { rule } = prices
  const candidate = prices.candidates[0]
  const display = candidate?.latest ? candidate.latest.c / rule.displayMultiplier : null
  return <>
    <p className="sm-note">YES if the OpenAI PreStocks displayed price is strictly above <b>{usd(rule.thresholdUsd)}</b> at {utc(rule.at)}. The oracle divides the recorded base-unit price by the frozen {rule.displayMultiplier} display multiplier.</p>
    <MeasuredLineChart series={candidate ? [{ key: candidate.questionId, color: LINE_COLORS[0]!, points: candidate.points.map(([t, c]) => ({ t, v: c / rule.displayMultiplier })) }] : []} unit="usd"/>
    <ol className="sm-rows">{candidate && <li><i style={{ background: LINE_COLORS[0] }} aria-hidden="true"/><span className="sm-symbol">OPENAI</span><span className="sm-price">{usd(rule.thresholdUsd)}<small>threshold</small></span><span className="sm-price">{display === null ? '—' : usd(display)}<small>latest</small></span><span className="sm-return">{display === null ? 'no price yet' : display > rule.thresholdUsd ? 'above' : 'at or below'}</span><Verdict candidate={candidate}/></li>}</ol>
    <p className="sm-source">GeckoTerminal hourly USD close from the frozen OpenAI pool. Missing fresh trades void the question.</p>
  </>
}

function AboveLadder({ prices }: { prices: GeneralEventPrices & { rule: { kind: 'above-ladder' } } }) {
  const { rule } = prices
  const first = prices.candidates[0]
  const display = first?.latest ? first.latest.c / rule.displayMultiplier : null
  const levels = prices.candidates.map(candidate => candidate.thresholdUsd!).filter(Number.isFinite)
  return <>
    <p className="sm-note">Each row is a separate YES/NO market. YES if OpenAI PreStocks is strictly above that displayed USD price at {utc(rule.at)}. Current measured price: <b>{display === null ? 'unavailable' : usd(display)}</b>.</p>
    <MeasuredLineChart series={first ? [{ key: first.questionId, color: LINE_COLORS[0]!, points: first.points.map(([t, c]) => ({ t, v: c / rule.displayMultiplier })) }] : []} unit="usd" levels={levels} label="OpenAI displayed price and linked strike levels"/>
    <ol className="sm-rows">{prices.candidates.map(candidate => <li key={candidate.questionId}>
      <i style={{ background: LINE_COLORS[0] }} aria-hidden="true"/><span className="sm-symbol">Above {usd(candidate.thresholdUsd!)}</span>
      <span className="sm-price">{usd(candidate.thresholdUsd!)}<small>strike</small></span>
      <span className="sm-price">{display === null ? '—' : usd(display)}<small>latest</small></span>
      <span className="sm-return">{display === null ? <em>no price yet</em> : display > candidate.thresholdUsd! ? 'above' : 'at or below'}</span>
      <Verdict candidate={candidate}/>
    </li>)}</ol>
    <p className="sm-source">One frozen OpenAI pool supplies all five rows. The oracle divides its hourly base-token USD close by the frozen {rule.displayMultiplier} display multiplier. A missing fresh close voids all five rows.</p>
  </>
}

/** Shaped like the loaded panel, so nothing moves when the prices land. */
function Skeleton({ rows }: { rows: number }) {
  return <div aria-hidden="true">
    <span className="ev-sk ev-sk-line sm-sk-note"/>
    <span className="ev-sk sm-sk-chart"/>
    <div className="sm-rows">{Array.from({ length: rows }, (_, index) => <span key={index} className="ev-sk sm-sk-row"/>)}</div>
  </div>
}

/** The Measured tab: the number the question settles on. The agent's own
 *  record is the Agent tab, and the live pool chart is its own tab. */
export function StockMeasureView({ state, expectedRows = 8 }: { state: GeneralEventPricesState; expectedRows?: number }) {
  if (state.phase === 'absent') return null
  const prices = state.phase === 'loaded' ? state.prices : null
  const agent = prices?.rule.kind === 'agent-band'
  const reading = state.phase === 'loading' || prices?.status === 'pending'
  return <section className="sm-panel" aria-labelledby="stock-measure-title" aria-busy={reading}>
    <div className="ev-section-title"><h2 id="stock-measure-title">{agent ? 'Agent forecast' : 'Measured performance'} <span>PRESTOCKS</span></h2>{prices?.asOf && <span>Prices as of {utc(prices.asOf)}{prices.status === 'stale' ? ' · refresh delayed' : ''}</span>}</div>
    {state.phase === 'unavailable' ? <p className="sm-unavailable" role="status">Measured prices are unavailable right now. The market itself is not affected.</p>
      : reading || !prices ? <><Skeleton rows={agent ? 1 : expectedRows}/><span className="sm-sr-only" role="status">Reading measured prices</span></>
        : prices.rule.kind === 'top-return' ? <TopReturn prices={prices as GeneralEventPrices & { rule: { kind: 'top-return' } }}/>
          : prices.rule.kind === 'above-ladder' ? <AboveLadder prices={prices as GeneralEventPrices & { rule: { kind: 'above-ladder' } }}/>
          : prices.rule.kind === 'above' ? <Above prices={prices as GeneralEventPrices & { rule: { kind: 'above' } }}/>
            : prices.rule.kind === 'agent-band' ? <AgentBand prices={prices as GeneralEventPrices & { rule: { kind: 'agent-band' } }}/>
              : null}
    {prices?.evidence?.void && <p className="sm-void" role="status">Voided: {prices.evidence.void}</p>}
    {prices?.evidence && <p className="sm-evidence">Evidence hash <code>{prices.evidence.hash.slice(0, 16)}…</code></p>}
  </section>
}
