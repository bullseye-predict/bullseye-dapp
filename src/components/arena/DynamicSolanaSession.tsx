import { WalletCards } from 'lucide-react'
import type { ReactNode } from 'react'
import DynamicSolanaSessionClient from './DynamicSolanaSessionClient'
import type { LiveArenaWalletPort } from './liveArenaAdapter'

export type DynamicSolanaSessionValue = {
  wallet: LiveArenaWalletPort | null
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
      walletReady: false,
      walletControl: <button className="arena-wallet-button" type="button" disabled><WalletCards size={15} aria-hidden="true" /> Dynamic setup required</button>,
    })
  }

  // Both arena routes are client-only because Dynamic owns browser wallet transports; keeping one React island also prevents a second hook dispatcher.
  return <DynamicSolanaSessionClient environmentId={environmentId}>{children}</DynamicSolanaSessionClient>
}
