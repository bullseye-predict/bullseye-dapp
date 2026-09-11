import { useMemo, useState } from 'react'
import { cumulativeFlows } from './cashFlow'
import type { PortfolioMarket } from './usePortfolio'
import { formatUnitsExact } from '../prediction/amounts'

export type ChartMarket = { decimals: number; now: number; historyError: boolean; historyLimited: boolean; cashFlows: { id: string; at: number; amount: string }[] }
/** Only JSON-safe chart data crosses the React component boundary. */
export function chartMarket(market: PortfolioMarket): ChartMarket {
  return { decimals: market.snapshot.market.decimals, now: market.snapshot.now, historyError: market.historyError, historyLimited: market.historyLimited, cashFlows: (market.cashFlows ?? []).map(flow => ({ ...flow, amount: flow.amount.toString() })) }
}
export function PortfolioChart({ markets, loading, connected, symbol, unavailable }: { markets: ChartMarket[]; loading: boolean; connected: boolean; symbol: string; unavailable: boolean }) {
  const [range, setRange] = useState<'1D' | '1W' | '1M' | 'ALL'>('ALL')
  const [hover, setHover] = useState<number | null>(null)
  const decimals = markets[0]?.decimals ?? 6
  const incomplete = unavailable || markets.some(m => m.historyError || m.historyLimited || m.decimals !== decimals)
  const points = useMemo(() => cumulativeFlows(markets.flatMap(m => m.cashFlows.map(flow => ({ ...flow, amount: BigInt(flow.amount) })))), [markets])
  const end = Math.max(...markets.map(m => m.now), 0)
  const start = range === 'ALL' ? points[0]?.at ?? end : end - ({ '1D': 86400000, '1W': 604800000, '1M': 2592000000 }[range])
  const baseline = points.filter(p => p.at < start).at(-1)?.balance ?? 0n
  const chart = [{ at: start, balance: 0n }, ...points.filter(p => p.at >= start).map(p => ({ at: p.at, balance: p.balance - baseline }))]
  if (chart.length > 1 && end > chart.at(-1)!.at) chart.push({ at: end, balance: chart.at(-1)!.balance })
  const amounts = chart.map(p => Number(p.balance) / 10 ** decimals)
  const low = Math.min(0, ...amounts), high = Math.max(0, ...amounts), spread = high - low || 1
  const x = (at: number) => 28 + (at - start) / Math.max(end - start, 1) * 644
  const y = (n: number) => 160 - (n - low) / spread * 135
  const path = chart.map((p, i) => i ? `H${x(p.at)}V${y(amounts[i])}` : `M${x(p.at)},${y(amounts[i])}`).join(' ')
  const selected = hover === null ? chart.at(-1)! : chart[Math.min(hover, chart.length - 1)]
  const available = connected && !loading && !incomplete && points.length > 0
  return <section className="pf-chart" aria-label="Net trade flow chart">
    <header><div><h2>Net trade flow</h2><p>Confirmed sales − purchases · before fees</p></div><div className="pf-chart-ranges" aria-label="Chart time range">{(['1D', '1W', '1M', 'ALL'] as const).map(value => <button key={value} aria-pressed={range === value} onClick={() => { setRange(value); setHover(null) }}>{value}</button>)}</div></header>
    <strong className="pf-chart-total">{available ? `${formatUnitsExact(selected.balance, decimals, 4)} ${symbol}` : '—'}</strong>
    <span className="pf-chart-date">{available ? new Date(selected.at).toLocaleString() : 'Confirmed trading activity'}</span>
    {available ? <svg viewBox="0 0 700 190" role="img" aria-label={`Net trade flow ${formatUnitsExact(chart.at(-1)!.balance, decimals, 4)} ${symbol} over ${range}`} onPointerLeave={() => setHover(null)} onPointerMove={event => { const r = event.currentTarget.getBoundingClientRect(); const time = start + (((event.clientX - r.left) / r.width * 700 - 28) / 644) * (end - start); let index = 0; chart.forEach((p, i) => { if (Math.abs(p.at - time) < Math.abs(chart[index].at - time)) index = i }); setHover(index) }}>
      <line x1="28" x2="672" y1={y(0)} y2={y(0)} stroke="#45464e" strokeDasharray="4 4"/>
      <path d={path} fill="none" stroke={chart.at(-1)!.balance >= 0n ? '#6ce5a7' : '#ff8c96'} strokeWidth="2.5"/>
      <circle cx={x(selected.at)} cy={y(Number(selected.balance) / 10 ** decimals)} r="4" fill="#eeeef0"/>
      <text x="28" y="184" fill="#a1a2ac" fontSize="10">{new Date(start).toLocaleDateString()}</text><text x="672" y="184" textAnchor="end" fill="#a1a2ac" fontSize="10">{new Date(end).toLocaleDateString()}</text>
    </svg> : <div className="pf-chart-empty" role="status">{!connected ? 'Connect your wallet to load trading history.' : loading ? 'Loading confirmed activity…' : incomplete ? 'Complete trading history is unavailable. The chart cannot be calculated reliably.' : 'No executed trades in the available history.'}</div>}
    <p>Executed purchases and sales only. This is not profit/loss: minting, merging, redemptions, fees, transfers, holdings and order escrow are excluded.</p>
    {available && <details><summary>View chart data</summary><div className="pf-chart-data"><table><thead><tr><th>Time</th><th>Net flow ({symbol})</th></tr></thead><tbody>{chart.map((p, i) => <tr key={i}><td>{new Date(p.at).toLocaleString()}</td><td>{formatUnitsExact(p.balance, decimals, 6)}</td></tr>)}</tbody></table></div></details>}
  </section>
}
