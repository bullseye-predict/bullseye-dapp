import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { ArrowUpRight, Check, X } from 'lucide-react'
import { PublicKey, VersionedTransaction } from '@solana/web3.js'
import { PANTA_CATEGORIES, parsePantaCreateDraft, usdcFromBaseUnits, type PantaQuote } from '../../../packages/prediction-core/panta'
import { PRESTOCKS_ASSETS } from '../../../packages/prediction-core/prestocks'
import { getSession, useSolanaWallet } from '../session/store'
import { createPantaApi, PantaApiError } from './pantaApi'
import { brand } from '../solz/brand'

/**
 * Create a market on PANTA from ColaCat. The connected wallet pays PANTA's
 * fee in USDC on Solana MAINNET, signs exactly one transaction, and becomes
 * the market's creator (so PANTA's creator royalty is the wallet's). ColaCat
 * relays PANTA's unsigned transaction, sends the signed one, and lists the
 * market at /events-panta/<id>.
 */

type Fields = {
  question: string; category: string; marketType: 'standard' | 'breaking'
  startsAt: string; endsAt: string; resolvesAt: string
  resolutionRule: string; sources: string; imageUrl: string; description: string
}
const empty: Fields = { question: '', category: 'finance', marketType: 'standard', startsAt: '', endsAt: '', resolvesAt: '', resolutionRule: '', sources: '', imageUrl: '', description: '' }
const seconds = (local: string) => { const at = new Date(local).getTime(); return Number.isFinite(at) ? Math.floor(at / 1000) : NaN }
const localInput = (at: Date) => new Date(at.getTime() - at.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
const usd = (baseUnits: string) => `${usdcFromBaseUnits(baseUnits).toLocaleString('en-US', { maximumFractionDigits: 2 })} USDC`

/** A PreStocks price question in PANTA's shape, as a starting point only. */
export function prestocksTemplate(symbol: string, now = new Date()): Fields {
  const asset = PRESTOCKS_ASSETS.find(item => item.symbol === symbol) ?? PRESTOCKS_ASSETS[0]!
  const end = new Date(now.getTime() + 7 * 86_400_000); end.setUTCHours(20, 0, 0, 0)
  const start = new Date(now.getTime() + 2 * 3_600_000); start.setUTCMinutes(0, 0, 0)
  const day = end.toISOString().slice(0, 10)
  return {
    ...empty, category: 'finance', marketType: 'standard',
    question: `Will ${asset.symbol} PreStocks trade higher at 20:00 UTC on ${day} than at the market's start?`,
    resolutionRule: `Resolves Yes if the ${asset.symbol} PreStocks price on GeckoTerminal (pool ${asset.pool}, hourly close, USD) for the hour ending 20:00 UTC on ${day} is above its close for the hour ending at the market's start time. Otherwise No.`,
    sources: [`https://www.geckoterminal.com/solana/pools/${asset.pool}`, asset.productUrl].join('\n'),
    imageUrl: asset.imageUrl,
    startsAt: localInput(start), endsAt: localInput(end), resolvesAt: localInput(new Date(end.getTime() + 3_600_000)),
  }
}

/** `standalone` renders the form as its own page: the title is the page's h1
 *  and the page's back link, not a close button, leaves it. */
export function PantaCreateForm({ apiUrl, onClose, standalone = false }: { apiUrl: string; onClose?: () => void; standalone?: boolean }) {
  const wallet = useSolanaWallet()
  const api = useMemo(() => createPantaApi(apiUrl), [apiUrl])
  const [available, setAvailable] = useState<boolean | null>(null)
  const [fields, setFields] = useState<Fields>(empty)
  const [quote, setQuote] = useState<PantaQuote | null>(null)
  const [stage, setStage] = useState<'idle' | 'quoting' | 'signing' | 'sending'>('idle')
  const [error, setError] = useState('')
  const [created, setCreated] = useState<{ marketId: string; signature: string } | null>(null)
  const lifetime = useRef<AbortController | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const busy = stage !== 'idle'
  useEffect(() => { heading.current?.focus() }, [])
  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    void api.createConfig(controller.signal).then(value => { if (!controller.signal.aborted) setAvailable(value) }, () => { if (!controller.signal.aborted) setAvailable(false) })
    return () => controller.abort()
  }, [api])
  // Any edit invalidates the quote: the fee is quoted for exact inputs.
  const change = (key: keyof Fields, value: string) => { setFields(current => ({ ...current, [key]: value })); setQuote(null); setError('') }
  const draft = () => parsePantaCreateDraft({
    question: fields.question, category: fields.category, marketType: fields.marketType,
    startTime: seconds(fields.startsAt), endTime: seconds(fields.endsAt), resolutionTime: seconds(fields.resolvesAt),
    resolutionRule: fields.resolutionRule, sourcesOfTruth: fields.sources.split('\n').map(line => line.trim()).filter(Boolean),
    imageUrl: fields.imageUrl, ...(fields.description.trim() ? { description: fields.description } : {}),
  }, Math.floor(Date.now() / 1000))

  async function getQuote(event: FormEvent) {
    event.preventDefault()
    const signal = lifetime.current?.signal
    if (!wallet || busy || !signal) return
    setError(''); setStage('quoting')
    try { setQuote(await api.quote(wallet.address, draft(), signal)) }
    catch (reason) { if (!signal.aborted) setError(reason instanceof Error ? reason.message : 'PANTA could not quote this market.') }
    finally { if (!signal.aborted) setStage('idle') }
  }

  async function create() {
    const signal = lifetime.current?.signal
    if (!wallet || !quote || busy || !signal) return
    setError('')
    try {
      setStage('signing')
      const { transaction } = await api.build(wallet.address, quote.createId, signal)
      const signer = await wallet.getSigner()
      if (signal.aborted || getSession().solanaWallet !== wallet) throw new Error('Your wallet changed. Get a new quote.')
      if (!signer.isConnected || !signer.publicKey || new PublicKey(signer.publicKey.toBytes()).toBase58() !== wallet.address) throw new Error('Reconnect your Solana wallet before creating.')
      const signed = await signer.signTransaction(VersionedTransaction.deserialize(Uint8Array.from(atob(transaction), char => char.charCodeAt(0))))
      setStage('sending')
      const bytes = (signed as VersionedTransaction).serialize()
      const result = await api.submit(wallet.address, quote.createId, btoa(String.fromCharCode(...bytes)), signal)
      if (!signal.aborted) { setCreated(result); setQuote(null) }
    } catch (reason) {
      if (!signal.aborted) setError(reason instanceof PantaApiError || reason instanceof Error ? reason.message : 'The market could not be created.')
    } finally { if (!signal.aborted) setStage('idle') }
  }

  return <section className={standalone ? 'gq-proposal gq-proposal--page' : 'gq-proposal'} aria-labelledby="panta-create-title">
    <header className="gq-section-heading"><div>{standalone ? <h1 ref={heading} tabIndex={-1} id="panta-create-title" className="sz-page-title">Create a market on PANTA</h1> : <h2 ref={heading} tabIndex={-1} id="panta-create-title">Create a market on PANTA</h2>}<p>PANTA runs on Solana mainnet. Creating charges your wallet real USDC: 50 for a standard market, 20 for a breaking one. You become the creator and earn PANTA’s creator royalty.</p></div>{onClose && <button type="button" className="gq-icon-button" onClick={onClose} aria-label="Close create form" disabled={busy}><X size={20}/></button>}</header>
    {available === false && <p className="gq-error" role="status">PANTA market creation is not enabled on this deployment yet.</p>}
    {created ? <div className="gq-receipt" role="status"><Check size={20}/><div><strong>Your PANTA market is live</strong><p>It is listed on {brand.name}, and its price history starts now.</p><a href={`/events-panta/${created.marketId}`}>Open the market<ArrowUpRight size={14}/></a><small>Transaction {created.signature.slice(0, 12)}…</small></div></div>
      : <form onSubmit={event => void getQuote(event)}>
        <div className="gq-template"><span>Start from a PreStocks template:</span>{PRESTOCKS_ASSETS.map(asset => <button key={asset.symbol} type="button" className="gq-text-button" disabled={busy} onClick={() => { setFields(prestocksTemplate(asset.symbol)); setQuote(null); setError('') }}>{asset.symbol}</button>)}</div>
        <fieldset disabled={busy || available === false} className="gq-form-fields">
          <label className="gq-full">Question<input required minLength={12} maxLength={512} value={fields.question} onChange={event => change('question', event.target.value)}/></label>
          <label>Category<select value={fields.category} onChange={event => change('category', event.target.value)}>{PANTA_CATEGORIES.map(value => <option key={value} value={value}>{value[0]!.toUpperCase() + value.slice(1)}</option>)}</select></label>
          <label>Market type<select value={fields.marketType} onChange={event => change('marketType', event.target.value)}><option value="standard">Standard · 50 USDC · planned event</option><option value="breaking">Breaking · 20 USDC · starts within 72 h</option></select></label>
          <label>Trading starts<input type="datetime-local" required value={fields.startsAt} onChange={event => change('startsAt', event.target.value)}/><small>At least one hour from now.</small></label>
          <label>Trading ends<input type="datetime-local" required value={fields.endsAt} onChange={event => change('endsAt', event.target.value)}/></label>
          <label>Resolves after<input type="datetime-local" required value={fields.resolvesAt} onChange={event => change('resolvesAt', event.target.value)}/><small>Your local time ({Intl.DateTimeFormat().resolvedOptions().timeZone}).</small></label>
          <label>Image URL<input type="url" required value={fields.imageUrl} onChange={event => change('imageUrl', event.target.value)} placeholder="https://…"/><small>Public HTTPS, square 1024×1024 recommended.</small></label>
          <label className="gq-full">Resolution rules<textarea required minLength={30} maxLength={2048} rows={3} value={fields.resolutionRule} onChange={event => change('resolutionRule', event.target.value)}/><small>PANTA’s AI agent reads these rules and the sources below to resolve the market.</small></label>
          <label className="gq-full">Sources of truth<textarea required rows={2} value={fields.sources} onChange={event => change('sources', event.target.value)}/><small>One public HTTPS URL per line, up to five.</small></label>
        </fieldset>
        {error && <p className="gq-error" role="alert">{error}</p>}
        {quote ? <div className="gq-submit-row"><div><strong>{usd(quote.paymentUsdc)} to create · 1 wallet signature</strong><p>{usd(quote.liquidityInjectionUsdc)} seeds the market’s liquidity; {usd(quote.platformRevenueUsdc)} is PANTA’s fee. Not refundable. Solana network fees apply. Quote valid until {new Date(quote.expiresAt).toLocaleTimeString()}.</p></div><button className="gq-primary" type="button" disabled={busy} onClick={() => void create()}>{stage === 'signing' ? 'Check your wallet…' : stage === 'sending' ? 'Creating on mainnet…' : `Create for ${usd(quote.paymentUsdc)}`}</button></div>
          : <div className="gq-submit-row"><div><strong>{wallet ? `Creating as ${wallet.address.slice(0, 5)}…${wallet.address.slice(-5)}` : 'Connect a Solana wallet to create'}</strong><p>First get PANTA’s quote. Nothing is charged until you sign.</p></div><button className="gq-primary" type="submit" disabled={!wallet || busy || available !== true}>{stage === 'quoting' ? 'Getting quote…' : 'Get quote'}</button></div>}
        <span className="gq-sr-only" role="status">{stage === 'quoting' ? 'Getting PANTA quote' : stage === 'signing' ? 'Waiting for wallet signature' : stage === 'sending' ? 'Sending the create transaction' : ''}</span>
      </form>}
  </section>
}
