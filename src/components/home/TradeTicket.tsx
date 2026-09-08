import { ArrowUpRight, Check, ChevronDown, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ArenaMarket, ArenaMarketOutcome, SolzDataSource, SolzSnapshot } from '../solz/model'
import { baseOutcomeId, isNoContract, predictionContract, type PredictionAnswer } from '../solz/predictionContracts'
import { accentStyle, AgentPortrait, amountLabel, percent, TeamMark } from './HomePrimitives'
import { availableShares, outcomeColor } from './heroMarket'
import { TradeReviewDialog } from './TradeReviewDialog'

type Props = {
  source: SolzDataSource; snapshot: SolzSnapshot; market: ArenaMarket; outcome: ArenaMarketOutcome
  onOutcome: (outcome: ArenaMarketOutcome) => void; answer: PredictionAnswer; onAnswer: (answer: PredictionAnswer) => void; simulation: boolean
}
export function TradeTicket({ source, snapshot, market, outcome, onOutcome, answer, onAnswer, simulation }: Props) {
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
  const valid = Number.isFinite(quantity) && quantity > 0 && price >= .01 && price <= (type === 'limit' ? .99 : 1) && (side !== 'sell' || quantity <= available)
  const unavailable = !simulation || closed || (side === 'sell' && available < .01)
  const safeLabel = (value: number) => amountLabel(Number.isFinite(value) ? value : 0)

  useEffect(() => { setLimitPrice(String(Math.round(contract.probability * 100))); setFeedback(null); setReview(false) }, [market.id, contract.id])
  useEffect(() => { if (!simulation) setReview(false) }, [simulation])
  async function submit() {
    if (pending || unavailable || !valid) return
    setPending(true); setFeedback(null)
    try {
      if (type === 'limit') {
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
    <form onSubmit={(event) => { event.preventDefault(); setFeedback(null); if (!unavailable && valid) setReview(true) }}>
      {type === 'limit' && <div className="ch-limit-price"><label htmlFor="limit-price">Limit price</label><div><button type="button" aria-label="Decrease limit price" onClick={() => setLimitPrice(String(Math.max(1, Number(limitPrice) - 1)))}>−</button><input id="limit-price" type="number" min="1" max="99" step="1" required value={limitPrice} onChange={(event) => setLimitPrice(event.target.value)}/><span>¢</span><button type="button" aria-label="Increase limit price" onClick={() => setLimitPrice(String(Math.min(99, Number(limitPrice) + 1)))}>+</button></div></div>}
      <div className="ch-trade-amount"><div><label htmlFor="trade-quantity">{side === 'buy' && type === 'market' ? 'Amount' : 'Shares'}</label><small>{simulation ? side === 'buy' ? `${amountLabel(snapshot.account.balances.COOLA)} COOLA available` : `${amountLabel(available)} shares available` : 'Live balance unavailable'}</small></div><div><input id="trade-quantity" aria-label={side === 'buy' && type === 'market' ? 'Trade amount' : 'Trade shares'} type="number" inputMode="decimal" required min={side === 'buy' && type === 'market' ? 25 : .01} max={side === 'sell' ? available : undefined} step="any" value={side === 'buy' && type === 'market' ? amount : shares} onChange={(event) => side === 'buy' && type === 'market' ? setAmount(event.target.value) : setShares(event.target.value)}/><span>{side === 'buy' && type === 'market' ? 'COOLA' : 'SHARES'}</span></div></div>
      <div className="ch-trade-presets">{side === 'sell' ? [25, 50, 100].map((value) => <button type="button" key={value} onClick={() => setShares(String(Math.floor(available * value) / 100))}>{value === 100 ? 'Max' : `${value}%`}</button>) : [100, 250, 500].map((value) => <button type="button" key={value} onClick={() => type === 'market' ? setAmount(String(value)) : setShares(String(value))}>{value}</button>)}</div>
      <div className="ch-trade-action"><button className="ch-submit-trade" disabled={pending || unavailable || !valid}>Trade <ArrowUpRight size={17}/></button>
      <p className="ch-sample-note">{!simulation ? 'Simulation off · live trading isn’t connected yet' : closed ? 'This market is closed.' : side === 'sell' && available < .01 ? 'You have no shares of this outcome to sell.' : 'Simulation · off-chain credits only'}</p></div>
    </form>
    {feedback && !review && <p className={`ch-trade-feedback ${feedback.error ? 'is-error' : ''}`} role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>}
    {(positions.length > 0 || orders.length > 0) && <details className="ch-holdings"><summary>Your activity <span>{positions.length} positions · {orders.filter((order) => order.status === 'open').length} open orders</span></summary><div>{positions.map((position) => <p key={position.id}><span>{position.outcomeLabel}<small>{amountLabel(position.shares)} shares · {amountLabel(position.value)} COOLA</small></span><button disabled={!simulation} onClick={() => { const selected = market.outcomes.find((item) => item.id === baseOutcomeId(position.outcomeId)); if (selected) onOutcome(selected); onAnswer(isNoContract(position.outcomeId) ? 'no' : 'yes'); setSide('sell'); setShares(String(Math.floor(position.shares * 100) / 100)); setType('market') }}>Sell</button></p>)}{orders.map((order) => <p key={order.id}><span>{order.side.toUpperCase()} {order.label}<small>{amountLabel(order.shares)} shares @ {Math.round(order.price * 100)}¢ · {order.status}</small></span>{order.status === 'open' && <button disabled={!simulation} aria-label={`Cancel ${order.label} limit order`} onClick={() => source.cancelLimitOrder(order.id)}><X size={13}/></button>}</p>)}</div></details>}
    <TradeReviewDialog open={review} onClose={() => setReview(false)} onConfirm={() => void submit()} pending={pending} disabled={unavailable || !valid} title={market.title} label={multiple ? `${answer.toUpperCase()} · ${outcome.label}` : outcome.label} side={side} type={type} price={price} quantity={quantity} fee={fee} total={total} expiry={expiry} onExpiry={setExpiry} error={closed ? 'This market closed before confirmation. Your credits have not been used.' : feedback?.error ? feedback.text : undefined}/>
  </section>
}
