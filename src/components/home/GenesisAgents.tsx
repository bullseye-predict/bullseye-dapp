import '../../styles/genesis.css'
import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import { useRef, useState } from 'react'
import type { SolzSnapshot } from '../solz/model'
import { accentStyle, AgentPortrait, percent } from './HomePrimitives'
import { GenesisProfile } from './GenesisProfile'
import { GenesisBreeding } from './GenesisBreeding'

export function GenesisAgents({ snapshot, onPrompt }: { snapshot: SolzSnapshot; onPrompt: (agentId: string) => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const anchor = useRef<HTMLButtonElement | null>(null)
  const selected = snapshot.agents.find((agent) => agent.id === selectedId)
  const closeProfile = (restoreFocus: boolean) => { setSelectedId(null); if (restoreFocus) anchor.current?.focus({ preventScroll: true }) }
  return <section className="sh-genesis" id="agents">
    <div className="sh-section-heading"><h2>GENESIS AGENTS<span>THE ORIGINAL 12</span></h2><a className="ga-breeding-link" href="#genesis-breeding">BREEDING & ROYALTIES <ArrowDownRight size={16}/></a></div>
    <div className="ga-collection-intro"><p className="sh-genesis-description">The founding generation. Early training shapes their instincts; Genesis lineage becomes the foundation for breeding agents you own.</p><span>TRAINING · LINEAGE · OWNERSHIP</span></div>
    <div className="sh-agent-grid">{snapshot.agents.map((agent) => {
      const playing = snapshot.matches.some((match) => match.phase === 'live' && match.roster.some((entry) => entry.agentId === agent.id))
      return <button className={`sh-agent-card ${selectedId === agent.id ? 'is-selected' : ''}`} key={agent.id} style={accentStyle(agent.color)} onClick={(event) => { anchor.current = event.currentTarget; setSelectedId(selectedId === agent.id ? null : agent.id) }} aria-expanded={selectedId === agent.id} aria-haspopup="dialog" aria-controls={selectedId === agent.id ? `genesis-profile-${agent.id}` : undefined} aria-label={`View ${agent.codename}, Genesis agent ${agent.number}`}>
        <div className="sh-agent-card-label"><span>GENESIS #{String(agent.number).padStart(2, '0')}</span><span>{playing ? 'IN MATCH' : 'RESERVE'}<i/></span></div>
        <AgentPortrait number={agent.number}/><div className="sh-agent-card-name"><h3>{agent.codename}</h3><ArrowUpRight size={19}/><span>{agent.archetype}</span></div><div className="sh-agent-card-stats"><span>{agent.matches} MATCHES</span><span>{percent(agent.winRate)} WIN RATE</span></div>
      </button>
    })}</div>
    {selected && anchor.current && <GenesisProfile key={selected.id} agent={selected} snapshot={snapshot} anchor={anchor.current} onClose={closeProfile} onPrompt={onPrompt}/>}
    <div className="sh-genesis-foot"><span>12 ORIGINALS. THE START OF EVERY LINEAGE.</span><span>GENERATION 0 <span aria-hidden="true">✳</span></span></div>
    <GenesisBreeding/>
  </section>
}
