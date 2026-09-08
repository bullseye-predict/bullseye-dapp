import { MAX_OUTCOMES, PRICE_SCALE, type Market, type Order, type SignedOrder } from '../../packages/prediction-core/types'
import { validateMarket, validateOrder } from '../../packages/prediction-core/validation'
import { bindMarketExecutionQuote, MAX_EXECUTION_MATCHES, MAX_MARKET_ORDER_TTL_MS, MAX_MARKET_QUOTE_TTL_MS, parseMarketExecutionRequest, parseMarketQuoteRequest,
  type MarketExecution, type MarketExecutionQuote, type MarketExecutionRequest, type MarketQuoteRequest } from '../../packages/prediction-core/execution'
import { activeOrders, availableQuantity, buildOrderBook, executableQuantity, isActiveOrder, quoteCeil } from './orderbook'
import { pendingSettlement, type MarketScope, type PlannedSettlement, type SettlementReceipt, type SettlementTransport } from './settlement'
import type { MatcherState, MatcherStore } from './store'
import { executionAccountKey, executionChildMatches, executionChildMaySettle, executionView, quoteExecutionDepth, refreshExecutions, type MarketExecutionRecord } from './execution'

export interface OrderVerifier {
  /** Verify the chain-domain signature, canonical order identity and current nonce validity. */
  verify(order: Readonly<SignedOrder>, market: Readonly<Market>): Promise<boolean>
}

export interface MatcherOptions {
  store: MatcherStore
  verifier: OrderVerifier
  now?: () => number
  marketExecution?: { quoteTtlMs?: number; signedOrderTtlMs?: number }
}

export interface CancelOrderResult {
  order: Order
  pendingSettlementIds: string[]
  /** Off-chain cancellation cannot invalidate a signature already broadcast to a chain. */
  requiresOnChainInvalidation: true
}

const makerKey = (order: Pick<SignedOrder, 'maker' | 'venue'>): string =>
  order.venue === 'SOLANA' ? order.maker : order.maker.toLowerCase()

function payloadKey(order: SignedOrder): string {
  return JSON.stringify([order.venue, order.chainId, order.marketId, makerKey(order), order.outcomeId,
    order.side, order.price.toString(), order.quantity.toString(), order.nonce.toString(), order.expiresAt])
}

function stateRequired(state: MatcherState | undefined): MatcherState {
  if (!state) throw new Error('Unknown market')
  return state
}

function validTime(now: number): void {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('Invalid clock')
}

function tradingAllowed(market: Market, now: number): boolean {
  return market.status === 'TRADING' && !market.paused && now >= market.tradingStartsAt &&
    now < market.tradingLocksAt && now < market.expiresAt
}

function expireOrders(state: MatcherState, now: number): void {
  for (const order of state.orders) {
    if (isActiveOrder(order) && order.expiresAt <= now) order.status = 'EXPIRED'
  }
  for (const plan of state.settlements) {
    if (plan.status === 'PLANNED' && (plan.buy.expiresAt <= now || plan.sell.expiresAt <= now)) {
      plan.status = 'FAILED'
      plan.failure = 'Order expired before broadcast'
      plan.updatedAt = now
    }
  }
  refreshExecutions(state, now)
}

function validateSignedOrder(order: SignedOrder, market: Market, now: number): void {
  if (order.venue !== market.venue || order.chainId !== market.chainId || order.marketId !== market.id) {
    throw new Error('Order market domain mismatch')
  }
  if (!tradingAllowed(market, now)) throw new Error('Market is not trading')
  if (typeof order.orderId !== 'string' || !order.orderId || order.orderId.length > 256 ||
    typeof order.maker !== 'string' || !order.maker || order.maker.length > 256 ||
    typeof order.signature !== 'string' || !order.signature || order.signature.length > 4096) {
    throw new Error('Order identity and signature required')
  }
  if (order.side !== 'BUY' && order.side !== 'SELL') throw new Error('Invalid order side')
  if (!Number.isInteger(order.outcomeId) || !market.outcomes.some((outcome) => outcome.id === order.outcomeId)) {
    throw new Error('Unknown outcome')
  }
  if (typeof order.price !== 'bigint' || order.price <= 0n || order.price > PRICE_SCALE ||
    typeof order.quantity !== 'bigint' || order.quantity <= 0n || order.quantity >= 2n ** 128n ||
    typeof order.nonce !== 'bigint' || order.nonce < 0n || order.nonce >= 2n ** 256n) {
    throw new Error('Invalid atomic order amount')
  }
  if (!Number.isSafeInteger(order.expiresAt) || order.expiresAt <= now || order.expiresAt > market.tradingLocksAt) {
    throw new Error('Order expiry must be before the trading cutoff')
  }
  validateOrder(order, market, now)
}

