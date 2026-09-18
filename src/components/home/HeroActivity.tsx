import { ArrowUpRight, Users, Zap } from 'lucide-react'
import type { SolzDataSource, SolzMatch, SolzSnapshot } from '../solz/model'
import { AgentPortrait } from './HomePrimitives'
import { SAMPLE_DIRECTIVES } from './sampleDirectives'
import { mergeMatchChat, useLiveChat } from './useLiveChat'
import { directiveStatus, useDirectiveHistory } from './useDirectiveHistory'
import { tokenAmountLabel } from '../solz/directiveRelay'
import type { PromptHint } from './PromptComposer'

type Props = {
  source: SolzDataSource; snapshot: SolzSnapshot; match: SolzMatch; onChat: () => void; onPrompt: () => void; simulation?: boolean
  /** The composer's own sentence. The stage plate above is a fixed shape, so it
   *  hands its hint down here rather than growing a line to hold it. */
  promptHint?: PromptHint | null
}

/**
 * The two rails under the stage. Neither carries a title any more: each one
 * docks against the plate directly above it, which already names it, so a
 * heading here only repeated that plate and ate a line of the feed. What is
 * left is the feed itself and the control that opens the full view.
 */
export function HeroActivity({ source, snapshot, match, onChat, onPrompt, simulation = true, promptHint }: Props) {
  // The arena's public room and this device's own messages, in one list. A
  // lobby message carries no match id and belongs to every match; a local one
  // is what the viewer still has while that room is unreachable.
  const room = useLiveChat()
  const chat = mergeMatchChat(snapshot.chat.filter((item) => item.kind === 'viewer' || item.self), room.messages, match.id).slice(-12).reverse()
  const prompts = snapshot.prompts.filter((item) => item.matchId === match.id).slice(0, 12)
  // Paid directives. They are not in the snapshot and never were: the relay
  // owns them, so they are read from it rather than from the data source. See
  // src/components/home/directiveHistory.ts.
  const sent = useDirectiveHistory()
  // A directive names a bot id. The roster on screen is the only place a
  // codename can come from, and the relay may have addressed a different match
  // than this card, so an unknown id prints as itself rather than as a guess.
  const codename = (botId?: string) => botId
    ? match.roster.find((entry) => entry.agentId === botId)?.codename ?? botId
    : 'ALL AGENTS'
  return <div className="ch-activity">
    <section className="ch-chat-preview"><header><button aria-label="Open full live chat" onClick={onChat}><ArrowUpRight size={15}/></button></header><div tabIndex={0} role="region" aria-label="Chat highlight feed" className={chat.length ? '' : 'is-empty'}>{chat.length === 0 && <p className="ch-empty">No messages yet.</p>}{chat.map((item, index) => <article key={item.id}><span className="ch-chat-avatar" style={{ color: ['#c7ff00', '#ff579d', '#6bcbff'][index % 3] }}>{item.author.slice(0, 1).toUpperCase()}</span><p><b>{item.author}</b><span>{item.text}</span></p></article>)}</div><button className="ch-text-button" onClick={onChat}>Join the conversation <ArrowUpRight size={12}/></button></section>
    <section className="ch-prompt-preview">
      {/* The header row already exists and already has its height. Putting the
          composer's hint in it is what keeps the plate above from moving. */}
      <header>
        {promptHint && <p id="prompt-hint" className={`ch-rail-hint is-${promptHint.tone}`} role={promptHint.tone === 'error' ? 'alert' : 'status'} title={promptHint.text}>{promptHint.text}</p>}
        <button aria-label="Open full agent prompt" onClick={onPrompt}><ArrowUpRight size={15}/></button>
      </header>
      <div tabIndex={0} role="region" aria-label="Agent instruction feed">
        {sent.map((item) => <article key={item.id} className="ch-directive-sent"><div><span className="ch-directive-mark" aria-hidden="true"><Zap size={12}/></span><b>{codename(item.botId)}</b><span className={`ch-prompt-status is-${directiveStatus(item.state)}`}>{directiveStatus(item.state)}</span></div><p>{item.text}</p><footer><span>YOU · PAID</span><span>{tokenAmountLabel(item.amountAtoms, item.decimals)} {item.symbol}</span></footer></article>)}
        {prompts.map((item) => <article key={item.id}><div>{item.targetAgentIds && item.targetAgentIds.length > 1 ? <Users size={20} aria-hidden="true"/> : <AgentPortrait number={Number(item.agentId.split('-')[1])}/>}<b>{item.codename}</b><span className={`ch-prompt-status is-${item.status}`}>{item.status}</span></div><p>{item.text}</p><footer><button aria-label={`Support prompt for ${item.codename}`} aria-pressed={item.upvotedByViewer} disabled={!simulation} onClick={() => source.upvotePrompt(item.id)}>↑ {item.upvotes}</button><span>{item.cost} ${item.token}</span></footer></article>)}
        <ul className="ch-prompt-samples">{SAMPLE_DIRECTIVES.map((text) => <li key={text}><button type="button" onClick={onPrompt}>{text}<span className="ch-example-use">USE</span></button></li>)}</ul>
      </div>
    </section>
  </div>
}
