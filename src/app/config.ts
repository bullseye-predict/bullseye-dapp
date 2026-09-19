import type { MarketSource } from '../components/home/MarketSourceControls'

const clean = (value: unknown) => String(value ?? '').trim()

const validSources = new Set<MarketSource>(['SIMULATION', 'SOLANA', 'SOMNIA'])
const configuredSources = clean(import.meta.env.PUBLIC_ARENA_MARKET_SOURCES || 'SIMULATION,SOLANA,SOMNIA')
  .split(',')
  .map((value) => value.trim().toUpperCase())
  .filter((value): value is MarketSource => validSources.has(value as MarketSource))

// packages/sdk/prediction-url.ts resolves every path with `new URL(path, base)`,
// which throws "Invalid URL" on a relative base. SiteLayout.astro built this as
// an absolute same-origin URL from Astro.url; the SPA has to do the same itself.
const sameOrigin = (path: string) =>
  typeof window === 'undefined' ? path : new URL(path, window.location.origin).toString()

export const appConfig = {
  predictionProxyUrl: sameOrigin('/api/prediction'),
  publicPredictionApiUrl: clean(import.meta.env.PUBLIC_PREDICTION_API_URL),
  environmentId: clean(import.meta.env.VITE_DYNAMIC_ENVIRONMENT_ID),
  colacatMint: clean(import.meta.env.PUBLIC_COLACAT_MINT),
  livestreamUrl: clean(import.meta.env.PUBLIC_LIVESTREAM_HLS_URL),
  gameOrigin: clean(__SOLZ_GAME_ORIGIN__).replace(/\/+$/, ''),
  marketSources: configuredSources.length ? configuredSources : ['SIMULATION'] satisfies MarketSource[],
}

export const predictionApiUrl = appConfig.publicPredictionApiUrl || appConfig.predictionProxyUrl
export const liveMarketSources = appConfig.marketSources.filter(
  (source): source is Exclude<MarketSource, 'SIMULATION'> => source !== 'SIMULATION',
)
