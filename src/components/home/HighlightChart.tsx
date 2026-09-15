import { useEffect, useId, useRef, useState } from 'react'
import { Clock3 } from 'lucide-react'
import type { ArenaMarket, ArenaMarketOutcome, SolzSnapshot } from '../solz/model'
import { compact, percent } from './HomePrimitives'
import { dreamDexOnly } from './useDreamDexSnapshot'
import { resolvePredictionContract } from '../solz/predictionContracts'
import { outcomeColor } from './heroMarket'

type Props = {
  market: ArenaMarket; snapshot: SolzSnapshot; outcome: ArenaMarketOutcome
  onOutcome: (outcome: ArenaMarketOutcome) => void
  colors?: Record<string, string>; referenceMarket?: ArenaMarket; focusOnly?: boolean
  collateral?: string; simulation?: boolean; dates?: ArenaMarket[]; onMarket: (market: ArenaMarket) => void; sourceLabel?: string
  showTitle?: boolean; historyPicker?: boolean
}
const timeLabel = (at: number, long: boolean) => new Date(at).toLocaleString('en', long ? { month: 'short', day: 'numeric' } : { hour: '2-digit', minute: '2-digit', hour12: false })

export function HighlightChart({ market, snapshot, outcome, onOutcome, dates, onMarket, simulation = true, colors, focusOnly = false, sourceLabel, collateral = 'COOLA', showTitle = true, historyPicker = true }: Props) {
  const displayMarket = market
  const focus = resolvePredictionContract(displayMarket, outcome.id) ?? outcome
  // Derived, with an explicit override. A plain initialiser latched at mount:
  // TabPanel renders its children even while hidden and PredictionDetail passes
  // no key, so a panel that mounted before any data arrived kept showing the
  // empty state of a mode that never had any, while the other mode had a series.
  const [modeOverride, setModeOverride] = useState<'quotes' | 'trades' | null>(null)
  const rawSeries = (focusOnly ? [focus] : displayMarket.outcomes).filter((item): item is ArenaMarketOutcome => Boolean(item))
  const nonEmpty = (mode: 'quotes' | 'trades') => rawSeries.some(item => ((mode === 'trades' ? item.priceHistory : item.quoteHistory)?.length ?? 0) > 0)
  const preferred = focusOnly ? 'trades' as const : 'quotes' as const
  const other = focusOnly ? 'quotes' as const : 'trades' as const
  // Only ever auto-flip to a series the venue actually produced. Arena markets
  // carry a seeded priceHistory and no quoteHistory, so with simulation off the
  // preferred 'quotes' mode is empty and 'trades' is not — flipping there made
  // the heading read LIVE MARKET over fabricated data.
  const venueBacked = rawSeries.some(item => item.marketQuote !== undefined || (item.quoteHistory?.length ?? 0) > 0 || item.historyStatus !== undefined)
  const historyMode = modeOverride ?? (!simulation && venueBacked && !nonEmpty(preferred) && nonEmpty(other) ? other : preferred)
  const series = rawSeries.map(item => {
    const history = !simulation && historyMode === 'quotes' ? item.quoteHistory ?? [] : item.priceHistory ?? []
    return { ...item, probability: history.at(-1)?.probability ?? item.probability, priceHistory: history }
  })
  const hasPriceHistory = series.some(item => (item.priceHistory?.length ?? 0) > 0)
  const long = !market.matchId
  const [range, setRange] = useState('ALL')
  const [chartStyle, setChartStyle] = useState<'line' | 'step'>('line')
  const [scale, setScale] = useState<'focus' | 'full'>(focusOnly ? 'focus' : 'full')
  const [hover, setHover] = useState<number | null>(null)
  const clipId = useId()
  const plot = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 970, height: 320 })
  useEffect(() => {
    const element = plot.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0) setSize({ width, height })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [simulation, hasPriceHistory])
  const plotWidth = Math.max(1, size.width - 44)
  const plotHeight = Math.max(1, size.height - 40)
  const windows: Record<string, number> = { '1M': 60_000, '5M': 300_000, '15M': 900_000, '1D': 86_400_000, '1W': 604_800_000, ALL: Infinity }
  const historyTimes = series.flatMap((item) => item.priceHistory?.map((point) => point.at) ?? [])
  const end = historyTimes.length ? Math.max(...historyTimes) : snapshot.updatedAt
  const allStart = historyTimes.length ? Math.min(Math.min(...historyTimes), end - 60_000) : end - 60_000
  const start = Math.max(allStart, end - (windows[range] ?? Infinity))
  const duration = Math.max(1, end - start)
  const visibleProbabilities = series.filter(item => simulation || item.priceHistory.length > 0).flatMap((item) => [item.probability, ...(item.priceHistory ?? []).filter((point) => point.at >= start).map((point) => point.probability)])
  if (!visibleProbabilities.length) visibleProbabilities.push(.5)
  const minimum = Math.min(...visibleProbabilities), maximum = Math.max(...visibleProbabilities)
  const padding = Math.max(.025, (maximum - minimum) * .15)
  const lower = scale === 'focus' ? Math.max(0, Math.floor((minimum - padding) * 20) / 20) : 0
  const upper = scale === 'focus' ? Math.min(1, Math.ceil((maximum + padding) * 20) / 20) : 1
  const x = (at: number) => 8 + (at - start) / duration * plotWidth
  const y = (p: number) => 12 + (upper - p) / Math.max(.05, upper - lower) * plotHeight
  const hoverAt = hover === null ? null : start + hover * duration
  const colorFor = (item: ArenaMarketOutcome, index: number) => colors?.[item.id] ?? (focusOnly ? '#51b6ff' : outcomeColor(item, snapshot, index))
  // Requires both: the producer's indicative flag AND a surviving series. The
  // pre-game flatten in HomeApp rewrites probability to 0.5 and empties
  // priceHistory without clearing `indicative`, so the flag alone let the
  // placeholder render as a real quote.
  const hasPrice = (item: ArenaMarketOutcome) => simulation || (!item.indicative && ((item.priceHistory?.length ?? 0) > 0 || (item.quoteHistory?.length ?? 0) > 0 || item.marketQuote !== undefined))
  return <div className="ch-chart" aria-label={`${market.title} ${focusOnly ? focus.label : 'all outcomes'} ${simulation ? 'simulated' : 'live'} probability chart`}>
    {/* The page header already states that this market is live. Only say
        something the reader does not already have on screen: the source when a
        caller names one, and the two states that are not "running normally". */}
    {(simulation || !hasPriceHistory || sourceLabel || long) && <div className="ch-chart-heading"><span className="ch-simulation">{simulation ? sourceLabel ?? 'SIMULATION' : hasPriceHistory ? sourceLabel : `${sourceLabel ? `${sourceLabel} · ` : ''}AWAITING PRICES`}</span>{long && <span className="ch-long-label">SEASON PREDICTION</span>}</div>}
    {dates && <div className="ch-date-tabs" aria-label="Prediction closing date">{dates.map((item) => <button key={item.id} aria-pressed={market.id === item.id} onClick={() => { setRange('ALL'); onMarket(item) }}>{timeLabel(item.closesAt, true)}</button>)}</div>}
    {!focusOnly && showTitle && <h2>{market.title}</h2>}
    {focusOnly && <div className="ch-chart-focus"><strong>{hasPrice(series[0]) ? `${percent(series[0].probability)} market price` : 'No price yet'}</strong><span>{focus.label}</span></div>}
    {!focusOnly && <div className="ch-chart-legend">{series.map((item, index) => <button key={item.id} aria-pressed={outcome.id === item.id} onClick={() => onOutcome(item)}><i style={{ background: colorFor(item, index) }}/><span>{item.label}</span><b>{hasPrice(item) ? percent(item.probability) : '—'}</b></button>)}</div>}
    {!simulation && historyPicker && <div className="ch-history-source" role="group" aria-label="Price history source"><button type="button" aria-pressed={historyMode === 'quotes'} onClick={() => setModeOverride('quotes')}>Quotes</button><button type="button" aria-pressed={historyMode === 'trades'} onClick={() => setModeOverride('trades')}>Trades</button><span>{historyMode === 'quotes' ? 'Observed exchange quotes · markets at the same price overlap' : 'Executed exchange trades · opening a market is not a trade'}</span></div>}
    {!hasPriceHistory && !simulation ? <div className="ch-market-empty ch-chart-empty"><div className="ch-empty-chart-grid" aria-hidden="true"><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/></div><strong>{historyMode === 'quotes' ? 'No quotes recorded yet.' : rawSeries.some(item => item.historyStatus === 'unavailable') ? 'Trade history unavailable.' : 'No trades recorded yet.'}</strong><span>{historyMode === 'quotes' ? 'Quotes are recorded while this page is open. Open markets need resting orders to produce a quote.' : historyPicker ? 'Choose Quotes to see resting market prices. Trades appear here after actual fills are indexed.' : 'Trades appear here after actual fills are confirmed on chain.'}</span></div> : <>{!simulation && historyMode === 'trades' && historyTimes.length === 1 && <p className="ch-sample-note">One trade recorded. More trades will build the price history.</p>}
    <div className="ch-plot" ref={plot} onPointerMove={(event) => { const box = event.currentTarget.getBoundingClientRect(); setHover(Math.max(0, Math.min(1, (event.clientX - box.left - 8) / plotWidth))) }} onPointerLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${size.width} ${size.height}`} preserveAspectRatio="none" role="img" aria-label={`Probability history for ${series.map((item) => `${item.label}, ${percent(item.probability)}`).join('; ')}`}>
        <defs><clipPath id={clipId}><rect x="5" y="8" width={plotWidth + 6} height={plotHeight + 8}/></clipPath></defs>
        {(size.height < 130 ? [1, .5, 0] : [1, .75, .5, .25, 0]).map((part) => { const p = lower + part * (upper - lower); return <g key={part}><line className="ch-grid-line" x1="8" x2={8 + plotWidth} y1={y(p)} y2={y(p)}/><text x={size.width - 27} y={y(p) + 4}>{Math.round(p * 100)}%</text></g> })}
        <g clipPath={`url(#${clipId})`}>{series.map((item, index) => {
          const history = item.priceHistory
          if (!history.length) return null
          const color = colorFor(item, index)
          const path = history.map((point, i) => i && chartStyle === 'step'
            ? `H${x(point.at).toFixed(2)} V${y(point.probability).toFixed(2)}`
            : `${i ? 'L' : 'M'}${x(point.at).toFixed(2)},${y(point.probability).toFixed(2)}`).join(' ')
          return <g key={item.id}>{chartStyle === 'step' && outcome.id === item.id && history.length > 0 && <path d={`${path} L${x(history[history.length - 1].at)},${y(lower)} L${x(history[0].at)},${y(lower)} Z`} fill={color} opacity="0.08"/>}<path d={path} fill="none" stroke={color} strokeWidth={outcome.id === item.id ? 2.8 : 1.7} opacity={focusOnly || outcome.id === item.id ? 1 : .7} strokeDasharray={!focusOnly && historyMode === 'quotes' ? [undefined, '8 4', '3 4', '12 4 3 4'][index % 4] : undefined} vectorEffect="non-scaling-stroke"/><circle cx={x(history.at(-1)!.at)} cy={y(history.at(-1)!.probability)} r="3.3" fill={color}/></g>
        })}</g>
        {hoverAt !== null && <line x1={x(hoverAt)} x2={x(hoverAt)} y1="12" y2={12 + plotHeight} stroke="#878b96" strokeDasharray="3 4"/>}
        {(size.width < 500 ? [0, .5, 1] : [0, .25, .5, .75, 1]).map((part) => <text key={part} x={8 + part * plotWidth} y={size.height - 7} textAnchor={part === 0 ? 'start' : part === 1 ? 'end' : 'middle'}>{timeLabel(start + part * duration, long)}</text>)}
      </svg>
      {hoverAt !== null && <div className="ch-chart-tooltip"><span>{timeLabel(hoverAt, long)}</span>{series.filter(item => item.priceHistory.length).map((item, index) => {
        const inspectedHistory = item.priceHistory ?? []
        const closest = chartStyle === 'step'
          ? inspectedHistory.filter((point) => point.at <= hoverAt).at(-1)
          : inspectedHistory.reduce<(typeof inspectedHistory)[number] | undefined>((a, b) => !a || Math.abs(b.at - hoverAt) < Math.abs(a.at - hoverAt) ? b : a, undefined)
        return <span key={item.id}><i style={{ background: colorFor(item, index) }}/>{item.label}<b>{percent(closest?.probability ?? item.probability)}</b></span>
      })}</div>}
    </div>
    <div className="ch-chart-footer"><span>{simulation ? `${compact(displayMarket.volume.COOLA)} COOLA Vol.` : `${collateral === 'COOLA' ? dreamDexOnly(market)?.chainId === '50312' ? 'tUSDC' : 'Collateral' : collateral} ${historyMode === 'quotes' ? 'quote observations' : 'trade history'}`}</span><span className="ch-chart-close"><Clock3 size={12}/>{timeLabel(market.closesAt, long)}</span><div className="ch-chart-controls">
      <div role="group" aria-label="Chart style"><span>Chart</span>{(['line', 'step'] as const).map((value) => <button type="button" key={value} aria-pressed={chartStyle === value} onClick={() => setChartStyle(value)}>{value === 'line' ? 'Line' : 'Step'}</button>)}</div>
      <div role="group" aria-label="Chart probability scale"><span>Scale</span>{(['focus', 'full'] as const).map((value) => <button type="button" key={value} aria-pressed={scale === value} onClick={() => setScale(value)}>{value === 'focus' ? 'Focus' : '0–100%'}</button>)}</div>
    </div><div className="ch-chart-range" aria-label="Chart time range">{(long ? ['1D', '1W', 'ALL'] : ['1M', '5M', '15M', 'ALL']).map((value) => <button aria-pressed={range === value} key={value} onClick={() => setRange(value)}>{value}</button>)}</div></div></>}
  </div>
}
