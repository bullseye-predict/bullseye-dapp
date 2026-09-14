import { useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, Link as LinkIcon, Search } from 'lucide-react'
import type { PublicPredictionVenue } from '../../../packages/prediction-core/market-data'
import type { PositionAccounting } from '../../../packages/prediction-core/portfolio/model'
import { AppShell } from '../solz/AppShell'
import { formatUnitsExact } from '../prediction/amounts'
import type { ReservedSolanaQuestion } from '../home/solanaQuestionMarkets'
import type { SolanaPortfolioState } from './useSolanaPortfolio'
import {
  solanaCollateral,
  solanaIdentity,
  solanaOrderRows,
  solanaPositionRows,
  type SolanaIdentity,
  type SolanaPositionRow,
} from './solanaRows'
import { MatchAvatar } from './matchIdentity'
import { PortfolioSummary } from './PortfolioSummary'
import { SolanaPnlChart } from './SolanaPnlChart'
import {
  useProfileAccounting,
  type ProfileAccounting,
} from './useProfileAccounting'
import { SolanaProfileAction, type ProfileAction } from './SolanaProfileAction'
import { isClosedPosition } from './model'
import { solanaNetwork } from './profileRoute'
import './solanaProfile.css'
type Props = {
  bootstrap?: {
    profile: ProfileAccounting
    history: ProfileAccounting
    chart: ProfileAccounting
  }
  initialSection?: 'positions' | 'orders' | 'activity'
  apiUrl: string
  venue: PublicPredictionVenue | null
  owner?: string
  isSelf: boolean
  network?: string
  questions: ReservedSolanaQuestion[]
  sol: SolanaPortfolioState
  retry: number
  onRefresh: () => void
}
type PositionView = {
  id: string
  identity: SolanaIdentity
  outcome: 0 | 1
  row?: SolanaPositionRow
  account?: PositionAccounting
  quantity: bigint
  closed: boolean
}
const eventHref = (identity: SolanaIdentity) =>
  identity.eventId
    ? `/events/${encodeURIComponent(identity.eventId)}${identity.questionId ? `#event-${encodeURIComponent(identity.questionId)}` : ''}`
    : undefined
export const sharePrice = (
  value: string | bigint | null | undefined,
  decimals = 6,
) =>
  value == null
    ? '—'
    : `${formatUnitsExact(BigInt(value) * 100n, decimals, 4)}¢`
const money = (value: string | bigint | null | undefined, decimals: number) =>
  value == null ? '—' : formatUnitsExact(BigInt(value), decimals, 2)
