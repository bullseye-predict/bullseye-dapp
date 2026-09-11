import { ArrowUpRight, ChartNoAxesCombined, Crosshair, Eye, ListFilter, Maximize, Pin, Radio, X } from 'lucide-react'
import { memo, useEffect, useRef, useState } from 'react'
import type { ArenaMarket, ArenaMarketOutcome, SolzDataSource, SolzMatch, SolzSnapshot } from '../solz/model'
import type { PredictionAnswer } from '../solz/predictionContracts'
import { Tabs, TabPanel, formatClock } from '../solz/ui'
import { AgentPortrait, compact, TeamMark } from './HomePrimitives'
import { HighlightChart } from './HighlightChart'
import { PredictionOptions } from './PredictionOptions'
import { HeroActivity } from './HeroActivity'
import { matchLabel, teamLabel, type HighlightView } from './heroMarket'

// Stable source identity keeps market ticks independent from playback.
const BroadcastMedia = memo(function BroadcastMedia({ source, iframeSrc }: { source?: string; iframeSrc: string }) {
  const [failed, setFailed] = useState(false)
  const [mode, setMode] = useState<'iframe' | 'video'>('iframe')
  return <>
    {mode === 'video' && source && !failed ? <video className="sh-broadcast-image" src={source} controls playsInline autoPlay muted onError={() => { setFailed(true); setMode('iframe') }}/> : <iframe className="sh-broadcast-image sh-broadcast-frame" src={iframeSrc} title="SOLZ agent arena livestream" allow="autoplay; fullscreen"/>}
    <div className="sh-broadcast-source" role="group" aria-label="Broadcast source"><button aria-pressed={mode === 'iframe'} onClick={() => setMode('iframe')}>Arena</button><button disabled={!source} aria-pressed={mode === 'video'} onClick={() => setMode('video')}>Video</button></div>
  </>
})

function matchWinnerBoard(markets: ArenaMarket[], selected: ArenaMarket): ArenaMarket {
  const outcomes = markets.flatMap(item => {
    const yes = item.outcomes.find(outcome => outcome.id === 'yes') ?? item.outcomes[0]
    return yes ? [{ ...yes, id: item.id, label: item.title.replace(/^Will (.+) win\?$/, '$1'), detail: `YES on ${item.title}`, priceHistory: yes.priceHistory ?? [] }] : []
  })
  return { ...selected, id: `${selected.matchId}:winner-board`, title: 'Match winner · all 12 agents', description: 'Twelve linked YES/NO winner questions for this one match.', outcomes }
}

