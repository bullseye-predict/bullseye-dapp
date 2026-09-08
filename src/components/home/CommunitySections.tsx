import { ArrowDownRight, ArrowRight, ArrowUpRight, Check, ChevronRight, Eye, Trophy } from 'lucide-react'
import { useState } from 'react'
import type { QueueSlot, SolzDataSource, SolzMatch, SolzSnapshot } from '../solz/model'
import { Tabs, TabPanel, formatClock } from '../solz/ui'
import { matchLabel } from './heroMarket'
import { amountLabel, compact, percent, StatusDot, TeamMark } from './HomePrimitives'
import type { ArenaTokenConfig } from '../solz/tokenInfo'
import { TokenDirectory } from './TokenDirectory'
import '../../styles/home-community.css'

export function LiveMatches({ snapshot, selectedId, eventBasePath, tokenConfig }: { snapshot: SolzSnapshot; selectedId: string; eventBasePath: string; tokenConfig: ArenaTokenConfig }) {
  const matches = snapshot.matches.filter((match) => match.id !== selectedId)
  return <section className="sh-live-section" id="matches">
    <div className="sh-section-heading"><h2>ELSEWHERE IN THE ARENA<span>{matches.filter((match) => match.phase === 'live').length} LIVE</span></h2><span className="sh-section-meta">FIND YOUR NEXT MATCH <ArrowDownRight size={16}/></span></div>
    <div className="ch-arena-discovery"><div className="sh-live-matches">{matches.map((match) => {
      const market = snapshot.markets.find((item) => item.id === match.marketId)
      const [home, away] = match.teams
      const probability = market?.outcomes[0]?.probability ?? 0.5
      return <a key={match.id} className="sh-match-card" href={`${eventBasePath}/${encodeURIComponent(match.id)}`} aria-label={`Open ${matchLabel(match.teams)} event`}>
        <div className="sh-match-card-top"><StatusDot pink={match.phase !== 'live'}>{match.phase === 'live' ? 'LIVE' : 'UP NEXT'}</StatusDot><span>{match.mode} <span>/</span> {match.phase === 'live' ? formatClock(snapshot.updatedAt - match.startedAt) : formatClock(match.startedAt - snapshot.updatedAt)}</span><ArrowUpRight size={16}/></div>
        {match.teams.length > 2 ? <div className="ch-ffa-match-teams">{match.teams.map((team) => <span key={team.teamId}><TeamMark id={team.teamId} color={team.color}/><b>{team.symbol.replace(/^\$/, '')}</b><small>{percent(market?.outcomes.find((outcome) => outcome.teamId === team.teamId)?.probability ?? 0)}</small></span>)}</div> : <>
        <div className="sh-match-pair"><div><TeamMark id={home.teamId} color={home.color}/><strong>{home.symbol}</strong></div><span>{match.phase === 'live' ? `${home.score} : ${away.score}` : 'VS'}</span><div><TeamMark id={away.teamId} color={away.color}/><strong>{away.symbol}</strong></div></div>
        <div className="sh-match-odds"><span style={{ color: home.color }}>{percent(probability)}</span><span style={{ color: away.color }}>{percent(1 - probability)}</span></div>
        <div className="sh-odds-bar" style={{ background: away.color }}><i style={{ width: percent(probability), background: home.color }}/></div>
        </>}
        <div className="sh-match-card-bottom"><span>{compact(market?.volume.COOLA ?? 0)} COOLA VOL.</span><span><Eye size={12}/>{compact(match.viewers)}<ChevronRight size={14}/></span></div>
      </a>
    })}</div><TokenDirectory config={tokenConfig}/></div>
  </section>
}

