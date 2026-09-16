import { ChartNoAxesCombined, Crosshair, Eye, Maximize, Radio } from 'lucide-react'
import { memo, useRef, useState } from 'react'
import type { ArenaMarket, ArenaMarketOutcome, SolzMatch, SolzSnapshot } from '../solz/model'
import { Tabs, TabPanel, formatClock } from '../solz/ui'
import { ProbabilityChart } from '../markets/ProbabilityChart'
import { chartHeadline, chartSeries } from '../markets/chartSeries'
import { emptyChart } from '../markets/chartEmpty'
import { AgentPortrait, compact, TeamMark } from '../home/HomePrimitives'

const EventMedia = memo(function EventMedia({ source }: { source?: string }) {
  const [failed, setFailed] = useState(false)
  return source && !failed
    ? <video className="sh-broadcast-image" src={source} controls playsInline autoPlay muted onError={() => setFailed(true)}/>
    : <img className="sh-broadcast-image" src="/images/solz/arena-preview.jpg" width="1536" height="1024" alt="Soda-can agents competing in the Genesis arena" fetchPriority="high"/>
})

export type EventView = 'live' | 'market'

type Props = { simulation?: boolean; referenceMarket?: ArenaMarket; view: EventView; match: SolzMatch; market: ArenaMarket; snapshot: SolzSnapshot; outcome: ArenaMarketOutcome; onOutcome: (outcome: ArenaMarketOutcome) => void; prediction?: boolean; broadcast?: boolean; collateral?: string }

export function EventStage({ view, match, market, snapshot, outcome, onOutcome, prediction = false, broadcast = true, collateral }: Props) {
  const [message, setMessage] = useState('')
  const screen = useRef<HTMLDivElement>(null)
  const stage = chartSeries(market, snapshot, { selectedId: outcome.id })
  async function fullscreen() {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await screen.current?.requestFullscreen() }
    catch { setMessage('Full screen is unavailable in this browser.') }
  }
  return <section className="ev-stage" aria-label="Event broadcast and market">
    {broadcast && !prediction && <div className={`ev-scoreboard ${match.teams.length > 2 ? 'is-ffa' : ''}`}>
      {match.teams.map((team, index) => <div key={team.teamId} className="ev-score-team"><TeamMark id={team.teamId} color={team.color} logoUrl={team.logoUrl}/><span>{team.symbol}<small>{team.agentIds.length} AGENTS</small></span><b style={{ color: team.color }}>{String(team.score).padStart(2, '0')}</b>{index < match.teams.length - 1 && <span className="ev-versus">:</span>}</div>)}
      <div className="ev-score-clock"><strong>{formatClock(match.phase === 'queued' || match.phase === 'countdown' ? match.startedAt - snapshot.updatedAt : Math.min(snapshot.updatedAt, match.endsAt) - match.startedAt)}</strong><span>{match.phase === 'settled' ? 'FINAL' : match.round}</span></div>
    </div>}
    <div className={`ev-screen ${broadcast ? '' : 'ev-screen--single'}`}>
      {broadcast && <TabPanel id="live" idPrefix="event-view" active={view === 'live'}>
        <div className="sh-broadcast" ref={screen}>
          <EventMedia key={match.streamUrl ?? 'preview'} source={match.streamUrl}/><div className="sh-broadcast-shade" aria-hidden="true"/>
          <div className="sh-broadcast-top"><span className="sh-preview-chip">{match.streamUrl ? 'LIVE BROADCAST' : 'BROADCAST PREVIEW'}</span><span><Eye size={13}/>{compact(match.viewers)}</span></div>
          <div className="sh-broadcast-bottom"><div><span className="sh-map-label"><Crosshair size={13}/>{match.mode} / GENESIS SERIES</span><h2>{match.map}</h2><div className="ch-broadcast-roster">{match.roster.slice(0, 6).map((agent) => <span key={agent.agentId} title={agent.codename}><AgentPortrait number={Number(agent.agentId.split('-')[1])}/></span>)}<span>{match.roster.length} AGENTS IN THE ARENA</span></div></div><button className="sh-icon-button" aria-label="Full screen broadcast" onClick={() => void fullscreen()}><Maximize size={17}/></button></div>
          {message && <p className="sh-fullscreen-error" role="status">{message}</p>}
        </div>
      </TabPanel>}
      {/* A linked overview arrives here as one synthetic market carrying every
          answer, and a bare binary as its own two real books — `chartShape`
          tells them apart, so both draw every line they have. */}
      <TabPanel id="market" idPrefix="event-view" active={view === 'market'}><ProbabilityChart
        key={market.id}
        title={market.title}
        series={stage.series}
        unit={stage.unit}
        headline={chartHeadline(market, { selectedId: outcome.id, collateral })}
        onSelect={(id) => { const item = market.outcomes.find(entry => entry.id === id); if (item) onOutcome(item) }}
        empty={emptyChart(stage.series)}
      /></TabPanel>
    </div>

  </section>
}

export function EventViewControls({ view, onView }: { view: EventView; onView: (view: EventView) => void }) {
  return <div className="ev-view-controls"><Tabs idPrefix="event-view" label="Event view" value={view} onChange={onView} tabs={[{ id: 'market', label: <><ChartNoAxesCombined size={14}/>Market</> }, { id: 'live', label: <><Radio size={14}/>Livestream</> }]}/></div>
}
