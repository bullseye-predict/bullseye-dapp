import { useCallback, useEffect, useRef, useState } from 'react'
import { notes } from './pitchDeck'
import { slides } from './PitchSlides'
import './pitch-deck.css'

type Props = {
  /** Zero-based slide index, owned by the host route. */
  slide: number
  onSlideChange: (slide: number) => void
}

const clamp = (index: number) => Math.min(Math.max(index, 0), slides.length - 1)

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))

export function PitchDeckApp({ slide, onSlideChange }: Props) {
  const index = clamp(slide)
  const [showNotes, setShowNotes] = useState(false)
  const touchStart = useRef<{ x: number, y: number } | null>(null)
  const go = useCallback((next: number) => {
    const target = clamp(next)
    if (target !== index) onSlideChange(target)
  }, [index, onSlideChange])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || typing(event.target)) return
      const key = event.key
      if (key === 'ArrowRight' || key === 'ArrowDown' || key === 'PageDown' || (key === ' ' && !event.shiftKey)) go(index + 1)
      else if (key === 'ArrowLeft' || key === 'ArrowUp' || key === 'PageUp' || (key === ' ' && event.shiftKey)) go(index - 1)
      else if (key === 'Home') go(0)
      else if (key === 'End') go(slides.length - 1)
      else if (key === 'n' || key === 'N') setShowNotes((value) => !value)
      else if (key === 'f' || key === 'F') {
        if (document.fullscreenElement) void document.exitFullscreen()
        else void document.documentElement.requestFullscreen?.().catch(() => undefined)
      } else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, index])

  const { title, Component } = slides[index]

  return <div
    className="pd-root"
    onTouchStart={(event) => { touchStart.current = { x: event.touches[0].clientX, y: event.touches[0].clientY } }}
    onTouchEnd={(event) => {
      const start = touchStart.current
      touchStart.current = null
      if (!start) return
      const dx = event.changedTouches[0].clientX - start.x
      const dy = event.changedTouches[0].clientY - start.y
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(index + (dx < 0 ? 1 : -1))
    }}
  >
    <section
      key={index}
      className="pd-slide"
      aria-roledescription="slide"
      aria-label={`${index + 1} of ${slides.length}: ${title}`}
    >
      <Component />
    </section>

    {showNotes ? <aside className="pd-notes" aria-label="Speaker notes">
      <span>Notes</span>
      <p>{notes[index]}</p>
    </aside> : null}

    <nav className="pd-nav" aria-label="Slides">
      <button type="button" className="pd-nav-step" onClick={() => go(index - 1)} disabled={index === 0} aria-label="Previous slide">←</button>
      <ol className="pd-dots">
        {slides.map((entry, position) => <li key={entry.title}>
          <button
            type="button"
            className="pd-dot"
            aria-current={position === index ? 'step' : undefined}
            aria-label={`Slide ${position + 1}: ${entry.title}`}
            onClick={() => go(position)}
          />
        </li>)}
      </ol>
      <span className="pd-count" aria-live="polite">{String(index + 1).padStart(2, '0')} / {String(slides.length).padStart(2, '0')}</span>
      <button type="button" className="pd-nav-step" onClick={() => go(index + 1)} disabled={index === slides.length - 1} aria-label="Next slide">→</button>
      <button type="button" className="pd-nav-notes" aria-pressed={showNotes} onClick={() => setShowNotes((value) => !value)}>Notes</button>
    </nav>
  </div>
}
