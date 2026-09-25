import '../../styles/agent-thinking.css'
import { ArrowUpRight, BrainCircuit } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { AgentMethod } from './generalEventPrices'
import { shortUtc, signedPercent, type AgentThought } from './agentThinking'
import { brand } from '../solz/brand'

const usd = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: value >= 100 ? 2 : 4 }).format(value)

/** "6h 12m", "3d 4h", or "now" once it is due. */
export function countdown(ms: number) {
  if (ms <= 60_000) return 'now'
  const minutes = Math.floor(ms / 60_000), hours = Math.floor(minutes / 60), days = Math.floor(hours / 24)
  return days > 0 ? `${days}d ${hours % 24}h` : hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`
}

/** What each line is, read from its id: the log's own vocabulary. */
function kind(thought: AgentThought) {
  const suffix = thought.id.includes(':') ? thought.id.slice(thought.id.indexOf(':') + 1) : thought.id
  switch (suffix) {
    case 'schedule': return 'SCHEDULE'
    case 'method': return 'HOW I DECIDE'
    case 'reading': return 'READING'
    case 'call': return 'CALL'
    case 'result': return thought.tone === 'correct' ? 'RESULT · CORRECT' : 'RESULT · MISSED'
    case 'running': return 'WINDOW OPEN'
    case 'awaiting': return 'SCORING'
    case 'unpublished': return 'NO CALL'
    default: return 'NEXT CALL'
  }
}

/** The agent's mark. It is a program, not a person, so it gets a glyph and
 *  not a portrait. */
function AgentMark({ size = 12 }: { size?: number }) {
  return <span className="at-mark" aria-hidden="true"><BrainCircuit size={size}/></span>
}

/**
 * Each symbol's move as a bar from a centre line, scaled to the largest move
 * in the same reading. The biggest mover is the one the rule acts on, so it
 * is the one highlighted. Neutral otherwise: a price move is not Yes or No.
 */
export function Moves({ moves }: { moves: NonNullable<AgentThought['moves']> }) {
  const scale = Math.max(...moves.map(move => Math.abs(move.changeMicros ?? 0)), 1)
  const top = Math.max(...moves.map(move => move.changeMicros ?? -Infinity))
  return <ul className="at-moves">{moves.map(move => {
    const change = move.changeMicros
    const width = change === null ? 0 : Math.max(4, Math.abs(change) / scale * 50)
    return <li key={move.symbol} className={change !== null && change === top && moves.length > 1 ? 'is-top' : ''}>
      <b>{move.symbol}</b>
      <span className="at-bar" aria-hidden="true"><i style={change === null ? {} : change >= 0 ? { left: '50%', width: `${width}%` } : { right: '50%', width: `${width}%` }}/></span>
      <em>{change === null ? 'no price' : signedPercent(change)}</em>
      {move.first !== undefined && move.last !== undefined && <small>{usd(move.first)} → {usd(move.last)}</small>}
    </li>
  })}</ul>
}

/**
 * The forecast agent's thread: what it read, what it called and how each
 * window went, oldest first and held at the newest line. Every line is
 * written from a recorded field; see agentThinking.ts.
 */
export function AgentThinkingFeed({ thoughts, loaded, score, questionHref, method, now, rail = false }: {
  thoughts: AgentThought[]
  loaded: boolean
  score?: { correct: number; judged: number; total: number }
  questionHref?: string
  method?: AgentMethod | null
  now?: number
  rail?: boolean
}) {
  const list = useRef<HTMLOListElement>(null)
  const newest = thoughts.at(-1)?.id
  useEffect(() => { const node = list.current; if (node) node.scrollTop = node.scrollHeight }, [newest])
  const clock = now ?? Date.now()
  return <section className={`at-feed ${rail ? 'at-feed--rail' : ''}`} aria-labelledby="agent-thinking-title">
    <header className="at-heading">
      <h2 id="agent-thinking-title"><span className="at-pulse" aria-hidden="true"/>AGENT THINKING</h2>
      {score && score.total > 0 && <span title="Correct calls out of the windows already judged"><b>{score.correct}</b>/{score.judged} correct</span>}
    </header>
    <div className="at-who">
      <AgentMark size={16}/>
      <div>
        <strong>{brand.name} agent</strong>
        <span>{method ? `${method.id} · ${method.lookbackHours}h lookback · ${Math.round(method.baselineProbability * 100)}% fixed` : 'Forecasts this event, one locked call per window'}</span>
      </div>
    </div>
    {!loaded
      ? <div className="at-skeleton" aria-busy="true"><span className="sr-only" role="status">Loading the agent's calls</span>{[0, 1, 2].map(key => <span key={key} className="ev-sk at-sk-row" aria-hidden="true"/>)}</div>
      : thoughts.length === 0
        ? <p className="at-empty">This event has no forecast agent.</p>
        : <ol ref={list} className="at-log" role="log" aria-live="polite" aria-label="Agent reasoning, oldest first">
          {thoughts.map(thought => {
            const next = thought.dueAt !== undefined
            return <li key={thought.id} className={`at-line is-${thought.voice} ${thought.tone ? `is-${thought.tone}` : ''} ${next ? 'is-next' : ''}`}>
              <span className="at-node" aria-hidden="true">{thought.voice === 'agent' ? <AgentMark/> : null}</span>
              <div className="at-body">
                <div className="at-meta">
                  <span className="at-kind">{kind(thought)}</span>
                  {next
                    ? <span className="at-due">in {countdown(thought.dueAt! - clock)}</span>
                    : thought.timed !== false && thought.voice === 'agent' && <time dateTime={new Date(thought.at).toISOString()}>{shortUtc(thought.at)}</time>}
                </div>
                <p>{thought.text}</p>
                {thought.moves && thought.moves.length > 0 && <Moves moves={thought.moves}/>}
              </div>
            </li>
          })}
        </ol>}
    <footer className="at-foot">
      <p>Written from the inputs the agent stored with each call and the oracle's window results. Calls lock before their window opens.</p>
      {questionHref && <a className="at-link" href={questionHref}>Open the agent question <ArrowUpRight size={12}/></a>}
    </footer>
  </section>
}
