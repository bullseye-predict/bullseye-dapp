import { useEffect, useMemo, useRef, useState } from 'react'
import { Connection, PublicKey } from '@solana/web3.js'
import type { RestingOrder } from '@bonasa-tech/manifest-sdk'
import type { PublicPredictionVenue, Candle } from '../../../packages/prediction-core/market-data'
import { ManifestAdapter } from '../../../packages/adapters/solana/manifest/adapter'
import { ManifestBrowserWallet } from '../../../packages/adapters/solana/manifest/browser'
import { recentManifestCandles } from '../../../packages/adapters/solana/manifest/history'
import { takerFee, type ManifestBinding } from '../../../packages/adapters/solana/manifest/wire'
import { decodeMarket } from '../../../packages/adapters/solana/accounts'
import type { DynamicSolanaSessionValue } from '../arena/DynamicSolanaSession'
import { ConfirmedPriceChart } from './ConfirmedPriceChart'
import { formatUnitsExact, parseUnitsExact, priceLabel } from './amounts'

type Props = { venue: PublicPredictionVenue; session: DynamicSolanaSessionValue }
const format = (n: bigint) => formatUnitsExact(n, 6, 6)
type Holdings = Awaited<ReturnType<ManifestAdapter['holdings']>>
type Question = ReturnType<typeof decodeMarket>
export function ManifestTerminal({ venue, session }: Props) {
  if (!venue.programId || !venue.manifestProgramId || !venue.publicRpcUrl) return <div className="pt-empty" role="status">Solana deployment configuration is incomplete. Trading will be available after the prediction and guarded Manifest programs are connected.</div>
  return <ConfiguredManifest key={`${venue.chainId}:${venue.programId}:${venue.manifestProgramId}:${session.walletAddress ?? ''}`} venue={venue} session={session}/>
}
function ConfiguredManifest({ venue, session }: Props) {
  const adapter = useMemo(() => new ManifestAdapter(new Connection(venue.publicRpcUrl!, 'confirmed'), { genesisHash: venue.chainId, predictionProgram: new PublicKey(venue.programId!), manifestProgram: new PublicKey(venue.manifestProgramId!), collateralMint: new PublicKey(venue.collateralToken) }), [venue])
  const wallet = useMemo(() => session.wallet ? new ManifestBrowserWallet(adapter, session.wallet) : null, [adapter, session.wallet])
  useEffect(() => () => wallet?.dispose(), [wallet])
  const [address, setAddress] = useState(venue.manifestMarkets?.[0]?.address ?? '')
  const selected = venue.manifestMarkets?.find(m => m.address === address)
  return <><div className="pt-toolbar"><label>Solana market<select aria-label="Solana market" value={address} onChange={e => setAddress(e.target.value)}>{venue.manifestMarkets?.map(m => <option key={m.address} value={m.address}>{m.label}</option>)}</select></label><span>{venue.label} · USDC · Manifest</span>{session.walletControl}</div>
    {selected ? <QuestionTerminal key={`${address}:${session.walletAddress ?? ''}`} adapter={adapter} wallet={wallet} labels={selected.outcomes} address={address} matchId={selected.matchId}/> : <div className="pt-empty"><h3>No Solana markets configured</h3><p>Activate a YES/NO question on devnet and register its address to begin testing.</p></div>}</>
}
function QuestionTerminal({ adapter, wallet, labels, address, matchId }: { adapter: ManifestAdapter; wallet: ManifestBrowserWallet | null; labels: string[]; address: string; matchId: string }) {
  const [outcome, setOutcome] = useState<0 | 1>(0)
  return <><div className="pt-outcomes" aria-label="Prediction outcome">{labels.map((label, i) => <button key={i} aria-pressed={outcome === i} onClick={() => setOutcome(i as 0 | 1)}>{label}</button>)}</div><OutcomeTerminal key={outcome} adapter={adapter} wallet={wallet} question={address} outcome={outcome} label={labels[outcome]!} matchId={matchId}/></>
}
function OutcomeTerminal({ adapter, wallet: sessionWallet, question, outcome, label, matchId }: { adapter: ManifestAdapter; wallet: ManifestBrowserWallet | null; question: string; outcome: 0 | 1; label: string; matchId: string }) {
  const wallet = useMemo(() => sessionWallet ? new ManifestBrowserWallet(adapter, sessionWallet.port) : null, [adapter, sessionWallet])
  useEffect(() => () => wallet?.dispose(), [wallet])
  const [data, setData] = useState<{ binding: ManifestBinding; state: Question; orders: { side: 'BUY' | 'SELL'; order: RestingOrder }[]; holdings: Holdings | null; now: number } | null>(null)
  const [candles, setCandles] = useState<Candle[]>([]), [historyError, setHistoryError] = useState('')
  const [error, setError] = useState(''), [feedback, setFeedback] = useState(''), [busy, setBusy] = useState(false), [refresh, setRefresh] = useState(0)
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY'), [kind, setKind] = useState<'LIMIT' | 'IOC' | 'POST_ONLY'>('IOC')
  const [quantity, setQuantity] = useState('10'), [price, setPrice] = useState('50'), [funds, setFunds] = useState('10')
  const [review, setReview] = useState<{ quantity: bigint; priceMicros: bigint; maxFeeAtoms: bigint; side: 'BUY' | 'SELL'; kind: typeof kind } | null>(null)
  const active = useRef(true), inFlight = useRef(false)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  useEffect(() => {
    let current = true, loading = false
    const load = async () => {
      if (loading) return; loading = true
      try {
        const binding = await adapter.binding(new PublicKey(question), outcome)
        const [book, account, slot, holdings] = await Promise.all([adapter.readBook(binding), adapter.connection.getAccountInfo(binding.question), adapter.connection.getSlot(), wallet ? adapter.holdings(wallet.owner, binding) : Promise.resolve(null)])
        if (!account) throw new Error('Question account is missing')
        const state = decodeMarket({ ...account, address: binding.question }, adapter.deployment.predictionProgram)
        if (`0x${Array.from(state.matchId, n => n.toString(16).padStart(2, '0')).join('')}` !== matchId || !state.manifestGuarded) throw new Error('Question identity does not match configured market')
        const config = await adapter.verifyDeployment(), now = await adapter.connection.getBlockTime(slot)
        if (now === null) throw new Error('Network time unavailable')
        state.paused ||= config.paused
        const valid = (o: RestingOrder) => BigInt(o.lastValidSlot.toString()) === 0n || BigInt(o.lastValidSlot.toString()) > BigInt(slot)
        if (current) { setData({ binding, state, holdings, now, orders: [...book.bids().filter(valid).map(order => ({ side: 'BUY' as const, order })), ...book.asks().filter(valid).map(order => ({ side: 'SELL' as const, order }))] }); setError('') }
      } catch (e) { if (current) { setError(e instanceof Error ? e.message : 'Market data unavailable'); setReview(null) } }
      finally { loading = false }
    }
    void load(); const timer = setInterval(() => void load(), 4000)
    return () => { current = false; clearInterval(timer) }
  }, [adapter, wallet, question, outcome, matchId, refresh])
  useEffect(() => {
    let current = true, loading = false
    const load = async () => { if (loading) return; loading = true; try { const binding = await adapter.binding(new PublicKey(question), outcome); const next = await recentManifestCandles(adapter.connection, binding); if (current) { setCandles(next); setHistoryError('') } } catch (e) { if (current) setHistoryError(e instanceof Error ? e.message : 'Trade history unavailable') } finally { loading = false } }
    void load(); const timer = setInterval(() => void load(), 15000)
    return () => { current = false; clearInterval(timer) }
  }, [adapter, question, outcome, refresh])
  useEffect(() => setReview(null), [side, kind, quantity, price])
  const run = async (operation: () => Promise<string>) => {
    if (inFlight.current) return
    inFlight.current = true; setBusy(true); setFeedback('')
    try { const result = await operation(); if (active.current) { setFeedback(`Finalized transaction: ${result}`); setRefresh(n => n + 1); setReview(null) } }
    catch (e) { if (active.current) setFeedback(e instanceof Error ? e.message : 'Transaction failed') }
    finally { inFlight.current = false; if (active.current) setBusy(false) }
  }
  const closed = !data || data.state.paused || data.state.status > 1 || BigInt(data.now) < data.state.startsAtSeconds || BigInt(data.now) >= data.state.locksAtSeconds
  const unavailable = !wallet || busy || !!error || !data
  const action = (fn: (w: ManifestBrowserWallet, b: ManifestBinding, amount: bigint) => Promise<string>, amountRequired = true) => void run(async () => { if (!wallet || !data || error) throw new Error('Connect a wallet and refresh the market first'); return fn(wallet, data.binding, amountRequired ? parseUnitsExact(funds, 6) : 0n) })
  const h = data?.holdings
  return <fieldset className="pt-session" disabled={busy} aria-label={`${label} Solana trading`}><div className="pt-market-status"><span>{error ? 'Market data unavailable' : !data ? 'Loading Solana market…' : closed ? 'Closed to new trades' : 'Trading open'}</span>{data && <span>Cutoff {new Date(Number(data.state.locksAtSeconds) * 1000).toLocaleString()}</span>}</div>
    {error && <p className="pt-error" role="alert">{error}</p>}
    <div className="pt-grid"><section className="pt-market">{historyError ? <div className="pt-empty pt-chart-empty">Finalized trade history unavailable</div> : <ConfirmedPriceChart candles={candles} label={`${label} · Solana`}/>}<p className="pt-muted">Recent finalized trades · up to 40 transactions</p>{historyError && <p role="alert" className="pt-error">{historyError}</p>}
      <h2>Order book</h2><div className="pt-book-scroll"><table className="pt-book"><thead><tr><th>Side</th><th>Price</th><th>Shares</th><th>Order</th></tr></thead><tbody>{data?.orders.map(({ side, order }) => <tr className={side === 'BUY' ? 'pt-bid' : 'pt-ask'} key={order.sequenceNumber.toString()}><td>{side === 'BUY' ? 'Bid' : 'Ask'}</td><td>{priceLabel(BigInt(order.price.toString()) / 1_000_000_000_000n)}</td><td>{format(BigInt(order.numBaseAtoms.toString()))}</td><td>{wallet && order.trader.equals(wallet.owner) ? <button disabled={unavailable} onClick={() => void run(async () => wallet.send(await adapter.cancel(wallet.owner, data.binding, [BigInt(order.sequenceNumber.toString())])))}>Cancel</button> : '—'}</td></tr>)}</tbody></table></div>{data && !data.orders.length && <p className="pt-empty">No resting orders. Fund inventory and place a limit order to provide liquidity.</p>}
    </section><aside className="pt-ticket"><h2>Trade {label}</h2><div className="pt-side">{(['BUY','SELL'] as const).map(s => <button key={s} aria-pressed={side === s} onClick={() => setSide(s)}>{s === 'BUY' ? 'Buy' : 'Sell'}</button>)}</div>
      <form onSubmit={e => { e.preventDefault(); try { if (!data || unavailable || closed) throw new Error('Connect a wallet and refresh an open market'); const q = parseUnitsExact(quantity, 6), p = parseUnitsExact(price, 4); if (q <= 0n || p <= 0n || p >= 1_000_000n) throw new Error('Use positive shares and a price between 0 and 100 cents'); const needed = (q*p+999999n)/1000000n; const maxFeeAtoms = kind === 'POST_ONLY' ? 0n : takerFee(side === 'BUY' ? needed : q, data.binding.bps); if (!data.holdings || (side === 'BUY' ? needed > data.holdings.venueAvailableUsdc : q > data.holdings.venueAvailableClaims)) throw new Error('Deposit enough inventory to this order book before reviewing the order.'); if (maxFeeAtoms > data.holdings.walletUsdc) throw new Error('Keep enough USDC in your wallet for the maximum platform fee.'); setReview({ quantity: q, priceMicros: p, side, kind, maxFeeAtoms }); setFeedback('') } catch (e) { setFeedback(e instanceof Error ? e.message : 'Invalid order') } }}>
        <label>Order type<select value={kind} onChange={e => setKind(e.target.value as typeof kind)}><option value="IOC">Immediate · cancel unfilled</option><option value="LIMIT">Limit</option><option value="POST_ONLY">Post only · maker</option></select></label><label>Shares<input inputMode="decimal" value={quantity} onChange={e => setQuantity(e.target.value)}/></label><label>{side === 'BUY' ? 'Maximum' : 'Minimum'} price · cents<input inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)}/></label>
        <p>{data ? `${data.binding.bps / 100}% taker fee on executed USDC. Resting maker orders pay no platform fee.` : error ? 'Fee policy unavailable' : 'Loading fee policy…'}</p><p>Orders use deposited book balances. Fees are paid from wallet USDC.</p><button className="pt-primary" disabled={unavailable || closed}>Review order</button>
      </form>
      {review && <div className="pt-review"><h3>Review {review.side.toLowerCase()}</h3><p>{format(review.quantity)} shares · {priceLabel(review.priceMicros)} limit · maximum fee {format(review.maxFeeAtoms)} USDC.</p><p>{review.kind === 'IOC' ? 'Unfilled shares cancel immediately.' : 'Resting orders remain until filled, cancelled, or the question closes.'}</p><button className="pt-primary" disabled={unavailable || closed} onClick={() => void run(async () => { if (!wallet || !data) throw new Error('Wallet unavailable'); return wallet.send(await adapter.order(wallet.owner, data.binding, { ...review, lastValidSlot: 0 })) })}>Sign & submit</button><button onClick={() => setReview(null)}>Dismiss</button></div>}
      {feedback && <p role="status" className="pt-feedback">{feedback}</p>}
      <h3>Your balances</h3><dl className="pt-totals">{([['Wallet USDC',h?.walletUsdc],['Prediction vault USDC',h?.sharedPredictionVaultUsdc],['Book USDC available',h?.venueAvailableUsdc],['Book USDC reserved',h?.venueReservedUsdc],['Wallet claims',h?.walletClaims],['Internal claims',h?.internalClaims],['Book claims available',h?.venueAvailableClaims],['Book claims reserved',h?.venueReservedClaims]] as const).map(([name,value]) => <div key={name}><dt>{name}</dt><dd>{value === undefined ? '—' : format(value)}</dd></div>)}</dl>
      {!wallet && <p>Connect your Solana wallet above.</p>}
      <details className="pt-collateral"><summary>Funding, claims & settlement</summary><p>First prepare accounts. Deposit USDC to your prediction vault, then create sets. Each 1 USDC backs one YES and one NO. Export claims and deposit them to the selected order book to sell; deposit book USDC to buy.</p><button disabled={unavailable} onClick={() => action((w,b) => w.prepare(b), false)}>Prepare accounts</button><label>Amount<input inputMode="decimal" value={funds} onChange={e => setFunds(e.target.value)}/></label>
        <div>{(['deposit','withdraw','split','merge','redeem'] as const).map(a => <button key={a} disabled={unavailable || (a === 'split' && closed) || (a === 'redeem' && ![3,4].includes(data?.state.status ?? -1))} onClick={() => action((w,b,n) => w.collateral(b,a,a === 'redeem' ? undefined : n), a !== 'redeem')}>{({deposit:'Deposit to vault',withdraw:'Withdraw vault USDC',split:'Create sets',merge:'Merge sets',redeem:'Redeem payout'})[a]}</button>)}</div><p>Import wallet claims before merging or redeeming. Cancel orders and withdraw book claims first if they are reserved.</p>
        <div>{(['export','import'] as const).map(a => <button key={a} disabled={unavailable || (a === 'export' && closed)} onClick={() => action((w,b,n) => w.claims(b,n,a))}>{a === 'export' ? 'Export claims' : 'Import claims'}</button>)}</div>
        <div>{(['USDC','claims'] as const).flatMap(asset => (['deposit','withdraw'] as const).map(direction => <button key={`${asset}:${direction}`} disabled={unavailable || (direction === 'deposit' && closed)} onClick={() => action(async (w,b,n) => w.send(await adapter.moveTokens(w.owner,b,asset,n,direction)))}>{direction === 'deposit' ? 'Deposit' : 'Withdraw'} book {asset}</button>))}</div>
      </details><p className="pt-muted">Automated agents are not enabled for Manifest yet.</p>
    </aside></div></fieldset>
}
