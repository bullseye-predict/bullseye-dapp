import { useEffect, useState } from 'react'
import { predictionUrl } from '../../../packages/sdk/prediction-url'

/**
 * GET /general/events/:eventId/prices on the prediction backend: the measured
 * progress of a stock event, from the same pools and hourly closes its
 * resolver settles with. The backend answers from memory and refreshes behind
 * the request, so a first view can say `pending` while the prices load.
 */
export type MeasuredPoint = { t: number; c: number }
export type MeasuredCandidate = {
  symbol: string
  pool: string
  questionId: string
  thresholdUsd?: number
  points: [number, number][]
  start: MeasuredPoint | null
  latest: MeasuredPoint | null
  returnMicros: number | null
  verdict: 'YES' | 'NO' | 'VOID' | null
}
export type MeasuredRule =
  | { kind: 'top-return'; windowStart: string; windowEnd: string; maxStalenessHours: number }
  | { kind: 'agent-band'; at: string; low: number; high: number; center: number; lastClose: number; model: string; madeAt: string; maxStalenessHours: number }
  | { kind: 'above'; at: string; thresholdUsd: number; displayMultiplier: number; thresholdBasis: 'display-unit'; maxStalenessHours: number }
  | { kind: 'above-ladder'; at: string; displayMultiplier: number; thresholdBasis: 'display-unit'; maxStalenessHours: number }
  | { kind: 'agent-accuracy'; parentEventId: string; windowStart: string; windowEnd: string; intervalSeconds: number; expectedWindows: number; minimumCorrect?: number; options?: { minCorrect: number; maxCorrect: number; questionId: string }[] }
export type GeneralEventPrices = {
  eventId: string
  status: 'pending' | 'ready' | 'stale'
  asOf: number | null
  rule: MeasuredRule
  candidates: MeasuredCandidate[]
  evidence: { hash: string; leaders: string[]; void: string | null } | null
}

/** Event ids the general catalogue issues. Match events use `arena-…` or a
 *  bare 0x match id, so the prefix alone tells the two apart. */
export const isGeneralEventId = (eventId: string) => /^(general|lazy)-/.test(eventId)
/** Stock events carry a measured rule and so have prices to show. */
export const isStockEventId = (eventId: string) => /^general-(stocks|agent)-/.test(eventId)

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const time = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value))
const point = (value: unknown): MeasuredPoint | null => {
  const row = value as { t?: unknown; c?: unknown } | null
  return row && finite(row.t) && finite(row.c) && row.c > 0 ? { t: row.t, c: row.c } : null
}

