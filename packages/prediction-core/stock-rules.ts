/**
 * Stock questions: the frozen rule shapes and the pure arithmetic that
 * resolves them.
 *
 * A rule is written before trading opens, and its hash is part of every
 * question identity (apps/stake-api/general-events.ts). A changed rule is
 * therefore a different market, never an edit of a live one.
 *
 * Everything here is deterministic. The same candles give the same verdicts on
 * every host, which is what lets two resolvers race to write one result.
 *
 * Prices are USD per base unit of the token, as GeckoTerminal reports them.
 * A PreStocks scaled-UI multiplier change moves the wallet display, not the
 * base-unit price, so a return needs no adjustment for it.
 */

export const STOCK_TOP_RETURN_V1 = 'stock-top-return/v1'
export const AGENT_BAND_V1 = 'agent-band/v1'
export const BASELINE_DRIFT_V1 = 'baseline-drift/v1'

/** One hourly candle: its start in unix seconds and its closing USD price.
 *  The close is the last trade before `t + 3600`. */
export type StockCandle = { t: number; c: number }
export const CANDLE_SECONDS = 3600

export type StockPriceSource = { provider: 'geckoterminal'; network: 'solana'; timeframe: 'hour'; currency: 'usd'; basis: 'base-unit' }
export const STOCK_PRICE_SOURCE: StockPriceSource = Object.freeze({ provider: 'geckoterminal', network: 'solana', timeframe: 'hour', currency: 'usd', basis: 'base-unit' })

/** A thinly traded pool can go a day without a swap (SPACEX showed a 25-hour
 *  gap). Its last trade is still its price; older than this, it is not. */
export const MAX_STALENESS_HOURS = 72
/** How long after the measured moment the resolver waits, so the last hourly
 *  candle is closed and indexed before anything is written. */
export const FINALITY_DELAY_SECONDS = 3600

export type StockCandidate = { symbol: string; mint: string; pool: string; questionId: `0x${string}` }

export type StockTopReturnRule = {
  version: typeof STOCK_TOP_RETURN_V1
  category: 'stocks'
  universe: 'prestocks'
  windowStart: string
  windowEnd: string
  source: StockPriceSource
  maxStalenessHours: number
  finalityDelaySeconds: number
  /** Every candidate with the best return resolves YES. Each binary market is
   *  collateralized on its own, so two YES answers are safe to pay. */
  tiePolicy: 'all-leaders-yes'
  candidates: StockCandidate[]
}

export type AgentForecast = {
  model: string
  madeAt: string
  /** sha256 of the closes the model read, so the forecast can be reproduced. */
  inputsHash: string
  lastClose: number
  center: number
  low: number
  high: number
  horizonDays: number
}

export type AgentBandRule = {
  version: typeof AGENT_BAND_V1
  category: 'stocks'
  universe: 'prestocks'
  symbol: string
  mint: string
  pool: string
  /** The measured moment: the price at `at` must land inside the band. */
  at: string
  source: StockPriceSource
  maxStalenessHours: number
  finalityDelaySeconds: number
  forecast: AgentForecast
  questionId: `0x${string}`
}

export type GeneralRule = StockTopReturnRule | AgentBandRule
export type GeneralVerdict = 'YES' | 'NO' | 'VOID'
export type GeneralResolution = {
  verdicts: { questionId: `0x${string}`; verdict: GeneralVerdict }[]
  evidence: Record<string, unknown>
}

const seconds = (iso: string) => Math.floor(Date.parse(iso) / 1000)

/** The moment the rule measures last: the window end, or the band's time. */
export const ruleMeasurementEnd = (rule: GeneralRule) => seconds(rule.version === STOCK_TOP_RETURN_V1 ? rule.windowEnd : rule.at)
/** The earliest moment a result may be computed, in unix seconds. */
export const ruleDueAt = (rule: GeneralRule) => ruleMeasurementEnd(rule) + rule.finalityDelaySeconds
/** Every question the rule settles. */
export const ruleQuestionIds = (rule: GeneralRule) => rule.version === STOCK_TOP_RETURN_V1 ? rule.candidates.map(candidate => candidate.questionId) : [rule.questionId]
/** Every price series the rule reads, as `symbol -> pool`. */
export const rulePools = (rule: GeneralRule): { symbol: string; pool: string }[] => rule.version === STOCK_TOP_RETURN_V1
  ? rule.candidates.map(({ symbol, pool }) => ({ symbol, pool }))
  : [{ symbol: rule.symbol, pool: rule.pool }]

const hash = /^[0-9a-f]{64}$/
const questionId = (value: unknown): value is `0x${string}` => typeof value === 'string' && /^0x515545530102[0-9a-f]{52}$/.test(value)
const text = (value: unknown, max = 80) => typeof value === 'string' && value.length > 0 && value.length <= max
const iso = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value))
const positive = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0
const sourceOk = (value: unknown) => {
  const source = value as StockPriceSource | null
  return !!source && source.provider === 'geckoterminal' && source.network === 'solana' && source.timeframe === 'hour' && source.currency === 'usd' && source.basis === 'base-unit'
}

