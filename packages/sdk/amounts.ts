/** Parse human input without ever passing collateral through a floating-point number. */
export function parseUnitsExact(input: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18 || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(input)) throw new Error('Enter a positive decimal amount.')
  const [whole, fraction = ''] = input.split('.')
  if (fraction.length > decimals) throw new Error(`Use at most ${decimals} decimal places.`)
  const amount = BigInt(whole!) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0')
  if (amount <= 0n || amount >= 2n ** 128n) throw new Error('Amount is outside the supported range.')
  return amount
}
export function formatUnitsExact(amount: bigint, decimals: number, maximumFraction = decimals): string {
  const negative = amount < 0n
  const value = negative ? -amount : amount
  const scale = 10n ** BigInt(decimals)
  const fraction = (value % scale).toString().padStart(decimals, '0').slice(0, maximumFraction).replace(/0+$/, '')
  return `${negative ? '−' : ''}${value / scale}${fraction ? `.${fraction}` : ''}`
}
export const priceLabel = (price: bigint | null | undefined): string => price == null ? '—' : `${formatUnitsExact(price, 4, 2)}¢`
