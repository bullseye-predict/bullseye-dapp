import { useEffect, useRef, useState } from 'react'

/**
 * Draws a section in once, when it first reaches the viewport.
 *
 * THE MOCKUP IS DRAWN AS ARROWS. Every beat on the owner's sheet is joined to
 * the next by a hand-drawn leader line, so on this page the leaders are real:
 * a hairline that measures itself out as you arrive at the section it belongs
 * to. This hook is the trigger and nothing else - it adds `is-revealed` and the
 * CSS decides what that means, which is what keeps the motion in one file.
 *
 * IT IS NOT A GATE ON CONTENT. The element is fully laid out and fully
 * readable before the class arrives; only the leader's scaleX and a small
 * translate are withheld. A reader with JavaScript off, a crawler, or anyone
 * who prefers reduced motion sees the finished section - colacat.css neutralises
 * every transition under `prefers-reduced-motion: reduce`, and the observer
 * itself is skipped when the API is absent, which reveals everything at once.
 *
 * It disconnects after the first crossing: a section that redraws every time it
 * scrolls past is a page that will not sit still to be read.
 */
export function useReveal<T extends HTMLElement>(): [React.RefObject<T | null>, boolean] {
  const node = useRef<T>(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const element = node.current
    if (!element) return
    if (typeof IntersectionObserver !== 'function') { setShown(true); return }
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        setShown(true)
        observer.disconnect()
      }
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return [node, shown]
}
