import { WalletCards } from 'lucide-react'
import type { ReactNode } from 'react'
import DynamicSolanaSessionClient from './DynamicSolanaSessionClient'
import DynamicWaasSolanaSessionClient from './DynamicWaasSolanaSessionClient'
import type { LiveArenaWalletPort } from './liveArenaAdapter'
import type { WalletClient } from 'viem'

export type DynamicEvmWalletPort = {
  address: string
  getWalletClient(chainId?: string): Promise<WalletClient>
}

export type DynamicSolanaSessionValue = {
  wallet: LiveArenaWalletPort | null
  evmWallet: DynamicEvmWalletPort | null
  walletAddress?: string
  walletReady: boolean
  walletControl: ReactNode
}

type Props = {
  environmentId: string
  predictionApiUrl?: string
  /** Enables the optional Somnia/EVM wallet flow. Solana is always available. */
  allowEvm?: boolean
  children: (session: DynamicSolanaSessionValue) => ReactNode
}

export function DynamicSolanaSession({ children, environmentId, predictionApiUrl = '', allowEvm = false }: Props) {
  if (!environmentId) {
    return children({
      wallet: null,
      evmWallet: null,
      walletReady: false,
      walletControl: <button className="arena-wallet-button" type="button" disabled><WalletCards size={15} aria-hidden="true" /> Dynamic setup required</button>,
    })
  }

  // The Solana-only prediction build uses the same modular Dynamic/WaaS
  // lifecycle as zero-engine. Keep the legacy mixed-chain client only for the
  // existing Somnia build until its EVM environment is moved to the modular
  // client; this prevents the Solana fix from regressing DreamDEX.
  if (!allowEvm) return <DynamicWaasSolanaSessionClient environmentId={environmentId} predictionApiUrl={predictionApiUrl}>{children}</DynamicWaasSolanaSessionClient>
  return <DynamicSolanaSessionClient environmentId={environmentId} predictionApiUrl={predictionApiUrl} allowEvm>{children}</DynamicSolanaSessionClient>
}
