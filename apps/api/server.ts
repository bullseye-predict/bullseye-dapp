import { timingSafeEqual } from 'node:crypto'
import type { MatchingEngine } from '../matcher/matching-engine'
import type { MarketScope } from '../matcher/settlement'
import { pendingSettlement } from '../matcher/settlement'
import type { MatcherStore } from '../matcher/store'
import type { Balance, Market, SignedMatchResult, SignedOrder, VenueId } from '../../packages/prediction-core/types'
import type { PortfolioPosition, PredictionPublicConfig } from '../../packages/prediction-core/market-data'
import { encodeStored, stringify } from '../../packages/prediction-core/serialization'
import { atomic, integer, invariant, marketKey, parseSignedOrder, PredictionError, quoteCeil, record, textField, validateOrder, venueId } from '../../packages/prediction-core/validation'
import type { TelemetryBridge } from '../../packages/telemetry/bridge'
import type { RequestAuthenticator } from './auth/requests'
import { PredictionDatabase } from './storage/database'
import { tradeCandles } from './market-data'
import { buildOrderBook } from '../matcher/orderbook'
import { HermesControlError } from '../hermes-worker/control'

export interface ChainGateway {
  config: { venue: VenueId; chainId: string }
  getMarket(marketId: string): Promise<Market>
  verifyOrder(order: Readonly<SignedOrder>): Promise<boolean>
  verifyRequest(account: string, message: string, signature: string, request?: { method: string; path: string }): Promise<boolean>
  getBalance(account: string): Promise<Balance>
}

export interface HermesControl {
  start(account: string, venue: VenueId, chainId: string, input: unknown): Promise<unknown>
  stop(account: string, venue: VenueId, chainId: string): Promise<unknown>
  configure(account: string, venue: VenueId, chainId: string, input: unknown): Promise<unknown>
  status?(account: string, venue: VenueId, chainId: string): unknown | Promise<unknown>
  sanitizedStatus?(account: string, venue: VenueId, chainId: string): unknown | Promise<unknown>
}

export interface ApiOptions {
  database: PredictionDatabase
  matcher: MatchingEngine
  matcherStore: MatcherStore
  gateways: ChainGateway[]
  authenticator: RequestAuthenticator
  telemetry?: TelemetryBridge
  controlToken?: string
  hermes?: HermesControl
  publicConfig?: PredictionPublicConfig
  allowedOrigins?: string[]
  acceptResult?: (result: SignedMatchResult) => Promise<unknown>
  enforceFunding?: boolean
  requireOrderProof?: boolean
  marketForTrading?: (market: Market) => Market
  /** Must return a complete, fresh indexed account view, including realized losses. */
  portfolio?: { getPositions(venue: VenueId, chainId: string, account: string): Promise<PortfolioPosition[]> }
  now?: () => number
}

export const gatewayKey = (venue: VenueId, chainId: string) => JSON.stringify([venue, chainId])
const accountKey = (venue: VenueId, account: string) => venue === 'SOLANA' ? account : account.toLowerCase()

function response(value: unknown, status = 200): Response {
  return new Response(stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } })
}

async function bodyText(request: Request): Promise<string> {
  const maximum = 64 * 1024
  if (Number(request.headers.get('content-length') ?? 0) > maximum) throw new PredictionError('BODY_TOO_LARGE', 'Request body exceeds 64 KB.', 413)
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maximum) { await reader.cancel(); throw new PredictionError('BODY_TOO_LARGE', 'Request body exceeds 64 KB.', 413) }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  return Buffer.concat(chunks).toString('utf8')
}

