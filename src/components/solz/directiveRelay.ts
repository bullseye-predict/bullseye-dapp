/**
 * THE PAID AGENT-DIRECTIVE RELAY.
 *
 * A directive is not a message this site owns. It is a purchase in the SOLZ
 * game control plane (_solz-elysia, `/api/v1/viewer-actions/*`): the viewer
 * quotes a price, pays an SPL transfer to the treasury, and the match room runs
 * the instruction once the transfer finalizes. This module is the whole client
 * side of that contract, proxied same-origin through `/api/directives/*`.
 *
 * TWO THINGS ARE WORTH KNOWING BEFORE READING THE PRICE CODE.
 *
 * The fee has two shapes, and the operator picks one in the game admin editor.
 * In `usd` mode the fee is agreed in dollars - `baseUsd` x `markup`, x
 * `fastFactor` for the fast tier - and the token amount is derived per quote
 * from the mint's live DEX price, so the USD figure is knowable here and the
 * token amount is NOT. In `fixed` mode the fee IS a token amount the operator
 * typed, so the reverse holds: the token amount is knowable and there is no USD
 * figure at all. Nothing in this file invents either one.
 *
 * The token is chosen by MINT, not by name. The admin editor holds exactly two
 * slots, `SOLZ` and `COLACAT`, and what an operator picks for each is the mint
 * address. A slot with no mint is not for sale. The name a viewer should read
 * is therefore the mint's own registry identity where it is known, and the slot
 * name otherwise - see `directiveTokenLabel`.
 */

export const ACTION_POLICY_VERSION = 'match-only-no-refunds-v1'
export type DirectiveSlot = 'SOLZ' | 'COLACAT'
export type DirectiveEffort = 'fast' | 'low' | 'medium' | 'high'

export type DirectiveToken = { symbol: DirectiveSlot; mint: string; decimals: number; tokenProgram: string; promptPrice: string }
export type DirectiveSettings = {
  /** The master switch. False pauses every kind of purchase at once. */
  enabled: boolean
  /** Which kinds are on sale while the master switch is on. Only `prompt`
   *  concerns this site; the other two are bought inside the game. */
  actions: { prompt: boolean; snake_control: boolean; bomb: boolean }
  treasury: string
  tokens: DirectiveToken[]
  prompt: { mode: 'usd' | 'fixed'; token: DirectiveSlot; baseUsd: string; markup: number; fastFactor: number }
  quoteSeconds: number
  policy: string
}

/** What the relay recorded for one directive. Mirrors the control plane's `Purchase`. */
export type DirectivePurchase = {
  id: string
  matchId: string
  symbol: string
  mint: string
  decimals: number
  amountAtoms: string
  usdPrice: string | null
  tokenUsd: string | null
  expiresAt: number
  state: 'quoted' | 'paid' | 'consumed' | 'paid_expired' | 'executed' | 'failed'
}
export type DirectivePayment = {
  kind: 'spl-token'
  walletAddress: string
  tokenAccountAddress: string
  amountAtoms: string
  memoId: string
  quoteId: string
}
export type DirectiveQuote = { purchase: DirectivePurchase; payment: DirectivePayment; transaction: string; lastValidBlockHeight: number; policy: string }

/** The capability the spectator relay issues for a live match. It carries the
 *  match id the game itself uses, which is the on-chain id when a match has one
 *  and the source room id otherwise. A directive addressed to any other id is
 *  rejected, so this - never a market id built for this site - is what is sent. */
export type DirectiveCapability = { capability: string; matchId: string; sourceRoomId: string; endsAt: number; expiresAt: number; actions: string[] }

const numeric = /^(0|[1-9]\d*)(\.\d+)?$/

/** The control plane's own fixed-point reading, kept identical on purpose: the
 *  USD shown before a purchase must be the USD the relay charges, not a float
 *  that rounds a hundredth of a cent differently. */
export function decimalUnits(value: string, decimals: number): bigint {
  if (!numeric.test(value) || value.length > 60) throw new Error('action_price_invalid')
  const [whole, fraction = ''] = value.split('.')
  return BigInt(whole!) * 10n ** BigInt(decimals) + BigInt(fraction.slice(0, decimals).padEnd(decimals, '0') || '0')
}
const ceilDiv = (n: bigint, d: bigint) => (n + d - 1n) / d
const USD_SCALE = 1_000_000_000_000n

/** What one directive costs in USD, at 1e-12 precision. `null` when the
 *  operator has not priced directives yet, which is the state to render as no
 *  price at all rather than as zero. */
