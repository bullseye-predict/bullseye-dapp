import {
  Bot,
  ChartNoAxesCombined,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock3,
  Crosshair,
  ExternalLink,
  Eye,
  Gamepad2,
  GripHorizontal,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Play,
  Radio,
  RefreshCcw,
  Send,
  ShieldCheck,
  Sparkles,
  Target,
  Trophy,
  UsersRound,
  X,
  Zap,
} from 'lucide-react'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type SubmitEvent,
} from 'react'
import { MarketProbabilityChart } from './MarketProbabilityChart'
import { AppShell } from '../solz/AppShell'
import type {
  ArenaAdapter,
  ArenaMarket,
  ArenaMarketKind,
  ArenaMarketOutcome,
  ArenaMatch,
  ArenaOrderIntent,
  ArenaOrderQuote,
  ArenaOrderReceipt,
  ArenaParticipant,
  ArenaPromptIntent,
  ArenaPromptReceipt,
  ArenaSnapshot,
  SettlementToken,
} from './model'

type LoadState = 'loading' | 'ready' | 'error'
type ActionState = 'idle' | 'reviewing' | 'submitting' | 'success' | 'error'

type Props = {
  adapter: ArenaAdapter
  walletAddress?: string
  walletReady: boolean
}

function tokenAmount(value: number, token: SettlementToken, compact = false) {
  if (!Number.isFinite(value)) return `— ${token}`
  const formatter = new Intl.NumberFormat('en-US', compact ? {
    notation: 'compact',
    maximumFractionDigits: 1,
  } : {
    minimumFractionDigits: token === 'SOL' ? 2 : 0,
    maximumFractionDigits: token === 'SOL' ? 4 : 0,
  })
  return `${formatter.format(value)} ${token}`
}

function probability(value: number) {
  return `${Math.round(value * 100)}%`
}

