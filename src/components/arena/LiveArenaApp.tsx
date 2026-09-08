import '../../styles/global.css'
import '../../styles/arena.css'
import { useMemo } from 'react'
import { DynamicSolanaSession, type DynamicSolanaSessionValue } from './DynamicSolanaSession'
import { createLiveArenaAdapter } from './liveArenaAdapter'
import { SolzPredictionArena } from './SolzPredictionArena'

function LiveArena({ session, overviewUrl }: { session: DynamicSolanaSessionValue; overviewUrl: string }) {
  const adapter = useMemo(() => createLiveArenaAdapter(session.wallet, { overviewUrl }), [session.wallet, overviewUrl])
  return <SolzPredictionArena adapter={adapter} walletAddress={session.walletAddress} walletReady={session.walletReady} walletControl={session.walletControl} />
}

export function LiveArenaApp({ environmentId, overviewUrl = '/api/solz/overview' }: { environmentId: string; overviewUrl?: string }) {
  return <DynamicSolanaSession environmentId={environmentId}>{(session) => <LiveArena session={session} overviewUrl={overviewUrl} />}</DynamicSolanaSession>
}
