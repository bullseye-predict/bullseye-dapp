import { ArrowRight, ArrowUpRight, Bot, ChevronDown, ChevronRight, Crosshair, Home, Radio, ShieldCheck, Zap } from 'lucide-react'
import { useState } from 'react'
import type { SolzDataSource, SolzMatch, SolzSnapshot } from '../solz/model'
import { AgentPortrait, amountLabel, StatusDot, TeamMark } from '../home/HomePrimitives'
import { eventHref, relativeTime, type EventPaths, type EventVariant } from './eventModel'

type RailProps = { snapshot: SolzSnapshot; match: SolzMatch; source: SolzDataSource }

export function EventMarketRail({ snapshot, match, paths, variant, predictionId }: { snapshot: SolzSnapshot; match: SolzMatch; paths: EventPaths; variant: EventVariant; predictionId?: string }) {
  const [showUpcoming, setShowUpcoming] = useState(true)
  return <nav className="ev-market-nav" aria-label="Arena event navigation">
    <a className="ev-rail-home" href={paths.home}><Home size={17}/>Home<ArrowUpRight size={13}/></a>
    <div className="ev-rail-heading"><h2><Radio size={16}/> LIVE ARENA</h2><span>{snapshot.matches.filter((item) => item.phase === 'live').length}</span></div>
    <div className="ev-nav-matches">{snapshot.matches.filter((item) => item.phase === 'live' || item.id === match.id).map((item) => <a href={eventHref(paths.variants[variant], item.id)} aria-current={item.id === match.id ? 'page' : undefined} key={item.id}><span className="ev-nav-marks">{item.teams.slice(0, 2).map((team) => <TeamMark key={team.teamId} id={team.teamId} color={team.color} logoUrl={team.logoUrl}/>)}</span><span><strong>{item.teams.map((team) => team.symbol).join(' / ')}</strong><small>{item.mode} · {item.map}</small></span><ChevronRight size={13}/></a>)}</div>
    <div className="ev-nav-divider"/>
    <h3 className="ev-nav-subheading">THIS EVENT<span>{snapshot.markets.filter((item) => item.matchId === match.id).length}</span></h3>
    <div className="ev-nav-markets">{snapshot.markets.filter((item) => item.matchId === match.id).map((market, index) => <a key={market.id} href={market.outcomes.length > 2 ? eventHref(paths.variants[variant], match.id, market.id) : `${predictionId ? eventHref(paths.variants[variant], match.id) : ''}#event-${market.id}`} aria-current={market.id === predictionId ? 'page' : undefined}><span>{String(index + 1).padStart(2, '0')}</span>{market.title}<ArrowUpRight size={12}/></a>)}</div>
    <button className="ev-nav-subheading ev-nav-upcoming" aria-expanded={showUpcoming} aria-controls="upcoming-events" onClick={() => setShowUpcoming(!showUpcoming)}>UP NEXT<ChevronDown size={14}/></button>
    <div className="ev-nav-matches" id="upcoming-events" hidden={!showUpcoming}>{snapshot.matches.filter((item) => item.phase !== 'live' && item.id !== match.id).map((item) => <a href={eventHref(paths.variants[variant], item.id)} key={item.id}><Crosshair size={16}/><span><strong>{item.teams.map((team) => team.symbol).join(' / ')}</strong><small>{item.mode}</small></span><ChevronRight size={13}/></a>)}</div>
    <div className="ev-rail-foot"><ShieldCheck size={14}/><span>THE AGENTS PLAY.<br/>YOU MAKE THE CALL.</span></div>
  </nav>
}

