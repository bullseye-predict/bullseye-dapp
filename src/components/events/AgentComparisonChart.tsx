import { signedPercent, windowLabel, type AgentWindow } from './agentThinking'

/**
 * The agent's calls against what the market did. Each scheduled window is a
 * band across the parent assets' price lines; the strip under it names the
 * call and whether it held. The lines are the parent event's measured hourly
 * closes, as a percentage move from the left edge of the chart.
 */

export type ComparisonSeries = { symbol: string; color: string; points: [number, number][] }

const DAY_MS = 86_400_000
const CONTEXT_MS = 3 * DAY_MS
const W = 600, H = 180
const STATUS_LABEL: Record<AgentWindow['status'], string> = {
  scheduled: 'scheduled', locked: 'locked', running: 'in progress', awaiting: 'awaiting score', correct: 'correct', missed: 'missed', unpublished: 'no call',
}

export function AgentComparisonChart({ windows, series, now }: { windows: AgentWindow[]; series: ComparisonSeries[]; now: number }) {
  const first = windows[0], last = windows.at(-1)
  if (!first || !last) return null
  const times = series.flatMap(line => line.points.map(([t]) => t * 1000))
  const latestPoint = times.length ? Math.max(...times) : now
  // Three days of market before the first window, or before the newest
  // price when the schedule has not started yet, so both are on screen.
  const t0 = Math.min(first.startsAt, latestPoint) - CONTEXT_MS
  const t1 = last.endsAt
  const x = (t: number) => Math.max(0, Math.min(W, ((t - t0) / (t1 - t0)) * W))
  const lines = series.map(line => {
    const inView = line.points.filter(([t]) => t * 1000 >= t0 && t * 1000 <= t1)
    const base = inView[0]?.[1]
    return { ...line, values: base ? inView.map(([t, c]) => ({ t: t * 1000, v: (c / base - 1) * 100 })) : [] }
  })
  const values = lines.flatMap(line => line.values.map(point => point.v))
  let v0 = values.length ? Math.min(0, ...values) : -1, v1 = values.length ? Math.max(0, ...values) : 1
  const pad = (v1 - v0) * 0.1 || 1
  v0 -= pad; v1 += pad
  const y = (v: number) => H - ((v - v0) / (v1 - v0)) * H
  const percent = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(1)}%`
  const at = (t: number) => `${(x(t) / W) * 100}%`
  const colorOf = new Map(series.map(line => [line.symbol, line.color]))
  return <figure className="ac-chart">
    <div className="ac-plot">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Parent assets' price move with each agent window and its result">
        {/* One outline for the whole schedule; a month of 12-hour windows
            drawn one by one is a comb, not a chart. */}
        <rect className="ac-schedule" x={x(first.startsAt)} width={x(last.endsAt) - x(first.startsAt)} y={0.5} height={H - 1}/>
        {windows.map(window => <rect key={window.startsAt} className={`ac-band is-${window.status}`} x={x(window.startsAt)} width={Math.max(0.6, x(window.endsAt) - x(window.startsAt))} y={0} height={H}/>)}
        {v0 < 0 && v1 > 0 && <line className="ac-zero" x1={0} x2={W} y1={y(0)} y2={y(0)}/>}
        {now > t0 && now < t1 && <line className="ac-now" x1={x(now)} x2={x(now)} y1={0} y2={H}/>}
        {lines.map(line => <polyline key={line.symbol} fill="none" stroke={line.color} strokeWidth={1.6} vectorEffect="non-scaling-stroke"
          points={line.values.map(point => `${x(point.t).toFixed(1)},${y(point.v).toFixed(1)}`).join(' ')}/>)}
      </svg>
      {!values.length && <p className="ac-empty">The market prices this agent is judged on are not available yet.</p>}
      {now > t0 && now < t1 && <span className="ac-now-label" style={{ left: at(now) }}>NOW</span>}
      <span className="ac-axis ac-axis--top">{percent(v1)}</span>
      <span className="ac-axis ac-axis--bottom">{percent(v0)}</span>
    </div>
    {/* The strip is HTML so its text is not stretched with the plot. */}
    <ol className="ac-strip" aria-label="Agent call per window">
      {windows.map(window => {
        const call = window.forecast?.answer
        const width = x(window.endsAt) - x(window.startsAt)
        return <li key={window.startsAt} className={`is-${window.status}`} style={{ left: at(window.startsAt), width: `${(width / W) * 100}%` }}
          title={`${windowLabel(window.startsAt, window.endsAt)}: ${call ? `called ${call}` : 'no call yet'}, ${STATUS_LABEL[window.status]}`}>
          {call && <i style={{ background: colorOf.get(call) ?? '#d6dce6' }} aria-hidden="true"/>}
          {width >= 46 && <span>{call ?? STATUS_LABEL[window.status]}</span>}
          <span className="sr-only">{windowLabel(window.startsAt, window.endsAt)}: {call ? `called ${call}` : 'no call yet'}, {STATUS_LABEL[window.status]}</span>
        </li>
      })}
    </ol>
    <figcaption>
      {series.map(line => <span key={line.symbol}><i style={{ background: line.color }} aria-hidden="true"/>{line.symbol}</span>)}
      <span><i className="ac-key is-correct" aria-hidden="true"/>correct</span>
      <span><i className="ac-key is-missed" aria-hidden="true"/>missed</span>
      <span><i className="ac-key is-scheduled" aria-hidden="true"/>scheduled</span>
    </figcaption>
  </figure>
}

/** One row per judged or open window: the call beside what happened. */
export function AgentCallRows({ windows, limit = 6 }: { windows: AgentWindow[]; limit?: number }) {
  const rows = windows.filter(window => window.status !== 'scheduled').slice(-limit).reverse()
  if (!rows.length) return null
  return <ol className="sm-rows ac-rows">{rows.map(window => {
    const forecast = window.forecast
    const actual = forecast?.resolvedAnswer ? forecast.resolvedAnswer.split('|').join(' / ') : null
    const moves = forecast?.outcome?.filter(move => move.changeMicros !== null).map(move => `${move.symbol} ${signedPercent(move.changeMicros!)}`).join(' · ')
    return <li key={window.startsAt} className={`is-${window.status}`}>
      <i aria-hidden="true"/>
      <span className="sm-price">{windowLabel(window.startsAt, window.endsAt)}<small>window</small></span>
      <span className="sm-symbol">{forecast?.answer ?? '—'}<small>agent call{forecast ? ` · ${Math.round(forecast.probability * 100)}%` : ''}</small></span>
      <span className="sm-price">{actual ?? '—'}<small>{moves || 'market result'}</small></span>
      <span className="sm-return">{STATUS_LABEL[window.status]}</span>
    </li>
  })}</ol>
}
