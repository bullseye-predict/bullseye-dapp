import '../../styles/global.css'
import '../../styles/arena.css'
import { useMemo } from 'react'
import { DynamicSolanaSession, type DynamicSolanaSessionValue } from './DynamicSolanaSession'
import { createDemoArenaAdapter } from './demoArenaAdapter'
import { SolzPredictionArena } from './SolzPredictionArena'

function DemoArena({ session }: { session: DynamicSolanaSessionValue }) {
  const adapter = useMemo(() => createDemoArenaAdapter(), [])
  return <SolzPredictionArena adapter={adapter} walletAddress={session.walletAddress} walletReady walletControl={session.walletControl} />
}

export function DemoArenaApp({ environmentId }: { environmentId: string }) {
  return <DynamicSolanaSession environmentId={environmentId}>{(session) => <DemoArena session={session} />}</DynamicSolanaSession>
}
