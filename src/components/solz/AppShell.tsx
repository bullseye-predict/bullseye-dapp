import { useEffect, type ReactNode } from 'react'
import { setChrome, type HeaderActive } from '../session/chrome'
import { SiteFooter } from './SiteFooter'

/** The page half of the site chrome.
 *
 *  The header and the skip link are not rendered here: they live in SiteChrome,
 *  one persisted island in SiteLayout that outlives every page, so the wallet
 *  session and its balances survive navigation instead of being rebuilt. What
 *  the header needs to know about the page on screen is published to the chrome
 *  store, so each page still declares it in exactly one place — here.
 *
 *  The footer stays in the page: it holds no state worth persisting and its
 *  back-to-top target is per page.
 *
 *  The <main> is rendered here, not by each page, and `.sz-main` reads the same
 *  --site-content-width/--site-gutter the header does. Pages used to bring their
 *  own <main> and pick a width by eye, which is how the app ended up with ten
 *  content columns spanning 592px of disagreement — every page sat somewhere
 *  other than the header's line. A column each page opts into by remembering a
 *  class is not one mount point; this is. Pages set vertical rhythm via
 *  mainClassName and nothing else. */
type Props = {
  /** Page-specific root classes, e.g. `solz-home ev-app`. */
  className: string
  id?: string
  /** id for this page's <main>, e.g. `portfolio`. Skip links and back-to-top target it. */
  mainId?: string
  /** Extra classes on the <main>. Vertical rhythm only — the column is not a page's to set. */
  mainClassName?: string
  /** Opt out of the shared content column, for surfaces that are deliberately
   *  edge-to-edge (the broadcast arena). Everything else stays on the header's line. */
  bleed?: boolean
  homeHref?: string
  marketsHref?: string
  active: HeaderActive
  /** Fragment link to this page's <main>. Renders the skip link when set. */
  skipTo?: string
  skipLabel?: string
  /** Falls through to SiteFooter's own `${homeHref}#highlight` default. */
  backToTopHref?: string
  onArena?: () => void
  onMarkets?: () => void
  children: ReactNode
}

export function AppShell({ className, id, mainId, mainClassName, bleed, homeHref = '/', marketsHref, active, skipTo, skipLabel, backToTopHref, onArena, onMarkets, children }: Props) {
  // Effect rather than render, so the header is never asked to update while
  // this tree is mid-render. setChrome ignores a publish that changes nothing,
  // so re-rendering the page does not churn the header.
  useEffect(() => {
    setChrome({ active, marketsHref, skipTo, skipLabel }, onArena, onMarkets)
  })
  return <div className={className} id={id}>
    <main id={mainId} className={['sz-main', bleed ? 'sz-main--bleed' : '', mainClassName ?? ''].filter(Boolean).join(' ')}>
      {children}
    </main>
    <SiteFooter homeHref={homeHref} backToTopHref={backToTopHref} />
  </div>
}