/** Refuses a body it cannot read whole; a half-read chart would mislead. */
export function parseGeneralEventPrices(value: unknown): GeneralEventPrices {
  const body = value as Record<string, unknown> | null
  const rule = body?.rule as Record<string, unknown> | undefined
  if (!body || typeof body.eventId !== 'string' || !['pending', 'ready', 'stale'].includes(String(body.status)) || !rule || !Array.isArray(body.candidates)) throw new Error('Unreadable measured prices.')
  const staleness = finite(rule.maxStalenessHours) ? rule.maxStalenessHours : 72
  let parsedRule: MeasuredRule
  if (rule.kind === 'top-return' && time(rule.windowStart) && time(rule.windowEnd)) {
    parsedRule = { kind: 'top-return', windowStart: String(rule.windowStart), windowEnd: String(rule.windowEnd), maxStalenessHours: staleness }
  } else if (rule.kind === 'agent-band' && time(rule.at) && time(rule.madeAt) && finite(rule.low) && finite(rule.high) && finite(rule.center) && finite(rule.lastClose) && rule.low < rule.high) {
    parsedRule = { kind: 'agent-band', at: String(rule.at), madeAt: String(rule.madeAt), low: rule.low, high: rule.high, center: rule.center, lastClose: rule.lastClose, model: typeof rule.model === 'string' ? rule.model : 'agent', maxStalenessHours: staleness }
  } else if (rule.kind === 'above' && time(rule.at) && finite(rule.thresholdUsd) && finite(rule.displayMultiplier) && rule.displayMultiplier > 0 && rule.thresholdBasis === 'display-unit') {
    parsedRule = { kind: 'above', at: String(rule.at), thresholdUsd: rule.thresholdUsd, displayMultiplier: rule.displayMultiplier, thresholdBasis: 'display-unit', maxStalenessHours: staleness }
  } else if (rule.kind === 'above-ladder' && time(rule.at) && finite(rule.displayMultiplier) && rule.displayMultiplier > 0 && rule.thresholdBasis === 'display-unit') {
    parsedRule = { kind: 'above-ladder', at: String(rule.at), displayMultiplier: rule.displayMultiplier, thresholdBasis: 'display-unit', maxStalenessHours: staleness }
  } else if (rule.kind === 'agent-accuracy' && typeof rule.parentEventId === 'string' && time(rule.windowStart) && time(rule.windowEnd)
    && finite(rule.intervalSeconds) && finite(rule.expectedWindows)
    && (finite(rule.minimumCorrect) || Array.isArray(rule.options))) {
    parsedRule = { kind: 'agent-accuracy', parentEventId: rule.parentEventId, windowStart: String(rule.windowStart),
      windowEnd: String(rule.windowEnd), intervalSeconds: rule.intervalSeconds, expectedWindows: rule.expectedWindows,
      ...(finite(rule.minimumCorrect) ? { minimumCorrect: rule.minimumCorrect } : {}),
      ...(Array.isArray(rule.options) ? { options: rule.options.filter((option): option is { minCorrect: number; maxCorrect: number; questionId: string } =>
        !!option && finite(option.minCorrect) && finite(option.maxCorrect) && typeof option.questionId === 'string') } : {}) }
  } else throw new Error('Unreadable measured rule.')
  const candidates = body.candidates.slice(0, 16).map((raw): MeasuredCandidate => {
    const row = raw as Record<string, unknown>
    if (typeof row?.symbol !== 'string' || typeof row.questionId !== 'string' || typeof row.pool !== 'string') throw new Error('Unreadable candidate.')
    const points = Array.isArray(row.points) ? row.points.filter((entry): entry is [number, number] => Array.isArray(entry) && finite(entry[0]) && finite(entry[1]) && entry[1] > 0).slice(-400) : []
    return {
      symbol: row.symbol.slice(0, 24), pool: row.pool, questionId: row.questionId, points,
      ...(finite(row.thresholdUsd) && row.thresholdUsd > 0 ? { thresholdUsd: row.thresholdUsd } : {}),
      start: point(row.start), latest: point(row.latest), returnMicros: finite(row.returnMicros) ? row.returnMicros : null,
      verdict: row.verdict === 'YES' || row.verdict === 'NO' || row.verdict === 'VOID' ? row.verdict : null,
    }
  })
  if (parsedRule.kind === 'above-ladder' && (candidates.length < 2 || candidates.some(candidate => !finite(candidate.thresholdUsd)))) throw new Error('Unreadable linked thresholds.')
  const evidence = body.evidence as Record<string, unknown> | null
  const asOf = typeof body.asOf === 'string' ? Date.parse(body.asOf) : Number.NaN
  return {
    eventId: body.eventId, status: body.status as GeneralEventPrices['status'], asOf: Number.isFinite(asOf) ? asOf : null,
    rule: parsedRule, candidates,
    evidence: evidence && typeof evidence.hash === 'string' ? {
      hash: evidence.hash,
      leaders: Array.isArray(evidence.leaders) ? evidence.leaders.filter((item): item is string => typeof item === 'string') : [],
      void: typeof evidence.void === 'string' ? evidence.void : null,
    } : null,
  }
}

export type GeneralEventPricesState =
  | { phase: 'loading' }
  | { phase: 'absent' }
  | { phase: 'unavailable' }
  | { phase: 'loaded'; prices: GeneralEventPrices }