function AgentPrompt({ snapshot, match, source, agentId, onAgent }: RailProps & { agentId: string; onAgent: (id: string) => void }) {
  const [text, setText] = useState('')
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean } | null>(null)
  const agent = match.roster.find((item) => item.agentId === agentId)
  const intent = { matchId: match.id, agentId, text, token: 'COOLA' as const }
  const quote = source.quotePrompt(intent)
  const unavailable = match.phase !== 'live' || snapshot.updatedAt >= match.endsAt || agent?.status !== 'active' || !snapshot.capabilities.prompts.ready
  async function send() {
    if (pending) return
    setPending(true); setFeedback(null)
    try { const receipt = await source.submitPrompt(intent); setFeedback({ text: receipt.message }); setText('') }
    catch (reason) { setFeedback({ text: reason instanceof Error ? reason.message : 'Your prompt could not be sent.', error: true }) }
    finally { setPending(false) }
  }
  return <form className="ch-mini-prompt ev-agent-prompt" aria-label="Quick agent prompt" onSubmit={(event) => { event.preventDefault(); void send() }}>
    <div className="ch-mini-heading"><span><Zap size={13}/> FUEL YOUR AGENT</span><span>{quote.cost} <b>COOLA</b></span></div>
    <label className="sr-only" htmlFor="agent-rail-prompt">Quick instruction to agent</label><textarea id="agent-rail-prompt" value={text} onChange={(event) => setText(event.target.value)} minLength={8} maxLength={220} rows={3} required disabled={unavailable} placeholder={unavailable ? 'Prompts open when the agent is active.' : 'Give your agent the next move…'}/>
    <div className="ch-mini-controls"><label><span className="sr-only">Quick prompt agent</span><select value={agentId} onChange={(event) => onAgent(event.target.value)}>{match.roster.map((item) => <option key={item.agentId} value={item.agentId}>{item.codename}</option>)}</select></label><small>{text.length}/220</small><button aria-label={`Send quick prompt for ${quote.cost} COOLA`} disabled={pending || unavailable || text.trim().length < 8}><ArrowRight size={16}/></button></div>
    {feedback && <p className={`ev-prompt-feedback ${feedback.error ? 'is-error' : ''}`} role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>}
    <p className="ev-prompt-balance">{amountLabel(snapshot.account.balances.COOLA)} COOLA AVAILABLE</p>
  </form>
}

export function EventAgentRail({ snapshot, match, source }: RailProps) {
  const [agentId, setAgentId] = useState(match.roster[0]?.agentId ?? '')
  const [open, setOpen] = useState(true)
  const [feedOpen, setFeedOpen] = useState(true)
  const prompts = snapshot.prompts.filter((item) => item.matchId === match.id).slice(0, 4)
  return <div className="ev-agent-rail">
    <div className="ev-rail-heading"><h2><Bot size={16}/> AGENTS IN PLAY</h2><StatusDot>{match.roster.length}</StatusDot></div>
    <section className="ev-roster"><h3><button aria-expanded={open} aria-controls="event-agent-roster" onClick={() => setOpen(!open)}>MATCH ROSTER<span>K / D</span><ChevronDown size={14}/></button></h3><div id="event-agent-roster" hidden={!open}>{match.teams.map((team) => <div className="ev-agent-team" key={team.teamId}><h4><TeamMark id={team.teamId} color={team.color} logoUrl={team.logoUrl}/>{team.symbol}<span>{team.score} PTS</span></h4>{match.roster.filter((entry) => entry.teamId === team.teamId).map((entry) => <button key={entry.agentId} aria-pressed={agentId === entry.agentId} onClick={() => setAgentId(entry.agentId)}><AgentPortrait number={Number(entry.agentId.split('-')[1])}/><span><strong>{entry.codename}</strong><small>{snapshot.agents.find((agent) => agent.id === entry.agentId)?.archetype ?? entry.status}</small><i><i style={{ width: `${entry.hp / entry.hpMax * 100}%`, background: team.color }}/></i></span><b>{entry.kills}<small> / {entry.deaths}</small></b><Zap size={12}/></button>)}</div>)}</div></section>
    <AgentPrompt snapshot={snapshot} match={match} source={source} agentId={agentId} onAgent={setAgentId}/>
    <section className="ev-prompt-feed"><h3><button aria-expanded={feedOpen} aria-controls="event-agent-prompts" onClick={() => setFeedOpen(!feedOpen)}>PUBLIC DIRECTIVES<ChevronDown size={14}/></button></h3><div id="event-agent-prompts" hidden={!feedOpen}>{prompts.length ? prompts.map((prompt) => <article key={prompt.id}><header><strong>{prompt.codename}</strong><span className={`is-${prompt.status}`}>{prompt.status}</span></header><p>{prompt.text}</p><footer><time>{relativeTime(prompt.at, snapshot.updatedAt)}</time><button aria-label={`Upvote prompt to ${prompt.codename}`} aria-pressed={prompt.upvotedByViewer} onClick={() => source.upvotePrompt(prompt.id)}>↑ {prompt.upvotes}</button></footer></article>) : <p className="ev-empty">Your instruction could be the first move.</p>}</div></section>
  </div>
}
