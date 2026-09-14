import '../../styles/home-hero.css'
import '../../styles/home.css'
import './prediction.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Market, Order } from '../../../packages/prediction-core/types'
import type { PredictionPublicConfig, PublicPredictionVenue } from '../../../packages/prediction-core/market-data'
import type { MarketExecutionQuote } from '../../../packages/prediction-core/execution'
import { PredictionTradingClient, getPredictionConfig } from '../../../packages/sdk/PredictionTradingClient'
import { useEvmWallet, useSolanaWallet } from '../session/store'
import { useTradingMarket } from './useTradingMarket'
import { connectEvmTradingWallet, connectSolanaTradingWallet, maximumOrderCost, type TradingWallet } from './wallets'
import { formatUnitsExact, parseUnitsExact, priceLabel } from './amounts'
import { ConfirmedPriceChart } from './ConfirmedPriceChart'
import { HermesControls } from './HermesControls'
import { NetworkTabs, NetworkTrading, type TradingNetwork } from './NetworkTrading'
import type { MarketSource } from '../home/MarketSourceControls'
import { AppShell } from '../solz/AppShell'

export interface PredictionAppProps { apiUrl: string; marketSources?: readonly MarketSource[] }
export function PredictionApp({ apiUrl, marketSources = ['SOLANA'] }: PredictionAppProps) {
  return <PredictionHome apiUrl={apiUrl} marketSources={marketSources}/>
}
const venueKey = (venue: PublicPredictionVenue) => `${venue.venue}:${venue.chainId}`
const unavailable = async (): Promise<never> => { throw new Error('Connect a trading wallet first.') }

function PredictionHome({ apiUrl, marketSources }: { apiUrl: string; marketSources: readonly MarketSource[] }) {
  const networks: TradingNetwork[] = marketSources.includes('SOMNIA') ? ['SOLANA', 'SOMNIA'] : ['SOLANA']
  const [network,setNetwork]=useState<TradingNetwork>(networks[0] ?? 'SOLANA')
  useEffect(() => { if (!networks.includes(network)) setNetwork(networks[0] ?? 'SOLANA') }, [marketSources, network, networks.join(',')])
  return <AppShell className="solz-home pt-home" id="top" active="markets" backToTopHref="#top"><main className="pt-main"><h1>Live prediction markets</h1><NetworkTabs network={network} choices={networks} onChange={setNetwork}/><NetworkTrading key={network} apiUrl={apiUrl} network={network} previewWhenUnavailable={network === 'SOLANA'} renderEvmTerminal={(venue, audience, allowedMarketIds) => <VenueTerminal venue={venue} apiUrl={apiUrl} audience={audience} allowedMarketIds={allowedMarketIds}/>} /></main></AppShell>
}

