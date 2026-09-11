import { ArrowUpRight, ChevronDown, FileText, Layers } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { ArenaMarket, ArenaMarketOutcome, SolzSnapshot } from '../solz/model'
import { Tabs, TabPanel } from '../solz/ui'
import { AgentPortrait, amountLabel, compact, percent, TeamMark } from '../home/HomePrimitives'
import { outcomeColor } from '../home/heroMarket'
import { HighlightChart } from '../home/HighlightChart'
import { eventAnswerMarket, sampleOrderBook } from './eventModel'
import { baseOutcomeId } from '../solz/predictionContracts'

type Props = { actions?: ReactNode; markets: ArenaMarket[]; market: ArenaMarket; outcome: ArenaMarketOutcome; snapshot: SolzSnapshot; onSelect: (market: ArenaMarket, outcome: ArenaMarketOutcome, openTrade?: boolean) => void; prediction?: ArenaMarket; predictionHref: (market: ArenaMarket) => string }

function MarketDetail({ market, selected, snapshot, onSelect }: { market: ArenaMarket; selected: ArenaMarketOutcome; snapshot: SolzSnapshot; onSelect: (outcome: ArenaMarketOutcome) => void }) {
  const [tab, setTab] = useState<'book' | 'graph' | 'about'>('book')
  const book = sampleOrderBook(selected)
  const colors = market.outcomes.every((item) => item.label === 'Yes' || item.label === 'No') ? Object.fromEntries(market.outcomes.map((item) => [item.id, item.label === 'Yes' ? '#87dfb4' : '#f793a3'])) : undefined
  const prefix = `market-detail-${market.id}-${baseOutcomeId(selected.id)}`
  return <div className="ev-market-detail">
    <div className="ev-market-detail-tabs"><Tabs idPrefix={prefix} label={`${market.title} details`} value={tab} onChange={setTab} tabs={[{ id: 'book', label: 'Order book' }, { id: 'graph', label: 'Graph' }, { id: 'about', label: 'About' }]}/><span><Layers size={12}/> SAMPLE DEPTH</span></div>
    <TabPanel id="book" idPrefix={prefix} active={tab === 'book'}>
      <div className="ev-book-outcome"><label>Outcome<select value={selected.id} onChange={(event) => { const next = market.outcomes.find((item) => item.id === event.target.value); if (next) onSelect(next) }}>{market.outcomes.map((outcome) => <option key={outcome.id} value={outcome.id}>{outcome.label}</option>)}</select></label><span>Pays up to 1 COOLA per share</span></div>
      <table className="ev-order-book"><caption className="sr-only">Illustrative order book for {selected.label}, denominated in COOLA</caption><thead><tr><th scope="col">SIDE</th><th scope="col">PRICE</th><th scope="col">SHARES</th><th scope="col">TOTAL</th></tr></thead><tbody>{book.asks.map((row, i) => <tr className="is-ask" key={row.price} style={{ backgroundSize: `${row.depth}% 100%` }}><td>{i === book.asks.length - 1 && <span>Asks</span>}</td><td>{Math.round(row.price * 100)}¢</td><td>{amountLabel(row.shares)}</td><td>{amountLabel(row.total)}</td></tr>)}<tr className="ev-book-spread"><td colSpan={2}>Last: {Math.round(selected.probability * 100)}¢</td><td colSpan={2}>Spread: {Math.round(book.spread * 100)}¢</td></tr>{book.bids.map((row, i) => <tr className="is-bid" key={row.price} style={{ backgroundSize: `${row.depth}% 100%` }}><td>{i === 0 && <span>Bids</span>}</td><td>{Math.round(row.price * 100)}¢</td><td>{amountLabel(row.shares)}</td><td>{amountLabel(row.total)}</td></tr>)}</tbody></table>
    </TabPanel>
    <TabPanel id="graph" idPrefix={prefix} active={tab === 'graph'} className="ev-inline-chart"><HighlightChart market={market} snapshot={snapshot} outcome={selected} onOutcome={onSelect} colors={colors} onMarket={() => {}}/></TabPanel>
    <TabPanel id="about" idPrefix={prefix} active={tab === 'about'} className="ev-market-about"><h3><FileText size={15}/>Resolution rules</h3><p>{market.rules}</p><p>{market.description}</p><dl><div><dt>Trading closes</dt><dd>{new Date(market.closesAt).toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</dd></div><div><dt>Status</dt><dd>{market.status}</dd></div></dl></TabPanel>
  </div>
}

export function EventMarkets({ actions, markets, market, outcome, snapshot, onSelect, prediction, predictionHref }: Props) {
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
          <div id={`answer-detail-${answer.id}`} hidden={!open}><MarketDetail market={binary} selected={contract} snapshot={snapshot} onSelect={(pick) => onSelect(prediction, pick, false)}/></div>
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
        <div id={`event-market-${item.id}`} hidden={!open}><MarketDetail market={item} selected={selected} snapshot={snapshot} onSelect={(pick) => onSelect(item, pick, false)}/></div>
      </section>
    })}
  </section>
}
