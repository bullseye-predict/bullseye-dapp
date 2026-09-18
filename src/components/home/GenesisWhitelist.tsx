import { ArrowDownRight, CalendarClock, Layers, Sparkles, Timer } from 'lucide-react'
import {
  GENESIS_MINT, GENESIS_TOTAL_SUPPLY, GENESIS_WHITELIST_DATE, GENESIS_WHITELIST_YEAR, supplyLabel,
} from './genesisMint'

/** Every body in the sale, including the three that 12ed 13u11 splits into, so
 *  the "wraps" count and the "bodies" count are both honest. */
const BODY_COUNT = GENESIS_MINT.reduce((total, entry) => total + (entry.parts?.length ?? 1), 0)

/** The section head and the sale announcement, as one panel.
 *
 *  The collection is the sale, so it opens once: who these twelve are, and what
 *  is being sold. The per-tier breakdown is deliberately NOT repeated here -
 *  every card below prints its own rarity and its own count, and a second copy
 *  of the same table only gives the two a way to disagree.
 *
 *  The headline total is summed from those same card allocations, so the banner
 *  cannot promise a supply the grid does not account for. */
export function GenesisWhitelist() {
  return <aside className="ga-whitelist" aria-labelledby="genesis-title">
    <div className="ga-whitelist-flag">
      <h2 id="genesis-title">GENESIS AGENTS<span>THE ORIGINAL 12</span></h2>
      <span className="ga-whitelist-mark"><Sparkles size={13}/> NFT WHITELIST<b>COMING SOON</b></span>
    </div>
    <div className="ga-whitelist-main">
      <div className="ga-whitelist-headline">
        <h3>{supplyLabel(GENESIS_TOTAL_SUPPLY)} GENESIS BODIES<br/>SELL EARLY ON <em>{GENESIS_WHITELIST_DATE}</em>.</h3>
        <p>The founding generation. Early training shapes their instincts, and Genesis lineage becomes the foundation for breeding agents you own. The whitelist opens before the public mint: {GENESIS_MINT.length} wraps share the {supplyLabel(GENESIS_TOTAL_SUPPLY)} bodies, and each wrap carries its own supply and rarity on its card below. A smaller supply is a higher tier. Price, allocation size and the mint mechanic are still to be announced.</p>
        <a className="ga-breeding-link" href="#genesis-breeding">BREEDING &amp; ROYALTIES <ArrowDownRight size={15}/></a>
      </div>
      <dl className="ga-whitelist-facts">
        <div><dt><CalendarClock size={13}/> EARLY SELL</dt><dd>{GENESIS_WHITELIST_DATE}<small>{GENESIS_WHITELIST_YEAR}</small></dd></div>
        <div><dt><Layers size={13}/> TOTAL SUPPLY</dt><dd>{supplyLabel(GENESIS_TOTAL_SUPPLY)}<small>{GENESIS_MINT.length} WRAPS · {BODY_COUNT} BODIES</small></dd></div>
        <div><dt><Timer size={13}/> WHITELIST</dt><dd>TBA<small>TERMS BEFORE LAUNCH</small></dd></div>
      </dl>
    </div>
  </aside>
}