export function VenueTerminal({ venue, apiUrl, audience, allowedMarketIds }: { allowedMarketIds?: string[]; venue: PublicPredictionVenue; apiUrl: string; audience: string }) {
  // Read from the store rather than a render prop: the session is created by the
  // persisted chrome island, which is not an ancestor of this tree.
  const solanaWallet = useSolanaWallet()
  const evmWallet = useEvmWallet()
  const [wallet, setWallet] = useState<TradingWallet | null>(null)
  const currentWallet = useRef<TradingWallet | null>(null)
  currentWallet.current = wallet
  useEffect(() => () => wallet?.dispose(), [wallet])
  const [connecting, setConnecting] = useState(false)
  const [connectionError, setConnectionError] = useState('')
  const [markets, setMarkets] = useState<Market[]>([])
  const [marketsError, setMarketsError] = useState('')
  const [marketId, setMarketId] = useState('')
  const connectionGeneration = useRef(0)
  useEffect(() => { return () => { connectionGeneration.current++ } }, [])
  const readClient = useMemo(() => new PredictionTradingClient({ baseUrl: apiUrl, audience, venue: venue.venue, chainId: venue.chainId, account: '', signOrder: unavailable, signRequest: unavailable, redeem: unavailable }), [apiUrl, audience, venue])
  const client = wallet?.client ?? readClient
  useEffect(() => {
    let active = true
    const load = async () => { try { const next = await readClient.listMarkets(); if (active) { setMarkets(allowedMarketIds ? next.filter(m => allowedMarketIds.includes(m.id)) : next); setMarketsError('') } } catch (reason) { if (active) setMarketsError(reason instanceof Error ? reason.message : 'Markets could not load.') } }
    void load(); const timer = setInterval(() => void load(), 5000)
    return () => { active = false; clearInterval(timer) }
  }, [readClient, allowedMarketIds])
  useEffect(() => { if (venue.family === 'SOLANA') { connectionGeneration.current++; currentWallet.current?.dispose(); setWallet(null) } }, [solanaWallet, venue.family])
  useEffect(() => {
    if (venue.family !== 'EVM') return
    connectionGeneration.current++; currentWallet.current?.dispose(); setWallet(null)
  }, [evmWallet, venue.family])
  const connect = async () => {
    const generation = ++connectionGeneration.current
    setConnecting(true); setConnectionError('')
    try {
      if (venue.family === 'SOLANA') {
        if (!solanaWallet) throw new Error('Use the wallet control above to connect your Solana wallet.')
        const next = await connectSolanaTradingWallet(venue, apiUrl, audience, solanaWallet)
        if (generation === connectionGeneration.current) setWallet(next); else next.dispose()
      } else {
        if (!evmWallet) throw new Error('Use the Dynamic wallet control above to connect an EVM wallet.')
        const next = await connectEvmTradingWallet(venue, apiUrl, audience, evmWallet)
        if (generation === connectionGeneration.current) setWallet(next); else next.dispose()
      }
    } catch (reason) { if (generation === connectionGeneration.current) setConnectionError(reason instanceof Error ? reason.message : 'Wallet connection failed.') }
    finally { setConnecting(false) }
  }
  const market = markets.find(value => value.id === marketId) ?? markets[0]
  return <><div className="pt-toolbar"><label>Match market<select aria-label="Match market" value={market?.id ?? ''} onChange={event => setMarketId(event.target.value)} disabled={!markets.length}>{markets.map(value => <option key={value.id} value={value.id}>{value.outcomes.map(outcome => outcome.label).join(' / ')} · {value.status.toLowerCase()} · {value.id.slice(0, 10)}</option>)}</select></label><div>{wallet ? <span className="pt-connection">Trading as {wallet.owner.slice(0, 6)}…{wallet.owner.slice(-4)}</span> : <button disabled={connecting} onClick={() => void connect()}>{connecting ? 'Connecting wallet…' : `Connect ${venue.family === 'SOLANA' ? 'Solana' : 'EVM'} trading wallet`}</button>}</div></div>
    {connectionError && <p role="alert" className="pt-error">{connectionError}</p>}{marketsError && <p role="alert" className="pt-error">{marketsError}</p>}
    {market ? <MarketTerminal key={`${market.id}:${client.account}`} client={client} marketId={market.id} wallet={wallet} venue={venue}/> : <div className="pt-empty"><h2>No markets listed yet</h2><p>The prediction worker will list markets discovered on this network.</p></div>}
  </>
}

