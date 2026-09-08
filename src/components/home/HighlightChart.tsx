import { useEffect, useId, useRef, useState } from 'react'
import { Clock3 } from 'lucide-react'
import type { ArenaMarket, ArenaMarketOutcome, SolzSnapshot } from '../solz/model'
import { compact, percent } from './HomePrimitives'
import { resolvePredictionContract } from '../solz/predictionContracts'
import { outcomeColor } from './heroMarket'

type Props = {
  market: ArenaMarket; snapshot: SolzSnapshot; outcome: ArenaMarketOutcome
  onOutcome: (outcome: ArenaMarketOutcome) => void
  colors?: Record<string, string>; referenceMarket?: ArenaMarket; focusOnly?: boolean
  simulation?: boolean; dates?: ArenaMarket[]; onMarket: (market: ArenaMarket) => void
}
const timeLabel = (at: number, long: boolean) => new Date(at).toLocaleString('en', long ? { month: 'short', day: 'numeric' } : { hour: '2-digit', minute: '2-digit', hour12: false })

export function HighlightChart({ market, snapshot, outcome, onOutcome, dates, onMarket, simulation = true, colors, referenceMarket, focusOnly = false }: Props) {
  const displayMarket = !simulation && referenceMarket ? referenceMarket : market
  const focus = resolvePredictionContract(displayMarket, outcome.id) ?? outcome
  const series = focusOnly ? [focus] : displayMarket.outcomes
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
  }, [simulation])
  const plotWidth = Math.max(1, size.width - 44)
  const plotHeight = Math.max(1, size.height - 40)
  const windows: Record<string, number> = { '1M': 60_000, '5M': 300_000, '15M': 900_000, '1D': 86_400_000, '1W': 604_800_000, ALL: Infinity }
  const end = Math.max(...series.flatMap((item) => item.priceHistory?.map((point) => point.at) ?? [snapshot.updatedAt]))
  const allStart = Math.min(...series.flatMap((item) => item.priceHistory?.map((point) => point.at) ?? [end - 60_000]))
  const start = Math.max(allStart, end - (windows[range] ?? Infinity))
  const duration = Math.max(1, end - start)
  const visibleProbabilities = series.flatMap((item) => [item.probability, ...(item.priceHistory ?? []).filter((point) => point.at >= start).map((point) => point.probability)])
  const minimum = Math.min(...visibleProbabilities), maximum = Math.max(...visibleProbabilities)
  const padding = Math.max(.025, (maximum - minimum) * .15)
  const lower = scale === 'focus' ? Math.max(0, Math.floor((minimum - padding) * 20) / 20) : 0
  const upper = scale === 'focus' ? Math.min(1, Math.ceil((maximum + padding) * 20) / 20) : 1
  const x = (at: number) => 8 + (at - start) / duration * plotWidth
  const y = (p: number) => 12 + (upper - p) / Math.max(.05, upper - lower) * plotHeight
  const hoverAt = hover === null ? null : start + hover * duration
  const colorFor = (item: ArenaMarketOutcome, index: number) => colors?.[item.id] ?? (focusOnly ? '#51b6ff' : outcomeColor(item, snapshot, index))
  return <div className="ch-chart" aria-label={`${market.title} ${focusOnly ? focus.label : 'all outcomes'} ${simulation ? 'simulated' : 'reference'} probability chart`}>
    <div className="ch-chart-heading"><span className="ch-simulation">{simulation ? 'SIMULATION' : 'REFERENCE SAMPLE'}</span><span>{focusOnly ? 'OUTCOME GRAPH' : 'MARKET OVERVIEW'}</span>{long && <span className="ch-long-label">SEASON PREDICTION</span>}</div>
    {dates && <div className="ch-date-tabs" aria-label="Prediction closing date">{dates.map((item) => <button key={item.id} aria-pressed={market.id === item.id} onClick={() => { setRange('ALL'); onMarket(item) }}>{timeLabel(item.closesAt, true)}</button>)}</div>}
    {!focusOnly && <h2>{market.title}</h2>}
    {focusOnly && <div className="ch-chart-focus"><strong>{percent(focus.probability)} chance</strong><span>{focus.label}</span></div>}
    {!focusOnly && <div className="ch-chart-legend">{series.map((item, index) => <button key={item.id} aria-pressed={outcome.id === item.id} onClick={() => onOutcome(item)}><i style={{ background: colorFor(item, index) }}/><span>{item.label}</span><b>{percent(item.probability)}</b></button>)}</div>}
    <div className="ch-chart-controls">
      <div role="group" aria-label="Chart style"><span>Chart</span>{(['line', 'step'] as const).map((value) => <button type="button" key={value} aria-pressed={chartStyle === value} onClick={() => setChartStyle(value)}>{value === 'line' ? 'Line' : 'Step'}</button>)}</div>
      <div role="group" aria-label="Chart probability scale"><span>Scale</span>{(['focus', 'full'] as const).map((value) => <button type="button" key={value} aria-pressed={scale === value} onClick={() => setScale(value)}>{value === 'focus' ? 'Focus' : '0–100%'}</button>)}</div>
      <span className="ch-chart-domain">{scale === 'focus' ? `Focus ${percent(lower)}–${percent(upper)}` : 'Full 0–100%'}</span>
    </div>
    <div className="ch-plot" ref={plot} onPointerMove={(event) => { const box = event.currentTarget.getBoundingClientRect(); setHover(Math.max(0, Math.min(1, (event.clientX - box.left - 8) / plotWidth))) }} onPointerLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${size.width} ${size.height}`} preserveAspectRatio="none" role="img" aria-label={`Probability history for ${series.map((item) => `${item.label}, ${percent(item.probability)}`).join('; ')}`}>
        <defs><clipPath id={clipId}><rect x="5" y="8" width={plotWidth + 6} height={plotHeight + 8}/></clipPath></defs>
        {(size.height < 130 ? [1, .5, 0] : [1, .75, .5, .25, 0]).map((part) => { const p = lower + part * (upper - lower); return <g key={part}><line className="ch-grid-line" x1="8" x2={8 + plotWidth} y1={y(p)} y2={y(p)}/><text x={size.width - 27} y={y(p) + 4}>{Math.round(p * 100)}%</text></g> })}
        <g clipPath={`url(#${clipId})`}>{series.map((item, index) => {
          const history = item.priceHistory ?? [{ at: start, probability: item.probability }, { at: end, probability: item.probability }]
          const color = colorFor(item, index)
          const path = history.map((point, i) => i && chartStyle === 'step'
            ? `H${x(point.at).toFixed(2)} V${y(point.probability).toFixed(2)}`
            : `${i ? 'L' : 'M'}${x(point.at).toFixed(2)},${y(point.probability).toFixed(2)}`).join(' ')
          return <g key={item.id}>{chartStyle === 'step' && outcome.id === item.id && history.length > 0 && <path d={`${path} L${x(history[history.length - 1].at)},${y(lower)} L${x(history[0].at)},${y(lower)} Z`} fill={color} opacity="0.08"/>}<path d={path} fill="none" stroke={color} strokeWidth={outcome.id === item.id ? 2.4 : 1.7} vectorEffect="non-scaling-stroke"/><circle cx={x(end)} cy={y(item.probability)} r="3.3" fill={color}/></g>
        })}</g>
        {hoverAt !== null && <line x1={x(hoverAt)} x2={x(hoverAt)} y1="12" y2={12 + plotHeight} stroke="#878b96" strokeDasharray="3 4"/>}
        {(size.width < 500 ? [0, .5, 1] : [0, .25, .5, .75, 1]).map((part) => <text key={part} x={8 + part * plotWidth} y={size.height - 7} textAnchor={part === 0 ? 'start' : part === 1 ? 'end' : 'middle'}>{timeLabel(start + part * duration, long)}</text>)}
      </svg>
      {hoverAt !== null && <div className="ch-chart-tooltip"><span>{timeLabel(hoverAt, long)}</span>{series.map((item, index) => {
        const inspectedHistory = item.priceHistory ?? []
        const closest = chartStyle === 'step'
          ? inspectedHistory.filter((point) => point.at <= hoverAt).at(-1)
          : inspectedHistory.reduce<(typeof inspectedHistory)[number] | undefined>((a, b) => !a || Math.abs(b.at - hoverAt) < Math.abs(a.at - hoverAt) ? b : a, undefined)
        return <span key={item.id}><i style={{ background: colorFor(item, index) }}/>{item.label}<b>{percent(closest?.probability ?? item.probability)}</b></span>
      })}</div>}
    </div>
    <div className="ch-chart-footer"><span>{compact(displayMarket.volume.COOLA)} COOLA Vol.</span><span className="ch-chart-close"><Clock3 size={12}/>{timeLabel(market.closesAt, long)}</span><div aria-label="Chart time range">{(long ? ['1D', '1W', 'ALL'] : ['1M', '5M', '15M', 'ALL']).map((value) => <button aria-pressed={range === value} key={value} onClick={() => setRange(value)}>{value}</button>)}</div></div>
  </div>
}