/**
 * A rule read back from the database, checked before anything acts on it.
 * Neon can hand jsonb back as text, so a string is parsed first. A rule that
 * does not check out is refused whole; nothing is resolved from part of one.
 */
export function parseGeneralRule(value: unknown): GeneralRule {
  const rule = (typeof value === 'string' ? JSON.parse(value) : value) as Record<string, unknown> | null
  const common = !!rule && rule.category === 'stocks' && rule.universe === 'prestocks' && sourceOk(rule.source)
    && typeof rule.maxStalenessHours === 'number' && Number.isInteger(rule.maxStalenessHours) && rule.maxStalenessHours >= 1 && rule.maxStalenessHours <= 168
    && typeof rule.finalityDelaySeconds === 'number' && Number.isInteger(rule.finalityDelaySeconds) && rule.finalityDelaySeconds >= 0 && rule.finalityDelaySeconds <= 86_400
  if (common && rule!.version === STOCK_TOP_RETURN_V1) {
    const candidates = rule!.candidates as StockCandidate[] | undefined
    if (iso(rule!.windowStart) && iso(rule!.windowEnd) && seconds(rule!.windowStart as string) < seconds(rule!.windowEnd as string)
      && rule!.tiePolicy === 'all-leaders-yes' && Array.isArray(candidates) && candidates.length >= 2 && candidates.length <= 16
      && candidates.every(candidate => text(candidate?.symbol, 24) && text(candidate?.mint, 44) && text(candidate?.pool, 44) && questionId(candidate?.questionId))
      && new Set(candidates.map(candidate => candidate.symbol)).size === candidates.length
      && new Set(candidates.map(candidate => candidate.questionId)).size === candidates.length) return rule as unknown as StockTopReturnRule
  }
  if (common && rule!.version === AGENT_BAND_V1) {
    const forecast = rule!.forecast as AgentForecast | undefined
    if (text(rule!.symbol, 24) && text(rule!.mint, 44) && text(rule!.pool, 44) && iso(rule!.at) && questionId(rule!.questionId)
      && !!forecast && text(forecast.model) && iso(forecast.madeAt) && typeof forecast.inputsHash === 'string' && hash.test(forecast.inputsHash)
      && positive(forecast.lastClose) && positive(forecast.center) && positive(forecast.low) && positive(forecast.high)
      && forecast.low < forecast.high && positive(forecast.horizonDays)) return rule as unknown as AgentBandRule
  }
  throw new Error('Invalid general question rule.')
}

/**
 * The last traded price at a boundary: the close of the latest hourly candle
 * that ENDED at or before it, looking back at most `maxStalenessHours`.
 * A candle that is still open at the boundary is never read, so a price is
 * never taken from after the moment it describes.
 */
export function priceAt(candles: readonly StockCandle[], boundarySeconds: number, maxStalenessHours: number): StockCandle | null {
  let best: StockCandle | null = null
  const oldest = boundarySeconds - maxStalenessHours * 3600
  for (const candle of candles) {
    const end = candle.t + CANDLE_SECONDS
    if (end > boundarySeconds || end < oldest || !(candle.c > 0)) continue
    if (!best || candle.t > best.t) best = candle
  }
  return best
}

/** A return in integer millionths, so equal returns compare equal on every
 *  host rather than differing in the sixteenth digit. */
export const returnMicros = (start: number, end: number) => Math.round((end / start - 1) * 1_000_000)

type Measured = { symbol: string; pool: string; questionId: `0x${string}`; start: StockCandle | null; end: StockCandle | null; returnMicros: number | null }

function measure(rule: StockTopReturnRule, series: Readonly<Record<string, readonly StockCandle[]>>, endSeconds: number): Measured[] {
  const start = seconds(rule.windowStart)
  return rule.candidates.map(candidate => {
    const candles = series[candidate.symbol] ?? []
    const first = priceAt(candles, start, rule.maxStalenessHours)
    const last = priceAt(candles, endSeconds, rule.maxStalenessHours)
    return {
      symbol: candidate.symbol, pool: candidate.pool, questionId: candidate.questionId, start: first, end: last,
      returnMicros: first && last ? returnMicros(first.c, last.c) : null,
    }
  })
}

/**
 * Which candidate gained the most over the window.
 *
 * If ANY candidate has no price at either boundary, every question in the
 * event is VOID: the leader cannot be known, and naming one anyway would pay a
 * side that may have lost. The gap is written into the evidence.
 */
