import { ArrowUpRight } from 'lucide-react'
import '../../styles/site-footer.css'
import { arenaPath, brand, showsSection } from './brand'
import { BrandLogo } from './BrandLogo'

type Props = {
  homeHref: string
  backToTopHref?: string
}

// The top of the home page: the arena's #highlight, or the markets directory's <main>.
const homeTop = brand.home === 'arena' ? '#highlight' : '#market-directory'

export function SiteFooter({ homeHref, backToTopHref = `${homeHref}${homeTop}` }: Props) {
  const arena = arenaPath()
  return <footer className="cc-site-footer">
    <a className={`cc-site-footer-logo cc-site-footer-logo--${brand.id}`} href={homeHref} aria-label={`${brand.name} home`}>
      <BrandLogo />
    </a>
    <span>{brand.strapline}</span>
    <nav aria-label="Footer navigation">
      {showsSection('highlight') && <a href={`${arena}#highlight`}>Highlight <ArrowUpRight size={12}/></a>}
      <a href={brand.home === 'markets' ? '/markets' : `${homeHref}#matches`}>Markets <ArrowUpRight size={12}/></a>
      {showsSection('catwalk') && <a href="/catwalk">Catwalk <ArrowUpRight size={12}/></a>}
      {showsSection('miawprix') && <a href="/miaw-prix">Miaw Prix <ArrowUpRight size={12}/></a>}
      {showsSection('colacat') && <a href="/colacat">$COLACAT <ArrowUpRight size={12}/></a>}
      {showsSection('highlight') && <a href={`${arena}#enter-arena`}>Docs <ArrowUpRight size={12}/></a>}
      <a href={backToTopHref}>Back to top ↑</a>
    </nav>
    <small>{brand.wordmark} / {brand.home === 'markets' ? 'MARKETS' : 'ARENA'}</small>
  </footer>
}