type Props = {
  match: SolzMatch; market: ArenaMarket; markets: ArenaMarket[]; snapshot: SolzSnapshot; source: SolzDataSource
  view: HighlightView; onView: (view: HighlightView) => void; outcome: ArenaMarketOutcome
  onSelect: (market: ArenaMarket, outcome: ArenaMarketOutcome, answer?: PredictionAnswer) => void; liveHref: string
  onChat: () => void; onPrompt: () => void; season: boolean; pinned: boolean; onPin: () => void
  broadcastOnly?: boolean; detailHref?: string; referenceMarkets?: ArenaMarket[]; simulation?: boolean; answer?: PredictionAnswer
}
export function MatchViewer({ match, market, markets, snapshot, source, view, onView, outcome, onSelect, liveHref, onChat, onPrompt, season, pinned, onPin, detailHref, broadcastOnly = false, simulation = true, answer = 'yes', referenceMarkets }: Props) {
  const frame = useRef<HTMLDivElement>(null)
  const [fullscreenError, setFullscreenError] = useState('')
  const [detail, setDetail] = useState<ArenaMarket | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const elapsed = formatClock(snapshot.updatedAt - match.startedAt)
  useEffect(() => { if (detail && !dialog.current?.open) dialog.current?.showModal() }, [detail])
  async function fullscreen() {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await frame.current?.requestFullscreen() }
    catch { setFullscreenError('Full screen is unavailable in this browser.') }
  }
  const winnerMarkets = markets.filter(item => item.kind === 'match-winner')
  const board = matchWinnerBoard(winnerMarkets, winnerMarkets.find(item => item.id === market.id) ?? winnerMarkets[0] ?? market)
  const boardOutcome = board.outcomes.find(item => item.id === market.id) ?? board.outcomes[0]
  return <section className="ch-viewer" aria-label="Highlighted event viewer">
    <div className="ch-view-navigation"><div><h2>{season ? 'GENESIS SEASON LEADER' : matchLabel(match.teams)}</h2>{detailHref ? <a className="ch-detail-button" href={detailHref}>Open detail <ArrowUpRight size={12}/></a> : <button className="ch-detail-button" onClick={() => setDetail(structuredClone(market))}>Open detail <ArrowUpRight size={12}/></button>}{season && <button className="ch-pinned" onClick={onPin}><Pin size={11}/>{pinned ? 'Pinned · release' : 'Keep highlight'}</button>}</div>{!broadcastOnly && <Tabs label="Highlight view" idPrefix="highlight-view" value={view} onChange={onView} tabs={[{ id: 'options', label: <><ListFilter size={14}/> Predictions <span>{markets.length}</span></> }, { id: 'market', label: <><ChartNoAxesCombined size={14}/> Market</> }, { id: 'live', label: <><Radio size={14}/> Livestream</> }]}/>}</div>
    <div className="ch-viewer-body">
    <div className={`ch-screen ${season ? 'is-season' : ''}`}>
      <TabPanel id="live" idPrefix="highlight-view" active={view === 'live'}>
        <div className="sh-broadcast" ref={frame}>
          <BroadcastMedia key={`${match.streamUrl ?? 'iframe'}:${liveHref}`} source={match.streamUrl} iframeSrc={liveHref}/><div className="sh-broadcast-shade" aria-hidden="true"/>
          <div className="sh-broadcast-top"><span className="sh-preview-chip">{match.streamUrl ? 'LIVE BROADCAST' : 'ARENA EMBED'}</span><span><Eye size={13}/>{compact(match.viewers)} watching</span></div>
          <div className={`ch-scoreboard ${match.teams.length > 2 ? 'is-ffa' : ''}`}>
            {match.teams.map((team, index) => <div key={team.teamId} style={{ color: team.color }}><TeamMark id={team.teamId} color={team.color}/><strong>{teamLabel(team.symbol)}</strong><b>{String(team.score).padStart(2, '0')}</b>{index === 0 && match.teams.length === 2 && <span className="ch-score-center"><small>{match.round}</small><strong>{elapsed}</strong><small>{match.mode}</small></span>}</div>)}
          </div>
          <div className="sh-broadcast-bottom"><div><span className="sh-map-label"><Crosshair size={14}/> COOLA / GENESIS SERIES</span><h2>{match.phase === 'settled' ? 'MATCH COMPLETE' : match.map}</h2><div className="ch-broadcast-roster">{match.roster.map((entry) => <span title={entry.codename} key={entry.agentId}><AgentPortrait number={Number(entry.agentId.split('-')[1])}/></span>)}<span>{match.roster.length} CAN AGENTS <span>/ {match.phase === 'settled' ? 'INTERMISSION' : match.mode}</span></span></div></div><div className="ch-broadcast-actions"><a href={liveHref}>Live arena <ArrowUpRight size={12}/></a><button className="sh-icon-button" onClick={fullscreen} aria-label="Full screen broadcast"><Maximize size={17}/></button></div></div>
          {fullscreenError && <p className="sh-fullscreen-error" role="status">{fullscreenError}</p>}
        </div>
      </TabPanel>
      <TabPanel id="market" idPrefix="highlight-view" active={view === 'market'}>{boardOutcome ? <HighlightChart simulation={simulation} key={board.id} market={board} snapshot={snapshot} outcome={boardOutcome} onOutcome={(item) => { const next = winnerMarkets.find(candidate => candidate.id === item.id); const yes = next?.outcomes.find(candidate => candidate.id === 'yes') ?? next?.outcomes[0]; if (next && yes) onSelect(next, yes) }} onMarket={() => {}}/> : <div className="ch-market-empty ch-panel-empty" role="status"><strong>No match market yet.</strong><span>The arena and controls stay available while prediction questions are loading.</span></div>}</TabPanel>
      <TabPanel id="options" idPrefix="highlight-view" active={view === 'options'}>{markets.length ? <PredictionOptions answer={answer} key={`${match.id}-${season}`} markets={markets} market={market} outcome={outcome} snapshot={snapshot} onSelect={onSelect} referenceMarkets={referenceMarkets} simulation={simulation}/> : <div className="ch-options ch-options-empty" role="status"><div className="ch-options-heading"><div><h2>Make your call.</h2><p>0 predictions · waiting for the prediction feed</p></div><span className="ch-simulation">FEED UNAVAILABLE</span></div><div className="ch-market-empty"><strong>No prediction questions yet.</strong><span>Livestream, chat, and agent controls remain available independently.</span></div></div>}</TabPanel>
    </div>

    {!broadcastOnly && <HeroActivity simulation={simulation} source={source} snapshot={snapshot} match={match} onChat={onChat} onPrompt={onPrompt}/>}
    </div>
    <dialog ref={dialog} className="ch-event-dialog" onClose={() => setDetail(null)} aria-labelledby="event-overview-title">
      {detail && <><div><span className="ch-simulation">SIMULATION</span><button aria-label="Close event detail" onClick={() => dialog.current?.close()}><X size={20}/></button></div><h2 id="event-overview-title">{detail.title}</h2><p>{detail.description}</p><h3>Resolution</h3><p>{detail.rules}</p><dl><div><dt>Closes</dt><dd>{new Date(detail.closesAt).toLocaleString('en')}</dd></div><div><dt>Trading</dt><dd>Off-chain sample credits</dd></div></dl>{!detail.matchId && <button className="sh-button" onClick={() => { if (!pinned) onPin(); dialog.current?.close() }}>Keep this highlight <Pin size={14}/></button>}<p className="ch-dialog-note">Market overview · off-chain preview credits.</p></>}
    </dialog>
  </section>
}
