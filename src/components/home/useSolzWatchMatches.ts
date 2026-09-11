import { useEffect, useState } from 'react'

export type SolzWatchMatch = {
  id: string
  region: string
  phase: 'live' | 'countdown' | 'waiting'
  mode: string
  players: number
  capacity: number
  spectators: number
  startedAt: number | null
  watchUrl: string
}

type State = { matches: SolzWatchMatch[]; loading: boolean; error: string }

function parse(value: unknown): SolzWatchMatch[] {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { matches?: unknown }).matches)) return []
  return (value as { matches: unknown[] }).matches.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const row = item as Record<string, unknown>
    if (typeof row.id !== 'string' || typeof row.region !== 'string' || typeof row.watchUrl !== 'string') return []
    const phase = row.phase === 'countdown' || row.phase === 'waiting' ? row.phase : 'live'
    return [{
      id: row.id, region: row.region, phase, mode: typeof row.mode === 'string' ? row.mode : 'Arena match',
      players: Math.max(0, Number(row.players) || 0), capacity: Math.max(1, Number(row.capacity) || 1),
      spectators: Math.max(0, Number(row.spectators) || 0), startedAt: typeof row.startedAt === 'number' && row.startedAt > 0 ? row.startedAt : null,
      watchUrl: row.watchUrl,
    }]
  })
}

export function useSolzWatchMatches() {
  const [state, setState] = useState<State>({ matches: [], loading: true, error: '' })
  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const response = await fetch('/api/solz/overview', { headers: { accept: 'application/json' } })
        const value = await response.json().catch(() => null)
        if (!response.ok) throw Error(typeof (value as { message?: unknown })?.message === 'string' ? (value as { message: string }).message : 'The SOLZ match feed is unavailable.')
        if (active) setState({ matches: parse(value), loading: false, error: '' })
      } catch (reason) {
        if (active) setState((current) => ({ ...current, loading: false, error: reason instanceof Error ? reason.message : 'The SOLZ match feed is unavailable.' }))
      }
    }
    void load()
    const timer = window.setInterval(() => void load(), 10_000)
    return () => { active = false; window.clearInterval(timer) }
  }, [])
  return state
}
