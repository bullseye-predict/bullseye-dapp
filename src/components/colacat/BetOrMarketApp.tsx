import '../../styles/home.css'
import '../../styles/colacat.css'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { AppShell } from '../solz/AppShell'
import { useReveal } from './useReveal'

/**
 * /bet-or-market - the long version of the last beat on /colacat.
 *
 * The owner's note reads "then at the bottom -> the different of BET vs
 * PREDICTION MARKET -> lead to oter page and explain it". /colacat states the
 * difference in three lines; this page is where it is actually explained, so
 * the lore page can stay a lore page.
 *
 * SAME SHEET, SAME PREFIX. It wears `solz-home cola-app` and reuses colacat.css
 * rather than starting a third stylesheet: a reader arrives here by following a
 * link from that page and must not feel they have left the product.
 *
 * NO TRADING COLOUR HERE EITHER. AGENTS.md reserves green and red for a control
 * where a trader picks Yes or No. Drawing "a bet" in red would be this page
 * making a risk judgement in paint rather than in prose, so both columns are
 * neutral and lime marks only the thing you can act on.
 */

type Props = {
  colacatHref?: string
  marketsHref?: string
  arenaHref?: string
}

type Beat = { id: string; title: string; meta: string; body: string[] }

/**
 * The argument, in the order a reader needs it: who is on the other side, then
 * where the price comes from, then whether you can leave, then what the venue
 * earns, then what "settled" means, then where the book itself lives - and
 * last, honestly, what an on-chain book costs the person using it today.
 *
 * THE LAST BEAT IS NOT A DISCLAIMER TO BE SOFTENED. A page that argues for a
 * design without naming its price is an advertisement. The trade is real - an
 * order is a transaction, so it is slower and it takes more steps - and saying
 * so is what makes the six beats above it worth believing.
 */
const BEATS: readonly Beat[] = [
  {
    id: 'counterparty',
    title: 'Who is on the other side',
    meta: '01 · Counterparty',
    body: [
      'In a bet, the house is your counterparty. It wins when you lose, which means the only party setting your odds is the party that profits from them being wrong for you.',
      'In a prediction market, another trader is on the other side. They think the opposite of you and they are risking their own money on it. The venue is not in the trade at all — it matches you and keeps the book.',
    ],
  },
  {
    id: 'price',
    title: 'Where the price comes from',
    meta: '02 · Price',
    body: [
      'A bookmaker publishes a price with its margin already baked in. You cannot see the margin and you cannot trade against it. The number is an offer, take it or leave it.',
      'A market price is the last thing somebody actually paid. A contract trading at 62¢ is the crowd saying roughly 62% — and if you disagree you do not argue with the house, you post your own order and let somebody take it.',
    ],
  },
  {
    id: 'exit',
    title: 'Whether you can leave',
    meta: '03 · Exit',
    body: [
      'A bet is locked from the moment you place it. New information arrives, the situation changes, and you still hold exactly what you held — there is nothing to do but wait for the result.',
      'A position is a thing you own. You can sell it at any time to anybody who wants it, before the question resolves. Being right early and taking the profit is a legitimate outcome here; in a bet it does not exist.',
    ],
  },
  {
    id: 'venue',
    title: 'What the venue earns',
    meta: '04 · The venue',
    body: [
      'A bookmaker earns the difference between the true odds and the odds it published. Its income grows as its prices get worse for you.',
      'This venue earns a fee on trades. The fee is the same whether you win or lose, so nothing about our income depends on you being wrong. We would rather the book were busy than that it were one-sided.',
    ],
  },
  {
    id: 'settlement',
    title: 'What settled means',
    meta: '05 · Settlement',
    body: [
      'Both end the same way: the question is answered and the winning side is paid. The difference is everything before that moment.',
      'A bet settles inside the house. It tells you the result, it tells you what you are owed, and the arithmetic between those two is its own. Here settlement is a transaction: the contract pays, and the payment is the record.',
    ],
  },
  {
    id: 'onchain',
    title: 'Where the order book lives',
    meta: '06 · The record',
    body: [
      'This is an on-chain central limit order book. Not just the settlement — the resting orders, the cancellations, the fills and the payouts are all accounts and transactions on Solana. Anyone can read the book without asking us, and nothing we say about it can differ from what is there.',
      'That is not how most prediction venues work. The common design keeps matching on the operator\u2019s own servers for speed and writes only the outcome to a chain — Polymarket is the best known example of it. Settlement is verifiable; the book that produced it is the operator\u2019s report. When a venue is the only witness to its own order flow, "trust us" is doing quiet work in the middle of the sentence.',
    ],
  },
  {
    id: 'cost',
    title: 'What it costs us to do it this way',
    meta: '07 · The trade-off',
    body: [
      'An on-chain book is slower. Every order is a transaction, so placing, cancelling and filling all wait on the network instead of on a matching engine in memory. Today the flow also asks more of you than it should: more steps, more screens, more confirmations between deciding and being filled.',
      'We are working on both, and we would rather say so than let you find out. The reason we are paying that cost is the previous section: the moment the book moves off chain to get fast, it stops being something you can check, and checking it is the whole point.',
    ],
  },
]

