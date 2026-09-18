import { ArrowDown, ArrowUpRight, Coins, Crown, Dna, Fingerprint, Percent, Sparkles } from 'lucide-react'
import { AgentPortrait } from './HomePrimitives'

/** What holding a Genesis line is meant to pay. Two earning paths are planned
 *  and a third is open, so each one states its mechanic in full and marks the
 *  number itself TBA. A rate written here before it is decided would read as a
 *  commitment; the mechanic is settled, the rate is not. */
const EARNINGS = [
  {
    icon: Percent,
    tag: 'BREEDING ROYALTY',
    rate: 'TBA %',
    title: 'A share of every breed off your line.',
    body: 'Breeding a new agent costs a fee. A percentage of that fee routes back to the Genesis line the offspring inherits from. Your agent keeps earning while other players use its lineage, and the royalty follows the line rather than the seller. The percentage and the split between the Genesis holder and the treasury are to be announced.',
  },
  {
    icon: Coins,
    tag: 'POOL INCENTIVES',
    rate: 'TBA',
    title: 'A share of what the arena collects.',
    body: 'Arena matches and market activity pay fees into a rewards pool. Holders can earn from that pool, so an agent that competes and attracts prediction volume returns more than one that sits in reserve. Pool size, the weighting between holding and competing, and the payout schedule are to be announced.',
  },
  {
    icon: Sparkles,
    tag: 'MORE TO COME',
    rate: 'TBA',
    title: 'Further utility for the founding lines.',
    body: 'Genesis ownership is the base layer for what follows. Additional holder utility is planned and will be published before the mint, together with the full ownership terms.',
  },
] as const

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
    <section className="ga-earnings" aria-labelledby="genesis-earnings-title">
      <header><Crown size={19}/><div><h4 id="genesis-earnings-title">A lineage that keeps paying.</h4><p>A Genesis agent is not only a card. It is a line other players breed from, and a seat in the pool the arena fills. Both paths are planned; the rates below are not yet fixed.</p></div><span className="ga-earnings-flag">RATES TBA</span></header>
      <ul>{EARNINGS.map(({ icon: Icon, ...item }) => <li key={item.tag}>
        <div className="ga-earning-head"><span className="ga-earning-tag"><Icon size={14}/> {item.tag}</span><b className="ga-earning-rate">{item.rate}</b></div>
        <h5>{item.title}</h5><p>{item.body}</p>
      </li>)}</ul>
      <footer><p>Final terms, the exact percentages and the pool mechanics are to be announced before the mint. Nothing on this page is an offer or a promise of return.</p><a href="#agents">Explore Genesis<ArrowUpRight size={14}/></a></footer>
    </section>
  </section>
}
