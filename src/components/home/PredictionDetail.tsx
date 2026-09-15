import { useAlerts } from './alerts/store'
import { ArrowUpRight, ExternalLink, RefreshCw } from 'lucide-react'
import { useState, type CSSProperties } from 'react'
import type { ArenaMarket, ArenaMarketOutcome, SolzSnapshot } from '../solz/model'
import { sampleOrderBook } from '../solz/marketDepth'
import { baseOutcomeId, isNoContract, predictionContract, type PredictionAnswer } from '../solz/predictionContracts'
import { Tabs, TabPanel } from '../solz/ui'
import { amountLabel } from './HomePrimitives'
import { TraderIdentity } from '../identity/TraderIdentity'
import { shortAddress } from '../identity/profile'
import { ProbabilityChart } from '../markets/ProbabilityChart'
import { chartHeadline, chartSeries } from '../markets/chartSeries'
import { emptyChart } from '../markets/chartEmpty'
import { LiveOrderBook, OrderBookTable } from './LiveOrderBook'
import { bookTarget, pickBookLevel, useBookPick } from './venue/bookPick'
import { useVenueActivity } from './venue/useVenueActivity'
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
// `referenceMarket` stays in Props but is deliberately not destructured: it was
// only ever forwarded to the old chart, which declared it and never read it. The
// whole HomeApp -> MatchViewer -> PredictionOptions -> here chain is dead, and
// removing it is its own change rather than a rider on this one.
export function PredictionDetail({ market, outcome, answer = 'yes', snapshot, simulation, nested = false, active = true, onSelect, collateral = 'COOLA' }: Props) {
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
  // One derivation of which of the two books this panel shows. The ticket
  // repeats the same rule against its own props; a level picked here only
  // applies to a ticket that agrees on the contract.
  // Team moneylines use team IDs, not literal "yes" and "no" IDs. The second
  // outcome still maps to the NO book, so non-nested binary markets derive the
  // book from outcome position rather than an ID naming convention.
  const isNo = nested ? answer === 'no' : market.outcomes.findIndex((item) => item.id === outcome.id) === 1 || isNoContract(outcome.id)
  const outcomeId = baseOutcomeId(outcome.id)
  const target = bookTarget(market.id, outcomeId, isNo)
  const pick = useBookPick()
  // Side as well as price: a crossed book quotes the same price on both sides,
  // and matching on price alone marked the bid as well as the ask.
  const picked = pick?.target === target ? `${pick.side}:${pick.price}` : undefined
  const graph = chartSeries(market, snapshot, { selectedId: contract.id, nested })
  return <div className="ch-topic-detail">
    <div className="ch-topic-tabs"><Tabs idPrefix={prefix} label={`${nested ? outcome.label : market.title} details`} value={tab} onChange={(value) => { setTab(value as typeof tab); onSelect(outcome, answer) }} tabs={[{ id: 'book', label: 'Order Book' }, { id: 'graph', label: 'Graph' }, { id: 'activity', label: 'Activity' }, { id: 'info', label: 'Info' }]}/><div className="ch-topic-tab-tools">{simulation && <span>SAMPLE DATA</span>}{!simulation && binding && (tab === 'book' || tab === 'graph') && <button type="button" className="ch-book-refresh" aria-label={`Refresh ${contract.label} ${tab === 'graph' ? 'price history' : 'order book'}`} disabled={view.refreshing} onClick={view.refresh}><RefreshCw size={14}/></button>}</div></div>
    <TabPanel id="book" idPrefix={prefix} active={tab === 'book'}>

      {!book ? !simulation && binding ? tab === 'book' ? <LiveOrderBook market={market} view={view} isNo={isNo} label={contract.label} picked={picked} onPick={(level) => { onSelect(outcome, answer); pickBookLevel({ ...level, target, outcomeId, no: isNo }) }}/> : null : <div className="ch-empty-book" role="status"><OrderBookTable asks={[]} bids={[]} decimals={6} label={contract.label}/><div className="ch-market-empty"><strong>No market opened for this match.</strong><span>Open this question from the trade ticket to start a separate {collateral} market for this match.</span></div></div> :
      <table className="ch-order-book"><caption className="sr-only">Sample order book for {contract.label} · {market.title}. Shading follows each price on the 1–99¢ scale; totals accumulate from the best price.</caption><colgroup><col className="ch-book-side-column"/><col/><col/><col/></colgroup><thead><tr><th scope="col" className="ch-book-tools"><span className="sr-only">Side</span></th><th scope="col">PRICE</th><th scope="col">SHARES</th><th scope="col">TOTAL</th></tr></thead><tbody>
        {book.asks.map((row, index) => <tr className="is-ask" key={row.price} style={{ '--depth': `${row.depth}%` } as CSSProperties}><td>{index === book.asks.length - 1 && <span>Asks</span>}</td><td>{Math.round(row.price * 100)}¢</td><td>{amountLabel(row.shares)}</td><td>{amountLabel(row.total)} {collateral}</td></tr>)}
        <tr className="ch-book-spread"><td>Last: {Math.round(contract.probability * 100)}¢</td><td>Spread: {Math.round(book.spread * 100)}¢</td><td colSpan={2}/></tr>
        {book.bids.map((row, index) => <tr className="is-bid" key={row.price} style={{ '--depth': `${row.depth}%` } as CSSProperties}><td>{index === 0 && <span>Bids</span>}</td><td>{Math.round(row.price * 100)}¢</td><td>{amountLabel(row.shares)}</td><td>{amountLabel(row.total)} {collateral}</td></tr>)}
      </tbody></table>}
    </TabPanel>
    {/* Both sides of a binary market, every answer of a field. This used to
        pass `focusOnly`, which drew exactly one line — so a head-to-head showed
        one team and eleven of twelve answers in an event showed nothing. The
        shape is decided by `chartShape`, once, not by this component. */}
    <TabPanel id="graph" idPrefix={prefix} active={tab === 'graph'} className="ch-topic-graph"><ProbabilityChart
      title={market.title}
      series={graph.series}
      unit={graph.unit}
      headline={chartHeadline(market, { selectedId: contract.id, nested, collateral })}
      legend={graph.shape === 'all-answers'}
      onSelect={(id) => { const item = market.outcomes.find(entry => entry.id === id); if (item) onSelect(item, answer) }}
      empty={emptyChart(graph.series)}
    /></TabPanel>
    <TabPanel id="activity" idPrefix={prefix} active={tab === 'activity'} className="ch-topic-activity">
      {/* A missing binding is not proof the market is unopened: it is also the
          state while venue configuration is still loading for a question that
          has traded for hours. Promise first-trade activation only when the
          market itself says it is still indicative. */}
      {!binding ? <div className="ch-market-empty"><strong>{market.status === 'indicative' ? 'Not opened on-chain yet.' : 'Market activity unavailable.'}</strong><span>{market.status === 'indicative' ? 'The first trade opens this question on-chain, and its receipts appear here.' : 'This question has no readable venue binding right now. Activity returns once the venue configuration loads.'}</span></div> : <OnchainActivity market={market} active={active && tab === 'activity'}/>}
    </TabPanel>
    <TabPanel id="info" idPrefix={prefix} active={tab === 'info'} className="ch-topic-info"><h4>Resolution</h4><p>{nested ? `Yes pays the settlement value assigned to ${outcome.label}. No pays the remainder of 1 ${collateral}. ` : ''}{market.rules}</p><p>{market.description}</p>{/* Branching copy on the venue family is allowed; reaching for a chain-specific
    field or importing an adapter is not. An absent binding gets neither venue's
    story rather than defaulting to the EVM one. */}
{!simulation && binding?.family === 'DREAMDEX' && <><h4>Open this market</h4><p>The operator creates this binary YES/NO DreamDEX question with {collateral}, confirms its on-chain receipt, then registers the event contract ID, oracle question ID, and exact trading window for this arena question. Once confirmed, this same ticket receives the live balance, orders, and chart—there is no separate trading UI.</p></>}
{!simulation && binding?.family === 'SOLANA' && <><h4>Open this market</h4><p>The first trader opens this question on Solana. The backend issues a one-time oracle-signed permit for that wallet and question; the wallet itself then signs the question creation, both guarded Manifest YES and NO book activations, and their refundable account rent, before the {collateral} order itself. Once opened, this same ticket receives the live books, balances, and chart—there is no separate trading UI.</p></>}<dl><div><dt>Closes</dt><dd>{new Date(market.closesAt).toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</dd></div><div><dt>Status</dt><dd>{market.status}</dd></div><div><dt>Settlement</dt><dd>Up to 1 {collateral} per share</dd></div></dl></TabPanel>
  </div>
}

function OnchainActivity({ market, active }: { market: ArenaMarket; active: boolean }) {
  const { rows, error, loading } = useVenueActivity(market, active)
  const binding = venueBinding(market)
  const scope = binding?.family === 'SOLANA' ? `${binding.rpcUrl}:${binding.marketId}` : ''
  const attempts = useAlerts().filter(record => scope && record.marketScope === scope).slice(0, 15)
  const setup = [
    ...(market.onchain?.creationTxHash ? [{ label: 'Market opened', hash: market.onchain.creationTxHash }] : []),
    ...(market.onchain?.sponsoredTransactions ?? []),
  ].reverse()
  // Derived from the venue so a Solana signature never links to a Somnia explorer.
  const explorerFor = (hash: string) => explorerTxUrl(venueBinding(market)?.explorer, hash)
  // Transaction signatures only. A wallet on one of these rows is rendered by
  // TraderIdentity, which is the app's one answer to "what is this address called".
  const short = (value: string) => shortAddress(value, 6, 4)
  return <div className="ch-onchain-activity">
    {attempts.length > 0 && <details open className="ch-setup-activity"><summary>Your recent transaction steps</summary><ol>{attempts.map(record => <li key={record.id}><div><strong>{record.title}</strong><span>{record.detail}</span></div><div><time>{new Date(record.at).toLocaleTimeString()}</time>{record.href && <a href={record.href} target="_blank" rel="noreferrer">View transaction <ExternalLink size={12}/></a>}</div></li>)}</ol></details>}
    <header><div><strong>Market activity</strong><span>Trades, placements and cancels · newest first</span></div></header>
    {loading && !rows.length ? <p className="sr-only" role="status">Loading market activity…</p> : error ? <p role="alert">{error}</p> : !rows.length ? <p>No indexed trades or orders yet.</p> : null}
    <ol aria-busy={loading}>{loading && !rows.length ? [0, 1, 2].map(row => <li key={row} aria-hidden="true"><div><span className="ev-sk ev-sk-line" style={{ width: `${58 - row * 12}%` }}/></div><div><span className="ev-sk ev-sk-line" style={{ width: 54 }}/></div></li>) : rows.slice(0, 40).map(row => <li key={row.id}><div><strong>{row.label}</strong><span>{row.detail}{row.owner ? <> · <TraderIdentity address={row.owner} avatar={false}/></> : ''}</span></div><div><time dateTime={new Date(row.at).toISOString()}>{new Date(row.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time><a href={explorerFor(row.hash)} target="_blank" rel="noreferrer" aria-label={`View ${row.label} transaction`}>{short(row.hash)} <ArrowUpRight size={12}/></a></div></li>)}</ol>
    {/* Solana bindings carry no setup receipts, so an unconditional drawer
        advertised an empty list on every question on that venue. */}
    {setup.length > 0 && <details className="ch-setup-activity"><summary>Market setup <span>{setup.length} receipts · newest first</span></summary><ol>{setup.map(transaction => <li key={transaction.hash}><span>{transaction.label}</span><a href={explorerFor(transaction.hash)} target="_blank" rel="noreferrer">{short(transaction.hash)} <ExternalLink size={12}/></a></li>)}</ol></details>}
    <p>Filled trades transfer shares. Placed orders are still waiting. Setup receipts do not represent purchases. Activity is read from confirmed transactions and may lag the wallet balance briefly.</p>
  </div>
}