function Identity({
  identity,
  outcome,
  entry,
  quantity,
  decimals,
}: {
  identity: SolanaIdentity
  outcome: 0 | 1
  entry?: string | bigint | null
  quantity?: bigint
  decimals: number
}) {
  const href = eventHref(identity),
    image =
      identity.presentation?.answer?.imageUrl ??
      identity.presentation?.outcomes[outcome].imageUrl ??
      identity.presentation?.imageUrl
  return (
    <div className="sp-identity">
      {image ? (
        <img src={image} alt="" loading="lazy" />
      ) : (
        <MatchAvatar id={identity.eventId ?? identity.marketId} />
      )}
      <div>
        {href ? (
          <a className="sp-title" href={href}>
            {identity.label}
          </a>
        ) : (
          <strong className="sp-title">{identity.label}</strong>
        )}
        <div className="sp-outcome-line">
          <span className={`sp-outcome ${outcome === 0 ? 'is-yes' : 'is-no'}`}>
            {identity.outcomeLabels[outcome]} {sharePrice(entry, decimals)}
          </span>
          {quantity !== undefined && (
            <span>{formatUnitsExact(quantity, decimals, 4)} shares</span>
          )}
        </div>
      </div>
    </div>
  )
}
function Gain({
  pnl,
  cost,
  decimals,
}: {
  pnl?: string | null
  cost?: string | null
  decimals: number
}) {
  if (pnl == null) return <small className="sp-muted">P/L unavailable</small>
  const value = BigInt(pnl),
    basis = cost == null ? 0n : BigInt(cost),
    percent =
      basis > 0n ? formatUnitsExact((value * 10000n) / basis, 2, 2) : null
  return (
    <small className={value >= 0n ? 'sp-positive' : 'sp-negative'}>
      {value >= 0n ? '+' : ''}
      {money(value, decimals)}
      {percent !== null ? ` (${value >= 0n ? '+' : ''}${percent}%)` : ''}
    </small>
  )
}
export function SolanaProfile({
  bootstrap,
  initialSection,
  apiUrl,
  venue,
  owner,
  isSelf,
  network,
  questions,
  sol,
  retry,
  onRefresh,
}: Props) {
  const [section, setSection] = useState<'positions' | 'orders' | 'activity'>(
      initialSection ?? 'positions',
    ),
    [closed, setClosed] = useState(false),
    [search, setSearch] = useState(''),
    [event, setEvent] = useState(''),
    [sort, setSort] = useState('value'),
    [range, setRange] = useState('ALL'),
    [cursor, setCursor] = useState(''),
    [copy, setCopy] = useState(''),
    [action, setAction] = useState<ProfileAction | null>(null)
  const deployment = venue
    ? `${venue.chainId}:${venue.programId}:${venue.manifestProgramId}:${venue.collateralToken}`
    : undefined
  const profileState = useProfileAccounting(
      venue ? apiUrl : '',
      owner,
      '',
      '',
      retry,
      '',
      deployment,
    ),
    historyState = useProfileAccounting(
      section === 'activity' ? apiUrl : '',
      owner,
      'activity',
      '',
      retry,
      cursor,
      deployment,
    ),
    chartState = useProfileAccounting(
      venue ? apiUrl : '',
      owner,
      'pnl',
      range,
      retry,
      '',
      deployment,
    )
  const profile = {
      ...profileState,
      data: profileState.data ?? bootstrap?.profile,
    },
    history = {
      ...historyState,
      data: historyState.data ?? bootstrap?.history,
    },
    chart = { ...chartState, data: chartState.data ?? bootstrap?.chart }
  useEffect(() => {
    setAction(null)
    setCursor('')
    setSection(initialSection ?? 'positions')
  }, [owner, isSelf, venue?.chainId])
  const decimals = venue?.collateralDecimals ?? 6,
    symbol = venue?.collateralSymbol ?? 'collateral'
  const catalogue = useMemo(
    () => [
      ...new Map(
        [...(profile.data?.questions ?? []), ...questions].map((q) => [
          q.marketId,
          q,
        ]),
      ).values(),
    ],
    [profile.data?.questions, questions],
  )
  const rows = useMemo(
    () =>
      sol.portfolio
        ? solanaPositionRows(sol.portfolio, catalogue, decimals)
        : [],
    [sol.portfolio, catalogue, decimals],
  )
  const orders = useMemo(
    () => (sol.portfolio ? solanaOrderRows(sol.portfolio, catalogue) : []),
    [sol.portfolio, catalogue],
  )
  const accounting = new Map(
    (profile.data?.accounting.positions ?? []).map((p) => [
      `${p.marketId}:${p.outcome}`,
      p,
    ]),
  )
  const positions: PositionView[] = rows
    .filter((r) => r.quantity > 0n)
    .map((row) => ({
      id: row.id,
      identity: row.identity,
      outcome: row.outcome,
      row,
      account: accounting.get(row.id),
      quantity: row.quantity,
      closed: isClosedPosition(row.state),
    }))
  for (const account of accounting.values())
    if (
      !positions.some(
        (p) => p.id === `${account.marketId}:${account.outcome}`,
      ) &&
      BigInt(account.acquired) > 0n
    )
      positions.push({
        id: `${account.marketId}:${account.outcome}`,
        identity: solanaIdentity(
          account.marketId,
          catalogue.find((q) => q.marketId === account.marketId),
        ),
        outcome: account.outcome,
        account,
        quantity: BigInt(account.quantity),
        closed: BigInt(account.quantity) === 0n,
      })
  const matches = (identity: SolanaIdentity) =>
    (!event || identity.eventId === event) &&
    `${identity.label} ${identity.outcomeLabels.join(' ')} ${identity.marketId}`
      .toLowerCase()
      .includes(search.toLowerCase())
  const mark = (p: PositionView) =>
    p.row?.holding.status === 3
      ? p.row.holding.winningOutcome === p.outcome
        ? 10n ** BigInt(decimals)
        : 0n
      : p.row?.holding.status === 4
        ? 10n ** BigInt(decimals) / 2n
        : p.account?.current == null
          ? null
          : BigInt(p.account.current)
  const value = (p: PositionView) =>
    p.quantity === 0n
      ? 0n
      : mark(p) === null
        ? null
        : (p.quantity * mark(p)!) / 10n ** BigInt(decimals)
  const visible = positions
    .filter((p) => p.closed === closed && matches(p.identity))
    .sort((a, b) => {
      if (sort === 'name')
        return a.identity.label.localeCompare(b.identity.label)
      if (sort === 'newest')
        return (
          Date.parse(b.identity.scheduledStartAt ?? '') -
          Date.parse(a.identity.scheduledStartAt ?? '')
        )
      const av = value(a),
        bv = value(b)
      return av === null
        ? bv === null
          ? 0
          : 1
        : bv === null
          ? -1
          : av > bv
            ? -1
            : av < bv
              ? 1
              : 0
    })
  const held = positions.filter((p) => p.quantity > 0n),
    unpriced = held.filter((p) => value(p) === null).length,
    total = held.reduce((n, p) => n + (value(p) ?? 0n), 0n)
  const events = [
    ...new Map(
      [...positions.map((p) => p.identity), ...orders.map((o) => o.identity)]
        .filter((i) => i.eventId)
        .map((i) => [i.eventId!, i]),
    ).values(),
  ]
  const wrongNetwork = !!(
    network &&
    venue &&
    solanaNetwork(venue.chainId) &&
    network !== solanaNetwork(venue.chainId)
  )
  const manage = isSelf && !wrongNetwork
  const refresh = () => {
    onRefresh()
    setCursor('')
  }
  const reason = profile.error || profile.data?.coverage.reason
  const displayEvents = (history.data?.events ?? []).filter((e) => {
    const identity = e.marketId
      ? solanaIdentity(
          e.marketId,
          catalogue.find((q) => q.marketId === e.marketId),
        )
      : undefined
    return identity
      ? matches(identity)
      : !event &&
          `${e.kind} ${e.detail ?? ''}`
            .toLowerCase()
            .includes(search.toLowerCase())
  })
  const transactionHref = (signature: string) => {
    if (!venue?.explorerUrl) return undefined
    try {
      const url = new URL(venue.explorerUrl)
      url.pathname = `${url.pathname.replace(/\/$/, '')}/tx/${encodeURIComponent(signature)}`
      return url.toString()
    } catch {
      return undefined
    }
  }
  return (
    <AppShell
      className="solz-home pf-page sp-page"
      active="profile"
      skipTo="#portfolio"
      skipLabel="Skip to portfolio"
      backToTopHref="#portfolio"
    >
      <main id="portfolio" className="pf-main">
        <div className="pf-heading">
          <h1>{isSelf ? 'My portfolio' : 'Portfolio'}</h1>
          <span className="sp-muted">
            {venue?.label ?? 'Solana'} · {symbol}
          </span>
        </div>
        <div className="pf-hero">
          <PortfolioSummary
            compact
            publicView={!isSelf}
            valuationLabel="no traded price"
            owner={owner}
            meta={isSelf ? 'Your Solana account' : 'Public profile · read-only'}
            value={{
              total: unpriced ? undefined : total,
              unpriced,
              priced: held.length - unpriced,
            }}
            claimable={rows.filter((r) => r.state.startsWith('Claim')).length}
            orders={{
              total: orders.length,
              expired: orders.filter((o) => o.expired).length,
            }}
            collateral={
              isSelf && sol.portfolio ? solanaCollateral(sol.portfolio) : null
            }
            decimals={decimals}
            symbol={symbol}
            ready={!!owner && !!sol.portfolio && !sol.error}
            copyStatus={copy}
            onCopy={() => {
              if (owner)
                void navigator.clipboard
                  .writeText(owner)
                  .then(() => setCopy('Address copied'))
                  .catch(() => setCopy('Could not copy address'))
            }}
            refreshing={sol.loading}
            onRefresh={refresh}
          />
          <SolanaPnlChart
            points={chart.data?.accounting.points ?? []}
            symbol={symbol}
            decimals={decimals}
            range={range}
            onRange={setRange}
            reason={chart.error || chart.data?.coverage.reason}
          />
        </div>
        <nav className="sp-navigation" aria-label="Portfolio sections">
          <button
            aria-current={section === 'positions' ? 'page' : undefined}
            onClick={() => {
              setSection('positions')
              setAction(null)
            }}
          >
            Positions
          </button>
          {isSelf && (
            <button
              aria-current={section === 'orders' ? 'page' : undefined}
              onClick={() => {
                setSection('orders')
                setAction(null)
              }}
            >
              Open orders <span>{orders.length}</span>
            </button>
          )}
          <button
            aria-current={section === 'activity' ? 'page' : undefined}
            onClick={() => {
              setSection('activity')
              setAction(null)
              setCursor('')
            }}
          >
            {isSelf ? 'History' : 'Activity'}
          </button>
        </nav>
        <div className="pf-toolbar">
          {section === 'positions' && (
            <div className="pf-tabs" aria-label="Position status">
              {[false, true].map((c) => (
                <button
                  key={String(c)}
                  aria-pressed={closed === c}
                  className={closed === c ? 'is-selected' : ''}
                  onClick={() => setClosed(c)}
                >
                  {c ? 'Closed' : 'Active'}{' '}
                  <span>{positions.filter((p) => p.closed === c).length}</span>
                </button>
              ))}
            </div>
          )}
          <label className="pf-search">
            <Search size={18} />
            <input
              aria-label={`Search ${section}`}
              placeholder={`Search ${section === 'activity' ? 'activity' : section}`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <select
            aria-label="Filter by event"
            value={event}
            onChange={(e) => setEvent(e.target.value)}
          >
            <option value="">All events</option>
            {events.map((i) => (
              <option key={i.eventId} value={i.eventId}>
                {i.label}
              </option>
            ))}
          </select>
          {section === 'positions' && (
            <select
              aria-label="Sort positions"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="value">Current value</option>
              <option value="newest">Newest event</option>
              <option value="name">Market A–Z</option>
            </select>
          )}
        </div>
        {wrongNetwork && (
          <p className="pf-notice" role="alert">
            This profile names a different network from the configured venue.
            Trading actions are disabled.
          </p>
        )}
        {sol.error && (
          <p className="pf-error" role="alert">
            {sol.error}
          </p>
        )}
        {reason && (
          <p className="sp-coverage" role="status">
            {reason} Holdings remain visible; unavailable cost and P/L are shown
            as —.
          </p>
        )}
        <div className={`pf-content ${action ? 'has-action' : ''}`}>
          <section
            className="pf-list"
            aria-label={section}
            aria-busy={sol.loading}
          >
            {!owner ? (
              <div className="pf-empty">
                <h2>Connect your Solana wallet</h2>
                <p>
                  Your positions, open orders, and history will appear here.
                </p>
              </div>
            ) : sol.loading && !sol.portfolio ? (
              <div className="pf-loading" role="status">
                Loading holdings…
                <div />
                <div />
                <div />
              </div>
            ) : section === 'positions' ? (
              <>
                {visible.length ? (
                  <table className="sp-table">
                    <thead>
                      <tr>
                        <th>Market</th>
                        <th>{isSelf ? 'Avg → Now' : 'Avg'}</th>
                        {!isSelf && <th>Current</th>}
                        {isSelf && (
                          <>
                            <th title="Cost basis of the shares remaining in this position">
                              Traded ⓘ
                            </th>
                            <th title="Gross payout if this outcome wins">
                              To win
                            </th>
                          </>
                        )}
                        <th>
                          Value <small>{symbol}</small>
                        </th>
                        <th>
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((p) => {
                        const a = p.account,
                          priced = value(p),
                          reconciled =
                            a?.quantity === p.quantity.toString() && a.complete,
                          average = reconciled
                            ? p.quantity === 0n
                              ? a?.historicalAverage
                              : a?.average
                            : null
                        const pnl =
                          p.closed && p.quantity === 0n
                            ? a?.realized
                            : reconciled &&
                                priced !== null &&
                                a?.costBasis != null
                              ? (priced - BigInt(a.costBasis)).toString()
                              : null
                        return (
                          <tr key={p.id}>
                            <td>
                              <Identity
                                identity={p.identity}
                                outcome={p.outcome}
                                entry={average}
                                quantity={
                                  p.closed && p.quantity === 0n
                                    ? BigInt(a?.disposed ?? '0')
                                    : p.quantity
                                }
                                decimals={decimals}
                              />
                              {p.closed && p.quantity === 0n && (
                                <small>
                                  Closed · proceeds{' '}
                                  {money(a?.proceeds, decimals)} {symbol}
                                </small>
                              )}
                            </td>
                            <td data-label={isSelf ? 'Avg → Now' : 'Avg'}>
                              {sharePrice(average, decimals)}
                              {isSelf && (
                                <>
                                  {' '}
                                  <span className="sp-muted">→</span>{' '}
                                  {sharePrice(mark(p), decimals)}
                                </>
                              )}
                            </td>
                            {!isSelf && (
                              <td data-label="Current">
                                {sharePrice(mark(p), decimals)}
                              </td>
                            )}
                            {isSelf && (
                              <>
                                <td
                                  data-label={`Traded (${symbol})`}
                                  title={
                                    a?.reason ??
                                    'Cost basis of remaining shares'
                                  }
                                >
                                  {money(
                                    reconciled
                                      ? p.quantity === 0n
                                        ? a?.acquisitionCost
                                        : a?.costBasis
                                      : null,
                                    decimals,
                                  )}
                                </td>
                                <td data-label={`To win (${symbol})`}>
                                  {money(p.quantity, decimals)}
                                </td>
                              </>
                            )}
                            <td data-label={`Value (${symbol})`}>
                              {money(priced, decimals)}
                              <Gain
                                pnl={pnl}
                                cost={
                                  p.quantity === 0n
                                    ? a?.disposedCost
                                    : a?.costBasis
                                }
                                decimals={decimals}
                              />
                            </td>
                            <td className="sp-row-actions">
                              {manage &&
                                p.row &&
                                (p.row.state === 'Trading' ||
                                  p.row.state.startsWith('Claim')) && (
                                  <button
                                    className={
                                      p.row.state === 'Trading'
                                        ? 'pf-sell'
                                        : 'pf-primary'
                                    }
                                    onClick={() =>
                                      setAction({
                                        kind:
                                          p.row!.state === 'Trading'
                                            ? 'sell'
                                            : 'claim',
                                        row: p.row!,
                                      })
                                    }
                                  >
                                    {p.row.state === 'Trading'
                                      ? 'Sell'
                                      : 'Claim'}
                                  </button>
                                )}
                              {eventHref(p.identity) && (
                                <a
                                  aria-label={`Open ${p.identity.label}`}
                                  href={eventHref(p.identity)}
                                >
                                  <LinkIcon size={17} />
                                </a>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                ) : (
                  <div className="pf-empty">
                    <h2>
                      {search
                        ? 'No matching positions'
                        : closed
                          ? 'No closed positions'
                          : 'No active positions'}
                    </h2>
                    <p>
                      Positions are shares you own.
                      {isSelf ? ' Unfilled orders appear in Open orders.' : ''}
                    </p>
                  </div>
                )}
              </>
            ) : section === 'orders' && isSelf ? (
              <>
                {orders.filter((o) => matches(o.identity)).length ? (
                  <table className="sp-table">
                    <thead>
                      <tr>
                        <th>Market</th>
                        <th>Side</th>
                        <th>Limit</th>
                        <th>Remaining</th>
                        <th>Reserved</th>
                        <th>Status</th>
                        <th>
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders
                        .filter((o) => matches(o.identity))
                        .map((o) => (
                          <tr key={o.id}>
                            <td>
                              <Identity
                                identity={o.identity}
                                outcome={o.outcome}
                                entry={o.order.price}
                                decimals={decimals}
                              />
                            </td>
                            <td
                              data-label="Side"
                              className={
                                o.order.side === 'BUY'
                                  ? 'sp-positive'
                                  : 'sp-negative'
                              }
                            >
                              {o.order.side === 'BUY' ? 'Buy' : 'Sell'}
                            </td>
                            <td data-label="Limit">
                              {sharePrice(o.order.price, decimals)}
                            </td>
                            <td data-label="Remaining">
                              {formatUnitsExact(o.order.quantity, decimals, 4)}{' '}
                              shares
                            </td>
                            <td data-label="Reserved">
                              {o.order.side === 'BUY'
                                ? `${money(o.order.reserved, decimals)} ${symbol}`
                                : `${formatUnitsExact(o.order.quantity, decimals, 4)} shares`}
                            </td>
                            <td data-label="Status">
                              {o.expired
                                ? 'Expired · release available'
                                : 'Open'}
                            </td>
                            <td>
                              {manage && (
                                <button
                                  onClick={() =>
                                    setAction({ kind: 'cancel', row: o })
                                  }
                                >
                                  {o.expired ? 'Release' : 'Cancel'}
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="pf-empty">
                    <h2>No open orders</h2>
                    <p>
                      Unfilled limit orders appear here. Filled shares belong in
                      Positions.
                    </p>
                  </div>
                )}
              </>
            ) : (
              <>
                {history.error && (
                  <p className="pf-error" role="alert">
                    {history.error}
                  </p>
                )}
                {displayEvents.length ? (
                  <table className="sp-table">
                    <thead>
                      <tr>
                        <th>Market / event</th>
                        <th>Activity</th>
                        <th>Price</th>
                        <th>Shares</th>
                        <th>
                          Amount <small>{symbol}</small>
                        </th>
                        <th>Time</th>
                        <th>
                          <span className="sr-only">Transaction</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayEvents.map((e) => {
                        const identity = e.marketId
                          ? solanaIdentity(
                              e.marketId,
                              catalogue.find((q) => q.marketId === e.marketId),
                            )
                          : null
                        return (
                          <tr key={e.id}>
                            <td>
                              {identity && e.outcome !== undefined ? (
                                <Identity
                                  identity={identity}
                                  outcome={e.outcome}
                                  entry={e.price}
                                  decimals={decimals}
                                />
                              ) : (
                                <strong className="sp-title">
                                  {identity?.label ??
                                    e.detail ??
                                    'Account transfer'}
                                </strong>
                              )}
                            </td>
                            <td
                              data-label="Activity"
                              className={
                                e.kind === 'BUY'
                                  ? 'sp-positive'
                                  : e.kind === 'SELL'
                                    ? 'sp-negative'
                                    : ''
                              }
                            >
                              {e.kind.replaceAll('_', ' ').toLowerCase()}
                              <small>{e.detail}</small>
                            </td>
                            <td data-label="Price">
                              {sharePrice(e.price, decimals)}
                            </td>
                            <td data-label="Shares">
                              {e.shares === undefined
                                ? '—'
                                : formatUnitsExact(
                                    BigInt(e.shares),
                                    decimals,
                                    4,
                                  )}
                            </td>
                            <td data-label={`Amount (${symbol})`}>
                              {money(e.collateral, decimals)}
                              {e.fee != null && BigInt(e.fee) > 0n && (
                                <small>Fee {money(e.fee, decimals)}</small>
                              )}
                            </td>
                            <td data-label="Time">
                              {new Date(e.at).toLocaleString()}
                            </td>
                            <td>
                              {transactionHref(e.signature) && (
                                <a
                                  aria-label="View transaction"
                                  href={transactionHref(e.signature)}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  <ArrowUpRight size={18} />
                                </a>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                ) : (
                  <div className="pf-empty">
                    <h2>
                      {history.data?.coverage.complete
                        ? 'No matching activity'
                        : 'Loading account history'}
                    </h2>
                    <p>
                      {history.data?.coverage.reason ??
                        'Trades and account operations appear here as history is indexed.'}
                    </p>
                  </div>
                )}
                {history.data?.nextCursor && (
                  <button onClick={() => setCursor(history.data!.nextCursor!)}>
                    Older activity
                  </button>
                )}
                {cursor && (
                  <button onClick={() => setCursor('')}>Newest activity</button>
                )}
              </>
            )}
          </section>
          {action && manage && venue && owner && (
            <SolanaProfileAction
              key={`${owner}:${action.row.id}:${action.kind}`}
              action={action}
              venue={venue}
              owner={owner}
              onClose={() => setAction(null)}
              onRefresh={refresh}
            />
          )}
        </div>
        <p className="pf-footnote">
          Prices are cents of one {symbol}. Value uses the latest trade for each
          outcome, or its settled payout; it is not a guaranteed sale quote.
          Traded is remaining cost basis. To win is gross payout. P/L includes
          verified trading fees and excludes SOL network fees.
        </p>
      </main>
    </AppShell>
  )
}
