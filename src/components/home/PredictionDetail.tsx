import { ArrowUpRight, ExternalLink } from 'lucide-react'
import { useState, type CSSProperties } from 'react'
import type { ArenaMarket, ArenaMarketOutcome, SolzSnapshot } from '../solz/model'
import { sampleOrderBook } from '../solz/marketDepth'
import { predictionContract, type PredictionAnswer } from '../solz/predictionContracts'
import { Tabs, TabPanel } from '../solz/ui'
import { amountLabel } from './HomePrimitives'
import { HighlightChart } from './HighlightChart'
import { LiveOrderBook, OrderBookTable } from './LiveOrderBook'
import { useDreamDexActivity } from './useDreamDexActivity'
import { useVenueMarket, venueBinding } from './venue/useVenueMarket'
import { explorerTxUrl } from '../../../packages/adapters/explorer'

type Props = {
  collateral?: string
  market: ArenaMarket; outcome: ArenaMarketOutcome; answer?: PredictionAnswer; snapshot: SolzSnapshot
  referenceMarket?: ArenaMarket; simulation: boolean; nested?: boolean
  /** False while this panel is collapsed. A hidden panel still mounts, so
   *  without it every question on the page polls its books unseen. */
  active?: boolean
  onSelect: (outcome: ArenaMarketOutcome, answer?: PredictionAnswer) => void
}
export function PredictionDetail({ market, outcome, answer = 'yes', snapshot, referenceMarket, simulation, nested = false, active = true, onSelect, collateral = 'COOLA' }: Props) {
  const [tab, setTab] = useState<'book' | 'graph' | 'activity' | 'info'>('book')
  // Every venue branch in this panel goes through one hook. The panel never
  // imports a chain adapter and never reads a chain-specific field.
  // Gated on the panel being open as well as the tab: a twelve-question event
  // mounts twelve of these, and each poll reads both outcome bindings, so
  // collapsed panels alone were issuing 24 getAccountInfo calls every 10s.
  const view = useVenueMarket(market, undefined, active && !simulation && tab === 'book')
  const binding = venueBinding(market)
  const contract = predictionContract(outcome, nested ? answer : 'yes')
  const book = simulation ? sampleOrderBook(contract) : null
  const prefix = `topic-${market.id}-${nested ? outcome.id : 'detail'}`
  return <div className="ch-topic-detail">
    <div className="ch-topic-tabs"><Tabs idPrefix={prefix} label={`${nested ? outcome.label : market.title} details`} value={tab} onChange={(value) => { setTab(value as typeof tab); onSelect(outcome, answer) }} tabs={[{ id: 'book', label: 'Order Book' }, { id: 'graph', label: 'Graph' }, { id: 'activity', label: 'Activity' }, { id: 'info', label: 'Info' }]}/>{simulation && <span>SAMPLE DATA</span>}</div>
    <TabPanel id="book" idPrefix={prefix} active={tab === 'book'}>

      {!book ? !simulation && binding ? tab === 'book' ? <LiveOrderBook market={market} view={view} isNo={nested ? answer === 'no' : outcome.id === 'no'} label={contract.label} collateral={collateral}/> : null : <div className="ch-empty-book" role="status"><OrderBookTable asks={[]} bids={[]} decimals={6} label={contract.label}/><div className="ch-market-empty"><strong>No market opened for this match.</strong><span>Open this question from the trade ticket to start a separate {collateral} market for this match.</span></div></div> :
      <table className="ch-order-book"><caption className="sr-only">Sample order book for {contract.label} · {market.title}. Shading shows cumulative share depth; totals are cumulative COOLA.</caption><colgroup><col className="ch-book-side-column"/><col/><col/><col/></colgroup><thead><tr><th scope="col">SIDE</th><th scope="col">PRICE</th><th scope="col">SHARES</th><th scope="col">TOTAL</th></tr></thead><tbody>
        {book.asks.map((row, index) => <tr className="is-ask" key={row.price} style={{ '--depth': `${row.depth}%` } as CSSProperties}><td>{index === book.asks.length - 1 && <span>Asks</span>}</td><td>{Math.round(row.price * 100)}¢</td><td>{amountLabel(row.shares)}</td><td>{amountLabel(row.total)}</td></tr>)}
        <tr className="ch-book-spread"><td colSpan={2}>Last: {Math.round(contract.probability * 100)}¢</td><td colSpan={2}>Spread: {Math.round(book.spread * 100)}¢</td></tr>
        {book.bids.map((row, index) => <tr className="is-bid" key={row.price} style={{ '--depth': `${row.depth}%` } as CSSProperties}><td>{index === 0 && <span>Bids</span>}</td><td>{Math.round(row.price * 100)}¢</td><td>{amountLabel(row.shares)}</td><td>{amountLabel(row.total)}</td></tr>)}
      </tbody></table>}
    </TabPanel>
    <TabPanel id="graph" idPrefix={prefix} active={tab === 'graph'} className="ch-topic-graph"><HighlightChart collateral={collateral} market={market} outcome={contract} snapshot={snapshot} referenceMarket={referenceMarket} simulation={simulation} focusOnly onOutcome={(item) => onSelect(item, answer)} onMarket={() => {}}/></TabPanel>
    <TabPanel id="activity" idPrefix={prefix} active={tab === 'activity'} className="ch-topic-activity">
      {!binding ? <div className="ch-market-empty"><strong>No on-chain activity yet.</strong><span>Opening this question will record its DreamDEX creation transaction here. User trades will appear as they are indexed.</span></div> : <OnchainActivity market={market} active={active && tab === 'activity'}/>}
    </TabPanel>
    <TabPanel id="info" idPrefix={prefix} active={tab === 'info'} className="ch-topic-info"><h4>Resolution</h4><p>{nested ? `Yes pays the settlement value assigned to ${outcome.label}. No pays the remainder of 1 ${collateral}. ` : ''}{market.rules}</p><p>{market.description}</p>{!simulation && <><h4>Open this market</h4><p>The operator creates this binary YES/NO DreamDEX question with {collateral}, confirms its on-chain receipt, then registers the event contract ID, oracle question ID, and exact trading window for this arena question. Once confirmed, this same ticket receives the live balance, orders, and chart—there is no separate trading UI.</p></>}<dl><div><dt>Closes</dt><dd>{new Date(market.closesAt).toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</dd></div><div><dt>Status</dt><dd>{market.status}</dd></div><div><dt>Settlement</dt><dd>Up to 1 {collateral} per share</dd></div></dl></TabPanel>
  </div>
}

function OnchainActivity({ market, active }: { market: ArenaMarket; active: boolean }) {
  const { rows, error, loading } = useDreamDexActivity(market, active)
  const setup = [
    ...(market.onchain?.creationTxHash ? [{ label: 'Market opened', hash: market.onchain.creationTxHash }] : []),
    ...(market.onchain?.sponsoredTransactions ?? []),
  ].reverse()
  // Derived from the venue so a Solana signature never links to a Somnia explorer.
  const explorerFor = (hash: string) => explorerTxUrl(venueBinding(market)?.explorer, hash)
  const short = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`
  return <div className="ch-onchain-activity">
    <header><div><strong>Market activity</strong><span>Trades and order placements · newest first</span></div></header>
    {loading ? <p role="status">Loading market activity…</p> : error ? <p role="alert">{error}</p> : !rows.length ? <p>No indexed trades or orders yet.</p> : null}
    <ol>{rows.slice(0, 40).map(row => <li key={row.id}><div><strong>{row.label}</strong><span>{row.detail}{row.owner ? ` · ${short(row.owner)}` : ''}</span></div><div><time dateTime={new Date(row.at).toISOString()}>{new Date(row.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time><a href={explorerFor(row.hash)} target="_blank" rel="noreferrer" aria-label={`View ${row.label} transaction`}>{short(row.hash)} <ArrowUpRight size={12}/></a></div></li>)}</ol>
    <details className="ch-setup-activity"><summary>Market setup <span>{setup.length} receipts · newest first</span></summary><ol>{setup.map(transaction => <li key={transaction.hash}><span>{transaction.label}</span><a href={explorerFor(transaction.hash)} target="_blank" rel="noreferrer">{short(transaction.hash)} <ExternalLink size={12}/></a></li>)}</ol></details>
    <p>Filled trades transfer shares. Open orders are still waiting. Setup receipts do not represent purchases. Activity may lag the confirmed wallet balance while indexing.</p>
  </div>
}
