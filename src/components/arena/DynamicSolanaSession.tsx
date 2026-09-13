import { WalletCards } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { setSession } from '../session/store'
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

/** Publishes the session to the store on the way through, so every consumer
 *  below reads the wallets from one place instead of being handed them down a
 *  chain of components that do not use them. The render prop is untouched:
 *  walletControl is a ReactNode slot and stays a prop. */
function PublishSession({ session, children }: { session: DynamicSolanaSessionValue; children: (session: DynamicSolanaSessionValue) => ReactNode }) {
  const { wallet, evmWallet, walletAddress, walletReady } = session
  useEffect(() => {
    setSession({ solanaWallet: wallet, evmWallet, walletAddress, walletReady })
  }, [wallet, evmWallet, walletAddress, walletReady])
  return <>{children(session)}</>
}

export function DynamicSolanaSession({ children, environmentId, predictionApiUrl = '', allowEvm = false }: Props) {
  const publish = (session: DynamicSolanaSessionValue) => <PublishSession session={session}>{children}</PublishSession>
  if (!environmentId) {
    return publish({
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
  if (!allowEvm) return <DynamicWaasSolanaSessionClient environmentId={environmentId} predictionApiUrl={predictionApiUrl}>{publish}</DynamicWaasSolanaSessionClient>
  return <DynamicSolanaSessionClient environmentId={environmentId} predictionApiUrl={predictionApiUrl} allowEvm>{publish}</DynamicSolanaSessionClient>
}
