import type {
  ButtonHTMLAttributes,
  CSSProperties,
  HTMLAttributes,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
} from 'react'
import { useEffect, useRef, useState } from 'react'

/**
 * Marathon primitives. This file owns markup + class names only: no CSS imports, no app state,
 * no data fetching. Colours never appear as literals here; data-driven colour is handed to CSS
 * through the --mx-team custom property.
 */

export type PanelTone = 'acid' | 'magenta' | 'cyan' | 'dark'
export type TagTone = 'acid' | 'live' | 'magenta' | 'cyan' | 'dim'
export type AccentTone = 'acid' | 'magenta' | 'cyan' | 'up' | 'down'
export type Size = 'sm' | 'md' | 'lg'

type ClassInput = string | false | null | undefined

function cx(...parts: ClassInput[]): string {
  return parts.filter(Boolean).join(' ')
}

function toneVar(tone?: AccentTone): string | undefined {
  if (!tone) return undefined
  if (tone === 'up') return 'var(--mx-up)'
  if (tone === 'down') return 'var(--mx-down)'
  return `var(--mx-${tone})`
}

/** Attach a CSS custom property without leaking colour literals into the component tree. */
function withVar(name: string, value: string | undefined, base?: CSSProperties): CSSProperties | undefined {
  if (!value) return base
  return { ...(base ?? {}), [name]: value } as CSSProperties
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const pad = (n: number): string => String(n).padStart(2, '0')
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`
}

/* panels */

export type PanelProps = HTMLAttributes<HTMLElement> & { notch?: boolean; flush?: boolean }

export function Panel({ children, className, notch, flush, ...rest }: PanelProps) {
  const cls = cx('mx-panel', notch && 'mx-panel--notch', flush && 'mx-panel--flush', className)
  return <section className={cls} {...rest}>{children}</section>
}

export type PanelBarProps = {
  eyebrow?: ReactNode; title?: ReactNode; meta?: ReactNode; tone?: PanelTone; className?: string
  children?: ReactNode
}

export function PanelBar({ eyebrow, title, meta, tone = 'dark', className, children }: PanelBarProps) {
  return (
    <div className={cx('mx-panel__bar', `mx-panel__bar--${tone}`, className)}>
      {eyebrow ? <span className="mx-panel__eyebrow">{eyebrow}</span> : null}
      {title ? <span className="mx-panel__title">{title}</span> : null}
      {meta ? <span className="mx-panel__meta">{meta}</span> : null}
      {children}
    </div>
  )
}

export type PanelBodyProps = HTMLAttributes<HTMLDivElement>

export function PanelBody({ children, className, ...rest }: PanelBodyProps) {
  return <div className={cx('mx-panel__body', className)} {...rest}>{children}</div>
}

/* tags */

export type TagProps = HTMLAttributes<HTMLSpanElement> & { tone?: TagTone; outline?: boolean }

export function Tag({ children, tone, outline, className, ...rest }: TagProps) {
  const cls = cx('mx-tag', tone && `mx-tag--${tone}`, outline && 'mx-tag--outline', className)
  return <span className={cls} {...rest}>{children}</span>
}

export type BadgeProps = HTMLAttributes<HTMLSpanElement>

export function Badge({ children, className, ...rest }: BadgeProps) {
  return <span className={cx('mx-badge', className)} {...rest}>{children}</span>
}

export type NumProps = HTMLAttributes<HTMLSpanElement>

export function Num({ children, className, ...rest }: NumProps) {
  return <span className={cx('mx-num', className)} {...rest}>{children}</span>
}

export type EyebrowProps = HTMLAttributes<HTMLSpanElement>

export function Eyebrow({ children, className, ...rest }: EyebrowProps) {
  return <span className={cx('mx-eyebrow', className)} {...rest}>{children}</span>
}

export type DisplayProps = HTMLAttributes<HTMLDivElement>

export function Display({ children, className, ...rest }: DisplayProps) {
  return <div className={cx('mx-display', className)} {...rest}>{children}</div>
}

export function Rule({ className }: { className?: string }) {
  return <div className={cx('mx-rule', className)} aria-hidden="true" />
}

export function GridOverlay({ className }: { className?: string }) {
  return <div className={cx('mx-grid-overlay', className)} aria-hidden="true" />
}

export function Scanlines({ className }: { className?: string }) {
  return <div className={cx('mx-scan', className)} aria-hidden="true" />
}

/* tabs */

export type TabItem<T extends string> = { id: T; label: ReactNode; disabled?: boolean }

export type TabsProps<T extends string> = {
  tabs: ReadonlyArray<TabItem<T>>; value: T; onChange: (id: T) => void
  label: string; className?: string; idPrefix?: string
}

export function tabButtonId(idPrefix: string, id: string): string {
  return `${idPrefix}-${id}-tab`
}

export function tabPanelId(idPrefix: string, id: string): string {
  return `${idPrefix}-${id}-panel`
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  className,
  idPrefix = 'mx',
}: TabsProps<T>) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([])

  const move = (nextIndex: number): void => {
    const next = tabs[nextIndex]
    if (!next || next.disabled) return
    onChange(next.id)
    buttons.current[nextIndex]?.focus()
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const current = tabs.findIndex((tab) => tab.id === value)
    if (current < 0) return
    const last = tabs.length - 1
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault()
      move(current === last ? 0 : current + 1)
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault()
      move(current === 0 ? last : current - 1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      move(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      move(last)
    }
  }

  return (
    <div role="tablist" aria-label={label} className={cx('mx-tabs', className)} onKeyDown={onKeyDown}>
      {tabs.map((tab, index) => {
        const selected = tab.id === value
        return (
          <button
            key={tab.id}
            ref={(node) => {
              buttons.current[index] = node
            }}
            type="button"
            role="tab"
            id={tabButtonId(idPrefix, tab.id)}
            aria-controls={tabPanelId(idPrefix, tab.id)}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            disabled={tab.disabled}
            className="mx-tabs__tab"
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}

export type TabPanelProps = HTMLAttributes<HTMLDivElement> & {
  id: string; idPrefix?: string; active: boolean
}

export function TabPanel({ id, idPrefix = 'mx', active, children, className, ...rest }: TabPanelProps) {
  return (
    <div
      role="tabpanel"
      id={tabPanelId(idPrefix, id)}
      aria-labelledby={tabButtonId(idPrefix, id)}
      tabIndex={0}
      hidden={!active}
      className={className}
      {...rest}
    >
      {children}
    </div>
  )
}

/* buttons */

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'danger'; size?: 'sm'; block?: boolean
}

export function Button({ variant, size, block, className, type, children, ...rest }: ButtonProps) {
  const cls = cx(
    'mx-btn',
    variant && `mx-btn--${variant}`,
    size && `mx-btn--${size}`,
    block && 'mx-btn--block',
    className,
  )
  return <button type={type ?? 'button'} className={cls} {...rest}>{children}</button>
}

/* gauges */

export type SegBarProps = {
  value: number; total: number; cells?: number; tone?: AccentTone; label?: string; className?: string
}

export function SegBar({ value, total, cells = 12, tone, label, className }: SegBarProps) {
  const safeCells = Math.max(1, Math.floor(cells))
  const ratio = total > 0 ? Math.min(1, Math.max(0, value / total)) : 0
  const on = Math.round(ratio * safeCells)
  const readout = `${Math.round(ratio * 100)} percent`
  return (
    <div
      role="img"
      aria-label={label ? `${label}: ${readout}` : readout}
      className={cx('mx-seg', tone && `mx-seg--${tone}`, className)}
      style={withVar('--mx-seg-on', toneVar(tone))}
    >
      {Array.from({ length: safeCells }, (_unused, index) => (
        <span key={index} className={cx('mx-seg__cell', index < on && 'mx-seg__cell--on')} />
      ))}
    </div>
  )
}

export type MeterProps = { value: number; label?: string; tone?: AccentTone; className?: string }

export function Meter({ value, label, tone, className }: MeterProps) {
  const pct = Math.min(100, Math.max(0, Math.round(value * 100)))
  return (
    <div
      role="img"
      aria-label={label ? `${label}: ${pct} percent` : `${pct} percent`}
      className={cx('mx-meter', tone && `mx-meter--${tone}`, className)}
    >
      <span className="mx-meter__fill" style={withVar('--mx-meter-on', toneVar(tone), { width: `${pct}%` })} />
    </div>
  )
}

/* data */

export type StatProps = {
  label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: 'up' | 'down' | 'dim'; className?: string
}

export function Stat({ label, value, sub, tone, className }: StatProps) {
  return (
    <div className={cx('mx-stat', className)}>
      <span className="mx-stat__label">{label}</span>
      <span className={cx('mx-stat__value', tone && `mx-${tone}`)}>{value}</span>
      {sub ? <span className="mx-stat__sub">{sub}</span> : null}
    </div>
  )
}

export type KeyValueRow = { label: ReactNode; value: ReactNode }

export type KeyValuesProps = { rows: ReadonlyArray<KeyValueRow>; className?: string }

export function KeyValues({ rows, className }: KeyValuesProps) {
  return (
    <dl className={cx('mx-kv', className)}>
      {rows.map((row, index) => (
        <div className="mx-kv__row" key={index}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export type TableWrapProps = HTMLAttributes<HTMLDivElement> & { label?: string }

export function TableWrap({ children, className, label, ...rest }: TableWrapProps) {
  const cls = cx('mx-table-wrap', className)
  return <div className={cls} role="region" aria-label={label} tabIndex={0} {...rest}>{children}</div>
}

/* glyphs */

export type GlyphProps = { symbol: ReactNode; color?: string; size?: Size; className?: string; title?: string }

export function Glyph({ symbol, color, size = 'md', className, title }: GlyphProps) {
  return (
    <span
      aria-hidden={title ? undefined : true}
      title={title}
      className={cx('mx-glyph', size !== 'md' && `mx-glyph--${size}`, className)}
      style={withVar('--mx-team', color)}
    >
      {symbol}
    </span>
  )
}

export type TeamLike = { symbol: string; color: string; glyph: string }

export type TeamNameProps = { team: TeamLike; size?: Size; className?: string }

export function TeamName({ team, size = 'md', className }: TeamNameProps) {
  return (
    <span
      className={cx('mx-team', size !== 'md' && `mx-team--${size}`, className)}
      style={withVar('--mx-team', team.color)}
    >
      <Glyph symbol={team.glyph} color={team.color} size={size} />
      <span className="mx-team__symbol">{`$${team.symbol}`}</span>
    </span>
  )
}

/* accordion */

export type AccordionProps = {
  id: string; eyebrow?: ReactNode; title: ReactNode; meta?: ReactNode
  open: boolean; onToggle: (open: boolean) => void; children: ReactNode; className?: string
}

export function Accordion({ id, eyebrow, title, meta, open, onToggle, children, className }: AccordionProps) {
  const headId = `${id}-head`
  const bodyId = `${id}-body`
  return (
    <div className={cx('mx-acc', className)}>
      <button
        type="button"
        id={headId}
        className="mx-acc__head"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => onToggle(!open)}
      >
        {eyebrow ? <span className="mx-eyebrow">{eyebrow}</span> : null}
        <span className="mx-acc__title">{title}</span>
        {meta ? <span className="mx-acc__meta">{meta}</span> : null}
        <span className="mx-acc__chev" aria-hidden="true">
          {open ? '−' : '+'}
        </span>
      </button>
      <div id={bodyId} role="region" aria-labelledby={headId} className="mx-acc__body" hidden={!open}>
        {children}
      </div>
    </div>
  )
}

/* forms */

export type ToggleOption<T extends string> = { id: T; label: ReactNode; disabled?: boolean }

export type ToggleProps<T extends string> = {
  options: ReadonlyArray<ToggleOption<T>>; value: T; onChange: (id: T) => void
  label: string; className?: string
}

export function Toggle<T extends string>({ options, value, onChange, label, className }: ToggleProps<T>) {
  return (
    <div role="group" aria-label={label} className={cx('mx-toggle', className)}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className="mx-toggle__opt"
          aria-pressed={option.id === value}
          disabled={option.disabled}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export type FieldProps = {
  label: ReactNode; htmlFor?: string; hint?: ReactNode; error?: ReactNode
  children: ReactNode; className?: string
}

export function Field({ label, htmlFor, hint, error, children, className }: FieldProps) {
  return (
    <div className={cx('mx-field', error ? 'mx-field--error' : undefined, className)}>
      <label className="mx-field__label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint ? (
        <span className="mx-field__hint mx-faint" id={htmlFor ? `${htmlFor}-hint` : undefined}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className="mx-field__error mx-down" role="alert" id={htmlFor ? `${htmlFor}-error` : undefined}>
          {error}
        </span>
      ) : null}
    </div>
  )
}

/* states */

export type EmptyProps = { icon?: ReactNode; title: ReactNode; children?: ReactNode; className?: string }

export function Empty({ icon, title, children, className }: EmptyProps) {
  return (
    <div className={cx('mx-empty', className)}>
      {icon ? (
        <span className="mx-empty__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span className="mx-empty__title">{title}</span>
      {children ? <span className="mx-empty__body">{children}</span> : null}
    </div>
  )
}

export type SkeletonProps = { rows?: number; className?: string; label?: string }

export function Skeleton({ rows = 3, className, label = 'Loading' }: SkeletonProps) {
  const count = Math.max(1, Math.floor(rows))
  return (
    <div className={cx('mx-skel', className)} role="status" aria-busy="true" aria-label={label}>
      {Array.from({ length: count }, (_unused, index) => (
        <span className="mx-skel__row" key={index} />
      ))}
    </div>
  )
}

/* countdown */

export type CountdownProps = { to: number; prefix?: ReactNode; className?: string }

export function Countdown({ to, prefix, className }: CountdownProps) {
  const [now, setNow] = useState<number>(() => Date.now())

  useEffect(() => {
    setNow(Date.now())
    if (to - Date.now() <= 0) return
    const timer = window.setInterval(() => {
      const tick = Date.now()
      setNow(tick)
      if (to - tick <= 0) window.clearInterval(timer)
    }, 1000)
    return () => {
      window.clearInterval(timer)
    }
  }, [to])

  const remaining = Math.max(0, to - now)
  return (
    <span className={cx('mx-countdown', className)} role="timer" aria-live="off">
      {prefix ? <span className="mx-faint">{prefix}</span> : null}
      <span className="mx-num">{remaining <= 0 ? 'CLOSED' : formatClock(remaining)}</span>
    </span>
  )
}
