import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * One framed picture on /colacat, and the page's answer to a file that is not
 * there yet.
 *
 * A PENDING PLATE IS THE SAME SHAPE AS A PRINTED ONE. AGENTS.md requires a
 * loading or unavailable state to keep the final surface's structure and
 * dimensions, and on this page that rule does the heavy lifting: eight of the
 * ten slots have no file on disk today. The frame therefore owns the geometry -
 * `aspect-ratio` on the well, caption row below it - and the <img> only ever
 * fills a box that is already the right size. Nothing on the page moves when
 * the art lands.
 *
 * TWO WAYS TO LEARN THE FILE IS MISSING, BECAUSE ONE IS NOT ENOUGH.
 * `onError` catches the ordinary case. It does NOT catch the case where the
 * browser already failed the request before React attached the handler - a
 * server-rendered <img>, a back/forward restore, or a response already in the
 * cache as a failure. The effect below reads `complete && naturalWidth === 0`,
 * which is exactly that state, and it runs on every src change. Without it the
 * page's first impression is a row of broken-image glyphs, which is the one
 * thing this component exists to prevent.
 */

type Props = {
  src: string
  /** What the picture shows. Empty marks the plate decorative, for art that repeats a caption. */
  alt: string
  /** The plate's own number or letter, printed in the caption rail. */
  sign?: ReactNode
  /** The caption itself. */
  caption?: ReactNode
  /** One quieter line under the caption. */
  note?: ReactNode
  /** Credit line, printed at the foot of the frame. */
  credit?: ReactNode
  /**
   * width / height of the well. LEAVE IT OUT for a picture that should keep its
   * own proportions - the well then takes its height from the image, which is
   * what the proof collage needs because those photographs are found ones and
   * every shape is different. Set it wherever the slot's geometry has to hold
   * whether the file is there or not.
   */
  ratio?: string
  className?: string
  /** `eager` for the two plates above the fold; everything else waits. */
  loading?: 'eager' | 'lazy'
  /** Marks the plate's fill bar with its position, so THE SETTLE steps down the sheet in order. */
  index?: number
  /**
   * What the dashed frame prints while the file is missing. Defaults to `alt`.
   * The two are different jobs: `alt` describes the picture to somebody who
   * cannot see it, while this tells whoever is filing the artwork which picture
   * belongs in this slot. Borrowing one for the other made the pending frames
   * read as sentences rather than as labels.
   */
  pendingNote?: string
}

export function Plate({
  src, alt, sign, caption, note, credit, ratio, className, loading = 'lazy', index, pendingNote,
}: Props) {
  // `pending` starts false so a file that is present never flashes its own
  // placeholder; the effect flips it within the same paint when the image has
  // already failed.
  const [pending, setPending] = useState(false)
  const image = useRef<HTMLImageElement>(null)

  useEffect(() => {
    setPending(false)
    const node = image.current
    if (node?.complete && node.naturalWidth === 0) setPending(true)
  }, [src])

  return (
    <figure
      className={['cola-plate', pending ? 'is-pending' : '', className ?? ''].filter(Boolean).join(' ')}
      style={index === undefined ? undefined : ({ ['--i' as string]: index } as never)}
    >
      {/* No ratio means no inline aspect-ratio at all, so the image drives the
          height. A pending plate in that case is given a shape by CSS, because
          a frame with no picture and no ratio has no height to speak of. */}
      <div className="cola-plate-well" style={ratio ? { aspectRatio: ratio } : undefined}>
        {pending ? (
          <span className="cola-plate-pending">
            <b>PLATE PENDING</b>
            <small>{pendingNote || alt || 'Artwork not filed'}</small>
          </span>
        ) : (
          <img
            ref={image}
            src={src}
            alt={alt}
            loading={loading}
            decoding="async"
            onError={() => setPending(true)}
          />
        )}
        <i className="cola-plate-fill" aria-hidden="true" />
      </div>
      {(sign || caption || note || credit) && (
        <figcaption>
          <span className="cola-plate-sign">
            {sign ? <b>{sign}</b> : null}
            {caption ? <span>{caption}</span> : null}
          </span>
          {note ? <small>{note}</small> : null}
          {credit ? <cite>{credit}</cite> : null}
        </figcaption>
      )}
    </figure>
  )
}
