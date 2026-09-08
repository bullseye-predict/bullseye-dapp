/** Public JSON uses decimal strings, never lossy JSON numbers for token amounts. */
export const stringify = (value: unknown): string => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item)

/** Private persistence codec, separate from the untrusted/public wire protocol. */
export const encodeStored = (value: unknown): string => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? { $solzInteger: item.toString() } : item)
export function decodeStored<T>(value: string): T {
  return JSON.parse(value, (_key, item) => {
    if (item && typeof item === 'object' && Object.keys(item).length === 1 && typeof item.$solzInteger === 'string' && /^-?[0-9]+$/.test(item.$solzInteger)) return BigInt(item.$solzInteger)
    return item
  }) as T
}
