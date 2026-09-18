import { LoaderCircle, Search, Wallet } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useGetWalletOptionsCatalogue } from '@dynamic-labs-sdk/react-hooks'
import type { WalletOption } from '@dynamic-labs-sdk/client'
import { AppleMark, GoogleMark, TelegramMark, XMark } from './BrandMarks'
import './loginDialog.css'

/**
 * The login screen from sol-zero-engine-mainnet, carried over unchanged in
 * layout and wording so a player who has signed into the game recognises this
 * one: an "Access terminal" brief rail beside indexed login routes, the
 * providers drawn with their own marks.
 *
 * Two deliberate differences from
 * sol-zero-engine-mainnet/src/app/components/auth/DynamicLoginScreen.tsx:
 *
 *   - Telegram is a locked route here. The game completes Telegram through its
 *     own OAuth popup relay, which this app does not carry.
 *   - The catalogue only offers wallets reachable through a registered provider
 *     or an install link. The game's mobile hand-offs (WalletConnect URIs,
 *     in-app browsers, native deeplinks) belong to its Tauri build.
 *
 * This component owns no authentication. Every route calls back into
 * src/components/arena/DynamicWaasSolanaSessionClient.tsx, which owns the
 * Dynamic client, the WaaS account and the session.
 */

export type InstalledWalletRoute = {
  key: string
  name: string
  iconUrl?: string
}

type Props = {
  open: boolean
  onClose: () => void
  /** Dynamic's init lifecycle, straight from useInitStatus. */
  initStatus?: string
  initError?: string
  /** Solana providers this browser has announced. */
  installed: InstalledWalletRoute[]
  /** A route is running; every other route is held. */
  busy: boolean
  /** The running route's label, for its own spinner. */
  pending: string
  error: string
  /** Dynamic holds a session but the WaaS wallet has not landed yet. */
  setupPending: boolean
  network: string
  onGoogle: () => void
  onX: () => void
  onWallet: (providerKey: string, name: string) => void
}

const pad = (value: number) => String(value).padStart(2, '0')

/** The wallet's own connect path, as this browser can actually take it. */
type WalletRoute =
  | { kind: 'provider'; walletProviderKey: string }
  | { kind: 'install'; url: string }
  | { kind: 'unavailable' }

function solanaRoute(option: WalletOption): WalletRoute {
  const provider = option.connectionOptions.find(
    connection => connection.type === 'withWalletProvider' && connection.chain === 'SOL',
  )
  if (provider && provider.type === 'withWalletProvider') {
    return { kind: 'provider', walletProviderKey: provider.walletProviderKey }
  }
  const install = option.installationUrls
  const url = install?.chrome ?? install?.firefox ?? install?.edge ?? install?.safari ?? install?.opera ?? install?.native
  if (url) return { kind: 'install', url }
  return { kind: 'unavailable' }
}

function describeRoute(route: WalletRoute) {
  if (route.kind === 'provider') return { detail: 'Ready to connect', cue: '→' }
  if (route.kind === 'install') return { detail: 'Install the extension', cue: '↓' }
  return { detail: 'Not available in this browser', cue: '–' }
}

