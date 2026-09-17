import { SolanaProfile } from './SolanaProfile'
import { encodeStored } from '../../../packages/prediction-core/serialization'
import { useEvmWallet, useSolanaWallet } from '../session/store'
import { useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, Search, WalletCards } from 'lucide-react'
import { AppShell } from '../solz/AppShell'
import { formatUnitsExact } from '../prediction/amounts'
import { MatchAvatar, matchLabel, matchStartedAt } from './matchIdentity'
import { PortfolioChart, chartMarket, type ChartMarket } from './PortfolioChart'
import { PortfolioSummary, type MarkedValue } from './PortfolioSummary'
import { isClosedPosition, marketLifecycle, positionState, type PositionState } from './model'
import { usePortfolio, type PortfolioMarket } from './usePortfolio'
import { PositionAction } from './PositionAction'
import { profileHref, sameProfileAddress, solanaNetwork, type ProfileRoute } from './profileRoute'
import { useSolanaVenue } from '../home/useSolanaVenue'
import { mergeQuestionCatalogue, questionTradeable, useReservedSolanaQuestions } from '../home/solanaQuestionMarkets'
import { solanaDeployment, useProfileAccounting } from './useProfileAccounting'
import { useSolanaPortfolio } from './useSolanaPortfolio'
import { activeSolanaRows, claimableSolanaRows, closedSolanaRows, markedValue, mergeSolanaActive, solanaCollateral, solanaEvents, solanaOrderRows, solanaPositionRows, solanaRowKickoff, solanaRowMatches, type SolanaIdentity } from './solanaRows'
import { SolanaActiveTable, SolanaPositionsTable } from './SolanaPositions'
import '../../styles/home.css'
import './portfolio.css'

type Props = { apiUrl: string; matchApiUrl?: string; profile?: ProfileRoute }
export function PortfolioApp({ apiUrl, matchApiUrl = '', profile }: Props) {
  return <Portfolio matchApiUrl={matchApiUrl} apiUrl={apiUrl} profile={profile}/>
}
type DreamOrder = NonNullable<PortfolioMarket['snapshot']['orders'][number]>
type Row = { id: string; entry: PortfolioMarket; outcome?: 0 | 1; quantity: bigint; state: PositionState; order?: DreamOrder }
/** One row per held outcome and one per resting order, because each order is
 *  cancelled on its own and a resting order is an active commitment. */
export function portfolioRows(markets: PortfolioMarket[]): Row[] {
  return markets.flatMap(entry => {
    const { snapshot: s, binding: b } = entry
    const rows: Row[] = ([0, 1] as const).flatMap(outcome => {
      const quantity = s.balances?.[outcome + 1] ?? 0n
      return quantity > 0n ? [{ id: `${b.marketId}:${outcome}`, entry, outcome, quantity, state: positionState(s.market, outcome, quantity, s.now, b.tradingStartsAt, b.tradingLocksAt) }] : []
    })
    for (const outcome of entry.historicalOutcomes ?? []) {
      if (!s.orders.length && !rows.some(row => row.outcome === outcome)) rows.push({ id: `${b.marketId}:${outcome}`, entry, outcome, quantity: 0n, state: 'Closed' })
    }
    if (!rows.length && entry.participated && !s.orders.length) rows.push({ id: `${b.marketId}:history`, entry, quantity: 0n, state: 'Closed' })
    for (const order of s.orders) {
      if (!order) continue
      const side = s.orderSides?.[order.orderId.toString()]
      rows.push({ id: `${b.marketId}:order:${order.orderId}`, entry, outcome: side ? (side.endsWith('YES') ? 0 : 1) : undefined, quantity: 0n, state: 'Orders', order })
    }
    return rows
  })
}
/** A resting order's limit and escrow, both denominated in the outcome the order
 *  is on. The indexer supplies the side; without it the raw pool price is always
 *  YES-denominated, so a NO order would be priced wrong and nothing is shown. */
