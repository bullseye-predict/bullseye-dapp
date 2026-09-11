import '../../styles/home-console.css'
import { ArrowRight, ArrowUpRight, Bot, ChevronDown, MessageSquare, Pause, Play, Zap } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { ArenaMarket, ArenaMarketOutcome, AutomationTriggerKind, SolzDataSource, SolzMatch, SolzSnapshot } from '../solz/model'
import { predictionContract, type PredictionAnswer } from '../solz/predictionContracts'
import { AnimatedCollapse } from './AnimatedCollapse'
import { PromptComposer } from './PromptComposer'
import { TradeTicket } from './TradeTicket'
import type { DynamicEvmWalletPort } from '../arena/DynamicSolanaSession'

export type ConsoleSection = 'trade' | 'automate' | 'prompt' | 'chat'
type Props = {
  source: SolzDataSource; snapshot: SolzSnapshot; match: SolzMatch; market: ArenaMarket; outcome: ArenaMarketOutcome
  onOutcome: (outcome: ArenaMarketOutcome) => void; section: ConsoleSection | null
  onSection: (section: ConsoleSection | null) => void; promptAgentId?: string; intermission: boolean
  hideChat?: boolean; hidePrompt?: boolean; simulation?: boolean; answer?: PredictionAnswer; onAnswer?: (answer: PredictionAnswer) => void
  marketAvailable?: boolean
  tradingPanel?: ReactNode
  collateralSymbol?: string
  dreamDexApiUrl?: string
  onDreamDexOpened?: () => void
  evmWallet?: DynamicEvmWalletPort | null
}
function ConsolePanel({ name, title, icon, meta, active, onToggle, children }: { name: ConsoleSection; title: string; icon: ReactNode; meta: string; active: boolean; onToggle: () => void; children: ReactNode }) {
  return <section className={`sh-console-panel ch-console-accordion ch-console-${name} ${active ? 'is-open' : ''}`}>
    <h3><button id={`console-${name}-button`} aria-expanded={active} aria-controls={`console-${name}-body`} onClick={onToggle}>{icon}<span>{title}</span><small>{meta}</small><ChevronDown size={15}/></button></h3>
    <AnimatedCollapse id={`console-${name}-body`} labelledBy={`console-${name}-button`} open={active} className="ch-console-reveal"><div className="sh-console-body">{children}</div></AnimatedCollapse>
  </section>
}

