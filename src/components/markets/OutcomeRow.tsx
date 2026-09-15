import '../../styles/market-rows.css'
import type { ReactNode } from 'react'
import { AnimatedCollapse } from '../home/AnimatedCollapse'
import type { Movement } from './marketMovement'
import { pickInk } from './moneyline'

/** One trading control on a row. `color` is supplied only for a moneyline
 *  (two-sided team market), where the outcome's identity colour replaces the
 *  green/red pair. Multi-outcome rows leave it undefined: there the team colour
 *  belongs to the answer's text and mark, never to a Buy control. */
export type RowPick = {
  key: string
  label: string
  price: string
  tone: 'yes' | 'no'
  color?: string
  pressed: boolean
  ariaLabel?: string
  onClick: () => void
}

type Props = {
  /** Unique within the list; used to tie the toggle to its panel. */
  id: string
  media?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  /** Always a percentage on a multi-outcome list — never a one-sided "50¢ bid".
   *  Omitted on a topic row, which heads a list rather than quoting a price. */
  chance?: ReactNode
  chanceLabel?: string
  movement?: Movement
  picks: RowPick[]
  selected?: boolean
  /** Identity colour for the row's text and mark. */
  accent?: string
  onOpenChange?: (open: boolean) => void
  open?: boolean
  children?: ReactNode
}

export function OutcomeColumns({ answer = 'ANSWER', chance = 'CHANCE', call = 'YOUR CALL' }: { answer?: string; chance?: string; call?: string }) {
  return <div className="mk-row-columns" aria-hidden="true"><span>{answer}</span><span>{chance}</span><span>{call}</span></div>
}

/** The one row used by every market list: the event page's answer list, the
 *  home page's topic list and its nested multi-outcome list. Previously five
 *  hand-written copies across two files; a change to the chance column or the
 *  pick buttons had to be made five times and never was. */
const classes = (...names: Array<string | false | undefined>) => names.filter(Boolean).join(' ')

export function OutcomeRow({ id, media, title, subtitle, chance, chanceLabel, movement, picks, selected = false, accent, open, onOpenChange, children }: Props) {
  const headline = picks.length === 0 && chance === undefined
  const priceless = !headline && chance === undefined
  const expandable = Boolean(children)
  const isOpen = expandable && Boolean(open)
  const panelId = `${id}-panel`
  return <section className={classes('mk-row', selected && 'is-selected')} id={id} style={accent ? { '--team-color': accent } as React.CSSProperties : undefined}>
    <div className={classes('mk-row-summary', headline && 'is-headline', priceless && 'is-priceless')}>
      <h3 className="mk-row-name">
        <button
          id={`${id}-button`}
          type="button"
          {...(expandable ? { 'aria-expanded': isOpen, 'aria-controls': panelId } : {})}
          onClick={() => onOpenChange?.(!isOpen)}
        >
          {media}
          <span>{title}{subtitle !== undefined && <small>{subtitle}</small>}</span>
        </button>
      </h3>
      {chance === undefined ? null : <div className="mk-row-chance" aria-label={chanceLabel}>
        <strong>{chance}</strong>
        {/* No chip when nothing moved: a second placeholder stacked under the
            first one just read as a rendering fault. */}
        {movement && movement.direction !== 'flat' && <small className={`mk-row-move is-${movement.direction}`}>{movement.text}</small>}
      </div>}
      {headline ? null : <div className="mk-row-picks">
        {picks.map((pick) => <button
          key={pick.key}
          type="button"
          className={classes(`is-${pick.tone}`, pick.color && 'has-pick-color')}
          style={pick.color ? { '--pick-color': pick.color, '--pick-ink': pickInk(pick.color) } as React.CSSProperties : undefined}
          aria-label={pick.ariaLabel}
          aria-pressed={pick.pressed}
          onClick={pick.onClick}
        ><span>{pick.label}</span><b>{pick.price}</b></button>)}
      </div>}
    </div>
    {expandable && <AnimatedCollapse id={panelId} labelledBy={`${id}-button`} open={isOpen}>{children}</AnimatedCollapse>}
  </section>
}
