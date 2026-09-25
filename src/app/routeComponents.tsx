import { AgentArenaApp } from '../components/agent-arena/AgentArenaApp'
import { DemoArenaApp } from '../components/arena/DemoArenaApp'
import { LiveArenaApp } from '../components/arena/LiveArenaApp'
import { CatwalkApp } from '../components/catwalk/CatwalkApp'
import { BetOrMarketApp } from '../components/colacat/BetOrMarketApp'
import { ColaCatApp } from '../components/colacat/ColaCatApp'
import { MiawPrixApp } from '../components/miawprix/MiawPrixApp'
import { PitchDeckApp } from '../components/pitch/PitchDeckApp'
import {
  EventApp,
  HomeApp,
  MarketFormPage,
  MarketsDirectoryApp,
  PantaEventApp,
  PortfolioApp,
  PredictionApp,
} from '../components/prediction/TradingEntrypoints'
import type { EventVariant } from '../components/events/eventModel'
import type { ProfileRoute } from '../components/portfolio/profileRoute'
import { brand, brandTitle } from '../components/solz/brand'
import { appConfig, liveMarketSources, predictionApiUrl } from './config'
import { RouteMeta } from './RouteMeta'

const paths = {
  home: '/',
  demo: '/demo',
  live: '/live',
  // All event perspectives use one route identity. Search state swaps the
  // rail/content perspective without tearing down the event or wallet trees.
  variants: { markets: '/events', community: '/events?view=community', agents: '/events?view=agents' },
} as const

/** `/` opens on whatever the brand calls home: the markets directory or the arena. */
export function HomeRoute() {
  if (brand.home === 'arena') return <ArenaRoute />
  return <RouteMeta title={brand.title} description={brand.description}>
    <MarketsDirectoryApp apiUrl={appConfig.predictionProxyUrl} />
  </RouteMeta>
}

/** The live arena: `/` when it is the brand's home, /highlight otherwise. */
export function ArenaRoute() {
  const liveHref = appConfig.gameOrigin ? `${appConfig.gameOrigin}/watch/live/agent-colosseum` : ''
  const meta = brand.home === 'arena'
    ? { title: brand.title, description: brand.description }
    : { title: brandTitle('Highlight'), description: 'Watch Genesis agents compete, predict the outcome, and direct the action.' }
  return <RouteMeta {...meta}>
    <HomeApp
      dreamDexApiUrl={appConfig.predictionProxyUrl}
      apiUrl={appConfig.predictionProxyUrl}
      demoHref="/demo"
      liveHref={liveHref}
      livestreamUrl={appConfig.livestreamUrl}
      eventBasePath="/events"
      marketSources={appConfig.marketSources}
    />
  </RouteMeta>
}

export function DemoRoute() {
  return <RouteMeta title={brandTitle('Practice Arena')} description="Simulate SOLZ match predictions, Genesis agent directives, and SOL or SOLZ positions."><DemoArenaApp /></RouteMeta>
}

export function LiveRoute() {
  return <RouteMeta title={brandTitle('Live Arena')} description="Trade match outcomes on Solana with Manifest or Somnia with DreamDEX Event Contracts.">
    <PredictionApp apiUrl={appConfig.predictionProxyUrl} marketSources={liveMarketSources.length ? liveMarketSources : ['SOLANA']} />
  </RouteMeta>
}

export function WatchRoute() {
  return <RouteMeta title={brandTitle('Watch SOLZ')} description="Observe live SOLZ game rooms."><LiveArenaApp /></RouteMeta>
}

export function MarketsRoute() {
  return <RouteMeta title={brandTitle('Prediction markets')} description={`Browse arena markets and general questions from PANTA and ${brand.name}, or propose a market.`}><MarketsDirectoryApp apiUrl={appConfig.predictionProxyUrl} /></RouteMeta>
}

export function MarketProposalRoute() {
  return <RouteMeta title={brandTitle('Propose a market')} description="Suggest a Yes / No prediction market for review. A wallet signature verifies the proposal; no fee."><MarketFormPage form="propose" apiUrl={appConfig.predictionProxyUrl} /></RouteMeta>
}

export function PantaCreateRoute() {
  return <RouteMeta title={brandTitle('Create on PANTA')} description={`Create a prediction market on PANTA from ${brand.name}. Creation charges USDC on Solana mainnet.`}><MarketFormPage form="create" apiUrl={appConfig.predictionProxyUrl} /></RouteMeta>
}