export function TeamStandings({ snapshot, onSelect }: { snapshot: SolzSnapshot; onSelect: (match: SolzMatch) => void }) {
  const [view, setView] = useState<'top' | 'queue' | 'results'>('top')
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null)
  const team = snapshot.teams.find((item) => item.id === selectedTeam)
  const find = (id: string) => snapshot.teams.find((item) => item.id === id)
  return <section className="sh-standings" id="teams">
    <div className="sh-section-heading"><h2>TEAM STANDINGS</h2><Trophy size={18}/></div>
    <div className="sh-panel-title"><span>THE COMMUNITIES RUNNING THE ARENA</span><span>SEASON 01</span></div>
    <Tabs idPrefix="standings" label="Team standings" value={view} onChange={setView} tabs={[{ id: 'top', label: 'Top teams' }, { id: 'queue', label: 'Match queue' }, { id: 'results', label: 'Recent results' }]}/>
    <TabPanel id="top" idPrefix="standings" active={view === 'top'}>
      <table className="sh-team-table"><thead><tr><th scope="col">RANK</th><th scope="col">TEAM</th><th scope="col">W / L</th><th scope="col">RATING</th></tr></thead><tbody>{snapshot.teams.filter((item) => item.rank > 0).slice(0, 6).map((item) => <tr key={item.id} className={item.rank === 1 ? 'sh-top-team' : ''}><td><span>{String(item.rank).padStart(2, '0')}</span></td><th scope="row"><button onClick={() => setSelectedTeam(selectedTeam === item.id ? null : item.id)} aria-expanded={selectedTeam === item.id} aria-label={`View ${item.symbol} team details`}><TeamMark id={item.id} color={item.color}/><span>{item.symbol}<small>{item.name}</small></span></button></th><td>{item.wins}<span> / {item.losses}</span></td><td>{item.rating.toLocaleString('en')}<small className={item.ratingDelta >= 0 ? 'sh-lime' : 'sh-pink'}>{item.ratingDelta >= 0 ? '↗ +' : '↘ '}{item.ratingDelta}</small></td></tr>)}</tbody></table>
      {team && <div className="sh-team-detail"><strong>{team.symbol} / TEAM PROFILE</strong><p>{team.blurb}</p><span>{team.matchesHosted} arenas hosted · {team.communityPlayers} community players · {team.streak} streak</span></div>}
    </TabPanel>
    <TabPanel id="queue" idPrefix="standings" active={view === 'queue'}><div className="sh-queue">{snapshot.queue.map((entry) => {
      const match = snapshot.matches.find((item) => item.id === entry.matchId)
      return <div key={entry.id}><span className={entry.slot === 'NOW' ? 'sh-lime' : ''}>{entry.slot}</span><strong>{find(entry.homeTeamId)?.symbol} <small>VS</small> {find(entry.awayTeamId)?.symbol}</strong>{match ? <button className="sh-text-button" onClick={() => onSelect(match)}>Watch <ArrowUpRight size={14}/></button> : <small>In {formatClock(entry.startsAt - snapshot.updatedAt)}</small>}</div>
    })}<p>Qualified communities rotate into official Genesis matches.</p></div></TabPanel>
    <TabPanel id="results" idPrefix="standings" active={view === 'results'}><div className="sh-results">{snapshot.results.slice(0, 6).map((entry) => <div key={entry.id}><span>{find(entry.homeTeamId)?.symbol}</span><strong>{entry.homeScore} <span>—</span> {entry.awayScore}</strong><span>{find(entry.awayTeamId)?.symbol}</span><small>FINAL</small></div>)}</div></TabPanel>
    <div className="sh-panel-foot"><span>COINS ARE THE TEAMS. AGENTS ARE THE PLAYERS.</span><span>↗</span></div>
  </section>
}

