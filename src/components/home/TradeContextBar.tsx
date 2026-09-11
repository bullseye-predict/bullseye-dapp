import { AudioLines } from 'lucide-react'
import type { ReactNode } from 'react'

type Props = {
  simulation: boolean
  onSimulationChange: (enabled: boolean) => void
  liveMatchCount: number
  networkControls?: ReactNode
}

export function TradeContextBar({ simulation, onSimulationChange, liveMatchCount, networkControls }: Props) {
  const matchLabel = simulation
    ? `${liveMatchCount} SAMPLE ${liveMatchCount === 1 ? 'MATCH' : 'MATCHES'}`
    : `${liveMatchCount} LIVE ${liveMatchCount === 1 ? 'MATCH' : 'MATCHES'}`

  return <div className="ch-trade-context" aria-label="Trade context">
    {networkControls}
    <button type="button" role="switch" aria-checked={simulation} aria-label="Simulation" title="Switch simulated and reference charts" className="ch-simulation-toggle" onClick={() => onSimulationChange(!simulation)}><span className="ch-switch-track"><i/></span><span>Chart simulation <b>{simulation ? 'ON' : 'OFF'}</b></span></button>
    <span className="sh-live-count"><AudioLines size={16}/>{networkControls ? matchLabel : `${liveMatchCount} ${liveMatchCount === 1 ? 'MATCH' : 'MATCHES'} IN PROGRESS`}</span>
  </div>
}
