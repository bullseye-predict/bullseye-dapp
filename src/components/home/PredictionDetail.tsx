import { useState, type CSSProperties } from 'react'
import type { ArenaMarket, ArenaMarketOutcome, SolzSnapshot } from '../solz/model'
import { sampleOrderBook } from '../solz/marketDepth'
import { predictionContract, type PredictionAnswer } from '../solz/predictionContracts'
import { Tabs, TabPanel } from '../solz/ui'
import { amountLabel } from './HomePrimitives'
import { HighlightChart } from './HighlightChart'

type Props = {
  collateral?: string
  market: ArenaMarket; outcome: ArenaMarketOutcome; answer?: PredictionAnswer; snapshot: SolzSnapshot
  referenceMarket?: ArenaMarket; simulation: boolean; nested?: boolean
  onSelect: (outcome: ArenaMarketOutcome, answer?: PredictionAnswer) => void
}
export function PredictionDetail({ market, outcome, answer = 'yes', snapshot, referenceMarket, simulation, nested = false, onSelect, collateral = 'COOLA' }: Props) {
  const [tab, setTab] = useState<'book' | 'graph' | 'info'>('book')
  const contract = predictionContract(outcome, nested ? answer : 'yes')
  const book = simulation ? sampleOrderBook(contract) : null
  const prefix = `topic-${market.id}-${nested ? outcome.id : 'detail'}`
  return <div className="ch-topic-detail">
    <div className="ch-topic-tabs"><Tabs idPrefix={prefix} label={`${nested ? outcome.label : market.title} details`} value={tab} onChange={(value) => { setTab(value); onSelect(outcome, answer) }} tabs={[{ id: 'book', label: 'Order Book' }, { id: 'graph', label: 'Graph' }, { id: 'info', label: 'Info' }]}/><span>{simulation ? 'SAMPLE DATA' : 'SEE TRADE PANEL'}</span></div>
    <TabPanel id="book" idPrefix={prefix} active={tab === 'book'}>
      <div className="ch-book-heading"><label>Trade <select aria-label={`${nested ? outcome.label : market.title} order book outcome`} value={nested ? answer : outcome.id} onChange={(event) => nested ? onSelect(outcome, event.target.value as PredictionAnswer) : onSelect(market.outcomes.find((item) => item.id === event.target.value) ?? outcome)}>{nested ? <><option value="yes">Yes · {outcome.label}</option><option value="no">No · {outcome.label}</option></> : market.outcomes.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><span>{collateral} / SHARE</span></div>
      {!book ? <div className="ch-market-empty" role="status"><strong>Live order book in the trade panel.</strong><span>Select this question to load its confirmed orders and trade with {collateral}.</span></div> :
      <table className="ch-order-book"><caption className="sr-only">Sample order book for {contract.label} · {market.title}. Shading shows cumulative share depth; totals are cumulative COOLA.</caption><colgroup><col className="ch-book-side-column"/><col/><col/><col/></colgroup><thead><tr><th scope="col">SIDE</th><th scope="col">PRICE</th><th scope="col">SHARES</th><th scope="col">TOTAL</th></tr></thead><tbody>
        {book.asks.map((row, index) => <tr className="is-ask" key={row.price} style={{ '--depth': `${row.depth}%` } as CSSProperties}><td>{index === book.asks.length - 1 && <span>Asks</span>}</td><td>{Math.round(row.price * 100)}¢</td><td>{amountLabel(row.shares)}</td><td>{amountLabel(row.total)}</td></tr>)}
        <tr className="ch-book-spread"><td colSpan={2}>Last: {Math.round(contract.probability * 100)}¢</td><td colSpan={2}>Spread: {Math.round(book.spread * 100)}¢</td></tr>
        {book.bids.map((row, index) => <tr className="is-bid" key={row.price} style={{ '--depth': `${row.depth}%` } as CSSProperties}><td>{index === 0 && <span>Bids</span>}</td><td>{Math.round(row.price * 100)}¢</td><td>{amountLabel(row.shares)}</td><td>{amountLabel(row.total)}</td></tr>)}
      </tbody></table>}
    </TabPanel>
    <TabPanel id="graph" idPrefix={prefix} active={tab === 'graph'} className="ch-topic-graph"><HighlightChart market={market} outcome={contract} snapshot={snapshot} referenceMarket={referenceMarket} simulation={simulation} focusOnly onOutcome={(item) => onSelect(item, answer)} onMarket={() => {}}/></TabPanel>
    <TabPanel id="info" idPrefix={prefix} active={tab === 'info'} className="ch-topic-info"><h4>Resolution</h4><p>{nested ? `Yes pays the settlement value assigned to ${outcome.label}. No pays the remainder of 1 ${collateral}. ` : ''}{market.rules}</p><p>{market.description}</p><dl><div><dt>Closes</dt><dd>{new Date(market.closesAt).toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</dd></div><div><dt>Status</dt><dd>{market.status}</dd></div><div><dt>Settlement</dt><dd>Up to 1 {collateral} per share</dd></div></dl></TabPanel>
  </div>
}
