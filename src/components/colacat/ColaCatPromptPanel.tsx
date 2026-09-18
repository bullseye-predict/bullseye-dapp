import { Component, lazy, Suspense, useEffect, useState, type ErrorInfo, type ReactNode } from 'react'
import { ComposerFrame, ComposerUnavailable } from './ComposerFrame'

/**
 * THE REAL PROMPT AGENT PANEL, on the lore page.
 *
 * The owner drew an arrow at this spot on the mockup and wrote USE THE
 * COMPONENT HERE, so this mounts
 * /Users/Shared/march-2026/solz-prediction-market/src/components/home/PromptComposer.tsx
 * itself. Not a screenshot of it, and not a second copy of its markup: a
 * reproduction would drift away from the arena the first time the console
 * changed, and this page would then be quietly showing a panel the product no
 * longer has.
 *
 * BORROWING A COMPONENT MEANS BORROWING ITS FAILURE MODES, so it is behind an
 * error boundary. React's answer to a throw during render is to unmount the
 * whole tree - and this page is one island, so a throw inside the composer took
 * the entire lore page with it and left the site header sitting over a black
 * screen. That is not hypothetical: `authToken()` raised ClientNotFoundError as
 * soon as a wallet connected, because the session publishes the legacy Dynamic
 * SDK's reader while this build creates the modular SDK's client (fixed at the
 * root in src/components/arena/DynamicSolanaSession.tsx). The root is fixed;
 * the boundary stays, because the next arena change should cost this page a
 * panel and not a page.
 *
 * WHY THE COMPOSER IS BEHIND `lazy` AND A MOUNT FLAG. Its data source reaches
 * the Solana adapters and their CommonJS `buffer` polyfill, which throws
 * `require is not defined` the moment Astro renders this island on the server -
 * /colacat returned a 500 until the import moved into ColaCatComposer.tsx
 * behind a dynamic import. `mounted` is what guarantees the server never
 * renders it: `lazy` alone would still be evaluated during the server pass. The
 * rest of the page stays server-rendered, which is what a token page wants.
 *
 * WHY `ch-console` IS ON THE WRAPPER AND `ch-stage-corner` IS NOT.
 * The composer's paint lives behind an ancestor selector -
 * `.solz-home :is(.ch-console, .ch-stage-corner) ...`, about eighty rules in
 * src/styles/home-console.css - and `.ch-console` carries no layout of its own
 * beyond `display: flex; flex-direction: column; gap: 7px`
 * (src/styles/home-hero.css:165); everything positional about it is scoped to
 * `.ch-home .ch-hero-grid > .ch-console`. So the class is safe to wear here and
 * brings the whole charcoal composer with it, with no edit to a shared
 * stylesheet. `.ch-stage-corner` is NOT safe: src/styles/home-hero.css:992
 * declares `.ch-stage-plate, .ch-stage-corner { position: absolute; z-index: 7 }`
 * with no scope at all, and `.ch-stage-corner--prompt` at home-hero.css:1034
 * pins it to `right: 0; bottom: 0` at a width declared only inside the hero
 * stage. Wearing those two would tear this panel out of the flow and drop it
 * over the footer. `.cola-console` beside it is this page's own hook, for the
 * few rules in colacat.css that size the panel for a page column.
 */

/** Matches `.ch-prompt-accordion`'s own collapsed height, so nothing jumps on mount. */
const PANEL_MIN_HEIGHT = 250

const ColaCatComposer = lazy(() => import('./ColaCatComposer'))

class PanelBoundary extends Component<{ arenaHref?: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown, info: ErrorInfo) {
    // The reader gets the degraded panel; the diagnosis stays in the console.
    console.error('[colacat-prompt-panel]', error, info.componentStack)
  }
  render() {
    if (this.state.failed) return <ComposerUnavailable arenaHref={this.props.arenaHref} />
    return this.props.children
  }
}

export function ColaCatPromptPanel({ arenaHref }: { arenaHref?: string }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  return (
    <div className="ch-console cola-console" style={{ minHeight: PANEL_MIN_HEIGHT }}>
      <PanelBoundary arenaHref={arenaHref}>
        {mounted
          ? <Suspense fallback={<ComposerFrame />}><ColaCatComposer /></Suspense>
          : <ComposerFrame />}
      </PanelBoundary>
    </div>
  )
}
