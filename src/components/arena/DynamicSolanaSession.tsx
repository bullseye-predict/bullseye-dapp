import { WalletCards } from 'lucide-react'
import type { ReactNode } from 'react'
import DynamicSolanaSessionClient from './DynamicSolanaSessionClient'
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
  children: (session: DynamicSolanaSessionValue) => ReactNode
}

export function DynamicSolanaSession({ children, environmentId }: Props) {
  if (!environmentId) {
    return children({
      wallet: null,
      evmWallet: null,
      walletReady: false,
      walletControl: <button className="arena-wallet-button" type="button" disabled><WalletCards size={15} aria-hidden="true" /> Dynamic setup required</button>,
    })
  }

  // Both arena routes are client-only because Dynamic owns browser wallet transports; keeping one React island also prevents a second hook dispatcher.
  return <DynamicSolanaSessionClient environmentId={environmentId}>{children}</DynamicSolanaSessionClient>
}
