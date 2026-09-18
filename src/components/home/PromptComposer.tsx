import { ArrowRight, Check, ChevronDown, Info, Zap } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { SolzDataSource, SolzMatch, SolzSnapshot } from '../solz/model'
import { promptRecipients } from '../solz/promptRouting'
import { SAMPLE_DIRECTIVES } from './sampleDirectives'
import { PROMPT_COST, SAMPLE_FUEL_LABEL, fuelAmountLabel } from '../solz/fuelToken'
import {
  directiveCostStatus,
  directiveToken,
  directiveTokenLabel,
  directivePrice,
  directiveUnavailableReason,
  tokenAmountLabel,
  usdLabel,
} from '../solz/directiveRelay'
import { useTokenMeta } from '../solz/tokenMeta'
import { useSolanaWallet } from '../session/store'
import { useDirectiveRelay } from './useDirectiveRelay'
import type { DirectiveStage } from './sendDirective'
import { canSubmitDirective } from './directiveSubmit'
import { AnimatedCollapse } from './AnimatedCollapse'
import { amountLabel } from './HomePrimitives'

type Props = {
  source: SolzDataSource; snapshot: SolzSnapshot; match: SolzMatch; open: boolean; onToggle: () => void
  promptAgentId?: string; intermission: boolean; simulation: boolean
  warning?: string
}

/** What the viewer is waiting for. A directive is a payment, not a message: a
 *  single spinner cannot tell a wallet that has not been approved yet from a
 *  transfer that has not finalized. */
const stageLabel: Record<DirectiveStage, string> = {
  quote: 'PRICING',
  signature: 'APPROVE IN WALLET',
  payment: 'PAYING',
  confirmation: 'CONFIRMING',
}

/**
 * Types the placeholder out one character at a time. The composer sits in the
 * stage corner with nothing else moving in it, so a static hint read as a
 * disabled field; the text arriving shows the field is live. It restarts
 * whenever the text changes, holds the finished line, and hands back the whole
 * string at once when the reader asked for less motion or when the field
 * already has something in it.
 */
function useTypedPlaceholder(text: string, active: boolean): string {
  const [typed, setTyped] = useState(text)
  useEffect(() => {
    const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!active || still) { setTyped(text); return }
    setTyped('')
    let index = 0
    const timer = setInterval(() => {
      index += 1
      setTyped(text.slice(0, index))
      if (index >= text.length) clearInterval(timer)
    }, 28)
    return () => clearInterval(timer)
  }, [text, active])
  return typed
}