/** Chain-independent order admission, reservations and confirmed fill accounting. */
export class MatchingEngine {
  private readonly store: MatcherStore
  private readonly verifier: OrderVerifier
  private readonly now: () => number
  private readonly quoteTtlMs: number
  private readonly signedOrderTtlMs: number

  constructor(options: MatcherOptions) {
    this.store = options.store
    this.verifier = options.verifier
    this.now = options.now ?? Date.now
    this.quoteTtlMs = options.marketExecution?.quoteTtlMs ?? 10_000
    this.signedOrderTtlMs = options.marketExecution?.signedOrderTtlMs ?? MAX_MARKET_ORDER_TTL_MS
    if (!Number.isSafeInteger(this.quoteTtlMs) || this.quoteTtlMs < 1000 || this.quoteTtlMs > MAX_MARKET_QUOTE_TTL_MS ||
      !Number.isSafeInteger(this.signedOrderTtlMs) || this.signedOrderTtlMs < this.quoteTtlMs || this.signedOrderTtlMs > MAX_MARKET_ORDER_TTL_MS) {
      throw new Error('Market execution requires short quote and signed-order lifetimes')
    }
  }

  /** Indicative depth quote; no order is admitted and no balance/liquidity is reserved. */
  async quoteMarketOrder(scope: MarketScope, input: MarketQuoteRequest): Promise<MarketExecutionQuote> {
    const request = parseMarketQuoteRequest(input)
    const id = `quote:${globalThis.crypto.randomUUID()}`
    const draft = await this.store.transaction(scope, (current) => {
      const state = stateRequired(current)
      const now = this.now()
      validTime(now)
      expireOrders(state, now)
      if (!tradingAllowed(state.market, now)) throw new Error('Market is not trading')
      if (!state.market.outcomes.some((outcome) => outcome.id === request.outcomeId)) throw new Error('Unknown outcome')
      const orderExpiresAt = Math.floor(Math.min(now + this.signedOrderTtlMs, state.market.tradingLocksAt, state.market.expiresAt) / 1000) * 1000
      if (orderExpiresAt <= now) throw new Error('No signed-order lifetime remains before market cutoff')
      const quote = quoteExecutionDepth(state, request, { id, now, expiresAt: Math.min(now + this.quoteTtlMs, orderExpiresAt), orderExpiresAt })
      return { state, result: quote }
    })
    const quote = await bindMarketExecutionQuote(draft)
    return this.store.transaction(scope, (current) => {
      const state = stateRequired(current)
      const now = this.now()
      if (!tradingAllowed(state.market, now) || quote.expiresAt <= now) throw new Error('Quote expired before publication')
      const usedQuotes = new Set(state.executions?.map((execution) => execution.quoteId))
      state.executionQuotes = (state.executionQuotes ?? []).filter((entry) => entry.expiresAt > now || usedQuotes.has(entry.id))
      state.executionQuotes.push(quote)
      return { state, result: quote }
    })
  }

