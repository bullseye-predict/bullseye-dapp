import { Radio } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import type { ArenaPricePoint } from '../solz/model'
import type { PriceBasis } from '../../../packages/prediction-core/pricing'

/** A market price chart that is told what to draw.
 *
 *  The component it replaced decided for itself: one prop, `focusOnly`, chose
 *  the series list AND the colour AND legend-versus-headline AND the y-scale,
 *  so a binary market could only ever show one of its two sides and a
 *  twelve-answer event could only show a cap of four. Every one of those is now
 *  a separate decision made by the caller, which is why both sides of a
 *  head-to-head and every answer of a field can be on screen at once.
 */
export type ProbabilitySeries = {
  id: string
  label: string
  /** Explicit, because tone-0..tone-3 was a four-colour palette and a field can
   *  have twelve answers. */
  color: string
  points: readonly ArenaPricePoint[]
  /** The live book price from the shared rule, which is NOT the last point of
   *  the series — that is the whole reason the headline used to disagree with
   *  the row above it. */
  price?: number
  basis?: PriceBasis
  status?: 'ready' | 'pending' | 'unavailable'
  /** True when `points` are live sampled quotes rather than executed trades —
   *  the fallback a market uses before it has traded. Says so on the chart
   *  rather than passing one off as the other. */
  sampled?: boolean
  /** Thicker stroke plus the area fill. */
  emphasis?: boolean
}

export type ChartRange = '1H' | '6H' | '1D' | '1W' | 'ALL'
type ChartScale = 'focus' | 'full'

type Props = {
  title: string
  series: readonly ProbabilitySeries[]
  /** Rendered above the plot, Polymarket-style: "62% chance".
   *
   *  A chart of ONE market reads as a chance. A chart of twelve independent
   *  answers does not — singling one out in the headline says nothing about the
   *  eleven other lines on screen, so a field passes `volume` instead, which is
   *  the fact that describes the whole chart. */
  headline?: { label: string; chance?: number } | { label: string; volume: string }
  legend?: boolean
  scale?: ChartScale
  /** A field of independent books is priced in cents; a single market's two
   *  complementary sides are a probability. See the note in the caller. */
  unit?: 'percent' | 'cents'
  footer?: ReactNode
  /** Which venue and cluster this history came from, e.g. "SOLANA DEVNET".
   *  A chart that does not say where its numbers are from invites a reader to
   *  assume mainnet. */
  source?: string
  onSelect?: (id: string) => void
  /** Shown when nothing has any points. */
  empty?: { title: string; hint: string; loading?: boolean }
}

type PlottedPoint = ArenaPricePoint & { x: number; y: number }

const DEFAULT_HEIGHT = 304
const DEFAULT_WIDTH = 860
/** Six, because a twelve-answer field would stack 360px of end labels into a
 *  304px canvas and collapse every one of them. The rest stay in the legend. */
const LABEL_LIMIT = 6
const RANGE_MS: Record<ChartRange, number> = {
  '1H': 3_600_000,
  '6H': 21_600_000,
  '1D': 86_400_000,
  '1W': 604_800_000,
  ALL: Number.POSITIVE_INFINITY,
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))
const percent = (value: number) => `${Math.round(clamp01(value) * 100)}%`
const cents = (value: number) => {
  const c = clamp01(value) * 100
  return `${Number.isInteger(c) ? c : Number(c.toFixed(1))}¢`
}
const timeLabel = (value: number) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** A y-domain that shows the move without lying about the scale. A permanent
 *  0-100 axis flattens every real move on a market that trades in a ten-point
 *  band; a domain fitted exactly to the data exaggerates noise. The 20-point
 *  floor is the compromise. */
export function focusedDomain(values: readonly number[]): [number, number] {
  if (values.length === 0) return [0, 1]
  const observedLow = Math.min(...values)
  const observedHigh = Math.max(...values)
  const observedSpan = Math.max(0.08, observedHigh - observedLow)
  const padding = Math.max(0.025, observedSpan * 0.18)
  let low = Math.floor((observedLow - padding) * 20) / 20
  let high = Math.ceil((observedHigh + padding) * 20) / 20
  if (high - low < 0.2) {
    const middle = (high + low) / 2
    low = middle - 0.1
    high = middle + 0.1
  }
  if (low < 0) { high = Math.min(1, high - low); low = 0 }
  if (high > 1) { low = Math.max(0, low - (high - 1)); high = 1 }
  return [Math.max(0, low), Math.min(1, high)]
}