function AccessSigil() {
  const ticks = Array.from({ length: 32 }, (_, i) => (i * 360) / 32)
  const nodes = [
    { deg: 202, label: 'SOC' },
    { deg: 320, label: 'EXT' },
    { deg: 84, label: 'KEY' },
  ]
  return (
    <svg viewBox="0 0 240 200" className="dyl-sigil" aria-hidden>
      <g stroke="var(--ui-wire)" strokeWidth="0.4" opacity="0.24">
        {Array.from({ length: 9 }, (_, i) => (
          <line key={`v${i}`} x1={i * 30} y1="0" x2={i * 30} y2="200" />
        ))}
        {Array.from({ length: 8 }, (_, i) => (
          <line key={`h${i}`} x1="0" y1={i * 28} x2="240" y2={i * 28} />
        ))}
      </g>

      <g fill="none" stroke="rgb(var(--ui-text-soft-rgb) / 26%)" strokeWidth="0.7">
        <circle cx="120" cy="100" r="76" strokeDasharray="2 6" />
        <circle cx="120" cy="100" r="56" />
        <circle cx="120" cy="100" r="34" strokeDasharray="4 4" />
      </g>

      <g stroke="rgb(var(--ui-text-soft-rgb) / 40%)" strokeWidth="0.9">
        {ticks.map((deg, i) => {
          const rad = (deg * Math.PI) / 180
          const inner = i % 4 === 0 ? 68 : 73
          return (
            <line
              key={deg}
              x1={120 + Math.cos(rad) * inner}
              y1={100 + Math.sin(rad) * inner}
              x2={120 + Math.cos(rad) * 78}
              y2={100 + Math.sin(rad) * 78}
              opacity={i % 4 === 0 ? 0.95 : 0.45}
            />
          )
        })}
      </g>

      {nodes.map(node => {
        const rad = (node.deg * Math.PI) / 180
        const x = 120 + Math.cos(rad) * 56
        const y = 100 + Math.sin(rad) * 56
        return (
          <g key={node.label}>
            <line
              x1={120 + Math.cos(rad) * 22}
              y1={100 + Math.sin(rad) * 22}
              x2={x}
              y2={y}
              stroke="var(--ui-wire-2)"
              strokeWidth="0.8"
              opacity="0.7"
            />
            <rect
              x={x - 5}
              y={y - 5}
              width="10"
              height="10"
              fill="var(--ui-bg-deep)"
              stroke="var(--ui-accent)"
              strokeWidth="0.9"
            />
            <text
              x={x}
              y={y - 11}
              textAnchor="middle"
              fill="rgb(var(--ui-text-soft-rgb) / 62%)"
              fontSize="7"
              letterSpacing="1.4"
            >
              {node.label}
            </text>
          </g>
        )
      })}

      <g className="dyl-sigil__scan">
        <line x1="120" y1="100" x2="120" y2="24" stroke="var(--ui-accent)" strokeWidth="1" opacity="0.5" />
      </g>

      <g transform="translate(120 100)">
        <rect
          x="-19"
          y="-19"
          width="38"
          height="38"
          transform="rotate(45)"
          fill="rgb(var(--ui-bg-panel-rgb) / 96%)"
          stroke="var(--ui-accent)"
          strokeWidth="1.1"
        />
        <circle cx="0" cy="-3" r="5.5" fill="none" stroke="var(--ui-accent)" strokeWidth="1.6" />
        <path d="M0 2 L0 10 M-3 10 L3 10" stroke="var(--ui-accent)" strokeWidth="1.6" fill="none" />
      </g>
    </svg>
  )
}

type LoginOptionProps = {
  index: number
  glyph: ReactNode
  /** `light` sits the mark on a white chip, as Google's mark requires. */
  glyphField?: 'default' | 'light'
  name: string
  detail: string
  cue?: ReactNode
  variant?: 'default' | 'primary' | 'catalog' | 'locked'
  busy?: boolean
  disabled?: boolean
  onClick?: () => void
}

function LoginOption({
  index,
  glyph,
  glyphField = 'default',
  name,
  detail,
  cue = '→',
  variant = 'default',
  busy = false,
  disabled = false,
  onClick,
}: LoginOptionProps) {
  return (
    <button
      type="button"
      className={`dyl-option dyl-option--${variant}`}
      data-busy={busy || undefined}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="dyl-option__index" aria-hidden>{pad(index)}</span>
      <span
        className={`dyl-option__glyph${glyphField === 'light' ? ' dyl-option__glyph--light' : ''}`}
        aria-hidden
      >
        {glyph}
      </span>
      <span className="dyl-option__copy">
        <strong>{name}</strong>
        <small>{detail}</small>
      </span>
      <span className="dyl-option__cue" aria-hidden>
        {busy ? <LoaderCircle size={14} className="dyl-spinner" /> : cue}
      </span>
      <span className="dyl-option__sweep" aria-hidden />
    </button>
  )
}

type ScreenProps = Omit<Props, 'open' | 'onClose'> & {
  /** The directory is a page inside the screen, not a screen of its own. */
  catalogOpen: boolean
  catalogSearch: string
  catalogueLoading: boolean
  directory: readonly { option: WalletOption; route: WalletRoute }[]
  onSearch: (value: string) => void
  onOpenCatalog: () => void
  onLeaveCatalog: () => void
  onCloseScreen: () => void
}

