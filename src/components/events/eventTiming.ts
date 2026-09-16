import type { SolzMatch } from '../solz/model'
import { formatClock } from '../solz/ui'

const finishedAt = (at: number) => new Intl.DateTimeFormat(undefined, {
  month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
}).format(at)

const relativeClock = (ms: number) => {
  if (ms < 24 * 60 * 60 * 1000) return formatClock(ms)
  const days = Math.floor(ms / (24 * 60 * 60 * 1000))
  const hours = Math.floor(ms / (60 * 60 * 1000)) % 24
  return `${days}D ${hours}H`
}

/** One phase sentence everywhere an event is listed. A phase word without its
 * number is not a countdown, and an expired clock must never keep saying LIVE. */
export function eventTimingLabel(match: SolzMatch, now: number) {
  if (match.phase === 'settled') {
    if (match.round === 'CANCELLED') return 'CANCELLED'
    if (match.round === 'RESULT PENDING') return 'FINISHED · RESULT PENDING'
    return `SETTLED · ${finishedAt(match.endsAt)}`
  }
  // Live telemetry can trail the authoritative clock. Once a finite match
  // window has passed, show the actual terminal state instead of STARTING/LIVE.
  if (match.timingType !== 'open-ended' && Number.isFinite(match.endsAt) && match.endsAt <= now) {
    return 'FINISHED · RESULT PENDING'
  }
  if (match.phase === 'live') {
    if (match.timingType === 'open-ended' || !Number.isFinite(match.endsAt)) return 'LIVE NOW'
    const remaining = match.endsAt - now
    return remaining > 0 ? `LIVE · ${relativeClock(remaining)} LEFT` : 'FINISHED · RESULT PENDING'
  }
  const remaining = match.startedAt - now
  return remaining > 0 ? `STARTS IN ${relativeClock(remaining)}` : 'STARTING NOW'
}
