import { ArrowUpRight } from 'lucide-react'
import '../../styles/site-footer.css'

type Props = {
  homeHref: string
  backToTopHref?: string
}

export function SiteFooter({ homeHref, backToTopHref = `${homeHref}#highlight` }: Props) {
  return <footer className="cc-site-footer">
    <a className="cc-site-footer-logo" href={homeHref} aria-label="ColaCat home">
      <img src="/images/brand/colacat-logo.png" alt="ColaCat" />
    </a>
    <span>COLA CREDITS FOR AGENT THINKING.</span>
    <nav aria-label="Footer navigation">
      <a href={`${homeHref}#highlight`}>Highlight <ArrowUpRight size={12}/></a>
      <a href={`${homeHref}#matches`}>Markets <ArrowUpRight size={12}/></a>
      <a href={`${homeHref}#teams`}>Teams <ArrowUpRight size={12}/></a>
      <a href={`${homeHref}#enter-arena`}>Docs <ArrowUpRight size={12}/></a>
      <a href={backToTopHref}>Back to top ↑</a>
    </nav>
    <small>COLACAT / ARENA</small>
  </footer>
}
