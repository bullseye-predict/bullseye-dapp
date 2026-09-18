import { ArrowUpRight, Users } from 'lucide-react'
import type { SolzDataSource, SolzMatch, SolzSnapshot } from '../solz/model'
import { AgentPortrait } from './HomePrimitives'
import { SAMPLE_DIRECTIVES } from './sampleDirectives'
import { mergeMatchChat, useLiveChat } from './useLiveChat'

type Props = { source: SolzDataSource; snapshot: SolzSnapshot; match: SolzMatch; onChat: () => void; onPrompt: () => void; simulation?: boolean }

/**
 * The two rails under the stage. Neither carries a title any more: each one
 * docks against the plate directly above it, which already names it, so a
 * heading here only repeated that plate and ate a line of the feed. What is
 * left is the feed itself and the control that opens the full view.
 */
export function HeroActivity({ source, snapshot, match, onChat, onPrompt, simulation = true }: Props) {
  // The arena's public room and this device's own messages, in one list. A
  // lobby message carries no match id and belongs to every match; a local one
  // is what the viewer still has while that room is unreachable.
  const room = useLiveChat()
  const chat = mergeMatchChat(snapshot.chat.filter((item) => item.kind === 'viewer' || item.self), room.messages, match.id).slice(-12).reverse()
  const prompts = snapshot.prompts.filter((item) => item.matchId === match.id).slice(0, 12)
  return <div className="ch-activity">
    <section className="ch-chat-preview"><header><button aria-label="Open full live chat" onClick={onChat}><ArrowUpRight size={15}/></button></header><div tabIndex={0} role="region" aria-label="Chat highlight feed" className={chat.length ? '' : 'is-empty'}>{chat.length === 0 && <p className="ch-empty">No messages yet.</p>}{chat.map((item, index) => <article key={item.id}><span className="ch-chat-avatar" style={{ color: ['#c7ff00', '#ff579d', '#6bcbff'][index % 3] }}>{item.author.slice(0, 1).toUpperCase()}</span><p><b>{item.author}</b><span>{item.text}</span></p></article>)}</div><button className="ch-text-button" onClick={onChat}>Join the conversation <ArrowUpRight size={12}/></button></section>
    <section className="ch-prompt-preview"><header><button aria-label="Open full agent prompt" onClick={onPrompt}><ArrowUpRight size={15}/></button></header><div tabIndex={0} role="region" aria-label="Agent instruction feed">{prompts.map((item) => <article key={item.id}><div>{item.targetAgentIds && item.targetAgentIds.length > 1 ? <Users size={20} aria-hidden="true"/> : <AgentPortrait number={Number(item.agentId.split('-')[1])}/>}<b>{item.codename}</b><span className={`ch-prompt-status is-${item.status}`}>{item.status}</span></div><p>{item.text}</p><footer><button aria-label={`Support prompt for ${item.codename}`} aria-pressed={item.upvotedByViewer} disabled={!simulation} onClick={() => source.upvotePrompt(item.id)}>↑ {item.upvotes}</button><span>{item.cost} ${item.token}</span></footer></article>)}<ul className="ch-prompt-samples">{SAMPLE_DIRECTIVES.map((text) => <li key={text}><button type="button" onClick={onPrompt}>{text}<span className="ch-example-use">USE</span></button></li>)}</ul></div></section>
  </div>
}
