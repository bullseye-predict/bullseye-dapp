import {
  positionKey,
  type Outcome,
  type PortfolioAccounting,
  type PortfolioEvent,
} from './model'
type Balance = {
  marketId: string
  outcome: Outcome
  quantity: bigint
  vault: bigint
  cost: bigint | null
  realized: bigint | null
  acquisitionCost: bigint | null
  disposedCost: bigint | null
  acquired: bigint
  disposed: bigint
  proceeds: bigint
  mark?: bigint
  reason?: string
}
/** Weighted average inventory. Internal custody changes and funding never create profit. */
export function replayPortfolio(
  events: readonly PortfolioEvent[],
  decimals = 6,
  historyComplete = true,
): PortfolioAccounting {
  const scale = 10n ** BigInt(decimals),
    balances = new Map<string, Balance>()
  const get = (market: string, outcome: Outcome) => {
    const key = positionKey(market, outcome)
    if (!balances.has(key))
      balances.set(key, {
        marketId: market,
        outcome,
        quantity: 0n,
        vault: 0n,
        cost: historyComplete ? 0n : null,
        realized: historyComplete ? 0n : null,
        acquisitionCost: historyComplete ? 0n : null,
        disposedCost: historyComplete ? 0n : null,
        acquired: 0n,
        disposed: 0n,
        proceeds: 0n,
        reason: historyComplete
          ? undefined
          : 'History is still being backfilled.',
      })
    return balances.get(key)!
  }
  const unknown = (b: Balance, reason: string) => {
    b.cost = null
    b.realized = null
    b.acquisitionCost = null
    b.disposedCost = null
    b.reason = reason
  }
  const buy = (b: Balance, shares: bigint, cost: bigint | null) => {
    b.quantity += shares
    b.acquired += shares
    if (cost === null) unknown(b, 'Acquisition price or fee is unavailable.')
    else {
      if (b.cost !== null) b.cost += cost
      if (b.acquisitionCost !== null) b.acquisitionCost += cost
    }
  }
  const sell = (
    b: Balance,
    shares: bigint,
    proceeds: bigint | null,
    realize = true,
  ) => {
    if (shares > b.quantity) {
      unknown(b, 'History does not cover these shares.')
      b.quantity = 0n
    } else {
      const released =
        b.cost === null
          ? null
          : b.quantity
            ? (b.cost * shares) / b.quantity
            : 0n
      b.quantity -= shares
      if (released !== null && b.cost !== null) b.cost -= released
      if (released !== null && b.disposedCost !== null)
        b.disposedCost += released
      if (proceeds === null || released === null)
        unknown(b, 'Disposal value or cost is unavailable.')
      else if (realize && b.realized !== null) b.realized += proceeds - released
    }
    b.disposed += shares
    b.proceeds += proceeds ?? 0n
  }
  const points: PortfolioAccounting['points'] = []
  const sorted = [
    ...new Map(
      events.filter((e) => e.finality === 'finalized').map((e) => [e.id, e]),
    ).values(),
  ].sort(
    (a, b) =>
      a.slot - b.slot ||
      a.transactionIndex - b.transactionIndex ||
      a.index - b.index ||
      a.id.localeCompare(b.id),
  )
  for (let index = 0; index < sorted.length; index++) {
    const e = sorted[index]!,
      quantity = BigInt(e.shares ?? 0),
      collateral = e.collateral === undefined ? null : BigInt(e.collateral)
    if (e.marketId) {
      const b = e.outcome === undefined ? undefined : get(e.marketId, e.outcome)
      if (
        b &&
        e.price !== undefined &&
        ['MARK', 'SETTLEMENT', 'BUY', 'SELL'].includes(e.kind)
      )
        b.mark = BigInt(e.price)
      if (b && e.kind === 'CUSTODY' && e.vaultChange !== undefined) {
        b.vault += BigInt(e.vaultChange)
        if (b.vault < 0n) unknown(b, 'Vault custody history is incomplete.')
      }
      if (e.kind === 'BUY' && b)
        buy(
          b,
          quantity,
          collateral === null || e.fee === null
            ? null
            : collateral + BigInt(e.fee ?? 0),
        )
      if (e.kind === 'SELL' && b)
        sell(
          b,
          quantity,
          collateral === null || e.fee === null
            ? null
            : collateral - BigInt(e.fee ?? 0),
        )
      if (e.kind === 'TRANSFER_IN' && b)
        buy(
          b,
          quantity,
          b.mark === undefined ? null : (quantity * b.mark) / scale,
        )
      if (e.kind === 'TRANSFER_OUT' && b)
        sell(
          b,
          quantity,
          b.mark === undefined ? null : (quantity * b.mark) / scale,
        )
      if (e.kind === 'SPLIT' || e.kind === 'MERGE') {
        const total = collateral ?? quantity
        for (const outcome of [0, 1] as const) {
          const part = outcome === 0 ? (total + 1n) / 2n : total / 2n
          const held = get(e.marketId, outcome)
          if (e.kind === 'SPLIT') {
            buy(held, quantity, part)
            held.vault += quantity
          } else {
            sell(held, quantity, part)
            held.vault -= quantity
            if (held.vault < 0n)
              unknown(held, 'Vault custody history is incomplete.')
          }
        }
      }
      if (e.kind === 'CLAIM') {
        const sides = ([0, 1] as const)
          .filter((o) => e.outcome === undefined || e.outcome === o)
          .map((o) => get(e.marketId!, o))
        const amounts = sides.map((held) =>
          e.shares === undefined ? held.vault : quantity,
        )
        const expected = sides.map((held, i) =>
          held.mark === undefined ? null : (amounts[i]! * held.mark) / scale,
        )
        const expectedTotal = expected.reduce<bigint>(
          (n, v) => n + (v ?? 0n),
          0n,
        )
        const payoutKnown =
          collateral !== null &&
          expected.every((v) => v !== null) &&
          (collateral === expectedTotal || collateral === expectedTotal + 1n)
        let dust = payoutKnown ? collateral! - expectedTotal : 0n
        sides.forEach((held, i) => {
          const size = amounts[i]!
          if (size > 0n) {
            const extra = dust > 0n && held.mark! > 0n ? 1n : 0n
            dust -= extra
            sell(held, size, payoutKnown ? expected[i]! + extra : null)
            held.vault -= size
          }
        })
      }
    }
    // All events in a transaction are applied before valuing it; split/import
    // and fills in the same receipt must not create intermediate fake spikes.
    if (sorted[index + 1]?.signature === e.signature) continue
    let total: bigint | null = historyComplete ? 0n : null
    for (const b of balances.values()) {
      if (
        b.realized === null ||
        b.cost === null ||
        (b.quantity > 0n && b.mark === undefined)
      ) {
        total = null
        break
      }
      if (total !== null)
        total +=
          b.realized +
          (b.quantity ? (b.quantity * b.mark!) / scale - b.cost : 0n)
    }
    points.push({ at: e.at, value: total?.toString() ?? null })
  }
  const positions = [...balances.values()]
    .filter((b) => b.acquired > 0n || b.disposed > 0n)
    .map((b) => {
      const value =
        b.quantity === 0n
          ? 0n
          : b.mark === undefined
            ? null
            : (b.quantity * b.mark) / scale
      return {
        acquisitionCost: b.acquisitionCost?.toString() ?? null,
        disposedCost: b.disposedCost?.toString() ?? null,
        historicalAverage:
          b.acquisitionCost !== null && b.acquired > 0n
            ? ((b.acquisitionCost * scale) / b.acquired).toString()
            : null,
        marketId: b.marketId,
        outcome: b.outcome,
        quantity: b.quantity.toString(),
        costBasis: b.cost?.toString() ?? null,
        average:
          b.cost !== null && b.quantity > 0n
            ? ((b.cost * scale) / b.quantity).toString()
            : null,
        current: b.mark?.toString() ?? null,
        value: value?.toString() ?? null,
        pnl:
          value !== null && b.cost !== null
            ? (value - b.cost).toString()
            : null,
        realized: b.realized?.toString() ?? null,
        acquired: b.acquired.toString(),
        disposed: b.disposed.toString(),
        proceeds: b.proceeds.toString(),
        complete: historyComplete && b.cost !== null && b.realized !== null,
        reason:
          b.reason ??
          (b.quantity > 0n && b.mark === undefined
            ? 'No confirmed execution price is available.'
            : undefined),
      }
    })
  return {
    positions,
    points,
    complete: historyComplete && positions.every((b) => b.complete),
    ...(!historyComplete
      ? { reason: 'History is still being backfilled.' }
      : {}),
  }
}
