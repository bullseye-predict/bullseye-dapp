/** Public PANTA catalogue contract. PANTA prices are USDC/share, not probabilities
 * or quotes from our Manifest books. Source: https://docs.panta.market/api-reference/markets/list */
export const PANTA_CATEGORIES = ['sports', 'crypto', 'politics', 'entertainment', 'finance', 'science', 'world', 'other'] as const
export type PantaCategory = typeof PANTA_CATEGORIES[number]
export const PANTA_PHASES = ['primary', 'secondary', 'resolved', 'cancelled'] as const
export type PantaPhase = typeof PANTA_PHASES[number]
/** Standard: an event planned ahead, 50 USDC to create. Breaking: news or a
 *  fast event, 20 USDC, a short primary window. Source: panta.market/how-it-works */
export const PANTA_MARKET_TYPES = ['standard', 'breaking'] as const
export type PantaMarketType = typeof PANTA_MARKET_TYPES[number]
export type PantaMarket = {
  marketId: string
  title: string
  description: string
  category: string
  phase: PantaPhase
  startTime: number
  endTime: number
  resolutionTime: number
  volumeUsdc: string | null
  yesPrice: string | null
  noPrice: string | null
  imageUrl: string | null
  marketType: PantaMarketType | null
}
export type PantaPage = { items: PantaMarket[]; nextCursor: string | null }
export const isPantaMarketId = (value: unknown): value is string => typeof value === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)
export const pantaMarketUrl = (marketId: string) => `https://www.panta.market/dashboard/user/event/${encodeURIComponent(marketId)}`

const amount = (value: unknown) => typeof value === 'string' && /^\d{1,20}(?:\.\d{1,12})?$/.test(value) ? value : null
const timestamp = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value < 8_640_000_000_000

/** A public HTTPS URL: no credentials, no local or private host. */
export function publicHttpsUrl(value: unknown, label: string, max = 2048): string {
  if (typeof value !== 'string' || value.trim().length < 8 || value.length > max) throw new Error(`${label} must be a public HTTPS URL.`)
  let url: URL
  try { url = new URL(value.trim()) } catch { throw new Error(`${label} must be a public HTTPS URL.`) }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.') || url.hostname.endsWith('.local')
    || /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(url.hostname)) throw new Error(`${label} must be a public HTTPS URL.`)
  return url.toString()
}
const image = (value: unknown) => { try { return publicHttpsUrl(value, 'image') } catch { return null } }

export function parsePantaMarket(value: unknown, detail = true): PantaMarket {
  const row = value as Record<string, unknown> | null
  if (!row || !isPantaMarketId(row.marketId) || typeof row.title !== 'string' || !row.title.trim()
    || row.title.length > 512 || !PANTA_PHASES.includes(row.phase as PantaPhase)
    || !timestamp(row.startTime) || !timestamp(row.endTime) || !timestamp(row.resolutionTime)
    || row.startTime >= row.endTime || row.endTime > row.resolutionTime) throw new Error('Invalid PANTA market response.')
  return {
    marketId: row.marketId, title: row.title, description: typeof row.description === 'string' ? row.description.slice(0, 10_000) : '',
    category: typeof row.category === 'string' ? row.category.slice(0, 80) : 'other', phase: row.phase as PantaPhase,
    startTime: row.startTime, endTime: row.endTime, resolutionTime: row.resolutionTime,
    volumeUsdc: amount(row.volumeUsdc), yesPrice: detail ? amount(row.yesPrice) : null, noPrice: detail ? amount(row.noPrice) : null,
    imageUrl: Array.isArray(row.images) ? row.images.map(image).find(url => url !== null) ?? null : null,
    marketType: PANTA_MARKET_TYPES.includes(row.marketType as PantaMarketType) ? row.marketType as PantaMarketType : null,
  }
}

export function parsePantaPage(value: unknown): PantaPage {
  const page = value as Record<string, unknown> | null
  if (!page || !Array.isArray(page.items) || page.items.length > 50
    || (page.nextCursor != null && !isPantaMarketId(page.nextCursor))) throw new Error('Invalid PANTA catalogue response.')
  return { items: page.items.map(row => parsePantaMarket(row, false)), nextCursor: typeof page.nextCursor === 'string' ? page.nextCursor : null }
}

/** What a wallet asks PANTA to create. Checked here before any PANTA call,
 *  with the same limits PANTA documents for POST /markets/create/quote/. */
export type PantaCreateDraft = {
  question: string
  title?: string
  description?: string
  resolutionRule: string
  sourcesOfTruth: string[]
  category: PantaCategory
  startTime: number
  endTime: number
  resolutionTime: number
  imageUrl: string
  marketType: PantaMarketType
  eventInProgress?: boolean
}

/** PANTA refuses a start sooner than its on-chain `minimumStartDelay`,
 *  typically one hour, unless a breaking market's event is already under way. */
export const PANTA_MINIMUM_START_DELAY_SECONDS = 3600

