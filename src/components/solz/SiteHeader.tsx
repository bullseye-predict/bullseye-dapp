import { ArrowUpRight, ChevronDown, Menu, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import '../../styles/site-header.css'

type Props = {
  homeHref: string
  marketsHref?: string
  walletControl: ReactNode
  active: 'highlight' | 'markets' | 'agents' | 'catwalk' | 'miawprix' | 'colacat' | 'docs' | 'profile'
  onArena?: () => void
  onMarkets?: () => void
}

export function SiteHeader({ homeHref, marketsHref, walletControl, active, onArena, onMarkets }: Props) {
  const [open, setOpen] = useState(false)
  const [gamesOpen, setGamesOpen] = useState(false)
  const close = () => { setOpen(false); setGamesOpen(false) }
  return <header className="sz-site-header" onKeyDown={(event) => { if (event.key === 'Escape') close() }}>
    <div className="sz-site-header-inner">
      <a className="sh-logo sh-logo-colacat" href={homeHref} aria-label="ColaCat home">
        <img src="/images/brand/colacat-logo.png" alt="ColaCat" />
      </a>
      <nav id="site-navigation" aria-label="Main navigation" className={open ? 'is-open' : ''}>
        <div className="sz-site-links">
          <a className={active === 'highlight' ? 'is-active' : undefined} href={`${homeHref}#highlight`} onClick={() => { onArena?.(); close() }}>Highlight <span>01</span></a>
          <a className={active === 'markets' ? 'is-active' : undefined} href={marketsHref ?? '/markets'} onClick={() => { onMarkets?.(); close() }}>Markets</a>
          {/* <div className="sz-games-menu">
            <button type="button" aria-expanded={gamesOpen} aria-controls="games-menu" onClick={() => setGamesOpen(!gamesOpen)}>Games <ChevronDown size={13}/></button>
            {gamesOpen && <div id="games-menu" className="sz-games-popover"><a href="https://solz.fun" target="_blank" rel="noreferrer" onClick={close}><strong>solz.fun</strong><span>Play the agent arena</span><ArrowUpRight /></a><div aria-disabled="true"><strong>More games</strong><span>Coming soon</span></div></div>}
          </div> */}
          <a href="/agent-arena" className={active === 'agents' ? 'is-active' : undefined} onClick={close}>Agents</a>
          <a href="/catwalk" className={active === 'catwalk' ? 'is-active' : undefined} onClick={close}>Catwalk</a>
          <a href="/miaw-prix" className={active === 'miawprix' ? 'is-active' : undefined} onClick={close}>Miaw Prix</a>
          <a href="/colacat" className={active === 'colacat' ? 'is-active' : undefined} onClick={close}>$COLACAT</a>
          <a className={active === 'docs' ? 'is-active' : undefined} href={`${homeHref}#enter-arena`} onClick={close}>Docs</a>
        </div>
        <div className="sh-wallet">{walletControl}</div>
      </nav>
      <button className="sz-site-menu" aria-expanded={open} aria-controls="site-navigation" aria-label={open ? 'Close navigation' : 'Open navigation'} onClick={() => setOpen(!open)}>{open ? <X size={20}/> : <Menu size={20}/>}</button>
    </div>
    {/* Activity returns when an authoritative feed is connected; fabricated trades must never appear in shared navigation. */}
  </header>
}
