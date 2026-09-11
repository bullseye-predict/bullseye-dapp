import { ArrowRight, ArrowUpRight, Check, ChevronDown, Zap } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { SolzDataSource, SolzMatch, SolzSnapshot } from '../solz/model'
import { promptRecipients } from '../solz/promptRouting'
import { AnimatedCollapse } from './AnimatedCollapse'
import { amountLabel } from './HomePrimitives'

type Props = {
  source: SolzDataSource; snapshot: SolzSnapshot; match: SolzMatch; open: boolean; onToggle: () => void
  promptAgentId?: string; intermission: boolean; simulation: boolean
}

export function PromptComposer({ source, snapshot, match, open, onToggle, promptAgentId, intermission, simulation }: Props) {
  const [prompt, setPrompt] = useState('')
  const [agentId, setAgentId] = useState(promptAgentId ?? '')
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<{ text: string; error: boolean } | null>(null)
  const [fueling, setFueling] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const fuelTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const mounted = useRef(true)
  const recipients = promptRecipients(match, prompt, agentId || undefined)
  const allActive = match.roster.filter((entry) => entry.status === 'active')
  const targetLabel = recipients.length === allActive.length && recipients.every((entry) => entry.status === 'active')
    ? 'All active agents' : recipients.map((entry) => entry.codename).join(', ')
  const quote = source.quotePrompt({ matchId: match.id, agentId: agentId || undefined, text: prompt, token: 'COOLA' })
  const unavailable = !simulation || intermission || match.phase !== 'live' || snapshot.updatedAt >= match.endsAt || !snapshot.capabilities.prompts.ready
  const inactive = recipients.find((entry) => entry.status !== 'active')
  const canSend = !unavailable && !inactive && recipients.length > 0 && !pending && !fueling && prompt.trim().length >= 8 && snapshot.account.balances.COOLA >= quote.cost

  useEffect(() => {
    const agent = match.roster.find((entry) => entry.agentId === promptAgentId)
    setAgentId(agent?.agentId ?? '')
    if (agent) input.current?.focus()
  }, [promptAgentId, match.id])
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; clearTimeout(fuelTimer.current) }
  }, [])

  async function sendPrompt() {
    if (!canSend) return
    setPending(true); setFeedback(null)
    try {
      await source.submitPrompt({ matchId: match.id, agentId: agentId || undefined, text: prompt, token: 'COOLA' })
      if (!mounted.current) return
      setPrompt(''); setFueling(true)
      setFeedback({ text: `Queued for ${targetLabel}. ${quote.cost} $COOLA used.`, error: false })
      clearTimeout(fuelTimer.current)
      fuelTimer.current = setTimeout(() => setFueling(false), 1600)
    } catch (reason) {
      if (mounted.current) setFeedback({ text: reason instanceof Error ? reason.message : 'Couldn’t send your prompt. Try again.', error: true })
    } finally { if (mounted.current) setPending(false) }
  }

  const hint = inactive ? `${inactive.codename} is out of this round.` : unavailable ? 'Agents accept prompts during a live match.' : prompt.trim().length > 0 && prompt.trim().length < 8 ? 'Add a little more detail · at least 8 characters.' : 'Enter to send · Shift + Enter for a new line'
  const examples = ['Hold the west relay and protect the team.', 'Coke, take the lead. Pepsi, cover the flank.']

  return <section className={`ch-console-accordion ch-prompt-accordion ${open ? 'is-open' : ''} ${fueling ? 'is-fueling' : ''}`}>
    <header className="ch-mini-prompt">
      <h3><button id="console-prompt-button" className="ch-mini-heading" aria-expanded={open} aria-controls="console-prompt-body" onClick={onToggle}><span><Zap size={15}/> PROMPT AGENT</span><span>{quote.cost} <b>$COOLA</b><ChevronDown size={15}/></span></button></h3>
      <form aria-label="Quick agent prompt" onSubmit={(event) => { event.preventDefault(); void sendPrompt() }}>
        <label className="ch-prompt-label" htmlFor="mini-prompt">Your directive <span>{prompt.length}/220</span></label>
        <div className="ch-prompt-composer">
        <textarea id="mini-prompt" ref={input} value={prompt} onChange={(event) => { setPrompt(event.target.value); setFeedback(null) }} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void sendPrompt() } }} placeholder="Type a move… e.g. Coke, defend the relay." minLength={8} maxLength={220} required rows={2} aria-describedby="prompt-hint"/>
        <div className="ch-mini-controls"><label className="ch-prompt-target"><span className="sr-only">Prompt recipient</span><select value={agentId} onChange={(event) => { setAgentId(event.target.value); setFeedback(null) }}><option value="">Auto · from prompt</option>{match.roster.map((entry) => <option key={entry.agentId} value={entry.agentId} disabled={entry.status !== 'active'}>{entry.codename}{entry.status !== 'active' ? ' · out of round' : ''}</option>)}</select></label><button type="submit" aria-label={`Send prompt for ${quote.cost} COOLA`} disabled={!canSend}><span>{fueling ? 'FUELED' : pending ? 'SENDING' : 'FUEL'}</span>{fueling ? <Check size={16}/> : <ArrowRight size={16}/>}<i className="ch-button-soda" aria-hidden="true"/></button></div>
        </div>
        <p id="prompt-hint" className={`ch-prompt-hint ${feedback?.error ? 'is-error' : feedback ? 'is-success' : ''}`} role={feedback?.error ? 'alert' : 'status'}>{feedback?.text ?? hint}</p>
      </form>
      <div className="ch-soda-flow" aria-hidden="true"><i/><i/><i/></div>
    </header>
    <AnimatedCollapse id="console-prompt-body" labelledBy="console-prompt-button" open={open} className="ch-console-reveal">
      <div className="sh-console-body ch-prompt-details">
        <div className="ch-agent-energy"><div className="ch-soda-can" aria-hidden="true"><i className="ch-soda-liquid"/><Zap size={18}/><i className="ch-soda-bubble"/><i className="ch-soda-bubble"/><i className="ch-soda-bubble"/></div><div><h4>{fueling ? 'Energy delivered.' : 'Fuel the next move.'}</h4><p>{agentId ? `Directing ${targetLabel}.` : 'Auto routes to the agents you name. A general prompt reaches every active agent.'}</p></div></div>
        <p>Directives are public. Agents decide whether to accept or ignore them.</p>
        <dl><div><dt>Fuel per directive</dt><dd>{quote.cost} $COOLA</dd></div><div><dt>Sample balance</dt><dd>{amountLabel(snapshot.account.balances.COOLA)} $COOLA</dd></div></dl>
        <h4>Try a directive</h4><div className="ch-prompt-examples">{examples.map((text) => <button key={text} onClick={() => { setPrompt(text); setFeedback(null); input.current?.focus() }}>{text}<ArrowUpRight size={13}/></button>)}</div>
        <p className="sh-form-note">Off-chain sample credits · one fuel charge per directive.</p>
      </div>
    </AnimatedCollapse>
  </section>
}
