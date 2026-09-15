import '../../styles/home-markets.css'
import { useEffect, useState } from 'react'
import { formatUnits } from 'viem'
import type { ArenaMarket, ArenaMarketOutcome, SolzMatch, SolzSnapshot } from '../solz/model'
import type { PredictionAnswer } from '../solz/predictionContracts'
import { AgentPortrait, compact, TeamMark } from './HomePrimitives'
import { matchIdLabel, outcomeColor } from './heroMarket'
import { PredictionDetail } from './PredictionDetail'
import { MarketErrorBoundary } from './MarketErrorBoundary'
import { quoteLabel } from './venue/quoteLabels'
import { useTradeSide } from './venue/tradeSide'
import { chanceText, normalisedChances } from '../markets/chance'
import { MatchAvatar } from '../portfolio/matchIdentity'
import { OutcomeRow, type RowPick } from '../markets/OutcomeRow'
import { outcomeMovement } from '../markets/marketMovement'
import { marketLineTitle, pickColor } from '../markets/moneyline'

type Props = {
  markets: ArenaMarket[]; market: ArenaMarket; outcome: ArenaMarketOutcome; snapshot: SolzSnapshot
  answer?: PredictionAnswer; onSelect: (market: ArenaMarket, outcome: ArenaMarketOutcome, answer?: PredictionAnswer) => void
  simulation: boolean; referenceMarkets?: ArenaMarket[]; sourceLabel?: string
  /** The venue's own collateral symbol. Derived from the venue config, never
   *  guessed from the display label — which fell through to the literal word
   *  "collateral" for every source it did not know by name, Solana included. */
  collateral?: string
  match?: SolzMatch
}
export function PredictionOptions(props: Props) {
  const displayId = props.match ? matchIdLabel(props.match) : 'MATCH —'
  // One topic open at a time, owned here rather than inside each row: with the
  // state per row there was nothing to close the others with, and two open
  // books meant two polling panels and a list you had to scroll past to read.
  const [openTopic, setOpenTopic] = useState<string | null>(props.market.id)
  return <div className="ch-options" aria-label="Related predictions">
    <div className="ch-options-heading"><div><div className="ch-options-title"><h2>Make your call.</h2><span className="ch-options-match">{props.match && <MatchAvatar id={props.match.id}/>}<b>{displayId}</b></span></div><p>{props.markets.length} predictions · select a topic or an outcome</p></div><span className="ch-simulation">{props.sourceLabel ?? (props.simulation ? 'SAMPLE MARKETS' : 'NEON EVENT DRAFTS')}</span></div>
    <div className="ch-options-scroll" tabIndex={0} aria-label="Scrollable prediction options">{props.markets.map((item) => <PredictionTopic {...props} item={item} key={item.id} open={openTopic === item.id} onOpen={() => setOpenTopic((current) => current === item.id ? null : item.id)}/>)}</div>
  </div>
}
function PredictionTopic({ item, market, outcome, snapshot, answer = 'yes', onSelect, simulation, referenceMarkets, collateral: symbol, open, onOpen }: Props & { item: ArenaMarket; open: boolean; onOpen: () => void }) {
  const collateral = simulation ? 'COOLA' : symbol ?? 'collateral'
  const active = item.id === market.id
  const side = useTradeSide()
  // One answer open at a time, for the same reason as the topics above.
  const [nestedOpen, setNestedOpen] = useState<string | null>(null)
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
  // A row's price is only meaningful against a direction, and the ticket beside
  // it is already priced that way. `value === 'no'` is a NO contract off the
  // same book, so it reads the complement rather than the YES numbers.
  const displayedPrice = (pick: ArenaMarketOutcome, value: PredictionAnswer = 'yes') =>
    quoteLabel(pick, item.onchain?.family === 'SOLANA', side, value === 'no')
  const volumeLabel = simulation
    ? `${compact(item.volume.COOLA)} COOLA Vol.`
    : item.onchain?.volume24h
      ? `${item.onchain.volume24h.partial ? '≥ ' : ''}${Number(formatUnits(BigInt(item.onchain.volume24h.amount), item.onchain.volume24h.decimals)).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${collateral} 24h Vol.`
      : item.onchain ? 'Volume unavailable' : 'No market volume yet'
  const topicPicks: RowPick[] = multiple ? [] : item.outcomes.map((pick, index) => ({
    key: pick.id, label: pick.label, tone: index === 0 ? 'yes' : 'no',
    price: displayedPrice(pick),
    color: pickColor(item, pick, snapshot, index),
    ariaLabel: `${pick.label} on ${marketLineTitle(item)}`,
    pressed: active && outcome.id === pick.id,
    onClick: () => choose(pick),
  }))
  const nestedChances = multiple ? normalisedChances(item.outcomes) : []
  return <OutcomeRow
    id={`option-${item.id}`} selected={active}
    accent={outcomeColor(item.outcomes[0], snapshot, 0)}
    title={marketLineTitle(item)} subtitle={`${volumeLabel}${multiple ? ` · ${item.outcomes.length} outcomes` : ''}`}
    movement={multiple ? undefined : outcomeMovement(selected)}
    picks={topicPicks}
    open={open} onOpenChange={() => { onOpen(); choose(selected, selectedAnswer) }}
  >
    {multiple ? <div className="ch-outcome-list">{item.outcomes.map((pick, index) => {
      const picked = selected.id === pick.id
      const expanded = nestedOpen === pick.id
      const value = picked ? selectedAnswer : answers[pick.id] ?? 'yes'
      const accent = outcomeColor(pick, snapshot, index)
      // Multi-outcome: the identity colour dresses the answer, never the Buy
      // controls — each row is its own independent Yes/No book.
      const picks: RowPick[] = (['yes', 'no'] as const).map((answer_) => ({
        key: answer_, label: answer_ === 'yes' ? 'Yes' : 'No', tone: answer_,
        price: displayedPrice(pick, answer_),
        ariaLabel: `${answer_ === 'yes' ? 'Yes' : 'No'} · ${pick.label} · ${item.title}`,
        pressed: active && picked && value === answer_,
        onClick: () => choose(pick, answer_),
      }))
      return <OutcomeRow
        key={pick.id} id={`outcome-${pick.id}`} selected={active && picked} accent={accent}
        media={pick.participantId ? <AgentPortrait number={Number(pick.participantId.split('-')[1])}/> : <TeamMark id={pick.teamId ?? pick.id} color={accent}/>}
        title={pick.label}
        chance={chanceText(nestedChances[index])}
        chanceLabel={`${pick.label} chance`} movement={outcomeMovement(pick)}
        picks={picks}
        open={expanded}
        onOpenChange={() => { setNestedOpen((previous) => previous === pick.id ? null : pick.id); choose(pick, value) }}
      ><MarketErrorBoundary label={item.title}><PredictionDetail collateral={collateral} market={item} outcome={pick} answer={value} snapshot={snapshot} referenceMarket={reference} simulation={simulation} active={expanded} nested onSelect={choose}/></MarketErrorBoundary></OutcomeRow>
    })}</div> : <MarketErrorBoundary label={item.title}><PredictionDetail collateral={collateral} market={item} outcome={selected} snapshot={snapshot} referenceMarket={reference} simulation={simulation} onSelect={choose}/></MarketErrorBoundary>}
  </OutcomeRow>
}