function timeLeft(timestamp: number) {
  const difference = timestamp - Date.now()
  if (difference <= 0) return 'Closed'
  const minutes = Math.floor(difference / 60_000)
  const seconds = Math.floor((difference % 60_000) / 1_000)
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function shortId(value: string) {
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value
}

const STAGE_HEIGHT_KEY = 'solz-arena.broadcast-height.v1'
// The compact default keeps the trading chart above the fold; these bounds preserve a usable stream and prevent it from reclaiming the terminal.
const STAGE_DEFAULT_HEIGHT = 300
const STAGE_MIN_HEIGHT = 220
const STAGE_MAX_HEIGHT = 560

const MOBILE_TRAY_MEDIA = '(max-width: 860px), (max-height: 620px) and (max-width: 1024px)'
// The 102px resting edge keeps both the tray identity and Trade/Prompt tabs available without covering the market.
const MOBILE_TRAY_PEEK = 102
const MOBILE_TRAY_RELEASE_MS = 250
const MOBILE_TRAY_FLICK_VELOCITY = 0.45

function clampStageHeight(value: number) {
  return Math.min(STAGE_MAX_HEIGHT, Math.max(STAGE_MIN_HEIGHT, value))
}

function ArenaStage({
  match,
  selectedParticipantId,
  onParticipant,
}: {
  match: ArenaMatch | null
  selectedParticipantId?: string
  onParticipant: (participant: ArenaParticipant) => void
}) {
  const [view, setView] = useState<'tactical' | 'stream'>('tactical')
  const [collapsed, setCollapsed] = useState(false)
  const [stageHeight, setStageHeight] = useState(STAGE_DEFAULT_HEIGHT)
  const [resizing, setResizing] = useState(false)
  const stageRef = useRef<HTMLElement>(null)
  const resizeHandleRef = useRef<HTMLButtonElement>(null)
  const resizeGesture = useRef<{
    pointerId: number
    startY: number
    startHeight: number
    pendingY: number
    latestHeight: number
    frameId: number | null
  } | null>(null)
  const sorted = useMemo(
    () => [...(match?.participants ?? [])].sort((left, right) => right.kills - left.kills || right.hp - left.hp),
    [match?.participants]
  )

  useEffect(() => {
    const saved = Number.parseFloat(window.localStorage.getItem(STAGE_HEIGHT_KEY) ?? '')
    if (Number.isFinite(saved)) setStageHeight(clampStageHeight(saved))
    return () => {
      const frameId = resizeGesture.current?.frameId
      if (frameId != null) window.cancelAnimationFrame(frameId)
    }
  }, [])

  const persistHeight = (value: number) => {
    const next = clampStageHeight(Math.round(value))
    setStageHeight(next)
    window.localStorage.setItem(STAGE_HEIGHT_KEY, String(next))
  }

  const applyPendingResize = () => {
    const gesture = resizeGesture.current
    if (!gesture) return
    gesture.frameId = null
    const requested = gesture.startHeight + gesture.pendingY - gesture.startY
    const bounded = clampStageHeight(requested)
    const overshoot = requested - bounded
    gesture.latestHeight = bounded
    stageRef.current?.style.setProperty('--arena-stage-height', `${Math.round(bounded)}px`)
    // The panel stays bounded while the handle adds a small damped response at its unavailable edges.
    const dampedOffset = Math.sign(overshoot) * Math.min(10, Math.sqrt(Math.abs(overshoot)) * 0.8)
    if (resizeHandleRef.current) resizeHandleRef.current.style.transform = `translateY(${dampedOffset}px)`
  }

  const queueResize = (clientY: number) => {
    const gesture = resizeGesture.current
    if (!gesture) return
    gesture.pendingY = clientY
    if (gesture.frameId != null) return
    gesture.frameId = window.requestAnimationFrame(applyPendingResize)
  }

  const beginResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!event.isPrimary || event.button !== 0 || resizeGesture.current) return
    resizeGesture.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: stageHeight,
      pendingY: event.clientY,
      latestHeight: stageHeight,
      frameId: null,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setResizing(true)
  }

  const moveResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (resizeGesture.current?.pointerId !== event.pointerId) return
    queueResize(event.clientY)
  }

  const completeResize = (event: ReactPointerEvent<HTMLButtonElement>, useReleasePosition: boolean) => {
    const gesture = resizeGesture.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    if (gesture.frameId != null) window.cancelAnimationFrame(gesture.frameId)
    if (useReleasePosition) gesture.pendingY = event.clientY
    applyPendingResize()
    const finalHeight = gesture.latestHeight
    // Resizing has no dismissal threshold: release commits the exact bounded size instead of adding surprise momentum.
    resizeGesture.current = null
    persistHeight(finalHeight)
    if (resizeHandleRef.current) resizeHandleRef.current.style.transform = 'translateY(0)'
    setResizing(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const finishResize = (event: ReactPointerEvent<HTMLButtonElement>) => completeResize(event, true)
  const cancelResize = (event: ReactPointerEvent<HTMLButtonElement>) => completeResize(event, false)

  const resizeWithKeyboard = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const step = event.shiftKey ? 40 : 16
    let next: number | null = null
    if (event.key === 'ArrowUp') next = stageHeight - step
    if (event.key === 'ArrowDown') next = stageHeight + step
    if (event.key === 'Home') next = STAGE_MIN_HEIGHT
    if (event.key === 'End') next = STAGE_MAX_HEIGHT
    if (next == null) return
    event.preventDefault()
    persistHeight(next)
  }

  const chooseView = (next: 'tactical' | 'stream') => {
    setView(next)
    setCollapsed(false)
  }

  if (!match) {
    return (
      <section className="arena-stage arena-stage-empty">
        <Radio size={28} aria-hidden="true" />
        <h2>No match on air</h2>
        <p>The live room board will appear here as soon as SOLZ publishes a watchable match.</p>
      </section>
    )
  }

  return (
    <section
      className={`arena-stage ${collapsed ? 'collapsed' : ''} ${resizing ? 'resizing' : ''}`}
      aria-label={`${match.title} observer`}
      ref={stageRef}
      style={{ '--arena-stage-height': `${stageHeight}px` } as CSSProperties}
    >
      <header className="arena-stage-header">
        <div>
          <span className={`arena-live-pill ${match.phase}`}><i /> {match.phase === 'live' ? 'Live' : match.phase}</span>
          <span>{match.arena}</span>
          <span><Eye size={13} aria-hidden="true" /> {match.viewers.toLocaleString()}</span>
        </div>
        <div className="arena-stage-actions">
          <div className="arena-view-switch" role="group" aria-label="Observer view">
            <button type="button" className={view === 'tactical' ? 'active' : ''} onClick={() => chooseView('tactical')}>Tactical</button>
            <button type="button" className={view === 'stream' ? 'active' : ''} onClick={() => chooseView('stream')} disabled={!match.streamUrl}>Game stream</button>
          </div>
          {match.streamUrl && <a href={match.streamUrl} target="_blank" rel="noreferrer" aria-label="Open full spectator view"><ExternalLink size={15} aria-hidden="true" /></a>}
          <button
            type="button"
            className="arena-stage-collapse"
            onClick={() => setCollapsed((value) => !value)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand match broadcast' : 'Minimize match broadcast'}
            title={collapsed ? 'Expand broadcast' : 'Minimize broadcast'}
          >
            {collapsed ? <Maximize2 size={15} aria-hidden="true" /> : <Minimize2 size={15} aria-hidden="true" />}
          </button>
        </div>
      </header>

      {!collapsed && <div className="arena-stage-viewport">
        {view === 'stream' && match.streamUrl ? (
          <iframe title={`${match.title} game stream`} src={match.streamUrl} loading="lazy" allow="fullscreen" />
        ) : (
          <div className="tactical-map">
            <div className="arena-core" aria-hidden="true"><span /><span /><span /></div>
            {match.participants.length > 0 ? match.participants.map((participant, index) => (
              <button
                type="button"
                className={`combatant-dot ${participant.status} ${selectedParticipantId === participant.id ? 'selected' : ''}`}
                key={participant.id}
                style={{
                  '--combatant-x': `${participant.x}%`,
                  '--combatant-y': `${participant.y}%`,
                  '--combatant-color': participant.color,
                  '--combatant-delay': `${(index % 5) * -0.17}s`,
                } as CSSProperties}
                onClick={() => onParticipant(participant)}
                aria-label={`${participant.name}, ${participant.kills} kills, ${Math.round((participant.hp / participant.hpMax) * 100)} percent health`}
              >
                <span>{String(index + 1).padStart(2, '0')}</span>
                <small>{participant.name}</small>
              </button>
            )) : (
              <div className="observer-waiting">
                <LoaderCircle className="spin" size={22} aria-hidden="true" />
                <strong>Linking roster telemetry</strong>
                <span>The public room summary is live. Detailed player state arrives through the spectator channel.</span>
              </div>
            )}
            <span className="scan-line" aria-hidden="true" />
          </div>
        )}

        <aside className="arena-scoreboard" aria-label="Live standings">
          <div className="scoreboard-heading"><span>Live roster</span><b>K / D</b></div>
          {sorted.length > 0 ? sorted.map((participant, index) => (
            <button type="button" key={participant.id} onClick={() => onParticipant(participant)} className={selectedParticipantId === participant.id ? 'selected' : ''}>
              <i style={{ background: participant.color }} />
              <span><b>{String(index + 1).padStart(2, '0')}</b>{participant.name}<small>{participant.teamName}</small></span>
              <em>{participant.kills} / {participant.deaths}</em>
              <span className="hp-meter" aria-label={`${Math.round((participant.hp / participant.hpMax) * 100)} percent health`}><i style={{ width: `${(participant.hp / participant.hpMax) * 100}%` }} /></span>
            </button>
          )) : <p>No roster rows yet.</p>}
        </aside>
      </div>}
      {!collapsed && (
        <button
          type="button"
          className={`arena-stage-resize ${resizing ? 'dragging' : ''}`}
          ref={resizeHandleRef}
          onPointerDown={beginResize}
          onPointerMove={moveResize}
          onPointerUp={finishResize}
          onPointerCancel={cancelResize}
          onLostPointerCapture={cancelResize}
          onKeyDown={resizeWithKeyboard}
          onDoubleClick={() => persistHeight(STAGE_DEFAULT_HEIGHT)}
          aria-label={`Resize match broadcast. Current height ${Math.round(stageHeight)} pixels. Use arrow keys or drag.`}
          title="Drag to resize · Double-click to reset"
        >
          <GripHorizontal size={16} aria-hidden="true" />
          <span>Drag broadcast height · {Math.round(stageHeight)}px</span>
        </button>
      )}
    </section>
  )
}

function OrderDialog({
  intent,
  quote,
  state,
  error,
  receipt,
  onClose,
  onConfirm,
}: {
  intent: ArenaOrderIntent
  quote: ArenaOrderQuote
  state: ActionState
  error: string | null
  receipt: ArenaOrderReceipt | null
  onClose: () => void
  onConfirm: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { if (!ref.current?.open) ref.current?.showModal() }, [])
  return (
    <dialog className="arena-dialog" ref={ref} onClose={onClose} onCancel={(event) => { if (state === 'submitting') event.preventDefault(); else onClose() }}>
      <div className="arena-dialog-shell">
        <header>
          <div><span>{state === 'success' ? 'Position opened' : 'Review prediction'}</span><h2>{intent.outcome.label}</h2></div>
          {state !== 'submitting' && <button type="button" onClick={onClose} aria-label="Close order review"><X size={18} aria-hidden="true" /></button>}
        </header>
        {state === 'success' && receipt ? (
          <div className="arena-success" aria-live="polite">
            <i><Check size={23} aria-hidden="true" /></i><strong>{receipt.status === 'filled' ? 'Practice fill confirmed' : 'Order submitted'}</strong>
            <p>{quote.shares.toFixed(2)} shares at {probability(quote.price)}.</p>
            {receipt.signature && <a href={`https://solscan.io/tx/${receipt.signature}`} target="_blank" rel="noreferrer">View on Solscan <ExternalLink size={14} aria-hidden="true" /></a>}
            <button className="arena-primary" type="button" onClick={onClose}>View position</button>
          </div>
        ) : (
          <>
            <p className="dialog-market-title">{intent.market.title}</p>
            <dl className="dialog-breakdown">
              <div><dt>Stake</dt><dd>{tokenAmount(intent.amount, intent.token)}</dd></div><div><dt>Signal price</dt><dd>{probability(quote.price)}</dd></div>
              <div><dt>Shares</dt><dd>{quote.shares.toFixed(2)}</dd></div><div><dt>Fee</dt><dd>{tokenAmount(quote.fee, intent.token)}</dd></div>
              <div className="dialog-total"><dt>Potential payout</dt><dd>{tokenAmount(quote.potentialPayout, intent.token)}</dd></div>
            </dl>
            {error && <p className="arena-inline-error" role="alert">{error}</p>}
            <button className="arena-primary" type="button" onClick={onConfirm} disabled={state === 'submitting'} aria-busy={state === 'submitting'}>{state === 'submitting' ? <><LoaderCircle className="spin" size={16} aria-hidden="true" /> Executing…</> : <>Confirm prediction <ChevronRight size={16} aria-hidden="true" /></>}</button>
            <p className="dialog-safety"><ShieldCheck size={14} aria-hidden="true" /> Practice fills never move real SOL or SOLZ.</p>
          </>
        )}
      </div>
    </dialog>
  )
}

function ModeNav({ mode }: { mode: 'demo' | 'live' }) {
  return <nav className="arena-mode-nav" aria-label="Prediction mode"><a href="/demo" className={mode === 'demo' ? 'active' : ''}><Sparkles size={14} aria-hidden="true" /> Practice</a><a href="/live" className={mode === 'live' ? 'active' : ''}><i /> Live SOLZ</a></nav>
}

type CenterView = 'market' | 'livestream'
type ActionView = 'trade' | 'prompt'

function lineName(kind: ArenaMarketKind) {
  const names: Record<ArenaMarketKind, string> = {
    'match-winner': 'Agent winner',
    'team-winner': 'Moneyline',
    'team-handicap': 'Survival handicap',
    'kill-total': 'Total eliminations',
    'most-kills': 'Kill leader',
    'first-eliminated': 'First elimination',
    'weekly-leader': 'Weekly champion',
    'weekly-volume': 'Weekly total',
  }
  return names[kind]
}

function updateWorkspaceUrl(key: 'view' | 'panel', value: string) {
  if (typeof window === 'undefined') return
  // Tabs are workspace state worth bookmarking, but replaceState keeps arrow-key tabbing out of browser history.
  const url = new URL(window.location.href)
  url.searchParams.set(key, value)
  window.history.replaceState(window.history.state, '', url)
}

function handleTabArrow<T extends string>(
  event: ReactKeyboardEvent<HTMLButtonElement>,
  tabs: readonly T[],
  current: T,
  onChange: (value: T) => void,
) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const currentIndex = Math.max(0, tabs.indexOf(current))
  const nextIndex = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? tabs.length - 1
      : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
  const next = tabs[nextIndex]
  onChange(next)
  window.requestAnimationFrame(() => {
    event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)?.focus()
  })
}

