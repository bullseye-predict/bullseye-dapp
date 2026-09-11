import { ArrowUpRight, Copy, ExternalLink } from 'lucide-react'
import { useEffect, useState, type CSSProperties } from 'react'
import type { ArenaMarket, ArenaMarketOutcome, SolzSnapshot } from '../solz/model'
import { sampleOrderBook } from '../solz/marketDepth'
import { predictionContract, type PredictionAnswer } from '../solz/predictionContracts'
import { Tabs, TabPanel } from '../solz/ui'
import { amountLabel } from './HomePrimitives'
import { HighlightChart } from './HighlightChart'
import { DreamDexBrowser } from '../../../packages/adapters/dreamdex/browser'
import { eventBinding } from '../../../packages/adapters/dreamdex/config'
import type { DreamDexPublicConfig } from '../../../packages/prediction-core/market-data'

type Props = {
  collateral?: string
  market: ArenaMarket; outcome: ArenaMarketOutcome; answer?: PredictionAnswer; snapshot: SolzSnapshot
  referenceMarket?: ArenaMarket; simulation: boolean; nested?: boolean
  onSelect: (outcome: ArenaMarketOutcome, answer?: PredictionAnswer) => void
}
export function PredictionDetail({ market, outcome, answer = 'yes', snapshot, referenceMarket, simulation, nested = false, onSelect, collateral = 'COOLA' }: Props) {
  const [tab, setTab] = useState<'book' | 'graph' | 'activity' | 'info'>('book')
  const contract = predictionContract(outcome, nested ? answer : 'yes')
  const book = simulation ? sampleOrderBook(contract) : null
  const prefix = `topic-${market.id}-${nested ? outcome.id : 'detail'}`
  return <div className="ch-topic-detail">
    <div className="ch-topic-tabs"><Tabs idPrefix={prefix} label={`${nested ? outcome.label : market.title} details`} value={tab} onChange={(value) => { setTab(value as typeof tab); onSelect(outcome, answer) }} tabs={[{ id: 'book', label: 'Order Book' }, { id: 'graph', label: 'Graph' }, { id: 'activity', label: 'Activity' }, { id: 'info', label: 'Info' }]}/><span>{simulation ? 'SAMPLE DATA' : 'SEE TRADE PANEL'}</span></div>
    <TabPanel id="book" idPrefix={prefix} active={tab === 'book'}>
      <div className="ch-book-heading"><label>Trade <select aria-label={`${nested ? outcome.label : market.title} order book outcome`} value={nested ? answer : outcome.id} onChange={(event) => nested ? onSelect(outcome, event.target.value as PredictionAnswer) : onSelect(market.outcomes.find((item) => item.id === event.target.value) ?? outcome)}>{nested ? <><option value="yes">Yes · {outcome.label}</option><option value="no">No · {outcome.label}</option></> : market.outcomes.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><span>{collateral} / SHARE</span></div>
      {!book ? !simulation && market.onchain ? <LiveOrderBook market={market} outcome={outcome} answer={answer} nested={nested} collateral={collateral}/> : <div className="ch-empty-book" role="status"><table className="ch-order-book" aria-label={`Empty order book for ${contract.label}`}><caption className="sr-only">No confirmed orders yet.</caption><colgroup><col className="ch-book-side-column"/><col/><col/><col/></colgroup><thead><tr><th scope="col">SIDE</th><th scope="col">PRICE</th><th scope="col">SHARES</th><th scope="col">TOTAL</th></tr></thead><tbody>{['ask', 'ask', 'bid', 'bid'].map((side, index) => <tr key={`${side}-${index}`} className={`is-${side}`}><td>{index === 0 ? 'Asks' : index === 2 ? 'Bids' : ''}</td><td>—</td><td>—</td><td>—</td></tr>)}</tbody></table><div className="ch-market-empty"><strong>Live order book in the trade panel.</strong><span>Select this question to load its confirmed orders and trade with {collateral}.</span></div></div> :
      <table className="ch-order-book"><caption className="sr-only">Sample order book for {contract.label} · {market.title}. Shading shows cumulative share depth; totals are cumulative COOLA.</caption><colgroup><col className="ch-book-side-column"/><col/><col/><col/></colgroup><thead><tr><th scope="col">SIDE</th><th scope="col">PRICE</th><th scope="col">SHARES</th><th scope="col">TOTAL</th></tr></thead><tbody>
        {book.asks.map((row, index) => <tr className="is-ask" key={row.price} style={{ '--depth': `${row.depth}%` } as CSSProperties}><td>{index === book.asks.length - 1 && <span>Asks</span>}</td><td>{Math.round(row.price * 100)}¢</td><td>{amountLabel(row.shares)}</td><td>{amountLabel(row.total)}</td></tr>)}
        <tr className="ch-book-spread"><td colSpan={2}>Last: {Math.round(contract.probability * 100)}¢</td><td colSpan={2}>Spread: {Math.round(book.spread * 100)}¢</td></tr>
        {book.bids.map((row, index) => <tr className="is-bid" key={row.price} style={{ '--depth': `${row.depth}%` } as CSSProperties}><td>{index === 0 && <span>Bids</span>}</td><td>{Math.round(row.price * 100)}¢</td><td>{amountLabel(row.shares)}</td><td>{amountLabel(row.total)}</td></tr>)}
      </tbody></table>}
    </TabPanel>
    <TabPanel id="graph" idPrefix={prefix} active={tab === 'graph'} className="ch-topic-graph"><HighlightChart market={market} outcome={contract} snapshot={snapshot} referenceMarket={referenceMarket} simulation={simulation} focusOnly onOutcome={(item) => onSelect(item, answer)} onMarket={() => {}}/></TabPanel>
    <TabPanel id="activity" idPrefix={prefix} active={tab === 'activity'} className="ch-topic-activity">
      {!market.onchain ? <div className="ch-market-empty"><strong>No on-chain activity yet.</strong><span>Opening this question will record its DreamDEX creation transaction here. User trades will appear as they are indexed.</span></div> : <OnchainActivity market={market}/>}
    </TabPanel>
    <TabPanel id="info" idPrefix={prefix} active={tab === 'info'} className="ch-topic-info"><h4>Resolution</h4><p>{nested ? `Yes pays the settlement value assigned to ${outcome.label}. No pays the remainder of 1 ${collateral}. ` : ''}{market.rules}</p><p>{market.description}</p>{!simulation && <><h4>Open this market</h4><p>The operator creates this binary YES/NO DreamDEX question with {collateral}, confirms its on-chain receipt, then registers the event contract ID, oracle question ID, and exact trading window for this arena question. Once confirmed, this same ticket receives the live balance, orders, and chart—there is no separate trading UI.</p></>}<dl><div><dt>Closes</dt><dd>{new Date(market.closesAt).toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</dd></div><div><dt>Status</dt><dd>{market.status}</dd></div><div><dt>Settlement</dt><dd>Up to 1 {collateral} per share</dd></div></dl></TabPanel>
  </div>
}

type LiveLevel = { price: bigint; quantity: bigint }
type LiveBook = { asks: LiveLevel[]; bids: LiveLevel[]; priceDecimals: number }

function displayUnits(value: bigint, decimals: number) {
  const scale = 10n ** BigInt(decimals), whole = value / scale, fraction = (value % scale).toString().padStart(decimals, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole.toString()
}

function LiveOrderBook({ market, outcome, answer, nested, collateral }: { market: ArenaMarket; outcome: ArenaMarketOutcome; answer: PredictionAnswer; nested: boolean; collateral: string }) {
  const [book, setBook] = useState<LiveBook | null>(null)
  const [error, setError] = useState<string | null>(null)
  const binding = market.onchain!
  const isNo = nested ? answer === 'no' : outcome.id === 'no'
  useEffect(() => {
    let cancelled = false
    const config: DreamDexPublicConfig = { chainId: binding.chainId, label: 'Shannon · SOLZ game events', indexerUrl: binding.indexerUrl, wsRpcUrl: binding.wsRpcUrl, markets: [{ eventId: market.matchId ?? '', marketId: binding.marketId, oracleQuestionId: binding.oracleQuestionId, tradingStartsAt: binding.tradingStartsAt, tradingLocksAt: binding.tradingLocksAt, voidPolicy: binding.voidPolicy, label: market.title }] }
    const adapter = new DreamDexBrowser(config, eventBinding(config, config.markets[0]))
    void adapter.snapshot().then((state) => {
      if (cancelled) return
      const current = state.book
      if (!current) throw new Error('This event pool is not available for trading yet.')
      setBook({ asks: isNo ? current.noAsks : current.yesAsks, bids: isNo ? current.noBids : current.yesBids, priceDecimals: state.market.decimals })
      setError(null)
    }).catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Live order book unavailable') }).finally(() => { void adapter.close() })
    return () => { cancelled = true; void adapter.close() }
  }, [binding.chainId, binding.indexerUrl, binding.marketId, binding.oracleQuestionId, binding.tradingLocksAt, binding.tradingStartsAt, binding.voidPolicy, isNo, market.matchId, market.title])
  const rows = (levels: LiveLevel[], side: 'ask' | 'bid') => levels.slice(0, 2).map((level, index) => <tr key={`${side}-${level.price}-${index}`} className={`is-${side}`}><td>{index === 0 ? side === 'ask' ? 'Asks' : 'Bids' : ''}</td><td>{displayUnits(level.price, book?.priceDecimals ?? 4)}¢</td><td>{displayUnits(level.quantity, 6)}</td><td>{displayUnits(level.price * level.quantity / 10n ** BigInt(book?.priceDecimals ?? 4), 6)}</td></tr>)
  return <div className="ch-empty-book" role="status"><table className="ch-order-book" aria-label={`Live order book for ${market.title}`}><caption className="sr-only">Live DreamDEX order book.</caption><colgroup><col className="ch-book-side-column"/><col/><col/><col/></colgroup><thead><tr><th scope="col">SIDE</th><th scope="col">PRICE</th><th scope="col">SHARES</th><th scope="col">TOTAL</th></tr></thead><tbody>{book ? <>{rows(book.asks, 'ask')}{rows(book.bids, 'bid')}</> : ['ask', 'ask', 'bid', 'bid'].map((side, index) => <tr key={`${side}-${index}`} className={`is-${side}`}><td>{index === 0 ? 'Asks' : index === 2 ? 'Bids' : ''}</td><td>—</td><td>—</td><td>—</td></tr>)}</tbody></table><div className="ch-market-empty"><strong>{book ? 'Live DreamDEX order book.' : error ? 'Live order book temporarily unavailable.' : 'Loading live DreamDEX order book…'}</strong><span>{book ? `Confirmed on-chain orders for this exact question, denominated in ${collateral}.` : error ?? `This ticket will recheck the confirmed ${collateral} order book before signing.`}</span></div></div>
}

function OnchainActivity({ market }: { market: ArenaMarket }) {
  const activity = [
    ...(market.onchain?.creationTxHash ? [{ label: 'Create DreamDEX event market', hash: market.onchain.creationTxHash, detail: 'Sponsored operator transaction · confirmed' }] : []),
    ...(market.onchain?.sponsoredTransactions ?? []).map((transaction) => ({ ...transaction, detail: 'Sponsored starter-liquidity transaction · confirmed' })),
  ]
  const explorer = 'https://shannon-explorer.somnia.network/tx/'
  const short = (hash: string) => `${hash.slice(0, 10)}…${hash.slice(-8)}`
  return <div className="ch-onchain-activity">
    <header><div><strong>Question activity</strong><span>Exact market ID · {market.onchain!.marketId}</span></div>{market.onchain!.creationTxHash ? <a href={`${explorer}${market.onchain!.creationTxHash}`} target="_blank" rel="noreferrer">Explorer <ExternalLink size={12}/></a> : <span className="ch-activity-sync">Receipt syncing</span>}</header>
    <ol>{activity.length ? activity.map((transaction) => <li key={transaction.hash}><div><strong>{transaction.label}</strong><span>{transaction.detail}</span></div><a href={`${explorer}${transaction.hash}`} target="_blank" rel="noreferrer" aria-label={`Open ${transaction.label} in Somnia explorer`}>{short(transaction.hash)} <ArrowUpRight size={12}/></a></li>) : <li className="is-pending"><div><strong>Market record available</strong><span>The creation receipt is being synchronized. No transaction is hidden or invented here.</span></div></li>}</ol>
    <p><Copy size={12}/> This list contains the confirmed sponsored setup receipts for this exact YES/NO question. External wallet trades are on-chain too; they appear after the DreamDEX indexer confirms them.</p>
  </div>
}
