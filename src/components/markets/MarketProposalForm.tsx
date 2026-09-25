import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { ArrowUpRight, Check, X } from 'lucide-react'
import { PublicKey } from '@solana/web3.js'
import { PANTA_CATEGORIES } from '../../../packages/prediction-core/panta'
import { marketProposalMessage, parseMarketProposal, type MarketProposalReceipt, type MarketProposalSubmission } from '../../../packages/prediction-core/market-proposals'
import { getSession, useSolanaWallet } from '../session/store'
import { createGeneralQuestionsApi } from './generalQuestionsApi'

type Fields = { question: string; category: string; closesAt: string; resolutionRule: string; sources: string }
const empty: Fields = { question: '', category: 'other', closesAt: '', resolutionRule: '', sources: '' }
const DRAFT_KEY = 'colacat:market-proposal:draft:v1'
const receiptKey = (wallet: string) => `colacat:market-proposals:v1:${wallet}`
const readDraft = (): Fields => {
  try {
    const value = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? '{}') as Record<string, unknown>
    return Object.fromEntries(Object.entries(empty).map(([key, fallback]) => [key, typeof value[key] === 'string' ? value[key] : fallback])) as Fields
  } catch { return empty }
}

/** `standalone` renders the form as its own page: the title is the page's h1
 *  and the page's back link, not a close button, leaves it. */
