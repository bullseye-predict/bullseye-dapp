import { encodeStored } from '../../../packages/prediction-core/serialization'
import { MatchAvatar, matchLabel, matchStartedAt } from './matchIdentity'
import { PortfolioChart, chartMarket } from './PortfolioChart'
import { marketLifecycle } from './model'
import { useMemo, useState, type ReactNode } from 'react'
import { ArrowUpRight, Copy, RefreshCw, Search, WalletCards } from 'lucide-react'
import { DynamicSolanaSession, type DynamicEvmWalletPort } from '../arena/DynamicSolanaSession'
import { SiteHeader } from '../solz/SiteHeader'
import { formatUnitsExact } from '../prediction/amounts'
import { usePortfolio, type PortfolioMarket } from './usePortfolio'
import { isClosedPosition, positionState, type PositionState } from './model'
import { PositionAction } from './PositionAction'
import '../../styles/home.css'
import './portfolio.css'

type Props = { environmentId: string; apiUrl: string; matchApiUrl?: string }
export function PortfolioApp({ environmentId, apiUrl, matchApiUrl = '' }: Props) {
  return <DynamicSolanaSession environmentId={environmentId}>{session => <Portfolio matchApiUrl={matchApiUrl} apiUrl={apiUrl} wallet={session.evmWallet} walletControl={session.walletControl}/>}</DynamicSolanaSession>
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
export function Portfolio({ apiUrl, wallet, walletControl, matchApiUrl = '' }: { apiUrl: string; matchApiUrl?: string; wallet: DynamicEvmWalletPort | null; walletControl: ReactNode }) {
  const [chain, setChain] = useState<'50312' | '5031'>('50312')
  const [tab, setTab] = useState<'active' | 'closed' | 'orders'>('active')
  const [matchFilter, setMatchFilter] = useState('')
  const [sort, setSort] = useState('newest')
  const [search, setSearch] = useState('')
  const [retry, setRetry] = useState(0)
  const [copyStatus, setCopyStatus] = useState('')
  const [selection, setSelection] = useState<{ scope: string; id: string; outcome: 0 | 1 } | null>(null)
  const data = usePortfolio(apiUrl, chain, wallet?.address, retry, matchApiUrl)
  const scope = `${chain}:${wallet?.address.toLowerCase()}`
  const rows = useMemo(() => portfolioRows(data.markets), [data.markets])
  const active = rows.filter(row => row.state !== 'Orders' && !isClosedPosition(row.state))
  const closed = rows.filter(row => isClosedPosition(row.state))
  const claimable = rows.filter(row => row.state.startsWith('Claim'))
  const orders = rows.filter(row => row.state === 'Orders')
  const kickoff = (entry: PortfolioMarket) => matchStartedAt(entry.binding.eventId, entry.binding.tradingStartsAt, entry.metadata)
  const matches = [...new Map(data.markets.map(entry => [entry.binding.eventId, entry])).values()].sort((a, b) => kickoff(b) - kickoff(a))
  const filteredMarkets = data.markets.filter(entry => !matchFilter || entry.binding.eventId === matchFilter)
  const label = (entry: PortfolioMarket) => matchLabel(entry.binding.eventId, entry.binding.tradingStartsAt, entry.metadata)
  const visible = (tab === 'active' ? active : tab === 'closed' ? closed : orders).filter(row => (!matchFilter || row.entry.binding.eventId === matchFilter) && `${row.entry.binding.label} ${row.entry.binding.eventId} ${label(row.entry)}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => sort === 'name' ? a.entry.binding.label.localeCompare(b.entry.binding.label) : sort === 'oldest' ? kickoff(a.entry) - kickoff(b.entry) : kickoff(b.entry) - kickoff(a.entry))

  const selected = selection?.scope === scope ? rows.find(row => row.id === selection.id) : undefined
  const incomplete = data.failures > 0 || data.markets.some(m => m.historyError || m.historyLimited)
  const symbol = chain === '50312' ? 'tUSDC' : 'USDso'
  return <div className="solz-home pf-page">
    <a className="sh-skip-link" href="#portfolio">Skip to portfolio</a>
    <SiteHeader homeHref="/" active="profile" walletControl={walletControl}/>
    <main id="portfolio" className="pf-main">
      <div className="pf-heading"><div><p>YOUR ACCOUNT</p><h1>Portfolio<span>↗</span></h1></div><label className="pf-network">Network<select value={chain} onChange={e => { setChain(e.target.value as typeof chain); setSelection(null); setMatchFilter('') }}><option value="50312">Somnia testnet · tUSDC</option><option value="5031">Somnia mainnet · USDso</option></select></label></div>
      <section className="pf-overview" aria-label="Account overview">
        <div className="pf-identity"><div className="pf-avatar"><WalletCards size={26}/></div><div><h2>{wallet ? `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}` : 'Your predictions, together.'}</h2><p>{wallet ? 'Connected wallet · DreamDEX predictions' : 'Connect your Somnia wallet to view and manage your positions.'}</p>{wallet && <button className="pf-copy" onClick={() => void navigator.clipboard.writeText(wallet.address).then(() => setCopyStatus('Address copied')).catch(() => setCopyStatus('Could not copy address'))}><Copy size={13}/>Copy address</button>}<span role="status">{copyStatus}</span></div></div>
        <dl className="pf-stats"><div><dt>Active positions</dt><dd>{wallet && !data.loading && !data.error ? active.length : '—'}</dd></div><div><dt>Ready to claim</dt><dd className="pf-yes">{wallet && !data.loading && !data.error ? claimable.length : '—'}</dd></div><div><dt>Closed positions</dt><dd>{wallet && !data.loading && !data.error ? closed.length : '—'}</dd></div></dl>
      </section>
      <div className="pf-caption"><span>{chain === '50312' ? 'Testnet balances · no real monetary value' : 'Mainnet balances · USDso'} · Networks are shown separately.</span><span>Average entry & P&amp;L unavailable until complete cost history is indexed.</span></div>
      <PortfolioChart markets={filteredMarkets.map(chartMarket)} loading={data.loading} connected={!!wallet} symbol={symbol} unavailable={!!data.error || data.failures > 0}/>
      {wallet && claimable.length > 0 && <div className="pf-claim-banner"><div><strong>{claimable.length} {claimable.length === 1 ? 'position is' : 'positions are'} ready to claim</strong><p>Your resolved payouts are waiting in Active positions.</p></div><button onClick={() => { setTab('active'); setSearch(''); setMatchFilter(''); const row = claimable[0]; setSelection({ scope, id: row.id, outcome: row.outcome! }) }}>Review claim <ArrowUpRight size={16}/></button></div>}
      <div className="pf-section-heading"><h2>Positions</h2><button className="pf-refresh" disabled={data.loading || !wallet} onClick={() => { setSelection(null); setRetry(n => n + 1) }}><RefreshCw size={14}/>Refresh</button></div>
      <div className="pf-toolbar"><div className="pf-tabs" aria-label="Position status">{(['active', 'closed', 'orders'] as const).map(value => <button key={value} aria-pressed={tab === value} className={tab === value ? 'is-selected' : ''} onClick={() => setTab(value)}>{value === 'active' ? 'Active' : value === 'closed' ? 'Closed' : 'Orders'} <span>{wallet && !data.loading && !data.error ? (value === 'active' ? active.length : value === 'closed' ? closed.length : orders.reduce((n, row) => n + row.entry.snapshot.orders.length, 0)) : '—'}</span></button>)}</div><label className="pf-search"><Search size={17}/><input aria-label="Search positions" placeholder="Search markets or matches" value={search} onChange={e => setSearch(e.target.value)}/></label></div>
      <div className="pf-filters"><label>Match<select value={matchFilter} onChange={e => { setMatchFilter(e.target.value); setSelection(null) }}><option value="">All matches</option>{matches.map(entry => <option value={entry.binding.eventId} key={entry.binding.eventId}>{label(entry)}</option>)}</select></label><label>Sort<select value={sort} onChange={e => setSort(e.target.value)}><option value="newest">Newest match</option><option value="oldest">Oldest match</option><option value="name">Market name A–Z</option></select></label></div>
      {tab === 'orders' && <p className="pf-notice">Orders are separate from positions. Expired orders cannot fill, but their remaining escrow must be released with a wallet transaction. This is not a winning payout.</p>}
      {data.error && wallet && <p className="pf-error" role="alert">{data.error} Use Refresh to try again.</p>}
      {incomplete && wallet && <p className="pf-notice" role="status">Some market reads or historical records are unavailable or incomplete. Counts may be incomplete; refresh to retry.</p>}
      <div className={`pf-content ${selected ? 'has-action' : ''}`}>
        <section className="pf-list" aria-label={`${tab} positions`} aria-busy={data.loading}>
          {!wallet ? <div className="pf-empty"><WalletCards size={32}/><h2>Make this portfolio yours.</h2><p>Log in with the wallet you used to trade. Your active positions, closed history, and available claims will appear here.</p>{walletControl}</div> : data.loading ? <div className="pf-loading" role="status">Loading your on-chain positions…<div/><div/><div/></div> : data.error ? <div className="pf-empty"><h2>Portfolio temporarily unavailable</h2><p>We couldn’t load your positions. No empty balance has been assumed.</p></div> : visible.length === 0 ? <div className="pf-empty"><h2>{search ? 'No matching positions' : incomplete ? 'No positions in the available records' : tab === 'active' ? 'No active positions yet' : tab === 'orders' ? 'No remaining orders' : 'No closed positions yet'}</h2><p>{search ? 'Try another market name or match ID.' : tab === 'active' ? 'Your holdings and unclaimed winnings appear here after trading.' : 'Fully exited markets and losing settled positions appear here.'}</p><a href="/">Explore the arena <ArrowUpRight size={15}/></a></div> : <div className="pf-table-scroll"><table><thead><tr><th>Market / outcome</th><th>{tab === 'orders' ? 'Remaining orders' : 'Shares'}</th><th>Status</th><th>Best bid</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{visible.map(row => {
            const s = row.entry.snapshot, b = row.entry.binding
            const bid = row.outcome === 0 ? s.book?.yesBids[0]?.price : s.book?.noBids[0]?.price
            return <tr key={row.id}><td><div className="pf-market-identity"><MatchAvatar id={b.eventId}/><div><strong>{b.label}</strong><small title={b.eventId}>{label(row.entry)}</small></div></div><details className="pf-match-details"><summary>Match details</summary><code>{b.eventId}</code><small>{new Date(kickoff(row.entry)).toLocaleString()} · {marketLifecycle(s.market, s.now, b.tradingLocksAt)}</small>{row.entry.metadata?.status && <small>Game: {row.entry.metadata.status}</small>}</details>{row.outcome !== undefined && <span className={row.outcome === 0 ? 'pf-outcome pf-yes' : 'pf-outcome pf-no'}>{row.outcome === 0 ? 'YES' : 'NO'}</span>}</td><td>{row.state === 'Orders' ? s.orders.length : formatUnitsExact(row.quantity, s.market.decimals, 6)}</td><td><span className={row.state.startsWith('Claim') ? 'pf-yes' : ''}>{row.state === 'Orders' ? (s.now >= b.tradingLocksAt || s.market.finalized ? 'Expired · funds reserved' : 'Resting orders') : row.state}<small>{marketLifecycle(s.market, s.now, b.tradingLocksAt)}</small></span></td><td>{row.state === 'Trading' && bid !== undefined ? `${formatUnitsExact(bid, s.market.decimals, 6)} ${symbol}` : '—'}</td><td>{(row.state === 'Trading' || row.state.startsWith('Claim') || row.state === 'Orders') && <button className={row.state === 'Trading' ? 'pf-sell' : row.state.startsWith('Claim') ? 'pf-primary' : ''} onClick={() => setSelection({ scope, id: row.id, outcome: row.outcome ?? 0 })}>{row.state === 'Trading' ? 'Sell' : row.state.startsWith('Claim') ? 'Claim' : s.now >= b.tradingLocksAt || s.market.finalized ? 'Release escrow' : 'Manage orders'}</button>}</td></tr>
          })}</tbody></table></div>}
        </section>
        {selected && wallet && selection && <PositionAction ordersOnly={selected.state === 'Orders'} key={`${scope}:${selected.id}`} entry={encodeStored(selected.entry)} outcome={selection.outcome} wallet={wallet} onClose={() => setSelection(null)}/>}
      </div>
      <p className="pf-footnote">Holdings are read from the chain across configured DreamDEX events. Reserved shares remain in open orders until cancelled. Selling depends on buyers and market cutoff; claims require confirmed settlement and your wallet signature.</p>
    </main>
  </div>
}
