import { ArrowUpRight, MessageSquare, Users, Zap } from 'lucide-react'
import type { SolzDataSource, SolzMatch, SolzSnapshot } from '../solz/model'
import { AgentPortrait } from './HomePrimitives'

type Props = { source: SolzDataSource; snapshot: SolzSnapshot; match: SolzMatch; onChat: () => void; onPrompt: () => void; simulation?: boolean }
export function HeroActivity({ source, snapshot, match, onChat, onPrompt, simulation = true }: Props) {
  const chat = snapshot.chat.filter((item) => item.matchId === match.id && (item.kind === 'viewer' || item.self)).slice(-12).reverse()
  const prompts = snapshot.prompts.filter((item) => item.matchId === match.id).slice(0, 12)
  return <div className="ch-activity">
    <section className="ch-chat-preview"><header><h3><button onClick={onChat}><MessageSquare size={13}/> CHAT HIGHLIGHTS</button></h3><button aria-label="Open full live chat" onClick={onChat}><ArrowUpRight size={15}/></button></header><div tabIndex={0} role="region" aria-label="Chat highlight feed">{chat.length ? chat.map((item, index) => <article key={item.id}><span className="ch-chat-avatar" style={{ color: ['#c7ff00', '#ff579d', '#6bcbff'][index % 3] }}>{item.author.slice(0, 1).toUpperCase()}</span><p><b>{item.author}</b><span>{item.text}</span></p></article>) : <p className="ch-empty">A fresh arena. Be the first to make a call.</p>}</div><button className="ch-text-button" onClick={onChat}>Join the conversation <ArrowUpRight size={12}/></button></section>
    <section className="ch-prompt-preview"><header><h3><Zap size={13}/> AGENT INSTRUCTIONS</h3><button aria-label="Open full agent prompt" onClick={onPrompt}><ArrowUpRight size={15}/></button></header><div tabIndex={0} role="region" aria-label="Agent instruction feed">{prompts.length ? prompts.map((item) => <article key={item.id}><div>{item.targetAgentIds && item.targetAgentIds.length > 1 ? <Users size={20} aria-hidden="true"/> : <AgentPortrait number={Number(item.agentId.split('-')[1])}/>}<b>{item.codename}</b><span className={`ch-prompt-status is-${item.status}`}>{item.status}</span></div><p>{item.text}</p><footer><button aria-label={`Support prompt for ${item.codename}`} aria-pressed={item.upvotedByViewer} disabled={!simulation} onClick={() => source.upvotePrompt(item.id)}>↑ {item.upvotes}</button><span>{item.cost} ${item.token}</span></footer></article>) : <p className="ch-empty">Send the first instruction to an agent in this match.</p>}</div></section>
  </div>
}
