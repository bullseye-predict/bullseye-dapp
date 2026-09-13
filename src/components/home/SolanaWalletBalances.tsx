import { useEffect, useState } from 'react'
import { getPredictionConfig } from '../../../packages/sdk/PredictionTradingClient'
import {
  readSolanaWalletBalances,
  SOLANA_DEVNET_WALLET_ASSETS,
  type SolanaWalletBalances as BalanceValue,
} from '../../../packages/adapters/solana/wallet-balances'

type Props = {
  address: string
  apiUrl?: string
}

function compact(amount: bigint, decimals: number) {
  const base = 10n ** BigInt(decimals)
  const whole = amount / base
  const fraction = (amount % base).toString().padStart(decimals, '0').slice(0, 4).replace(/0+$/, '')
  return `${whole.toLocaleString()}${fraction ? `.${fraction}` : ''}`
}

/** Compact read-only Solana wallet overview for the shared site header. */
export function SolanaWalletBalances({ address, apiUrl = '' }: Props) {
  const [value, setValue] = useState<BalanceValue | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    setValue(null)
    setError(false)
    if (!apiUrl) return
    let active = true
    let timer: number | undefined
    let retryDelay = 15_000
    const load = async () => {
      try {
        const config = await getPredictionConfig(apiUrl, AbortSignal.timeout(10_000))
        const venue = config.venues.find((item) => item.family === 'SOLANA' && item.publicRpcUrl)
        if (!venue?.publicRpcUrl) throw new Error('Solana RPC unavailable')
        const next = await readSolanaWalletBalances(venue.publicRpcUrl, address, SOLANA_DEVNET_WALLET_ASSETS)
        if (active) { setValue(next); setError(false); retryDelay = 15_000 }
      } catch {
        if (active) { setError(true); retryDelay = Math.min(retryDelay * 2, 120_000) }
      } finally {
        if (active) timer = window.setTimeout(() => void load(), retryDelay)
      }
    }
    void load()
    return () => { active = false; if (timer) window.clearTimeout(timer) }
  }, [address, apiUrl])

  if (!apiUrl) return null
  const pending = error ? 'Retrying…' : 'Loading…'
  const title = error ? 'Prediction backend or Solana RPC unavailable. Retrying automatically.' : undefined
  return <section className="ch-wallet-overview" aria-label="Solana wallet balances" aria-live="polite" data-state={error ? 'retrying' : value ? 'ready' : 'loading'} title={title}>
    <span className="ch-wallet-metric"><small>Native</small><b>{value ? compact(value.nativeLamports, 9) : pending}{value ? ' SOL' : ''}</b></span>
    {SOLANA_DEVNET_WALLET_ASSETS.map((asset) => <span className="ch-wallet-metric" key={asset.mint}><small>Balance</small><b>{value ? `${compact(value.tokens[asset.symbol] ?? 0n, asset.decimals)} ${asset.symbol}` : pending}</b></span>)}
  </section>
}
