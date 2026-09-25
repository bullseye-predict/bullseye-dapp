/**
 * The project brand. One constant, ACTIVE_BRAND, decides the logo, the names in
 * the site chrome and metadata, which page `/` opens on, and which sections the
 * navigation shows. Change it and nothing else to switch the project.
 *
 * A hidden section keeps its route: /catwalk, /agent-arena, /miaw-prix and
 * /colacat still answer by URL, they just leave the header and footer.
 *
 * Plain data with no browser or framework imports: vite.config.ts reads it to
 * write the static <head> in index.html, so the first paint and link previews
 * carry the same brand as the app.
 */
export type BrandId = 'bullseye' | 'colacat'

export const ACTIVE_BRAND: BrandId = 'bullseye'

/** Navigation sections a brand can show. Markets is always shown. */
export type BrandSection = 'highlight' | 'agents' | 'catwalk' | 'miawprix' | 'colacat'

export type Brand = {
  id: BrandId
  /** Prose name: "Bullseye agent forecast", "Tracked on Bullseye". */
  name: string
  /** Upper-case name for small caps labels and the footer mark. */
  wordmark: string
  logo: {
    src: string
    width: number
    height: number
    /** The image is a mark only, so the wordmark is set beside it as text. */
    withWordmark: boolean
  }
  favicon: { href: string; type: string }
  /** Square image for small circular slots, such as the agent forecast label. */
  badge: string
  /** Link preview image, 1200 x 630. */
  ogImage: string
  ogImageAlt: string
  /** Footer strapline. */
  strapline: string
  /** Title and description for the page at `/`. */
  title: string
  description: string
  /** What `/` shows. The arena always stays reachable at /highlight. */
  home: 'markets' | 'arena'
  sections: readonly BrandSection[]
}

export const brands: Record<BrandId, Brand> = {
  bullseye: {
    id: 'bullseye',
    name: 'Bullseye',
    wordmark: 'BULLSEYE',
    logo: { src: '/images/brand/bullseye-logo.png', width: 320, height: 256, withWordmark: true },
    favicon: { href: '/images/brand/bullseye-icon.png', type: 'image/png' },
    badge: '/images/brand/bullseye-badge.png',
    ogImage: '/images/brand/bullseye-og.png',
    ogImageAlt: 'Bullseye: watch first, follow later',
    strapline: 'WATCH FIRST. FOLLOW LATER.',
    title: 'Bullseye · Watch first. Follow later.',
    description: 'Watch an AI trader build its conviction in public before you follow it. Trade prediction markets on stocks, pre-stocks and live events.',
    home: 'markets',
    sections: ['highlight'],
  },
  colacat: {
    id: 'colacat',
    name: 'ColaCat',
    wordmark: 'COLACAT',
    logo: { src: '/images/brand/colacat-logo.png', width: 2078, height: 757, withWordmark: false },
    favicon: { href: '/favicon.svg', type: 'image/svg+xml' },
    badge: '/images/brand/colacat-logo.png',
    ogImage: '/og.png',
    ogImageAlt: 'SOLZ match prediction arena with live agent-athlete odds',
    strapline: 'COLA CREDITS FOR AGENT THINKING.',
    title: 'ColaCat · Cola Credits for Agent Thinking',
    description: 'Cola Credits for Agent Thinking — watch Genesis agents compete, predict the outcome, and direct the action.',
    home: 'arena',
    sections: ['highlight', 'agents', 'catwalk', 'miawprix', 'colacat'],
  },
}

export const brand: Brand = brands[ACTIVE_BRAND]

export const showsSection = (section: BrandSection, of: Brand = brand) => of.sections.includes(section)

/** Where the arena lives: `/` when it is home, /highlight when markets are. */
export const arenaPath = (of: Brand = brand) => of.home === 'arena' ? '/' : '/highlight'

/** Page titles read "<page> · <brand>". */
export const brandTitle = (page: string, of: Brand = brand) => `${page} · ${of.name}`
