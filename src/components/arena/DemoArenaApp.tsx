import '../../styles/global.css'
import '../../styles/arena.css'
import { useMemo } from 'react'
import { useWalletAddress } from '../session/store'
import { createDemoArenaAdapter } from './demoArenaAdapter'
import { SolzPredictionArena } from './SolzPredictionArena'

/** The wallet session belongs to the persisted chrome island now, so the arena
 *  reads the connected address from the store instead of being handed it. */
export function DemoArenaApp() {
  const adapter = useMemo(() => createDemoArenaAdapter(), [])
  return <SolzPredictionArena adapter={adapter} walletAddress={useWalletAddress()} walletReady />
}
