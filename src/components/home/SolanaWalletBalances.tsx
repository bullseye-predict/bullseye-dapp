import { useEffect, useState } from 'react'
import { getPredictionConfig } from '../../../packages/sdk/PredictionTradingClient'
import {
  readSolanaWalletBalances,
  type SolanaWalletBalances as BalanceValue,
} from '../../../packages/adapters/solana/wallet-balances'
import { publicSolanaVenue } from './solanaVenueFallback'
import { schedulePoll } from './venue/pollGate'
import { noteRpcThrottled } from '../../../packages/adapters/solana/manifest/throttle'

type Props = {
  address: string
  apiUrl?: string
  colacatMint?: string
}
const CACHE_MAX_AGE_MS = 2 * 60_000
const CACHE_PREFIX = 'coola:solana-wallet:v3:'

function cacheKey(apiUrl: string, address: string, colacatMint: string) { return `${CACHE_PREFIX}${apiUrl}:${address}:${colacatMint}` }
function readCachedBalance(apiUrl: string, address: string, colacatMint: string): BalanceValue | null {
  if (typeof window === 'undefined') return null
  try {
    const value = JSON.parse(window.localStorage.getItem(cacheKey(apiUrl, address, colacatMint)) ?? '') as { at?: unknown; nativeLamports?: unknown; tokens?: unknown }
    const at = value.at
    if (typeof at !== 'number' || !Number.isSafeInteger(at) || Date.now() - at > CACHE_MAX_AGE_MS || typeof value.nativeLamports !== 'string' || !value.tokens || typeof value.tokens !== 'object') return null
    const tokens = Object.fromEntries(Object.entries(value.tokens).filter((entry): entry is [string, string] => typeof entry[1] === 'string').map(([symbol, amount]) => [symbol, BigInt(amount)]))
    return { nativeLamports: BigInt(value.nativeLamports), tokens }
  } catch { return null }
}
function writeCachedBalance(apiUrl: string, address: string, colacatMint: string, value: BalanceValue) {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(cacheKey(apiUrl, address, colacatMint), JSON.stringify({ at: Date.now(), nativeLamports: value.nativeLamports.toString(), tokens: Object.fromEntries(Object.entries(value.tokens).map(([symbol, amount]) => [symbol, amount.toString()])) })) }
  catch { /* Storage is optional; live values still render. */ }
}

function compact(amount: bigint, decimals: number) {
  const base = 10n ** BigInt(decimals)
  const whole = amount / base
  const fraction = (amount % base).toString().padStart(decimals, '0').slice(0, 4).replace(/0+$/, '')
  return `${whole.toLocaleString()}${fraction ? `.${fraction}` : ''}`
}

/** Compact read-only Solana wallet overview for the shared site header. */
export function SolanaWalletBalances({ address, apiUrl = '', colacatMint = '' }: Props) {
  const [value, setValue] = useState<BalanceValue | null>(null)
  const [assets, setAssets] = useState<readonly SolanaWalletAssetView[]>([])
  const [error, setError] = useState(false)

  useEffect(() => {
    setValue(null)
    setAssets([])
    setError(false)
    if (!apiUrl) return
    let active = true
    let cancelPoll: (() => void) | undefined
    let retryDelay = 15_000
    const cached = readCachedBalance(apiUrl, address, colacatMint)
    if (cached) setValue(cached)
    const load = async () => {
      try {
        const config = await getPredictionConfig(apiUrl, AbortSignal.timeout(10_000))
        const venue = config.venues.find((item) => item.family === 'SOLANA' && item.publicRpcUrl) ?? publicSolanaVenue()
        if (!venue?.publicRpcUrl) throw new Error('Solana RPC unavailable')
        const nextAssets = walletAssets(colacatMint)
        if (active) setAssets(nextAssets)
        const next = await readSolanaWalletBalances(venue.publicRpcUrl, address, nextAssets)
        if (active) { writeCachedBalance(apiUrl, address, colacatMint, next); setValue(next); setError(false); retryDelay = 15_000 }
      } catch (reason) {
        if (/429|rate limit/i.test(reason instanceof Error ? reason.message : String(reason))) noteRpcThrottled()
        if (active) { setError(true); retryDelay = Math.min(retryDelay * 2, 120_000) }
      } finally {
        if (active) cancelPoll = schedulePoll(() => void load(), retryDelay)
      }
    }
    // The header must not be the request that immediately re-triggers a 429
    // after a route change. Cached values stay visible; the shared gate decides
    // when one fresh read is appropriate.
    cancelPoll = schedulePoll(() => void load(), cached ? 15_000 : 0)
    return () => { active = false; cancelPoll?.() }
  }, [address, apiUrl, colacatMint])

  if (!apiUrl) return null
  const pending = error ? 'Retrying…' : 'Loading…'
  const title = error ? 'Prediction backend or Solana RPC unavailable. Retrying automatically.' : undefined
  return <section className="ch-wallet-overview" aria-label="Solana wallet balances" aria-live="polite" data-state={error ? 'retrying' : value ? 'ready' : 'loading'} title={title}>
    <span className="ch-wallet-metric"><small>Native</small><b>{value ? compact(value.nativeLamports, 9) : pending}{value ? ' SOL' : ''}</b></span>
    {assets.map((asset) => <span className="ch-wallet-metric" key={asset.mint}><small>Balance</small><b>{value ? `${compact(value.tokens[asset.symbol] ?? 0n, asset.decimals)} ${asset.symbol}` : pending}</b></span>)}
  </section>
}

type SolanaWalletAssetView = { symbol: string; mint: string; decimals: number }

function walletAssets(colacatMint: string): readonly SolanaWalletAssetView[] {
  return colacatMint ? [{ symbol: 'COLACAT', mint: colacatMint, decimals: 9 }] : []
}