export function createPredictionApi(options: ApiOptions): (request: Request) => Promise<Response> {
  const { database, matcher, matcherStore, authenticator } = options
  const now = options.now ?? Date.now
  const gateways = new Map(options.gateways.map(gateway => [gatewayKey(gateway.config.venue, gateway.config.chainId), gateway]))
  const accountWork = new Map<string, Promise<unknown>>()

  // One API admission writer; the matcher store also serializes cross-process reservations.
  async function accountAdmission<T>(venue: VenueId, chainId: string, account: string, work: () => Promise<T>): Promise<T> {
    const key = JSON.stringify([venue, chainId, accountKey(venue, account)])
    const prior = accountWork.get(key) ?? Promise.resolve()
    const next = prior.catch(() => {}).then(work)
    accountWork.set(key, next)
    try { return await next } finally { if (accountWork.get(key) === next) accountWork.delete(key) }
  }

  async function assertFunding(orders: SignedOrder[]): Promise<void> {
    if (!options.enforceFunding || !orders.length) return
    const first = orders[0]!
    const owner = accountKey(first.venue, first.maker)
    const scopes = database.listMarkets(first.venue, first.chainId, now()).map(market => ({ venue: first.venue, chainId: first.chainId, marketId: market.id }))
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = await Promise.all(scopes.map(scope => matcherStore.read(scope)))
      const balance = await getGateway(first.venue, first.chainId).getBalance(first.maker)
      const hasSells = orders.some(order => order.side === 'SELL')
      if (hasSells && !options.portfolio) throw new PredictionError('PORTFOLIO_UNAVAILABLE', 'Current positions are required before selling.', 503)
      const positions = hasSells ? await options.portfolio!.getPositions(first.venue, first.chainId, first.maker) : []
      if (encodeStored(before) !== encodeStored(await Promise.all(scopes.map(scope => matcherStore.read(scope))))) continue
      let reserved = 0n
      const shares = new Map<string, bigint>()
      const addShares = (marketId: string, outcomeId: number, quantity: bigint) => { const key = JSON.stringify([marketId, outcomeId]); shares.set(key, (shares.get(key) ?? 0n) + quantity) }
      for (const state of before) {
        const active = state?.orders.filter(order => accountKey(first.venue, order.maker) === owner && ['OPEN', 'PARTIALLY_FILLED'].includes(order.status) && order.expiresAt > now()) ?? []
        for (const order of active) {
          if (order.side === 'BUY') reserved += quoteCeil(order.quantity - order.filled, order.price)
          else addShares(order.marketId, order.outcomeId, order.quantity - order.filled)
        }
        const ids = new Set(active.map(order => order.orderId))
        for (const plan of state?.settlements ?? []) if (pendingSettlement(plan.status)) {
          if (!ids.has(plan.buy.orderId) && accountKey(first.venue, plan.buy.maker) === owner) reserved += plan.collateral
          if (!ids.has(plan.sell.orderId) && accountKey(first.venue, plan.sell.maker) === owner) addShares(plan.marketId, plan.sell.outcomeId, plan.quantity)
        }
      }
      const buyCost = orders.filter(order => order.side === 'BUY').reduce((sum, order) => sum + quoteCeil(order.quantity, order.price), 0n)
      invariant(buyCost + reserved <= balance.total, 'INSUFFICIENT_COLLATERAL', 'Available collateral does not cover this order and existing reservations.')
      for (const order of orders.filter(order => order.side === 'SELL')) addShares(order.marketId, order.outcomeId, order.quantity)
      for (const [key, needed] of shares) {
        if (!hasSells) break
        const [marketId, outcomeId] = JSON.parse(key) as [string, number]
        const held = positions.find(position => position.marketId === marketId && position.outcomeId === outcomeId)?.quantity ?? 0n
        invariant(needed <= held, 'INSUFFICIENT_SHARES', 'Available shares do not cover this sell and existing reservations.')
      }
      return
    }
    throw new PredictionError('ACCOUNT_CHANGED', 'Account changed during order validation. Refresh and retry.', 503)
  }

  function scopeFrom(url: URL, marketId: string): MarketScope {
    return { venue: venueId(url.searchParams.get('venue')), chainId: textField(url.searchParams.get('chainId'), 'chainId'), marketId }
  }
  function getGateway(venue: VenueId, chainId: string): ChainGateway {
    const gateway = gateways.get(gatewayKey(venue, chainId))
    if (!gateway) throw new PredictionError('VENUE_UNAVAILABLE', 'This venue has no configured chain adapter.', 503)
    return gateway
  }
  function authorizeControl(request: Request): void {
    const expected = options.controlToken
    const supplied = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? ''
    if (!expected || expected.length < 32 || Buffer.byteLength(supplied) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) throw new PredictionError('UNAUTHORIZED', 'Service authentication is required.', 401)
  }
  async function syncMatcher(market: Market): Promise<void> {
    market = options.marketForTrading?.(market) ?? market
    const scope = { venue: market.venue, chainId: market.chainId, marketId: market.id }
    if (!await matcherStore.read(scope)) {
      try { await matcher.registerMarket(market) }
      catch (error) { if (!await matcherStore.read(scope)) throw error }
    }
    await matcher.updateMarket(market)
  }
  async function refreshMarket(scope: MarketScope): Promise<Market> {
    const current = await getGateway(scope.venue, scope.chainId).getMarket(scope.marketId)
    const market = options.marketForTrading?.(current) ?? current
    invariant(market.venue === scope.venue && market.chainId === scope.chainId && market.id === scope.marketId, 'WRONG_MARKET', 'Adapter returned a different market.')
    await syncMatcher(market)
    database.saveMarket(market)
    return options.marketForTrading?.(market) ?? market
  }
  function knownMarket(scope: MarketScope): Market {
    const market = database.getMarket(scope.venue, scope.chainId, scope.marketId, now())
    if (!market) throw new PredictionError('NOT_FOUND', 'Market not found.', 404)
    return options.marketForTrading?.(market) ?? market
  }
  async function userOrders(venue: VenueId, chainId: string, account: string, marketId?: string) {
    const markets = database.listMarkets(venue, chainId, now()).filter(market => marketId === undefined || market.id === marketId)
    const orders = (await Promise.all(markets.map(async market => (await matcherStore.read({ venue, chainId, marketId: market.id }))?.orders ?? []))).flat()
    return orders.filter(order => accountKey(venue, order.maker) === accountKey(venue, account) && (order.status === 'OPEN' || order.status === 'PARTIALLY_FILLED') && order.expiresAt > now())
  }

  const handle = async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url)
      const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
      if (request.method === 'GET' && url.pathname === '/config') return response(options.publicConfig ?? { audience: '', venues: [] })
      if (request.method === 'GET' && url.pathname === '/health') return response({ service: 'solz-prediction-api', status: 'ok', storage: 'sqlite', configuredVenues: options.gateways.map(gateway => ({ venue: gateway.config.venue, chainId: gateway.config.chainId })), telemetryConfigured: !!options.telemetry, hermesConfigured: !!options.hermes, portfolioConfigured: !!options.portfolio, settlement: 'separate-worker' })
      if (request.method === 'POST' && url.pathname === '/internal/telemetry') {
        if (!options.telemetry) throw new PredictionError('TELEMETRY_UNAVAILABLE', 'Telemetry bridge is not configured.', 503)
        const raw = await bodyText(request)
        const telemetry = options.telemetry.ingest(raw, request.headers.get('x-solz-telemetry-signature') ?? '')
        const sequence = database.appendEvent(`matches:${telemetry.matchId}`, 'MATCH_TELEMETRY', telemetry, now())
        return response({ accepted: true, sequence })
      }
      if (request.method === 'POST' && url.pathname === '/internal/results') {
        authorizeControl(request)
        if (!options.acceptResult) throw new PredictionError('SETTLEMENT_UNAVAILABLE', 'Result settlement is not configured.', 503)
        const input = record(JSON.parse(await bodyText(request)))
        invariant(typeof input.voided === 'boolean', 'INVALID_RESULT', 'voided must be a boolean.')
        const result: SignedMatchResult = {
          venue: venueId(input.venue), chainId: textField(input.chainId, 'chainId'), marketId: textField(input.marketId, 'marketId'), matchId: textField(input.matchId, 'matchId'),
          winningOutcomeId: integer(input.winningOutcomeId, 'winningOutcomeId', 0, 15), voided: input.voided, stateHash: textField(input.stateHash, 'stateHash'),
          matchEndedAt: integer(input.matchEndedAt, 'matchEndedAt'), expiresAt: integer(input.expiresAt, 'expiresAt'), signature: textField(input.signature, 'signature', 8192),
          ...(input.nonce === undefined ? {} : { nonce: atomic(input.nonce, 'nonce') }),
        }
        return response(await options.acceptResult(result), 202)
      }
      if (request.method === 'POST' && url.pathname === '/internal/markets') {
        authorizeControl(request)
        const input = record(JSON.parse(await bodyText(request)))
        const scope = { venue: venueId(input.venue), chainId: textField(input.chainId, 'chainId'), marketId: textField(input.marketId, 'marketId') }
        const market = await refreshMarket(scope)
        database.appendEvent(`markets:${marketKey(scope.venue, scope.chainId, scope.marketId)}`, 'MARKET_UPDATED', market, now())
        return response(market)
      }
      if (request.method === 'GET' && segments[0] === 'matches' && segments[2] === 'telemetry') {
        const telemetry = database.telemetry(textField(segments[1], 'matchId'))
        if (!telemetry) throw new PredictionError('NOT_FOUND', 'No authoritative telemetry has been received for this match.', 404)
        return response(telemetry)
      }

      const scope = scopeFrom(url, segments[1] ?? '')
      if (request.method === 'GET' && url.pathname === '/markets') return response(database.listMarkets(scope.venue, scope.chainId, now()).map(market => options.marketForTrading?.(market) ?? market))
      if (request.method === 'GET' && segments[0] === 'markets') {
        knownMarket(scope)
        if (segments.length === 2) return response(knownMarket(scope))
        if (segments[2] === 'snapshot') {
          const row = database.sql.query<{ sequence: number }, [string]>('SELECT COALESCE(MAX(sequence), 0) AS sequence FROM events WHERE topic = ?').get(`markets:${marketKey(scope.venue, scope.chainId, scope.marketId)}`)
          await syncMatcher(knownMarket(scope))
          const state = await matcherStore.read(scope)
          invariant(state, 'MARKET_UNAVAILABLE', 'Market snapshot is unavailable.')
          const market = state.market
          const book = buildOrderBook(state, now())
          if (market.status !== 'TRADING' || market.paused || now() < market.tradingStartsAt || now() >= market.tradingLocksAt) for (const outcome of book.outcomes) { outcome.bids = []; outcome.asks = [] }
          const trades = state.fills
          return response({ market, book, trades: trades.slice(-1000), sequence: row?.sequence ?? 0, serverTime: now(), telemetry: database.telemetry(market.matchId) })
        }
        if (segments[2] === 'candles') {
          const outcome = integer(Number(url.searchParams.get('outcomeId') ?? 0), 'outcomeId', 0, knownMarket(scope).outcomes.length - 1)
          const interval = integer(Number(url.searchParams.get('intervalMs') ?? 60_000), 'intervalMs', 1000)
          const from = integer(Number(url.searchParams.get('from') ?? 0), 'from')
          const to = integer(Number(url.searchParams.get('to') ?? now() + 1), 'to', 1)
          const limit = integer(Number(url.searchParams.get('limit') ?? 500), 'limit', 1, 1000)
          return response(tradeCandles((await matcherStore.read(scope))?.fills ?? [], outcome, interval, from, to, limit))
        }
        if (segments[2] === 'orderbook') {
          // Propagate time-derived locks to the book even when no worker has polled yet.
          await syncMatcher(knownMarket(scope))
          const book = await matcher.getOrderBook(scope)
          const outcomeId = url.searchParams.get('outcomeId')
          if (outcomeId !== null) book.outcomes = book.outcomes.filter(outcome => outcome.outcomeId === integer(Number(outcomeId), 'outcomeId', 0, 15))
          return response(book)
        }
        if (segments[2] === 'trades') return response((await matcherStore.read(scope))?.fills ?? [])
        if (segments[2] === 'events') return response(database.eventsAfter(`markets:${marketKey(scope.venue, scope.chainId, scope.marketId)}`, integer(Number(url.searchParams.get('after') ?? 0), 'after')))
      }
      if (request.method === 'POST' && segments[0] === 'markets' && segments[2] === 'quote') {
        knownMarket(scope)
        await refreshMarket(scope)
        const input = record(JSON.parse(await bodyText(request)))
        invariant(input.side === 'BUY' || input.side === 'SELL', 'INVALID_SIDE', 'side must be BUY or SELL.')
        return response(await matcher.quoteMarketOrder(scope, { account: textField(input.account, 'account'), outcomeId: integer(input.outcomeId, 'outcomeId', 0, 15), side: input.side, quantity: atomic(input.quantity, 'quantity'), slippageBps: integer(input.slippageBps, 'slippageBps', 0, 5000) }))
      }
      if (request.method === 'POST' && url.pathname === '/executions') {
        const body = await bodyText(request)
        const proof = await authenticator.authenticate(request, body)
        invariant(proof.venue === scope.venue && proof.chainId === scope.chainId, 'WRONG_VENUE', 'Request proof must match venue and chain.')
        const input = record(JSON.parse(body))
        const marketScope = { ...scope, marketId: textField(input.marketId, 'marketId') }
        await refreshMarket(marketScope)
        const intent = record(input.intent)
        invariant(intent.type === 'MARKET_IOC' && Array.isArray(input.orders) && input.orders.length <= 16, 'INVALID_EXECUTION', 'Invalid execution intent or child count.')
        const orders = input.orders.map(parseSignedOrder)
        invariant(orders.every(order => order.venue === proof.venue && order.chainId === proof.chainId && accountKey(proof.venue, order.maker) === accountKey(proof.venue, proof.account) && order.marketId === marketScope.marketId), 'WRONG_ACCOUNT', 'Every child must belong to the authenticated account and market.')
        return response(await accountAdmission(proof.venue, proof.chainId, proof.account, async () => {
          await assertFunding(orders)
          return matcher.executeMarketOrder(marketScope, { intent: { type: 'MARKET_IOC', quoteId: textField(intent.quoteId, 'quoteId'), quoteHash: textField(intent.quoteHash, 'quoteHash'), childrenHash: textField(intent.childrenHash, 'childrenHash') }, orders }, proof.account)
        }), 202)
      }
      if (request.method === 'GET' && segments[0] === 'executions' && segments.length === 2) {
        const proof = await authenticator.authenticate(request, '')
        invariant(proof.venue === scope.venue && proof.chainId === scope.chainId, 'WRONG_VENUE', 'Request proof must match venue and chain.')
        return response(await matcher.getExecution({ ...scope, marketId: textField(url.searchParams.get('marketId'), 'marketId') }, segments[1]!, proof.account))
      }
      if (request.method === 'POST' && url.pathname === '/orders') {
        const body = await bodyText(request)
        const order = parseSignedOrder(JSON.parse(body))
        if (options.requireOrderProof) {
          const proof = await authenticator.authenticate(request, body)
          invariant(proof.venue === order.venue && proof.chainId === order.chainId && accountKey(order.venue, proof.account) === accountKey(order.venue, order.maker), 'WRONG_ACCOUNT', 'Limit order admission requires its maker request proof.')
        }
        invariant(order.venue === scope.venue && order.chainId === scope.chainId, 'WRONG_VENUE', 'Order must match the request venue and chain.')
        knownMarket({ ...scope, marketId: order.marketId })
        const market = await refreshMarket({ ...scope, marketId: order.marketId })
        validateOrder(order, market, now())
        const accepted = await accountAdmission(order.venue, order.chainId, order.maker, async () => { await assertFunding([order]); return matcher.submitOrder(order) })
        return response({ orderId: accepted.orderId, status: accepted.status }, 202)
      }
      if ((request.method === 'DELETE' && segments[0] === 'orders' && segments.length === 2) || (request.method === 'POST' && url.pathname === '/orders/cancel-all')) {
        const body = await bodyText(request)
        const proof = await authenticator.authenticate(request, body)
        invariant(proof.venue === scope.venue && proof.chainId === scope.chainId, 'WRONG_VENUE', 'Request proof must match venue and chain.')
        const input = body ? record(JSON.parse(body)) : {}
        const marketId = input.marketId === undefined ? undefined : textField(input.marketId, 'marketId')
        const markets = database.listMarkets(scope.venue, scope.chainId, now()).filter(market => marketId === undefined || market.id === marketId)
        const changes = []
        for (const market of markets) {
          const marketScope = { ...scope, marketId: market.id }
          if (!await matcherStore.read(marketScope)) continue
          if (request.method === 'DELETE') {
            if ((await matcher.getOrders(marketScope)).some(order => order.orderId === segments[1] && accountKey(scope.venue, order.maker) === accountKey(scope.venue, proof.account))) changes.push(await matcher.cancelOrder(marketScope, segments[1]!, proof.account))
          } else changes.push(...await matcher.cancelAllOrders(marketScope, proof.account))
        }
        if (request.method === 'DELETE' && changes.length === 0) throw new PredictionError('NOT_FOUND', 'Order not found for this account.', 404)
        return response({ id: crypto.randomUUID(), status: 'SUBMITTED', scope: 'OFFCHAIN', requiresOnChainInvalidation: true, changes }, 202)
      }
      if (request.method === 'GET' && segments[0] === 'users' && segments.length === 3) {
        const account = accountKey(scope.venue, textField(segments[1], 'account'))
        if (segments[2] === 'hermes') {
          if (!options.hermes?.sanitizedStatus) return response({ state: 'DISABLED', reasonCode: 'CONFIGURE_VAULT' })
          return response(await options.hermes.sanitizedStatus(account, scope.venue, scope.chainId))
        }
        if (segments[2] === 'orders') return response((await userOrders(scope.venue, scope.chainId, account, url.searchParams.get('marketId') ?? undefined)).map(order => ({ ...order, signature: '' })))
        if (segments[2] === 'executions') return response(await matcher.getExecutions({ ...scope, marketId: textField(url.searchParams.get('marketId'), 'marketId') }, account))
        if (segments[2] === 'positions') {
          if (!options.portfolio) throw new PredictionError('PORTFOLIO_UNAVAILABLE', 'A finalized portfolio source has not been configured.', 503)
          return response(await options.portfolio.getPositions(scope.venue, scope.chainId, account))
        }
        if (segments[2] === 'balance') {
          const snapshot = async () => Promise.all(database.listMarkets(scope.venue, scope.chainId, now()).map(market => matcherStore.read({ ...scope, marketId: market.id })))
          for (let attempt = 0; attempt < 3; attempt++) {
            const before = await snapshot()
            // The chain read follows reservations, and changes during the RPC force a retry.
            const balance = await getGateway(scope.venue, scope.chainId).getBalance(account)
            if (encodeStored(before) !== encodeStored(await snapshot())) continue
            let reserved = 0n
            for (const state of before) {
              const orders = state?.orders.filter(order => accountKey(scope.venue, order.maker) === accountKey(scope.venue, account) && (order.status === 'OPEN' || order.status === 'PARTIALLY_FILLED') && order.expiresAt > now()) ?? []
              for (const order of orders) if (order.side === 'BUY') reserved += quoteCeil(order.quantity - order.filled, order.price)
              const activeIds = new Set(orders.map(order => order.orderId))
              // Removing a broadcast order from the book does not release pending collateral.
              for (const plan of state?.settlements ?? []) if (pendingSettlement(plan.status) && !activeIds.has(plan.buy.orderId) && accountKey(scope.venue, plan.buy.maker) === accountKey(scope.venue, account)) reserved += plan.collateral
            }
            return response({ ...balance, reserved, available: balance.total > reserved ? balance.total - reserved : 0n })
          }
          throw new PredictionError('BALANCE_CHANGED', 'Account orders changed during the balance read; retry.', 503)
        }
      }
      if (request.method === 'GET' && url.pathname === '/hermes/status') {
        if (!options.hermes?.status) throw new PredictionError('HERMES_UNAVAILABLE', 'Hermes has not been configured.', 503)
        const proof = await authenticator.authenticate(request, '')
        invariant(proof.venue === scope.venue && proof.chainId === scope.chainId, 'WRONG_VENUE', 'Request proof must match venue and chain.')
        return response(await options.hermes.status(proof.account, proof.venue, proof.chainId))
      }
      if (segments[0] === 'hermes' && ['POST', 'PUT'].includes(request.method)) {
        if (!options.hermes) throw new PredictionError('HERMES_UNAVAILABLE', 'Hermes requires a configured worker and an authorized vault session.', 503)
        const body = await bodyText(request)
        const proof = await authenticator.authenticate(request, body)
        invariant(proof.venue === scope.venue && proof.chainId === scope.chainId, 'WRONG_VENUE', 'Request proof must match venue and chain.')
        const input = body ? JSON.parse(body) : {}
        if (segments[1] === 'start' && request.method === 'POST') return response(await options.hermes.start(proof.account, proof.venue, proof.chainId, input), 202)
        if (segments[1] === 'stop' && request.method === 'POST') return response(await options.hermes.stop(proof.account, proof.venue, proof.chainId), 202)
        if (segments[1] === 'config' && request.method === 'PUT') return response(await options.hermes.configure(proof.account, proof.venue, proof.chainId, input))
      }
      throw new PredictionError('NOT_FOUND', 'Route not found.', 404)
    } catch (error) {
      if (error instanceof PredictionError) return response({ code: error.code, message: error.message }, error.status)
      if (error instanceof HermesControlError) return response({ code: error.code, message: error.message }, 409)
      if (error instanceof SyntaxError || error instanceof URIError) return response({ code: 'INVALID_INPUT', message: 'Malformed request.' }, 400)
      // RPC URLs may carry credentials: never echo raw provider exception messages to clients.
      return response({ code: 'REQUEST_FAILED', message: 'The operation could not be completed.' }, 503)
    }
  }
  return async request => {
    const origin = request.headers.get('origin')
    const allowed = !!origin && (options.allowedOrigins ?? []).includes(origin)
    if (origin && !allowed) return response({ code: 'ORIGIN_DENIED', message: 'This origin is not configured for the prediction API.' }, 403)
    const result = request.method === 'OPTIONS' ? new Response(null, { status: 204 }) : await handle(request)
    if (allowed) {
      result.headers.set('access-control-allow-origin', origin!)
      result.headers.set('vary', 'Origin')
      result.headers.set('access-control-allow-methods', 'GET, POST, PUT, DELETE, OPTIONS')
      result.headers.set('access-control-allow-headers', 'content-type, x-solz-venue, x-solz-chain, x-solz-account, x-solz-nonce, x-solz-expires-at, x-solz-signature')
      result.headers.set('access-control-max-age', '600')
    }
    return result
  }
}