/** A stored point is a CHANGE, so the price between two of them is the earlier
 *  one. Without carrying forward, a market that has not moved has no horizontal
 *  extent at all, and series of different length end at different x.
 *
 *  Note what this does NOT do: invent a point to the LEFT of the first
 *  observation. The chart this replaced widened its own window past the data and
 *  then refused to anchor to it, so every line began a third of the way across
 *  an empty plot. A window never starts earlier than the data it has. */
export function windowPoints(points: readonly ArenaPricePoint[], start: number, end: number): ArenaPricePoint[] {
  if (points.length === 0) return []
  const carried = points.filter(point => point.at <= start).at(-1)
  const inside = points.filter(point => point.at > start && point.at <= end)
  const windowed = carried ? [{ at: start, probability: carried.probability }, ...inside] : inside
  const last = windowed.at(-1)
  return last && last.at < end ? [...windowed, { at: end, probability: last.probability }] : windowed
}

function stepPath(points: readonly PlottedPoint[]) {
  if (points.length === 0) return ''
  return points.slice(1).reduce(
    (path, point) => `${path} H ${point.x.toFixed(2)} V ${point.y.toFixed(2)}`,
    `M ${points[0]!.x.toFixed(2)} ${points[0]!.y.toFixed(2)}`,
  )
}

const nearestPoint = (points: readonly ArenaPricePoint[], at: number) =>
  points.reduce<ArenaPricePoint | null>((nearest, point) => (
    !nearest || Math.abs(point.at - at) < Math.abs(nearest.at - at) ? point : nearest
  ), null)

const shortLabel = (label: string, width: number) => {
  const limit = width < 520 ? 10 : 18
  return label.length > limit ? `${label.slice(0, limit - 1)}…` : label
}

