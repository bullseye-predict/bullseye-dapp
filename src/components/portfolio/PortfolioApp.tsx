import { encodeStored } from '../../../packages/prediction-core/serialization'
import { useEvmWallet, useSolanaWallet } from '../session/store'
import { MatchAvatar, matchLabel, matchStartedAt } from './matchIdentity'
import { PortfolioChart, chartMarket, type ChartMarket } from './PortfolioChart'
import { marketLifecycle } from './model'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowUpRight, Copy, RefreshCw, Search, WalletCards } from 'lucide-react'
import { DynamicSolanaSession } from '../arena/DynamicSolanaSession'
import { AppShell } from '../solz/AppShell'
import { formatUnitsExact } from '../prediction/amounts'
import { usePortfolio, type PortfolioMarket } from './usePortfolio'
import { isClosedPosition, positionState, type PositionState } from './model'
import { PositionAction } from './PositionAction'
import { profileHref, sameProfileAddress, solanaNetwork, type ProfileRoute } from './profileRoute'
import { useSolanaVenue } from '../home/useSolanaVenue'
import { useReservedSolanaQuestions } from '../home/solanaQuestionMarkets'
import { useSolanaPortfolio } from './useSolanaPortfolio'
import { activeSolanaRows, claimableSolanaRows, closedSolanaRows, solanaCollateral, solanaEvents, solanaOrderRows, solanaPositionRows, solanaRowKickoff, solanaRowMatches, type SolanaIdentity } from './solanaRows'
import { SolanaOrdersTable, SolanaPositionsTable } from './SolanaPositions'
import '../../styles/home.css'
import './portfolio.css'