const READY_POLL_MS = 60_000
const PENDING_POLL_MS = 15_000
const RETRY_MAX_MS = 600_000

/**
 * Polls one event's measured prices. Every 15 s while the backend is still
 * reading them, every 60 s once they are ready, and on failure from 60 s up to
 * a 10-minute ceiling. A 404 means the event has no measured rule, which is
 * final for this mount: nothing polls it again.
 */
export function useGeneralEventPrices(apiUrl: string, eventId: string, fetcher: typeof fetch = fetch): GeneralEventPricesState {
  const [state, setState] = useState<GeneralEventPricesState>({ phase: 'loading' })
  useEffect(() => {
    if (!apiUrl || !isStockEventId(eventId)) { setState({ phase: 'absent' }); return }
    const controller = new AbortController()
    let timer: number | undefined
    let failures = 0
    setState({ phase: 'loading' })
    const load = async () => {
      let next = READY_POLL_MS
      try {
        const response = await fetcher(predictionUrl(`/general/events/${encodeURIComponent(eventId)}/prices`, apiUrl), {
          headers: { accept: 'application/json' }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]),
        })
        if (response.status === 404) { if (!controller.signal.aborted) setState({ phase: 'absent' }); return }
        if (!response.ok) throw new Error(`Measured prices answered ${response.status}`)
        const prices = parseGeneralEventPrices(await response.json())
        failures = 0
        if (prices.status === 'pending') next = PENDING_POLL_MS
        if (!controller.signal.aborted) setState({ phase: 'loaded', prices })
      } catch {
        if (controller.signal.aborted) return
        failures = Math.min(failures + 1, 8)
        next = Math.min(RETRY_MAX_MS, READY_POLL_MS * 2 ** (failures - 1))
        // Keep what is on screen through a transient failure.
        setState(previous => previous.phase === 'loaded' ? previous : { phase: 'unavailable' })
      }
      if (!controller.signal.aborted) timer = window.setTimeout(() => void load(), next)
    }
    void load()
    return () => { controller.abort(); if (timer) window.clearTimeout(timer) }
  }, [apiUrl, eventId, fetcher])
  return state
}

/** What the agent read when it made one call, recorded with the call. */
export type AgentReasoning = {
  method: string
  asOf: string
  lookbackHours: number
  measured: { symbol: string; first: MeasuredPoint | null; last: MeasuredPoint | null; changeMicros: number | null }[]
}
/** The method the backend runs, published even before the first call. */
export type AgentMethod = { id: string; lookbackHours: number; baselineProbability: number; leadSeconds: number }
export type PublishedAgentForecast = { startsAt: string; endsAt: string; answer: string; probability: number
  publishedAt: string; citations: string[]; resolvedAnswer: string | null; correct: boolean | null
  /** Null for calls published before the backend recorded its inputs. */
  reasoning: AgentReasoning | null
  /** What each symbol did over the window, once it is scored. */
  outcome: { symbol: string; changeMicros: number | null }[] | null }
export type AgentForecasts = { loaded: boolean; method: AgentMethod | null; forecasts: PublishedAgentForecast[] }

const nullableChange = (value: unknown) => finite(value) ? value : null
function parseReasoning(value: unknown): AgentReasoning | null {
  const row = value as Record<string, unknown> | null
  if (!row || typeof row.method !== 'string' || !time(row.asOf) || !Array.isArray(row.measured)) return null
  return { method: row.method, asOf: String(row.asOf), lookbackHours: finite(row.lookbackHours) ? row.lookbackHours : 24,
    measured: row.measured.slice(0, 16).filter(item => typeof item?.symbol === 'string')
      .map(item => ({ symbol: String(item.symbol).slice(0, 24), first: point(item.first), last: point(item.last), changeMicros: nullableChange(item.changeMicros) })) }
}
function parseMethod(value: unknown): AgentMethod | null {
  const row = value as Record<string, unknown> | null
  return row && typeof row.id === 'string' && finite(row.lookbackHours) && finite(row.baselineProbability) && finite(row.leadSeconds)
    ? { id: row.id, lookbackHours: row.lookbackHours, baselineProbability: row.baselineProbability, leadSeconds: row.leadSeconds } : null
}