  /**
   * Host must authenticate the exact intent+orders request body before invoking this.
   * Revalidates the current book and reserves all executable child legs atomically.
   * Unmatched shares never rest; chain finality is still handled by settle/reconcile.
   */
  async executeMarketOrder(scope: MarketScope, input: MarketExecutionRequest, authenticatedAccount: string): Promise<MarketExecution> {
    const request = parseMarketExecutionRequest(input)
    const snapshot = stateRequired(await this.store.read(scope))
    const quote = this.executionQuote(snapshot, request, authenticatedAccount)
    const prior = snapshot.executions?.find((execution) => execution.quoteId === quote.id)
    if (prior) {
      this.assertSameExecution(snapshot, prior, request.orders)
      return this.getExecution(scope, prior.id, authenticatedAccount)
    }
    this.assertFreshExecutionQuote(quote, this.now())
    const binding = await bindMarketExecutionQuote(quote)
    if (binding.quoteHash !== quote.quoteHash || binding.childrenHash !== quote.childrenHash) throw new Error('Stored quote binding is invalid')
    this.assertExecutionChildren(quote, request.orders)
    for (const order of request.orders) validateSignedOrder(order, snapshot.market, this.now())
    const authorization = await Promise.all(request.orders.map((order) => this.verifier.verify(structuredClone(order), structuredClone(snapshot.market))))
    if (authorization.some((valid) => !valid)) throw new Error('Invalid execution child authorization')
    const id = `execution:${globalThis.crypto.randomUUID()}`
    return this.store.transaction(scope, (current) => {
      const state = stateRequired(current)
      const acceptedQuote = this.executionQuote(state, request, authenticatedAccount)
      const existing = state.executions?.find((execution) => execution.quoteId === acceptedQuote.id)
      if (existing) {
        this.assertSameExecution(state, existing, request.orders)
        refreshExecutions(state, this.now())
        return { state, result: executionView(existing) }
      }
      const now = this.now()
      validTime(now)
      expireOrders(state, now)
      this.assertFreshExecutionQuote(acceptedQuote, now)
      if (!tradingAllowed(state.market, now)) throw new Error('Market is not trading')
      this.assertExecutionChildren(acceptedQuote, request.orders)
      const children: Order[] = []
      for (const signed of request.orders) {
        validateSignedOrder(signed, state.market, now)
        if (state.orders.some((order) => order.orderId === signed.orderId || payloadKey(order) === payloadKey(signed))) throw new Error('Execution order replay rejected')
        // CANCELLED means the remainder is closed off-chain. Only the exact plans
        // reserved below may execute; no active-book path can rest this child.
        const child: Order = { ...signed, filled: 0n, status: 'CANCELLED', createdAt: now, sequence: state.nextSequence++ }
        state.orders.push(child)
        children.push(child)
      }
      const execution: MarketExecutionRecord = {
        ...scope, id, quoteId: acceptedQuote.id, account: acceptedQuote.account, outcomeId: acceptedQuote.outcomeId, side: acceptedQuote.side,
        status: 'CANCELLED', requestedQuantity: acceptedQuote.requestedQuantity, plannedQuantity: 0n, pendingQuantity: 0n,
        filledQuantity: 0n, cancelledQuantity: acceptedQuote.requestedQuantity, plannedCollateral: 0n, confirmedCollateral: 0n,
        orderIds: children.map((child) => child.orderId), settlementIds: [], createdAt: now, updatedAt: now,
        partialReasons: [...acceptedQuote.partialReasons], executionGuarantee: 'OFFCHAIN_IOC_ONLY', cancelRequested: false,
      }
      state.executions ??= []
      state.executions.push(execution)
      for (const child of children) {
        let remainder = child.quantity
        const makers = activeOrders(state, child.outcomeId, child.side === 'BUY' ? 'SELL' : 'BUY', now)
        for (const maker of makers) {
          if (remainder === 0n) break
          if (makerKey(child) === makerKey(maker)) continue
          const buy = child.side === 'BUY' ? child : maker
          const sell = child.side === 'SELL' ? child : maker
          if (buy.price < sell.price) break
          if (state.settlements.some((plan) => plan.status === 'FAILED' && plan.buy.orderId === buy.orderId && plan.sell.orderId === sell.orderId)) continue
          const capacity = availableQuantity(state, maker)
          const quantity = executableQuantity(remainder < capacity ? remainder : capacity, buy.price, sell.price)
          if (!quantity) { execution.partialReasons.push('ROUNDING_DUST'); continue }
          if (execution.settlementIds.length >= MAX_EXECUTION_MATCHES) { execution.partialReasons.push('MATCH_LIMIT'); break }
          const collateral = quoteCeil(quantity, sell.price)
          const plan: PlannedSettlement = {
            ...scope, id: JSON.stringify([scope.venue, scope.chainId, scope.marketId, state.nextSettlementSequence++]),
            buy: { ...buy }, sell: { ...sell }, price: sell.price, quantity, collateral,
            status: 'PLANNED', createdAt: now, updatedAt: now, executionId: execution.id,
          }
          state.settlements.push(plan)
          execution.settlementIds.push(plan.id)
          execution.plannedQuantity += quantity
          execution.plannedCollateral += collateral
          remainder -= quantity
        }
      }
      if (execution.plannedQuantity < acceptedQuote.executableQuantity) execution.partialReasons.push('BOOK_CHANGED')
      execution.partialReasons = [...new Set(execution.partialReasons)]
      refreshExecutions(state, now)
      return { state, result: executionView(execution) }
    })
  }