export function PortfolioRoute({ profile }: { profile?: ProfileRoute }) {
  return <RouteMeta title={brandTitle(profile ? 'Profile' : 'Portfolio')} description={profile ? 'Public prediction profile and positions by wallet address.' : 'Manage your active predictions, closed positions, and available payouts.'}>
    <PortfolioApp matchApiUrl="/api/agent-arena" apiUrl={predictionApiUrl} profile={profile} />
  </RouteMeta>
}

export function AgentArenaRoute({ initialAgent = '' }: { initialAgent?: string }) {
  const watchUrl = appConfig.gameOrigin ? `${appConfig.gameOrigin}/watch/live/agent-arena` : ''
  return <RouteMeta title="Agent arena · COOLA" description="Public Genesis agent records, Soda Liquid balances, match history and scoreboards.">
    <AgentArenaApp endpoint="/api/agent-arena" watchUrl={watchUrl} initialAgent={initialAgent} />
  </RouteMeta>
}

export function CatwalkRoute() {
  return <RouteMeta title="CATWALK — the MIAW PRIX rotation" description="Every coin in the MIAW PRIX rotation: who walks the runway, who is in the line-up, and which slots are open."><CatwalkApp endpoint="/api/agent-arena" /></RouteMeta>
}

export function MiawPrixRoute({ initialSeasonId = '' }: { initialSeasonId?: string }) {
  return <RouteMeta title="MIAW PRIX · ColaCat" description="The MIAW PRIX season: schedule, results and standings for the coins racing the Agent Colosseum programme.">
    <MiawPrixApp endpoint="/api/agent-arena" predictionApiUrl={appConfig.predictionProxyUrl} initialSeasonId={initialSeasonId} />
  </RouteMeta>
}

export function ColaCatRoute() {
  return <RouteMeta title="$COLACAT · ColaCat" description="A cat is a liquid. Cola is an engine. COLACAT is both — the token that pays for agent directives, agent trades and CATWALK slots.">
    <ColaCatApp arenaHref="/#highlight" marketsHref="/markets" catwalkHref="/catwalk" explainerHref="/bet-or-market" mint={appConfig.colacatMint} />
  </RouteMeta>
}

export function BetOrMarketRoute() {
  return <RouteMeta title="Bet vs prediction market · ColaCat" description="Who is on the other side, where the price comes from, whether you can leave, and where the order book actually lives — a bookmaker against an on-chain prediction market.">
    <BetOrMarketApp colacatHref="/colacat" marketsHref="/markets" arenaHref="/#highlight" />
  </RouteMeta>
}

export function EventRoute({ eventId, predictionId, initialOutcomeId, variant }: { eventId: string; predictionId?: string; initialOutcomeId?: string; variant: EventVariant }) {
  const metadata = variant === 'markets'
    ? { title: brandTitle('Event markets'), description: `Watch the agents, trade the outcome, and follow every move on ${brand.name}.` }
    : variant === 'community'
      ? { title: brandTitle('Event community'), description: `Join the sideline, follow the live match, and trade the outcome on ${brand.name}.` }
      : { title: brandTitle('Event agents'), description: `Follow the roster, fuel your agents with a prompt, and trade the live event on ${brand.name}.` }
  return <RouteMeta {...metadata}>
    <EventApp apiUrl={predictionApiUrl} eventId={eventId} predictionId={predictionId} initialOutcomeId={initialOutcomeId} variant={variant} paths={paths} />
  </RouteMeta>
}

/** A PANTA market, or a group of PANTA markets we list, at /events-panta/<id>. */
export function PantaEventRoute({ id }: { id: string }) {
  return <RouteMeta title={brandTitle('PANTA market')} description={`A PANTA prediction market listed on ${brand.name}: live price, recorded history and rules. Trading and resolution happen on PANTA.`}>
    <PantaEventApp apiUrl={predictionApiUrl} id={id}/>
  </RouteMeta>
}

export function PitchDeckRoute({ slide, onSlideChange }: { slide: number, onSlideChange: (slide: number) => void }) {
  return <RouteMeta title="Bullseye · Pitch deck" description="Bullseye: watch an AI trader build its conviction in public before you follow it. Watch first. Follow later.">
    <PitchDeckApp slide={slide} onSlideChange={onSlideChange} />
  </RouteMeta>
}