export function directiveUsd(settings: DirectiveSettings, effort: DirectiveEffort = 'low'): bigint | null {
  if (settings.prompt.mode === 'fixed') return null
  try {
    const usd = ceilDiv(
      decimalUnits(settings.prompt.baseUsd, 12) *
        decimalUnits(String(settings.prompt.markup), 6) *
        decimalUnits(String(effort === 'fast' ? settings.prompt.fastFactor : 1), 6),
      USD_SCALE,
    )
    return usd > 0n ? usd : null
  } catch { return null }
}

/** A price a reader recognises as money. Sub-cent fees keep enough decimals to
 *  stay a number instead of rounding to $0.00; nothing is padded past the last
 *  significant digit. */
export function usdLabel(usd12: bigint): string {
  const whole = usd12 / USD_SCALE
  const fraction = (usd12 % USD_SCALE).toString().padStart(12, '0').replace(/0+$/, '')
  if (!fraction) return `$${whole}.00`
  return `$${whole}.${fraction.length < 2 ? fraction.padEnd(2, '0') : fraction}`
}

/** A quoted amount, in whole tokens, grouped. Only ever called with atoms the
 *  relay returned. */
export function tokenAmountLabel(atoms: string, decimals: number): string {
  if (!/^\d+$/.test(atoms)) return ''
  const units = BigInt(atoms)
  const scale = 10n ** BigInt(decimals)
  const whole = (units / scale).toLocaleString('en-US')
  const fraction = (units % scale).toString().padStart(decimals, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction.slice(0, 4)}` : whole
}

/** What one directive costs in token atoms, when the operator priced directives
 *  as a fixed token amount. `null` in USD mode, where the amount exists only
 *  once the relay has quoted it against the live market, and `null` when the
 *  chosen slot carries no fixed price. Mirrors the control plane's own maths. */
export function directiveFixedAtoms(settings: DirectiveSettings, token: DirectiveToken | undefined, effort: DirectiveEffort = 'low'): bigint | null {
  if (settings.prompt.mode !== 'fixed' || !token) return null
  try {
    const factor = decimalUnits(String(effort === 'fast' ? settings.prompt.fastFactor : 1), 6)
    const atoms = ceilDiv(decimalUnits(token.promptPrice, token.decimals) * factor, 1_000_000n)
    return atoms > 0n ? atoms : null
  } catch { return null }
}

/** The slot an operator has actually priced and funded. Prefers a mint that is
 *  configured; returns nothing when neither slot is for sale. */
export function directiveToken(settings: DirectiveSettings, prefer?: DirectiveSlot): DirectiveToken | undefined {
  const usable = settings.tokens.filter(token => token.mint)
  return usable.find(token => token.symbol === (prefer ?? settings.prompt.token)) ?? usable[0]
}

/**
 * What to call the token on screen. The relay publishes a slot name, and the
 * slot's mint is the real identity - a fake local mint and a mainnet listing can
 * both sit in the `SOLZ` slot. Where the chain's registry knows the mint, its
 * ticker wins, because that is the name the viewer's wallet will show them.
 */
export function directiveTokenLabel(token: DirectiveToken | undefined, registry?: Map<string, { symbol: string }>): string {
  if (!token) return ''
  const known = registry?.get(token.mint)?.symbol?.trim()
  return known || token.symbol
}

/**
 * The cost slot never goes blank. A viewer reading an empty slot cannot tell a
 * free directive from an unconfigured relay, so where there is no price there
 * is still one true word about why - and it is the operator's word, read from
 * the relay, not a guess made here.
 */
export function directiveCostStatus(settings: DirectiveSettings | null, loading: boolean): string {
  if (loading) return 'READING'
  if (!settings) return 'RELAY OFF'
  if (!settings.enabled || !settings.actions.prompt) return 'NOT OPEN'
  if (!settings.treasury || !directiveToken(settings)) return 'NO TOKEN SET'
  return 'NOT PRICED'
}

/** The published price of one directive, in whatever unit the operator priced
 *  it in. `null` where there is no price to publish yet. */
export function directivePrice(settings: DirectiveSettings | null, token: DirectiveToken | undefined, effort: DirectiveEffort = 'low'): { usd: bigint; atoms?: undefined } | { atoms: bigint; usd?: undefined } | null {
  if (!settings) return null
  if (settings.prompt.mode === 'fixed') {
    const atoms = directiveFixedAtoms(settings, token, effort)
    return atoms === null ? null : { atoms }
  }
  const usd = directiveUsd(settings, effort)
  return usd === null ? null : { usd }
}

/** Why the composer is closed, in the viewer's terms. `undefined` means open. */
export function directiveUnavailableReason(settings: DirectiveSettings | null): string | undefined {
  if (!settings) return 'The directive relay is unreachable. Try again shortly.'
  if (!settings.enabled || !settings.actions.prompt) return 'Agent directives are not open yet.'
  if (!settings.treasury || !directiveToken(settings)) return 'Agent directives are not open yet.'
  if (!directivePrice(settings, directiveToken(settings))) return 'Agent directives are not priced yet.'
  return undefined
}

function asNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function parseDirectiveSettings(payload: unknown): DirectiveSettings {
  const body = payload as { ok?: unknown; settings?: Record<string, unknown>; policy?: unknown }
  const settings = body?.settings
  if (body?.ok !== true || !settings || typeof settings !== 'object') throw new Error('action_service_unavailable')
  const tokens = Array.isArray(settings.tokens) ? settings.tokens : []
  const prompt = (settings.prompt ?? {}) as Record<string, unknown>
  // An operator who has never seen the per-action switches sold all three, so
  // a missing flag reads as on. Only an explicit `false` closes a kind.
  const actions = (settings.actions ?? {}) as Record<string, unknown>
  return {
    enabled: settings.enabled === true,
    actions: {
      prompt: actions.prompt !== false,
      snake_control: actions.snake_control !== false,
      bomb: actions.bomb !== false,
    },
    treasury: typeof settings.treasury === 'string' ? settings.treasury : '',
    tokens: tokens.flatMap((raw): DirectiveToken[] => {
      const token = raw as Record<string, unknown>
      return token?.symbol === 'SOLZ' || token?.symbol === 'COLACAT'
        ? [{
            symbol: token.symbol,
            mint: typeof token.mint === 'string' ? token.mint : '',
            decimals: asNumber(token.decimals, 6),
            tokenProgram: typeof token.tokenProgram === 'string' ? token.tokenProgram : '',
            promptPrice: typeof token.promptPrice === 'string' && numeric.test(token.promptPrice) ? token.promptPrice : '0',
          }]
        : []
    }),
    prompt: {
      mode: prompt.mode === 'fixed' ? 'fixed' : 'usd',
      token: prompt.token === 'COLACAT' ? 'COLACAT' : 'SOLZ',
      baseUsd: typeof prompt.baseUsd === 'string' && numeric.test(prompt.baseUsd) ? prompt.baseUsd : '0',
      markup: asNumber(prompt.markup, 1),
      fastFactor: asNumber(prompt.fastFactor, 1),
    },
    quoteSeconds: asNumber(settings.quoteSeconds, 60),
    policy: typeof body.policy === 'string' ? body.policy : '',
  }
}

function parsePurchase(raw: unknown): DirectivePurchase {
  const value = raw as Record<string, unknown>
  if (!value || typeof value.id !== 'string' || typeof value.amountAtoms !== 'string') throw new Error('action_request_invalid')
  return {
    id: value.id,
    matchId: String(value.matchId ?? ''),
    symbol: String(value.symbol ?? ''),
    mint: String(value.mint ?? ''),
    decimals: asNumber(value.decimals, 6),
    amountAtoms: value.amountAtoms,
    usdPrice: typeof value.usdPrice === 'string' ? value.usdPrice : null,
    tokenUsd: typeof value.tokenUsd === 'string' ? value.tokenUsd : null,
    expiresAt: asNumber(value.expiresAt, 0),
    state: (value.state as DirectivePurchase['state']) ?? 'quoted',
  }
}

function parsePayment(raw: unknown): DirectivePayment {
  const value = raw as Record<string, unknown>
  if (!value || value.kind !== 'spl-token' || typeof value.walletAddress !== 'string' ||
    typeof value.tokenAccountAddress !== 'string' || typeof value.amountAtoms !== 'string' ||
    typeof value.memoId !== 'string' || typeof value.quoteId !== 'string')
    throw new Error('action_request_invalid')
  return {
    kind: 'spl-token',
    walletAddress: value.walletAddress,
    tokenAccountAddress: value.tokenAccountAddress,
    amountAtoms: value.amountAtoms,
    memoId: value.memoId,
    quoteId: value.quoteId,
  }
}

/** The relay speaks in `action_*` codes so an operator can grep a log for them.
 *  A viewer needs a sentence, and one that says whose turn it is to act. */
const messages: Record<string, string> = {
  action_sales_unavailable: 'Agent directives are not open yet.',
  action_token_unavailable: 'Directives are sold in a different token than the one your client asked for. Reload the page.',
  action_token_price_unavailable: 'The fuel token has no tradeable price right now, so a directive cannot be priced.',
  action_wallet_unverified: 'Connect and verify the wallet that will pay before sending a directive.',
  action_capability_required: 'This account cannot buy directives yet.',
  action_match_expired: 'The match ended before the directive was paid.',
  action_match_invalid: 'This match is not accepting directives.',
  action_kind_unavailable: 'This match is not accepting directives.',
  action_quote_expired: 'The quote expired. Send the directive again for a fresh price.',
  action_payment_unconfirmed: 'Waiting for the payment to finalize.',
  action_payment_failed: 'The payment transaction failed. Nothing was charged for the directive.',
  action_network_mismatch: 'Your wallet is on a different Solana network than the relay.',
  action_rate_limited: 'Directives are arriving too quickly. Try again in a few seconds.',
  action_price_invalid: 'The operator\'s directive price cannot be charged in this token. Check the price and the token decimals.',
  action_price_unavailable: 'The directive price is not set, so nothing can be quoted.',
  action_rpc_unavailable: 'The relay has no Solana connection, so a payment cannot be built.',
  action_request_invalid: 'The relay refused the request. Its log names the cause.',
  action_purchase_required: 'This match needs a purchase before it will take directives.',
  action_match_capability_invalid: 'This match is not accepting directives.',
  action_service_unavailable: 'The directive relay is unavailable.',
  action_database_unavailable: 'The directive relay is unavailable.',
}
export function directiveMessage(code: string): string {
  // An unmapped code still names itself. A viewer cannot act on `action_x`, but
  // the person they report it to can, and a bare "try again" makes a repeatable
  // failure look like a flake.
  return messages[code] ?? `The directive could not be sent (${code}). Try again.`
}

export class DirectiveError extends Error {
  constructor(readonly code: string, readonly detail?: string) {
    super(detail ? `${directiveMessage(code)} (${detail})` : directiveMessage(code))
  }
}

async function relay(path: string, init: RequestInit, base: string) {
  const response = await fetch(`${base}/${path}`, init)
  const payload = await response.json().catch(() => null) as { ok?: boolean; error?: string; detail?: string } | null
  if (!response.ok || payload?.ok !== true)
    throw new DirectiveError(
      typeof payload?.error === 'string' ? payload.error : 'action_service_unavailable',
      // Development only: the relay names the service that actually refused.
      typeof payload?.detail === 'string' ? payload.detail : undefined,
    )
  return payload as Record<string, unknown>
}

export async function readDirectiveSettings(base = '/api/directives', signal?: AbortSignal): Promise<DirectiveSettings> {
  const response = await fetch(`${base}/settings`, { headers: { accept: 'application/json' }, signal })
  return parseDirectiveSettings(await response.json())
}

export type DirectiveQuoteRequest = {
  /** Only for a match whose own room signed a capability. The relay names the
   *  live match itself when this is absent, which is the normal path. */
  capability?: string
  wallet: string
  token: DirectiveSlot
  text: string
  botId?: string
  effort?: DirectiveEffort
  idempotencyKey: string
}

export async function quoteDirective(request: DirectiveQuoteRequest, base = '/api/directives'): Promise<DirectiveQuote> {
  const payload = await relay('quotes', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      ...(request.capability ? { capability: request.capability } : {}),
      wallet: request.wallet,
      token: request.token,
      kind: 'prompt',
      seconds: 1,
      text: request.text,
      ...(request.botId ? { botId: request.botId } : {}),
      reasoningEffort: request.effort ?? 'low',
      policy: ACTION_POLICY_VERSION,
      idempotencyKey: request.idempotencyKey,
    }),
  }, base)
  const purchase = parsePurchase(payload.purchase)
  const payment = parsePayment(payload.payment)
  if (payment.quoteId !== purchase.id || payment.amountAtoms !== purchase.amountAtoms)
    throw new Error('action_request_invalid')
  return {
    purchase,
    payment,
    transaction: String(payload.transaction ?? ''),
    lastValidBlockHeight: asNumber(payload.lastValidBlockHeight, 0),
    policy: String(payload.policy ?? ''),
  }
}

/** The relay only accepts a FINALIZED transfer, which lands seconds after the
 *  wallet reports the transaction confirmed. Retrying the one call that says so
 *  is the whole wait; nothing else is polled. */
export async function confirmDirectivePayment(
  purchaseId: string,
  signature: string,
  base = '/api/directives',
  pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)),
): Promise<DirectivePurchase> {
  const deadline = Date.now() + 90_000
  for (;;) {
    try {
      const payload = await relay('payments', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ purchaseId, signature }),
      }, base)
      return parsePurchase(payload.purchase)
    } catch (error) {
      if (!(error instanceof DirectiveError) || error.code !== 'action_payment_unconfirmed' || Date.now() >= deadline) throw error
      await pause(3_000)
    }
  }
}
