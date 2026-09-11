export type CashFlow = { id: string; at: number; amount: bigint }
export type ActivityInput = { id: string; kind: string; timestamp: string; quantity?: string; fillPrice?: string; maker?: string | null; makerSide?: string | null; taker?: string | null; takerSide?: string | null; account?: string; amount?: string; payout?: string | null }
/** Gross executed flows only. Order escrow, transfers and token deposits are not earnings. */
export function accountCashFlow(row: ActivityInput, owner: string, decimals: number): CashFlow | null {
  let amount = 0n
  const account = owner.toLowerCase(), scale = 10n ** BigInt(decimals)
  if (row.kind === 'TRADE') {
    for (const [address, side] of [[row.maker, row.makerSide], [row.taker, row.takerSide]]) {
      if (address?.toLowerCase() !== account) continue
      if (!side || !row.quantity || !row.fillPrice) throw Error('Trade accounting is incomplete')
      const price = BigInt(row.fillPrice)
      const value = BigInt(row.quantity) * (side.endsWith('NO') ? scale - price : price) / scale
      amount += side.startsWith('BUY') ? -value : value
    }
  } else if (row.account?.toLowerCase() === account) {
    if (row.kind === 'MINT_SET') amount = -BigInt(row.amount!)
    if (row.kind === 'MERGE_SET') amount = BigInt(row.amount!)
    if (row.kind === 'REDEEM') { if (row.payout == null) throw Error('Redemption accounting is incomplete'); amount = BigInt(row.payout) }
  }
  return amount ? { id: row.id, at: Number(row.timestamp) * 1000, amount } : null
}
export function cumulativeFlows(flows: CashFlow[]) {
  let balance = 0n
  return [...new Map(flows.map(flow => [flow.id, flow])).values()].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id)).map(flow => ({ ...flow, balance: balance += flow.amount }))
}