  async getExecution(scope: MarketScope, executionId: string, account: string): Promise<MarketExecution> {
    return this.store.transaction(scope, (current) => {
      const state = stateRequired(current)
      expireOrders(state, this.now())
      const execution = state.executions?.find((entry) => entry.id === executionId)
      if (!execution || executionAccountKey(scope.venue, execution.account) !== executionAccountKey(scope.venue, account)) throw new Error('Unknown account execution')
      return { state, result: executionView(execution) }
    })
  }

  async getExecutions(scope: MarketScope, account: string): Promise<MarketExecution[]> {
    return this.store.transaction(scope, (current) => {
      const state = stateRequired(current)
      expireOrders(state, this.now())
      return { state, result: (state.executions ?? []).filter((execution) =>
        executionAccountKey(scope.venue, execution.account) === executionAccountKey(scope.venue, account)).map(executionView) }
    })
  }

  async cancelExecution(scope: MarketScope, executionId: string, account: string): Promise<MarketExecution> {
    return this.store.transaction(scope, (current) => {
      const state = stateRequired(current)
      const execution = state.executions?.find((entry) => entry.id === executionId)
      if (!execution || executionAccountKey(scope.venue, execution.account) !== executionAccountKey(scope.venue, account)) throw new Error('Unknown account execution')
      const now = this.now()
      execution.cancelRequested = true
      for (const plan of state.settlements) {
        if (plan.executionId === executionId && plan.status === 'PLANNED') {
          plan.status = 'FAILED'; plan.cancelledBeforeSubmission = true
          plan.failure = 'Execution cancelled before submission'; plan.updatedAt = now
        }
      }
      refreshExecutions(state, now)
      return { state, result: executionView(execution) }
    })
  }

  private executionQuote(state: MatcherState, request: MarketExecutionRequest, account: string): MarketExecutionQuote {
    const quote = state.executionQuotes?.find((entry) => entry.id === request.intent.quoteId)
    if (!quote || executionAccountKey(state.market.venue, quote.account) !== executionAccountKey(state.market.venue, account)) throw new Error('Unknown account quote')
    if (quote.venue !== state.market.venue || quote.chainId !== state.market.chainId || quote.marketId !== state.market.id ||
      quote.quoteHash !== request.intent.quoteHash || quote.childrenHash !== request.intent.childrenHash) throw new Error('Execution quote scope or child binding mismatch')
    return quote
  }

  private assertFreshExecutionQuote(quote: MarketExecutionQuote, now: number): void {
    validTime(now)
    if (now < quote.createdAt || now >= quote.expiresAt || now >= quote.orderExpiresAt ||
      quote.expiresAt - quote.createdAt > MAX_MARKET_QUOTE_TTL_MS || quote.orderExpiresAt - quote.createdAt > MAX_MARKET_ORDER_TTL_MS) throw new Error('Market execution quote expired')
  }

  private assertExecutionChildren(quote: MarketExecutionQuote, orders: SignedOrder[]): void {
    if (orders.length !== quote.children.length || orders.some((order, index) => !executionChildMatches(order, quote.children[index]!))) {
      throw new Error('Signed execution children differ from authenticated quote')
    }
  }

  private assertSameExecution(state: MatcherState, execution: MarketExecutionRecord, orders: SignedOrder[]): void {
    if (orders.length !== execution.orderIds.length || orders.some((order, index) => {
      const original = state.orders.find((entry) => entry.orderId === execution.orderIds[index])
      return !original || order.orderId !== original.orderId || payloadKey(order) !== payloadKey(original)
    })) throw new Error('Quote was already executed with different signed children')
  }

