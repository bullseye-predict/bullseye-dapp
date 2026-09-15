import { useEffect, useId, useRef, useState } from 'react'
import { Clock3 } from 'lucide-react'
import type { ArenaMarket, ArenaMarketOutcome, ArenaPricePoint, SolzSnapshot } from '../solz/model'
import { compact } from './HomePrimitives'
import { dreamDexOnly } from './useDreamDexSnapshot'
import { resolvePredictionContract } from '../solz/predictionContracts'
import { outcomeColor } from './heroMarket'
import { centsLabel } from './venue/quoteLabels'

type Props = {
  market: ArenaMarket; snapshot: SolzSnapshot; outcome: ArenaMarketOutcome
  onOutcome: (outcome: ArenaMarketOutcome) => void
  colors?: Record<string, string>; referenceMarket?: ArenaMarket; focusOnly?: boolean
  collateral?: string; simulation?: boolean; dates?: ArenaMarket[]; onMarket: (market: ArenaMarket) => void; sourceLabel?: string
  showTitle?: boolean; historyPicker?: boolean
}
const timeLabel = (at: number, long: boolean) => new Date(at).toLocaleString('en', long ? { month: 'short', day: 'numeric' } : { hour: '2-digit', minute: '2-digit', hour12: false })
/** The axis format follows the window, not only the market's horizon. Five ticks
 *  across a sixty-second span all read "06:29" in HH:mm, and in the season format
 *  they all read the same date — which is what made the axis look broken even
 *  before you noticed the window was frozen. */
