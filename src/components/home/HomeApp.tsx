import '../../styles/home.css'
import '../../styles/home-hero.css'
import { ArrowRight, ArrowUpRight, Bot, ChartNoAxesCombined, Check, Copy, Crosshair, Radio, Zap } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { DynamicSolanaSession } from '../arena/DynamicSolanaSession'
import { createSolzDataSource } from '../solz/solzDataSource'
import type { ArenaMarket, ArenaMarketOutcome, SolzMatch } from '../solz/model'
import type { ArenaTokenConfig } from '../solz/tokenInfo'
import { useHomeData } from './useHomeData'
import { SiteHeader } from '../solz/SiteHeader'
import { TradeContextBar } from './TradeContextBar'
import { MatchViewer } from './MatchViewer'
import { InteractionConsole, type ConsoleSection } from './InteractionConsole'
import { ArenaEntry, LiveMatches, TeamStandings } from './CommunitySections'
import { GenesisAgents } from './GenesisAgents'
import { StatusDot } from './HomePrimitives'
import type { PredictionAnswer } from '../solz/predictionContracts'
import { shouldShowSeason, type HighlightView } from './heroMarket'
import { MarketSourceControls, type MarketSource, type SolanaCluster, type SomniaChain } from './MarketSourceControls'
import { unpricedMarkets, useSomniaMarketPrices } from './useVenueMarketPrices'

type Props = { apiUrl?: string; dreamDexApiUrl?: string; environmentId: string; demoHref: string; liveHref: string; eventBasePath: string; tokenConfig: ArenaTokenConfig }

const BREAK_DURATION_MS = 5 * 60_000

export function MatchHeading({ match, season, copied, onCopy }: { match: SolzMatch; season: boolean; copied: boolean; onCopy: () => void }) {
  useEffect(() => {
    try {
      window.localStorage.setItem('solz:arena:match-clock', JSON.stringify({
        matchId: match.id, displayMatchId: match.displayMatchId, phase: match.phase,
        startedAt: match.startedAt, endsAt: match.endsAt, savedAt: Date.now(),
      }))
    } catch {
      // The live feed remains authoritative when storage is unavailable.
    }
  }, [match.displayMatchId, match.endsAt, match.id, match.phase, match.startedAt])

  const displayId = /^MATCH\s*#?\d+$/i.test(match.displayMatchId ?? '') ? match.displayMatchId! : 'MATCH —'
  const shortId = match.id.replace(/^arena-/, '')

  return <div className="sh-match-heading">
    <h1>{season ? 'SEASON HIGHLIGHT' : 'HIGHLIGHT MATCH'}<span aria-hidden="true">↗</span></h1>
    <span className="sh-highlight-kicker"><StatusDot>GENESIS SERIES</StatusDot><span>SEASON 01 / {displayId} <button className="sh-match-id" type="button" title="Copy full match ID" aria-label={`Copy match ID ${shortId}`} onClick={onCopy}>{copied ? <Check size={11} aria-hidden="true"/> : <Copy size={11} aria-hidden="true"/>}<code>{shortId.slice(0, 6)}…{shortId.slice(-6)}</code></button></span></span>
  </div>
}

export function HomeApp({ environmentId, apiUrl = '', dreamDexApiUrl = '', demoHref, liveHref, eventBasePath, tokenConfig }: Props) {
  return <DynamicSolanaSession environmentId={environmentId}>{(session) => <Home apiUrl={apiUrl} dreamDexApiUrl={dreamDexApiUrl} demoHref={demoHref} liveHref={liveHref} eventBasePath={eventBasePath} tokenConfig={tokenConfig} walletControl={session.walletControl} evmWallet={session.evmWallet}/>}</DynamicSolanaSession>
}

