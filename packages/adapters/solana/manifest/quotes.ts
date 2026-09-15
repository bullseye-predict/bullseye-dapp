type Level = { price: bigint; quantity: bigint }
const SCALE = 1_000_000n
const cost = (quantity: bigint, price: bigint) => (quantity * price + SCALE - 1n) / SCALE

/** Manifest quotes raw prices at 1e18; a market price is 1e6 micros. */
const RAW_PRICE_DIVISOR = 10n ** 12n

/** One row per PRICE, not one per resting order.
 *
 *  Twelve orders resting at 50c are one level at 50c, and every consumer of a
 *  ladder assumes that — an order book keys its rows by price, so a 1:1 map
 *  rendered twelve identical rows sharing one React key. Aggregated on the
 *  post-scale price so two raw prices that truncate to the same micro merge
 *  rather than collide.
 *
 *  This lives beside `binaryQuotes`, which consumes it, so the browser and the
 *  server-side sampler cannot aggregate a book two different ways and then
 *  disagree about its best bid. */
export function bookLevels(orders: readonly { price: unknown; numBaseAtoms: unknown }[]): Level[] {
  const totals = new Map<bigint, bigint>()
  for (const order of orders) {
    const price = BigInt((order.price as { toString(): string }).toString()) / RAW_PRICE_DIVISOR
    const quantity = BigInt((order.numBaseAtoms as { toString(): string }).toString())
    totals.set(price, (totals.get(price) ?? 0n) + quantity)
  }
  return [...totals].map(([price, quantity]) => ({ price, quantity }))
}

/** The consolidated quote for a market, from its two raw books. The one entry
 *  point a caller needs when it holds the books and wants the price. */
export function marketBookQuote(
  yes: { asks(): unknown[]; bids(): unknown[] } | null | undefined,
  no: { asks(): unknown[]; bids(): unknown[] } | null | undefined,
) {
  const side = (book: { asks(): unknown[]; bids(): unknown[] } | null | undefined) => book
    ? { asks: bookLevels(book.asks() as never[]), bids: bookLevels(book.bids() as never[]) }
    : { asks: [] as Level[], bids: [] as Level[] }
  const a = side(yes), b = side(no)
  if (!a.asks.length && !a.bids.length && !b.asks.length && !b.bids.length && !yes && !no) return undefined
  return binaryQuotes(a.asks, a.bids, b.asks, b.bids)
}

/** IOC bounds are derived only from asks. Cap the entire order at the reviewed
 * budget even if every share executes at the worst price on its path. */
export function marketBuyQuote(asks: readonly Level[], budget: bigint) {
  if (budget <= 0n) throw new Error('Enter a positive order amount.')
  const ladder = asks.filter(row => row.quantity > 0n && row.price > 0n && row.price < SCALE)
    .slice().sort((a, b) => a.price < b.price ? -1 : a.price > b.price ? 1 : 0)
  if (!ladder.length) throw new Error('No sellers for this outcome. Place a limit order or wait for sell liquidity.')
  let remaining = budget, quantity = 0n, priceMicros = 0n
  for (const row of ladder) {
    const affordable = remaining * SCALE / row.price
    const taken = affordable < row.quantity ? affordable : row.quantity
    if (!taken) break
    quantity += taken
    remaining -= cost(taken, row.price)
    priceMicros = row.price
    if (taken < row.quantity) break
  }
  if (!quantity || !priceMicros) throw new Error('The amount is too small at the current ask.')
  quantity = quantity < budget * SCALE / priceMicros ? quantity : budget * SCALE / priceMicros
  let left = quantity, estimatedCost = 0n
  for (const row of ladder) {
    const taken = left < row.quantity ? left : row.quantity
    estimatedCost += cost(taken, row.price)
    left -= taken
    if (!left) break
  }
  return { quantity, priceMicros, maximumCost: cost(quantity, priceMicros), estimatedCost }
}

/** The opposing bid buys the other half of a newly collateralized complete set. */
export function complementAsks(bids: readonly Level[]): Level[] {
  // Spread rather than rebuild: a level can carry more than price and size (how
  // much of it is the viewer's own resting order, say), and that has to survive
  // the trip to the other outcome's ladder.
  return bids.filter(row => row.price > 0n && row.price < SCALE && row.quantity > 0n)
    .map(row => ({ ...row, price: SCALE - row.price }))
}

/** Use the cheapest route, stopping where the other route becomes cheaper.
 * One reviewed transaction uses one book; it never silently crosses to a more
 * expensive route or promises more depth than that route has. */
export function binaryBuyQuote(asks: readonly Level[], oppositeBids: readonly Level[], budget: bigint) {
  const complementary = complementAsks(oppositeBids)
  const best = (rows: readonly Level[]) => rows.reduce((price, row) => row.quantity > 0n && row.price > 0n && row.price < price ? row.price : price, SCALE)
  const directPrice = best(asks), complementPrice = best(complementary)
  const route = complementPrice < directPrice ? 'complete-set' as const : 'direct' as const
  const ceiling = route === 'direct' ? complementPrice : directPrice
  const quote = marketBuyQuote((route === 'direct' ? asks : complementary).filter(row => row.price <= ceiling), budget)
  return { ...quote, route, upfrontCollateral: route === 'complete-set' ? quote.quantity : quote.maximumCost }
}

/** The two outcome midpoints are mirrors of one common interval. Crossed
 * legacy orders have no valid midpoint; do not average an inverted spread. */
export function binaryQuotes(yesAsks: readonly Level[], yesBids: readonly Level[], noAsks: readonly Level[], noBids: readonly Level[]) {
  const min = (rows: readonly Level[]) => rows.filter(r => r.quantity > 0n && r.price > 0n && r.price < SCALE).reduce<bigint | undefined>((p, r) => p === undefined || r.price < p ? r.price : p, undefined)
  const max = (rows: readonly Level[]) => rows.filter(r => r.quantity > 0n && r.price > 0n && r.price < SCALE).reduce<bigint | undefined>((p, r) => p === undefined || r.price > p ? r.price : p, undefined)
  const yesAsk = min([...yesAsks, ...complementAsks(noBids)])
  const noAsk = min([...noAsks, ...complementAsks(yesBids)])
  const yesBid = max(yesBids), noBid = max(noBids)
  const lower = max([...yesBids, ...complementAsks(noAsks)])
  const upper = yesAsk
  const crossed = lower !== undefined && upper !== undefined && lower > upper
  const mid = lower !== undefined && upper !== undefined && !crossed ? (lower + upper) / 2n : undefined
  return {
    yes: { bid: yesBid, ask: yesAsk, mid, crossed },
    no: { bid: noBid, ask: noAsk, mid: mid === undefined ? undefined : SCALE - mid, crossed },
  }
}