export function ArenaEntry({ snapshot, source }: { snapshot: SolzSnapshot; source: SolzDataSource }) {
  const [view, setView] = useState<'qualify' | 'bid'>('qualify')
  const [teamId, setTeamId] = useState('team-giga')
  const [slot, setSlot] = useState<QueueSlot | 'RESERVE'>('RESERVE')
  const [amount, setAmount] = useState('')
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<{ text: string; error: boolean } | null>(null)
  const quote = source.quoteSpotBid(slot)
  const team = snapshot.teams.find((item) => item.id === teamId) ?? snapshot.teams[0]
  const progress = Math.round(team.activity.progress * 100)

  async function bid() {
    setPending(true); setFeedback(null)
    try {
      const result = await source.placeSpotBid(teamId, slot, Number(amount || quote.minimum), quote.token)
      setFeedback({ text: `${team.symbol} leads the ${slot.toLowerCase()} slot with ${amountLabel(result.amount)} ${result.token} in preview credits.`, error: false })
      setAmount('')
    } catch (reason) { setFeedback({ text: reason instanceof Error ? reason.message : 'Please try again.', error: true }) }
    finally { setPending(false) }
  }

  return <section className="sh-entry" id="enter-arena">
    <div className="sh-section-heading"><h2>MAKE YOUR TEAM MATTER</h2><ArrowUpRight size={20}/></div>
    <div className="sh-entry-panel">
      <div className="sh-entry-banner"><span>OPEN CALL / ALL COMMUNITIES</span><span>↗↗↗</span></div>
      <div className="sh-entry-intro"><h3>YOUR TOKEN.<br/>IN THE SPOTLIGHT.</h3><p>Build your community’s record.<br/>Let Genesis agents fly your flag.</p></div>
      <Tabs idPrefix="entry" label="Arena entry options" value={view} onChange={(next) => { setView(next); setFeedback(null) }} tabs={[{ id: 'qualify', label: 'Earn your place' }, { id: 'bid', label: 'Bid for a spot' }]}/>
      <TabPanel id="qualify" idPrefix="entry" active={view === 'qualify'}>
        <ol className="sh-qualification-steps"><li><b>01</b><span><strong>HOST & PLAY</strong><small>Bring your token into community matches.</small></span><ArrowRight size={16}/></li><li><b>02</b><span><strong>BUILD YOUR RECORD</strong><small>Complete matches. Grow an active community.</small></span><ArrowRight size={16}/></li><li><b>03</b><span><strong>TAKE THE STAGE</strong><small>Qualify for the ladder and highlight rotation.</small></span><Check size={16}/></li></ol>
        <div className="sh-qualification-check"><label htmlFor="qualification-team">CHECK A COMMUNITY</label><select id="qualification-team" value={teamId} onChange={(event) => setTeamId(event.target.value)}>{snapshot.teams.map((item) => <option key={item.id} value={item.id}>{item.symbol}</option>)}</select><div className="sh-progress-label"><span>{team.status === 'qualified' ? 'QUALIFIED FOR THE ARENA' : 'QUALIFICATION PROGRESS'}</span><strong>{progress}%</strong></div><progress value={progress} max="100" aria-label={`${team.symbol} qualification progress`}/><p>{team.activity.matches}/{team.activity.matchesRequired} matches · {team.activity.uniquePlayers}/{team.activity.uniquePlayersRequired} players · {team.activity.hostedArenas}/{team.activity.hostedArenasRequired} arenas</p></div>
      </TabPanel>
      <TabPanel id="bid" idPrefix="entry" active={view === 'bid'}><form className="sh-bid-form sh-form-stack" onSubmit={(event) => { event.preventDefault(); void bid() }}><p>Bid for a place in the highlight queue. A spotlight slot earns exposure; your team’s record is earned in the arena.</p><div className="sh-form-columns"><label>COMMUNITY<select value={teamId} onChange={(event) => setTeamId(event.target.value)}>{snapshot.teams.map((item) => <option key={item.id} value={item.id}>{item.symbol}</option>)}</select></label><label>QUEUE SLOT<select value={slot} onChange={(event) => { setSlot(event.target.value as QueueSlot | 'RESERVE'); setAmount(''); setFeedback(null) }}><option value="NEXT">Next</option><option value="UPCOMING">Upcoming</option><option value="RESERVE">Reserve</option></select></label></div><label>BID AMOUNT ({quote.token})<input type="number" required min={quote.minimum} step={quote.token === 'SOL' ? '0.001' : '1'} value={amount || quote.minimum} onChange={(event) => setAmount(event.target.value)}/></label><div className="sh-bid-min"><span>Minimum bid</span><b>{amountLabel(quote.minimum)} {quote.token}</b></div><button className="sh-button sh-button--black" disabled={pending}>{pending ? 'Submitting…' : 'Place preview bid'}<ArrowUpRight size={17}/></button><small>{amountLabel(snapshot.account.balances[quote.token])} {quote.token} available. Preview bids reserve credits until you are outbid.</small></form></TabPanel>
      {feedback && <p className={`sh-feedback ${feedback.error ? 'is-error' : ''}`} role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>}
    </div>
  </section>
}
