import '../../styles/genesis.css'
import { ArrowUpRight } from 'lucide-react'
import { useRef, useState, type CSSProperties } from 'react'
import type { SolzSnapshot } from '../solz/model'
import { accentStyle, AgentPortrait, agentSkinSlug } from './HomePrimitives'
import { GENESIS_TIER_COLOR, GENESIS_TIER_INK, genesisMint, supplyLabel } from './genesisMint'
import { GenesisProfile } from './GenesisProfile'
import { GenesisBreeding } from './GenesisBreeding'
import { GenesisWhitelist } from './GenesisWhitelist'

export function GenesisAgents({ snapshot, onPrompt }: { snapshot: SolzSnapshot; onPrompt: (agentId: string) => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const anchor = useRef<HTMLButtonElement | null>(null)
  const selected = snapshot.agents.find((agent) => agent.id === selectedId)
  const closeProfile = (restoreFocus: boolean) => { setSelectedId(null); if (restoreFocus) anchor.current?.focus({ preventScroll: true }) }
  return <section className="sh-genesis" id="agents">
    <GenesisWhitelist/>
    {/* The card is a collection card: rarity, wrap, supply. The arena record
        lives in the profile panel a click away, so match counts and archetypes
        do not compete with the number a buyer came to read. */}
    <div className="sh-agent-grid">{snapshot.agents.map((agent) => {
      // The allocation follows the wrap, so a card reads its own row out of the
      // mint table. A wrap with no row prints no tier and no count.
      const mint = genesisMint(agent.skinSlug || agentSkinSlug(agent.number))
      const tier = mint ? { '--tier-color': GENESIS_TIER_COLOR[mint.rarity], '--tier-ink': GENESIS_TIER_INK[mint.rarity] } as CSSProperties : null
      return <button className={`sh-agent-card ${selectedId === agent.id ? 'is-selected' : ''}`} key={agent.id} style={{ ...accentStyle(agent.color), ...tier }} onClick={(event) => { anchor.current = event.currentTarget; setSelectedId(selectedId === agent.id ? null : agent.id) }} aria-expanded={selectedId === agent.id} aria-haspopup="dialog" aria-controls={selectedId === agent.id ? `genesis-profile-${agent.id}` : undefined} aria-label={`View ${agent.codename}${agent.subname ? `, ${agent.subname}` : ''}, Genesis agent ${agent.number}${mint ? `, ${mint.rarity}, ${mint.claim ?? `${supplyLabel(mint.supply)} supply`}` : ''}`}>
        <div className="sh-agent-card-label"><span className="ga-card-rarity">{mint?.rarity ?? 'GENESIS'}</span><span className="ga-card-slot">#{String(agent.number).padStart(2, '0')}<ArrowUpRight size={15}/></span></div>
        {/* The nail and its cord are drawn on .ga-frame, which stays square to
            the card. Only the print inside it tilts, so the nail reads as fixed
            in the wall and the picture as hanging crooked from it. */}
        <div className="ga-frame"><AgentPortrait number={agent.number} slug={agent.skinSlug}/></div>
        <div className="sh-agent-card-name">
          <h3>{agent.codename}</h3>
          <b className="ga-card-supply">{mint ? supplyLabel(mint.supply) : '--'}</b>
          <span className="sh-agent-subname">{agent.subname}</span>
          {/* c0ke has no sale, so its own line replaces the word SUPPLY under
              the count rather than sitting beside a number that means nothing. */}
          <span className={`ga-card-supply-label ${mint?.claim ? 'is-claim' : ''}`}>{mint?.claim ?? 'SUPPLY'}</span>
          {mint?.parts && <small className="ga-card-parts">{mint.parts.map((part) => `${part.supply} ${part.label}`).join(' · ')}</small>}
        </div>
      </button>
    })}</div>
    {selected && anchor.current && <GenesisProfile key={selected.id} agent={selected} snapshot={snapshot} anchor={anchor.current} onClose={closeProfile} onPrompt={onPrompt}/>}
    <div className="sh-genesis-foot"><span>12 ORIGINALS. THE START OF EVERY LINEAGE.</span><span>GENERATION 0 <span aria-hidden="true">✳</span></span></div>
    <GenesisBreeding/>
  </section>
}
