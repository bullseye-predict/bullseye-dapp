import type { ComponentProps, ReactNode } from 'react'
import { SiteFooter } from './SiteFooter'
import { SiteHeader } from './SiteHeader'

/** The one place the site chrome is assembled.
 *
 *  Every page is its own Astro island, so there is no single React root to
 *  hang a header on, and the header cannot live in SiteLayout.astro: it needs
 *  `walletControl`, which only exists inside each island's DynamicSolanaSession.
 *  This wrapper is the equivalent — it is the only module that renders
 *  SiteHeader or SiteFooter, so changing the chrome here changes every page.
 *
 *  The root carries `sz-shell`, which is where the shared header layout tokens
 *  (--site-header-height, --site-gutter, --site-content-width, --z-site-header)
 *  are defined; page classes stay on the same element for page-specific rules. */
type Props = Omit<ComponentProps<typeof SiteHeader>, 'homeHref'> & {
  /** Page-specific root classes, e.g. `solz-home ev-app`. */
  className: string
  id?: string
  homeHref?: string
  /** Fragment link to this page's <main>. Renders the skip link when set. */
  skipTo?: string
  skipLabel?: string
  /** Falls through to SiteFooter's own `${homeHref}#highlight` default. */
  backToTopHref?: string
  children: ReactNode
}

export function AppShell({ className, id, homeHref = '/', marketsHref, walletControl, active, onArena, onMarkets, skipTo, skipLabel = 'Skip to content', backToTopHref, children }: Props) {
  return <div className={`sz-shell ${className}`} id={id}>
    {skipTo && <a className="sh-skip-link" href={skipTo}>{skipLabel}</a>}
    <SiteHeader homeHref={homeHref} marketsHref={marketsHref} walletControl={walletControl} active={active} onArena={onArena} onMarkets={onMarkets} />
    {children}
    <SiteFooter homeHref={homeHref} backToTopHref={backToTopHref} />
  </div>
}
