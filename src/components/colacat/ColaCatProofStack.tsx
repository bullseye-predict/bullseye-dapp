import { Plate } from './Plate'
import { proofSrc, type ColaCatProof } from './colacatArt'

/**
 * THE PROOF PILE - the right half of "did you know a cat is a liquid?".
 *
 * PHOTOGRAPHS DROPPED ON A BENCH, not a carousel. The owner's mockup draws a
 * leader running right from the claim to a CLUSTER of pictures, and their
 * reference is exactly that: every specimen visible at once, overlapping, each
 * one still its own shape. A one-at-a-time card was the wrong reading - it hid
 * four fifths of the evidence behind a control the reader had to work, and it
 * letterboxed a landscape photograph into a portrait frame to do it.
 *
 * NATURAL SHAPES, NO CROP. These are found photographs and the owner appends
 * more by hand, so their proportions are whatever the internet had: the box and
 * the jug are tall, the tub is wide. Nothing here sets an aspect ratio - each
 * image keeps its own and the pile absorbs the difference, which is also why a
 * new entry of any shape needs no rule of its own.
 *
 * THE SCATTER IS ARITHMETIC, NOT A TABLE. Position, width, tilt and stacking
 * all come from the index modulo three, so the layout is stable across renders,
 * identical on the server and the client, and correct at three specimens and at
 * thirty. Nothing is hand-placed, because a hand-placed collage stops being one
 * the moment somebody adds a sixth picture.
 *
 * IT NEEDS NO JAVASCRIPT. There is no state in this component. The settle is a
 * CSS animation keyed off `--i`, and colacat.css turns it off under
 * prefers-reduced-motion, which leaves the same pile sitting still.
 */

export function ColaCatProofStack({ proofs }: { proofs: readonly ColaCatProof[] }) {
  if (proofs.length === 0) {
    return (
      <p className="cola-proof-empty">
        No specimens are filed yet. Add one to <code>COLACAT_PROOFS</code> and it appears here.
      </p>
    )
  }

  return (
    <ul className="cola-collage" data-count={proofs.length > 8 ? 'swarm' : 'set'}>
      {proofs.map((proof, index) => (
        // `--i` drives the settle's stagger; `--s` is the scatter slot, which is
        // the index modulo three so a sixth photograph lands where the third
        // did rather than wherever a random number sent it.
        <li
          key={`${proof.file}-${index}`}
          style={{ ['--i' as string]: index, ['--s' as string]: index % 3 } as never}
        >
          {/* No sign, no caption, no note. The photographs are the argument and
              a label under each one only got in the way of it; `alt` still
              names the container for anyone who cannot see the picture. */}
          <Plate
            src={proofSrc(proof)}
            alt={`A cat taking the shape of this ${proof.vessel}`}
            pendingNote={proof.vessel}
          />
        </li>
      ))}
    </ul>
  )
}
