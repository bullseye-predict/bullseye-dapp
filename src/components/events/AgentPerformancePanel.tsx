import '../../styles/agent-thinking.css'
import { AgentCallRows, AgentComparisonChart, type ComparisonSeries } from './AgentComparisonChart'
import { AgentThinkingFeed, Moves } from './AgentThinkingFeed'
import { methodSentence, type AgentThought } from './agentThinking'
import { LINE_COLORS } from './StockMeasurePanel'
import type { StockEvent } from './useStockEvent'
import { brand } from '../solz/brand'

/** The parent's measured lines, one per symbol. A price ladder repeats one
 *  pool under every strike, so symbols are unique here. */
export function comparisonSeries(stock: Pick<StockEvent, 'measured'>): ComparisonSeries[] {
  if (stock.measured.phase !== 'loaded') return []
  const seen = new Set<string>()
  return stock.measured.prices.candidates.filter(candidate => !seen.has(candidate.symbol) && !!seen.add(candidate.symbol))
    .map((candidate, index) => ({ symbol: candidate.symbol, color: LINE_COLORS[index % LINE_COLORS.length]!, points: candidate.points }))
}

/** The newest call with the reading behind it, or what comes next. */
function LatestDecision({ thoughts, method }: { thoughts: AgentThought[]; method: string | null }) {
  const call = thoughts.findLast(thought => thought.id.endsWith(':call'))
  const reading = call && thoughts.find(thought => thought.id === call.id.replace(':call', ':reading'))
  const after = call && thoughts.findLast(thought => thought.id.startsWith(call.id.replace(':call', ':')) && thought.id !== call.id && thought.id !== reading?.id)
  const next = thoughts.find(thought => thought.id === 'next')
  return <div className="ap-latest">
    <span className="ap-kicker">{call ? 'LATEST DECISION' : 'NO CALL YET'}</span>
    {call ? <>
      <p className="ap-call">{call.text}</p>
      {reading && <p className="ap-reading">{reading.text}</p>}
      {reading?.moves && <Moves moves={reading.moves}/>}
      {after && <p className={`ap-after is-${after.tone ?? 'pending'}`}>{after.text}</p>}
    </> : <p className="ap-call">{method ?? 'The agent has not published a call for this event.'}</p>}
    {next && <p className="ap-next">{next.text}</p>}
  </div>
}

export function AgentPerformancePanel({ stock, questionHref, questionTitle }: { stock: StockEvent; questionHref?: string; questionTitle?: string }) {
  const { agentRule, windows, thoughts, score, now, agentPage, agent } = stock
  const own = stock.own.phase === 'loaded' ? stock.own.prices : null
  if (!stock.agentLoaded) return <section className="ap-panel" aria-busy="true">
    <span className="sr-only" role="status">Loading the agent's record</span>
    <span className="ev-sk ev-sk-line sm-sk-note" aria-hidden="true"/>
    <span className="ev-sk sm-sk-chart" aria-hidden="true"/>
    <div className="sm-rows" aria-hidden="true">{[0, 1, 2].map(key => <span key={key} className="ev-sk sm-sk-row"/>)}</div>
  </section>
  if (!agentRule) return <section className="ap-panel"><p className="sm-unavailable" role="status">The agent's schedule is unavailable right now. The market itself is not affected.</p></section>
  const method = methodSentence(agent.method)
  return <section className="ap-panel" aria-labelledby="agent-performance-title">
    <div className="ev-section-title">
      <h2 id="agent-performance-title">{agentPage ? 'Agent against the market' : 'Agent performance'} <span>{brand.wordmark} AGENT</span></h2>
      <span>{score.correct}/{score.judged} correct so far · {score.total} {score.total === 1 ? 'window' : 'windows'}</span>
    </div>
    {agentPage && <p className="sm-note">The linked answers cover <b>0 to {agentRule.expectedWindows} correct calls</b>{agentRule.options ? ` in ${agentRule.options.length} accuracy bands` : ''}. <a href={`/events/${encodeURIComponent(agentRule.parentEventId)}`}>View the main question</a></p>}
    <LatestDecision thoughts={thoughts} method={method}/>
    <AgentComparisonChart windows={windows} series={comparisonSeries(stock)} now={now}/>
    <AgentCallRows windows={windows}/>
    {agentPage && thoughts.length > 0 && <details className="ap-log">
      <summary>Show the full reasoning log</summary>
      <AgentThinkingFeed thoughts={thoughts} loaded score={score} method={agent.method} now={now}/>
    </details>}
    {!agentPage && questionHref && <a className="sm-agent-question" href={questionHref}><span>AGENT PERFORMANCE QUESTION</span><strong>{questionTitle ?? 'How many calls will the agent get right?'}</strong><em>Open question ↗</em></a>}
    <p className="sm-source">Our oracle scores each call against the frozen price-source window. A window without a published call counts as a miss; published calls cannot be edited.</p>
    {agentPage && own?.evidence?.void && <p className="sm-void" role="status">Voided: {own.evidence.void}</p>}
    {agentPage && own?.evidence && <p className="sm-evidence">Evidence hash <code>{own.evidence.hash.slice(0, 16)}…</code></p>}
  </section>
}
