import type { CatwalkBoardShape } from './catwalkBands'
import { tabRows } from './catwalkQuery'
import { LaneNote } from './CatwalkSlotRow'

/**
 * WHAT THE CHAMPION LANE IS - the right-hand rail of the CHAMPIONS tab.
 *
 * Clicking the tab changes THIS and nothing else. The board on the left is the
 * same MIAW PRIX board it is on every other tab.
 *
 * AND IT CARRIES NO COUNTDOWN. A champions banner used to stand above the table
 * with a second clock on it, beside the hero's own - two clocks counting the
 * same instant, three inches apart, is one clock too many, and the deletion is
 * recorded rather than quietly reversed. The composition rail's lock face is the
 * one exception the owner asked for, and it is text-only and prop-driven for the
 * same reason.
 */
export function CatwalkChampionRail({ shape }: { shape: CatwalkBoardShape }) {
  const standing = tabRows('champions', shape.rows).length
  return (
    <section className="cw-legend" aria-labelledby="cw-champion-head">
      {/* A SWATCH, NOT A `LaneChip`. The chip spells its own lane out, and beside
          a heading naming the same lane it printed the word twice. It takes its
          colour the same way - off `data-lane` resolving `--cw-hue` in
          catwalk.css - so no hex value is restated here. */}
      <h3 id="cw-champion-head">
        <span className="cw-legend-swatch" data-lane="champion" aria-hidden="true" />
        CHAMPIONS
      </h3>
      <p className="cw-legend-lede">
        {/* Both routes into this lane, in the order they are settled. The page
            explains this lane in exactly two places - here and `laneBlurb` in
            CatwalkComposition.tsx - and they must not disagree about how a coin
            gets here. */}
        Won on season wins, or by leading the prediction market on volume. A champion
        holds its position on that record, so no price reaches it: the spot ladder
        publishes no seat for one and no ask is ever rendered against it.
      </p>

      {standing === 0
        ? <LaneNote
            lane="champion"
            title="NO CHAMPION HAS BEEN SETTLED YET."
            body="Season wins and prediction-market volume decide this lane, and this season has decided it on neither. Every position below is either open or held through another lane."
          />
        : null}

      <dl className="cw-legend-stats">
        <div><dt>STANDING IN THIS LANE</dt><dd>{standing}</dd></div>
      </dl>
    </section>
  )
}