  async registerMarket(market: Market): Promise<void> {
    const copy = structuredClone(market)
    validateMarket(copy)
    if (!copy.id || !copy.chainId || copy.outcomes.length < 2 || copy.outcomes.length > MAX_OUTCOMES ||
      copy.outcomes.some((outcome, index) => outcome.id !== index) ||
      ![copy.createdAt, copy.tradingStartsAt, copy.tradingLocksAt, copy.expiresAt].every(Number.isSafeInteger) ||
      copy.createdAt > copy.tradingStartsAt || copy.tradingStartsAt >= copy.tradingLocksAt || copy.tradingLocksAt > copy.expiresAt) {
      throw new Error('Invalid market')
    }
    await this.store.transaction({ ...copy, marketId: copy.id }, (current) => {
      if (current) throw new Error('Market already registered')
      return {
        state: { market: copy, nextSequence: 1, nextSettlementSequence: 1, orders: [], settlements: [], fills: [] },
        result: undefined,
      }
    })
  }

  async updateMarket(market: Market): Promise<void> {
    const next = structuredClone(market)
    validateMarket(next)
    await this.store.transaction({ ...next, marketId: next.id }, (current) => {
      const state = stateRequired(current)
      const previous = state.market
      if (previous.matchId !== next.matchId || previous.marketAddress !== next.marketAddress ||
        previous.collateralToken !== next.collateralToken || previous.collateralDecimals !== next.collateralDecimals ||
        previous.createdAt !== next.createdAt || previous.tradingStartsAt !== next.tradingStartsAt ||
        previous.tradingLocksAt !== next.tradingLocksAt || previous.expiresAt !== next.expiresAt ||
        JSON.stringify(previous.outcomes) !== JSON.stringify(next.outcomes)) throw new Error('Immutable market fields changed')
      const transitions: Record<Market['status'], Market['status'][]> = {
        PENDING: ['PENDING', 'TRADING', 'LOCKED', 'VOIDED'],
        TRADING: ['TRADING', 'LOCKED', 'RESOLVED', 'VOIDED'],
        LOCKED: ['LOCKED', 'RESOLVED', 'VOIDED'],
        RESOLVED: ['RESOLVED'],
        VOIDED: ['VOIDED'],
      }
      if (!transitions[previous.status].includes(next.status)) throw new Error('Invalid market transition')
      if (next.status === 'RESOLVED' && (!next.outcomes.some((outcome) => outcome.id === next.winningOutcomeId) ||
        (previous.status === 'RESOLVED' && previous.winningOutcomeId !== next.winningOutcomeId))) throw new Error('Invalid winner')
      state.market = next
      return { state, result: undefined }
    })
  }

  async submitOrder(input: SignedOrder): Promise<Order> {
    const order = structuredClone(input)
    const snapshot = stateRequired(await this.store.read(order))
    validateSignedOrder(order, snapshot.market, this.now())
    if (!await this.verifier.verify(structuredClone(order), structuredClone(snapshot.market))) throw new Error('Invalid order authorization')
    return this.store.transaction(order, (current) => {
      const state = stateRequired(current)
      const now = this.now()
      validTime(now)
      validateSignedOrder(order, state.market, now)
      if (state.orders.some((existing) => existing.orderId === order.orderId || payloadKey(existing) === payloadKey(order))) {
        throw new Error('Order replay rejected')
      }
      const accepted: Order = { ...order, filled: 0n, status: 'OPEN', createdAt: now, sequence: state.nextSequence++ }
      state.orders.push(accepted)
      return { state, result: accepted }
    })
  }

  async cancelOrder(scope: MarketScope, orderId: string, account: string): Promise<CancelOrderResult> {
    return this.store.transaction(scope, (current) => {
      const state = stateRequired(current)
      const order = state.orders.find((entry) => entry.orderId === orderId)
      if (!order) throw new Error('Unknown order')
      if (makerKey(order) !== makerKey({ maker: account, venue: scope.venue })) throw new Error('Order account mismatch')
      if (isActiveOrder(order)) order.status = 'CANCELLED'
      // Unsubmitted plans can be revoked safely; submitted plans retain reservations.
      for (const plan of state.settlements) {
        if (plan.status === 'PLANNED' && (plan.buy.orderId === orderId || plan.sell.orderId === orderId)) {
          plan.status = 'FAILED'
          plan.cancelledBeforeSubmission = true
          plan.failure = 'Order cancelled before submission'
          plan.updatedAt = this.now()
        }
      }
      refreshExecutions(state, this.now())
      return { state, result: {
        order,
        pendingSettlementIds: state.settlements.filter((plan) => pendingSettlement(plan.status) &&
          (plan.buy.orderId === orderId || plan.sell.orderId === orderId)).map((plan) => plan.id),
        requiresOnChainInvalidation: true as const,
      } }
    })
  }

