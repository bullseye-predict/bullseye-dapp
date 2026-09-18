/**
 * The PROMPT AGENT panel's own shell, at the panel's own height.
 *
 * AGENTS.md: a loading state keeps the final surface's structure and
 * dimensions - never a standalone sentence where a control will be. This is the
 * composer with its parts not yet in it, so the page does not reflow when they
 * arrive.
 *
 * IT LIVES ALONE ON PURPOSE. Both the panel and the composer need this exact
 * frame - the panel before it mounts, the composer while its data source loads
 * - and two frames that drifted apart would reintroduce the jump this one
 * exists to prevent. It cannot live in ColaCatComposer.tsx, because importing
 * it from there would drag that module's Solana adapters back into the server
 * render and return /colacat to a 500; and it cannot live in
 * ColaCatPromptPanel.tsx without making the two modules import each other.
 */
export function ComposerFrame() {
  return (
    <div className="cola-console-waiting" role="status" aria-busy="true" aria-label="Loading the prompt panel">
      <span className="cola-console-waiting-head" aria-hidden="true" />
      <span className="cola-console-waiting-field" aria-hidden="true" />
      <span className="cola-console-waiting-controls" aria-hidden="true" />
    </div>
  )
}

/**
 * What the slot shows when the borrowed composer will not render.
 *
 * THE LORE PAGE MUST NEVER GO BLANK FOR ONE PANEL. This page mounts a component
 * that belongs to the arena, so it also inherits the arena's failure modes -
 * and React's default answer to a throw in render is to unmount the whole tree,
 * which on /colacat means the header stays and everything under it disappears.
 * That is exactly what happened when `authToken()` raised ClientNotFoundError
 * (see DynamicSolanaSession.tsx). The boundary in ColaCatPromptPanel renders
 * this instead: the panel degrades, the page does not.
 *
 * It keeps the frame's height so the surrounding grid does not move, and it
 * sends the reader to the panel that is definitely live rather than pretending
 * this one is.
 */
export function ComposerUnavailable({ arenaHref = '/#highlight' }: { arenaHref?: string }) {
  return (
    <div className="cola-console-down" role="status">
      <strong>The live panel is not available here.</strong>
      <span>Directives still work in the arena, where the wallet session lives.</span>
      <a className="cola-inline-link" href={arenaHref}>Open the arena →</a>
    </div>
  )
}
