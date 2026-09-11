import { useState } from 'react'
import { PortfolioChart, type ChartMarket } from './PortfolioChart'
import { MatchAvatar } from './matchIdentity'
import '../../styles/home.css'
import './portfolio.css'
const base: ChartMarket = { decimals: 6, now: Date.now(), historyError: false, historyLimited: false, cashFlows: [{ id: 'a', at: Date.now() - 700000, amount: '-1500000' }, { id: 'b', at: Date.now() - 300000, amount: '2200000' }] }
export default function PortfolioVerification() {
  const [sort, setSort] = useState('newest')
  return <div className="solz-home pf-page"><main className="pf-main"><p>Temporary UI verification · sample data · no wallet transactions</p><PortfolioChart markets={[{ ...base }]} loading={false} connected symbol="tUSDC" unavailable={false}/><label>Sort<select value={sort} onChange={e => setSort(e.target.value)}><option value="newest">Newest match</option><option value="oldest">Oldest match</option></select></label><p role="status">Selected: {sort}</p><div className="pf-market-identity"><MatchAvatar id="arena-a123"/><MatchAvatar id="arena-a123"/><MatchAvatar id="arena-b456"/></div></main></div>
}