export function ProbabilityChart({ title, series, headline, legend = true, scale: initialScale, unit = 'percent', footer, source, onSelect, empty }: Props) {
  const [range, setRange] = useState<ChartRange>('ALL')
  // More than two independent books on a fitted domain is unreadable; two
  // complementary sides on a full domain waste most of the plot.
  const [scale, setScale] = useState<ChartScale>(initialScale ?? (series.length > 2 ? 'full' : 'focus'))
  const [canvasWidth, setCanvasWidth] = useState(DEFAULT_WIDTH)
  const [canvasHeight, setCanvasHeight] = useState(DEFAULT_HEIGHT)
  const [inspectionAt, setInspectionAt] = useState<number | null>(null)
  // A legend chip hides and shows its own line. Twelve lines at once is a
  // thicket, and the chip previously only ever selected — there was no way to
  // take a line off the plot again. Visibility is the chart's own business, so
  // it stays local: hiding a line must not move the trade ticket.
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set())
  const visible = useMemo(() => series.filter(item => !hidden.has(item.id)), [series, hidden])
  const toggle = (id: string) => setHidden(current => {
    const next = new Set(current)
    // Never hide the last line: an empty plot is not a view of anything.
    if (next.has(id)) next.delete(id)
    else if (series.length - next.size > 1) next.add(id)
    return next
  })
  const canvasRef = useRef<HTMLDivElement>(null)
  const gradientPrefix = `pc-fill-${useId().replaceAll(':', '')}`
  const inspectionId = `pc-inspect-${useId().replaceAll(':', '')}`
  const label = unit === 'cents' ? cents : percent
  const endLabels = !legend

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

  const chart = useMemo(() => {
    const allTimestamps = visible.flatMap(item => item.points.map(point => point.at))
    if (allTimestamps.length === 0) return null
    const dataFirst = Math.min(...allTimestamps)
    const dataLast = Math.max(...allTimestamps)
    // The window never reaches past the data. A named range narrows it; ALL is
    // the data's own span. Widening beyond the first observation is what put an
    // empty third on the left of every line in the chart this replaces.
    const span = RANGE_MS[range]
    const start = Number.isFinite(span) ? Math.max(dataFirst, dataLast - span) : dataFirst
    const end = dataLast
    const rows = visible
      .map(item => ({ item, points: windowPoints(item.points, start, end) }))
      .filter(row => row.points.length > 0)
    if (rows.length === 0) return null
    const timestamps = [...new Set(rows.flatMap(row => row.points.map(point => point.at)))].sort((a, b) => a - b)
    const timeSpan = Math.max(1, end - start)
    const gutter = canvasWidth < 520 ? 44 : 54
    const plot = {
      // The left gutter holds the y-axis labels, which sit at `left - 8`.
      left: gutter,
      // Symmetric with it. The right gutter exists only to hold end labels, and
      // when a legend already names every line — same name, same price, same
      // colour — the labels are that fact printed twice. Without them the right
      // side matches the left rather than running the plot into the panel edge.
      right: endLabels ? (canvasWidth < 520 ? 94 : 124) : gutter,
      top: 18,
      bottom: 30,
    }
    const plotRight = canvasWidth - plot.right
    const plotBottom = canvasHeight - plot.bottom
    const plotWidth = Math.max(160, plotRight - plot.left)
    const values = rows.flatMap(row => row.points.map(point => point.probability))
    const [domainLow, domainHigh] = scale === 'full' ? [0, 1] : focusedDomain(values)
    const domainSpan = Math.max(0.001, domainHigh - domainLow)
    const plotHeight = plotBottom - plot.top
    const yFor = (probability: number) => plot.top + ((domainHigh - probability) / domainSpan) * plotHeight
    const base = rows.map(row => {
      const plotted = row.points.map<PlottedPoint>(point => ({
        ...point,
        // A single observation has no span to place it in, so it sits mid-plot
        // rather than pretending to be the start or the end of something.
        x: timeSpan === 1 || row.points.length === 1 && timestamps.length === 1
          ? plot.left + plotWidth / 2
          : plot.left + ((point.at - start) / timeSpan) * plotWidth,
        y: yFor(point.probability),
      }))
      const line = stepPath(plotted)
      const area = plotted.length === 0 ? ''
        : `${line} L ${plotted.at(-1)!.x.toFixed(2)} ${plotBottom.toFixed(2)} L ${plotted[0]!.x.toFixed(2)} ${plotBottom.toFixed(2)} Z`
      return { ...row, plotted, line, area, labelY: plotted.at(-1)?.y ?? plot.top }
    })

    // Emphasised series keep their label; the rest compete on current price.
    const labelled = !endLabels ? new Set<string>() : new Set(
      [...base]
        .sort((a, b) => Number(Boolean(b.item.emphasis)) - Number(Boolean(a.item.emphasis))
          || (b.plotted.at(-1)?.probability ?? 0) - (a.plotted.at(-1)?.probability ?? 0))
        .slice(0, LABEL_LIMIT)
        .map(row => row.item.id),
    )
    const stacked: Array<{ id: string; y: number }> = []
    for (const row of [...base].filter(row => labelled.has(row.item.id)).sort((a, b) => a.labelY - b.labelY)) {
      stacked.push({ id: row.item.id, y: Math.max(row.labelY, (stacked.at(-1)?.y ?? plot.top - 18) + 30) })
    }
    const overflow = Math.max(0, (stacked.at(-1)?.y ?? 0) - (plotBottom - 11))
    const positions = Object.fromEntries(stacked.map(entry => [entry.id, entry.y - overflow]))
    const guides = Array.from({ length: 5 }, (_, index) => domainHigh - ((domainHigh - domainLow) * index) / 4)

    return {
      start, end, timestamps, guides, plot, plotRight, plotBottom, domainLow, domainHigh,
      series: base.map(row => ({ ...row, labelY: positions[row.item.id], labelled: labelled.has(row.item.id) })),
    }
  }, [canvasHeight, canvasWidth, range, scale, visible, endLabels])

  const loading = empty?.loading || visible.some(item => item.status === 'pending')
  const inspected = chart && inspectionAt != null
    ? chart.series.map(row => ({ item: row.item, point: nearestPoint(row.points, inspectionAt) })).filter(row => row.point)
    : []
  const inspectedAt = inspected[0]?.point?.at ?? null
  const inspectedX = chart && inspectedAt != null
    ? chart.plot.left + ((inspectedAt - chart.start) / Math.max(1, chart.end - chart.start)) * (chart.plotRight - chart.plot.left)
    : null

  const inspectClientX = (clientX: number) => {
    const canvas = canvasRef.current
    if (!canvas || !chart) return
    const bounds = canvas.getBoundingClientRect()
    const svgX = ((clientX - bounds.left) / Math.max(1, bounds.width)) * canvasWidth
    const ratio = clamp01((svgX - chart.plot.left) / Math.max(1, chart.plotRight - chart.plot.left))
    const requestedAt = chart.start + ratio * (chart.end - chart.start)
    setInspectionAt(chart.timestamps.reduce((nearest, at) => Math.abs(at - requestedAt) < Math.abs(nearest - requestedAt) ? at : nearest, chart.timestamps[0]!))
  }

  const inspectWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!chart || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const currentIndex = inspectionAt == null ? chart.timestamps.length - 1 : Math.max(0, chart.timestamps.indexOf(inspectionAt))
    const nextIndex = event.key === 'Home' ? 0
      : event.key === 'End' ? chart.timestamps.length - 1
        : Math.max(0, Math.min(chart.timestamps.length - 1, currentIndex + (event.key === 'ArrowRight' ? 1 : -1)))
    setInspectionAt(chart.timestamps[nextIndex]!)
  }

  return (
    <section className="market-chart probability-chart" aria-label={`${title} price chart`}>
      <header className="market-chart-header">
        <div>
          {/* Source first, and it says "awaiting prices" rather than staying
              silent: an empty chart under an unlabelled header reads as a
              broken chart on mainnet, not as a market that has not traded on
              devnet yet. */}
          {(source || !chart) && <span className="ch-simulation">{source && chart ? source : `${source ? `${source} · ` : ''}AWAITING PRICES`}</span>}
          {headline && <>
            {/* Polymarket's reading, and the live book price rather than the
                last point of whichever series is drawn. The two are different
                numbers, and printing one under the other's label is what made
                a chart say "12¢" beneath a row quoting 20¢. */}
            <strong className="pc-headline">{'volume' in headline
              ? headline.volume
              : headline.chance === undefined ? 'No price yet' : `${percent(headline.chance)} chance`}</strong>
            <small>{headline.label}</small>
          </>}
        </div>
        <div className="market-chart-controls">
          <div className="market-chart-scale" role="group" aria-label="Chart price scale">
            {(['focus', 'full'] as ChartScale[]).map(value => (
              <button type="button" key={value} className={scale === value ? 'active' : ''} onClick={() => setScale(value)} aria-pressed={scale === value}>{value === 'focus' ? 'Focus' : '0–100'}</button>
            ))}
          </div>
          <div className="market-chart-range" role="group" aria-label="Chart time range">
            {(Object.keys(RANGE_MS) as ChartRange[]).map(value => (
              <button type="button" key={value} className={range === value ? 'active' : ''} onClick={() => setRange(value)} aria-pressed={range === value}>{value}</button>
            ))}
          </div>
        </div>
      </header>

      {legend && <div className="market-chart-legend" aria-label="Chart series">
        {series.map(item => (
          <button type="button" key={item.id}
            className={`${item.emphasis ? 'selected' : ''} ${hidden.has(item.id) ? 'is-hidden' : ''}`}
            style={{ color: item.color }}
            onClick={() => { toggle(item.id); onSelect?.(item.id) }}
            aria-pressed={!hidden.has(item.id)}
            title={hidden.has(item.id) ? `Show ${item.label}` : `Hide ${item.label}`}>
            <i aria-hidden="true" /><span>{item.label}</span>
            <b>{item.price === undefined ? '—' : label(item.price)}</b>
          </button>
        ))}
      </div>}

      <div
        className={`market-chart-canvas ${loading ? 'collecting' : ''}`}
        ref={canvasRef}
        tabIndex={chart ? 0 : -1}
        onPointerMove={(event: PointerEvent<HTMLDivElement>) => inspectClientX(event.clientX)}
        onPointerDown={(event: PointerEvent<HTMLDivElement>) => inspectClientX(event.clientX)}
        onPointerLeave={() => setInspectionAt(null)}
        onKeyDown={inspectWithKeyboard}
        onFocus={() => { if (chart && inspectionAt == null) setInspectionAt(chart.end) }}
        onBlur={() => setInspectionAt(null)}
        aria-label={chart ? 'Interactive price chart. Use left and right arrow keys to inspect points.' : undefined}
        aria-describedby={chart ? inspectionId : undefined}
      >
        {chart ? (
          <>
            <svg viewBox={`0 0 ${canvasWidth} ${canvasHeight}`} role="img" aria-label={`Price history for ${chart.series.map(row => `${row.item.label}, ${label(row.plotted.at(-1)?.probability ?? 0)}`).join('; ')}`}>
              <title>{`${title} price history`}</title>
              <defs>
                {chart.series.filter(row => row.item.emphasis).map(row => (
                  <linearGradient key={row.item.id} id={`${gradientPrefix}-${row.item.id}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor={row.item.color} stopOpacity="0.18" />
                    <stop offset="1" stopColor={row.item.color} stopOpacity="0" />
                  </linearGradient>
                ))}
              </defs>
              {Array.from({ length: 5 }, (_, index) => {
                const x = chart.plot.left + ((chart.plotRight - chart.plot.left) * index) / 4
                return <line key={index} className="market-chart-vertical-guide" x1={x} x2={x} y1={chart.plot.top} y2={chart.plotBottom} />
              })}
              {chart.guides.map(value => {
                const y = chart.plot.top + ((chart.domainHigh - value) / Math.max(0.001, chart.domainHigh - chart.domainLow)) * (chart.plotBottom - chart.plot.top)
                return <g key={value} className="market-chart-guide"><line x1={chart.plot.left} x2={chart.plotRight} y1={y} y2={y} /><text x={chart.plot.left - 8} y={y + 3}>{label(value)}</text></g>
              })}
              {chart.series.map(row => {
                const lastPoint = row.plotted.at(-1)
                return (
                  <g key={row.item.id} className={`market-chart-series ${row.item.emphasis ? 'selected' : ''}`} style={{ color: row.item.color }}>
                    {row.item.emphasis && row.plotted.length > 1 && <path className="market-chart-area" d={row.area} fill={`url(#${gradientPrefix}-${row.item.id})`} />}
                    {/* A lone moveto is never stroked, so a single observation
                        gets a zero-length lineto: under a round cap that paints
                        the dot the subpath is meant to be. */}
                    <path className="market-chart-line" d={row.plotted.length > 1 ? row.line : `${row.line} L ${row.plotted[0]!.x.toFixed(2)} ${row.plotted[0]!.y.toFixed(2)}`}
                      style={{ strokeWidth: row.item.emphasis ? 2.6 : 1.6, opacity: row.item.emphasis ? 1 : .8 }} />
                    {lastPoint && <>
                      <circle className="market-chart-last" cx={lastPoint.x} cy={lastPoint.y} r={row.item.emphasis ? 4 : 3} />
                      {row.labelled && row.labelY !== undefined && <>
                        <path className="market-chart-end-link" d={`M ${lastPoint.x} ${lastPoint.y} L ${chart.plotRight + 5} ${row.labelY}`} />
                        <text className="market-chart-end-name" x={chart.plotRight + 10} y={row.labelY - 3}>{shortLabel(row.item.label, canvasWidth)}</text>
                        <text className="market-chart-end-price" x={chart.plotRight + 10} y={row.labelY + 11}>{label(lastPoint.probability)}</text>
                      </>}
                    </>}
                  </g>
                )
              })}
              {inspectedX != null && <g className="market-chart-crosshair"><line x1={inspectedX} x2={inspectedX} y1={chart.plot.top} y2={chart.plotBottom} /></g>}
              <g className="market-chart-time"><text x={chart.plot.left} y={canvasHeight - 7}>{timeLabel(chart.start)}</text><text x={chart.plotRight} y={canvasHeight - 7} textAnchor="end">{timeLabel(chart.end)}</text></g>
            </svg>
            <span className="market-chart-domain">{visible.some(item => item.sampled) ? 'SAMPLED BOOK' : 'EXECUTED TRADES'} · {scale === 'focus' ? `FOCUS ${label(chart.domainLow)}–${label(chart.domainHigh)}` : `FULL 0–${label(1)}`}</span>
            {inspectedAt != null && (
              <div className="market-chart-tooltip" style={{ left: `${Math.max(74, Math.min(canvasWidth - 74, inspectedX ?? 0)) / canvasWidth * 100}%` }}>
                <time>{timeLabel(inspectedAt)}</time>
                {inspected.map(row => <span key={row.item.id} style={{ color: row.item.color }}><i />{shortLabel(row.item.label, canvasWidth)} <b>{label(row.point?.probability ?? 0)}</b></span>)}
              </div>
            )}
            <p id={inspectionId} className="sr-only">{inspectedAt == null ? 'Latest prices shown at the end of each line.' : `${timeLabel(inspectedAt)}. ${inspected.map(row => `${row.item.label} ${label(row.point?.probability ?? 0)}`).join(', ')}.`}</p>
          </>
        ) : (
          <div className="market-chart-empty">
            <strong>{empty?.title ?? 'No price history yet'}</strong>
            <span>{empty?.hint ?? 'The chart starts when this market records its first price.'}</span>
          </div>
        )}
        {loading && <div className="market-chart-collecting" role="status"><Radio size={14} aria-hidden="true" /><span><strong>Collecting price history</strong> No synthetic history is added.</span></div>}
      </div>
      {footer && <div className="market-chart-footer">{footer}</div>}
    </section>
  )
}