/** Keeps every well-formed call. The newer fields are optional so an older
 *  backend, which sends neither, still shows its calls. */
export function parseAgentForecasts(value: unknown): Omit<AgentForecasts, 'loaded'> {
  const body = value as { forecasts?: unknown; method?: unknown } | null
  if (!body || !Array.isArray(body.forecasts)) throw Error('Unreadable agent forecasts.')
  const forecasts = body.forecasts.filter(raw => {
    const row = raw as Record<string, unknown> | null
    return !!row && time(row.startsAt) && time(row.endsAt) && time(row.publishedAt)
      && typeof row.answer === 'string' && finite(row.probability) && row.probability >= 0 && row.probability <= 1
      && Array.isArray(row.citations) && (row.resolvedAnswer === null || typeof row.resolvedAnswer === 'string')
      && (row.correct === null || typeof row.correct === 'boolean')
  }).slice(-100).map(raw => {
    const row = raw as Record<string, unknown>
    return { startsAt: String(row.startsAt), endsAt: String(row.endsAt), answer: String(row.answer), probability: row.probability as number,
      publishedAt: String(row.publishedAt), citations: (row.citations as unknown[]).filter((item): item is string => typeof item === 'string'),
      resolvedAnswer: row.resolvedAnswer as string | null, correct: row.correct as boolean | null,
      reasoning: parseReasoning(row.reasoning),
      outcome: Array.isArray(row.outcome) ? row.outcome.filter(item => typeof item?.symbol === 'string')
        .map(item => ({ symbol: String(item.symbol), changeMicros: nullableChange(item.changeMicros) })) : null }
  })
  return { method: parseMethod(body.method), forecasts }
}

const EMPTY_FORECASTS: AgentForecasts = { loaded: false, method: null, forecasts: [] }

/** The backend caches neither market odds nor narrative here; these are the
 *  agent's immutable, timestamped calls from its separate database. A new
 *  call lands at most once per window, so five minutes is ample; failures
 *  back off to a 30-minute ceiling. */
export function useAgentForecasts(apiUrl: string, eventId: string): AgentForecasts {
  const [state, setState] = useState<AgentForecasts>(EMPTY_FORECASTS)
  useEffect(() => {
    setState(EMPTY_FORECASTS)
    if (!apiUrl || !isStockEventId(eventId)) return
    const controller = new AbortController()
    let timer: number | undefined, failures = 0
    const load = async () => {
      let delay = 5 * 60_000
      try {
        const response = await fetch(predictionUrl(`/general/events/${encodeURIComponent(eventId)}/agent`, apiUrl), {
          headers: { accept: 'application/json' }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]),
        })
        if (response.status === 503 || response.status === 404) { if (!controller.signal.aborted) setState({ ...EMPTY_FORECASTS, loaded: true }); return }
        if (!response.ok) throw Error(`Agent forecasts answered ${response.status}`)
        const parsed = parseAgentForecasts(await response.json())
        failures = 0
        if (!controller.signal.aborted) setState({ loaded: true, ...parsed })
      } catch {
        if (controller.signal.aborted) return
        failures++
        delay = Math.min(30 * 60_000, 60_000 * 2 ** Math.min(failures - 1, 8))
        setState(previous => previous.loaded ? previous : { ...EMPTY_FORECASTS, loaded: true })
      }
      if (!controller.signal.aborted) timer = window.setTimeout(() => void load(), delay)
    }
    void load()
    return () => { controller.abort(); if (timer) window.clearTimeout(timer) }
  }, [apiUrl, eventId])
  return state
}