export function BetOrMarketApp({
  colacatHref = '/colacat',
  marketsHref = '/markets',
  arenaHref = '/#highlight',
}: Props) {
  const [headNode, headShown] = useReveal<HTMLElement>()

  return (
    <AppShell
      className="solz-home cola-app cola-explainer"
      mainId="bet-or-market"
      mainClassName="cola-main"
      active="colacat"
      marketsHref={marketsHref}
      skipTo="#bet-or-market"
      skipLabel="Skip to the explanation"
    >
      <header ref={headNode} className={`cola-head is-narrow ${headShown ? 'is-revealed' : ''}`}>
        <div className="cola-head-title">
          <a className="cola-back" href={colacatHref}><ArrowLeft size={13} aria-hidden="true" /> ColaCat</a>
          <h1>What is the difference: bet vs prediction market</h1>
          <p>
            They look alike from the outside — you pick a side, you put money on it, one of you is right.
            Seven things underneath are different. Six of them are in your favour here; the seventh is the
            price we pay for the sixth, and it is written down at the bottom of this page.
          </p>
        </div>
      </header>

      {/* The summary that /colacat prints, restated at the top so this page
          answers the question before it explains it. */}
      <section className="cola-section cola-versus is-revealed">
        <div className="cola-versus-grid">
          <article className="cola-versus-card">
            <h2>A bet</h2>
            <dl>
              <div><dt>Against</dt><dd>The house</dd></div>
              <div><dt>Price</dt><dd>Set by the house, margin inside it</dd></div>
              <div><dt>Exit</dt><dd>None — wait for the result</dd></div>
              <div><dt>Venue earns</dt><dd>More when the price is worse for you</dd></div>
              <div><dt>The book</dt><dd>The house's own ledger</dd></div>
            </dl>
          </article>
          <article className="cola-versus-card is-market">
            <h2>A prediction market</h2>
            <dl>
              <div><dt>Against</dt><dd>Another trader</dd></div>
              <div><dt>Price</dt><dd>The last price somebody paid</dd></div>
              <div><dt>Exit</dt><dd>Sell any time, before it resolves</dd></div>
              <div><dt>Venue earns</dt><dd>A flat fee, win or lose</dd></div>
              <div><dt>The book</dt><dd>On chain, and readable by anyone</dd></div>
            </dl>
          </article>
        </div>
      </section>

      {BEATS.map((beat) => <Beat key={beat.id} beat={beat} />)}

      <section className="cola-section cola-close is-revealed">
        <h2>So what do I actually do</h2>
        <p>
          Open a market, read the price as a probability, and take the side you think is mispriced.
          If the price moves your way you can sell before the answer arrives. If it does not, you hold and find out.
          Every step of that leaves a record you can check afterwards, which is the part we are not willing to give up.
        </p>
        <div className="cola-actions">
          <a className="cola-button is-primary" href={marketsHref}>See the markets <ArrowRight size={14} aria-hidden="true" /></a>
          <a className="cola-button" href={arenaHref}>Watch a match first <ArrowRight size={14} aria-hidden="true" /></a>
          <a className="cola-button" href={colacatHref}>Back to ColaCat <ArrowRight size={14} aria-hidden="true" /></a>
        </div>
        <p className="cola-foot">
          Prediction markets carry risk and a contract can settle at zero. Nothing here is financial advice.
        </p>
      </section>
    </AppShell>
  )
}

function Beat({ beat }: { beat: Beat }) {
  const [node, shown] = useReveal<HTMLElement>()
  return (
    <section id={beat.id} ref={node} className={`cola-section cola-beat ${shown ? 'is-revealed' : ''}`}>
      <header className="cola-section-head">
        <h2>{beat.title}</h2>
        <i className="cola-leader" aria-hidden="true" />
        <span className="cola-section-meta">{beat.meta}</span>
      </header>
      <div className="cola-beat-body">
        {beat.body.map((line, index) => <p key={index} className={index === 0 ? 'cola-dim' : undefined}>{line}</p>)}
      </div>
    </section>
  )
}
