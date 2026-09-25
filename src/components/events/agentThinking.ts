import type { AgentMethod, MeasuredRule, PublishedAgentForecast } from './generalEventPrices'

/**
 * What the forecast agent read, what it called and what the window then did,
 * as a readable log. Every sentence is written from a recorded field: the
 * inputs stored with the call, the frozen schedule, and the resolver's
 * per-window result. Nothing here guesses at a reason the agent did not
 * record; a call without stored inputs says so.
 */

export type AgentAccuracyRule = Extract<MeasuredRule, { kind: 'agent-accuracy' }>
export type AgentWindowStatus = 'scheduled' | 'locked' | 'running' | 'awaiting' | 'correct' | 'missed' | 'unpublished'
export type AgentWindow = { startsAt: number; endsAt: number; publishAt: number; forecast: PublishedAgentForecast | null; status: AgentWindowStatus }
export type Move = { symbol: string; changeMicros: number | null; first?: number; last?: number }
export type AgentThought = {
  id: string
  at: number
  /** `system` lines describe the schedule; `agent` lines are its own calls. */
  voice: 'system' | 'agent'
  text: string
  moves?: Move[]
  tone?: 'correct' | 'missed' | 'pending'
  /** False for lines about the schedule or method, whose `at` only orders them. */
  timed?: boolean
  /** On the next-call line: when that call is published. */
  dueAt?: number
}

const HOUR_MS = 3_600_000
const DEFAULT_LEAD_MS = HOUR_MS
/** A month of 12-hour windows is 62; this bounds a malformed schedule. */
const MAX_WINDOWS = 400