export function parsePantaCreateDraft(value: unknown, nowSeconds: number): PantaCreateDraft {
  const row = value as Record<string, unknown> | null
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Enter the market to create.')
  const text = (input: unknown, label: string, min: number, max: number) => {
    if (typeof input !== 'string' || input.trim().length < min || input.trim().length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input)) throw new Error(`${label} must be ${min}–${max} characters.`)
    return input.trim().replace(/\r\n?/g, '\n')
  }
  const optional = (input: unknown, label: string, max: number) => input === undefined || input === null || input === '' ? undefined : text(input, label, 1, max)
  const question = text(row.question, 'Question', 12, 512)
  const resolutionRule = text(row.resolutionRule, 'Resolution rules', 30, 2048)
  if (!PANTA_CATEGORIES.includes(row.category as PantaCategory)) throw new Error('Choose a category.')
  const marketType = (row.marketType ?? 'standard') as PantaMarketType
  if (!PANTA_MARKET_TYPES.includes(marketType)) throw new Error('Choose a standard or a breaking market.')
  const eventInProgress = row.eventInProgress === true
  if (eventInProgress && marketType !== 'breaking') throw new Error('Only a breaking market can cover an event already in progress.')
  const { startTime, endTime, resolutionTime } = row
  if (!timestamp(startTime) || !timestamp(endTime) || !timestamp(resolutionTime)) throw new Error('Enter the start, end and resolution times.')
  if (!(startTime < endTime && endTime <= resolutionTime)) throw new Error('The market must start before it ends, and resolve no earlier than it ends.')
  if (!eventInProgress && startTime < nowSeconds + PANTA_MINIMUM_START_DELAY_SECONDS) throw new Error('The market must start at least one hour from now.')
  if (endTime <= nowSeconds || resolutionTime > nowSeconds + 5 * 366 * 86_400) throw new Error('The market must end in the future and resolve within five years.')
  if (!Array.isArray(row.sourcesOfTruth) || row.sourcesOfTruth.length < 1 || row.sourcesOfTruth.length > 5) throw new Error('Add between one and five public source URLs.')
  const sourcesOfTruth = [...new Set(row.sourcesOfTruth.map(source => publicHttpsUrl(source, 'Each source')))]
  const imageUrl = publicHttpsUrl(row.imageUrl, 'The market image')
  const title = optional(row.title, 'Title', 512)
  const description = optional(row.description, 'Description', 2000)
  return {
    question, resolutionRule, sourcesOfTruth, category: row.category as PantaCategory, startTime, endTime, resolutionTime, imageUrl, marketType,
    ...(title ? { title } : {}), ...(description ? { description } : {}), ...(eventInProgress ? { eventInProgress } : {}),
  }
}

/** PANTA's answer to a quote. Amounts are USDC base units (6 decimals). */
export type PantaQuote = {
  createId: string
  expectedEventPda: string
  paymentUsdc: string
  liquidityInjectionUsdc: string
  platformRevenueUsdc: string
  marketType: PantaMarketType
  expiresAt: string
}

const baseUnits = (value: unknown) => typeof value === 'string' && /^\d{1,15}$/.test(value)
export const isPantaCreateId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{4,128}$/.test(value)

export function parsePantaQuote(value: unknown): PantaQuote {
  const row = value as Record<string, unknown> | null
  if (!row || !isPantaCreateId(row.createId) || !isPantaMarketId(row.expectedEventPda) || !baseUnits(row.paymentUsdc)
    || !baseUnits(row.liquidityInjectionUsdc) || !baseUnits(row.platformRevenueUsdc)
    || !PANTA_MARKET_TYPES.includes(row.marketType as PantaMarketType) || typeof row.expiresAt !== 'string' || !Number.isFinite(Date.parse(row.expiresAt))) throw new Error('Invalid PANTA quote response.')
  return {
    createId: row.createId, expectedEventPda: row.expectedEventPda, paymentUsdc: row.paymentUsdc as string,
    liquidityInjectionUsdc: row.liquidityInjectionUsdc as string, platformRevenueUsdc: row.platformRevenueUsdc as string,
    marketType: row.marketType as PantaMarketType, expiresAt: row.expiresAt,
  }
}

/** A USDC base-unit string as dollars, for display only. */
export const usdcFromBaseUnits = (value: string) => Number(BigInt(value)) / 1_000_000

/** A PANTA market as ColaCat tracks it: imported from PANTA or created here.
 *  `last*` is our own latest snapshot, not a live PANTA read. */
export type PantaTrackedMarket = {
  marketId: string
  title: string
  category: string
  phase: PantaPhase
  endTime: number
  imageUrl: string | null
  groupId: string | null
  groupTitle: string | null
  source: 'imported' | 'created'
  trackedSince: string
  lastYes: string | null
  lastNo: string | null
  lastAt: string | null
}
/** Our own grouping of PANTA markets into one linked event. PANTA has no
 *  grouped markets; a group id always contains a hyphen, which a base58
 *  market id never does, so one route can serve both. */
export const isPantaGroupId = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{2,79}$/.test(value) && value.includes('-')
