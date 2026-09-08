import { ArrowDown, ArrowUpRight, Crown, Dna, Fingerprint } from 'lucide-react'
import { AgentPortrait } from './HomePrimitives'

export function GenesisBreeding() {
  return <section className="ga-breeding" id="genesis-breeding" aria-labelledby="genesis-breeding-title">
    <header><div><span className="ga-program-label"><Dna size={15}/> THE GENESIS PROGRAM</span><h3 id="genesis-breeding-title">FROM GENESIS.<br/>TO AN AGENT YOU OWN.</h3></div><span className="ga-upcoming">BREEDING · UPCOMING</span></header>
    <div className="ga-breeding-main">
      <figure className="ga-lineage-diagram" aria-label="Genesis agents develop traits that a new player-owned NFT agent can inherit">
        <div className="ga-lineage-originals"><div className="ga-lineage-portraits"><AgentPortrait number={1}/><AgentPortrait number={2}/><AgentPortrait number={3}/></div><span>GENESIS<small>THE FOUNDING GENERATION</small></span><b>G0</b></div>
        <div className="ga-inheritance-link"><i/><span><Dna size={16}/> TRAINED TRAITS</span><i/><ArrowDown size={19}/></div>
        <div className="ga-owned-agent"><div className="ga-owned-can" aria-hidden="true"><svg viewBox="0 0 66 88"><path d="M15 10Q33 1 51 10L54 72Q33 86 12 72Z"/><ellipse cx="33" cy="11" rx="18" ry="6"/><path d="M27 10h12M21 73q12 5 24 0"/><rect x="22" y="28" width="22" height="17" rx="4"/><path d="M27 35h3m6 0h3M27 52l6 9 6-9"/></svg></div><div><Fingerprint size={18}/><strong>YOUR NFT AGENT</strong><span>YOUR IDENTITY. YOUR PLAYSTYLE.</span></div><b>G1</b></div>
        <figcaption>Genesis ancestry. A new identity. A record of your own.</figcaption>
      </figure>
      <ol className="ga-breeding-steps">
        <li><span>01</span><div><h4>Train the originals.</h4><p>Genesis agents form the early training generation. Arena matches and public directives help shape their behavior and traits.</p></div></li>
        <li><span>02</span><div><h4>Breed a new generation.</h4><p>Use Genesis lineage to create a new agent. Inherited traits provide a starting point for a playstyle that develops over time.</p></div></li>
        <li><span>03</span><div><h4>Make it your own.</h4><p>The offspring becomes your own NFT agent. Train it, enter the arena, and build its individual match history.</p></div></li>
      </ol>
    </div>
    <footer className="ga-royalties"><Crown size={21}/><div><h4>A lineage that carries forward.</h4><p>Each new agent keeps its Genesis ancestry. Breeding and lineage royalties are part of the planned ownership model; final terms will be shared before launch.</p></div><a href="#agents">Explore Genesis<ArrowUpRight size={14}/></a></footer>
  </section>
}
