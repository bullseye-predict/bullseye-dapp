import { ArrowUpRight, Check, ChevronDown, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ArenaMarket, ArenaMarketOutcome, SolzDataSource, SolzSnapshot } from '../solz/model'
import { baseOutcomeId, isNoContract, predictionContract, type PredictionAnswer } from '../solz/predictionContracts'
import { accentStyle, AgentPortrait, amountLabel, percent, TeamMark } from './HomePrimitives'
import { availableShares, outcomeColor } from './heroMarket'
import { TradeReviewDialog } from './TradeReviewDialog'
import { OpenDreamDexMarket } from './OpenDreamDexMarket'
import { DreamDexBrowser } from '../../../packages/adapters/dreamdex/browser'
import { eventBinding } from '../../../packages/adapters/dreamdex/config'
import { dynamicEvmProvider } from '../prediction/dynamicEvmProvider'
import { parseUnits } from 'viem'
import type { DynamicEvmWalletPort } from '../arena/DynamicSolanaSession'
import type { DreamDexPublicConfig } from '../../../packages/prediction-core/market-data'

type Props = {
  source: SolzDataSource; snapshot: SolzSnapshot; market: ArenaMarket; outcome: ArenaMarketOutcome
  onOutcome: (outcome: ArenaMarketOutcome) => void; answer: PredictionAnswer; onAnswer: (answer: PredictionAnswer) => void; simulation: boolean; collateralSymbol?: string; dreamDexApiUrl?: string; onDreamDexOpened?: () => void; evmWallet?: DynamicEvmWalletPort | null
}
export function TradeTicket({ source, snapshot, market, outcome, onOutcome, answer, onAnswer, simulation, collateralSymbol = 'COOLA', dreamDexApiUrl = '', onDreamDexOpened, evmWallet = null }: Props) {
  const [side, setSide] = useState<'buy' | 'sell'>('buy')
  const [type, setType] = useState<'market' | 'limit'>('market')
  const [amount, setAmount] = useState('250')
  const [shares, setShares] = useState('100')
  const multiple = market.outcomes.length > 2
  const contract = predictionContract(outcome, multiple ? answer : 'yes')
  const [limitPrice, setLimitPrice] = useState(String(Math.round(contract.probability * 100)))
  const [expiry, setExpiry] = useState('close')
  const [review, setReview] = useState(false)
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean } | null>(null)
  const color = outcomeColor(outcome, snapshot)
  const available = availableShares(snapshot, market, contract)
  const closed = market.status !== 'open' || snapshot.updatedAt >= market.closesAt
  const price = type === 'limit' ? Number(limitPrice) / 100 : Math.max(.01, contract.probability)
  const quantity = side === 'buy' && type === 'market' ? Number(amount) / price : Number(shares)
  const gross = quantity * price
  const fee = gross * .012
  const total = side === 'buy' ? gross + fee : gross - fee
  const positions = snapshot.account.positions.filter((position) => position.marketId === market.id && position.token === 'COOLA')
  const orders = snapshot.limitOrders.filter((order) => order.marketId === market.id).slice(0, 5)
  const valid = Number.isFinite(quantity) && quantity > 0 && price >= .01 && price <= (type === 'limit' ? .99 : 1) && (!simulation || side !== 'sell' || quantity <= available)
  const liveDreamDex = !simulation && collateralSymbol === 'tUSDC' && market.onchain?.chainId === '50312'
  const unavailable = (!simulation && !liveDreamDex) || closed || (simulation && side === 'sell' && available < .01) || (liveDreamDex && !evmWallet)
  const safeLabel = (value: number) => amountLabel(Number.isFinite(value) ? value : 0)

  useEffect(() => { setLimitPrice(String(Math.round(contract.probability * 100))); setFeedback(null); setReview(false) }, [market.id, contract.id])
  useEffect(() => { if (!simulation) setReview(false) }, [simulation])
  useEffect(() => { if (liveDreamDex) setAmount('1') }, [liveDreamDex, market.id])
  async function submit() {
    if (pending || unavailable || !valid) return
    setPending(true); setFeedback(null)
    try {
      if (liveDreamDex) {
        const binding = market.onchain!
        const config: DreamDexPublicConfig = { chainId: binding.chainId, label: 'Shannon · SOLZ game events', indexerUrl: binding.indexerUrl, wsRpcUrl: binding.wsRpcUrl, markets: [{ eventId: market.matchId ?? '', marketId: binding.marketId, oracleQuestionId: binding.oracleQuestionId, tradingStartsAt: binding.tradingStartsAt, tradingLocksAt: binding.tradingLocksAt, voidPolicy: binding.voidPolicy, label: market.title }] }
        const adapter = new DreamDexBrowser(config, eventBinding(config, config.markets[0]))
        try {
          const provider = await dynamicEvmProvider(evmWallet!, binding.chainId)
          const wallet = await adapter.connect(provider)
          const snapshot = await adapter.snapshot(wallet.owner)
          if (!snapshot.pool) throw Error('This event pool is not available for trading yet.')
          const outcomeIndex = market.outcomes.findIndex((item) => item.id === outcome.id)
          const yes = outcomeIndex !== 1
          const livePrice = type === 'market' ? (side === 'buy' ? (yes ? snapshot.book?.yesAsks[0]?.price : snapshot.book?.noAsks[0]?.price) : (yes ? snapshot.book?.yesBids[0]?.price : snapshot.book?.noBids[0]?.price)) : parseUnits(limitPrice, 4)
          if (!livePrice) throw Error(`No ${side === 'buy' ? 'ask' : 'bid'} is available. Use a limit order to add liquidity.`)
          const liveQuantity = parseUnits(String(type === 'market' && side === 'buy' ? Number(amount) / (Number(livePrice) / 10_000) : quantity), 6)
          const hash = await wallet.order({ side: `${side === 'buy' ? 'BUY' : 'SELL'}_${yes ? 'YES' : 'NO'}`, outcomePrice: livePrice, quantity: liveQuantity, orderType: type === 'market' ? 2 : 0 })
          setFeedback({ text: `Transaction confirmed: ${hash.slice(0, 10)}…${hash.slice(-8)}` })
          wallet.dispose()
        } finally { await adapter.close() }
      } else if (type === 'limit') {
        const order = await source.placeLimitOrder({ marketId: market.id, outcomeId: contract.id, side, token: 'COOLA', price, shares: quantity, expiresAt: expiry === 'close' ? market.closesAt : Date.now() + Number(expiry) * 60_000 })
        setFeedback({ text: order.status === 'filled' ? `Limit ${side} filled · ${safeLabel(quantity)} shares.` : `Limit ${side} placed at ${limitPrice}¢. ${side === 'buy' ? 'Credits' : 'Shares'} reserved.` })
      } else if (side === 'buy') {
        const receipt = await source.placeOrder({ market, outcome: contract, token: 'COOLA', amount: Number(amount) })
        setFeedback({ text: `Bought ${safeLabel(receipt.position.shares)} ${contract.label} shares.` })
      } else {
        await source.sellShares(market.id, contract.id, 'COOLA', quantity)
        setFeedback({ text: `Sold ${safeLabel(quantity)} ${contract.label} shares.` })
      }
      setReview(false)
    } catch (reason) { setFeedback({ text: reason instanceof Error ? reason.message : 'This trade could not be placed.', error: true }) }
    finally { setPending(false) }
  }

  return <section className="ch-trade" aria-label="Trade ticket" style={accentStyle(color)}>
    <div className="ch-trade-title">{outcome.participantId ? <AgentPortrait number={Number(outcome.participantId.split('-')[1])}/> : <TeamMark id={outcome.teamId ?? outcome.id} color={color}/>}<div><span>{market.title}</span><strong>{outcome.label}</strong></div></div>
    <div className="ch-trade-controls"><div aria-label="Trade side">{(['buy', 'sell'] as const).map((value) => <button key={value} className={`is-${value}`} aria-pressed={side === value} onClick={() => { setSide(value); setFeedback(null); if (value === 'sell') setShares(String(Math.floor(available * 100) / 100)) }}>{value === 'buy' ? 'Buy' : 'Sell'}</button>)}</div><label><span className="sr-only">Order type</span><select value={type} onChange={(event) => { setType(event.target.value as 'market' | 'limit'); setFeedback(null) }}><option value="market">Market</option><option value="limit">Limit</option></select><ChevronDown size={13}/></label></div>
    <div className="ch-trade-outcomes" aria-label="Trade outcome">
      {multiple ? (['yes', 'no'] as const).map((value) => <button type="button" className={`is-${value}`} key={value} aria-pressed={answer === value} onClick={() => onAnswer(value)}><span>{value === 'yes' ? 'Yes' : 'No'}</span><b>{simulation ? `${Math.round((value === 'yes' ? outcome.probability : 1 - outcome.probability) * 100)}¢` : '—'}</b>{answer === value && <Check size={12}/>}</button>) : market.outcomes.map((item, index) => <button type="button" className={index === 0 ? 'is-yes' : 'is-no'} key={item.id} aria-pressed={outcome.id === item.id} onClick={() => onOutcome(item)}><span>{item.label}</span><b>{simulation ? percent(item.probability) : '—'}</b>{item.id === outcome.id && <Check size={12}/>}</button>)}
    </div>
    {!simulation && collateralSymbol === 'tUSDC' && !market.onchain && <OpenDreamDexMarket apiUrl={dreamDexApiUrl} eventId={market.matchId} agentId={outcome.participantId} onOpened={() => onDreamDexOpened?.()}/>}
    <form onSubmit={(event) => { event.preventDefault(); setFeedback(null); if (!unavailable && valid) setReview(true) }}>
      {type === 'limit' && <div className="ch-limit-price"><label htmlFor="limit-price">Limit price</label><div><button type="button" aria-label="Decrease limit price" onClick={() => setLimitPrice(String(Math.max(1, Number(limitPrice) - 1)))}>−</button><input id="limit-price" type="number" min="1" max="99" step="1" required value={limitPrice} onChange={(event) => setLimitPrice(event.target.value)}/><span>¢</span><button type="button" aria-label="Increase limit price" onClick={() => setLimitPrice(String(Math.min(99, Number(limitPrice) + 1)))}>+</button></div></div>}
      <div className="ch-trade-amount"><div><label htmlFor="trade-quantity">{side === 'buy' && type === 'market' ? 'Amount' : 'Shares'}</label><small>{simulation ? side === 'buy' ? `${amountLabel(snapshot.account.balances.COOLA)} COOLA available` : `${amountLabel(available)} shares available` : liveDreamDex ? evmWallet ? `Connected ${evmWallet.address.slice(0, 6)}…${evmWallet.address.slice(-4)} · wallet signs this order` : 'Connect a Somnia wallet above to trade' : `Connect a wallet to view your ${collateralSymbol} balance`}</small></div><div><input id="trade-quantity" aria-label={side === 'buy' && type === 'market' ? 'Trade amount' : 'Trade shares'} type="number" inputMode="decimal" required min={liveDreamDex ? 1 : side === 'buy' && type === 'market' ? 25 : .01} max={simulation && side === 'sell' ? available : undefined} step="any" value={side === 'buy' && type === 'market' ? amount : shares} onChange={(event) => side === 'buy' && type === 'market' ? setAmount(event.target.value) : setShares(event.target.value)}/><span>{side === 'buy' && type === 'market' ? collateralSymbol : 'SHARES'}</span></div></div>
      <div className="ch-trade-presets">{side === 'sell' ? [25, 50, 100].map((value) => <button type="button" key={value} onClick={() => setShares(String(Math.floor(available * value) / 100))}>{value === 100 ? 'Max' : `${value}%`}</button>) : (liveDreamDex ? [1, 5, 10] : [100, 250, 500]).map((value) => <button type="button" key={value} onClick={() => type === 'market' ? setAmount(String(value)) : setShares(String(value))}>{value}</button>)}</div>
      <div className="ch-trade-action"><button className="ch-submit-trade" disabled={pending || unavailable || !valid}>Trade <ArrowUpRight size={17}/></button>
      <p className="ch-sample-note">{!simulation ? liveDreamDex ? !evmWallet ? 'Connect a Somnia wallet to sign a real tUSDC order.' : closed ? 'This event is closed to new orders.' : type === 'market' ? 'Market orders require a live opposing quote; use Limit to provide liquidity.' : 'Your wallet will sign this tUSDC limit order.' : `On-chain ${collateralSymbol} trading opens when this question has a confirmed DreamDEX event contract.` : closed ? 'This market is closed.' : side === 'sell' && available < .01 ? 'You have no shares of this outcome to sell.' : 'Simulation · off-chain credits only'}</p></div>
    </form>
    {feedback && !review && <p className={`ch-trade-feedback ${feedback.error ? 'is-error' : ''}`} role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>}
    {(positions.length > 0 || orders.length > 0) && <details className="ch-holdings"><summary>Your activity <span>{positions.length} positions · {orders.filter((order) => order.status === 'open').length} open orders</span></summary><div>{positions.map((position) => <p key={position.id}><span>{position.outcomeLabel}<small>{amountLabel(position.shares)} shares · {amountLabel(position.value)} COOLA</small></span><button disabled={!simulation} onClick={() => { const selected = market.outcomes.find((item) => item.id === baseOutcomeId(position.outcomeId)); if (selected) onOutcome(selected); onAnswer(isNoContract(position.outcomeId) ? 'no' : 'yes'); setSide('sell'); setShares(String(Math.floor(position.shares * 100) / 100)); setType('market') }}>Sell</button></p>)}{orders.map((order) => <p key={order.id}><span>{order.side.toUpperCase()} {order.label}<small>{amountLabel(order.shares)} shares @ {Math.round(order.price * 100)}¢ · {order.status}</small></span>{order.status === 'open' && <button disabled={!simulation} aria-label={`Cancel ${order.label} limit order`} onClick={() => source.cancelLimitOrder(order.id)}><X size={13}/></button>}</p>)}</div></details>}
    <TradeReviewDialog open={review} onClose={() => setReview(false)} onConfirm={() => void submit()} pending={pending} disabled={unavailable || !valid} title={market.title} label={multiple ? `${answer.toUpperCase()} · ${outcome.label}` : outcome.label} side={side} type={type} price={price} quantity={quantity} fee={fee} total={total} expiry={expiry} onExpiry={setExpiry} simulation={simulation} collateralSymbol={collateralSymbol} error={closed ? simulation ? 'This market closed before confirmation. Your credits have not been used.' : 'This event closed before confirmation. No wallet transaction was submitted.' : feedback?.error ? feedback.text : undefined}/>
  </section>
}