function orderView(row: Row, decimals: number) {
  const side = row.entry.snapshot.orderSides?.[row.order!.orderId.toString()]
  if (!side) return { side: undefined, limit: undefined, escrow: undefined, buy: false }
  const scale = 10n ** BigInt(decimals)
  const limit = side.endsWith('NO') ? scale - row.order!.price : row.order!.price
  const buy = side.startsWith('BUY')
  return { side, limit, buy, escrow: buy ? row.order!.quantityRemaining * limit / scale : undefined }
}
const orderExpired = (row: Row) => {
  const { snapshot: s, binding: b } = row.entry
  return s.now >= b.tradingLocksAt || s.market.finalized || row.order!.expireTimestampNs <= BigInt(s.now) * 1_000_000n
}
export function Portfolio({ apiUrl, matchApiUrl = '', profile }: { apiUrl: string; matchApiUrl?: string; profile?: ProfileRoute }) {
  // PositionAction still takes the wallet as a prop: Portfolio has already
  // proven it non-null before rendering it, and narrowing is the point.
  const wallet = useEvmWallet()
  const solanaWallet = useSolanaWallet()
  const somniaRoute = profile?.chain === 'somnia'
  const initialChain = profile?.chain === 'somnia' && profile.network === 'mainnet' ? '5031' : '50312'
  const [chain, setChain] = useState<'50312' | '5031'>(initialChain)
  const [tab, setTab] = useState<'active' | 'closed'>('active')
  const [matchFilter, setMatchFilter] = useState('')
  const [sort, setSort] = useState('newest')
  const [search, setSearch] = useState('')
  const [retry, setRetry] = useState(0)
  const [copyStatus, setCopyStatus] = useState('')
  const [selection, setSelection] = useState<{ scope: string; id: string; outcome: 0 | 1 } | null>(null)
  // Solana reads the Manifest venue directly, so it has to be discovered before
  // the page can decide which venue a profile without a route is about.
  const solanaVenue = useSolanaVenue(apiUrl, !somniaRoute)
  // A route settles it. Without one the connected wallet does, and with no
  // wallet at all the configured venue does: reading the EVM wallet for a
  // Solana session is what left every trader here permanently empty.
  const solana = profile?.chain === 'solana'
    || (!somniaRoute && (Boolean(solanaWallet) || (!wallet && Boolean(solanaVenue))))
  const owner = profile?.address ?? (solana ? solanaWallet?.address : wallet?.address)
  const isSelf = solana
    ? sameProfileAddress(solanaWallet?.address, owner, 'solana')
    : Boolean(wallet && owner && sameProfileAddress(wallet.address, owner))
  // Owner detection is the same on both chains. What differs is where a trade is
  // signed: EVM signs in the side panel here, Solana signs on the question's own
  // market page, so its actions are links rather than buttons.
  const canManage = isSelf && !solana
  const data = usePortfolio(apiUrl, chain, solana ? undefined : owner, retry, matchApiUrl)

  // Both hook sets stay mounted; each idles on an empty owner or an empty API
  // base rather than being called conditionally.
  const { questions: questionViews, loaded: questionsLoaded } = useReservedSolanaQuestions(solana && owner ? apiUrl : '', solanaVenue)
  const live = useMemo(() => questionViews.map(view => view.question), [questionViews])
  // The live catalogue lists only what a permit can still reach. The prediction
  // API persists every question it ever published, per deployment, and returns
  // it here; that is what names a position whose match has already finished.
  // This read also registers the owner with the indexer that keeps the store up
  // to date, so the page has to make it even though it reads holdings itself.
  const accounting = useProfileAccounting(solana && owner ? apiUrl : '', owner, '', '', retry, '', solanaDeployment(solanaVenue))
  const questions = useMemo(() => mergeQuestionCatalogue(live, accounting.data?.questions), [live, accounting.data?.questions])
  // Naming a finished question must not widen the chain read: the books worth
  // polling are the tradeable ones plus whatever discovery finds for this owner.
  const tradeable = useMemo(() => questions.filter(questionTradeable), [questions])
  const sol = useSolanaPortfolio(solanaVenue, solana ? owner : undefined, tradeable, retry, true)
  const solDecimals = solanaVenue?.collateralDecimals ?? 6
  const solRows = useMemo(() => sol.portfolio ? solanaPositionRows(sol.portfolio, questions, solDecimals) : [], [sol.portfolio, questions, solDecimals])
  const solOrders = useMemo(() => sol.portfolio ? solanaOrderRows(sol.portfolio, questions) : [], [sol.portfolio, questions])
  const solFunds = useMemo(() => sol.portfolio ? solanaCollateral(sol.portfolio) : null, [sol.portfolio])
  const solChart = useMemo<ChartMarket[]>(() => sol.portfolio
    ? [{ decimals: solDecimals, now: sol.portfolio.now, historyError: sol.historyError, historyLimited: sol.historyLimited, cashFlows: sol.flows.map(flow => ({ ...flow, amount: flow.amount.toString() })) }]
    : [], [sol.portfolio, sol.flows, sol.historyError, sol.historyLimited, solDecimals])

  const scope = solana ? `solana:${owner}` : `${chain}:${owner?.toLowerCase()}`
  const rows = useMemo(() => portfolioRows(data.markets), [data.markets])
  // A resting order is active: it is escrow the trader can still act on, and
  // isClosedPosition('Orders') is false, so no filter has to name it.
  const dreamActive = rows.filter(row => !isClosedPosition(row.state))
  const dreamClosed = rows.filter(row => isClosedPosition(row.state))
  const dreamClaimable = rows.filter(row => row.state.startsWith('Claim'))
  const dreamOrders = rows.filter(row => row.state === 'Orders')
  const solActive = activeSolanaRows(solRows)
  const solClosed = closedSolanaRows(solRows)
  const solClaimable = claimableSolanaRows(solRows)
  const closedCount = solana ? solClosed.length : dreamClosed.length
  const claimableCount = solana ? solClaimable.length : dreamClaimable.length
  const orderRows = solana ? solOrders : dreamOrders
  const expiredOrders = solana ? solOrders.filter(row => row.expired).length : dreamOrders.filter(orderExpired).length
  const kickoff = (entry: PortfolioMarket) => matchStartedAt(entry.binding.eventId, entry.binding.tradingStartsAt, entry.metadata)
  const matches = [...new Map(data.markets.map(entry => [entry.binding.eventId, entry])).values()].sort((a, b) => kickoff(b) - kickoff(a))
  const filteredMarkets = data.markets.filter(entry => !matchFilter || entry.binding.eventId === matchFilter)
  const label = (entry: PortfolioMarket) => matchLabel(entry.binding.eventId, entry.binding.tradingStartsAt, entry.metadata)
  const visible = (tab === 'active' ? dreamActive : dreamClosed)
    .filter(row => (!matchFilter || row.entry.binding.eventId === matchFilter) && `${row.entry.binding.label} ${row.entry.binding.eventId} ${label(row.entry)}`.toLowerCase().includes(search.toLowerCase()))
    // Orders sort after the position they qualify, so a repeated number reads as
    // a breakdown of the row above rather than as a second holding.
    .sort((a, b) => (sort === 'name' ? a.entry.binding.label.localeCompare(b.entry.binding.label) : sort === 'oldest' ? kickoff(a.entry) - kickoff(b.entry) : kickoff(b.entry) - kickoff(a.entry)) || a.entry.binding.marketId.localeCompare(b.entry.binding.marketId) || (a.order ? 1 : 0) - (b.order ? 1 : 0))
  const dreamBid = (row: Row) => row.outcome === 0 ? row.entry.snapshot.book?.yesBids[0]?.price : row.entry.snapshot.book?.noBids[0]?.price

  // Solana rows carry their own identity, so the same filter, search and sort
  // are applied to that rather than to a DreamDEX binding.
  const solEvents = solanaEvents([...solRows, ...solOrders], questions)
  const solMatch = <T extends { identity: SolanaIdentity }>(list: readonly T[]) => list
    .filter(row => solanaRowMatches(row.identity, matchFilter, search))
    .sort((a, b) => sort === 'name'
      ? a.identity.label.localeCompare(b.identity.label)
      : sort === 'oldest' ? solanaRowKickoff(a.identity) - solanaRowKickoff(b.identity) : solanaRowKickoff(b.identity) - solanaRowKickoff(a.identity))
  const solVisibleActive = mergeSolanaActive(solMatch(solActive), solMatch(solOrders))
  const solVisibleClosed = solMatch(solClosed)
  const activeCount = solana ? solActive.length + solOrders.length : dreamActive.length
  // Only questions that actually produced a row: a leftover empty claim account
  // is discovered too, and announcing it would point at nothing.
  const unlisted = new Set([...solRows, ...solOrders].filter(row => !row.identity.listed).map(row => row.identity.marketId)).size

  const selected = selection?.scope === scope ? rows.find(row => row.id === selection.id) : undefined
  const incomplete = solana
    ? (sol.portfolio?.failures ?? 0) > 0 || sol.historyLimited || sol.historyError
    : data.failures > 0 || data.markets.some(m => m.historyError || m.historyLimited)
  const symbol = solana ? (solanaVenue?.collateralSymbol ?? 'USDC') : chain === '50312' ? 'tUSDC' : 'USDso'
  // Somnia mainnet settles in 18dp USDso, so the EVM scale is read from the
  // markets rather than assumed; `mixed` below still guards a genuinely
  // heterogeneous set.
  const decimals = solana ? solDecimals : data.markets[0]?.snapshot.market.decimals ?? 6
  const loading = solana ? sol.loading || sol.historyLoading || (!questionsLoaded && !sol.portfolio) : data.loading
  // Balances are all the summary needs. The executed-fill scan behind the chart
  // runs for tens of seconds, and gating the stats on it blanked the card while
  // the table beside it was already showing rows.
  const balancesLoading = solana ? sol.loading || (!questionsLoaded && !sol.portfolio) : data.loading
  const error = solana ? sol.error : data.error
  const ready = Boolean(owner) && !balancesLoading && !error
  const networkLabel = solanaVenue?.label ?? 'Solana'
  // The network, the collateral symbol and whether this page is somebody else's
  // are stated here and nowhere else on the page.
  const meta = !owner ? (solana ? 'Connect your Solana wallet to load your positions.' : 'Connect your wallet to load your positions.')
    : [solana ? networkLabel : chain === '50312' ? 'Somnia testnet' : 'Somnia mainnet', symbol, ...(isSelf ? [] : ['read-only']), ...(!solana && chain === '50312' ? ['no real value'] : [])].join(' · ')
  // Positions marked at the best bid. An order is never added: on Solana a
  // resting ask's shares are already inside its position's quantity, and on
  // either chain a resting bid owns no shares yet.
  const evmMarked = (): MarkedValue => {
    let total = 0n, unpriced = 0, priced = 0, mixed = false
    for (const row of dreamActive) {
      if (row.order || row.state !== 'Trading' || row.quantity === 0n || row.outcome === undefined) continue
      const bid = dreamBid(row)
      if (row.entry.snapshot.market.decimals !== decimals) mixed = true
      if (bid === undefined) unpriced++
      else { priced++; total += row.quantity * bid / 10n ** BigInt(row.entry.snapshot.market.decimals) }
    }
    return { total: unpriced || mixed ? undefined : total, unpriced, priced, mixed }
  }
  const value = solana ? markedValue(solActive) : evmMarked()
  // A profile URL names a cluster; the configured venue is the only one this
  // page can read. Say so rather than rendering another cluster's empty page.
  const wrongNetwork = Boolean(solana && profile && solanaVenue && solanaNetwork(solanaVenue.chainId) && solanaNetwork(solanaVenue.chainId) !== profile.network)

  useEffect(() => {
    if (profile) return
    if (solanaWallet) window.location.replace(profileHref('solana', solanaNetwork(solanaVenue?.chainId) ?? 'devnet', solanaWallet.address))
    else if (wallet) window.location.replace(profileHref('somnia', 'testnet', wallet.address))
  }, [profile, wallet, solanaWallet, solanaVenue?.chainId])

  useEffect(() => {
    if (profile?.chain === 'somnia') setChain(profile.network === 'mainnet' ? '5031' : '50312')
  }, [profile])

  const selectNetwork = (next: '50312' | '5031') => {
    setChain(next); setSelection(null); setMatchFilter('')
    if (profile?.chain === 'somnia') window.location.assign(profileHref('somnia', next === '5031' ? 'mainnet' : 'testnet', profile.address))
  }
  if (solana) return <SolanaProfile apiUrl={apiUrl} venue={solanaVenue} owner={owner} isSelf={isSelf} network={profile?.network} questions={questions} sol={sol} onRefresh={() => setRetry(n => n + 1)}/>
  return <AppShell className="solz-home pf-page" mainId="portfolio" mainClassName="pf-main" active="profile" skipTo="#portfolio" skipLabel="Skip to portfolio" backToTopHref="#portfolio">
      <div className="pf-heading"><h1 className="sz-page-title">{isSelf ? 'My portfolio' : 'Portfolio'}</h1>{!solana && <label className="pf-network">Network<select value={chain} onChange={e => selectNetwork(e.target.value as typeof chain)}><option value="50312">Somnia testnet · tUSDC</option><option value="5031">Somnia mainnet · USDso</option></select></label>}</div>
      <div className="pf-hero">
        <PortfolioSummary owner={owner} meta={meta} value={value} claimable={claimableCount} orders={{ total: orderRows.length, expired: expiredOrders }} collateral={solana ? solFunds : null} decimals={decimals} symbol={symbol} ready={ready} copyStatus={copyStatus} refreshing={balancesLoading || !owner}
          onCopy={() => void navigator.clipboard.writeText(owner!).then(() => setCopyStatus('Address copied')).catch(() => setCopyStatus('Could not copy address'))}
          onRefresh={() => { setSelection(null); setRetry(n => n + 1) }}/>
        <PortfolioChart markets={solana ? solChart : filteredMarkets.map(chartMarket)} loading={loading} connected={!!owner} symbol={symbol} unavailable={!!error || (solana ? false : data.failures > 0)}/>
      </div>
      {canManage && dreamClaimable.length > 0 && <div className="pf-claim-banner"><div><strong>{dreamClaimable.length} {dreamClaimable.length === 1 ? 'position is' : 'positions are'} ready to claim</strong><p>Your resolved payouts are waiting in Active positions.</p></div><button onClick={() => { setTab('active'); setSearch(''); setMatchFilter(''); const row = dreamClaimable[0]!; setSelection({ scope, id: row.id, outcome: row.outcome! }) }}>Review claim <ArrowUpRight size={16}/></button></div>}
      <div className="pf-toolbar">
        <div className="pf-tabs" aria-label="Position status">{(['active', 'closed'] as const).map(value => <button key={value} aria-pressed={tab === value} className={tab === value ? 'is-selected' : ''} onClick={() => setTab(value)}>{value === 'active' ? 'Active' : 'Closed'} <span>{ready ? (value === 'active' ? activeCount : closedCount) : '—'}</span></button>)}</div>
        <label className="pf-search"><Search size={16}/><input aria-label="Search positions" placeholder={solana ? 'Search questions or events' : 'Search markets or matches'} value={search} onChange={e => setSearch(e.target.value)}/></label>
        <select aria-label={solana ? 'Filter by event' : 'Filter by match'} value={matchFilter} onChange={e => { setMatchFilter(e.target.value); setSelection(null) }}><option value="">{solana ? 'All events' : 'All matches'}</option>{solana
          ? solEvents.map(event => <option value={event.eventId} key={event.eventId}>{matchLabel(event.eventId, event.startedAt)}</option>)
          : matches.map(entry => <option value={entry.binding.eventId} key={entry.binding.eventId}>{label(entry)}</option>)}</select>
        <select aria-label="Sort positions" value={sort} onChange={e => setSort(e.target.value)}><option value="newest">Newest {solana ? 'event' : 'match'}</option><option value="oldest">Oldest {solana ? 'event' : 'match'}</option><option value="name">{solana ? 'Question' : 'Market name'} A–Z</option></select>
      </div>
      {tab === 'active' && expiredOrders > 0 && <p className="pf-notice" role="status">{expiredOrders === 1 ? 'One resting order can no longer fill' : `${expiredOrders} resting orders can no longer fill`}, but {expiredOrders === 1 ? 'its' : 'their'} escrow stays reserved until cancelled. This is not a winning payout.</p>}
      {solana && unlisted > 0 && <p className="pf-notice" role="status">{unlisted === 1 ? 'One question is' : `${unlisted} questions are`} no longer listed in the live catalogue. They are still read from your claim accounts so a settled payout is never hidden.</p>}
      {wrongNetwork && <p className="pf-notice" role="status">This profile URL names {profile!.network}, but the configured venue is {networkLabel}. The positions below are read from the configured venue.</p>}
      {error && owner && <p className="pf-error" role="alert">{error} Use Refresh to try again.</p>}
      {incomplete && owner && !error && <p className="pf-notice" role="status">{solana ? 'Some on-chain reads or executed-trade history are incomplete. Counts and the chart may be partial; refresh to retry.' : 'Some market reads or historical records are unavailable or incomplete. Counts may be incomplete; refresh to retry.'}</p>}
      <div className={`pf-content ${selected ? 'has-action' : ''}`}>
        <section className="pf-list" aria-label={`${tab} positions`} aria-busy={loading}>
          {!owner ? <div className="pf-empty"><WalletCards size={32}/><h2>Make this portfolio yours.</h2><p>Connect in the header with the wallet you used to trade. Your active positions, closed history, and available claims will appear here.</p></div>
            : loading && !(solana ? sol.portfolio : data.markets.length) ? <div className="pf-loading" role="status">Loading on-chain positions…<div/><div/><div/></div>
            : error ? <div className="pf-empty"><h2>Portfolio temporarily unavailable</h2><p>We couldn’t load these positions. No empty balance has been assumed.</p></div>
            : solana
              ? (tab === 'active' ? solVisibleActive.length : solVisibleClosed.length) === 0
                ? <div className="pf-empty"><h2>{search ? 'No matching positions' : tab === 'active' ? 'No open positions yet' : 'No closed positions yet'}</h2><p>{search ? 'Try another question or event id.' : tab === 'active' ? 'Shares you hold and orders you leave resting on a book appear here once you trade.' : 'Questions you have fully exited or lost appear here.'}</p><a href="/markets">Explore the markets <ArrowUpRight size={15}/></a></div>
                : tab === 'active' ? <SolanaActiveTable rows={solVisibleActive} decimals={decimals} symbol={symbol} manage={isSelf}/> : <SolanaPositionsTable rows={solVisibleClosed} decimals={decimals} symbol={symbol}/>
            : visible.length === 0 ? <div className="pf-empty"><h2>{search ? 'No matching positions' : incomplete ? 'No positions in the available records' : tab === 'active' ? 'No active positions yet' : 'No closed positions yet'}</h2><p>{search ? 'Try another market name or match ID.' : tab === 'active' ? 'Holdings, unclaimed winnings and resting orders appear here after trading.' : 'Fully exited markets and losing settled positions appear here.'}</p><a href="/">Explore the arena <ArrowUpRight size={15}/></a></div>
            : <div className="pf-table-scroll"><table className="pf-list-actions">
              <thead><tr><th>Market / outcome</th><th>Shares</th><th>Price ({symbol})</th><th>Value ({symbol})</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>{visible.map(row => {
                const s = row.entry.snapshot, b = row.entry.binding
                const view = row.order ? orderView(row, s.market.decimals) : null
                const expired = row.order ? orderExpired(row) : false
                const bid = dreamBid(row)
                return <tr key={row.id} className={row.order ? 'is-order' : ''}>
                  <td><div className="pf-market-identity"><MatchAvatar id={b.eventId}/><div><div className="pf-row-title"><strong>{b.label}</strong>{row.outcome !== undefined && <span className={row.outcome === 0 ? 'pf-chip pf-yes' : 'pf-chip pf-no'}>{row.outcome === 0 ? 'YES' : 'NO'}</span>}</div><small title={b.eventId}>{label(row.entry)} · {marketLifecycle(s.market, s.now, b.tradingLocksAt)}{row.entry.metadata?.status ? ` · ${row.entry.metadata.status}` : ''}</small></div></div></td>
                  {row.order
                    ? <><td>{formatUnitsExact(row.order.quantityRemaining, s.market.decimals, 6)}<small>{view!.side ? (view!.buy ? 'if it fills' : 'escrowed by the pool') : 'unfilled size'}</small></td>
                      <td>{view!.limit === undefined ? '—' : formatUnitsExact(view!.limit, s.market.decimals, 6)}<small>{view!.side ? 'Limit' : 'Order side syncing'}</small></td>
                      <td>{view!.escrow !== undefined ? <>{formatUnitsExact(view!.escrow, s.market.decimals, 6)}<small>escrowed</small></> : view!.side ? <>—<small>shares escrowed</small></> : '—'}</td>
                      <td>{view!.side ? <><span className={view!.buy ? 'pf-yes' : 'pf-no'}>{view!.side.split('_')[0]}</span> order</> : 'Order'}<small>{expired ? 'Expired · escrow still reserved' : view!.side ? 'Resting' : 'Resting · side syncing'}</small></td></>
                    : <><td>{formatUnitsExact(row.quantity, s.market.decimals, 6)}</td>
                      <td>{bid === undefined ? '—' : formatUnitsExact(bid, s.market.decimals, 6)}</td>
                      <td>{bid === undefined || row.quantity === 0n ? '—' : formatUnitsExact(row.quantity * bid / 10n ** BigInt(s.market.decimals), s.market.decimals, 6)}</td>
                      <td><span className={row.state.startsWith('Claim') ? 'pf-yes' : ''}>{row.state}</span></td></>}
                  <td>{canManage && (row.state === 'Trading' || row.state.startsWith('Claim') || row.state === 'Orders') && <button className={row.state === 'Trading' ? 'pf-sell' : row.state.startsWith('Claim') ? 'pf-primary' : ''} onClick={() => setSelection({ scope, id: row.id, outcome: row.outcome ?? 0 })}>{row.state === 'Trading' ? 'Sell' : row.state.startsWith('Claim') ? 'Claim' : expired ? 'Release escrow' : 'Manage orders'}</button>}</td>
                </tr>
              })}</tbody>
            </table></div>}
        </section>
        {selected && wallet && canManage && selection && (
          <PositionAction ordersOnly={selected.state === 'Orders'} key={`${scope}:${selected.id}`} entry={encodeStored(selected.entry)} outcome={selection.outcome} wallet={wallet} onClose={() => setSelection(null)}/>
        )}
      </div>
      <p className="pf-footnote">{solana
        ? 'Holdings are read from the chain across every configured question: shares on the venue seat, shares reserved by your resting orders, claim tokens in your wallet, and complete sets held in the prediction vault. Shares are marked at the best bid, which is not a guaranteed sale price. Selling, cancelling an order and claiming a settled payout all need your wallet signature, so on your own profile each row links to the question’s market page where it is signed.'
        : 'Holdings are read from the chain across configured DreamDEX events. Shares are marked at the best bid, which is not a guaranteed sale price, and shares reserved by an open order have left your balance until it is cancelled. Selling depends on buyers and market cutoff; claims require confirmed settlement and your wallet signature.'}</p>
  </AppShell>
}