export function MarketProposalForm({ apiUrl, onClose, standalone = false }: { apiUrl: string; onClose?: () => void; standalone?: boolean }) {
  const wallet = useSolanaWallet()
  const api = useMemo(() => createGeneralQuestionsApi(apiUrl), [apiUrl])
  const [fields, setFields] = useState(readDraft)
  const [stage, setStage] = useState<'idle' | 'signing' | 'submitting'>('idle')
  const [error, setError] = useState('')
  const [receipt, setReceipt] = useState<MarketProposalReceipt | null>(null)
  const [references, setReferences] = useState<string[]>([])
  const [checking, setChecking] = useState(false)
  const pending = useRef<MarketProposalSubmission | null>(null)
  const lifetime = useRef<AbortController | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const receiptHeading = useRef<HTMLDivElement>(null)
  const busy = stage !== 'idle' || checking
  useEffect(() => { heading.current?.focus() }, [])
  useEffect(() => { if (receipt) receiptHeading.current?.focus() }, [receipt])
  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    pending.current = null; setStage('idle'); setChecking(false); setReceipt(null); setError('')
    try {
      const saved = JSON.parse(localStorage.getItem(receiptKey(wallet?.address ?? '')) ?? '[]')
      setReferences(Array.isArray(saved) ? saved.filter(value => typeof value === 'string').slice(0, 10) : [])
    } catch { setReferences([]) }
    return () => controller.abort()
  }, [wallet, api])
  useEffect(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(fields)) } catch { /* storage is optional */ } }, [fields])
  const change = (key: keyof Fields, value: string) => {
    setFields(current => ({ ...current, [key]: value })); setError(''); setReceipt(null); pending.current = null
  }
  const saveReference = (id: string, address: string, replacedId?: string) => {
    setReferences(current => {
      const next = [id, ...current.filter(value => value !== id && value !== replacedId)].slice(0, 10)
      try { localStorage.setItem(receiptKey(address), JSON.stringify(next)) } catch { /* receipt stays visible */ }
      return next
    })
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    const signal = lifetime.current?.signal
    if (!wallet || busy || !signal || signal.aborted) return
    setError(''); setReceipt(null)
    try {
      const close = new Date(fields.closesAt)
      if (!Number.isFinite(close.getTime())) throw Error('Choose a closing date and time.')
      const draft = parseMarketProposal({ question: fields.question, category: fields.category, closesAt: close.toISOString(), resolutionRule: fields.resolutionRule, sourcesOfTruth: fields.sources.split('\n').map(value => value.trim()).filter(Boolean) })
      setStage('signing')
      const config = await api.proposalConfig(signal)
      if (!config.available) throw Error('Market proposals are temporarily unavailable. Your draft is saved on this device.')
      const checkWallet = () => {
        if (signal.aborted || getSession().solanaWallet !== wallet) throw Error('Your wallet changed. Please submit again.')
      }
      checkWallet()
      let submission = pending.current
      if (!submission || submission.submittedAt < Date.now() - 540_000) {
        const unsigned = { id: crypto.randomUUID(), wallet: wallet.address, submittedAt: Date.now(), draft }
        const signer = await wallet.getSigner()
        checkWallet()
        if (!signer.isConnected || !signer.publicKey || new PublicKey(signer.publicKey.toBytes()).toBase58() !== wallet.address) throw Error('Reconnect your Solana wallet before submitting.')
        const signed = await signer.signMessage(new TextEncoder().encode(marketProposalMessage(config.audience, unsigned)))
        checkWallet()
        submission = { ...unsigned, signature: btoa(String.fromCharCode(...signed.signature)) }
        pending.current = submission
      }
      checkWallet()
      setStage('submitting')
      saveReference(submission.id, wallet.address)
      const result = await api.propose(submission, signal)
      if (signal.aborted) return
      saveReference(result.id, wallet.address, submission.id)
      setReceipt(result); pending.current = null
      setFields(empty)
      try { localStorage.removeItem(DRAFT_KEY) } catch { /* optional */ }
    } catch (reason) {
      if (!signal.aborted) setError(reason instanceof Error ? reason.message : 'The proposal could not be submitted. Your draft is saved.')
    } finally { if (!signal.aborted) setStage('idle') }
  }
  async function checkReceipt(id: string) {
    const signal = lifetime.current?.signal
    if (busy || !signal || signal.aborted) return
    setChecking(true); setError('')
    try { const result = await api.receipt(id, signal); if (!signal.aborted) setReceipt(result) }
    catch (reason) { if (!signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not check proposal status.') }
    finally { if (!signal.aborted) setChecking(false) }
  }
  return <section className={standalone ? 'gq-proposal gq-proposal--page' : 'gq-proposal'} aria-labelledby="proposal-title">
    <header className="gq-section-heading"><div>{standalone ? <h1 ref={heading} tabIndex={-1} id="proposal-title" className="sz-page-title">Propose a market</h1> : <h2 ref={heading} tabIndex={-1} id="proposal-title">Propose a market</h2>}<p>Suggest a clear Yes / No question. We’ll review the rules and sources before publishing it.</p></div>{onClose && <button type="button" className="gq-icon-button" onClick={onClose} aria-label="Close proposal form" disabled={busy}><X size={20}/></button>}</header>
    {receipt && <div ref={receiptHeading} tabIndex={-1} className="gq-receipt" role="status"><Check size={20}/><div><strong>{receipt.status === 'pending' ? 'Proposal received · In review' : receipt.status === 'approved' ? 'Your market is published' : 'Proposal reviewed · Not accepted'}</strong><p>{receipt.question}</p>{receipt.reviewNote && <p>{receipt.reviewNote}</p>}<small>Reference: {receipt.id}</small>{receipt.marketUrl && <a href={receipt.marketUrl} target="_blank" rel="noopener noreferrer">Open market on PANTA<ArrowUpRight size={14}/></a>}</div></div>}
    <form onSubmit={event => void submit(event)}>
      <fieldset disabled={busy} className="gq-form-fields">
        <label className="gq-full">Your question<input required minLength={12} maxLength={512} value={fields.question} onChange={event => change('question', event.target.value)} placeholder="Will a crewed mission land on the Moon before 2030?"/><small>Ask one question with a verifiable Yes or No answer.</small></label>
        <label>Category<select value={fields.category} onChange={event => change('category', event.target.value)}>{PANTA_CATEGORIES.map(value => <option key={value} value={value}>{value[0]!.toUpperCase() + value.slice(1)}</option>)}</select></label>
        <label>Trading closes<input type="datetime-local" required value={fields.closesAt} onChange={event => change('closesAt', event.target.value)}/><small>Your local time ({Intl.DateTimeFormat().resolvedOptions().timeZone}). At least one hour from now.</small></label>
        <label className="gq-full">Resolution rules<textarea required minLength={30} maxLength={2048} rows={3} value={fields.resolutionRule} onChange={event => change('resolutionRule', event.target.value)} placeholder="Resolves Yes if… Resolves No if… Explain the deadline and how ambiguous results will be handled."/><small>Explain exactly what must happen, by when, and which evidence decides the result.</small></label>
        <label className="gq-full">Sources of truth<textarea required rows={2} maxLength={10_244} value={fields.sources} onChange={event => change('sources', event.target.value)} placeholder="https://www.nasa.gov/"/><small>One public HTTPS URL per line, up to five. Prefer the official source.</small></label>
      </fieldset>
      {error && <p className="gq-error" role="alert">{error}</p>}
      <div className="gq-submit-row"><div><strong>{wallet ? `Submitting as ${wallet.address.slice(0, 5)}…${wallet.address.slice(-5)}` : 'Connect a Solana wallet to submit'}</strong><p>{wallet ? 'A message signature verifies your proposal. No fee or transaction.' : 'Use Log in / Connect from the site menu. Your draft is saved on this device.'}</p></div><button className="gq-primary" type="submit" disabled={!wallet || busy}>{stage === 'signing' ? 'Check your wallet…' : stage === 'submitting' ? 'Submitting…' : 'Sign & submit proposal'}</button></div>
      <span className="gq-sr-only" role="status">{stage === 'signing' ? 'Waiting for wallet signature' : stage === 'submitting' ? 'Saving proposal' : ''}</span>
    </form>
    {references.length > 0 && <div className="gq-references"><strong>Your recent proposals</strong><p>Check a reference for its review status. An interrupted submission may not have reached us.</p><div>{references.map(id => <button className="gq-secondary" key={id} type="button" disabled={busy} onClick={() => void checkReceipt(id)} aria-label={`Check proposal ${id}`}>{id.slice(0, 8)}<ArrowUpRight size={14}/></button>)}</div>{checking && <span role="status">Checking proposal…</span>}</div>}
  </section>
}
