import './TradeSteps.css'
import { AlertTriangle, ArrowUpRight, Check, Info, Loader, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { amountLabel } from './HomePrimitives'
import type { StepCost, StepPlan, StepRow, StepStatus } from '../../../packages/adapters/solana/manifest/steps'

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
  if (fund) return atomsLabel(fund.amount, decimals, symbol)
  if (upfront) return `${atomsLabel(upfront.amount, decimals, symbol)} back`
  return solLabel(lamports, estimated)
}

/**
 * The dialog, once a trade has been agreed to. One row per wallet prompt.
 *
 * A failure keeps its message directly under the rail rather than behind a
 * click, next to the button that retries it: that is the whole reason a trader
 * is looking at a stopped trade.
 */
export function TradeSteps({ rows, collateralSymbol, collateralDecimals, settled, onRetry, retrying, explorerUrl }: Props) {
  const [open, setOpen] = useState<string | null>(null)
  const active = rows.find(row => row.status === 'preparing' || row.status === 'signing')
  const failed = rows.find(row => row.status === 'failed')
  const unconfirmed = rows.find(row => row.status === 'uncertain')
  const done = rows.filter(row => row.status === 'sent').length
  const stopped = failed ?? unconfirmed

  // Follow the flow rather than whatever was last inspected: the step in flight
  // is the one worth reading about while a wallet prompt is up.
  useEffect(() => {
    if (active) setOpen(active.id)
  }, [active?.id])

  const selected = rows.find(row => row.id === open) ?? null

  return (
    <section className="ch-tx" aria-label="Transactions in this trade">
      <p className={`ch-tx-summary ${failed ? 'is-error' : unconfirmed ? 'is-warning' : settled ? 'is-done' : ''}`}>
        <strong>
          {done} of {rows.length} done
        </strong>
        {active && <span>{STATUS[active.status]}</span>}
      </p>

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
                    {row.leg ? ` · leg ${row.leg}` : ''}
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
          <p>{stopped.error ?? 'This transaction did not confirm.'}</p>
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
                : 'Not needed — the book changed while you were signing.'
              : selected.detail}
          </p>
          {selected.repeats && selected.status !== 'skipped' && (
            <p className="ch-tx-quiet">Runs once per price level, up to {selected.repeats.most} times.</p>
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
          : 'Max taker fee'

/** The count and cost a trade commits to, for the invoice pane. Two facts, no
 *  paragraph: the rail itself carries the rest once the trade is under way. */
export function TradeStepsSummary({ plan, firstOpen }: { plan: StepPlan; firstOpen: boolean }) {
  return (
    <div className={`ch-tx-brief ${firstOpen ? 'is-opening' : ''}`}>
      <p>
        <strong>
          {plan.approximate ? 'Up to ' : ''}
          {plan.steps.length} transaction{plan.steps.length === 1 ? '' : 's'}
        </strong>
        <span>{solLabel(plan.lamports, plan.estimated)} network cost</span>
      </p>
      {firstOpen && <p className="ch-tx-quiet">You are opening this market. It is created once, for everyone after you.</p>}
      {plan.approximate && plan.steps.some(step => step.repeats) && (
        <p className="ch-tx-quiet">A limit order signs once per price level it takes.</p>
      )}
    </div>
  )
}