function SeriesLines({
  markets,
  market,
  outcome,
  token,
  onSelect,
}: {
  markets: ArenaMarket[]
  market: ArenaMarket
  outcome: ArenaMarketOutcome
  token: SettlementToken
  onSelect: (market: ArenaMarket, outcome: ArenaMarketOutcome) => void
}) {
  const [expanded, setExpanded] = useState<string[]>([])

  return (
    <section className="series-lines" aria-labelledby="series-lines-title">
      <header className="series-lines-heading">
        <div><span>Executable board</span><h2 id="series-lines-title">Series lines</h2></div>
        <small>Price per winning share · {token}</small>
      </header>
      <div className="series-lines-list">
        {markets.map((item) => {
          const sorted = [...item.outcomes].sort((left, right) => right.probability - left.probability)
          const isExpanded = expanded.includes(item.id)
          let visible = isExpanded ? sorted : sorted.slice(0, 4)
          const selectedInLine = item.id === market.id ? item.outcomes.find((entry) => entry.id === outcome.id) : undefined
          if (selectedInLine && !visible.some((entry) => entry.id === selectedInLine.id)) {
            visible = [selectedInLine, ...visible.slice(0, 3)]
          }
          const hiddenCount = item.outcomes.length - visible.length
          return (
            <article className={item.id === market.id ? 'selected' : ''} key={item.id}>
              <button
                className="series-line-title"
                type="button"
                onClick={() => item.outcomes[0] && onSelect(item, item.outcomes[0])}
              >
                <span>{lineName(item.kind)}</span>
                <strong>{item.title}</strong>
                <small>{tokenAmount(item.volume[token], token, true)} volume · closes {timeLeft(item.closesAt)}</small>
              </button>
              <div className="series-line-prices">
                {visible.map((entry) => (
                  <button
                    type="button"
                    key={entry.id}
                    className={item.id === market.id && entry.id === outcome.id ? 'selected' : ''}
                    onClick={() => onSelect(item, entry)}
                    aria-pressed={item.id === market.id && entry.id === outcome.id}
                  >
                    <span>{entry.label}</span>
                    <b>{Math.round(entry.probability * 100)}¢</b>
                    <small>{entry.detail}</small>
                  </button>
                ))}
                {(hiddenCount > 0 || isExpanded) && item.outcomes.length > 4 && (
                  <button
                    type="button"
                    className="series-line-more"
                    onClick={() => setExpanded((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])}
                    aria-expanded={isExpanded}
                  >
                    {isExpanded ? 'Show leaders' : `+${hiddenCount} agents`}
                  </button>
                )}
              </div>
              <span className={`series-line-status ${item.status}`}>{item.status === 'indicative' ? 'signal only' : item.status}</span>
            </article>
          )
        })}
      </div>
    </section>
  )
}