  async cancelAllOrders(scope: MarketScope, account: string): Promise<CancelOrderResult[]> {
    const orders = await this.getOrders(scope)
    const settlements = await this.getSettlements(scope)
    const own = orders.filter((order) => (isActiveOrder(order) || settlements.some((plan) => pendingSettlement(plan.status) &&
      (plan.buy.orderId === order.orderId || plan.sell.orderId === order.orderId))) &&
      makerKey(order) === makerKey({ maker: account, venue: scope.venue }))
    const results: CancelOrderResult[] = []
    for (const order of own) results.push(await this.cancelOrder(scope, order.orderId, account))
    return results
  }

  async getOrders(scope: MarketScope): Promise<Order[]> {
    return this.store.transaction(scope, (current) => {
      const state = stateRequired(current)
      expireOrders(state, this.now())
      return { state, result: state.orders }
    })
  }

  async getOrderBook(scope: MarketScope) {
    return this.store.transaction(scope, (current) => {
      const state = stateRequired(current)
      const now = this.now()
      expireOrders(state, now)
      const book = buildOrderBook(state, now)
      if (!tradingAllowed(state.market, now)) {
        for (const outcome of book.outcomes) { outcome.bids = []; outcome.asks = [] }
      }
      return { state, result: book }
    })
  }

  async getSettlements(scope: MarketScope): Promise<PlannedSettlement[]> {
    return stateRequired(await this.store.read(scope)).settlements
  }

  async getFills(scope: MarketScope) {
    return stateRequired(await this.store.read(scope)).fills
  }

  /** Reserve one executable price/time pair atomically. No portfolio change occurs yet. */
  async planNext(scope: MarketScope, outcomeId?: number): Promise<PlannedSettlement | undefined> {
    return this.store.transaction(scope, (current) => {
      const state = stateRequired(current)
      const now = this.now()
      validTime(now)
      expireOrders(state, now)
      if (!tradingAllowed(state.market, now)) return { state, result: undefined }
      if (outcomeId !== undefined && !state.market.outcomes.some((outcome) => outcome.id === outcomeId)) throw new Error('Unknown outcome')
      for (const outcome of state.market.outcomes) {
        if (outcomeId !== undefined && outcome.id !== outcomeId) continue
        const buys = activeOrders(state, outcome.id, 'BUY', now)
        const sells = activeOrders(state, outcome.id, 'SELL', now)
        for (const buy of buys) {
          for (const sell of sells) {
            if (sell.price > buy.price) break
            if (makerKey(buy) === makerKey(sell)) continue
            // A finalized revert is definitive about that transaction, not proof the
            // orders are now executable. Keep this exact signed pair quarantined;
            // a maker must submit a new authorized payload to retry it. Other pairs
            // remain eligible, so a stale balance/allowance cannot starve the book.
            if (state.settlements.some((plan) => plan.status === 'FAILED' &&
              plan.buy.orderId === buy.orderId && plan.sell.orderId === sell.orderId)) continue
            const buyAvailable = availableQuantity(state, buy)
            const sellAvailable = availableQuantity(state, sell)
            const quantity = executableQuantity(buyAvailable < sellAvailable ? buyAvailable : sellAvailable, buy.price, sell.price)
            if (quantity === 0n) continue
            const collateral = quoteCeil(quantity, sell.price)
            // Identical to the settlement contracts: rounding may not violate a BUY limit.
            if (collateral * PRICE_SCALE > quantity * buy.price) continue
            const plan: PlannedSettlement = {
              ...scope,
              id: JSON.stringify([scope.venue, scope.chainId, scope.marketId, state.nextSettlementSequence++]),
              buy: { ...buy }, sell: { ...sell }, price: sell.price, quantity, collateral,
              status: 'PLANNED', createdAt: now, updatedAt: now,
            }
            state.settlements.push(plan)
            return { state, result: plan }
          }
        }
      }
      return { state, result: undefined }
    })
  }

