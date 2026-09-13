import '../../styles/home-markets.css'
import { ChevronDown } from 'lucide-react'
import { useEffect, useState } from 'react'
import { formatUnits } from 'viem'
import type { ArenaMarket, ArenaMarketOutcome, SolzMatch, SolzSnapshot } from '../solz/model'
import type { PredictionAnswer } from '../solz/predictionContracts'
import { accentStyle, AgentPortrait, compact, TeamMark } from './HomePrimitives'
import { matchIdLabel, outcomeColor } from './heroMarket'
import { AnimatedCollapse } from './AnimatedCollapse'
import { PredictionDetail } from './PredictionDetail'
import { MarketErrorBoundary } from './MarketErrorBoundary'
import { MatchAvatar } from '../portfolio/matchIdentity'

type Props = {
  markets: ArenaMarket[]; market: ArenaMarket; outcome: ArenaMarketOutcome; snapshot: SolzSnapshot
  answer?: PredictionAnswer; onSelect: (market: ArenaMarket, outcome: ArenaMarketOutcome, answer?: PredictionAnswer) => void
  simulation: boolean; referenceMarkets?: ArenaMarket[]; sourceLabel?: string
  match?: SolzMatch
}
export function PredictionOptions(props: Props) {
  const displayId = props.match ? matchIdLabel(props.match) : 'MATCH —'
  return <div className="ch-options" aria-label="Related predictions">
    <div className="ch-options-heading"><div><div className="ch-options-title"><h2>Make your call.</h2><span className="ch-options-match">{props.match && <MatchAvatar id={props.match.id}/>}<b>{displayId}</b></span></div><p>{props.markets.length} predictions · select a topic or an outcome</p></div><span className="ch-simulation">{props.sourceLabel ?? (props.simulation ? 'SAMPLE MARKETS' : 'NEON EVENT DRAFTS')}</span></div>
    <div className="ch-options-scroll" tabIndex={0} aria-label="Scrollable prediction options">{props.markets.map((item) => <PredictionTopic {...props} item={item} key={item.id}/>)}</div>
  </div>
}
function PredictionTopic({ item, market, outcome, snapshot, answer = 'yes', onSelect, simulation, referenceMarkets, sourceLabel }: Props & { item: ArenaMarket }) {
  const collateral = simulation ? 'COOLA' : sourceLabel === 'SOMNIA TESTNET' ? 'tUSDC' : sourceLabel === 'SOMNIA MAINNET' ? 'USDso' : 'collateral'
  const active = item.id === market.id
  const [open, setOpen] = useState(active)
  const [nestedOpen, setNestedOpen] = useState<string[]>([])
  const [lastOutcome, setLastOutcome] = useState(item.outcomes[0].id)
  const [answers, setAnswers] = useState<Record<string, PredictionAnswer>>({})
  const selected = active ? outcome : item.outcomes.find((pick) => pick.id === lastOutcome) ?? item.outcomes[0]
  const reference = referenceMarkets?.find((entry) => entry.id === item.id)
  const multiple = item.outcomes.length > 2
  useEffect(() => {
    if (active) { setLastOutcome(outcome.id); setAnswers((previous) => previous[outcome.id] === answer ? previous : { ...previous, [outcome.id]: answer }) }
  }, [active, outcome.id, answer])
  const choose = (pick: ArenaMarketOutcome, value: PredictionAnswer = 'yes') => { setLastOutcome(pick.id); setAnswers((previous) => ({ ...previous, [pick.id]: value })); onSelect(item, pick, value) }
  const selectedAnswer = active ? answer : answers[selected.id] ?? 'yes'
  const displayedPrice = (pick: ArenaMarketOutcome, value: PredictionAnswer = 'yes') => {
    const probability = value === 'yes' ? pick.probability : 1 - pick.probability
    return `${Math.round(probability * 100)}¢`
  }
  const volumeLabel = simulation
    ? `${compact(item.volume.COOLA)} COOLA Vol.`
    : item.onchain?.volume24h
      ? `${Number(formatUnits(BigInt(item.onchain.volume24h.amount), item.onchain.volume24h.decimals)).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${collateral} 24h Vol.`
      : item.onchain ? 'Volume unavailable' : 'No market volume yet'
  const movement = (pick: ArenaMarketOutcome) => {
    const points = pick.priceHistory?.length ? pick.priceHistory : pick.quoteHistory ?? []
    const previous = points.at(-2)?.probability
    if (previous === undefined || previous === pick.probability) return '—'
    const delta = pick.probability - previous
    return `${delta > 0 ? '↑' : '↓'} ${Math.abs(delta * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`
  }
  return <section className={`ch-option ${active ? 'is-selected' : ''}`}>
    <div className="ch-option-row">
      <h3><button id={`option-${item.id}-button`} aria-expanded={open} aria-controls={`option-${item.id}`} onClick={() => { setOpen(!open); choose(selected, selectedAnswer) }}><span>{item.title}<small>{volumeLabel}{multiple && ` · ${item.outcomes.length} outcomes`}</small></span><ChevronDown size={16}/></button></h3>
      {!multiple && <div className="ch-option-actions"><div className="ch-option-probability" aria-label={`${selected.label} market probability`}><strong>{selected.probability > 0 && selected.probability < .01 ? '<1' : Math.round(selected.probability * 100)}%</strong><span className={movement(selected).startsWith('↑') ? 'is-up' : movement(selected).startsWith('↓') ? 'is-down' : ''}>{movement(selected)}</span></div><div className="ch-option-picks">{item.outcomes.map((pick, index) => <button key={pick.id} className={index === 0 ? 'is-yes' : 'is-no'} aria-pressed={active && outcome.id === pick.id} onClick={() => choose(pick)}><span>{pick.label}</span><b>{displayedPrice(pick)}</b></button>)}</div></div>}
    </div>
    <AnimatedCollapse id={`option-${item.id}`} labelledBy={`option-${item.id}-button`} open={open}>
      {multiple ? <div className="ch-outcome-list">{item.outcomes.map((pick, index) => {
        const picked = selected.id === pick.id
        const expanded = nestedOpen.includes(pick.id)
        const value = picked ? selectedAnswer : answers[pick.id] ?? 'yes'
        return <section className={`ch-nested-outcome ${active && picked ? 'is-selected' : ''}`} key={pick.id} style={accentStyle(outcomeColor(pick, snapshot, index))}>
          <div className="ch-outcome-row">
            <h4><button id={`outcome-${pick.id}-button`} className="ch-outcome-name" aria-expanded={expanded} aria-controls={`outcome-${pick.id}`} onClick={() => { setNestedOpen((previous) => expanded ? previous.filter((id) => id !== pick.id) : [...previous, pick.id]); choose(pick, value) }}>{pick.participantId ? <AgentPortrait number={Number(pick.participantId.split('-')[1])}/> : <TeamMark id={pick.teamId ?? pick.id} color={outcomeColor(pick, snapshot, index)}/>}<span>{pick.label}</span><ChevronDown size={14}/></button></h4>
            <div className="ch-outcome-quote" aria-label={`${pick.label} market probability`}><b>{pick.probability > 0 && pick.probability < .01 ? '<1' : Math.round(pick.probability * 100)}%</b><small className={movement(pick).startsWith('↑') ? 'is-up' : movement(pick).startsWith('↓') ? 'is-down' : ''}>{movement(pick)}</small></div>
            <div>{(['yes', 'no'] as const).map((side) => <button className={`ch-answer is-${side}`} key={side} aria-label={`${side === 'yes' ? 'Yes' : 'No'} · ${pick.label} · ${item.title}`} aria-pressed={active && picked && value === side} onClick={() => choose(pick, side)}><span className="ch-buy-label">Buy </span>{side === 'yes' ? 'Yes' : 'No'} <span>{displayedPrice(pick, side)}</span></button>)}</div>
          </div>
          <AnimatedCollapse id={`outcome-${pick.id}`} labelledBy={`outcome-${pick.id}-button`} open={expanded}><MarketErrorBoundary label={item.title}><PredictionDetail collateral={collateral} market={item} outcome={pick} answer={value} snapshot={snapshot} referenceMarket={reference} simulation={simulation} nested onSelect={choose}/></MarketErrorBoundary></AnimatedCollapse>
        </section>
      })}</div> : <MarketErrorBoundary label={item.title}><PredictionDetail collateral={collateral} market={item} outcome={selected} snapshot={snapshot} referenceMarket={reference} simulation={simulation} onSelect={choose}/></MarketErrorBoundary>}
    </AnimatedCollapse>
  </section>
}
