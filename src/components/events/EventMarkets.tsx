import { ArrowUpRight, ChevronDown, FileText, Layers } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { ArenaMarket, ArenaMarketOutcome, SolzSnapshot } from '../solz/model'
import { AgentPortrait, amountLabel, compact, percent, TeamMark } from '../home/HomePrimitives'
import { outcomeColor } from '../home/heroMarket'
import { eventAnswerMarket } from './eventModel'
import { PredictionDetail } from '../home/PredictionDetail'
import { MarketErrorBoundary } from '../home/MarketErrorBoundary'
import { baseOutcomeId } from '../solz/predictionContracts'

type Props = { actions?: ReactNode; markets: ArenaMarket[]; market: ArenaMarket; outcome: ArenaMarketOutcome; snapshot: SolzSnapshot; onSelect: (market: ArenaMarket, outcome: ArenaMarketOutcome, openTrade?: boolean) => void; prediction?: ArenaMarket; predictionHref: (market: ArenaMarket) => string; simulation?: boolean; collateral?: string }

/** The order book, graph and resolution panel are the highlight page's, not a
 *  copy: this used to render sampleOrderBook(), which invented depth for a
 *  market that may not exist on chain at all. PredictionDetail reads the venue
 *  and shows an empty book until someone actually opens the market. */
function MarketDetail({ market, selected, snapshot, onSelect, simulation, collateral, active }: { market: ArenaMarket; selected: ArenaMarketOutcome; snapshot: SolzSnapshot; onSelect: (outcome: ArenaMarketOutcome) => void; simulation: boolean; collateral: string; active: boolean }) {
  return <MarketErrorBoundary label={market.title}>
    <PredictionDetail market={market} outcome={selected} snapshot={snapshot} simulation={simulation} collateral={collateral} active={active} onSelect={(pick) => onSelect(pick)}/>
  </MarketErrorBoundary>
}

export function EventMarkets({ actions, markets, market, outcome, snapshot, onSelect, prediction, predictionHref, simulation = true, collateral = 'COOLA' }: Props) {
  const [expanded, setExpanded] = useState<string[]>(prediction || market.outcomes.length > 2 ? [] : [market.id])
  const toggle = (id: string) => setExpanded((previous) => previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id])
  return <section className={`ev-markets ${prediction ? 'ev-prediction-answers' : ''}`} id="event-markets" aria-labelledby="event-markets-title">
    <div className="ev-section-title"><h2 id="event-markets-title">{prediction ? 'Choose your answer' : 'Series markets'} <span>{prediction ? prediction.outcomes.length : markets.length}</span></h2>{actions}</div>
    {prediction ? <>
      <div className="ev-answer-columns"><span>ANSWER</span><span>CHANCE</span><span>YOUR CALL</span></div>
      {prediction.outcomes.map((answer, index) => {
        const selected = baseOutcomeId(outcome.id) === answer.id
        const binary = eventAnswerMarket(prediction, answer)
        const contract = selected ? binary.outcomes.find((item) => item.id === outcome.id) ?? binary.outcomes[0] : binary.outcomes[0]
        const open = expanded.includes(answer.id)
        return <section className={`ev-market ev-answer ${selected ? 'is-selected' : ''}`} key={answer.id} id={`answer-${answer.id}`}>
          <div className="ev-answer-summary">
            <h3><button aria-expanded={open} aria-controls={`answer-detail-${answer.id}`} onClick={() => { toggle(answer.id); if (!selected) onSelect(prediction, binary.outcomes[0], false) }}>
              {answer.participantId ? <AgentPortrait number={Number(answer.participantId.split('-')[1])}/> : <TeamMark id={answer.teamId ?? answer.id} color={outcomeColor(answer, snapshot, index)}/>}
              <span>{answer.label}<small>{answer.detail ?? 'Match winner'}</small></span><ChevronDown size={15}/>
            </button></h3>
            <strong className="ev-answer-chance">{percent(answer.probability)}</strong>
            <div className="ev-answer-picks" aria-label={`Trade ${answer.label}`}>
              {binary.outcomes.map((pick, side) => <button key={pick.id} className={side === 0 ? 'is-yes' : 'is-no'} aria-label={`${pick.label} on ${answer.label}`} aria-pressed={selected && outcome.id === pick.id} onClick={() => onSelect(prediction, pick)}><span>{pick.label}</span><b>{Math.round(pick.probability * 100)}¢</b></button>)}
            </div>
          </div>
          <div id={`answer-detail-${answer.id}`} hidden={!open}><MarketDetail market={binary} selected={contract} snapshot={snapshot} simulation={simulation} collateral={collateral} active={open} onSelect={(pick) => onSelect(prediction, pick, false)}/></div>
        </section>
      })}
    </> : markets.map((item) => {
      if (item.outcomes.length > 2) return <a className="ev-prediction-link" key={item.id} id={`event-${item.id}`} href={predictionHref(item)}>
        <div><span className="ev-prediction-kind">{item.outcomes.length} ANSWERS</span><h3>{item.title}</h3><p>{compact(item.volume.COOLA)} COOLA VOL.</p></div>
        <div className="ev-prediction-preview">{[...item.outcomes].sort((a, b) => b.probability - a.probability).slice(0, 3).map((pick, index) => <span key={pick.id}><i style={{ background: outcomeColor(pick, snapshot, index) }}/>{pick.label}<b>{percent(pick.probability)}</b></span>)}</div>
        <span className="ev-open-prediction">Open prediction <ArrowUpRight size={15}/></span>
      </a>
      const open = expanded.includes(item.id)
      const selected = item.id === market.id ? outcome : item.outcomes[0]
      return <section key={item.id} id={`event-${item.id}`} className={`ev-market ${item.id === market.id ? 'is-selected' : ''}`}>
        <div className="ev-market-summary"><h3><button aria-expanded={open} aria-controls={`event-market-${item.id}`} onClick={() => toggle(item.id)}><span>{item.title}<small>{compact(item.volume.COOLA)} COOLA VOL.</small></span><ChevronDown size={16}/></button></h3><div className="ev-market-picks">{item.outcomes.map((pick, index) => <button key={pick.id} className={index === 0 ? 'is-yes' : 'is-no'} aria-pressed={item.id === market.id && outcome.id === pick.id} onClick={() => onSelect(item, pick)}><span>{pick.label}</span><b>{percent(pick.probability)}</b></button>)}</div></div>
        <div id={`event-market-${item.id}`} hidden={!open}><MarketDetail market={item} selected={selected} snapshot={snapshot} simulation={simulation} collateral={collateral} active={open} onSelect={(pick) => onSelect(item, pick, false)}/></div>
      </section>
    })}
  </section>
}