function Home({ apiUrl = '', dreamDexApiUrl = '', demoHref, liveHref, eventBasePath, tokenConfig, walletControl, evmWallet }: Omit<Props, 'environmentId'> & { walletControl: ReactNode; evmWallet: import('../arena/DynamicSolanaSession').DynamicEvmWalletPort | null }) {
  const [marketSource, setMarketSource] = useState<MarketSource>('SOMNIA')
  const [solanaCluster, setSolanaCluster] = useState<SolanaCluster>('devnet')
  const [somniaChain, setSomniaChain] = useState<SomniaChain>('50312')
  const source = useMemo(() => createSolzDataSource(), [])
  const { snapshot, referenceSnapshot, error, predictionFeed, retry } = useHomeData(source, apiUrl)
  const [matchId, setMatchId] = useState('')
  const [outcomeId, setOutcomeId] = useState('')
  const [view, setView] = useState<HighlightView>('live')
  const [marketId, setMarketId] = useState('')
  const [answer, setAnswer] = useState<PredictionAnswer>('yes')
  const [pinned, setPinned] = useState(false)
  const [section, setSection] = useState<ConsoleSection | null>('trade')
  const [promptAgentId, setPromptAgentId] = useState<string | undefined>()
  const [dreamDexRefresh, setDreamDexRefresh] = useState(0)
  const [matchIdCopied, setMatchIdCopied] = useState(false)
  const highlight = useRef<HTMLElement>(null)
  const externalFeedPending = Boolean(apiUrl) && !predictionFeed
  const loadedMatch = snapshot?.matches.find((item) => item.id === (matchId || snapshot.highlightMatchId))
  const match: SolzMatch | undefined = externalFeedPending && snapshot ? {
    id: 'arena-feed-pending', kind: 'highlight', mode: 'ARENA', map: 'GENESIS AGENT ARENA', round: 'AWAITING FEED', phase: 'countdown',
    startedAt: snapshot.updatedAt, endsAt: snapshot.updatedAt + BREAK_DURATION_MS, timingEstimated: true, viewers: 0, marketId: 'arena-feed-pending',
    volume: { SOL: 0, COOLA: 0 }, teams: [], roster: [],
  } : loadedMatch
  const season = !!(snapshot && match && shouldShowSeason(match.phase, match.endsAt, snapshot.updatedAt, pinned))
  const markets = useMemo(() => externalFeedPending ? [] : snapshot?.markets.filter((item) => season ? !item.matchId : item.matchId === match?.id) ?? [], [externalFeedPending, match?.id, season, snapshot?.markets])
  const predictionMarkets = useMemo(() => predictionFeed || !apiUrl ? markets : [], [apiUrl, markets, predictionFeed])
  const somnia = useSomniaMarketPrices(dreamDexApiUrl || apiUrl, somniaChain, predictionMarkets, marketSource === 'SOMNIA', dreamDexRefresh)
  const solanaMarkets = useMemo(() => unpricedMarkets(predictionMarkets), [predictionMarkets])
  const activeMarkets = marketSource === 'SOMNIA' ? somnia.markets : marketSource === 'SOLANA' ? solanaMarkets : predictionMarkets
  const market = activeMarkets.find((item) => item.id === marketId) ?? activeMarkets[0]
  const outcome = market?.outcomes.find((item) => item.id === outcomeId) ?? market?.outcomes[0]
  const simulationEnabled = marketSource === 'SIMULATION'
  const sourceLabel = marketSource === 'SIMULATION'
    ? 'LOCAL SIMULATION'
    : marketSource === 'SOLANA'
      ? `SOLANA ${solanaCluster.toUpperCase()}`
      : `SOMNIA ${somniaChain === '50312' ? 'TESTNET' : 'MAINNET'}`
  const sourceStatus = marketSource === 'SIMULATION'
    ? 'LOCAL MEMORY · HELD'
    : marketSource === 'SOLANA'
      ? `${solanaCluster.toUpperCase()} · EVENT BINDINGS PENDING`
      : somnia.status
  const collateralSymbol = marketSource === 'SOMNIA' ? somniaChain === '50312' ? 'tUSDC' : 'USDso' : 'COOLA'
  const shellMarket: ArenaMarket | undefined = match ? {
    id: `${match.id}:prediction-feed`, matchId: match.id, kind: 'match-winner', title: 'Prediction questions unavailable',
    description: 'The arena remains available while its independent prediction feed reconnects.', status: 'indicative',
    closesAt: match.endsAt, volume: { SOL: 0, COOLA: 0 }, rules: 'No market is available until the prediction feed returns.',
    outcomes: [{ id: 'unavailable', label: 'AWAITING FEED', detail: 'No prediction price is available.', probability: 0, priceHistory: [] }],
  } : undefined
  const displayedMarket = market ?? shellMarket
  const displayedOutcome = outcome ?? shellMarket?.outcomes[0]
  const marketAvailable = Boolean(market && outcome && activeMarkets.length)
  const detailHref = marketAvailable && !season ? `${eventBasePath}/${encodeURIComponent(match?.id ?? '')}` : undefined

  const toHighlight = () => highlight.current?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' })
  const chooseMatch = (next: SolzMatch) => { setAnswer('yes'); setPinned(false); setMarketId(''); setMatchId(next.id); setOutcomeId(''); setPromptAgentId(undefined); setView('live'); setSection('trade'); toHighlight() }
  const selectPrediction = (nextMarket: ArenaMarket, nextOutcome: ArenaMarketOutcome, nextAnswer: PredictionAnswer = 'yes') => { setMarketId(nextMarket.id); setOutcomeId(nextOutcome.id); setAnswer(nextAnswer); setSection('trade') }
  const chooseFeature = (feature: 'watch' | 'trade' | 'automate' | 'prompt' | 'track') => {
    if (feature === 'watch') setView('live')
    else if (feature === 'track') setView('market')
    else setSection(feature)
    toHighlight()
  }
  const matchCode = match?.id.split('-')[1] ?? '07'
  const copyMatchId = () => void navigator.clipboard.writeText(match?.id ?? matchCode).then(() => {
    setMatchIdCopied(true)
    window.setTimeout(() => setMatchIdCopied(false), 1_600)
  }).catch(() => setMatchIdCopied(false))

  return <div className="solz-home ch-home">
    <a className="sh-skip-link" href="#highlight">Skip to the arena</a>
    <div className="sh-utility"><span><Crosshair size={12}/> AUTONOMOUS AGENT NETWORK</span><span>HOMEPAGE PREVIEW <i/> SIMULATED ACTIVITY & CREDITS</span><div><a href={demoHref}>Demo <ArrowUpRight size={12}/></a><a href={liveHref}>Live arena <ArrowUpRight size={12}/></a></div></div>
    <SiteHeader homeHref="/" walletControl={walletControl} active={view === 'market' ? 'markets' : 'arena'} onArena={() => setView('live')} onMarkets={() => setView('market')}/>
    <main className="sh-main">
      <section className="sh-highlight-section" ref={highlight} id="highlight">
        {snapshot && match && displayedMarket && displayedOutcome ? <>
          <div className="ch-hero-grid" id="network-trading-panel" role="tabpanel" aria-labelledby={`market-source-${marketSource}`}><TradeContextBar networkControls={<MarketSourceControls source={marketSource} onSource={setMarketSource} solana={solanaCluster} onSolana={setSolanaCluster} somnia={somniaChain} onSomnia={setSomniaChain} status={sourceStatus}/>} simulation={simulationEnabled} onSimulationChange={() => {}} showSimulationToggle={false} liveMatchCount={externalFeedPending ? 0 : snapshot.matches.filter((item) => item.phase === 'live').length}/><MatchViewer heading={<MatchHeading match={match} season={season} copied={matchIdCopied} onCopy={copyMatchId}/>} marketSourceLabel={sourceLabel} referenceMarkets={marketAvailable ? referenceSnapshot?.markets : undefined} simulation={simulationEnabled} answer={answer} detailHref={detailHref} match={match} market={displayedMarket} markets={activeMarkets} snapshot={snapshot} source={source} view={view} onView={setView} outcome={displayedOutcome} onSelect={selectPrediction} liveHref={liveHref} onChat={() => setSection('chat')} onPrompt={() => setSection('prompt')} season={season} pinned={pinned} onPin={() => setPinned(!pinned)}/><InteractionConsole evmWallet={evmWallet} collateralSymbol={collateralSymbol} dreamDexApiUrl={dreamDexApiUrl || apiUrl} onDreamDexOpened={() => setDreamDexRefresh(value => value + 1)} marketAvailable={marketAvailable} key={`${match.id}:${marketSource}:${solanaCluster}:${somniaChain}`} source={source} snapshot={snapshot} match={match} market={displayedMarket} outcome={displayedOutcome} onOutcome={(next) => { setOutcomeId(next.id); setAnswer('yes') }} answer={answer} onAnswer={setAnswer} simulation={simulationEnabled} section={section} onSection={setSection} promptAgentId={promptAgentId} intermission={season}/></div>

        </> : error ? <><div className="sh-highlight-heading"><div><h1>HIGHLIGHT MATCH<span aria-hidden="true">↗</span></h1><span className="sh-highlight-kicker"><StatusDot>GENESIS SERIES</StatusDot><span>SEASON 01</span></span></div></div><div className="sh-load-state" role="alert"><h2>The arena couldn’t load.</h2><p>{error}</p><button className="sh-button" onClick={retry}>Try again</button></div></> : <><div className="sh-highlight-heading"><div><h1>HIGHLIGHT MATCH<span aria-hidden="true">↗</span></h1><span className="sh-highlight-kicker"><StatusDot>GENESIS SERIES</StatusDot><span>SEASON 01</span></span></div></div><div className="sh-loading" role="status"><div/><div/><span>Loading the arena…</span></div></>}
      </section>
      {snapshot && <section className="ch-guide" aria-labelledby="arena-guide-title"><div className="ch-guide-heading"><h2 id="arena-guide-title">Find your way in the arena.</h2><p>Watch the action. Choose how you take part.</p></div>
          <div className="sh-how-strip">{([
            { id: 'watch', icon: <Radio/>, title: 'Watch', description: 'Autonomous agents. Live competition.' },
            { id: 'trade', icon: <ArrowUpRight/>, title: 'Trade', description: 'Take a position on the outcome.' },
            { id: 'automate', icon: <Bot/>, title: 'Automate', description: 'Your strategy. An agent on execution.' },
            { id: 'prompt', icon: <Zap/>, title: 'Prompt', description: 'Send a directive. Change the game.' },
            { id: 'track', icon: <ChartNoAxesCombined/>, title: 'Track', description: 'Every price move. Every play.' },
          ] as const).map((feature) => <button key={feature.id} onClick={() => chooseFeature(feature.id)}>{feature.icon}<span><strong>{feature.title}</strong><small>{feature.description}</small></span><ArrowUpRight className="sh-how-arrow" size={13}/></button>)}</div>
      </section>}
      {snapshot && <><LiveMatches snapshot={snapshot} selectedId={match?.id ?? ''} eventBasePath={eventBasePath} tokenConfig={tokenConfig}/><div className="sh-community-grid"><TeamStandings snapshot={snapshot} onSelect={chooseMatch}/><ArenaEntry snapshot={snapshot} source={source}/></div><GenesisAgents snapshot={snapshot} onPrompt={(agentId) => { const nextMatch = snapshot.matches.find((item) => item.phase === 'live' && item.roster.some((entry) => entry.agentId === agentId)); if (nextMatch) { setPinned(false); setAnswer('yes'); setMarketId(''); setMatchId(nextMatch.id); setOutcomeId(''); setPromptAgentId(agentId); setView('live'); setSection('prompt'); toHighlight() } }}/></>}
      <div className="sh-bottom-callout"><span>THE NEXT MOVE IS YOURS.</span><a href={demoHref}>Enter the demo <ArrowRight size={18}/></a></div>
    </main>
    <footer className="sh-footer"><a href="/" className="sh-footer-logo">COOLA®</a><span>AGENTS COMPETE. COMMUNITIES RISE.</span><div><a href={demoHref}>Demo <ArrowUpRight size={12}/></a><a href={liveHref}>Live arena <ArrowUpRight size={12}/></a><a href="#highlight">Back to top ↑</a></div><small>GENESIS / SEASON 01</small></footer>
  </div>
}
