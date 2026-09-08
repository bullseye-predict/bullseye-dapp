import { useLayoutEffect, useRef, useState } from 'react'

/** Keeps a non-modal inspector beside its card without moving the document. */
export function useAgentPopover(anchor: HTMLButtonElement, onDismiss: (restoreFocus: boolean) => void) {
  const panel = useRef<HTMLDivElement>(null)
  const dismiss = useRef(onDismiss)
  dismiss.current = onDismiss
  const [position, setPosition] = useState({ left: 0, top: 0, width: 620, side: 'right' })
  useLayoutEffect(() => {
    const element = panel.current
    if (!element) return
    let frame = 0
    const place = () => {
      const box = anchor.getBoundingClientRect()
      const edge = 16, gap = 12
      const right = window.innerWidth - box.right - edge - gap
      const left = box.left - edge - gap
      const side = right >= 500 ? 'right' : left >= 500 ? 'left' : 'below'
      const width = Math.min(620, side === 'right' ? right : side === 'left' ? left : window.innerWidth - edge * 2)
      const x = side === 'right' ? box.right + gap : side === 'left' ? box.left - gap - width : Math.max(edge, Math.min(box.left, window.innerWidth - edge - width))
      const preferredY = side === 'below' ? box.bottom + gap : box.top
      const y = Math.max(edge, Math.min(preferredY, window.innerHeight - Math.min(element.offsetHeight, window.innerHeight - edge * 2) - edge))
      setPosition((previous) => previous.left === x && previous.top === y && previous.width === width && previous.side === side ? previous : { left: x, top: y, width, side })
    }
    const schedulePlace = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(place) }
    const outside = (event: PointerEvent) => {
      const target = event.target as Element
      if (!element.contains(target) && !target.closest('.sh-agent-card')) dismiss.current(false)
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); dismiss.current(true) } }
    element.showPopover()
    place()
    element.focus({ preventScroll: true })
    const observer = new ResizeObserver(schedulePlace)
    observer.observe(element); observer.observe(anchor)
    window.addEventListener('resize', schedulePlace)
    window.addEventListener('scroll', schedulePlace, true)
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      observer.disconnect(); cancelAnimationFrame(frame)
      window.removeEventListener('resize', schedulePlace)
      window.removeEventListener('scroll', schedulePlace, true)
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
      if (element.matches(':popover-open')) element.hidePopover()
    }
  }, [anchor])
  return { panel, position }
}
