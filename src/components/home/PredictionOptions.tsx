import '../../styles/home-markets.css'
import { ChevronDown } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ArenaMarket, ArenaMarketOutcome, SolzSnapshot } from '../solz/model'
import type { PredictionAnswer } from '../solz/predictionContracts'
import { accentStyle, AgentPortrait, compact, percent, TeamMark } from './HomePrimitives'
import { outcomeColor } from './heroMarket'
import { AnimatedCollapse } from './AnimatedCollapse'
import { PredictionDetail } from './PredictionDetail'

type Props = {
  markets: ArenaMarket[]; market: ArenaMarket; outcome: ArenaMarketOutcome; snapshot: SolzSnapshot
  answer?: PredictionAnswer; onSelect: (market: ArenaMarket, outcome: ArenaMarketOutcome, answer?: PredictionAnswer) => void
  simulation: boolean; referenceMarkets?: ArenaMarket[]
}
export function PredictionOptions(props: Props) {
  return <div className="ch-options" aria-label="Related predictions">
    <div className="ch-options-heading"><div><h2>Make your call.</h2><p>{props.markets.length} predictions · select a topic or an outcome</p></div><span className="ch-simulation">SAMPLE MARKETS</span></div>
    <div className="ch-options-scroll" tabIndex={0} aria-label="Scrollable prediction options">{props.markets.map((item) => <PredictionTopic {...props} item={item} key={item.id}/>)}</div>
  </div>
}
function PredictionTopic({ item, market, outcome, snapshot, answer = 'yes', onSelect, simulation, referenceMarkets }: Props & { item: ArenaMarket }) {
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
  return <section className={`ch-option ${active ? 'is-selected' : ''}`}>
    <div className="ch-option-row">
      <h3><button id={`option-${item.id}-button`} aria-expanded={open} aria-controls={`option-${item.id}`} onClick={() => { setOpen(!open); choose(selected, selectedAnswer) }}><span>{item.title}<small>{compact(item.volume.COOLA)} COOLA Vol.{multiple && ` · ${item.outcomes.length} outcomes`}</small></span><ChevronDown size={16}/></button></h3>
      {!multiple && <div className="ch-option-picks">{item.outcomes.map((pick, index) => <button key={pick.id} className={index === 0 ? 'is-yes' : 'is-no'} aria-pressed={active && outcome.id === pick.id} onClick={() => choose(pick)}><span>{pick.label}</span><b>{percent(pick.probability)}</b></button>)}</div>}
    </div>
    <AnimatedCollapse id={`option-${item.id}`} labelledBy={`option-${item.id}-button`} open={open}>
      {multiple ? <div className="ch-outcome-list">{item.outcomes.map((pick, index) => {
        const picked = selected.id === pick.id
        const expanded = nestedOpen.includes(pick.id)
        const value = picked ? selectedAnswer : answers[pick.id] ?? 'yes'
        return <section className={`ch-nested-outcome ${active && picked ? 'is-selected' : ''}`} key={pick.id} style={accentStyle(outcomeColor(pick, snapshot, index))}>
          <div className="ch-outcome-row">
            <h4><button id={`outcome-${pick.id}-button`} className="ch-outcome-name" aria-expanded={expanded} aria-controls={`outcome-${pick.id}`} onClick={() => { setNestedOpen((previous) => expanded ? previous.filter((id) => id !== pick.id) : [...previous, pick.id]); choose(pick, value) }}>{pick.participantId ? <AgentPortrait number={Number(pick.participantId.split('-')[1])}/> : <TeamMark id={pick.teamId ?? pick.id} color={outcomeColor(pick, snapshot, index)}/>}<span>{pick.label}</span><ChevronDown size={14}/></button></h4>
            <b>{percent(pick.probability)}</b>
            <div>{(['yes', 'no'] as const).map((side) => <button className={`ch-answer is-${side}`} key={side} aria-label={`${side === 'yes' ? 'Yes' : 'No'} · ${pick.label} · ${item.title}`} aria-pressed={active && picked && value === side} onClick={() => choose(pick, side)}><span className="ch-buy-label">Buy </span>{side === 'yes' ? 'Yes' : 'No'} <span>{Math.round((side === 'yes' ? pick.probability : 1 - pick.probability) * 100)}¢</span></button>)}</div>
          </div>
          <AnimatedCollapse id={`outcome-${pick.id}`} labelledBy={`outcome-${pick.id}-button`} open={expanded}><PredictionDetail market={item} outcome={pick} answer={value} snapshot={snapshot} referenceMarket={reference} simulation={simulation} nested onSelect={choose}/></AnimatedCollapse>
        </section>
      })}</div> : <PredictionDetail market={item} outcome={selected} snapshot={snapshot} referenceMarket={reference} simulation={simulation} onSelect={choose}/>}
    </AnimatedCollapse>
  </section>
}
