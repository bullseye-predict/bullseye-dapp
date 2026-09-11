import { ArrowUpRight, Menu, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import '../../styles/site-header.css'

type Props = {
  homeHref: string
  marketsHref?: string
  walletControl: ReactNode
  active: 'arena' | 'markets' | 'agents' | 'profile'
  onArena?: () => void
  onMarkets?: () => void
}

export function SiteHeader({ homeHref, marketsHref, walletControl, active, onArena, onMarkets }: Props) {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  return <header className="sz-site-header" onKeyDown={(event) => { if (event.key === 'Escape') close() }}>
    <div className="sz-site-header-inner">
      <a className="sh-logo" href={homeHref} aria-label="COOLA home">COOLA<span>®</span><i aria-hidden="true"/></a>
      <nav id="site-navigation" aria-label="Main navigation" className={open ? 'is-open' : ''}>
        <div className="sz-site-links">
          <a className={active === 'arena' ? 'is-active' : undefined} href={`${homeHref}#highlight`} onClick={() => { onArena?.(); close() }}>Arena <span>01</span></a>
          <a className={active === 'markets' ? 'is-active' : undefined} href={marketsHref ?? `${homeHref}#highlight`} onClick={() => { onMarkets?.(); close() }}>Markets</a>
          <a href={`${homeHref}#teams`} onClick={close}>Teams</a>
          <a href="/agent-arena" className={active === 'agents' ? 'is-active' : undefined} onClick={close}>Agents</a>
          <a href="/profile" className={active === 'profile' ? 'is-active' : undefined} aria-current={active === 'profile' ? 'page' : undefined} onClick={close}>Portfolio</a>
          <a href={`${homeHref}#enter-arena`} onClick={close}>Get in the arena <ArrowUpRight size={13}/></a>
        </div>
        <div className="sh-wallet">{walletControl}</div>
      </nav>
      <button className="sz-site-menu" aria-expanded={open} aria-controls="site-navigation" aria-label={open ? 'Close navigation' : 'Open navigation'} onClick={() => setOpen(!open)}>{open ? <X size={20}/> : <Menu size={20}/>}</button>
    </div>
  </header>
}