export function PromptComposer({ source, snapshot, match, open, onToggle, promptAgentId, intermission, simulation, warning }: Props) {
  const [prompt, setPrompt] = useState('')
  const [agentId, setAgentId] = useState(promptAgentId ?? '')
  const [stage, setStage] = useState<DirectiveStage | null>(null)
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<{ text: string; error: boolean } | null>(null)
  const [fueling, setFueling] = useState(false)
  const [priceOpen, setPriceOpen] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const fuelTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const mounted = useRef(true)

  // THE RELAY DECIDES THE PRICE AND THE TOKEN, not this component. The operator
  // prices a directive in the game admin editor either in dollars, where the
  // token amount is quoted per directive against the mint's live market and is
  // therefore not knowable until the viewer commits, or as a fixed token amount,
  // where there is no dollar figure at all. Nothing below fills either one in.
  const wallet = useSolanaWallet()
  const { settings, loading: relayLoading } = useDirectiveRelay()
  const relayToken = settings ? directiveToken(settings) : undefined
  const registry = useTokenMeta(relayToken?.mint ? [relayToken.mint] : [])
  const tokenLabel = directiveTokenLabel(relayToken, registry)
  const relayPrice = directivePrice(settings, relayToken)
  const fixedPrice = settings?.prompt.mode === 'fixed'
  // One published price, in the operator's own unit: dollars, or whole tokens.
  const priceAmount = relayPrice
    ? relayPrice.usd !== undefined ? usdLabel(relayPrice.usd) : tokenAmountLabel(relayPrice.atoms.toString(), relayToken?.decimals ?? 6)
    : null
  // What a viewer reads in the header, where there is no room for a second line.
  const priceHeadline = priceAmount ? fixedPrice ? `${priceAmount} ${tokenLabel}` : priceAmount : null
  const relayClosed = relayLoading ? 'Reading the directive relay...' : directiveUnavailableReason(settings)
  const live = !relayClosed && Boolean(relayToken)

  /**
   * THE MATCH A DIRECTIVE REACHES.
   *
   * The relay prices a directive for whatever match is live at that moment - it
   * owns the arena schedule and does not take a match id from this client. So
   * the composer must name agents from that same match, not from the card on
   * the hero, which can be a MIAW PRIX programme entry with no roster at all.
   * Retargeting is never silent: the hint says which match is being addressed.
   * In the sample console nothing is retargeted.
   */
  const target = (live && snapshot.matches.find((item) => item.phase === 'live' && item.roster.length > 0)) || match
  const retargeted = target.id !== match.id

  const recipients = promptRecipients(target, prompt, agentId || undefined)
  const allActive = target.roster.filter((entry) => entry.status === 'active')
  const targetLabel = recipients.length === allActive.length && recipients.every((entry) => entry.status === 'active')
    ? 'All active agents' : recipients.map((entry) => entry.codename).join(', ')
  const sampleQuote = source.quotePrompt({ matchId: target.id, agentId: agentId || undefined, text: prompt, token: 'COOLA' })

  // The wallet is the payer and the on-chain transfer is the proof. The relay
  // does not require a website session or an account bearer token. The paid
  // path also does not trust this page's match/roster projection as a gate: the
  // API owns the live match and rate limits the wallet/IP itself.
  // An intermission belongs to the card on screen. A live match found elsewhere
  // in the snapshot is not in one, or it would not be live.
  //
  // `phase` is the arena's own word, and it is the only clock trusted here.
  // `endsAt` is derived locally from a duration the current-match row does not
  // publish, so it read a 20-minute match as finished after five and closed the
  // composer on a match the server was still running. The relay refuses an
  // expired match itself, which is the check that cannot drift.
  const matchOpen = (!intermission || retargeted) && target.phase === 'live'
  const missing = live
    ? !wallet ? 'Connect your Solana wallet to send a directive.'
      : undefined
    : simulation
      ? snapshot.capabilities.prompts.ready ? undefined : 'Agents accept prompts during a live match.'
      : relayClosed
  const unavailable = live ? Boolean(missing) : !matchOpen || Boolean(missing)
  const inactive = live ? undefined : recipients.find((entry) => entry.status !== 'active')
  const affordable = live || snapshot.account.balances.COOLA >= sampleQuote.cost
  const canSend = canSubmitDirective({
    relayOpen: live,
    walletReady: Boolean(wallet && settings && relayToken),
    sampleReady: !unavailable && !inactive && recipients.length > 0 && affordable,
    pending,
    fueling,
    prompt,
  })

  useEffect(() => {
    const agent = target.roster.find((entry) => entry.agentId === promptAgentId)
    setAgentId(agent?.agentId ?? '')
    if (agent) input.current?.focus()
  }, [promptAgentId, target.id])
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; clearTimeout(fuelTimer.current) }
  }, [])
  // The note sits over the field it explains, so Escape has to reach it from
  // the textarea as well as from the button that opened it.
  useEffect(() => {
    if (!priceOpen) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setPriceOpen(false) }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [priceOpen])

  function settle(text: string, error: boolean) {
    if (!mounted.current) return
    setFeedback({ text, error })
    if (error) return
    setPrompt(''); setFueling(true)
    clearTimeout(fuelTimer.current)
    fuelTimer.current = setTimeout(() => { if (mounted.current) setFueling(false) }, 1600)
  }

  async function sendPrompt() {
    if (!canSend) return
    setPending(true); setFeedback(null); setPriceOpen(false)
    try {
      if (live && wallet && settings) {
        // Paying for a directive pulls in web3 and the Solana confirmation
        // adapter. A viewer who never sends one should not download either, so
        // the payment path is fetched at the moment it is used.
        const { sendDirective } = await import('./sendDirective')
        const purchase = await sendDirective({
          wallet,
          settings,
          text: prompt,
          botId: agentId || undefined,
          onStage: (value) => { if (mounted.current) setStage(value) },
        })
        settle(`Queued for ${targetLabel}. ${tokenAmountLabel(purchase.amountAtoms, purchase.decimals)} ${tokenLabel} paid.`, false)
      } else if (simulation) {
        await source.submitPrompt({ matchId: target.id, agentId: agentId || undefined, text: prompt, token: 'COOLA' })
        settle(`Queued for ${targetLabel}. ${fuelAmountLabel(sampleQuote.cost)} ${SAMPLE_FUEL_LABEL} used.`, false)
      } else {
        // Outside the sample console there is no second path to fall into. A
        // send that reaches here means the relay was not open when the button
        // was pressed, and quietly posting a sample prompt instead - or failing
        // with "try again" - says neither of the two things that are true.
        throw new Error(relayClosed ?? (wallet ? 'The directive relay is unavailable.' : 'Connect your Solana wallet to send a directive.'))
      }
    } catch (reason) {
      if (mounted.current) setFeedback({ text: reason instanceof Error ? reason.message : 'Couldn’t send your prompt. Try again.', error: true })
    } finally { if (mounted.current) { setPending(false); setStage(null) } }
  }

  // A viewer pays for a directive, so which match it reaches is never implied.
  const targetNote = retargeted ? `Reaching the live match ${target.mode} · ` : ''
  // Whether this line is a reason or a keyboard tip. A disabled Send with no
  // sentence beside it is the one state this composer must never reach, and the
  // stage corner hides its resting hint, so the reason is marked as one.
  const tooShort = prompt.trim().length < 8
  const blocked = Boolean(inactive) || unavailable || !affordable || tooShort
  // `warning` speaks for a relay that does not exist yet. Once the relay is open
  // and publishing a price it is simply false, and falling back to it turned a
  // finished match into "mainnet-only" - a sentence about the wrong thing, and
  // wrong about it.
  const hint = inactive ? `${inactive.codename} is out of this round.`
    : unavailable ? missing ?? (live ? 'Agents accept directives during a live match. The next one opens shortly.' : warning) ?? 'Agents accept prompts during a live match.'
    : tooShort ? `Add a little more detail · at least 8 characters (${prompt.trim().length}/8).`
    : `${targetNote}Enter to send · Shift + Enter for a new line`
  const examples = SAMPLE_DIRECTIVES.slice(0, 2)
  const placeholder = 'Name an agent, then the move. e.g. Coke, hold the west relay.'
  const typedPlaceholder = useTypedPlaceholder(placeholder, prompt.length === 0)

  /** THE COST SLOT IS NEVER EMPTY. A real relay publishes a real price; a relay
   *  that is off, unreachable or unpriced publishes a word saying which. What is
   *  never rendered is a placeholder number beside a live-looking ticker, which
   *  is a quote the viewer was never given. */
  const costStatus = directiveCostStatus(settings, relayLoading)
  const priceTag = live && priceAmount
    ? <><strong>{priceAmount}</strong> <b>{tokenLabel}</b><button type="button" className="ch-price-info" aria-expanded={priceOpen} aria-controls="prompt-price-note" aria-label={`How the ${tokenLabel} amount is set`} onClick={() => setPriceOpen(!priceOpen)}><Info size={13} aria-hidden="true"/></button></>
    : simulation && !live
      ? <><strong>{fuelAmountLabel(sampleQuote.cost)}</strong> <b>{SAMPLE_FUEL_LABEL}</b></>
      : <em className="ch-cost-status">{costStatus}</em>

  return <section className={`ch-console-accordion ch-prompt-accordion ${open ? 'is-open' : ''} ${fueling ? 'is-fueling' : ''}`}>
    <header className="ch-mini-prompt">
      <h3><button id="console-prompt-button" className="ch-mini-heading" aria-expanded={open} aria-controls="console-prompt-body" onClick={onToggle}><span><Zap size={15}/> PROMPT AGENT</span><span>{live && priceHeadline ? priceHeadline : simulation && !live ? `${fuelAmountLabel(sampleQuote.cost)} ${SAMPLE_FUEL_LABEL}` : costStatus}<ChevronDown size={15}/></span></button></h3>
      <form aria-label="Quick agent prompt" onSubmit={(event) => { event.preventDefault(); void sendPrompt() }}>
        <label className="ch-prompt-label" htmlFor="mini-prompt">Your directive <span>{prompt.length}/220</span></label>
        <div className="ch-prompt-composer">
        {priceOpen && <div id="prompt-price-note" role="note" className="ch-price-note"><strong>{priceHeadline ?? ''} per directive.</strong> {fixedPrice ? `The fee is a fixed ${tokenLabel} amount, so it does not move with the token's market price. Your wallet shows it before you approve it.` : `The fee is set in dollars, so the ${tokenLabel} amount is quoted against the token's market price at the moment you send and is shown in your wallet before you approve it.`} All purchases are final and unused directives expire when the match ends.</div>}
        <textarea id="mini-prompt" ref={input} value={prompt} onChange={(event) => { setPrompt(event.target.value); setFeedback(null) }} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void sendPrompt() } }} placeholder={typedPlaceholder} minLength={8} maxLength={220} required rows={2} aria-describedby="prompt-hint"/>
        <div className="ch-mini-controls"><label className="ch-prompt-target"><span className="sr-only">Prompt recipient</span><select value={agentId} onChange={(event) => { setAgentId(event.target.value); setFeedback(null) }}><option value="">Auto</option>{target.roster.map((entry) => <option key={entry.agentId} value={entry.agentId} disabled={entry.status !== 'active'}>{entry.codename}{entry.status !== 'active' ? ' · out of round' : ''}</option>)}</select></label><p className="ch-prompt-price">{fueling ? 'FUELED' : pending ? stage ? stageLabel[stage] : 'SENDING' : priceTag}</p><button type="submit" aria-label={live && priceAmount ? fixedPrice ? `Send directive for ${priceAmount} ${tokenLabel}` : `Send directive for ${priceAmount} in ${tokenLabel}` : 'Send directive'} disabled={!canSend}>{fueling ? <Check size={16}/> : <ArrowRight size={16}/>}<i className="ch-button-soda" aria-hidden="true"/></button></div>
        </div>
        <p id="prompt-hint" className={`ch-prompt-hint ${feedback?.error ? 'is-error' : feedback ? 'is-success' : blocked ? 'is-blocked' : ''}`} role={feedback?.error ? 'alert' : 'status'}>{feedback?.text ?? hint}</p>
      </form>
      <div className="ch-soda-flow" aria-hidden="true"><i/><i/><i/></div>
    </header>
    <AnimatedCollapse id="console-prompt-body" labelledBy="console-prompt-button" open={open} className="ch-console-reveal">
      <div className="sh-console-body ch-prompt-details">
        <div className="ch-agent-energy"><div className="ch-soda-can" aria-hidden="true"><i className="ch-soda-liquid"/><Zap size={18}/><i className="ch-soda-bubble"/><i className="ch-soda-bubble"/><i className="ch-soda-bubble"/></div><div><h4>{fueling ? 'Energy delivered.' : 'Fuel the next move.'}</h4><p>{agentId ? `Directing ${targetLabel}.` : 'Auto routes to the agents you name. A general prompt reaches every active agent.'}</p></div></div>
        <p>Directives are public. Agents decide whether to accept or ignore them.</p>
        <dl>
          <div><dt>Fee per directive</dt><dd>{live && priceAmount ? fixedPrice ? <>{priceAmount} <small>{tokenLabel}</small></> : <>{priceAmount} <small>(charged in {tokenLabel})</small></> : simulation ? <>{fuelAmountLabel(sampleQuote.cost)} <small>{SAMPLE_FUEL_LABEL}</small></> : <>Not published</>}</dd></div>
          {!live && simulation && <div><dt>Sample balance</dt><dd>{amountLabel(snapshot.account.balances.COOLA)} {SAMPLE_FUEL_LABEL}</dd></div>}
          {live && relayToken && <div><dt>Fuel token</dt><dd>{tokenLabel} <small>{relayToken.mint.slice(0, 4)}…{relayToken.mint.slice(-4)}</small></dd></div>}
        </dl>
        <h4>Try a directive</h4><div className="ch-prompt-examples">{examples.map((text) => <button key={text} onClick={() => { setPrompt(text); setFeedback(null); input.current?.focus() }}>{text}<span className="ch-example-use">USE</span></button>)}</div>
        <p className="sh-form-note">{live ? 'Paid on Solana · one charge per directive · no refunds.' : `Off-chain sample credits · ${fuelAmountLabel(PROMPT_COST.COOLA)} per directive.`}</p>
      </div>
    </AnimatedCollapse>
  </section>
}
