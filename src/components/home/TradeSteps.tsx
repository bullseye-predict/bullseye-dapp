import './TradeSteps.css'
import { AlertTriangle, ArrowUpRight, Check, Info, Loader, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { amountLabel } from './HomePrimitives'
import { LIMIT_LEGS, type StepCost, type StepPlan, type StepRow, type StepStatus } from '../../../packages/adapters/solana/manifest/steps'
import { readWalletError } from '../../../packages/adapters/solana/manifest/messages'

/** Below the fourth decimal the figure is noise, and "0.0000 SOL" reads as free
 *  rather than as negligible. */
const SOL = new Intl.NumberFormat('en', { maximumFractionDigits: 4 })
export const solLabel = (lamports: bigint, estimated: boolean) =>
  lamports < 100_000n ? 'under 0.0001 SOL' : `${estimated ? '≈' : ''}${SOL.format(Number(lamports) / 1e9)} SOL`

const STATUS: Record<StepStatus, string> = {
  planned: 'Waiting',
  preparing: 'Checking',
  signing: 'Approve in wallet',
  sent: 'Done',
  failed: 'Failed',
  uncertain: 'Unconfirmed',
  skipped: 'Not needed',
}

const ICON: Record<StepStatus, typeof Info> = {
  planned: Info,
  preparing: Loader,
  signing: Loader,
  sent: Check,
  failed: X,
  uncertain: AlertTriangle,
  skipped: Info,
}

type Props = {
  rows: StepRow[]
  /** The plan the rail is reconciled against. The count line is read off this
   *  rather than off `rows`, so the denominator is the number the invoice
   *  already showed instead of one the trader watches climb. */
  plan: StepPlan
  collateralSymbol: string
  collateralDecimals: number
  settled: boolean
  onRetry?: () => void
  retrying?: boolean
  explorerUrl?: (signature: string) => string | undefined
}

const atomsLabel = (atoms: bigint, decimals: number, symbol: string) =>
  `${amountLabel(Number(atoms) / 10 ** decimals)} ${symbol}`

/** The one-line cost for the rail. Rent and fee collapse into one SOL figure,
 *  because what matters at a glance is what leaves the wallet, not which of the
 *  two ledgers it leaves by. */
function chip(costs: StepCost[], decimals: number, symbol: string) {
  const lamports = costs.filter(cost => cost.asset === 'SOL').reduce((total, cost) => total + cost.amount, 0n)
  const estimated = costs.some(cost => cost.asset === 'SOL' && cost.estimated)
  const fund = costs.find(cost => cost.kind === 'fund')
  const upfront = costs.find(cost => cost.kind === 'upfront')
  const returned = costs.find(cost => cost.kind === 'return')
  if (fund) return atomsLabel(fund.amount, decimals, symbol)
  if (upfront) return `${atomsLabel(upfront.amount, decimals, symbol)} back`
  if (returned) return `+${atomsLabel(returned.amount, decimals, symbol)}`
  return solLabel(lamports, estimated)
}

/**
 * The dialog, once a trade has been agreed to. One row per wallet prompt.
 *
 * A failure keeps its message directly under the rail rather than behind a
 * click, next to the button that retries it: that is the whole reason a trader
 * is looking at a stopped trade.
 */
export function TradeSteps({ rows, plan, collateralSymbol, collateralDecimals, settled, onRetry, retrying, explorerUrl }: Props) {
  const [open, setOpen] = useState<string | null>(null)
  const active = rows.find(row => row.status === 'preparing' || row.status === 'signing')
  const failed = rows.find(row => row.status === 'failed')
  const unconfirmed = rows.find(row => row.status === 'uncertain')
  const done = rows.filter(row => row.status === 'sent').length
  const stopped = failed ?? unconfirmed
  // The count the invoice promised, held in front of the trader for the whole
  // run. `rows.length` used to be the denominator, and it grows: a repeating
  // step fans out one row per leg and an unforeseen transaction splices in
  // another, so "2 of 2 done" appeared — reading as a finished trade — with two
  // wallet prompts still to come. A run that passes the promised ceiling says
  // so in words rather than quietly raising the number.
  const over = rows.length > plan.most
  const count = over
    ? `${done} signed · more than the ${plan.most} planned`
    // A finished run reports what it did. Until then the denominator is the one
    // the invoice promised, so it cannot move while the trader is signing.
    : settled
      ? `${done} of ${rows.length} signed`
      : plan.approximate
        ? `${done} signed of ${plan.least} to ${plan.most}`
        : `${done} of ${plan.most} signed`

  // Follow the flow rather than whatever was last inspected: the step in flight
  // is the one worth reading about while a wallet prompt is up.
  useEffect(() => {
    if (active) setOpen(active.id)
  }, [active?.id])

  const selected = rows.find(row => row.id === open) ?? null

  return (
    <section className="ch-tx" aria-label="Transactions in this trade">
      <p className={`ch-tx-summary ${failed ? 'is-error' : over || unconfirmed ? 'is-warning' : settled ? 'is-done' : ''}`}>
        <strong>{count}</strong>
        {active && <span>{STATUS[active.status]}</span>}
      </p>
      {over && (
        <p className="ch-tx-quiet">
          The books or your accounts changed while you were signing, so this trade needed more transactions
          than the {plan.most} it planned for. Every one of them is on this list and in Activity.
        </p>
      )}

      <ol className="ch-tx-steps">
        {rows.map((row, index) => {
          const Icon = ICON[row.status]
          return (
            <li key={row.id} className={`is-${row.status}${row.id === open ? ' is-open' : ''}`}>
              <button
                type="button"
                aria-expanded={row.id === open}
                onClick={() => setOpen(current => (current === row.id ? null : row.id))}
              >
                <span className="ch-tx-index" aria-hidden="true">
                  {row.status === 'sent' || row.status === 'failed' ? <Icon size={11} /> : index + 1}
                </span>
                <span className="ch-tx-body">
                  <strong>{row.title}</strong>
                  <span className="ch-tx-status">
                    {STATUS[row.status]}
                    {row.leg ? ` · leg ${row.leg} of ${row.legs}` : ''}
                    {row.attempts > 1 ? ` · try ${row.attempts}` : ''}
                  </span>
                  <span className="ch-tx-cost">
                    {row.status === 'skipped' ? '—' : chip(row.costs, collateralDecimals, collateralSymbol)}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ol>

      {stopped && (
        <div className={`ch-tx-stopped ${failed ? 'is-error' : 'is-warning'}`} role="alert">
          <strong>
            {failed ? 'Stopped at' : 'Unconfirmed at'} step {rows.indexOf(stopped) + 1} · {stopped.title}
          </strong>
          {/* Translated at the edge: web3.js formats a refused read as
              `${status} ${statusText}: ${body}`, and with an empty statusText
              over HTTP/2 that reached the trader as a raw JSON-RPC envelope.
              The raw text is kept below so a bug report still carries it. */}
          <p>{stopped.error ? readWalletError(stopped.error).message : 'This transaction did not confirm.'}</p>
          {stopped.error && readWalletError(stopped.error).message !== stopped.error && (
            <details className="ch-tx-quiet">
              <summary>Technical detail</summary>
              <code>{stopped.error}</code>
            </details>
          )}
          <p className="ch-tx-quiet">
            {done > 0
              ? `${done} earlier step${done === 1 ? '' : 's'} already confirmed. Retrying picks up from here.`
              : 'Nothing was signed.'}
            {!failed ? ' Check the transaction before retrying.' : ''}
          </p>
          <div className="ch-tx-actions">
            {onRetry && (
              <button type="button" onClick={onRetry} disabled={retrying}>
                {retrying ? 'Retrying…' : 'Try again'}
              </button>
            )}
            {stopped.signature && explorerUrl?.(stopped.signature) && (
              <a href={explorerUrl(stopped.signature)} target="_blank" rel="noreferrer">
                View transaction <ArrowUpRight size={11} />
              </a>
            )}
          </div>
        </div>
      )}

      {selected && selected !== stopped && (
        <div className="ch-tx-detail" role="region" aria-label={`About ${selected.title}`}>
          <strong>{selected.title}</strong>
          {/* The label the wallet itself showed. One planned step can arrive
              under more than one of these, so naming the one that actually ran
              is the difference between "it filled" and "it is resting". */}
          {selected.status !== 'planned' && selected.status !== 'skipped' && (
            <span className="ch-tx-label">{selected.step}</span>
          )}
          <p>
            {selected.status === 'skipped'
              ? selected.skipped === 'already-open'
                ? 'Not needed — already open.'
                : selected.skipped === 'already-done'
                  ? 'Not needed — this order had already left the book, or the seat was already empty.'
                  : selected.skipped === 'nothing-held'
                    ? 'Not needed — there was nothing held here to move by the time this step ran.'
                    : 'Not needed — the book changed while you were signing.'
              : selected.detail}
          </p>
          {/* Not once per price level: one order takes every level of a book
              that beats the other book's best price, so a run of levels on one
              side is a single signature. The account step is the one repeat that
              has nothing to do with the books — it is one set per route. */}
          {selected.repeats && selected.status !== 'skipped' && (
            <p className="ch-tx-quiet">
              {selected.kind === 'prepare-accounts' && selected.repeats.least === 0
                ? 'One account set per route. A trade that keeps to one route prepares one set and marks the other "Not needed".'
                : selected.kind === 'prepare-accounts'
                  ? `One account set per outcome. This signs ${selected.repeats.most} time${selected.repeats.most === 1 ? '' : 's'}.`
                : selected.repeats.least === 0
                  ? `Signs up to ${selected.repeats.most} times, or not at all.`
                  : selected.repeats.least === selected.repeats.most
                    ? `Signs ${selected.repeats.least} time${selected.repeats.least === 1 ? '' : 's'}.`
                    : `Signs ${selected.repeats.least} time${selected.repeats.least === 1 ? '' : 's'} as the books stand, and up to ${selected.repeats.most}.`}
            </p>
          )}
          {selected.costs.length > 0 && selected.status !== 'skipped' && (
            <dl>
              {selected.costs.map(cost => (
                <div key={`${cost.asset}-${cost.kind}`}>
                  <dt>{costLabel(cost)}</dt>
                  <dd>
                    {cost.asset === 'SOL'
                      ? solLabel(cost.amount, cost.estimated)
                      : atomsLabel(cost.amount, collateralDecimals, collateralSymbol)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {selected.signature && explorerUrl?.(selected.signature) && (
            <a href={explorerUrl(selected.signature)} target="_blank" rel="noreferrer">
              View transaction <ArrowUpRight size={11} />
            </a>
          )}
        </div>
      )}
    </section>
  )
}

const costLabel = (cost: StepCost) =>
  cost.kind === 'rent'
    ? 'Account rent and fee'
    : cost.kind === 'fee'
      ? 'Network fee'
      : cost.kind === 'fund'
        ? 'Collateral moved'
        : cost.kind === 'upfront'
          ? 'Returned same transaction'
          : cost.kind === 'return'
            ? 'Paid back to your wallet'
            : 'Max taker fee'

/**
 * The count and cost a trade commits to, for the invoice pane.
 *
 * Wallet prompts, never nodes on a list. This line used to print how many
 * entries the plan held, which is a different quantity: one limit-buy entry
 * stands for up to LIMIT_LEGS signatures, so a trade announced as "Up to 2
 * transactions" asked for four and read, from the outside, as a trade hiding
 * transactions from the trader.
 *
 * A range rather than a hedge. "Up to" is gone: it was read as a ceiling and it
 * was neither a ceiling nor a count of the right thing. The left number is what
 * the books support now, the right one is what the loops behind the plan cannot
 * pass, and four transactions land inside a number that was on screen before
 * the first prompt.
 */
export function TradeStepsSummary({ plan, firstOpen }: { plan: StepPlan; firstOpen: boolean }) {
  // The limit-buy execute node, and only that one. Both limit-buy routes carry
  // this id; no sell and no market order emits it. Matching any repeating node
  // put this paragraph on a limit SELL, which never walks two books at all.
  const repeating = plan.steps.find(step => step.id === 'match-leg')
  return (
    <div className={`ch-tx-brief ${firstOpen ? 'is-opening' : ''}`}>
      <p>
        <strong>
          {plan.approximate
            ? `${plan.least} to ${plan.most} transactions`
            : `${plan.most} transaction${plan.most === 1 ? '' : 's'}`}
        </strong>
        <span>{solLabel(plan.lamports, plan.estimated)} network cost</span>
      </p>
      {firstOpen && <p className="ch-tx-quiet">You are opening this market. It is created once, for everyone after you.</p>}
      {/* The sentence this replaced — "A limit order signs once per price level
          it takes" — was false, and it is the reason a long ladder was expected
          to cost a signature a rung. One order takes every level of a book that
          beats the other book's best price. A new signature starts where the
          cheaper book changes. */}
      {repeating && (
        <p className="ch-tx-quiet">
          A limit order fills in legs. One leg takes every price level on the cheaper book that is at or under
          your limit; the next starts where the other book becomes cheaper. Each leg signs its order, and a leg
          short of collateral signs a deposit first. Shares your limit cannot buy rest as one more transaction.
          A trade takes at most {LIMIT_LEGS} legs, and this one stops at {plan.most} transactions.
        </p>
      )}
      {plan.approximate && !repeating && (
        <p className="ch-tx-quiet">
          {/* On a sell the open question is where the shares are held, not
              which accounts exist: shares already on the book seat move
              nothing, and shares inside the position move twice. */}
          {plan.steps.some(step => step.kind === 'release-claims' || step.kind === 'deposit-claims')
            ? 'Where your shares are held decides how many of these are needed. You sign only the moves the book still asks for.'
            : 'Some of these accounts may already exist. You sign only what the chain still needs.'}
        </p>
      )}
    </div>
  )
}