function MarketTerminal({ client, marketId, wallet, venue }: { client: PredictionTradingClient; marketId: string; wallet: TradingWallet | null; venue: PublicPredictionVenue }) {
  const [outcomeId, setOutcomeId] = useState(0)
  const state = useTradingMarket(client, marketId, outcomeId, !!wallet)
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY')
  const [kind, setKind] = useState<'MARKET' | 'LIMIT'>('MARKET')
  const [shares, setShares] = useState('10')
  const [limit, setLimit] = useState('50')
  const [slippage, setSlippage] = useState('1')
  const [duration, setDuration] = useState('300')
  const [quote, setQuote] = useState<MarketExecutionQuote | null>(null)
  const [limitReview, setLimitReview] = useState<{ quantity: bigint; price: bigint; expiresAt: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [failed, setFailed] = useState(false)
  const [fundAmount, setFundAmount] = useState('10')
  const reviewIdentity = useRef('')
  reviewIdentity.current = JSON.stringify([client.account, marketId, outcomeId, side, kind, shares, limit, slippage, duration])
  const market = state.snapshot?.market
  const selected = market?.outcomes.find(value => value.id === outcomeId)
  const book = state.snapshot?.book.outcomes.find(value => value.outcomeId === outcomeId)
  const decimals = venue.collateralDecimals
  const format = (amount: bigint) => formatUnitsExact(amount, decimals, Math.min(decimals, 6))
  const position = state.positions.find(value => value.outcomeId === outcomeId)
  const available = position && position.quantity > position.reservedQuantity ? position.quantity - position.reservedQuantity : 0n
  const locked = !market || market.status !== 'TRADING' || market.paused || state.serverNow < market.tradingStartsAt || state.serverNow >= market.tradingLocksAt
  const disabled = busy || !wallet || state.stale || locked || !!state.accountError
  useEffect(() => { setQuote(null); setLimitReview(null); setFeedback('') }, [side, kind, shares, limit, slippage, duration, outcomeId])
  const run = async (operation: () => Promise<string>) => {
    if (busy) return
    setBusy(true); setFeedback(''); setFailed(false)
    try { setFeedback(await operation()); state.refresh() }
    catch (reason) { setFailed(true); setFeedback(reason instanceof Error ? reason.message : 'The operation did not finish.') }
    finally { setBusy(false) }
  }
  const review = () => run(async () => {
    const identity = reviewIdentity.current
    if (!market || disabled) throw new Error('A connected wallet and fresh, open market are required.')
    const quantity = parseUnitsExact(shares, decimals)
    if (side === 'SELL' && quantity > available) throw new Error('Not enough unreserved shares to sell.')
    if (kind === 'MARKET') {
      const bps = Number(slippage) * 100
      if (!Number.isInteger(bps) || bps < 0 || bps > 5000) throw new Error('Slippage must be between 0% and 50%, in steps of 0.01%.')
      const next = await client.quoteMarketOrder(market.id, { outcomeId, side, quantity, slippageBps: bps })
      if (identity !== reviewIdentity.current) throw new Error('The trade changed while quoting. Review it again.')
      setQuote(next)
    } else {
      const price = parseUnitsExact(limit, 4)
      if (price > 1_000_000n) throw new Error('Price cannot exceed 100¢.')
      const expiresAt = Math.floor(Math.min(market.tradingLocksAt, state.serverNow + Number(duration) * 1000) / 1000) * 1000
      setLimitReview({ quantity, price, expiresAt })
    }
    return ''
  })
  const confirm = () => run(async () => {
    if (!market || !wallet || disabled) throw new Error('Refresh this market before submitting.')
    if (kind === 'MARKET' && quote) {
      if (quote.side !== side || quote.outcomeId !== outcomeId || quote.marketId !== market.id) throw new Error('The quote does not match this ticket. Review again.')
      await wallet.prepare(market, side, quote.children.reduce((sum, child) => sum + maximumOrderCost(child.quantity, child.price), 0n))
      if (client.currentTime() >= quote.expiresAt) {
        setQuote(await client.quoteMarketOrder(market.id, { outcomeId, side, quantity: quote.requestedQuantity, slippageBps: quote.slippageBps }))
        return 'Wallet preparation finished. Review the refreshed quote before signing.'
      }
      const execution = await client.executeQuote(quote)
      setQuote(null)
      return `Order accepted. ${format(execution.plannedQuantity)} shares reserved for settlement; ${format(execution.cancelledQuantity)} shares unfilled. Follow confirmation below.`
    }
    if (limitReview) {
      await wallet.prepare(market, side, maximumOrderCost(limitReview.quantity, limitReview.price))
      await client.placeOrder({ marketId: market.id, outcomeId, side, ...limitReview })
      setLimitReview(null)
      return 'Limit order accepted. Fills appear after chain confirmation.'
    }
    throw new Error('Review an order first.')
  })
  const cancel = (order: Order) => run(async () => { if (!wallet) throw new Error('Connect a wallet.'); const receipt = await wallet.cancel(order); return receipt.bookUpdated ? 'Order cancelled on chain and removed from the book. Previously submitted fills may already have settled.' : 'Signature cancelled on chain. The order book still needs to refresh; you can retry cancellation to update it.' })
  const fund = (action: 'deposit' | 'withdraw' | 'split' | 'merge' | 'redeem') => run(async () => {
    if (!wallet || !market) throw new Error('Connect a trading wallet first.')
    const amount = action === 'redeem' ? undefined : parseUnitsExact(fundAmount, decimals)
    if (action === 'merge' && market.outcomes.some(outcome => { const held = state.positions.find(value => value.outcomeId === outcome.id); return !held || held.quantity - held.reservedQuantity < amount! })) throw new Error('Merging requires enough unreserved shares of every outcome.')
    await wallet.collateral(action, market, amount)
    return `${action === 'split' ? 'Complete sets created' : action === 'merge' ? 'Complete sets merged' : action === 'redeem' ? 'Redemption' : action === 'deposit' ? 'Deposit' : 'Withdrawal'} confirmed on chain.`
  })
  if (!market) return <div className="pt-empty" role={state.error ? 'alert' : 'status'}>{state.error || 'Loading market, order book and trades…'}</div>
  const telemetry = state.snapshot?.telemetry
  const telemetryFresh = !!telemetry && state.serverNow - telemetry.timestamp < 10_000
  const spread = book?.bids[0] && book.asks[0] ? book.asks[0].price - book.bids[0].price : null
  const reviewValue = quote || limitReview
  return <fieldset className="pt-session" disabled={busy} aria-label="Selected market trading">
    <div className="pt-market-status"><span className={state.stale ? 'pt-error' : 'pt-connection'}>{state.stale ? 'Market data is stale' : state.feed === 'connected' ? 'Live market feed' : 'Reconnecting feed · refreshing prices'}</span><span>{market.paused ? 'Paused' : market.status.toLowerCase()} · Trading cutoff {new Date(market.tradingLocksAt).toLocaleTimeString()}</span></div>
    {state.error && <p role="alert" className="pt-error">{state.error}</p>}
    <div className="pt-grid"><section className="pt-market"><div className="pt-outcomes" aria-label="Market outcome">{market.outcomes.map(outcome => <button key={outcome.id} aria-pressed={outcomeId === outcome.id} onClick={() => setOutcomeId(outcome.id)}>{outcome.label}<span>{priceLabel(state.snapshot?.book.outcomes.find(value => value.outcomeId === outcome.id)?.lastTradePrice)}</span></button>)}</div>
      <ConfirmedPriceChart candles={state.candles} label={selected?.label ?? 'Outcome'}/>
      <div className="pt-book-heading"><h2>Order book</h2><span>Spread {priceLabel(spread)} · {venue.collateralSymbol} per share</span></div><div className="pt-book-scroll"><table className="pt-book"><caption className="sr-only">Live bids and asks for {selected?.label}</caption><thead><tr><th>Side</th><th>Price</th><th>Shares</th><th>Orders</th></tr></thead><tbody>{book?.asks.slice(0, 8).reverse().map(level => <tr className="pt-ask" key={`ask${level.price}`}><td>Ask</td><td>{priceLabel(level.price)}</td><td>{format(level.quantity)}</td><td>{level.orderCount}</td></tr>)}<tr className="pt-last"><td colSpan={4}>Last confirmed trade {priceLabel(book?.lastTradePrice)}</td></tr>{book?.bids.slice(0, 8).map(level => <tr className="pt-bid" key={`bid${level.price}`}><td>Bid</td><td>{priceLabel(level.price)}</td><td>{format(level.quantity)}</td><td>{level.orderCount}</td></tr>)}</tbody></table></div>{!book?.asks.length && !book?.bids.length && <p className="pt-empty">No orders yet. Place a limit order to add liquidity.</p>}
    </section><aside className="pt-ticket"><h2>Trade {selected?.label}</h2><div className="pt-side" aria-label="Trade side">{(['BUY', 'SELL'] as const).map(value => <button key={value} aria-pressed={side === value} onClick={() => setSide(value)}>{value === 'BUY' ? 'Buy' : 'Sell'}</button>)}</div>
      <form onSubmit={event => { event.preventDefault(); void review() }}><label>Order type<select aria-label="Order type" value={kind} onChange={event => setKind(event.target.value as typeof kind)}><option value="MARKET">Market</option><option value="LIMIT">Limit</option></select></label><label>Shares<input aria-label="Shares" type="text" inputMode="decimal" value={shares} onChange={event => setShares(event.target.value)} required/></label>{kind === 'LIMIT' ? <><label>Limit price · cents<input aria-label="Limit price in cents" type="text" inputMode="decimal" value={limit} onChange={event => setLimit(event.target.value)} required/></label><label>Order duration<select value={duration} onChange={event => setDuration(event.target.value)}><option value="60">1 minute</option><option value="300">5 minutes</option><option value="3600">1 hour, or market cutoff</option></select></label></> : <label>Maximum slippage · %<input aria-label="Maximum slippage percent" type="number" min="0" max="50" step="0.01" value={slippage} onChange={event => setSlippage(event.target.value)}/></label>}
      <dl className="pt-totals"><div><dt>Available collateral</dt><dd>{state.balance ? `${format(state.balance.available)} ${venue.collateralSymbol}` : '—'}</dd></div><div><dt>Available shares</dt><dd>{wallet && !state.accountError ? format(available) : '—'}</dd></div></dl>
      <button className="pt-primary" type="submit" disabled={disabled}>{busy ? 'Working…' : 'Review order'}</button>{!wallet && <p>Connect a trading wallet to place orders.</p>}{locked && <p>This market is {market.paused ? 'paused' : 'closed to new orders'}.</p>}{state.accountError && <p className="pt-error" role="alert">{state.accountError}</p>}</form>
      {reviewValue && <div className="pt-review"><h3>Review {side.toLowerCase()}</h3>{quote ? <><dl className="pt-totals"><div><dt>Executable shares</dt><dd>{format(quote.executableQuantity)} / {format(quote.requestedQuantity)}</dd></div><div><dt>Estimated {side === 'BUY' ? 'cost' : 'proceeds'}</dt><dd>{format(quote.estimatedCollateral)} {venue.collateralSymbol}</dd></div><div><dt>{side === 'BUY' ? 'Maximum' : 'Minimum'} price</dt><dd>{priceLabel(quote.limitPrice)}</dd></div><div><dt>Quote expires</dt><dd>{Math.max(0, Math.ceil((quote.expiresAt - state.serverNow) / 1000))}s</dd></div></dl><p>{quote.children.length} price-level {quote.children.length === 1 ? 'signature' : 'signatures'}. Each fill settles separately. Unfilled shares are removed from the book.</p></> : limitReview && <p>{format(limitReview.quantity)} shares at {priceLabel(limitReview.price)}. Expires {new Date(limitReview.expiresAt).toLocaleTimeString()}.</p>}<button className="pt-primary" disabled={disabled || !!quote && (quote.executableQuantity === 0n || state.serverNow >= quote.expiresAt)} onClick={() => void confirm()}>{busy ? 'Confirm in wallet…' : 'Sign & submit'}</button><button disabled={busy} onClick={() => { setQuote(null); setLimitReview(null) }}>Dismiss</button></div>}
      {feedback && <p className={failed ? 'pt-error' : 'pt-feedback'} role={failed ? 'alert' : 'status'}>{feedback}</p>}
      <details className="pt-collateral"><summary>Collateral & settlement</summary><p>{venue.family === 'SOLANA' ? 'Deposit collateral into your prediction vault before trading.' : 'Manual trades use collateral in your connected wallet.'} Creating a complete set locks 1 unit of collateral for one share of every outcome.</p><label>Collateral / complete sets<input aria-label="Collateral amount" inputMode="decimal" value={fundAmount} onChange={event => setFundAmount(event.target.value)}/></label><div>{venue.family === 'SOLANA' && <><button disabled={!wallet || busy} onClick={() => void fund('deposit')}>Deposit</button><button disabled={!wallet || busy || !!state.accountError} onClick={() => void fund('withdraw')}>Withdraw</button></>}<button disabled={!wallet || busy || locked || !!state.accountError} onClick={() => void fund('split')}>Create sets</button><button disabled={!wallet || busy || !!state.accountError} onClick={() => void fund('merge')}>Merge sets</button><button disabled={!wallet || busy || !['RESOLVED', 'VOIDED'].includes(market.status)} onClick={() => void fund('redeem')}>Redeem payout</button></div></details>
      <HermesControls client={client} marketId={market.id} connected={!!wallet}/>
    </aside></div>
    <div className="pt-bottom"><section><h2>Your trading activity</h2>{!wallet ? <p className="pt-empty">Connect a wallet to see positions and orders.</p> : <><div className="pt-positions">{state.positions.filter(value => value.quantity > 0n).map(value => <div key={value.outcomeId}><strong>{market.outcomes[value.outcomeId]?.label}</strong><span>{format(value.quantity)} shares · {format(value.reservedQuantity)} reserved</span><small>{value.accountingComplete === false || value.realizedPnl === null ? 'Profit and loss unavailable until history is indexed' : `Realized P&L ${format(value.realizedPnl)} ${venue.collateralSymbol}`}</small></div>)}</div>{state.orders.map(order => <div className="pt-order" key={order.orderId}><span>{order.side} {market.outcomes[order.outcomeId]?.label} · {format(order.quantity - order.filled)} remaining @ {priceLabel(order.price)}<small>{order.status.toLowerCase().replaceAll('_', ' ')}</small></span><button disabled={busy} onClick={() => void cancel(order)}>Cancel</button></div>)}{state.executions.slice(-8).reverse().map(execution => <div className="pt-order" key={execution.id}><span>{execution.side} market · {execution.status.toLowerCase().replaceAll('_', ' ')}<small>{format(execution.filledQuantity)} confirmed · {format(execution.pendingQuantity)} pending · {format(execution.cancelledQuantity)} unfilled</small></span></div>)}{!state.orders.length && !state.positions.some(value => value.quantity > 0n) && !state.executions.length && <p className="pt-empty">No positions or orders for this market.</p>}</>}</section>
      <section><h2>Match telemetry</h2><p className={telemetryFresh ? 'pt-connection' : 'pt-muted'}>{telemetryFresh ? 'Receiving game state' : telemetry ? 'Game telemetry is stale' : 'Waiting for the game telemetry bridge'}</p>{telemetry && <><p>{Math.max(0, Math.ceil((telemetry.remainingMs - (state.serverNow - telemetry.timestamp)) / 1000))}s remaining at the game source</p><div className="pt-roster">{telemetry.participants.map(participant => <div key={participant.id}><strong>{participant.id}</strong><span>{participant.alive ? `${participant.hp} / ${participant.maxHp} HP` : 'Eliminated'}</span><span>{participant.kills} kills</span></div>)}</div></>}</section></div>
  </fieldset>
}