export function resolveTopReturn(rule: StockTopReturnRule, series: Readonly<Record<string, readonly StockCandle[]>>): GeneralResolution {
  const rows = measure(rule, series, seconds(rule.windowEnd))
  const evidence: Record<string, unknown> = {
    version: rule.version, windowStart: rule.windowStart, windowEnd: rule.windowEnd, source: rule.source,
    maxStalenessHours: rule.maxStalenessHours, tiePolicy: rule.tiePolicy,
    candidates: rows.map(({ symbol, pool, start, end, returnMicros }) => ({ symbol, pool, start, end, returnMicros })),
  }
  const missing = rows.filter(row => row.returnMicros === null).map(row => row.symbol)
  if (missing.length) return {
    verdicts: rows.map(row => ({ questionId: row.questionId, verdict: 'VOID' as const })),
    evidence: { ...evidence, void: `No traded price within ${rule.maxStalenessHours} hours of a window boundary for ${missing.join(', ')}.` },
  }
  const best = Math.max(...rows.map(row => row.returnMicros!))
  return {
    verdicts: rows.map(row => ({ questionId: row.questionId, verdict: row.returnMicros === best ? 'YES' as const : 'NO' as const })),
    evidence: { ...evidence, leaders: rows.filter(row => row.returnMicros === best).map(row => row.symbol), leaderReturnMicros: best },
  }
}

/** Whether the price at the measured moment landed inside the agent's band,
 *  both edges included. No price at that moment is VOID, never NO. */
export function resolveAgentBand(rule: AgentBandRule, candles: readonly StockCandle[]): GeneralResolution {
  const price = priceAt(candles, seconds(rule.at), rule.maxStalenessHours)
  const evidence: Record<string, unknown> = {
    version: rule.version, symbol: rule.symbol, pool: rule.pool, at: rule.at, source: rule.source,
    maxStalenessHours: rule.maxStalenessHours, low: rule.forecast.low, high: rule.forecast.high, price,
  }
  if (!price) return { verdicts: [{ questionId: rule.questionId, verdict: 'VOID' }], evidence: { ...evidence, void: `No traded price within ${rule.maxStalenessHours} hours before ${rule.at}.` } }
  const inside = price.c >= rule.forecast.low && price.c <= rule.forecast.high
  return { verdicts: [{ questionId: rule.questionId, verdict: inside ? 'YES' : 'NO' }], evidence: { ...evidence, inside } }
}

/** Dispatches on the rule version. `series` is keyed by symbol. */
export function resolveGeneralRule(rule: GeneralRule, series: Readonly<Record<string, readonly StockCandle[]>>): GeneralResolution {
  return rule.version === STOCK_TOP_RETURN_V1 ? resolveTopReturn(rule, series) : resolveAgentBand(rule, series[rule.symbol] ?? [])
}

/**
 * The return so far, for display only and never a settlement input: the
 * window start against the last closed candle before `nowSeconds` (or before
 * the window end, once it has passed).
 *
 * Before the window opens there is no return to show: the start price does
 * not exist yet, and comparing two recent candles would present noise as a
 * measurement. Each candidate then carries only its latest price.
 */
export function measuredReturns(rule: StockTopReturnRule, series: Readonly<Record<string, readonly StockCandle[]>>, nowSeconds: number): Measured[] {
  if (nowSeconds < seconds(rule.windowStart)) return rule.candidates.map(candidate => ({
    symbol: candidate.symbol, pool: candidate.pool, questionId: candidate.questionId, start: null,
    end: priceAt(series[candidate.symbol] ?? [], nowSeconds, rule.maxStalenessHours), returnMicros: null,
  }))
  return measure(rule, series, Math.min(nowSeconds, seconds(rule.windowEnd)))
}

/**
 * The baseline agent, `baseline-drift/v1`: it extends HALF the recent daily
 * drift over the horizon and puts a one-sigma band around it.
 *
 * `closes` are daily closes, oldest first. Momentum is real but decays, so the
 * drift is halved and capped at 10% over the horizon; the half-width is held
 * between 3% and 20%. One wild month cannot produce an absurd call: extending
 * a +0.77%/day month in full put ANTHROPIC's whole band above its own price.
 * Prices are rounded to cents.
 */
export function driftBand(closes: readonly number[], horizonDays: number) {
  if (closes.length < 15 || !closes.every(close => Number.isFinite(close) && close > 0)) throw new Error('The baseline agent needs at least 15 positive daily closes.')
  if (!(horizonDays > 0 && horizonDays <= 60)) throw new Error('The forecast horizon must be between 0 and 60 days.')
  const logs = closes.slice(1).map((close, index) => Math.log(close / closes[index]!))
  const mu = logs.reduce((sum, value) => sum + value, 0) / logs.length
  const sigma = Math.sqrt(logs.reduce((sum, value) => sum + (value - mu) ** 2, 0) / (logs.length - 1))
  const drift = Math.max(-0.1, Math.min(0.1, 0.5 * mu * horizonDays))
  const half = Math.max(Math.log(1.03), Math.min(Math.log(1.2), sigma * Math.sqrt(horizonDays)))
  const last = closes.at(-1)!
  const cents = (value: number) => Math.round(value * 100) / 100
  return { lastClose: last, center: cents(last * Math.exp(drift)), low: cents(last * Math.exp(drift - half)), high: cents(last * Math.exp(drift + half)), mu, sigma }
}
