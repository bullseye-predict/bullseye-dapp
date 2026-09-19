/// <reference types="vite/client" />

declare const __SOLZ_GAME_ORIGIN__: string

interface ImportMetaEnv {
  readonly PUBLIC_ARENA_MARKET_SOURCES?: string
  readonly PUBLIC_COLACAT_MINT?: string
  readonly PUBLIC_LIVESTREAM_HLS_URL?: string
  readonly PUBLIC_PREDICTION_API_URL?: string
  readonly PUBLIC_PREDICTION_CLUSTER?: string
  readonly PUBLIC_PREDICTION_COLLATERAL_DECIMALS?: string
  readonly PUBLIC_PREDICTION_COLLATERAL_MINT?: string
  readonly PUBLIC_PREDICTION_COLLATERAL_SYMBOL?: string
  readonly PUBLIC_PREDICTION_MANIFEST_PROGRAM_ID?: string
  readonly PUBLIC_PREDICTION_PROGRAM_ID?: string
  readonly VITE_DYNAMIC_ENVIRONMENT_ID?: string
  readonly VITE_SOLANA_RPC_ENDPOINT?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
