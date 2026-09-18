import { ArrowUpRight } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { ArenaMarket, ArenaMarketOutcome, SolzSnapshot } from '../solz/model'
import { AgentPortrait, compact, percent, TeamMark } from '../home/HomePrimitives'
import { outcomeColor } from '../home/heroMarket'
import { eventAnswerMarket, eventMarketVolume } from './eventModel'
import { PredictionDetail } from '../home/PredictionDetail'
import { MarketErrorBoundary } from '../home/MarketErrorBoundary'
import { PRICE_PLACEHOLDER, quoteLabel } from '../home/venue/quoteLabels'
import { useTradeSide } from '../home/venue/tradeSide'
import { chanceText, normalisedChances } from '../markets/chance'
import { baseOutcomeId } from '../solz/predictionContracts'
import { OutcomeColumns, OutcomeRow, type RowPick } from '../markets/OutcomeRow'
import { outcomeMovement } from '../markets/marketMovement'
import { marketLineTitle, pickColor } from '../markets/moneyline'
import { useLogoPalette } from '../markets/logoIdentity'

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
  // A head-to-head pick is coloured from its crest, which is read asynchronously.
  useLogoPalette()
  const linked = !prediction && markets.length > 1 && markets.every((item) => item.presentation?.kind === 'linked')
  const headToHead = !prediction && markets.some((item) => item.presentation?.kind === 'head-to-head')
  // One row open at a time. Opening a second used to leave both books polling
  // and pushed the rest of the list off screen; closing the previous one is
  // what makes the list readable as a list.
  const [expanded, setExpanded] = useState<string | null>(prediction || linked || market.outcomes.length > 2 ? null : market.id)
  const toggle = (id: string) => setExpanded((previous) => previous === id ? null : id)
  // One winner among many: the chances are a distribution over the whole field,
  // recomputed from whatever the books currently say.
  const side = useTradeSide()
  // The third column names what the two buttons under it now quote.
  const callCaption = side === 'sell' ? 'SELL PRICE' : 'BUY PRICE'
  const predictionChances = normalisedChances(prediction?.outcomes ?? [])
  const linkedChances = normalisedChances(linked ? markets.map((item) => item.outcomes[0]) : [])
  return <section className={`ev-markets ${prediction ? 'ev-prediction-answers' : ''}`} id="event-markets" aria-labelledby="event-markets-title">
    <div className="ev-section-title"><h2 id="event-markets-title">{prediction || linked ? 'Choose your answer' : headToHead ? 'Match markets' : 'Event questions'} <span>{prediction ? prediction.outcomes.length : markets.length}</span></h2>{actions}</div>
    {prediction ? <>
      <OutcomeColumns call={callCaption}/>
      {prediction.outcomes.map((answer, index) => {
        const chance = predictionChances[index]
        const selected = baseOutcomeId(outcome.id) === answer.id
        const binary = eventAnswerMarket(prediction, answer, collateral)
        const contract = selected ? binary.outcomes.find((item) => item.id === outcome.id) ?? binary.outcomes[0] : binary.outcomes[0]
        const open = expanded === answer.id
        const accent = outcomeColor(answer, snapshot, index)
        const picks: RowPick[] = binary.outcomes.map((pick, index_) => ({
          key: pick.id, label: pick.label, tone: index_ === 0 ? 'yes' : 'no',
          price: pick.indicative ? PRICE_PLACEHOLDER : quoteLabel(pick, binary.onchain?.family === 'SOLANA', side, index_ === 1),
          color: pickColor(binary, pick, snapshot, index_),
          ariaLabel: `${pick.label} on ${answer.label}`,
          pressed: selected && outcome.id === pick.id,
          onClick: () => onSelect(prediction, pick),
        }))
        return <OutcomeRow
          key={answer.id} id={`answer-${answer.id}`} selected={selected} accent={accent}
          media={answer.participantId ? <AgentPortrait number={Number(answer.participantId.split('-')[1])}/> : <TeamMark id={answer.teamId ?? answer.id} color={accent}/>}
          title={answer.label} subtitle={answer.detail ?? 'Match winner'}
          chance={chanceText(chance)} chanceLabel={`${answer.label} chance`} movement={outcomeMovement(answer)}
          picks={picks}
          open={open} onOpenChange={() => { toggle(answer.id); if (!selected) onSelect(prediction, binary.outcomes[0], false) }}
        ><MarketDetail market={binary} selected={contract} snapshot={snapshot} simulation={simulation} collateral={collateral} active={open} onSelect={(pick) => onSelect(prediction, pick, false)}/></OutcomeRow>
      })}
    </> : linked ? <>
      <OutcomeColumns chance="CHANCE" call={callCaption}/>
      {markets.map((item, index) => {
        const chance = linkedChances[index]
        const answer = item.presentation?.answer
        const selected = item.id === market.id
        const selectedOutcome = selected ? outcome : item.outcomes[0]!
        const open = expanded === item.id
        const volume = eventMarketVolume(item)
        const accent = outcomeColor(item.outcomes[0]!, snapshot, index)
        const label = answer?.label ?? item.title
        const picks: RowPick[] = item.outcomes.slice(0, 2).map((pick, index_) => ({
          key: pick.id, label: pick.label, tone: index_ === 0 ? 'yes' : 'no',
          price: quoteLabel(pick, item.onchain?.family === 'SOLANA', side),
          color: pickColor(item, pick, snapshot, index_),
          ariaLabel: `${pick.label} on ${label}`,
          pressed: selected && outcome.id === pick.id,
          onClick: () => onSelect(item, pick),
        }))
        return <OutcomeRow
          key={item.id} id={`event-${item.id}`} selected={selected} accent={accent}
          media={answer?.imageUrl ? <img className="mk-row-image" src={answer.imageUrl} alt=""/> : answer?.participantId ? <AgentPortrait number={Number(answer.participantId.split('-')[1])}/> : <TeamMark id={answer?.teamId ?? item.id} color={accent}/>}
          title={label} subtitle={`${volume > 0 ? compact(volume) : '0'} ${collateral} Vol.`}
          chance={chanceText(chance)} chanceLabel={`${label} chance`} movement={outcomeMovement(item.outcomes[0]!)}
          picks={picks}
          open={open} onOpenChange={() => { toggle(item.id); if (!selected) onSelect(item, item.outcomes[0]!, false) }}
        ><MarketDetail market={item} selected={selectedOutcome} snapshot={snapshot} simulation={simulation} collateral={collateral} active={open} onSelect={(pick) => onSelect(item, pick, false)}/></OutcomeRow>
      })}
    </> : markets.map((item, index) => {
      if (item.outcomes.length > 2) return <a className="ev-prediction-link" key={item.id} id={`event-${item.id}`} href={predictionHref(item)}>
        <div><span className="ev-prediction-kind">{item.outcomes.length} ANSWERS</span><h3>{item.title}</h3><p>{compact(eventMarketVolume(item))} {collateral} VOL.</p></div>
        <div className="ev-prediction-preview">{[...item.outcomes].sort((a, b) => b.probability - a.probability).slice(0, 3).map((pick, rank) => <span key={pick.id}><i style={{ background: outcomeColor(pick, snapshot, rank) }}/>{pick.label}<b>{pick.indicative ? PRICE_PLACEHOLDER : percent(pick.probability)}</b></span>)}</div>
        <span className="ev-open-prediction">Open prediction <ArrowUpRight size={15}/></span>
      </a>
      const open = expanded === item.id
      const selected = item.id === market.id ? outcome : item.outcomes[0]
      const accent = outcomeColor(item.outcomes[0]!, snapshot, index)
      const picks: RowPick[] = item.outcomes.map((pick, index_) => ({
        key: pick.id, label: pick.label, tone: index_ === 0 ? 'yes' : 'no',
        price: item.onchain?.family === 'SOLANA' ? quoteLabel(pick, true, side) : pick.indicative ? PRICE_PLACEHOLDER : percent(pick.probability),
        color: pickColor(item, pick, snapshot, index_),
        ariaLabel: `${pick.label} on ${marketLineTitle(item)}`,
        pressed: item.id === market.id && outcome.id === pick.id,
        onClick: () => onSelect(item, pick),
      }))
      return <OutcomeRow
        key={item.id} id={`event-${item.id}`} selected={item.id === market.id} accent={accent}
        title={marketLineTitle(item)} subtitle={`${compact(eventMarketVolume(item))} ${collateral} VOL.`}
        picks={picks}
        open={open} onOpenChange={() => toggle(item.id)}
      ><MarketDetail market={item} selected={selected} snapshot={snapshot} simulation={simulation} collateral={collateral} active={open} onSelect={(pick) => onSelect(item, pick, false)}/></OutcomeRow>
    })}
  </section>
}