/**
 * The screen itself: every input is a prop, so this repo's `renderToStaticMarkup`
 * tests can hold each route to what it claims to be without a DOM. LoginDialog
 * below owns the portal, the key handling and the catalogue query.
 */
export function LoginScreen({
  initStatus,
  initError,
  installed,
  busy,
  pending,
  error,
  setupPending,
  network,
  onGoogle,
  onX,
  onWallet,
  catalogOpen,
  catalogSearch,
  catalogueLoading,
  directory,
  onSearch,
  onOpenCatalog,
  onLeaveCatalog,
  onCloseScreen,
}: ScreenProps) {
  const initialized = initStatus === 'finished'
  const linkStatus = initStatus === 'failed' ? 'No link' : initialized ? 'Ready' : 'Linking'
  const extensionState = initStatus === 'failed' ? 'Unavailable' : initialized ? null : 'Scanning'
  const walletGlyph = (source?: string) => (source ? <img src={source} alt="" /> : <Wallet size={16} />)
  const stats: readonly { key: string; value: string }[] = [
    { key: 'Protocol', value: 'Dynamic' },
    { key: 'Network', value: network },
    { key: 'Extensions', value: extensionState ?? `${installed.length} found` },
  ]

  const takeRoute = (option: WalletOption, route: WalletRoute) => {
    if (busy || route.kind === 'unavailable') return
    if (route.kind === 'provider') {
      onWallet(route.walletProviderKey, option.name)
      return
    }
    window.open(route.url, '_blank', 'noreferrer')
  }

  return (
      <div
        className="solz-login__screen"
        role="dialog"
        aria-modal="true"
        aria-label="Account access"
        tabIndex={-1}
      >
        <div className="solz-login__inner">
          <header className="solz-login__header">
            <div className="solz-login__identity">
              <span>{catalogOpen ? 'Wallet directory' : 'Account access'}</span>
              <strong>{catalogOpen ? 'All Solana wallets' : 'Choose login'}</strong>
            </div>
            <div className="solz-login__header-actions">
              <span className="solz-login__status">● {linkStatus}</span>
              <button
                type="button"
                className="solz-login__close"
                onClick={catalogOpen ? onLeaveCatalog : onCloseScreen}
              >
                <kbd>Esc</kbd> {catalogOpen ? 'Back' : 'Close'}
              </button>
            </div>
          </header>

          <div className="solz-login__body">
            <div className="dyl">
              <aside className="dyl-brief">
                <div className="dyl-brief__head">
                  <span className="dyl-brief__eyebrow">Solana Zero</span>
                  {/* Two blocks stack as a two-line lockup, and fall back to one
                      spaced line when the rail turns into a strip. */}
                  <strong>
                    <span>Access</span> <span>terminal</span>
                  </strong>
                </div>
                <div className="dyl-brief__art">
                  <AccessSigil />
                  <span className="dyl-brief__art-tag">auth / dynamic</span>
                </div>
                <p className="dyl-brief__lede">
                  One account carries your wallet, your positions and your trade history. Pick a route
                  in — the rest can be linked later.
                </p>
                <dl className="dyl-brief__stats">
                  {stats.map(row => (
                    <div key={row.key} className="dyl-brief__stat">
                      <dt>{row.key}</dt>
                      <dd>{row.value}</dd>
                    </div>
                  ))}
                </dl>
              </aside>

              <div className="dyl-main">
                {initStatus === 'in-progress' || initStatus === 'uninitialized' ? (
                  <div className="dyl-signal" role="status">
                    <LoaderCircle size={15} aria-hidden className="dyl-spinner" />
                    <span>
                      <strong>Preparing secure sign-in</strong>
                      <small>Discovering installed extensions and wallet access…</small>
                    </span>
                  </div>
                ) : null}
                {initStatus === 'failed' ? (
                  <div className="dyl-signal dyl-signal--error" role="alert">
                    <span>
                      <strong>Account service unavailable</strong>
                      <small>{initError || 'Reload once the Dynamic environment is reachable.'}</small>
                    </span>
                  </div>
                ) : null}
                {setupPending ? (
                  <div className="dyl-signal dyl-signal--live" role="status" aria-live="polite">
                    <LoaderCircle size={15} aria-hidden className="dyl-spinner" />
                    <span>
                      <strong>Preparing your Solana wallet</strong>
                      <small>This can take a moment after social verification. Keep this window open…</small>
                    </span>
                  </div>
                ) : null}

                {catalogOpen ? (
                  <section className="dyl-panel dyl-panel--scroll" aria-labelledby="dyl-catalog">
                    <div className="dyl-panel__band">
                      <button type="button" className="dyl-band-back" onClick={onLeaveCatalog}>
                        <span aria-hidden>←</span> Back
                      </button>
                      <h2 id="dyl-catalog">All Solana wallets</h2>
                      <span className="dyl-panel__band-note">
                        {catalogueLoading ? 'Loading' : `${directory.length} listed`}
                      </span>
                    </div>
                    <label className="dyl-search">
                      <Search size={14} aria-hidden />
                      <span className="sr-only">Search wallets</span>
                      <input
                        value={catalogSearch}
                        onChange={event => onSearch(event.target.value)}
                        placeholder="Search wallets"
                        autoComplete="off"
                      />
                    </label>
                    <div className="dyl-panel__grid">
                      {catalogueLoading ? (
                        <div className="dyl-empty" role="status">Loading Dynamic wallet directory…</div>
                      ) : null}
                      {!catalogueLoading && directory.map(({ option, route }, index) => {
                        const presentation = describeRoute(route)
                        return (
                          <LoginOption
                            key={option.key}
                            index={index + 1}
                            glyph={walletGlyph(option.iconUrl)}
                            name={pending === option.name ? 'Connecting…' : option.name}
                            detail={presentation.detail}
                            cue={presentation.cue}
                            busy={pending === option.name}
                            disabled={route.kind === 'unavailable' || !initialized || busy}
                            onClick={() => takeRoute(option, route)}
                          />
                        )
                      })}
                      {!catalogueLoading && !directory.length ? (
                        <div className="dyl-empty" role="status">No Solana wallets match that search.</div>
                      ) : null}
                    </div>
                    <button type="button" className="dyl-return" onClick={onLeaveCatalog}>
                      <span aria-hidden>←</span> Back to login options
                    </button>
                  </section>
                ) : (
                  <>
                    <section className="dyl-panel" aria-labelledby="dyl-embedded">
                      <div className="dyl-panel__band">
                        <span className="dyl-panel__band-index" aria-hidden>01</span>
                        <h2 id="dyl-embedded">Embedded wallet</h2>
                        <span className="dyl-panel__band-note">no extension needed</span>
                      </div>
                      <p className="dyl-panel__lede">
                        Social login creates or restores your Solana wallet directly.
                      </p>
                      <div className="dyl-panel__list">
                        <LoginOption
                          index={1}
                          variant="primary"
                          glyph={<GoogleMark size={17} />}
                          glyphField="light"
                          name={pending === 'Google' ? 'Opening Google…' : 'Continue with Google'}
                          detail="Embedded wallet · fastest route in"
                          busy={pending === 'Google'}
                          disabled={!initialized || busy}
                          onClick={onGoogle}
                        />
                        <LoginOption
                          index={2}
                          variant="locked"
                          glyph={<TelegramMark size={20} />}
                          name="Telegram"
                          detail="Coming soon"
                          cue="soon"
                          disabled
                        />
                        <div className="dyl-panel__pair">
                          <LoginOption
                            index={3}
                            variant="locked"
                            glyph={<AppleMark size={17} className="dyl-brand-mono" />}
                            name="Apple"
                            detail="Coming soon"
                            cue="soon"
                            disabled
                          />
                          <LoginOption
                            index={4}
                            glyph={<XMark size={15} className="dyl-brand-mono" />}
                            name={pending === 'X' ? 'Opening X…' : 'Continue with X'}
                            detail="Embedded wallet"
                            busy={pending === 'X'}
                            disabled={!initialized || busy}
                            onClick={onX}
                          />
                        </div>
                      </div>
                    </section>

                    <section className="dyl-panel dyl-panel--grow" aria-labelledby="dyl-installed">
                      <div className="dyl-panel__band">
                        <span className="dyl-panel__band-index" aria-hidden>02</span>
                        <h2 id="dyl-installed">Installed extensions</h2>
                        <span className="dyl-panel__band-note">
                          {extensionState ?? `${installed.length} detected`}
                        </span>
                      </div>
                      <p className="dyl-panel__lede">
                        Every Solana wallet detected in this browser appears first.
                      </p>
                      <div className="dyl-panel__list">
                        {installed.map((provider, index) => (
                          <LoginOption
                            key={provider.key}
                            index={index + 1}
                            glyph={walletGlyph(provider.iconUrl)}
                            name={pending === provider.name ? 'Connecting…' : provider.name}
                            detail="Installed in this browser"
                            busy={pending === provider.name}
                            disabled={!initialized || busy}
                            onClick={() => onWallet(provider.key, provider.name)}
                          />
                        ))}
                        {!installed.length ? (
                          <div className="dyl-empty" role="status">
                            {initStatus === 'failed'
                              ? 'Extension scan unavailable.'
                              : initialized
                                ? 'No installed Solana wallet detected.'
                                : 'Detecting installed extensions…'}
                          </div>
                        ) : null}
                        <LoginOption
                          index={installed.length + 1}
                          variant="catalog"
                          glyph={<Wallet size={16} />}
                          name="Browse all wallets"
                          detail="Open the full Dynamic wallet directory"
                          cue="↗"
                          disabled={!initialized || busy}
                          onClick={onOpenCatalog}
                        />
                      </div>
                    </section>
                  </>
                )}

                {error ? (
                  <div className="dyl-signal dyl-signal--error" role="alert">
                    <span>
                      <strong>Login failed</strong>
                      <small>{error}</small>
                    </span>
                  </div>
                ) : null}

                <footer className="dyl-foot">
                  <span><kbd>Esc</kbd> {catalogOpen ? 'back to login' : 'close'}</span>
                  <span className="dyl-foot__note">Wallet sessions handled by Dynamic</span>
                </footer>
              </div>
            </div>
          </div>
        </div>
      </div>
  )
}