  /** Claim durably before broadcasting. Concurrent callers can never submit the same plan twice. */
  async settle(scope: MarketScope, settlementId: string, transport: SettlementTransport): Promise<PlannedSettlement> {
    const claim = await this.store.transaction(scope, (current) => {
      const state = stateRequired(current)
      const plan = state.settlements.find((entry) => entry.id === settlementId)
      if (!plan) throw new Error('Unknown settlement')
      if (plan.status !== 'PLANNED') return { state, result: { plan, submit: false } }
      const now = this.now()
      expireOrders(state, now)
      const orders = state.orders.filter((order) => order.orderId === plan.buy.orderId || order.orderId === plan.sell.orderId)
      if (!tradingAllowed(state.market, now) || orders.length !== 2 || orders.some((order) =>
        !isActiveOrder(order) && !executionChildMaySettle(state, order, plan, now))) {
        plan.status = 'FAILED'
        plan.failure = 'Market or order no longer eligible before broadcast'
        plan.updatedAt = now
        refreshExecutions(state, now)
        return { state, result: { plan, submit: false } }
      }
      plan.status = 'SUBMITTING'
      plan.updatedAt = now
      refreshExecutions(state, now)
      return { state, result: { plan, submit: true } }
    })
    if (!claim.submit) return claim.plan
    try {
      return await this.applyReceipt(scope, settlementId, await transport.submit(claim.plan))
    } catch {
      // Includes timeouts and malformed RPC replies: retain funds/quantity reservations.
      return this.applyReceipt(scope, settlementId, { status: 'UNKNOWN' })
    }
  }

  /** Recovery only looks up a broadcast. UNKNOWN is never permission to rebroadcast. */
  async reconcile(scope: MarketScope, settlementId: string, transport: SettlementTransport): Promise<PlannedSettlement> {
    const plan = stateRequired(await this.store.read(scope)).settlements.find((entry) => entry.id === settlementId)
    if (!plan) throw new Error('Unknown settlement')
    if (!pendingSettlement(plan.status) || plan.status === 'PLANNED') return plan
    try {
      return await this.applyReceipt(scope, settlementId, await transport.lookup(plan))
    } catch {
      return this.applyReceipt(scope, settlementId, { status: 'UNKNOWN' })
    }
  }

  private async applyReceipt(scope: MarketScope, settlementId: string, receipt: SettlementReceipt): Promise<PlannedSettlement> {
    return this.store.transaction(scope, (current) => {
      const state = stateRequired(current)
      const plan = state.settlements.find((entry) => entry.id === settlementId)
      if (!plan) throw new Error('Unknown settlement')
      if (plan.status === 'CONFIRMED' || plan.status === 'FAILED') return { state, result: plan }
      if (receipt.status !== 'CONFIRMED' && receipt.status !== 'FAILED' && receipt.status !== 'PENDING' && receipt.status !== 'UNKNOWN') {
        throw new Error('Invalid settlement receipt')
      }
      if ((receipt.status === 'CONFIRMED' || receipt.status === 'PENDING') &&
        (typeof receipt.txHash !== 'string' || !receipt.txHash || receipt.txHash.length > 256)) throw new Error('Missing transaction hash')
      plan.updatedAt = this.now()
      if (receipt.txHash) plan.txHash = receipt.txHash
      if (receipt.status === 'CONFIRMED') {
        if (!Number.isSafeInteger(receipt.confirmedAt) || receipt.confirmedAt < 0) throw new Error('Invalid confirmation time')
        for (const orderId of [plan.buy.orderId, plan.sell.orderId]) {
          const order = state.orders.find((entry) => entry.orderId === orderId)
          if (!order || order.filled + plan.quantity > order.quantity) throw new Error('Fill conservation violation')
          order.filled += plan.quantity
          if (order.filled === order.quantity) order.status = 'FILLED'
          else if (isActiveOrder(order)) order.status = 'PARTIALLY_FILLED'
        }
        state.fills.push({
          ...scope, id: plan.id, outcomeId: plan.buy.outcomeId, buyOrderId: plan.buy.orderId,
          sellOrderId: plan.sell.orderId, price: plan.price, quantity: plan.quantity,
          txHash: receipt.txHash, timestamp: receipt.confirmedAt,
        })
        plan.status = 'CONFIRMED'
      } else if (receipt.status === 'FAILED') {
        if (typeof receipt.reason !== 'string' || !receipt.reason) throw new Error('Missing failure proof/reason')
        plan.status = 'FAILED'
        plan.failure = receipt.reason.slice(0, 512)
      } else {
        plan.status = receipt.status === 'PENDING' ? 'PENDING' : 'AMBIGUOUS'
      }
      refreshExecutions(state, this.now())
      return { state, result: plan }
    })
  }
}
