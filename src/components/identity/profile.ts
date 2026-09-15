/**
 * What a wallet is called, everywhere in the app.
 *
 * Before this module every surface truncated an address by hand — six different
 * spellings of the same ellipsis across the events tabs, the portfolio header,
 * the market activity list and the wallet chip — and none of them could ever
 * show anything but base58. This file owns the shape of a trader's identity and
 * the one truncation the app uses; `store.ts` owns resolving it, and
 * `TraderIdentity.tsx` owns drawing it. Nothing else may format an address.
 *
 * Pure and import-free on purpose: the Astro API route runs it on the server to
 * parse pump.fun's answer, and the browser runs it to render the result.
 */

/** One trader, as the app displays them. */
export type TraderProfile = {
  address: string
  /** Absent when the address has no usable public handle. */
  username?: string
  imageUrl?: string
  bio?: string
  /** Where the handle came from. Only ever 'pump' today; named so a second
   *  directory can be added without every call site learning about it. */
  source: 'pump'
  /** A link to the profile this identity was read from. */
  href?: string
}

/** Wallets are rendered 4…4. One spelling, so the same wallet reads the same on
 *  the holders board, the tape, the portfolio header and the wallet chip. */
export function shortAddress(value: string, lead = 4, tail = 4): string {
  const trimmed = value.trim()
  return trimmed.length > lead + tail + 1 ? `${trimmed.slice(0, lead)}…${trimmed.slice(-tail)}` : trimmed
}

/** What to print for a wallet: its handle when it has one, its address when not. */
export const traderName = (address: string, profile?: TraderProfile | null): string =>
  profile?.username?.trim() || shortAddress(address)

/** Solana addresses only. Guards the queue, the API route and the cache key, so
 *  a market id or an EVM address can never be sent to a wallet directory. */
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
export const isWalletAddress = (value: unknown): value is string =>
  typeof value === 'string' && BASE58.test(value)

/* ---------------------------------------------------------------- pump.fun */

export const PUMP_PROFILE_ORIGIN = 'https://frontend-api-v3.pump.fun'
export const pumpProfileUrl = (address: string, origin = PUMP_PROFILE_ORIGIN) =>
  `${origin.replace(/\/+$/, '')}/users/${encodeURIComponent(address)}`
export const pumpProfileHref = (address: string) => `https://pump.fun/profile/${encodeURIComponent(address)}`

/** Avatar hosts pump serves images from. An avatar URL is owner-controllable in
 *  principle, and an <img> pointed at an arbitrary origin is a beacon that fires
 *  for every viewer of the holders board; keeping it on pump's own storage costs
 *  nothing and is one line to widen. */
const IMAGE_HOSTS = [/(^|\.)pump\.fun$/, /(^|\.)mypinata\.cloud$/, /(^|\.)ipfs\.io$/]

function usableImage(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'https:') return undefined
    return IMAGE_HOSTS.some(host => host.test(url.hostname)) ? url.href : undefined
  } catch { return undefined }
}

/** Printable single-line text, within a cap. Control characters and anything
 *  longer are dropped rather than escaped: these strings land in a leaderboard
 *  row, not in a document. */
const text = (value: unknown, limit: number): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  const printable = [...trimmed].every(character => {
    const code = character.codePointAt(0) ?? 0
    return code > 0x1f && code !== 0x7f
  })
  return trimmed && trimmed.length <= limit && printable ? trimmed : undefined
}

/**
 * pump names every wallet it has ever indexed, so an address that never signed
 * up still answers with a generated handle — "RogueLaceAvenue" for a wallet
 * belonging to nobody by that name. Rendering those would put an invented
 * identity next to a real share count, which is the same mistake as an invented
 * cost basis. A handle is shown only with evidence of an actual account:
 * `is_pump_user`, or a profile the owner filled in.
 */
export const registeredPumpUser = (payload: Record<string, unknown>): boolean =>
  payload.is_pump_user === true ||
  Boolean(usableImage(payload.profile_image ?? payload.profileImage)) ||
  Boolean(text(payload.bio, 400)) ||
  Boolean(text(payload.x_username ?? payload.xUsername, 60))

/** pump's `/users/:address` answer, or null when it names nobody. Tolerant of
 *  key spellings: this API has changed shape before. */
export function parsePumpProfile(address: string, payload: unknown): TraderProfile | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const record = payload as Record<string, unknown>
  const reported = text(record.address ?? record.canonical_svm_wallet, 64)
  if (reported && reported !== address) return null
  if (!registeredPumpUser(record)) return null
  const username = text(record.username ?? record.name, 40)
  const imageUrl = usableImage(record.profile_image ?? record.profileImage)
  const bio = text(record.bio, 400)
  if (!username && !imageUrl) return null
  return {
    address,
    source: 'pump',
    href: pumpProfileHref(address),
    ...(username ? { username } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    ...(bio ? { bio } : {}),
  }
}
