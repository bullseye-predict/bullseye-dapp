import type { MarketSource } from '../components/home/MarketSourceControls'

const clean = (value: unknown) => String(value ?? '').trim()

const validSources = new Set<MarketSource>(['SIMULATION', 'SOLANA', 'SOMNIA'])
const configuredSources = clean(import.meta.env.PUBLIC_ARENA_MARKET_SOURCES || 'SIMULATION,SOLANA,SOMNIA')
  .split(',')
  .map((value) => value.trim().toUpperCase())
  .filter((value): value is MarketSource => validSources.has(value as MarketSource))

export const appConfig = {
  predictionProxyUrl: '/api/prediction',
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
