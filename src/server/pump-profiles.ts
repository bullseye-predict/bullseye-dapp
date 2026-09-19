import {
  PUMP_PROFILE_ORIGIN,
  isWalletAddress,
  parsePumpProfile,
  pumpProfileUrl,
  type TraderProfile,
} from '../components/identity/profile.ts'

type RuntimeEnv = Record<string, unknown>
type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

/** A read, an answered "nobody", or a miss we must not remember. */
type CacheEntry = { profile: TraderProfile | null; at: number }

/** Resolved handles change rarely; "no such profile" changes even more rarely,
 *  and is the common answer for a trading wallet. Both are held long enough
 *  that opening the holders board twice costs one upstream read. */
const FOUND_TTL_MS = 15 * 60_000
const MISSING_TTL_MS = 60 * 60_000
/** Per isolate. A page shows tens of wallets, not thousands. */
const CACHE_LIMIT = 2_000
/** One batch is one panel's worth of rows. */
export const MAX_BATCH = 50
const CONCURRENCY = 6
const UPSTREAM_TIMEOUT_MS = 6_000

const cache = new Map<string, CacheEntry>()

const fresh = (entry: CacheEntry, now: number) =>
  now - entry.at < (entry.profile ? FOUND_TTL_MS : MISSING_TTL_MS)

function remember(address: string, profile: TraderProfile | null, now: number) {
  cache.set(address, { profile, at: now })
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
}

/** Overridable so a deployment can point at a mirror; defaults to pump's own
 *  public frontend API, which is the canonical source for these handles. */
export function pumpOrigin(runtime: RuntimeEnv): string {
  const configured = String(
    runtime.PUBLIC_PUMP_PROFILE_API_URL ??
      (typeof process !== 'undefined' ? process.env.PUBLIC_PUMP_PROFILE_API_URL : undefined) ??
      import.meta.env.PUBLIC_PUMP_PROFILE_API_URL ??
      '',
  ).trim().replace(/\/+$/, '')
  if (!configured) return PUMP_PROFILE_ORIGIN
  try {
    const url = new URL(configured)
    return url.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(url.hostname) ? configured : PUMP_PROFILE_ORIGIN
  } catch { return PUMP_PROFILE_ORIGIN }
}

/** One address. A 404 is an answer — that wallet has no profile — and is cached.
 *  Anything else is a failure we deliberately do not remember, so a bad minute
 *  upstream cannot pin a wallet to "unknown" for the next hour. */
async function readProfile(address: string, origin: string, fetcher: Fetcher): Promise<{ profile: TraderProfile | null; cacheable: boolean }> {
  try {
    const response = await fetcher(pumpProfileUrl(address, origin), {
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })
    if (response.status === 404) return { profile: null, cacheable: true }
    if (!response.ok) return { profile: null, cacheable: false }
    return { profile: parsePumpProfile(address, await response.json()), cacheable: true }
  } catch {
    return { profile: null, cacheable: false }
  }
}

export type ProfileBatch = {
  profiles: Record<string, TraderProfile | null>
  /** Addresses whose read failed rather than answered. The browser retries
   *  these; it must not cache them as "this wallet has no name". */
  unavailable: string[]
}

/**
 * Resolve a batch of wallets to public handles.
 *
 * Runs on the Astro host rather than in the browser for three reasons: pump's
 * API sends no CORS headers to this origin, a holders board would otherwise
 * open one connection per row from every visitor, and the cache here is shared
 * by everyone on the deployment instead of being rebuilt per tab.
 */
export async function resolveTraderProfiles(
  addresses: readonly string[],
  runtime: RuntimeEnv,
  fetcher: Fetcher = fetch,
  now = Date.now(),
): Promise<ProfileBatch> {
  const wanted = [...new Set(addresses.filter(isWalletAddress))].slice(0, MAX_BATCH)
  const profiles: Record<string, TraderProfile | null> = {}
  const unavailable: string[] = []
  const pending: string[] = []
  for (const address of wanted) {
    const entry = cache.get(address)
    if (entry && fresh(entry, now)) profiles[address] = entry.profile
    else pending.push(address)
  }
  if (!pending.length) return { profiles, unavailable }

  const origin = pumpOrigin(runtime)
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, async () => {
    while (cursor < pending.length) {
      const address = pending[cursor++]!
      const { profile, cacheable } = await readProfile(address, origin, fetcher)
      if (cacheable) {
        remember(address, profile, now)
        profiles[address] = profile
      } else {
        // Serve a stale hit rather than nothing when the upstream is down.
        const stale = cache.get(address)
        if (stale) profiles[address] = stale.profile
        unavailable.push(address)
      }
    }
  }))
  return { profiles, unavailable }
}

/** Test seam: the cache is module state, and a test that seeds it must be able
 *  to clear it again. */
export const resetTraderProfileCache = () => cache.clear()