const tickLabel = (at: number, long: boolean, duration: number) => duration <= 600_000
  ? new Date(at).toLocaleString('en', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  : duration <= 86_400_000
    ? new Date(at).toLocaleString('en', { hour: '2-digit', minute: '2-digit', hour12: false })
    // Wider than a day needs the date whether or not the market is a season one:
    // keyed off `long` alone, a 1W range on a match market printed five bare
    // clock times a day apart.
    : duration <= 2_592_000_000 ? new Date(at).toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', hour12: false })
      : timeLabel(at, long)

export type HistoryMode = 'quotes' | 'trades'

/**
 * Which of an outcome's two series this chart draws.
 *
 * Keyed on what a mount can NEVER receive, not on what has not arrived yet.
 * Emptiness made the choice a race against the receipt backfill — focus-only,
 * a couple of transactions a pass — so two browsers on one market drew
 * different series and printed different numbers under one label, and clicking
 * between answers flipped a chart mid-session. 'unavailable' is terminal here
 * (candles are read for the focused market only, so an unfocused panel waits
 * forever); 'pending' resolves to 'ready' on its own, and flipping on it is
 * exactly the race this replaced.
 */
export function resolveHistoryMode(
  series: readonly ArenaMarketOutcome[],
  { focusOnly, simulation, override }: { focusOnly: boolean; simulation: boolean; override?: HistoryMode },
): HistoryMode {
  if (override) return override
  const preferred = focusOnly ? 'trades' as const : 'quotes' as const
  const other = focusOnly ? 'quotes' as const : 'trades' as const
  // Only ever fall back to a series the venue actually produced. Arena markets
  // carry a seeded priceHistory and no quoteHistory, so with simulation off the
  // preferred 'quotes' mode is empty and 'trades' is not — flipping there made
  // the heading read LIVE MARKET over fabricated data.
  const venueBacked = series.some(item => item.marketQuote !== undefined || (item.quoteHistory?.length ?? 0) > 0 || item.historyStatus !== undefined)
  const unavailable = (mode: HistoryMode) => mode === 'trades'
    ? series.length > 0 && series.every(item => item.historyStatus === 'unavailable')
    : series.every(item => item.marketQuote === undefined && !(item.quoteHistory?.length ?? 0))
  return !simulation && venueBacked && unavailable(preferred) && !unavailable(other) ? other : preferred
}

export function HighlightChart({ market, snapshot, outcome, onOutcome, dates, onMarket, simulation = true, colors, focusOnly = false, sourceLabel, collateral = 'COOLA', showTitle = true, historyPicker = true }: Props) {
  const displayMarket = market
  const focus = resolvePredictionContract(displayMarket, outcome.id) ?? outcome
  // Derived, with an explicit override. A plain initialiser latched at mount:
  // TabPanel renders its children even while hidden and PredictionDetail passes
  // no key, so a panel that mounted before any data arrived kept showing the
  // empty state of a mode that never had any, while the other mode had a series.
  // Scoped to the market: PredictionDetail passes no key, so the chart survives a
  // market switch and an override taken on one question would otherwise follow
  // the user to the next.
  const [modeOverride, setModeOverride] = useState<{ id: string; mode: HistoryMode } | null>(null)
  const rawSeries = (focusOnly ? [focus] : displayMarket.outcomes).filter((item): item is ArenaMarketOutcome => Boolean(item))
  const historyMode = resolveHistoryMode(rawSeries, { focusOnly, simulation, override: modeOverride?.id === market.id ? modeOverride.mode : undefined })
  const series = rawSeries.map(item => {
    const history = !simulation && historyMode === 'quotes' ? item.quoteHistory ?? [] : item.priceHistory ?? []
    return { ...item, probability: history.at(-1)?.probability ?? item.probability, priceHistory: history }
  })
  const hasPriceHistory = series.some(item => (item.priceHistory?.length ?? 0) > 0)
  // A read still walking receipts, not a book with nothing in it. Only in trades
  // mode: a quote series has no backfill to wait on.
  const backfilling = historyMode === 'trades' && rawSeries.some(item => item.historyStatus === 'pending')
  // The drawn series' own last point — `series` already resolved which series
  // that is, so this follows the chart rather than racing it.
  const lastPoint = series[0]?.priceHistory?.at(-1)
  const long = !market.matchId
  const [range, setRange] = useState('ALL')
  // Derived with an override, like historyMode above. A quote series stores only
  // changes, so the price between two of them was constant — drawing a ramp
  // asserts a glide that never happened, and the longer a book rests the larger
  // the invention. Trades are actual executions and read correctly as a line.
  const [styleOverride, setStyleOverride] = useState<{ id: string; style: 'line' | 'step' } | null>(null)
  const chartStyle = (styleOverride?.id === market.id ? styleOverride.style : undefined) ?? (!simulation && historyMode === 'quotes' ? 'step' : 'line')
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
  // Every series is stored ascending, so the span is the first and last point of
  // each. Read by index rather than spread into Math.max: appendQuote keeps up to
  // 1200 points per series, and a twelve-answer event flattened ~14k arguments
  // into one call on every render.
  const span = series.reduce((current, item) => {
    const history = item.priceHistory ?? []
    const first = history[0]?.at, last = history.at(-1)?.at
    if (first === undefined || last === undefined) return current
    return { first: Math.min(current.first, first), last: Math.max(current.last, last), points: current.points + history.length }
  }, { first: Infinity, last: -Infinity, points: 0 })
  // The right edge is now, not the last observation. A quote series records only
  // changes, so a book that has not moved since the page opened holds exactly one
  // point — and pinning `end` to it froze the axis on the sixty seconds that
  // ended at page load, with every series stacked against the right edge. Clamped
  // to the cutoff so a locked market stops extending, but never below the last
  // point: history can legitimately carry a receipt stamped after closesAt.
  // `snapshot.updatedAt` is the arena feed's clock, while the quote producer
  // stamps its own points from an independent 10s poll — so the newest point is
  // routinely ahead of the snapshot. Take whichever is later, or the carry-forward
  // below would have nothing to carry to.
  const now = Math.max(snapshot.updatedAt, Date.now())
  const end = Math.max(span.points ? span.last : 0, Math.min(now, market.closesAt))
  const allStart = Math.min(span.points ? span.first : end, end - 60_000)
  // A named range means that many minutes of wall clock. Clamping it up to the
  // recorded span made 1M, 5M, 15M and ALL select the identical window whenever
  // the data sat inside one minute, so all four read as dead controls. Only ALL
  // is bounded by the data.
  const requested = windows[range]
  const start = requested === undefined || !Number.isFinite(requested) ? allStart : end - requested
  const duration = Math.max(1, end - start)
  /** A stored point is a CHANGE, and the price between two changes is the earlier
   *  one, so a series has to be clamped into the window and carried forward to
   *  `end` before it can be drawn. Without it a resting quote has no horizontal
   *  extent at all: one point emits `M x,y`, which SVG never strokes, leaving
   *  just the endpoint dot — and a quote whose last change predates the window
   *  vanishes rather than holding its line across it. */
  const windowed = (history: readonly ArenaPricePoint[]): ArenaPricePoint[] => {
    if (!history.length) return []
    const carried = history.filter(point => point.at <= start).at(-1)
    const inside = history.filter(point => point.at > start && point.at <= end)
    const points = carried ? [{ at: start, probability: carried.probability }, ...inside] : inside
    const last = points.at(-1)
    return last && last.at < end ? [...points, { at: end, probability: last.probability }] : points
  }
  const plotted = series.map(item => ({ ...item, priceHistory: windowed(item.priceHistory) }))
  const visibleProbabilities = plotted.filter(item => simulation || item.priceHistory.length > 0).flatMap((item) => [item.probability, ...item.priceHistory.map((point) => point.probability)])
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
  // Three cases, because they are three different facts. No venue price at all
  // is not the same as a book that quotes but has not traded yet, and neither is
  // the same as a figure we can actually show — which has to name its series,
  // since the last quote mid and the last executed fill are different numbers
  // and "market price" was covering both.
  const focusHeadline = !hasPrice(series[0]) ? 'No price yet'
    : lastPoint ? `${historyMode === 'quotes' ? 'Last quote' : 'Last trade'} ${centsLabel(lastPoint.probability)}`
      : historyMode === 'quotes' ? 'No quotes yet' : 'No trades yet'
  return <div className="ch-chart" aria-label={`${market.title} ${focusOnly ? focus.label : 'all outcomes'} ${simulation ? 'simulated' : 'live'} probability chart`}>
    {/* The page header already states that this market is live. Only say
        something the reader does not already have on screen: the source when a
        caller names one, and the two states that are not "running normally". */}
    {(simulation || !hasPriceHistory || sourceLabel || long) && <div className="ch-chart-heading"><span className="ch-simulation">{simulation ? sourceLabel ?? 'SIMULATION' : hasPriceHistory ? sourceLabel : `${sourceLabel ? `${sourceLabel} · ` : ''}AWAITING PRICES`}</span>{long && <span className="ch-long-label">SEASON PREDICTION</span>}</div>}
    {dates && <div className="ch-date-tabs" aria-label="Prediction closing date">{dates.map((item) => <button key={item.id} aria-pressed={market.id === item.id} onClick={() => { setRange('ALL'); onMarket(item) }}>{timeLabel(item.closesAt, true)}</button>)}</div>}
    {!focusOnly && showTitle && <h2>{market.title}</h2>}
    {/* Cents, not percent. Each answer in a mutually exclusive field has its own
        book and this chart plots those books, so the twelve-answer legend read
        50% + 50% + 88% + 70% + 60% — a 318% field — directly beside a CHANCE
        column saying 16%. The number is unchanged; what it claims to be is. The
        distribution reading is chance.ts's job and it is not derivable from one
        book. */}
    {/* One label used to cover two quantities: the last observed quote mid, and
        the last executed fill, which can be arbitrarily stale. Two browsers on
        one market read "18.5¢ market price" and "12¢ market price" at the same
        moment, and the second sat directly under a row quoting 20¢. Say which
        series the number came from, and when it was taken. */}
    {focusOnly && <div className="ch-chart-focus"><strong>{focusHeadline}</strong><span>{focus.label}</span>{lastPoint && <span className="ch-chart-focus-at">{timeLabel(lastPoint.at, false)}</span>}</div>}
    {!focusOnly && <div className="ch-chart-legend">{series.map((item, index) => <button key={item.id} aria-pressed={outcome.id === item.id} onClick={() => onOutcome(item)}><i style={{ background: colorFor(item, index) }}/><span>{item.label}</span><b>{hasPrice(item) ? centsLabel(item.probability) : '—'}</b></button>)}</div>}
    {!simulation && historyPicker && <div className="ch-history-source" role="group" aria-label="Price history source"><button type="button" aria-pressed={historyMode === 'quotes'} onClick={() => setModeOverride({ id: market.id, mode: 'quotes' })}>Quotes</button><button type="button" aria-pressed={historyMode === 'trades'} onClick={() => setModeOverride({ id: market.id, mode: 'trades' })}>Trades</button><span>{historyMode === 'quotes' ? 'Observed exchange quotes · markets at the same price overlap' : 'Executed exchange trades · opening a market is not a trade'}</span></div>}
    {!hasPriceHistory && !simulation ? <div className={`ch-market-empty ch-chart-empty${backfilling ? ' is-loading' : ''}`} role={backfilling ? 'status' : undefined}><div className="ch-empty-chart-grid" aria-hidden="true"><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/></div>{/* every, not some: the producer marks every unfocused market 'unavailable'
            because candles are read for the focused one only, so `some` made the
            chart assert a fact about twelve books from the read status of one. */}
      <strong>{historyMode === 'quotes' ? 'No quotes recorded yet.'
        : backfilling ? 'Loading trade history…'
          : rawSeries.every(item => item.historyStatus === 'unavailable') ? 'Trade history unavailable.'
            : 'No trades recorded yet.'}</strong><span>{historyMode === 'quotes' ? 'Quotes are recorded while this page is open. Open markets need resting orders to produce a quote.'
        : backfilling ? 'Receipts are decoded a few at a time, newest first.'
          : historyPicker ? 'Choose Quotes to see resting market prices. Trades appear here after actual fills are indexed.' : 'Trades appear here after actual fills are confirmed on chain.'}</span></div> : <>{/* A single observation is the normal steady state of a quiet book, not a
        failure — but the chart said so in trades mode only, so the quotes case
        rendered a near-flat plot with nothing explaining it. */}
    {!simulation && (historyMode === 'trades'
      ? span.points === 1 && <p className="ch-sample-note">One trade recorded. More trades will build the price history.</p>
      : series.every(item => (item.priceHistory?.length ?? 0) <= 1)
        ? <p className="ch-sample-note">Quotes have not moved since this page opened. The line holds the last observed price.</p>
        // A quote series is sampled by THIS tab and starts at page open, so two
        // browsers hold different lines for one book and ALL means "all of this
        // tab's lifetime". Neither was stated anywhere on the chart.
        : <p className="ch-sample-note">Quotes are sampled in this browser every 10 seconds · recorded since {timeLabel(span.first, false)}</p>)}
    {/* The pointer arrives in DOM pixels and plotWidth is in viewBox units; the
        two only agree while `size` matches the measured box, which it does not on
        the first paint after a hidden panel is revealed. Scale before offsetting. */}
    <div className="ch-plot" ref={plot} onPointerMove={(event) => { const box = event.currentTarget.getBoundingClientRect(); setHover(Math.max(0, Math.min(1, ((event.clientX - box.left) / Math.max(1, box.width) * size.width - 8) / plotWidth))) }} onPointerLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${size.width} ${size.height}`} preserveAspectRatio="none" role="img" aria-label={`Price history for ${series.map((item) => `${item.label}, ${centsLabel(item.probability)}`).join('; ')}`}>
        {/* Wide enough for the r=3.3 endpoint marker at x = 8 + plotWidth, which
            the old plotWidth + 6 rect sliced in half. */}
        <defs><clipPath id={clipId}><rect x="5" y="8" width={plotWidth + 11} height={plotHeight + 8}/></clipPath></defs>
        {/* Cents on the axis too. Leaving it in percent put a probability ladder
            behind series the legend and tooltip now price in ¢ — two units for
            one number, on one chart. */}
        {(size.height < 130 ? [1, .5, 0] : [1, .75, .5, .25, 0]).map((part) => { const p = lower + part * (upper - lower); return <g key={part}><line className="ch-grid-line" x1="8" x2={8 + plotWidth} y1={y(p)} y2={y(p)}/><text x={size.width - 27} y={y(p) + 4}>{Math.round(p * 100)}¢</text></g> })}
        <g clipPath={`url(#${clipId})`}>{plotted.map((item, index) => {
          const history = item.priceHistory
          if (!history.length) return null
          const color = colorFor(item, index)
          // A single point emits a lone moveto, which SVG does not stroke. That
          // happens whenever the newest observation lands exactly on `end` — a
          // just-recorded quote, or a market whose cutoff is older than its last
          // receipt. A zero-length lineto under a round cap paints the dot the
          // subpath is meant to be.
          const path = history.map((point, i) => i && chartStyle === 'step'
            ? `H${x(point.at).toFixed(2)} V${y(point.probability).toFixed(2)}`
            : `${i ? 'L' : 'M'}${x(point.at).toFixed(2)},${y(point.probability).toFixed(2)}`).join(' ')
          const stroked = history.length > 1 ? path : `${path} L${x(history[0]!.at).toFixed(2)},${y(history[0]!.probability).toFixed(2)}`
          return <g key={item.id}>{chartStyle === 'step' && outcome.id === item.id && history.length > 1 && <path d={`${path} L${x(history[history.length - 1].at)},${y(lower)} L${x(history[0].at)},${y(lower)} Z`} fill={color} opacity="0.08"/>}<path d={stroked} fill="none" stroke={color} strokeLinecap="round" strokeWidth={outcome.id === item.id ? 2.8 : 1.7} opacity={focusOnly || outcome.id === item.id ? 1 : .7} strokeDasharray={!focusOnly && historyMode === 'quotes' ? [undefined, '8 4', '3 4', '12 4 3 4'][index % 4] : undefined} vectorEffect="non-scaling-stroke"/><circle cx={x(history.at(-1)!.at)} cy={y(history.at(-1)!.probability)} r="3.3" fill={color}/></g>
        })}</g>
        {hoverAt !== null && <line x1={x(hoverAt)} x2={x(hoverAt)} y1="12" y2={12 + plotHeight} stroke="#878b96" strokeDasharray="3 4"/>}
        {(size.width < 500 ? [0, .5, 1] : [0, .25, .5, .75, 1]).map((part) => <text key={part} x={8 + part * plotWidth} y={size.height - 7} textAnchor={part === 0 ? 'start' : part === 1 ? 'end' : 'middle'}>{tickLabel(start + part * duration, long, duration)}</text>)}
      </svg>
      {/* Index comes from the unfiltered list: taking it after the filter coloured
          the survivors 0..n while their own lines and the legend used the original
          positions, so the swatches disagreed with the chart whenever an outcome
          fell through to the shared palette. */}
      {hoverAt !== null && <div className="ch-chart-tooltip"><span>{tickLabel(hoverAt, long, duration)}</span>{plotted.map((item, index) => ({ item, index })).filter(({ item }) => item.priceHistory.length).map(({ item, index }) => {
        const inspectedHistory = item.priceHistory
        const closest = chartStyle === 'step'
          ? inspectedHistory.filter((point) => point.at <= hoverAt).at(-1)
          : inspectedHistory.reduce<(typeof inspectedHistory)[number] | undefined>((a, b) => !a || Math.abs(b.at - hoverAt) < Math.abs(a.at - hoverAt) ? b : a, undefined)
        // The placeholder, not the series' latest value: hovering left of a
        // series' first point used to report today's price as history.
        return <span key={item.id}><i style={{ background: colorFor(item, index) }}/>{item.label}<b>{closest ? centsLabel(closest.probability) : '—'}</b></span>
      })}</div>}
    </div>
    <div className="ch-chart-footer"><span>{simulation ? `${compact(displayMarket.volume.COOLA)} COOLA Vol.` : `${collateral === 'COOLA' ? dreamDexOnly(market)?.chainId === '50312' ? 'tUSDC' : 'Collateral' : collateral} ${historyMode === 'quotes' ? 'quote observations' : 'trade history'}`}</span><span className="ch-chart-close"><Clock3 size={12}/>{timeLabel(market.closesAt, long)}</span><div className="ch-chart-controls">
      <div role="group" aria-label="Chart style"><span>Chart</span>{(['line', 'step'] as const).map((value) => <button type="button" key={value} aria-pressed={chartStyle === value} onClick={() => setStyleOverride({ id: market.id, style: value })}>{value === 'line' ? 'Line' : 'Step'}</button>)}</div>
      <div role="group" aria-label="Chart price scale"><span>Scale</span>{(['focus', 'full'] as const).map((value) => <button type="button" key={value} aria-pressed={scale === value} onClick={() => setScale(value)}>{value === 'focus' ? 'Focus' : '0–100¢'}</button>)}</div>
    </div><div className="ch-chart-range" aria-label="Chart time range">{(long ? ['1D', '1W', 'ALL'] : ['1M', '5M', '15M', 'ALL']).map((value) => <button aria-pressed={range === value} key={value} aria-label={value === 'ALL' && !simulation && historyMode === 'quotes' ? 'All quotes recorded in this browser' : undefined} onClick={() => setRange(value)}>{value}</button>)}</div></div></>}
  </div>
}
