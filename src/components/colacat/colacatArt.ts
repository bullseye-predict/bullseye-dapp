/**
 * Every picture on /colacat, and the one array the owner appends to.
 *
 * TO ADD A CAT, ADD A LINE TO `COLACAT_PROOFS`. Drop the file into
 * /Users/Shared/march-2026/solz-prediction-market/public/images/colacat/proofs/
 * and append `{ file: 'kettle.webp', vessel: 'Electric kettle' }`. Nothing else
 * in the repository changes. The FIG. number is the array index, never stored,
 * so deleting an entry renumbers the sheet correctly instead of leaving a hole.
 *
 * THE SHEET IS CORRECT AT ANY COUNT. The grid is `auto-fit`, not `auto-fill`:
 * three specimens fill the row rather than huddling at the left edge of six
 * empty tracks, and thirty wrap into a swarm. `feature` promotes one plate to a
 * double cell; past eight specimens ColaCatApp ignores it, because a hero cell
 * inside a swarm reads as a mistake rather than as emphasis.
 *
 * A FILE THAT IS NOT THERE YET IS NOT AN ERROR. Every slot on this page paints
 * a measured, dashed PLATE PENDING frame of exactly the final size while its
 * file is missing (see Plate.tsx), so the layout on the day the art lands is
 * the layout today.
 */

/** Where the proof photographs live, under /public. */
export const PROOFS_DIR = '/images/colacat/proofs/'

export type ColaCatProof = {
  /** File name only, inside PROOFS_DIR. */
  readonly file: string
  /** What the cat became. This is the caption AND the alt text, so write it as a thing, not as a file name. */
  readonly vessel: string
  /** One deadpan line under the caption. The plate reads fine without it. */
  readonly note?: string
  /** Photographer or source, when the picture has one. */
  readonly credit?: string
  /** Promotes this plate to a double-width cell. Honoured while the set is small. */
  readonly feature?: boolean
}

/**
 * The five specimens from the brief. The files are not on disk yet; each one
 * holds its place as a measured PLATE PENDING frame until it is.
 */
export const COLACAT_PROOFS: readonly ColaCatProof[] = [
  { file: 'box.webp', vessel: 'Storage box', note: 'Shape adopted in 2.4 s. Face remains at the surface.', feature: true },
  { file: 'jug.webp', vessel: 'Measuring jug, 4 L', note: 'Fills to the pouring lip. Does not pour.' },
  { file: 'cylinder.webp', vessel: 'Cylinder vase', note: 'Column holds. No head on the liquid.' },
  { file: 'round-vase.webp', vessel: 'Round vase', note: 'Takes the curve exactly. Ears stay above the rim.' },
  { file: 'tub.webp', vessel: 'Rectangular tub', note: 'Corners filled. Tail follows last.' },
]

/**
 * The fixed artwork. Two of these files are on disk; the rest are the owner's
 * to drop in at these exact paths.
 *
 * WHY THEY SIT IN AN `art/` SUBFOLDER. `/images/colacat/bottle-red.webp` is
 * three path segments, which is exactly the shape of this site's
 * `[chain]/[network]/[address]` route (src/pages/[chain]/[network]/). A file
 * that is not on disk therefore fell through to that route and answered 302 to
 * `/` - a full server render of the home page, on every view of this page,
 * three times over, instead of a 404. One segment deeper and the static handler
 * owns the path, which is why `proofs/` never had the problem.
 *
 *   bottleRed   - the red-wrap ColaCat bottle render      (pending)
 *   bottleBlack - the black-wrap ColaCat bottle render    (pending)
 *   superHeavy  - the SUPER HEAVY COLA blackboard banner  (on disk)
 *   setSail     - the SET SAIL recruitment poster         (on disk)
 *   igNobel     - the 2017 Ig Nobel physics card          (pending; the card
 *                 prints the citation as type either way, so this beat is
 *                 readable with no picture at all)
 */
export const ART_DIR = '/images/colacat/art/'

export const COLACAT_ART = {
  bottleRed: `${ART_DIR}bottle-red.webp`,
  bottleBlack: `${ART_DIR}bottle-black.webp`,
  superHeavy: `${ART_DIR}super-heavy-cola.webp`,
  setSail: `${ART_DIR}set-sail.webp`,
  igNobel: `${ART_DIR}ig-nobel-2017.webp`,
} as const

/**
 * The mint is NOT written down here. It arrives as one public environment
 * variable, `PUBLIC_COLACAT_MINT`, read in src/pages/colacat.astro and passed
 * to ColaCatApp as the `mint` prop (AGENTS.md: the host reads the environment,
 * the React tree takes typed props). Setting that variable is the whole of
 * launch day on this page - no file in this repository changes.
 *
 * NO MINT IS A REAL STATE, NOT A BUG. While the variable is unset the identity
 * card prints MINT PENDING at the same width the address will occupy, and the
 * pump.fun control is disabled rather than absent, so the card does not change
 * shape when the value lands.
 *
 * A SHORTENED ADDRESS IS NEVER SHOWN AS IF IT WERE THE ADDRESS - there is no
 * abbreviating helper here for exactly that reason. The card prints the whole
 * string at every width, because it is both what the copy button puts on the
 * clipboard and what a reader selects by hand when the clipboard is blocked.
 * On a phone it wraps to two lines, which is the correct trade.
 */

/** The token's own name, kept beside the mint rather than typed into markup. */
export const COLACAT_SYMBOL = 'COLACAT'

/** pump.fun's coin page, or an empty string while there is no mint to link to. */
export function pumpFunHref(mint: string): string {
  return mint ? `https://pump.fun/coin/${encodeURIComponent(mint.trim())}` : ''
}

/** `01`, `02`, … the FIG. number for a plate at `index`. */
export function figure(index: number): string {
  return String(index + 1).padStart(2, '0')
}

/** The full public path for a proof entry. */
export function proofSrc(proof: ColaCatProof): string {
  return `${PROOFS_DIR}${proof.file}`
}