export function InteractionConsole({ source, snapshot, match, market, outcome, onOutcome, section, onSection, promptAgentId, intermission, hideChat = false, hidePrompt = false, simulation = true, answer: externalAnswer, onAnswer, marketAvailable = true, tradingPanel, collateralSymbol = 'COOLA', dreamDexApiUrl, onDreamDexOpened, evmWallet }: Props) {
  const [localAnswer, setLocalAnswer] = useState<PredictionAnswer>('yes')
  const answer = externalAnswer ?? localAnswer
  const selectAnswer = (next: PredictionAnswer) => { setLocalAnswer(next); onAnswer?.(next) }
  const contract = predictionContract(outcome, market.outcomes.length > 2 ? answer : 'yes')
  useEffect(() => { if (!onAnswer) setLocalAnswer('yes') }, [market.id, outcome.id, onAnswer])
  const [message, setMessage] = useState('')
  const [trigger, setTrigger] = useState<AutomationTriggerKind>('below')
  const [threshold, setThreshold] = useState('40')
  const [budget, setBudget] = useState('250')
  const [pending, setPending] = useState('')
  const [feedback, setFeedback] = useState<{ text: string; error: boolean } | null>(null)
  const chatList = useRef<HTMLDivElement>(null)
  const messages = snapshot.chat.filter((item) => item.matchId === match.id).slice(-14)
  const rules = snapshot.automation.filter((item) => item.marketId === market.id)
  const closed = !simulation || market.status !== 'open' || snapshot.updatedAt >= market.closesAt
  useEffect(() => { if (section === 'chat' && chatList.current) chatList.current.scrollTop = chatList.current.scrollHeight }, [section, match.id, messages.length])

  async function perform(key: string, action: () => Promise<string>) {
    if (pending || !simulation) return
    setPending(key); setFeedback(null)
    try { setFeedback({ text: await action(), error: false }) }
    catch (reason) { setFeedback({ text: reason instanceof Error ? reason.message : 'Please try again.', error: true }) }
    finally { setPending('') }
  }
  const panel = (name: ConsoleSection) => ({ name, active: section === name, onToggle: () => { onSection(section === name ? null : name); setFeedback(null) } })


  return <aside className="ch-console" aria-label="Match interaction console">
    <ConsolePanel {...panel('trade')} title="Trade" icon={<ArrowUpRight size={16}/>} meta={tradingPanel ? 'ON-CHAIN' : simulation ? 'SIMULATION' : 'ON-CHAIN'}>{tradingPanel ?? (marketAvailable ? <TradeTicket evmWallet={evmWallet} collateralSymbol={collateralSymbol} dreamDexApiUrl={dreamDexApiUrl} onDreamDexOpened={onDreamDexOpened} source={source} snapshot={snapshot} market={market} outcome={outcome} onOutcome={onOutcome} answer={answer} onAnswer={selectAnswer} simulation={simulation}/> : <div className="ch-console-empty" role="status"><strong>Prediction feed unavailable.</strong><span>The trade ticket will populate when match questions return. Other arena controls remain independent.</span></div>)}</ConsolePanel>
    <ConsolePanel {...panel('automate')} title="Auto trader" icon={<Bot size={16}/>} meta={`${rules.filter((rule) => rule.status === 'armed').length} ARMED`}>
      {!marketAvailable ? <div className="ch-console-empty" role="status"><strong>No market to automate yet.</strong><span>Automation remains idle until a real prediction question is available.</span></div> : <><p className="sh-console-intro">An agent watches your selected prediction.</p>
      <form className="sh-form-stack" onSubmit={(event) => { event.preventDefault(); void perform('automate', async () => {
        const instruction = `Buy ${contract.label} ${trigger === 'below' ? `below ${threshold}%` : trigger === 'above' ? `above ${threshold}%` : 'on a 2.5-point probability move'}. Spend at most ${budget} COOLA.`
        await source.createAutomation({ matchId: market.matchId ?? match.id, marketId: market.id, outcomeId: contract.id, instruction, trigger: { kind: trigger, threshold: Number(threshold) / 100 }, action: 'buy', budget: Number(budget), token: 'COOLA' })
        return 'Trading agent armed in simulation. Pause it below.'
      }) }}>
        <label>BUY OUTCOME<select value={outcome.id} onChange={(event) => { const next = market.outcomes.find((item) => item.id === event.target.value); if (next) onOutcome(next) }}>{market.outcomes.map((item) => <option key={item.id} value={item.id}>{item.id === outcome.id && market.outcomes.length > 2 && answer === 'no' ? `NO · ${item.label}` : item.label}</option>)}</select></label>
        <label>WHEN<select value={trigger} onChange={(event) => setTrigger(event.target.value as AutomationTriggerKind)}><option value="below">Probability falls below</option><option value="above">Probability rises above</option><option value="momentum">Probability moves 2.5 points</option></select></label>
        <div className="sh-form-columns">{trigger !== 'momentum' && <label>THRESHOLD (%)<input type="number" value={threshold} onChange={(event) => setThreshold(event.target.value)} min="1" max="99" required/></label>}<label>BUDGET (COOLA)<input type="number" min="26" max={snapshot.account.balances.COOLA} value={budget} onChange={(event) => setBudget(event.target.value)} required/></label></div>
        <button className="sh-button sh-button--black" disabled={!!pending || closed}>Arm agent <Zap size={15}/></button>
        <p className="sh-form-note">One simulated buy per trigger. Budget includes fees.</p>
      </form>
      <div className="sh-rule-list">{rules.map((rule) => <div key={rule.id}><span><b>{rule.outcomeLabel} · {rule.status}</b><small>{rule.instruction}</small></span><button aria-label={`${rule.status === 'armed' ? 'Pause' : 'Arm'} ${rule.outcomeLabel} rule`} onClick={() => source.setAutomationStatus(rule.id, rule.status === 'armed' ? 'paused' : 'armed')} disabled={closed}>{rule.status === 'armed' ? <Pause size={14}/> : <Play size={14}/>}</button></div>)}</div></>}
    </ConsolePanel>
    {!hideChat && <ConsolePanel {...panel('chat')} title="Live chat" icon={<MessageSquare size={16}/>} meta="SPECTATOR CHANNEL">
      <div className="sh-chat" ref={chatList} role="log" aria-label="Match chat">{messages.length ? messages.map((item) => <article key={item.id} className={`ch-chat-message ${item.self ? 'is-self' : ''}`}><span className="ch-chat-initial" aria-hidden="true">{item.author[0].toUpperCase()}</span><div><header><b>{item.self ? 'You' : item.author}</b><time dateTime={new Date(item.at).toISOString()}>{new Date(item.at).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', hour12: false })}</time></header><p>{item.text}</p></div></article>) : <p>Be the first to make your call.</p>}</div>
      <form className="sh-chat-form" onSubmit={(event) => { event.preventDefault(); if (!simulation || !message.trim()) return; source.sendChat(match.id, message); setMessage('') }}><label className="sr-only" htmlFor="chat-message">Message the spectator channel</label><input id="chat-message" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Make your call…" maxLength={240} required/><button aria-label="Send simulated chat message" disabled={!simulation || !message.trim()}><ArrowRight size={18}/></button></form>
      <p className="sh-form-note">Local simulation · visible on this device</p>
    </ConsolePanel>}
    {!hidePrompt && <PromptComposer source={source} snapshot={snapshot} match={match} open={section === 'prompt'} onToggle={panel('prompt').onToggle} promptAgentId={promptAgentId} intermission={intermission} simulation={simulation}/>}
    {feedback && <p role={feedback.error ? 'alert' : 'status'} className={`sh-feedback ${feedback.error ? 'is-error' : ''}`}>{feedback.text}</p>}
  </aside>
}