// Composed from parts: runtimes disagree on the joiner between a date and a
// time ("Oct 2, 00:00" in Chrome, "Oct 2 at 00:00" in Bun's ICU).
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const two = (value: number) => String(value).padStart(2, '0')
const day = { format: (ms: number) => { const date = new Date(ms); return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}` } }
const clock = { format: (ms: number) => { const date = new Date(ms); return `${two(date.getUTCHours())}:${two(date.getUTCMinutes())}` } }
const dateTime = { format: (ms: number) => `${day.format(ms)}, ${clock.format(ms)}` }
export const shortUtc = (ms: number) => dateTime.format(ms)
export const utcTime = (ms: number) => `${dateTime.format(ms)} UTC`
/** "Oct 2 00:00–12:00 UTC", or both dates when the window crosses midnight. */
export function windowLabel(startsAt: number, endsAt: number) {
  return day.format(startsAt) === day.format(endsAt - 1)
    ? `${dateTime.format(startsAt)}–${clock.format(endsAt)} UTC`
    : `${dateTime.format(startsAt)} – ${dateTime.format(endsAt)} UTC`
}
export const signedPercent = (micros: number) => `${micros > 0 ? '+' : micros < 0 ? '−' : ''}${Math.abs(micros / 10_000).toFixed(2)}%`
const hours = (seconds: number) => seconds === 3600 ? '1 hour' : seconds % 3600 === 0 ? `${seconds / 3600} hours` : `${Math.round(seconds / 60)} minutes`

/** The frozen schedule, with each published call placed in its window. */
export function agentWindows(rule: AgentAccuracyRule, forecasts: readonly PublishedAgentForecast[], method: AgentMethod | null, now: number): AgentWindow[] {
  const start = Date.parse(rule.windowStart), end = Date.parse(rule.windowEnd), step = rule.intervalSeconds * 1000
  if (!(step > 0) || !(end > start)) return []
  const lead = method ? method.leadSeconds * 1000 : DEFAULT_LEAD_MS
  const byStart = new Map(forecasts.map(forecast => [Date.parse(forecast.startsAt), forecast]))
  const windows: AgentWindow[] = []
  for (let at = start; at < end && windows.length < MAX_WINDOWS; at += step) {
    const forecast = byStart.get(at) ?? null
    const endsAt = Math.min(at + step, end)
    const status: AgentWindowStatus = !forecast ? (now >= at ? 'unpublished' : 'scheduled')
      : forecast.correct === true ? 'correct' : forecast.correct === false ? 'missed'
        : now < at ? 'locked' : now < endsAt ? 'running' : 'awaiting'
    windows.push({ startsAt: at, endsAt, publishAt: forecast ? Date.parse(forecast.publishedAt) : at - lead, forecast, status })
  }
  return windows
}

/** Correct calls against every window already scored or missed. */
export function agentScore(windows: readonly AgentWindow[]) {
  const correct = windows.filter(window => window.status === 'correct').length
  const judged = windows.filter(window => window.status === 'correct' || window.status === 'missed' || window.status === 'unpublished').length
  return { correct, judged, total: windows.length }
}

const describeMove = (move: Pick<Move, 'symbol' | 'changeMicros'>) => move.changeMicros === null ? `${move.symbol} has no price`
  : move.changeMicros > 0 ? `${move.symbol} rose ${signedPercent(move.changeMicros).slice(1)}`
    : move.changeMicros < 0 ? `${move.symbol} fell ${signedPercent(move.changeMicros).slice(1)}` : `${move.symbol} did not move`
const isDirection = (answer: string) => answer === 'UP' || answer === 'DOWN'

/** Plain words for a method id the backend publishes. An unknown id is named,
 *  never described from a guess. */
export function methodSentence(method: AgentMethod | null): string | null {
  if (!method) return null
  if (method.id.startsWith('momentum-')) return `Method ${method.id}: I compare how far each asset moved over the last ${method.lookbackHours} hours of hourly closes. I call the biggest mover to lead the next window; for one asset I call UP if it rose and DOWN if it did not. Confidence is a fixed ${Math.round(method.baselineProbability * 100)}% baseline, not calibrated. I do not read news or trading volume.`
  return `Method ${method.id}.`
}

function callText(window: AgentWindow, forecast: PublishedAgentForecast) {
  const span = windowLabel(window.startsAt, window.endsAt)
  const confidence = `Confidence ${Math.round(forecast.probability * 100)}%.`
  const measured = forecast.reasoning?.measured ?? []
  if (!measured.length) return `I call ${forecast.answer} for ${span}. ${confidence} The inputs behind this call were not recorded.`
  if (isDirection(forecast.answer) && measured.length === 1) return `${describeMove(measured[0]!)}, so I call ${forecast.answer} for ${span}. ${confidence}`
  const leader = [...measured].sort((a, b) => (b.changeMicros ?? -Infinity) - (a.changeMicros ?? -Infinity))[0]!
  return leader.symbol === forecast.answer && leader.changeMicros !== null
    ? `${leader.symbol} moved most (${signedPercent(leader.changeMicros)}), so I call ${forecast.answer} to lead ${span}. ${confidence}`
    : `I call ${forecast.answer} to lead ${span}. ${confidence}`
}

function resultText(forecast: PublishedAgentForecast) {
  const answer = forecast.resolvedAnswer ?? ''
  const verdict = forecast.correct ? 'correct' : 'missed'
  if (isDirection(answer)) {
    const move = forecast.outcome?.[0]
    return `Window closed${move ? `: ${describeMove(move)}` : ''}, so the answer is ${answer}. My call ${forecast.answer} ${verdict === 'correct' ? 'was correct' : 'missed'}.`
  }
  const leaders = answer.split('|').filter(Boolean)
  return `Window closed. ${leaders.join(' and ')} ${leaders.length > 1 ? 'tied for the lead' : 'led'}. My call ${forecast.answer} ${verdict === 'correct' ? 'was correct' : 'missed'}.`
}

/**
 * The log, oldest first like a chat. `limit` keeps the most recent windows
 * that have something to say; a month-long schedule is 62 windows.
 */
export function agentThoughts(rule: AgentAccuracyRule | null, forecasts: readonly PublishedAgentForecast[], method: AgentMethod | null, now: number, limit = 8): AgentThought[] {
  const windows = rule ? agentWindows(rule, forecasts, method, now) : forecasts.map((forecast): AgentWindow => ({
    startsAt: Date.parse(forecast.startsAt), endsAt: Date.parse(forecast.endsAt), publishAt: Date.parse(forecast.publishedAt), forecast,
    status: forecast.correct === true ? 'correct' : forecast.correct === false ? 'missed' : now < Date.parse(forecast.startsAt) ? 'locked' : now < Date.parse(forecast.endsAt) ? 'running' : 'awaiting',
  }))
  const thoughts: AgentThought[] = []
  const first = windows[0]
  if (rule && first) thoughts.push({ id: 'schedule', at: first.publishAt - 2, voice: 'system',
    text: `${windows.length} ${windows.length === 1 ? 'call' : 'calls'} scheduled, one every ${hours(rule.intervalSeconds)}, from ${utcTime(Date.parse(rule.windowStart))} to ${utcTime(Date.parse(rule.windowEnd))}. Each call is locked ${method ? hours(method.leadSeconds) : '1 hour'} before its window opens and cannot be edited.` })
  const method_ = methodSentence(method)
  if (method_ && first) thoughts.push({ id: 'method', at: first.publishAt - 1, voice: 'agent', timed: false, text: method_ })
  const said = windows.filter(window => window.status !== 'scheduled').slice(-limit)
  for (const window of said) {
    const key = String(window.startsAt)
    const forecast = window.forecast
    if (!forecast) {
      thoughts.push({ id: `${key}:unpublished`, at: window.startsAt, voice: 'system', tone: 'missed', text: `No call was published for ${windowLabel(window.startsAt, window.endsAt)}. It counts as a miss.` })
      continue
    }
    const reasoning = forecast.reasoning
    if (reasoning?.measured.length) thoughts.push({ id: `${key}:reading`, at: Date.parse(reasoning.asOf), voice: 'agent',
      text: `Reading hourly closes up to ${utcTime(Date.parse(reasoning.asOf))}. Over the last ${reasoning.lookbackHours} hours:`,
      moves: reasoning.measured.map(item => ({ symbol: item.symbol, changeMicros: item.changeMicros, ...(item.first ? { first: item.first.c } : {}), ...(item.last ? { last: item.last.c } : {}) })) })
    thoughts.push({ id: `${key}:call`, at: window.publishAt, voice: 'agent', text: callText(window, forecast) })
    if (window.status === 'correct' || window.status === 'missed') thoughts.push({ id: `${key}:result`, at: window.endsAt, voice: 'agent', tone: window.status,
      text: resultText(forecast), ...(forecast.outcome ? { moves: forecast.outcome.map(item => ({ symbol: item.symbol, changeMicros: item.changeMicros })) } : {}) })
    else if (window.status === 'running') thoughts.push({ id: `${key}:running`, at: window.startsAt, voice: 'system', tone: 'pending', text: `Window open until ${utcTime(window.endsAt)}. The call is locked.` })
    else if (window.status === 'awaiting') thoughts.push({ id: `${key}:awaiting`, at: window.endsAt, voice: 'system', tone: 'pending', text: `Window closed at ${utcTime(window.endsAt)}. Waiting for the oracle to score it.` })
  }
  const next = windows.find(window => window.status === 'scheduled')
  if (next) thoughts.push({ id: 'next', at: Math.max(next.publishAt, now), dueAt: next.publishAt, voice: 'system',
    text: `Next call due ${utcTime(next.publishAt)}, for ${windowLabel(next.startsAt, next.endsAt)}.` })
  return thoughts.sort((a, b) => a.at - b.at)
}
