import { ArrowUpRight, ChevronDown, Menu, X, Crosshair, Wallet, Timer, Trophy, Bot, ArrowLeftRight } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import '../../styles/site-header.css'

type Props = {
  homeHref: string
  marketsHref?: string
  walletControl: ReactNode
  active: 'highlight' | 'markets' | 'agents' | 'teams' | 'docs' | 'leaderboard' | 'profile'
  onArena?: () => void
  onMarkets?: () => void
}

export function SiteHeader({ homeHref, marketsHref, walletControl, active, onArena, onMarkets }: Props) {
  const [open, setOpen] = useState(false)
  const [gamesOpen, setGamesOpen] = useState(false)
  const [tickerPaused, setTickerPaused] = useState(false)
  const close = () => { setOpen(false); setGamesOpen(false) }
  const activity = [
    { type: 'objective', label: 'OBJECTIVE', icon: Crosshair, text: 'COKE secured the bottle zone' },
    { type: 'claim', label: 'CLAIM', icon: Wallet, text: '0x7d…e91 claimed 42.6 COOLA' },
    { type: 'match', label: 'MATCH', icon: Timer, text: '$BONK vs $WIF starts in 04:32' },
    { type: 'win', label: 'WIN', icon: Trophy, text: 'PEPSI won the last arena round' },
    { type: 'agent', label: 'AGENT', icon: Bot, text: 'Prompt accepted for SPRITE' },
    { type: 'trade', label: 'TRADE', icon: ArrowLeftRight, text: '0x3a…b72 bought 25 YES shares' },
  ]
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
          <a className={active === 'teams' ? 'is-active' : undefined} href={`${homeHref}#teams`} onClick={close}>Teams</a>
          <a className={active === 'docs' ? 'is-active' : undefined} href={`${homeHref}#enter-arena`} onClick={close}>Docs</a>
          <a className={active === 'leaderboard' ? 'is-active' : undefined} href={`${homeHref}#teams`} onClick={close}>Leaderboard</a>
        </div>
        <div className="sh-wallet">{walletControl}</div>
      </nav>
      <button className="sz-site-menu" aria-expanded={open} aria-controls="site-navigation" aria-label={open ? 'Close navigation' : 'Open navigation'} onClick={() => setOpen(!open)}>{open ? <X size={20}/> : <Menu size={20}/>}</button>
    </div>
    <div className="sz-activity-marquee" aria-label="Arena activity preview">
      <b className="sz-ticker-preview">PREVIEW</b>
      <div className="sz-ticker-window"><div className="sz-ticker-track" style={{ animationPlayState: tickerPaused ? 'paused' : 'running' }}>
        {[0, 1].map((copy) => <div className="sz-ticker-group" key={copy} aria-hidden={copy === 1 ? true : undefined}>{[...activity, ...activity].map((item, index) => <span className={`sz-ticker-event is-${item.type}`} key={`${item.type}-${index}`} aria-hidden={index >= activity.length ? true : undefined}><item.icon size={13} aria-hidden="true"/><b>{item.label}</b>{item.text}</span>)}</div>)}
      </div></div>
      <button className="sz-ticker-toggle" type="button" onClick={() => setTickerPaused(!tickerPaused)} aria-label={tickerPaused ? 'Play activity ticker' : 'Pause activity ticker'}>{tickerPaused ? 'Play' : 'Pause'}</button>
    </div>
  </header>
}
