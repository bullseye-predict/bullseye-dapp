/** Public decimal amount fields are decoded explicitly; identifiers remain strings. */
const atomicFields = new Set(['price', 'quantity', 'nonce', 'filled', 'reservedQuantity', 'costBasis', 'realizedPnl', 'total', 'available', 'reserved', 'lastTradePrice', 'open', 'high', 'low', 'close', 'volume', 'collateralVolume', 'collateral', 'requestedQuantity', 'executableQuantity', 'unfilledQuantity', 'estimatedCollateral', 'averagePrice', 'bestPrice', 'limitPrice', 'plannedQuantity', 'pendingQuantity', 'filledQuantity', 'cancelledQuantity', 'plannedCollateral', 'confirmedCollateral'])
export function parsePredictionResponse<T>(value: string): T {
  return JSON.parse(value, (key, item) => atomicFields.has(key) && typeof item === 'string' && /^-?[0-9]+$/.test(item) ? BigInt(item) : item) as T
}
