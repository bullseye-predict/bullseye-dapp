import '../../styles/global.css'
import '../../styles/arena.css'
import { useMemo } from 'react'
import { useSolanaWallet, useWalletAddress, useWalletReady } from '../session/store'
import { createLiveArenaAdapter } from './liveArenaAdapter'
import { SolzPredictionArena } from './SolzPredictionArena'

/** The wallet session belongs to the persisted chrome island now, so the arena
 *  reads the connected wallet from the store instead of being handed it. */
export function LiveArenaApp({ overviewUrl = '/api/solz/overview' }: { overviewUrl?: string }) {
  const wallet = useSolanaWallet()
  const adapter = useMemo(() => createLiveArenaAdapter(wallet, { overviewUrl }), [wallet, overviewUrl])
  return <SolzPredictionArena adapter={adapter} walletAddress={useWalletAddress()} walletReady={useWalletReady()} />
}