type Props = { environmentId: string; apiUrl: string; matchApiUrl?: string; profile?: ProfileRoute }
export function PortfolioApp({ environmentId, apiUrl, matchApiUrl = '', profile }: Props) {
  return <DynamicSolanaSession environmentId={environmentId} predictionApiUrl={apiUrl}>{session => <Portfolio matchApiUrl={matchApiUrl} apiUrl={apiUrl} walletControl={session.walletControl} profile={profile}/>}</DynamicSolanaSession>
}
type Row = { id: string; entry: PortfolioMarket; outcome?: 0 | 1; quantity: bigint; state: PositionState }
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
    if (s.orders.length) rows.push({ id: `${b.marketId}:orders`, entry, quantity: 0n, state: 'Orders' })
    return rows
  })
}
export function Portfolio({ apiUrl, walletControl, matchApiUrl = '', profile }: { apiUrl: string; matchApiUrl?: string; walletControl: ReactNode; profile?: ProfileRoute }) {
  // PositionAction still takes the wallet as a prop: Portfolio has already
  // proven it non-null before rendering it, and narrowing is the point.
  const wallet = useEvmWallet()
  const solanaWallet = useSolanaWallet()
  const somniaRoute = profile?.chain === 'somnia'
  const initialChain = profile?.chain === 'somnia' && profile.network === 'mainnet' ? '5031' : '50312'
  const [chain, setChain] = useState<'50312' | '5031'>(initialChain)
  const [tab, setTab] = useState<'active' | 'closed' | 'orders'>('active')
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
  const canManage = isSelf && !solana
  const data = usePortfolio(apiUrl, chain, solana ? undefined : owner, retry, matchApiUrl)

  // Both hook sets stay mounted; each idles on an empty owner or an empty API
  // base rather than being called conditionally.
  const { questions: questionViews, loaded: questionsLoaded } = useReservedSolanaQuestions(solana && owner ? apiUrl : '', solanaVenue)
  const questions = useMemo(() => questionViews.map(view => view.question), [questionViews])
  const sol = useSolanaPortfolio(solanaVenue, solana ? owner : undefined, questions, retry)
  const solDecimals = solanaVenue?.collateralDecimals ?? 6
  const solRows = useMemo(() => sol.portfolio ? solanaPositionRows(sol.portfolio, questions, solDecimals) : [], [sol.portfolio, questions, solDecimals])
  const solOrders = useMemo(() => sol.portfolio ? solanaOrderRows(sol.portfolio, questions) : [], [sol.portfolio, questions])
  const solFunds = useMemo(() => sol.portfolio ? solanaCollateral(sol.portfolio) : null, [sol.portfolio])
  const solChart = useMemo<ChartMarket[]>(() => sol.portfolio
    ? [{ decimals: solDecimals, now: sol.portfolio.now, historyError: sol.historyError, historyLimited: sol.historyLimited, cashFlows: sol.flows.map(flow => ({ ...flow, amount: flow.amount.toString() })) }]
    : [], [sol.portfolio, sol.flows, sol.historyError, sol.historyLimited, solDecimals])

  const scope = solana ? `solana:${owner}` : `${chain}:${owner?.toLowerCase()}`
  const rows = useMemo(() => portfolioRows(data.markets), [data.markets])
  const dreamActive = rows.filter(row => row.state !== 'Orders' && !isClosedPosition(row.state))
  const dreamClosed = rows.filter(row => isClosedPosition(row.state))
  const dreamClaimable = rows.filter(row => row.state.startsWith('Claim'))
  const orders = rows.filter(row => row.state === 'Orders')
  const solActive = activeSolanaRows(solRows)
  const solClosed = closedSolanaRows(solRows)
  const solClaimable = claimableSolanaRows(solRows)
  const activeCount = solana ? solActive.length : dreamActive.length
  const closedCount = solana ? solClosed.length : dreamClosed.length
  const claimableCount = solana ? solClaimable.length : dreamClaimable.length
  const orderCount = solana ? solOrders.length : orders.reduce((n, row) => n + row.entry.snapshot.orders.length, 0)
  const kickoff = (entry: PortfolioMarket) => matchStartedAt(entry.binding.eventId, entry.binding.tradingStartsAt, entry.metadata)
  const matches = [...new Map(data.markets.map(entry => [entry.binding.eventId, entry])).values()].sort((a, b) => kickoff(b) - kickoff(a))
  const filteredMarkets = data.markets.filter(entry => !matchFilter || entry.binding.eventId === matchFilter)
  const label = (entry: PortfolioMarket) => matchLabel(entry.binding.eventId, entry.binding.tradingStartsAt, entry.metadata)
  const visible = (tab === 'active' ? dreamActive : tab === 'closed' ? dreamClosed : orders).filter(row => (!matchFilter || row.entry.binding.eventId === matchFilter) && `${row.entry.binding.label} ${row.entry.binding.eventId} ${label(row.entry)}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => sort === 'name' ? a.entry.binding.label.localeCompare(b.entry.binding.label) : sort === 'oldest' ? kickoff(a.entry) - kickoff(b.entry) : kickoff(b.entry) - kickoff(a.entry))

  // Solana rows carry their own identity, so the same filter, search and sort
  // are applied to that rather than to a DreamDEX binding.
  const solEvents = solanaEvents([...solRows, ...solOrders], questions)
  const solMatch = <T extends { identity: SolanaIdentity }>(list: readonly T[]) => list
    .filter(row => solanaRowMatches(row.identity, matchFilter, search))
    .sort((a, b) => sort === 'name'
      ? a.identity.label.localeCompare(b.identity.label)
      : sort === 'oldest' ? solanaRowKickoff(a.identity) - solanaRowKickoff(b.identity) : solanaRowKickoff(b.identity) - solanaRowKickoff(a.identity))
  const solVisible = solMatch(tab === 'active' ? solActive : tab === 'closed' ? solClosed : [])
  const solVisibleOrders = solMatch(solOrders)
  // Only questions that actually produced a row: a leftover empty claim account
  // is discovered too, and announcing it would point at nothing.
  const unlisted = new Set([...solRows, ...solOrders].filter(row => !row.identity.listed).map(row => row.identity.marketId)).size

  const selected = selection?.scope === scope ? rows.find(row => row.id === selection.id) : undefined
  const incomplete = solana
    ? (sol.portfolio?.failures ?? 0) > 0 || sol.historyLimited || sol.historyError
    : data.failures > 0 || data.markets.some(m => m.historyError || m.historyLimited)
  const symbol = solana ? (solanaVenue?.collateralSymbol ?? 'USDC') : chain === '50312' ? 'tUSDC' : 'USDso'
  const decimals = solana ? solDecimals : 6
  const loading = solana ? sol.loading || sol.historyLoading || (!questionsLoaded && !sol.portfolio) : data.loading
  const error = solana ? sol.error : data.error
  const displayName = owner ? `${owner.slice(0, 6)}…${owner.slice(-4)}` : 'Your predictions, together.'
  const networkLabel = solanaVenue?.label ?? 'Solana'
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
  return <AppShell className="solz-home pf-page" active="profile" walletControl={walletControl} skipTo="#portfolio" skipLabel="Skip to portfolio" backToTopHref="#portfolio">
    <main id="portfolio" className="pf-main">
      <div className="pf-heading"><div><p>{isSelf ? 'YOUR PROFILE' : owner ? 'PUBLIC PROFILE' : 'YOUR ACCOUNT'}</p><h1>{isSelf ? 'My portfolio' : 'Portfolio'}<span>↗</span></h1></div>{solana
        ? <p className="pf-network pf-network-static">Network<b>{networkLabel} · {symbol}</b></p>
        : <label className="pf-network">Network<select value={chain} onChange={e => selectNetwork(e.target.value as typeof chain)}><option value="50312">Somnia testnet · tUSDC</option><option value="5031">Somnia mainnet · USDso</option></select></label>}</div>
      <section className="pf-overview" aria-label="Account overview">
        <div className="pf-identity"><div className="pf-avatar"><WalletCards size={26}/></div><div><h2>{displayName}</h2><p>{solana ? (isSelf ? `Connected wallet · ${networkLabel}` : owner ? `Public ${networkLabel} prediction profile · read-only` : 'Connect your Solana wallet to view your positions.') : isSelf ? 'Connected wallet · DreamDEX predictions' : owner ? 'Public Somnia prediction profile · read-only' : 'Connect your wallet to view and manage your positions.'}</p>{owner && <button className="pf-copy" onClick={() => void navigator.clipboard.writeText(owner).then(() => setCopyStatus('Address copied')).catch(() => setCopyStatus('Could not copy address'))}><Copy size={13}/>Copy address</button>}<span role="status">{copyStatus}</span></div></div>
        <dl className="pf-stats"><div><dt>Active positions</dt><dd>{owner && !loading && !error ? activeCount : '—'}</dd></div><div><dt>Ready to claim</dt><dd className="pf-yes">{owner && !loading && !error && (canManage || solana) ? claimableCount : '—'}</dd></div><div><dt>Closed positions</dt><dd>{owner && !loading && !error ? closedCount : '—'}</dd></div></dl>
      </section>
      {solana && solFunds && owner && !error && <dl className="pf-stats pf-funds" aria-label="Collateral">
        <div><dt>In your wallet</dt><dd>{formatUnitsExact(solFunds.wallet, decimals, 2)} <span>{symbol}</span></dd></div>
        <div><dt>On venue seats</dt><dd>{formatUnitsExact(solFunds.seat, decimals, 2)} <span>{symbol}</span></dd></div>
        <div><dt>Reserved in buy orders</dt><dd>{formatUnitsExact(solFunds.reserved, decimals, 2)} <span>{symbol}</span></dd></div>
        <div><dt>In the prediction vault</dt><dd>{formatUnitsExact(solFunds.vault, decimals, 2)} <span>{symbol}</span></dd></div>
      </dl>}
      <div className="pf-caption"><span>{solana ? `${networkLabel} balances · read from the chain` : chain === '50312' ? 'Testnet balances · no real monetary value' : 'Mainnet balances · USDso'} · Networks are shown separately.</span><span>{solana ? 'Shares are marked at the best bid, which is not a guaranteed sale price.' : 'Average entry & P&L unavailable until complete cost history is indexed.'}</span></div>
      <PortfolioChart markets={solana ? solChart : filteredMarkets.map(chartMarket)} loading={loading} connected={!!owner} symbol={symbol} unavailable={!!error || (solana ? false : data.failures > 0)}/>
      {canManage && dreamClaimable.length > 0 && <div className="pf-claim-banner"><div><strong>{dreamClaimable.length} {dreamClaimable.length === 1 ? 'position is' : 'positions are'} ready to claim</strong><p>Your resolved payouts are waiting in Active positions.</p></div><button onClick={() => { setTab('active'); setSearch(''); setMatchFilter(''); const row = dreamClaimable[0]!; setSelection({ scope, id: row.id, outcome: row.outcome! }) }}>Review claim <ArrowUpRight size={16}/></button></div>}
      {solana && isSelf && solClaimable.length > 0 && <div className="pf-claim-banner"><div><strong>{solClaimable.length} {solClaimable.length === 1 ? 'position is' : 'positions are'} ready to claim</strong><p>Settled payouts are claimed from the question’s own market page, where your wallet can sign.</p></div></div>}
      <div className="pf-section-heading"><h2>Positions</h2><button className="pf-refresh" disabled={loading || !owner} onClick={() => { setSelection(null); setRetry(n => n + 1) }}><RefreshCw size={14}/>Refresh</button></div>
      <div className="pf-toolbar"><div className="pf-tabs" aria-label="Position status">{(['active', 'closed', 'orders'] as const).map(value => <button key={value} aria-pressed={tab === value} className={tab === value ? 'is-selected' : ''} onClick={() => setTab(value)}>{value === 'active' ? 'Active' : value === 'closed' ? 'Closed' : 'Orders'} <span>{owner && !loading && !error ? (value === 'active' ? activeCount : value === 'closed' ? closedCount : orderCount) : '—'}</span></button>)}</div><label className="pf-search"><Search size={17}/><input aria-label="Search positions" placeholder={solana ? 'Search questions or events' : 'Search markets or matches'} value={search} onChange={e => setSearch(e.target.value)}/></label></div>
      <div className="pf-filters"><label>{solana ? 'Event' : 'Match'}<select value={matchFilter} onChange={e => { setMatchFilter(e.target.value); setSelection(null) }}><option value="">{solana ? 'All events' : 'All matches'}</option>{solana
        ? solEvents.map(event => <option value={event.eventId} key={event.eventId}>{matchLabel(event.eventId, event.startedAt)}</option>)
        : matches.map(entry => <option value={entry.binding.eventId} key={entry.binding.eventId}>{label(entry)}</option>)}</select></label><label>Sort<select value={sort} onChange={e => setSort(e.target.value)}><option value="newest">Newest {solana ? 'event' : 'match'}</option><option value="oldest">Oldest {solana ? 'event' : 'match'}</option><option value="name">{solana ? 'Question' : 'Market name'} A–Z</option></select></label></div>
      {tab === 'orders' && <p className="pf-notice">Orders are separate from positions. {solana ? 'A resting order holds its collateral or shares on the venue until it fills or is cancelled from the market page.' : 'Expired orders cannot fill, but their remaining escrow must be released with a wallet transaction. This is not a winning payout.'}</p>}
      {solana && unlisted > 0 && <p className="pf-notice" role="status">{unlisted === 1 ? 'One question is' : `${unlisted} questions are`} no longer listed in the live catalogue. They are still read from your claim accounts so a settled payout is never hidden.</p>}
      {wrongNetwork && <p className="pf-notice" role="status">This profile URL names {profile!.network}, but the configured venue is {networkLabel}. The positions below are read from the configured venue.</p>}
      {error && owner && <p className="pf-error" role="alert">{error} Use Refresh to try again.</p>}
      {incomplete && owner && !error && <p className="pf-notice" role="status">{solana ? 'Some on-chain reads or executed-trade history are incomplete. Counts and the chart may be partial; refresh to retry.' : 'Some market reads or historical records are unavailable or incomplete. Counts may be incomplete; refresh to retry.'}</p>}
      <div className={`pf-content ${selected ? 'has-action' : ''}`}>
        <section className="pf-list" aria-label={`${tab} positions`} aria-busy={loading}>
          {!owner ? <div className="pf-empty"><WalletCards size={32}/><h2>Make this portfolio yours.</h2><p>Log in with the wallet you used to trade. Your active positions, closed history, and available claims will appear here.</p>{walletControl}</div>
            : loading && !(solana ? sol.portfolio : data.markets.length) ? <div className="pf-loading" role="status">Loading on-chain positions…<div/><div/><div/></div>
            : error ? <div className="pf-empty"><h2>Portfolio temporarily unavailable</h2><p>We couldn’t load these positions. No empty balance has been assumed.</p></div>
            : solana
              ? (tab === 'orders' ? solVisibleOrders.length : solVisible.length) === 0
                ? <div className="pf-empty"><h2>{search ? 'No matching positions' : tab === 'active' ? 'No open positions yet' : tab === 'orders' ? 'No resting orders' : 'No closed positions yet'}</h2><p>{search ? 'Try another question or event id.' : tab === 'active' ? 'Shares you hold, on the venue or in your wallet, appear here once you trade.' : tab === 'orders' ? 'Limit orders you leave on a book appear here while they rest.' : 'Questions you have fully exited or lost appear here.'}</p><a href="/markets">Explore the markets <ArrowUpRight size={15}/></a></div>
                : tab === 'orders' ? <SolanaOrdersTable rows={solVisibleOrders} decimals={decimals} symbol={symbol}/> : <SolanaPositionsTable rows={solVisible} decimals={decimals} symbol={symbol}/>
            : visible.length === 0 ? <div className="pf-empty"><h2>{search ? 'No matching positions' : incomplete ? 'No positions in the available records' : tab === 'active' ? 'No active positions yet' : tab === 'orders' ? 'No remaining orders' : 'No closed positions yet'}</h2><p>{search ? 'Try another market name or match ID.' : tab === 'active' ? 'Holdings and unclaimed winnings appear here after trading.' : 'Fully exited markets and losing settled positions appear here.'}</p><a href="/">Explore the arena <ArrowUpRight size={15}/></a></div> : <div className="pf-table-scroll"><table><thead><tr><th>Market / outcome</th><th>{tab === 'orders' ? 'Remaining orders' : 'Shares'}</th><th>Status</th><th>Best bid</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{visible.map(row => {
            const s = row.entry.snapshot, b = row.entry.binding
            const bid = row.outcome === 0 ? s.book?.yesBids[0]?.price : s.book?.noBids[0]?.price
            return <tr key={row.id}><td><div className="pf-market-identity"><MatchAvatar id={b.eventId}/><div><strong>{b.label}</strong><small title={b.eventId}>{label(row.entry)}</small></div></div><details className="pf-match-details"><summary>Match details</summary><code>{b.eventId}</code><small>{new Date(kickoff(row.entry)).toLocaleString()} · {marketLifecycle(s.market, s.now, b.tradingLocksAt)}</small>{row.entry.metadata?.status && <small>Game: {row.entry.metadata.status}</small>}</details>{row.outcome !== undefined && <span className={row.outcome === 0 ? 'pf-outcome pf-yes' : 'pf-outcome pf-no'}>{row.outcome === 0 ? 'YES' : 'NO'}</span>}</td><td>{row.state === 'Orders' ? s.orders.length : formatUnitsExact(row.quantity, s.market.decimals, 6)}</td><td><span className={row.state.startsWith('Claim') ? 'pf-yes' : ''}>{row.state === 'Orders' ? (s.now >= b.tradingLocksAt || s.market.finalized ? 'Expired · funds reserved' : 'Resting orders') : row.state}<small>{marketLifecycle(s.market, s.now, b.tradingLocksAt)}</small></span></td><td>{row.state === 'Trading' && bid !== undefined ? `${formatUnitsExact(bid, s.market.decimals, 6)} ${symbol}` : '—'}</td><td>{canManage && (row.state === 'Trading' || row.state.startsWith('Claim') || row.state === 'Orders') && <button className={row.state === 'Trading' ? 'pf-sell' : row.state.startsWith('Claim') ? 'pf-primary' : ''} onClick={() => setSelection({ scope, id: row.id, outcome: row.outcome ?? 0 })}>{row.state === 'Trading' ? 'Sell' : row.state.startsWith('Claim') ? 'Claim' : s.now >= b.tradingLocksAt || s.market.finalized ? 'Release escrow' : 'Manage orders'}</button>}</td></tr>
          })}</tbody></table></div>}
        </section>
        {selected && wallet && canManage && selection && (
          <PositionAction ordersOnly={selected.state === 'Orders'} key={`${scope}:${selected.id}`} entry={encodeStored(selected.entry)} outcome={selection.outcome} wallet={wallet} onClose={() => setSelection(null)}/>
        )}
      </div>
      <p className="pf-footnote">{solana
        ? 'Holdings are read from the chain across every configured question: shares on the venue seat, shares reserved by your resting orders, claim tokens in your wallet, and complete sets held in the prediction vault. Selling, cancelling an order and claiming a settled payout all need your wallet signature and are done on the question’s own market page.'
        : 'Holdings are read from the chain across configured DreamDEX events. Reserved shares remain in open orders until cancelled. Selling depends on buyers and market cutoff; claims require confirmed settlement and your wallet signature.'}</p>
    </main>
  </AppShell>
}
