import { ChartNoAxesCombined, Radio } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { ArenaMarket, ArenaMarketOutcome, ArenaMode, ArenaPricePoint, SettlementToken } from './model'

type ChartRange = '5m' | '15m' | 'all'
type ChartScale = 'focus' | 'full'

type Props = {
  market: ArenaMarket
  outcome: ArenaMarketOutcome
  mode: ArenaMode
  token: SettlementToken
  onOutcome: (outcome: ArenaMarketOutcome) => void
}

type PlottedPoint = ArenaPricePoint & { x: number; y: number }

type SeriesGeometry = {
  outcome: ArenaMarketOutcome
  points: ArenaPricePoint[]
  plotted: PlottedPoint[]
  line: string
  area: string
  labelY: number
}

const DEFAULT_HEIGHT = 304
const DEFAULT_WIDTH = 860
const RANGE_MS: Record<ChartRange, number> = {
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  all: Number.POSITIVE_INFINITY,
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`
}

function signedPoints(value: number) {
  const points = value * 100
  return `${points >= 0 ? '+' : ''}${points.toFixed(1)} pts`
}

function compactAmount(value: number, token: SettlementToken) {
  return `${new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value)} ${token}`
}

function timeLabel(value: number) {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function filterPoints(outcome: ArenaMarketOutcome, range: ChartRange, latestAt: number) {
  const rawPoints = outcome.priceHistory ?? []
  if (rawPoints.length === 0) return []
  const cutoff = latestAt - RANGE_MS[range]
  const filtered = rawPoints.filter((point) => point.at >= cutoff)
  return filtered.length > 0 ? filtered : rawPoints.slice(-1)
}

function focusedDomain(values: number[]): [number, number] {
  if (values.length === 0) return [0, 1]
  const observedLow = Math.min(...values)
  const observedHigh = Math.max(...values)
  const observedSpan = Math.max(0.08, observedHigh - observedLow)
  const padding = Math.max(0.025, observedSpan * 0.18)
  let low = Math.floor((observedLow - padding) * 20) / 20
  let high = Math.ceil((observedHigh + padding) * 20) / 20

  // A 20-point minimum preserves honest context while still exposing moves that disappear on a permanent 0–100 scale.
  if (high - low < 0.2) {
    const middle = (high + low) / 2
    low = middle - 0.1
    high = middle + 0.1
  }
  if (low < 0) {
    high = Math.min(1, high - low)
    low = 0
  }
  if (high > 1) {
    low = Math.max(0, low - (high - 1))
    high = 1
  }
  return [Math.max(0, low), Math.min(1, high)]
}

function stepPath(points: PlottedPoint[]) {
  if (points.length === 0) return ''
  return points.slice(1).reduce(
    (path, point) => `${path} H ${point.x.toFixed(2)} V ${point.y.toFixed(2)}`,
    `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`,
  )
}

function nearestPoint(points: ArenaPricePoint[], at: number) {
  return points.reduce<ArenaPricePoint | null>((nearest, point) => (
    !nearest || Math.abs(point.at - at) < Math.abs(nearest.at - at) ? point : nearest
  ), null)
}

function shortLabel(label: string, width: number) {
  const limit = width < 520 ? 10 : 18
  return label.length > limit ? `${label.slice(0, limit - 1)}…` : label
}

export function MarketProbabilityChart({ market, outcome, mode, token, onOutcome }: Props) {
  const [range, setRange] = useState<ChartRange>('5m')
  const [scale, setScale] = useState<ChartScale>('focus')
  const [canvasWidth, setCanvasWidth] = useState(DEFAULT_WIDTH)
  const [canvasHeight, setCanvasHeight] = useState(DEFAULT_HEIGHT)
  const [inspectionAt, setInspectionAt] = useState<number | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const gradientId = `market-fill-${useId().replaceAll(':', '')}`
  const inspectionId = `market-inspection-${useId().replaceAll(':', '')}`

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const updateSize = () => {
      const bounds = canvas.getBoundingClientRect()
      setCanvasWidth(Math.max(300, Math.round(bounds.width)))
      setCanvasHeight(Math.max(220, Math.round(bounds.height)))
    }
    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [])

  const visibleOutcomes = useMemo(() => {
    const ranked = [...market.outcomes].sort((left, right) => right.probability - left.probability)
    return [outcome, ...ranked.filter((item) => item.id !== outcome.id)].slice(0, 4)
  }, [market.outcomes, outcome])

  const chart = useMemo(() => {
    const allTimestamps = visibleOutcomes.flatMap((item) => (item.priceHistory ?? []).map((point) => point.at))
    if (allTimestamps.length === 0) return null
    const latestAt = Math.max(...allTimestamps)
    const rows = visibleOutcomes.map((item) => ({ outcome: item, points: filterPoints(item, range, latestAt) }))
    const timestamps = [...new Set(rows.flatMap((row) => row.points.map((point) => point.at)))].sort((left, right) => left - right)
    const firstAt = timestamps[0]
    const lastAt = timestamps.at(-1) ?? firstAt
    const timeSpan = Math.max(1, lastAt - firstAt)
    const plot = {
      left: canvasWidth < 520 ? 40 : 48,
      right: canvasWidth < 520 ? 94 : 132,
      top: 18,
      bottom: 30,
    }
    const plotRight = canvasWidth - plot.right
    const plotBottom = canvasHeight - plot.bottom
    const plotWidth = Math.max(160, plotRight - plot.left)
    const values = rows.flatMap((row) => row.points.map((point) => point.probability))
    const [domainLow, domainHigh] = scale === 'full' ? [0, 1] : focusedDomain(values)
    const domainSpan = Math.max(0.001, domainHigh - domainLow)
    const plotHeight = plotBottom - plot.top
    const yFor = (probability: number) => plot.top + ((domainHigh - probability) / domainSpan) * plotHeight
    const baseSeries = rows.map((row) => {
      const plotted = row.points.map<PlottedPoint>((point) => ({
        ...point,
        x: row.points.length === 1
          ? plot.left + plotWidth / 2
          : plot.left + ((point.at - firstAt) / timeSpan) * plotWidth,
        y: yFor(point.probability),
      }))
      const line = stepPath(plotted)
      const area = plotted.length === 0
        ? ''
        : `${line} L ${plotted.at(-1)?.x.toFixed(2)} ${plotBottom.toFixed(2)} L ${plotted[0].x.toFixed(2)} ${plotBottom.toFixed(2)} Z`
      return { ...row, plotted, line, area, labelY: plotted.at(-1)?.y ?? plot.top }
    })

    const labels: Array<{ id: string; y: number }> = []
    for (const row of [...baseSeries].sort((left, right) => left.labelY - right.labelY)) {
      labels.push({ id: row.outcome.id, y: Math.max(row.labelY, (labels.at(-1)?.y ?? plot.top - 18) + 30) })
    }
    const overflow = Math.max(0, (labels.at(-1)?.y ?? 0) - (plotBottom - 11))
    const labelPositions = Object.fromEntries(labels.map((label) => [label.id, label.y - overflow]))
    const series: SeriesGeometry[] = baseSeries.map((row) => ({ ...row, labelY: labelPositions[row.outcome.id] ?? row.labelY }))
    const guides = Array.from({ length: 5 }, (_, index) => domainHigh - ((domainHigh - domainLow) * index) / 4)

    return { firstAt, lastAt, timestamps, series, guides, plot, plotRight, plotBottom, domainLow, domainHigh }
  }, [canvasHeight, canvasWidth, range, scale, visibleOutcomes])

  const selectedPoints = useMemo(() => {
    if (!chart) return []
    return filterPoints(outcome, range, chart.lastAt)
  }, [chart, outcome, range])
  const current = outcome.probability
  const first = selectedPoints[0]?.probability ?? current
  const high = selectedPoints.length > 0 ? Math.max(...selectedPoints.map((point) => point.probability)) : current
  const low = selectedPoints.length > 0 ? Math.min(...selectedPoints.map((point) => point.probability)) : current
  const delta = current - first
  const collecting = mode === 'live' && selectedPoints.length < 2
  const inspectedSeries = chart && inspectionAt != null
    ? chart.series.map((series) => ({ outcome: series.outcome, point: nearestPoint(series.points, inspectionAt) })).filter((row) => row.point)
    : []
  const inspectedAt = inspectedSeries[0]?.point?.at ?? null
  const inspectedX = chart && inspectedAt != null
    ? chart.plot.left + ((inspectedAt - chart.firstAt) / Math.max(1, chart.lastAt - chart.firstAt)) * (chart.plotRight - chart.plot.left)
    : null

  const inspectClientX = (clientX: number) => {
    const canvas = canvasRef.current
    if (!canvas || !chart) return
    const bounds = canvas.getBoundingClientRect()
    const svgX = ((clientX - bounds.left) / Math.max(1, bounds.width)) * canvasWidth
    const ratio = Math.max(0, Math.min(1, (svgX - chart.plot.left) / Math.max(1, chart.plotRight - chart.plot.left)))
    const requestedAt = chart.firstAt + ratio * (chart.lastAt - chart.firstAt)
    const nearestAt = chart.timestamps.reduce((nearest, at) => Math.abs(at - requestedAt) < Math.abs(nearest - requestedAt) ? at : nearest, chart.timestamps[0])
    setInspectionAt(nearestAt)
  }

  const inspectWithPointer = (event: PointerEvent<HTMLDivElement>) => inspectClientX(event.clientX)
  const inspectWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!chart || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const currentIndex = inspectionAt == null ? chart.timestamps.length - 1 : Math.max(0, chart.timestamps.indexOf(inspectionAt))
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? chart.timestamps.length - 1
        : Math.max(0, Math.min(chart.timestamps.length - 1, currentIndex + (event.key === 'ArrowRight' ? 1 : -1)))
    setInspectionAt(chart.timestamps[nextIndex])
  }

  return (
    <section className="market-chart" aria-label={`${market.title} probability chart`}>
      <header className="market-chart-header">
        <div>
          <span><ChartNoAxesCombined size={15} aria-hidden="true" /> Probability market</span>
          <strong>{outcome.label}</strong>
          <small>{mode === 'demo' ? 'Normalized simulated order-book ticks' : 'Observed live ticks only'} · winning share pays 1 {token}</small>
        </div>
        <div className="market-chart-controls">
          <div className="market-chart-scale" role="group" aria-label="Chart probability scale">
            {(['focus', 'full'] as ChartScale[]).map((value) => (
              <button type="button" key={value} className={scale === value ? 'active' : ''} onClick={() => setScale(value)} aria-pressed={scale === value}>{value === 'focus' ? 'Focus' : '0–100'}</button>
            ))}
          </div>
          <div className="market-chart-range" role="group" aria-label="Chart time range">
            {(['5m', '15m', 'all'] as ChartRange[]).map((value) => (
              <button type="button" key={value} className={range === value ? 'active' : ''} onClick={() => setRange(value)} aria-pressed={range === value}>{value === 'all' ? 'ALL' : value.toUpperCase()}</button>
            ))}
          </div>
        </div>
      </header>

      <div className="market-chart-legend" aria-label="Visible chart series">
        {visibleOutcomes.map((item, index) => (
          <button type="button" key={item.id} className={`tone-${index} ${item.id === outcome.id ? 'selected' : ''}`} onClick={() => onOutcome(item)} aria-pressed={item.id === outcome.id}>
            <i aria-hidden="true" /><span>{item.label}</span><b>{percent(item.probability)}</b>
          </button>
        ))}
        {market.outcomes.length > visibleOutcomes.length && <span>+{market.outcomes.length - visibleOutcomes.length} in Series lines</span>}
      </div>

      <dl className="market-chart-stats">
        <div><dt>Mark price</dt><dd>{Math.round(current * 100)}¢ <small>{percent(current)}</small></dd></div>
        <div><dt>Change</dt><dd className={delta >= 0 ? 'positive' : 'negative'}>{signedPoints(delta)}</dd></div>
        <div><dt>High / low</dt><dd>{percent(high)} / {percent(low)}</dd></div>
        <div><dt>{token} volume</dt><dd>{compactAmount(market.volume[token], token)}</dd></div>
      </dl>

      <div
        className={`market-chart-canvas ${collecting ? 'collecting' : ''}`}
        ref={canvasRef}
        tabIndex={chart ? 0 : -1}
        onPointerMove={inspectWithPointer}
        onPointerDown={inspectWithPointer}
        onPointerLeave={() => setInspectionAt(null)}
        onKeyDown={inspectWithKeyboard}
        onFocus={() => { if (chart && inspectionAt == null) setInspectionAt(chart.lastAt) }}
        onBlur={() => setInspectionAt(null)}
        aria-label={chart ? 'Interactive probability chart. Use left and right arrow keys to inspect ticks.' : undefined}
        aria-describedby={chart ? inspectionId : undefined}
      >
        {chart ? (
          <>
            <svg viewBox={`0 0 ${canvasWidth} ${canvasHeight}`} role="img" aria-label={`${outcome.label} moved from ${percent(first)} to ${percent(current)}`}>
              <title>{market.title} probability history</title>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="var(--arena-accent)" stopOpacity="0.14" />
                  <stop offset="1" stopColor="var(--arena-accent)" stopOpacity="0" />
                </linearGradient>
              </defs>
              {Array.from({ length: 5 }, (_, index) => {
                const x = chart.plot.left + ((chart.plotRight - chart.plot.left) * index) / 4
                return <line key={index} className="market-chart-vertical-guide" x1={x} x2={x} y1={chart.plot.top} y2={chart.plotBottom} />
              })}
              {chart.guides.map((value) => {
                const y = chart.plot.top + ((chart.domainHigh - value) / Math.max(0.001, chart.domainHigh - chart.domainLow)) * (chart.plotBottom - chart.plot.top)
                return <g key={value} className="market-chart-guide"><line x1={chart.plot.left} x2={chart.plotRight} y1={y} y2={y} /><text x={chart.plot.left - 8} y={y + 3}>{percent(value)}</text></g>
              })}
              {chart.series.map((series, index) => {
                const lastPoint = series.plotted.at(-1)
                return (
                  <g key={series.outcome.id} className={`market-chart-series tone-${index} ${series.outcome.id === outcome.id ? 'selected' : ''}`}>
                    {series.outcome.id === outcome.id && series.plotted.length > 1 && <path className="market-chart-area" d={series.area} fill={`url(#${gradientId})`} />}
                    {series.plotted.length > 1 && <path className="market-chart-line" d={series.line} />}
                    {lastPoint && <>
                      <circle className="market-chart-last" cx={lastPoint.x} cy={lastPoint.y} r={series.outcome.id === outcome.id ? 4 : 3} />
                      <path className="market-chart-end-link" d={`M ${lastPoint.x} ${lastPoint.y} L ${chart.plotRight + 5} ${series.labelY}`} />
                      <text className="market-chart-end-name" x={chart.plotRight + 10} y={series.labelY - 3}>{shortLabel(series.outcome.label, canvasWidth)}</text>
                      <text className="market-chart-end-price" x={chart.plotRight + 10} y={series.labelY + 11}>{percent(lastPoint.probability)}</text>
                    </>}
                  </g>
                )
              })}
              {inspectedX != null && <g className="market-chart-crosshair"><line x1={inspectedX} x2={inspectedX} y1={chart.plot.top} y2={chart.plotBottom} /><circle cx={inspectedX} cy={chart.series[0]?.plotted.find((point) => point.at === inspectedAt)?.y ?? chart.plot.top} r="4" /></g>}
              <g className="market-chart-time"><text x={chart.plot.left} y={canvasHeight - 7}>{timeLabel(chart.firstAt)}</text><text x={chart.plotRight} y={canvasHeight - 7} textAnchor="end">{timeLabel(chart.lastAt)}</text></g>
            </svg>
            <span className="market-chart-domain">{scale === 'focus' ? `FOCUS ${percent(chart.domainLow)}–${percent(chart.domainHigh)}` : 'FULL 0–100%'}</span>
            {inspectedAt != null && (
              <div className="market-chart-tooltip" style={{ left: `${Math.max(74, Math.min(canvasWidth - 74, inspectedX ?? 0)) / canvasWidth * 100}%` }}>
                <time>{timeLabel(inspectedAt)}</time>
                {inspectedSeries.map((row, index) => <span className={`tone-${index}`} key={row.outcome.id}><i />{shortLabel(row.outcome.label, canvasWidth)} <b>{percent(row.point?.probability ?? 0)}</b></span>)}
              </div>
            )}
            <p id={inspectionId} className="sr-only">{inspectedAt == null ? `Latest price ${percent(current)}.` : `${timeLabel(inspectedAt)}. ${inspectedSeries.map((row) => `${row.outcome.label} ${percent(row.point?.probability ?? 0)}`).join(', ')}.`}</p>
          </>
        ) : (
          <div className="market-chart-empty"><ChartNoAxesCombined size={21} aria-hidden="true" /><strong>No price ticks yet</strong><span>The chart starts when this market publishes its first signal.</span></div>
        )}
        {collecting && <div className="market-chart-collecting" role="status"><Radio size={14} aria-hidden="true" /><span><strong>Collecting live ticks</strong> No synthetic history is added.</span></div>}
      </div>
    </section>
  )
}
