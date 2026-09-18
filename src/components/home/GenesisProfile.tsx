import { ArrowDownRight, ArrowUpRight, Dna, X } from 'lucide-react'
import type { GenesisAgent, SolzSnapshot } from '../solz/model'
import { accentStyle, percent } from './HomePrimitives'
import { AgentTraitRadar } from './AgentTraitRadar'
import { useAgentPopover } from './useAgentPopover'

type Props = { agent: GenesisAgent; snapshot: SolzSnapshot; anchor: HTMLButtonElement; onClose: (restoreFocus: boolean) => void; onPrompt: (id: string) => void }
export function GenesisProfile({ agent, snapshot, anchor, onClose, onPrompt }: Props) {
  const { panel, position } = useAgentPopover(anchor, onClose)
  const playing = snapshot.matches.find((match) => match.phase === 'live' && match.roster.some((entry) => entry.agentId === agent.id && entry.status === 'active'))
  return <div ref={panel} id={`genesis-profile-${agent.id}`} className="ga-profile" popover="manual" role="dialog" aria-modal="false" aria-labelledby={`genesis-name-${agent.id}`} tabIndex={-1} style={{ ...accentStyle(agent.color), left: position.left, top: position.top, width: position.width }} data-side={position.side}>
    <header className="ga-profile-heading"><div><span>GENESIS #{String(agent.number).padStart(2, '0')} / {agent.archetype}</span><h3 id={`genesis-name-${agent.id}`}>{agent.codename}<span>G0</span></h3>{agent.subname && <b className="ga-profile-subname">{agent.subname}</b>}</div><button aria-label="Close agent profile" onClick={() => onClose(true)}><X size={20}/></button></header>
    <p className="ga-profile-bio">{agent.bio}</p>
    <div className="ga-profile-main"><div className="ga-agent-record"><h4>ARENA RECORD</h4><dl>{[['Matches', agent.matches], ['Wins / losses', `${agent.wins} / ${agent.losses}`], ['Win rate', percent(agent.winRate)], ['Eliminations', agent.kills], ['Objectives', agent.objectives], ['Rating', agent.rating]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><div className="ga-lineage-tag"><Dna size={15}/><span>FOUNDING BLOODLINE<small>Early training generation</small></span></div></div>{agent.traits && <AgentTraitRadar name={agent.codename} traits={agent.traits}/>}</div>
    <p className="ga-profile-history">REPRESENTED <span>{agent.teamHistory.map((id) => snapshot.teams.find((team) => team.id === id)?.symbol).filter(Boolean).join(' / ')}</span></p>
    <footer>{playing ? <button className="ga-prompt-button" onClick={() => { onClose(false); onPrompt(agent.id) }}>Prompt {agent.codename}<ArrowUpRight size={15}/></button> : <span className="ga-reserve">In reserve · next match soon</span>}<a href="#genesis-breeding" onClick={() => onClose(false)}>Breeding & lineage<ArrowDownRight size={14}/></a></footer>
  </div>
}