export function SolzPredictionArena({ adapter, walletAddress, walletReady }: Props) {
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<ArenaSnapshot | null>(null)
  const [selectedMatchId, setSelectedMatchId] = useState('')
  const [selectedMarketId, setSelectedMarketId] = useState('')
  const [selectedOutcomeId, setSelectedOutcomeId] = useState('')
  const [selectedParticipantId, setSelectedParticipantId] = useState('')
  const [token, setToken] = useState<SettlementToken>('SOLZ')
  const [amount, setAmount] = useState('250')
  const [orderState, setOrderState] = useState<ActionState>('idle')
  const [orderError, setOrderError] = useState<string | null>(null)
  const [orderReceipt, setOrderReceipt] = useState<ArenaOrderReceipt | null>(null)
  const [activeIntent, setActiveIntent] = useState<ArenaOrderIntent | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [promptText, setPromptText] = useState('Take the north lane, avoid the center, then pressure the kill leader.')
  const [promptToken, setPromptToken] = useState<SettlementToken>('SOLZ')
  const [promptState, setPromptState] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle')
  const [promptError, setPromptError] = useState<string | null>(null)
  const [promptReceipt, setPromptReceipt] = useState<ArenaPromptReceipt | null>(null)
  const [centerView, setCenterView] = useState<CenterView>('market')
  const [actionView, setActionView] = useState<ActionView>('trade')
  const [mobileTrayOpen, setMobileTrayOpen] = useState(false)
  const actionDockRef = useRef<HTMLElement>(null)
  const trayHandleRef = useRef<HTMLButtonElement>(null)
  const trayBackdropRef = useRef<HTMLButtonElement>(null)
  const traySettleTimer = useRef<number | null>(null)
  const traySuppressClick = useRef(false)
  const trayGesture = useRef<{
    pointerId: number
    startY: number
    startAt: number
    startOffset: number
    pendingY: number
    latestOffset: number
    closedOffset: number
    frameId: number | null
  } | null>(null)

  const load = async () => {
    setLoadState('loading'); setLoadError(null)
    try {
      const value = await adapter.load(walletAddress)
      setSnapshot(value)
      setSelectedMatchId((current) => current || value.selectedMatchId || value.matches[0]?.id || '')
      setSelectedMarketId((current) => current || value.markets[0]?.id || '')
      setSelectedOutcomeId((current) => current || value.markets[0]?.outcomes[0]?.id || '')
      setSelectedParticipantId((current) => current || value.matches[0]?.participants[0]?.id || '')
      setLoadState('ready')
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'The SOLZ arena could not be loaded.'); setLoadState('error')
    }
  }

  useEffect(() => { void load() }, [adapter, walletAddress])
  useEffect(() => adapter.subscribe?.((value) => {
    setSnapshot(value)
    setSelectedMatchId((current) => current || value.selectedMatchId || value.matches[0]?.id || '')
    setSelectedMarketId((current) => current || value.markets[0]?.id || '')
    setSelectedOutcomeId((current) => current || value.markets[0]?.outcomes[0]?.id || '')
    setSelectedParticipantId((current) => current || value.matches[0]?.participants[0]?.id || '')
  }), [adapter])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const requestedView = params.get('view')
    const requestedPanel = params.get('panel')
    if (requestedView === 'market' || requestedView === 'livestream') setCenterView(requestedView)
    if (requestedPanel === 'trade' || requestedPanel === 'prompt') setActionView(requestedPanel)
  }, [])

  const match = snapshot?.matches.find((item) => item.id === selectedMatchId) ?? snapshot?.matches[0] ?? null
  const matchMarkets = snapshot?.markets.filter((item) => !item.matchId || item.matchId === match?.id) ?? []
  const market = matchMarkets.find((item) => item.id === selectedMarketId) ?? matchMarkets[0] ?? null
  const outcome = market?.outcomes.find((item) => item.id === selectedOutcomeId) ?? market?.outcomes[0] ?? null
  const participant = match?.participants.find((item) => item.id === selectedParticipantId) ?? match?.participants[0] ?? null
  const numericAmount = Number.parseFloat(amount)
  const orderIntent = market && outcome && Number.isFinite(numericAmount) ? { market, outcome, token, amount: numericAmount } : null
  const orderQuote = orderIntent ? adapter.quoteOrder(orderIntent) : null
  const promptIntent: ArenaPromptIntent | null = match && participant ? { match, participant, token: promptToken, prompt: promptText } : null
  const promptQuote = promptIntent ? adapter.quotePrompt(promptIntent) : null
  const orderCapability = snapshot?.capabilities.orders
  const promptCapability = snapshot?.capabilities.prompts
  const canOrder = Boolean(orderCapability?.ready && (adapter.mode === 'demo' || walletReady) && market?.status === 'open')
  const canPrompt = Boolean(promptCapability?.ready && (adapter.mode === 'demo' || walletReady) && participant?.status === 'active')
  const chooseCenterView = (next: CenterView) => {
    setCenterView(next)
    updateWorkspaceUrl('view', next)
  }
  const chooseActionView = (next: ActionView) => {
    setActionView(next)
    updateWorkspaceUrl('panel', next)
    if (window.matchMedia(MOBILE_TRAY_MEDIA).matches) setMobileTrayOpen(true)
  }

  const focusTrayHandle = () => window.requestAnimationFrame(() => trayHandleRef.current?.focus())
  const closeMobileTray = (returnFocus = false) => {
    setMobileTrayOpen(false)
    if (returnFocus) focusTrayHandle()
  }

  useEffect(() => {
    if (!mobileTrayOpen) return
    const media = window.matchMedia(MOBILE_TRAY_MEDIA)
    const previousOverflow = document.body.style.overflow
    let locked = false
    const syncScrollLock = () => {
      if (media.matches && !locked) {
        // Expanded mobile commands own the short viewport; locking the page prevents the drag from scrolling two surfaces at once.
        document.body.style.overflow = 'hidden'
        locked = true
      } else if (!media.matches && locked) {
        document.body.style.overflow = previousOverflow
        locked = false
      }
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') closeMobileTray(true)
    }
    syncScrollLock()
    media.addEventListener('change', syncScrollLock)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      media.removeEventListener('change', syncScrollLock)
      window.removeEventListener('keydown', onKeyDown)
      if (locked) document.body.style.overflow = previousOverflow
    }
  }, [mobileTrayOpen])

  useEffect(() => () => {
    const frameId = trayGesture.current?.frameId
    if (frameId != null) window.cancelAnimationFrame(frameId)
    if (traySettleTimer.current != null) window.clearTimeout(traySettleTimer.current)
  }, [])

  const applyTrayDrag = () => {
    const gesture = trayGesture.current
    const dock = actionDockRef.current
    if (!gesture || !dock) return
    gesture.frameId = null
    const requested = gesture.startOffset + gesture.pendingY - gesture.startY
    const bounded = Math.max(0, Math.min(gesture.closedOffset, requested))
    const overshoot = requested - bounded
    // A small square-root resistance acknowledges unavailable space without letting the sheet escape its physical bounds.
    const damped = bounded + Math.sign(overshoot) * Math.min(18, Math.sqrt(Math.abs(overshoot)) * 1.4)
    gesture.latestOffset = bounded
    dock.style.transform = `translate3d(0, ${damped}px, 0)`
    if (trayBackdropRef.current) trayBackdropRef.current.style.opacity = String(1 - bounded / Math.max(1, gesture.closedOffset))
  }

  const queueTrayDrag = (clientY: number) => {
    const gesture = trayGesture.current
    if (!gesture) return
    gesture.pendingY = clientY
    if (Math.abs(clientY - gesture.startY) > 6) traySuppressClick.current = true
    if (gesture.frameId == null) gesture.frameId = window.requestAnimationFrame(applyTrayDrag)
  }

  const beginTrayDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!event.isPrimary || event.button !== 0 || trayGesture.current) return
    const dock = actionDockRef.current
    if (!dock || !window.matchMedia(MOBILE_TRAY_MEDIA).matches) return
    if (traySettleTimer.current != null) window.clearTimeout(traySettleTimer.current)
    dock.style.transition = 'none'
    const closedOffset = Math.max(0, dock.offsetHeight - MOBILE_TRAY_PEEK)
    const restingTop = window.innerHeight - dock.offsetHeight
    const currentOffset = Math.max(0, Math.min(closedOffset, dock.getBoundingClientRect().top - restingTop))
    traySuppressClick.current = false
    trayGesture.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startAt: performance.now(),
      startOffset: currentOffset,
      pendingY: event.clientY,
      latestOffset: currentOffset,
      closedOffset,
      frameId: null,
    }
    dock.dataset.dragging = 'true'
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const moveTrayDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (trayGesture.current?.pointerId !== event.pointerId) return
    queueTrayDrag(event.clientY)
  }

  const completeTrayDrag = (event: ReactPointerEvent<HTMLButtonElement>, cancelled: boolean) => {
    const gesture = trayGesture.current
    const dock = actionDockRef.current
    if (!gesture || gesture.pointerId !== event.pointerId || !dock) return
    if (gesture.frameId != null) window.cancelAnimationFrame(gesture.frameId)
    gesture.pendingY = event.clientY
    applyTrayDrag()
    const velocity = (event.clientY - gesture.startY) / Math.max(1, performance.now() - gesture.startAt)
    const shouldOpen = cancelled
      ? mobileTrayOpen
      : velocity <= -MOBILE_TRAY_FLICK_VELOCITY
        ? true
        : velocity >= MOBILE_TRAY_FLICK_VELOCITY
          ? false
          : gesture.latestOffset < gesture.closedOffset * 0.55
    const targetOffset = shouldOpen ? 0 : gesture.closedOffset
    trayGesture.current = null
    delete dock.dataset.dragging
    setMobileTrayOpen(shouldOpen)
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    dock.style.transition = reducedMotion ? 'none' : `transform ${MOBILE_TRAY_RELEASE_MS}ms cubic-bezier(0.23, 1, 0.32, 1)`
    dock.style.transform = `translate3d(0, ${targetOffset}px, 0)`
    if (trayBackdropRef.current) {
      trayBackdropRef.current.style.transition = reducedMotion ? 'none' : `opacity ${MOBILE_TRAY_RELEASE_MS}ms cubic-bezier(0.23, 1, 0.32, 1)`
      trayBackdropRef.current.style.opacity = shouldOpen ? '1' : '0'
    }
    traySettleTimer.current = window.setTimeout(() => {
      dock.style.removeProperty('transition')
      dock.style.removeProperty('transform')
      trayBackdropRef.current?.style.removeProperty('transition')
      trayBackdropRef.current?.style.removeProperty('opacity')
      traySettleTimer.current = null
    }, reducedMotion ? 0 : MOBILE_TRAY_RELEASE_MS + 30)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const toggleMobileTray = () => {
    if (traySuppressClick.current) {
      traySuppressClick.current = false
      return
    }
    setMobileTrayOpen((open) => !open)
  }

  const selectMarket = (next: ArenaMarket, nextOutcome = next.outcomes[0]) => {
    setSelectedMarketId(next.id)
    setSelectedOutcomeId(nextOutcome?.id ?? '')
    if (nextOutcome?.participantId) setSelectedParticipantId(nextOutcome.participantId)
  }
  const selectParticipant = (next: ArenaParticipant) => {
    setSelectedParticipantId(next.id)
    const matching = market?.outcomes.find((item) => item.participantId === next.id)
    if (matching) setSelectedOutcomeId(matching.id)
  }

  const reviewOrder = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault(); setFieldError(null)
    if (!canOrder) { setFieldError(orderCapability?.reason || (walletReady ? 'This market is not open.' : 'Connect a Solana wallet to continue.')); return }
    const minimum = adapter.minimumOrder[token]
    if (!orderIntent || !orderQuote || orderIntent.amount < minimum) { setFieldError(`Enter at least ${tokenAmount(minimum, token)}.`); return }
    const balance = snapshot?.account.balances[token] ?? Number.NaN
    if (Number.isFinite(balance) && orderQuote.total > balance) { setFieldError(`Your ${token} balance is too low for this prediction and fee.`); return }
    setActiveIntent(orderIntent); setOrderReceipt(null); setOrderError(null); setOrderState('reviewing')
  }

  const confirmOrder = async () => {
    if (!activeIntent) return
    setOrderState('submitting'); setOrderError(null)
    try {
      const receipt = await adapter.placeOrder(activeIntent, walletAddress)
      setOrderReceipt(receipt)
      setSnapshot((current) => current ? { ...current, account: receipt.account, markets: current.markets.map((item) => item.id === receipt.market.id ? receipt.market : item) } : current)
      setOrderState('success')
    } catch (error) { setOrderError(error instanceof Error ? error.message : 'The prediction could not be executed.'); setOrderState('error') }
  }

  const sendPrompt = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault(); setPromptError(null); setPromptReceipt(null)
    if (!canPrompt) { setPromptError(promptCapability?.reason || (walletReady ? 'This agent cannot receive directives.' : 'Connect a Solana wallet to continue.')); return }
    if (!promptIntent || promptText.trim().length < 8) { setPromptError('Write a directive with at least 8 characters.'); return }
    if (promptText.trim().length > 220) { setPromptError('Keep the directive under 220 characters.'); return }
    if (promptQuote && Number.isFinite(snapshot?.account.balances[promptToken] ?? Number.NaN) && promptQuote.cost > (snapshot?.account.balances[promptToken] ?? 0)) { setPromptError(`Your ${promptToken} balance is too low for this directive.`); return }
    setPromptState('submitting')
    try {
      const receipt = await adapter.sendPrompt({ ...promptIntent, prompt: promptText.trim() }, walletAddress)
      setPromptReceipt(receipt); setSnapshot((current) => current ? { ...current, account: receipt.account } : current); setPromptState('success')
    } catch (error) { setPromptError(error instanceof Error ? error.message : 'The directive could not be sent.'); setPromptState('error') }
  }

  useEffect(() => {
    const context = document.modelContext
    if (!context?.registerTool || loadState !== 'ready' || !snapshot) return
    const lifecycle = new AbortController()
    const registrations = [
      context.registerTool({
        name: 'read_solz_match_markets', title: 'Read SOLZ match markets', description: 'Read only SOLZ game matches, competitors, kills, deaths, and visible prediction signals.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: false },
        execute: () => ({ mode: adapter.mode, matches: snapshot.matches.map((item) => ({ id: item.id, title: item.title, phase: item.phase, participantCount: item.participants.length })), markets: snapshot.markets.map((item) => ({ id: item.id, title: item.title, status: item.status, outcomes: item.outcomes.map((entry) => ({ id: entry.id, label: entry.label, probability: entry.probability })) })) }),
      }, { signal: lifecycle.signal }),
      context.registerTool({
        name: 'stage_solz_prediction', title: 'Stage SOLZ prediction', description: 'Stage a SOL or SOLZ prediction in the visible review dialog. It never signs or submits without the user confirming on the page.',
        inputSchema: { type: 'object', properties: { marketId: { type: 'string' }, outcomeId: { type: 'string' }, token: { type: 'string', enum: ['SOL', 'SOLZ'] }, amount: { type: 'number', exclusiveMinimum: 0 } }, required: ['marketId', 'outcomeId', 'token', 'amount'], additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: (input) => {
          const value = input as { marketId?: unknown; outcomeId?: unknown; token?: unknown; amount?: unknown }
          const nextMarket = snapshot.markets.find((item) => item.id === value.marketId)
          const nextOutcome = nextMarket?.outcomes.find((item) => item.id === value.outcomeId)
          const nextToken = value.token === 'SOL' || value.token === 'SOLZ' ? value.token : null
          const nextAmount = Number(value.amount)
          if (!nextMarket || !nextOutcome || !nextToken || !Number.isFinite(nextAmount)) throw new Error('Choose a valid SOLZ market, outcome, token, and amount.')
          if (!snapshot.capabilities.orders.ready) throw new Error(snapshot.capabilities.orders.reason || 'Orders are unavailable.')
          setSelectedMarketId(nextMarket.id); setSelectedOutcomeId(nextOutcome.id); setToken(nextToken); setAmount(String(nextAmount)); setActiveIntent({ market: nextMarket, outcome: nextOutcome, token: nextToken, amount: nextAmount }); setOrderReceipt(null); setOrderError(null); setOrderState('reviewing')
          return { staged: true, requiresUserConfirmation: true }
        },
      }, { signal: lifecycle.signal }),
    ]
    for (const registration of registrations) void Promise.resolve(registration).catch(() => undefined)
    return () => lifecycle.abort()
  }, [adapter.mode, loadState, snapshot])

  return (
    <AppShell className="arena-app" active="highlight" bleed>
      <div className="arena-mode-strip"><ModeNav mode={adapter.mode} /></div>

      <div className="arena-ticker"><span><Radio size={13} aria-hidden="true" /><b>{adapter.mode === 'demo' ? 'SIMULATION' : 'REGIONAL LIVE'}</b></span><span>{snapshot?.matches.filter((item) => item.phase === 'live').length ?? 0} matches on air</span><span>{match ? `${match.title} · ${match.participants.filter((item) => item.status === 'active').length || '—'} active` : 'Waiting for next match'}</span><span className="ticker-end">SOL + SOLZ only</span></div>

      {adapter.mode === 'live' && snapshot && !snapshot.capabilities.observer.ready && (
        <div className="arena-source-notice" role="status"><Radio size={15} aria-hidden="true" /><span><strong>Live source status</strong>{snapshot.capabilities.observer.reason}</span><a href="/demo">Run practice match</a></div>
      )}

      {loadState === 'loading' && !snapshot ? (
        <div className="arena-boot" aria-busy="true">
          <div className="arena-boot-line"><LoaderCircle className="spin" size={16} aria-hidden="true" /><span>{adapter.mode === 'demo' ? 'Loading practice match and simulated order book…' : 'Linking SOLZ match sources…'}</span></div>
          <div className="arena-boot-chart" aria-hidden="true"><i /><i /><i /><i /><i /></div>
        </div>
      ) : loadState === 'error' ? (
        <div className="arena-load-error" role="alert"><Radio size={25} aria-hidden="true" /><h1>Live link unavailable</h1><p>{loadError}</p><button type="button" onClick={() => void load()}><RefreshCcw size={15} aria-hidden="true" /> Retry</button><a href="/demo">Open practice arena</a></div>
      ) : (
        <>
          <div className="arena-layout" aria-busy={loadState === 'loading'}>
            <aside className="arena-left-rail">
              <section className="arena-panel match-selector-panel">
                <header className="arena-panel-heading"><div><span>Broadcasts</span><h1>SOLZ matches</h1></div><b>{snapshot?.matches.length ?? 0}</b></header>
                {loadState === 'loading' ? <div className="arena-skeleton"><i /><i /><i /></div> : snapshot && snapshot.matches.length > 0 ? <div className="match-selector-list">{snapshot.matches.map((item) => <button type="button" key={item.id} className={match?.id === item.id ? 'selected' : ''} onClick={() => { setSelectedMatchId(item.id); const first = snapshot.markets.find((entry) => entry.matchId === item.id); if (first) selectMarket(first) }}><span><i className={item.phase} />{item.phase}</span><strong>{item.title}</strong><small>{item.subtitle}</small><em><UsersRound size={13} aria-hidden="true" /> {item.participants.length || 'Roster syncing'} <b>{item.stakeToken}</b></em></button>)}</div> : <div className="arena-empty"><Radio size={20} aria-hidden="true" /><strong>No match on air</strong><span>The regional room feed is connected and currently empty.</span></div>}
              </section>
              <section className="arena-panel market-selector-panel">
                <header className="arena-panel-heading"><div><span>Market index</span><h2>Available lines</h2></div><Target size={17} aria-hidden="true" /></header>
                {matchMarkets.length > 0 ? <div className="market-selector-list">{matchMarkets.map((item) => <button type="button" key={item.id} className={market?.id === item.id ? 'selected' : ''} onClick={() => selectMarket(item)}><span>{item.kind.replaceAll('-', ' ')}</span><strong>{item.title}</strong><small>{item.status === 'indicative' ? 'Signal only' : `${item.outcomes.length} outcomes`} · closes {timeLeft(item.closesAt)}</small></button>)}</div> : <div className="arena-empty compact"><Target size={18} aria-hidden="true" /><strong>No executable markets</strong><span>{adapter.mode === 'live' ? 'Live roster signals appear after the observer connects.' : 'Choose a live match.'}</span></div>}
              </section>
            </aside>

            <div className="arena-center">
              <section className="arena-panel arena-workspace">
                <header className="arena-workspace-header">
                  <div>
                    <span>SOLZ · {match?.format === 'human-tourney' ? 'Human tourney' : 'Genesis agent league'}</span>
                    <h1>{match?.title ?? 'No live SOLZ match'}</h1>
                    <p>{match?.subtitle ?? 'Practice remains available while the live match feed is idle.'}</p>
                  </div>
                  <div className="arena-workspace-status">
                    {market && <><small>Selected line closes in</small><b><Clock3 size={14} aria-hidden="true" /> {timeLeft(market.closesAt)}</b></>}
                    {adapter.advanceSimulation && <button type="button" onClick={adapter.advanceSimulation}><Zap size={14} aria-hidden="true" /> Advance simulation</button>}
                  </div>
                </header>

                <div className="arena-workspace-tabs" role="tablist" aria-label="Match workspace">
                  <button
                    id="market-tab"
                    data-tab="market"
                    type="button"
                    role="tab"
                    aria-selected={centerView === 'market'}
                    aria-controls="market-panel"
                    tabIndex={centerView === 'market' ? 0 : -1}
                    className={centerView === 'market' ? 'active' : ''}
                    onClick={() => chooseCenterView('market')}
                    onKeyDown={(event) => handleTabArrow(event, ['market', 'livestream'] as const, centerView, chooseCenterView)}
                  >
                    <ChartNoAxesCombined size={16} aria-hidden="true" /> Market
                  </button>
                  <button
                    id="livestream-tab"
                    data-tab="livestream"
                    type="button"
                    role="tab"
                    aria-selected={centerView === 'livestream'}
                    aria-controls="livestream-panel"
                    tabIndex={centerView === 'livestream' ? 0 : -1}
                    className={centerView === 'livestream' ? 'active' : ''}
                    onClick={() => chooseCenterView('livestream')}
                    onKeyDown={(event) => handleTabArrow(event, ['market', 'livestream'] as const, centerView, chooseCenterView)}
                  >
                    <Radio size={16} aria-hidden="true" /> Livestream
                  </button>
                </div>

                {centerView === 'market' ? (
                  <div id="market-panel" role="tabpanel" aria-labelledby="market-tab" className="market-workspace-panel">
                    {market && outcome ? (
                      <>
                        <header className="market-board-header">
                          <div><span>{lineName(market.kind)}</span><h2>{market.title}</h2><p>{market.description}</p></div>
                          <div><small>Market state</small><b>{tokenAmount(market.volume[token], token, true)} volume</b><em className={market.status}>{market.status}</em></div>
                        </header>
                        <MarketProbabilityChart market={market} outcome={outcome} mode={adapter.mode} token={token} onOutcome={(entry) => selectMarket(market, entry)} />
                        <SeriesLines markets={matchMarkets} market={market} outcome={outcome} token={token} onSelect={selectMarket} />
                        <details className="arena-rules"><summary><ShieldCheck size={14} aria-hidden="true" /> Resolution authority <ChevronRight size={14} aria-hidden="true" /></summary><p>{market.rules}</p></details>
                      </>
                    ) : (
                      <div className="market-board-empty">
                        <Crosshair size={24} aria-hidden="true" />
                        <h2>{adapter.mode === 'demo' ? 'Practice board needs a reload' : 'No live market on air'}</h2>
                        <p>{adapter.mode === 'demo' ? 'The local match should always include mock lines. Reload it to restore the simulation.' : 'The live page never invents matches. Open Practice to trade the complete simulated board.'}</p>
                        {adapter.mode === 'demo' ? <button type="button" onClick={() => void load()}><RefreshCcw size={14} aria-hidden="true" /> Reload practice board</button> : <a href="/demo">Open practice market</a>}
                      </div>
                    )}
                  </div>
                ) : (
                  <div id="livestream-panel" role="tabpanel" aria-labelledby="livestream-tab" className="livestream-workspace-panel">
                    <ArenaStage match={match} selectedParticipantId={participant?.id} onParticipant={selectParticipant} />
                    <section className="match-feed-panel">
                      <header className="arena-panel-heading"><div><span>Authority log</span><h2>Match events</h2></div><Play size={16} aria-hidden="true" /></header>
                      <div className="match-feed-list">{snapshot?.feed.slice(0, 8).map((event) => <div key={event.id} className={event.kind}><time>{new Date(event.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time><i /><span>{event.text}</span></div>)}</div>
                    </section>
                  </div>
                )}
              </section>
            </div>

            <button
              className={`mobile-tray-backdrop ${mobileTrayOpen ? 'visible' : ''}`}
              ref={trayBackdropRef}
              type="button"
              aria-label="Close Trade and Agent prompt tray"
              tabIndex={mobileTrayOpen ? 0 : -1}
              onClick={() => closeMobileTray(true)}
            />
            <aside id="arena-action-tray" className={`arena-right-rail ${mobileTrayOpen ? 'mobile-open' : ''}`} aria-label="Trade and agent command tray">
              <section className="arena-panel action-dock" ref={actionDockRef}>
                <button
                  className="mobile-tray-handle"
                  ref={trayHandleRef}
                  type="button"
                  aria-expanded={mobileTrayOpen}
                  aria-controls={actionView === 'trade' ? 'trade-panel' : 'prompt-panel'}
                  onClick={toggleMobileTray}
                  onPointerDown={beginTrayDrag}
                  onPointerMove={moveTrayDrag}
                  onPointerUp={(event) => completeTrayDrag(event, false)}
                  onPointerCancel={(event) => completeTrayDrag(event, true)}
                  onLostPointerCapture={(event) => completeTrayDrag(event, true)}
                >
                  <i aria-hidden="true" />
                  <span><small>{actionView === 'trade' ? 'Order ticket' : 'Paid agent directive'}</small><strong>{actionView === 'trade' ? `${outcome?.label ?? 'Choose outcome'} · ${outcome ? `${Math.round(outcome.probability * 100)}¢` : '—'}` : `${participant?.name ?? 'Choose agent'} · ${promptQuote ? tokenAmount(promptQuote.cost, promptToken) : '—'}`}</strong></span>
                  {mobileTrayOpen ? <ChevronDown size={18} aria-hidden="true" /> : <ChevronUp size={18} aria-hidden="true" />}
                </button>
                <div className="arena-action-tabs" role="tablist" aria-label="Market actions">
                  <button
                    id="trade-tab"
                    data-tab="trade"
                    type="button"
                    role="tab"
                    aria-selected={actionView === 'trade'}
                    aria-controls="trade-panel"
                    tabIndex={actionView === 'trade' ? 0 : -1}
                    className={actionView === 'trade' ? 'active' : ''}
                    onClick={() => chooseActionView('trade')}
                    onKeyDown={(event) => handleTabArrow(event, ['trade', 'prompt'] as const, actionView, chooseActionView)}
                  >
                    <Target size={15} aria-hidden="true" /> Trade
                  </button>
                  <button
                    id="prompt-tab"
                    data-tab="prompt"
                    type="button"
                    role="tab"
                    aria-selected={actionView === 'prompt'}
                    aria-controls="prompt-panel"
                    tabIndex={actionView === 'prompt' ? 0 : -1}
                    className={actionView === 'prompt' ? 'active' : ''}
                    onClick={() => chooseActionView('prompt')}
                    onKeyDown={(event) => handleTabArrow(event, ['trade', 'prompt'] as const, actionView, chooseActionView)}
                  >
                    <Bot size={15} aria-hidden="true" /> Agent prompt
                  </button>
                </div>

                {actionView === 'trade' ? (
                  <div id="trade-panel" role="tabpanel" aria-labelledby="trade-tab" className="prediction-ticket action-panel">
                    <header className="arena-panel-heading"><div><span>Order ticket</span><h2>Back the outcome</h2></div><span className={`arena-mode-badge ${adapter.mode}`}>{adapter.mode === 'demo' ? 'Practice' : 'Live'}</span></header>
                    <form onSubmit={reviewOrder} noValidate>
                      <div className="token-toggle" role="group" aria-label="Settlement token">{(['SOL', 'SOLZ'] as SettlementToken[]).map((item) => <button type="button" key={item} className={token === item ? 'active' : ''} onClick={() => { setToken(item); setAmount(item === 'SOL' ? '0.10' : '250'); setFieldError(null) }}>{item}</button>)}</div>
                      <div className="ticket-selection"><span>Selected outcome</span><strong>{outcome?.label ?? 'Choose an outcome'}</strong><small>{outcome ? `${Math.round(outcome.probability * 100)}¢ · ${probability(outcome.probability)} implied` : 'No market selected'}</small></div>
                      <label className="arena-amount-label" htmlFor="arena-order-amount"><span>Stake</span><small>Balance {tokenAmount(snapshot?.account.balances[token] ?? Number.NaN, token)}</small></label>
                      <div className={`arena-amount-input ${fieldError ? 'invalid' : ''}`}><input id="arena-order-amount" type="text" inputMode="decimal" value={amount} onChange={(event) => { setAmount(event.target.value); setFieldError(null) }} aria-invalid={fieldError ? 'true' : undefined} aria-describedby={fieldError ? 'arena-order-error' : undefined} /><b>{token}</b></div>
                      <div className="arena-presets">{(token === 'SOL' ? [0.05, 0.1, 0.5] : [100, 250, 1000]).map((value) => <button type="button" key={value} onClick={() => setAmount(String(value))}>{value}</button>)}<button type="button" disabled={!Number.isFinite(snapshot?.account.balances[token] ?? Number.NaN)} onClick={() => { const balance = snapshot?.account.balances[token] ?? 0; setAmount(String(token === 'SOL' ? Math.max(0, balance / 1.012).toFixed(3) : Math.floor(balance / 1.012))) }}>Max</button></div>
                      <dl className="ticket-quote"><div><dt>Shares</dt><dd>{orderQuote?.shares.toFixed(2) ?? '—'}</dd></div><div><dt>Fee</dt><dd>{orderQuote ? tokenAmount(orderQuote.fee, token) : '—'}</dd></div><div><dt>Potential payout</dt><dd>{orderQuote ? tokenAmount(orderQuote.potentialPayout, token) : '—'}</dd></div><div><dt>Potential profit</dt><dd>{orderQuote ? tokenAmount(orderQuote.potentialProfit, token) : '—'}</dd></div></dl>
                      {fieldError && <p id="arena-order-error" className="arena-field-error" role="alert">{fieldError}</p>}
                      <button className="arena-primary" type="submit" disabled={!canOrder}>{canOrder ? <>Review prediction <ChevronRight size={16} aria-hidden="true" /></> : adapter.mode === 'live' && !walletReady ? 'Connect Solana wallet' : 'Live orders locked'}</button>
                      <p className="ticket-capability"><ShieldCheck size={13} aria-hidden="true" /> {canOrder ? 'Practice execution is immediate and reversible.' : orderCapability?.reason}</p>
                    </form>
                  </div>
                ) : (
                  <div id="prompt-panel" role="tabpanel" aria-labelledby="prompt-tab" className="prompt-console action-panel">
                    <header className="arena-panel-heading"><div><span>Paid directive</span><h2>Navigate an agent</h2></div><Bot size={18} aria-hidden="true" /></header>
                    <form onSubmit={sendPrompt} noValidate><label htmlFor="agent-target">Agent-athlete</label><select id="agent-target" value={participant?.id ?? ''} onChange={(event) => setSelectedParticipantId(event.target.value)} disabled={!match?.participants.length}>{(match?.participants ?? []).map((item) => <option value={item.id} key={item.id}>{item.name} · {item.kills}K/{item.deaths}D</option>)}</select><label htmlFor="agent-prompt">Directive</label><textarea id="agent-prompt" value={promptText} onChange={(event) => { setPromptText(event.target.value); setPromptError(null); setPromptState('idle') }} maxLength={220} rows={4} placeholder="Move north, protect the flank…" aria-invalid={promptError ? 'true' : undefined} aria-describedby={promptError ? 'agent-prompt-error' : undefined} /><div className="prompt-quick-actions">{['Pressure leader', 'Hold north lane', 'Protect teammate'].map((value) => <button type="button" key={value} onClick={() => setPromptText(value)}>{value}</button>)}</div><div className="prompt-cost-row"><span>Execution cost</span><div className="prompt-token-switch">{(['SOL', 'SOLZ'] as SettlementToken[]).map((item) => <button type="button" key={item} className={promptToken === item ? 'active' : ''} onClick={() => setPromptToken(item)}>{item}</button>)}</div><strong>{promptQuote ? tokenAmount(promptQuote.cost, promptToken) : '—'}</strong></div>{promptError && <p id="agent-prompt-error" className="arena-field-error" role="alert">{promptError}</p>}{promptReceipt && <p className={`prompt-receipt ${promptReceipt.status}`} role="status"><Check size={14} aria-hidden="true" /> {promptReceipt.message}</p>}<button className="arena-secondary-action" type="submit" disabled={!canPrompt || promptState === 'submitting'}>{promptState === 'submitting' ? <><LoaderCircle className="spin" size={15} aria-hidden="true" /> Sending…</> : <><Send size={15} aria-hidden="true" /> Send directive</>}</button><p className="prompt-disclaimer">Agents remain autonomous. A paid directive is an attempt, not a guaranteed action or outcome.</p></form>
                  </div>
                )}
              </section>
            </aside>
          </div>

          <section className="arena-bottom-grid">
            <section className="arena-panel arena-positions"><header className="arena-panel-heading"><div><span>Portfolio</span><h2>Open predictions</h2></div><div className="arena-balance-pair"><span>{tokenAmount(snapshot?.account.balances.SOL ?? Number.NaN, 'SOL')}</span><span>{tokenAmount(snapshot?.account.balances.SOLZ ?? Number.NaN, 'SOLZ', true)}</span></div>{adapter.reset && <button type="button" onClick={() => void adapter.reset?.().then(setSnapshot)}><RefreshCcw size={14} aria-hidden="true" /> Reset</button>}</header>{snapshot?.account.positions.length ? <div className="arena-table-scroll" tabIndex={0} role="region" aria-label="Open prediction positions"><table><thead><tr><th>Market</th><th>Outcome</th><th>Stake</th><th>Avg.</th><th>Value</th><th>P&amp;L</th></tr></thead><tbody>{snapshot.account.positions.map((position) => <tr key={position.id}><td>{position.marketTitle}</td><td><b>{position.outcomeLabel}</b></td><td>{tokenAmount(position.stake, position.token)}</td><td>{probability(position.averagePrice)}</td><td>{tokenAmount(position.value, position.token)}</td><td className={position.pnl >= 0 ? 'positive' : 'negative'}>{position.pnl >= 0 ? '+' : ''}{tokenAmount(position.pnl, position.token)}</td></tr>)}</tbody></table></div> : <div className="arena-empty horizontal"><Gamepad2 size={19} aria-hidden="true" /><span><strong>No open predictions</strong> Pick a SOLZ match outcome to create the first position.</span></div>}</section>
            <section className="arena-panel arena-leaderboard"><header className="arena-panel-heading"><div><span>Weekly ladder</span><h2>Top competitors</h2></div><Trophy size={17} aria-hidden="true" /></header>{snapshot?.leaderboard.length ? <ol>{snapshot.leaderboard.slice(0, 5).map((row, index) => <li key={row.id}><b>{String(index + 1).padStart(2, '0')}</b><span><strong>{row.name}</strong><small>{row.matches} matches</small></span><em>{row.wins}W</em><em>{row.kills}K</em></li>)}</ol> : <div className="arena-empty compact"><Trophy size={18} aria-hidden="true" /><strong>Leaderboard source paused</strong><span>No public SOLZ leaderboard rows were returned.</span></div>}</section>
          </section>
        </>
      )}
      <div className="arena-footer"><span>SOLZ match authority → prediction signal → SOL / SOLZ execution</span><span>{adapter.mode === 'live' ? `Wallet ${walletAddress ? shortId(walletAddress) : 'not connected'}` : `${snapshot?.account.promptCount ?? 0} directives simulated`}</span></div>
      {activeIntent && orderState !== 'idle' && <OrderDialog intent={activeIntent} quote={adapter.quoteOrder(activeIntent)} state={orderState} error={orderError} receipt={orderReceipt} onClose={() => { if (orderState !== 'submitting') { setOrderState('idle'); setActiveIntent(null); setOrderError(null) } }} onConfirm={() => void confirmOrder()} />}
    </AppShell>
  )
}