export function LoginDialog({ open, onClose, ...screen }: Props) {
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [catalogSearch, setCatalogSearch] = useState('')
  const surface = useRef<HTMLDivElement>(null)
  const { data: catalogue = [], isLoading: catalogueLoading } = useGetWalletOptionsCatalogue({
    includeMobileOptions: true,
    queryParams: { enabled: open && catalogOpen },
  })

  const leaveCatalog = useCallback(() => {
    setCatalogOpen(false)
    setCatalogSearch('')
  }, [])

  // Escape backs out of the directory first, then closes the screen — the
  // directory is a page inside this dialog, not a separate one.
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      if (catalogOpen) {
        leaveCatalog()
        return
      }
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [catalogOpen, leaveCatalog, onClose, open])

  // The page behind must not scroll under an open screen.
  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [open])

  useEffect(() => {
    if (open) surface.current?.focus()
    else leaveCatalog()
  }, [leaveCatalog, open])

  const directory = useMemo(() => {
    const query = catalogSearch.trim().toLowerCase()
    return catalogue
      .map(option => ({ option, route: solanaRoute(option) }))
      .filter(entry => !query || entry.option.name.toLowerCase().includes(query))
  }, [catalogSearch, catalogue])

  // The header island is deep inside a stacking context of its own, so the
  // screen is mounted on the body rather than beside its trigger.
  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div className="solz-login-layer" ref={surface} tabIndex={-1}>
      <button
        type="button"
        className="solz-login-layer__backdrop"
        aria-label="Close login options"
        onClick={onClose}
      />
      <LoginScreen
        {...screen}
        catalogOpen={catalogOpen}
        catalogSearch={catalogSearch}
        catalogueLoading={catalogueLoading}
        directory={directory}
        onSearch={setCatalogSearch}
        onOpenCatalog={() => setCatalogOpen(true)}
        onLeaveCatalog={leaveCatalog}
        onCloseScreen={onClose}
      />
    </div>,
    document.body,
  )
}
