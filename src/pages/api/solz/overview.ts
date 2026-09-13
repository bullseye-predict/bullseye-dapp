import type { APIRoute } from 'astro'

export const prerender = false

function httpOrigin(value: string) {
  const normalized = value.trim().replace(/\/+$/, '')
  if (normalized.startsWith('ws://')) return `http://${normalized.slice(5)}`
  if (normalized.startsWith('wss://')) return `https://${normalized.slice(6)}`
  return normalized
}

function configuredColyseusUrl(runtimeEnv: Record<string, unknown> = {}) {
  return String(
    runtimeEnv.SOLZ_COLYSEUS_SERVER_URL ??
    (typeof process !== 'undefined' ? process.env.SOLZ_COLYSEUS_SERVER_URL : undefined) ??
    import.meta.env.VITE_COLYSEUS_SERVER_URL ??
    import.meta.env.VITE_COLYSEUS_SERVER_URL_ASIA ??
    ''
  ).trim().replace(/\/+$/, '')
}

function configuredGameOrigin(runtimeEnv: Record<string, unknown> = {}) {
  return String(runtimeEnv.SOLZ_GAME_ORIGIN ??
    (typeof process !== 'undefined' ? process.env.SOLZ_GAME_ORIGIN : undefined) ??
    import.meta.env.VITE_SOLZ_GAME_ORIGIN ?? '')
    .trim()
    .replace(/\/+$/, '')
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

async function readJson(url: string) {
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(8_000),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(`SOLZ source returned HTTP ${response.status}.`)
  return payload
}

type ActivityMatch = {
  roomId?: unknown
  id?: unknown
  phase?: unknown
  mode?: unknown
  kind?: unknown
  currentPlayers?: unknown
  configuredPlayers?: unknown
  spectators?: unknown
  startedAt?: unknown
  createdAt?: unknown
  watchable?: unknown
}

function activityMatches(activity: unknown) {
  if (!activity || typeof activity !== 'object') return []
  const root = activity as { tokens?: Array<{ matches?: ActivityMatch[] }>; casual?: { unlimited?: { matches?: ActivityMatch[] }; survival?: { matches?: ActivityMatch[] } } }
  return [
    ...(root.tokens ?? []).flatMap((token) => token.matches ?? []),
    ...(root.casual?.unlimited?.matches ?? []),
    ...(root.casual?.survival?.matches ?? []),
  ]
}

function publicMatch(match: ActivityMatch, region: string) {
  const id = typeof match.roomId === 'string' ? match.roomId : typeof match.id === 'string' ? match.id : ''
  if (!id || match.watchable === false) return null
  const rawPhase = String(match.phase ?? '').toLowerCase()
  if (rawPhase === 'finished' || rawPhase === 'settled') return null
  return {
    id,
    region,
    phase: rawPhase === 'countdown' ? 'countdown' : rawPhase === 'waiting' ? 'waiting' : 'live',
    mode: String(match.mode ?? match.kind ?? 'Arena match'),
    players: Math.max(0, Number(match.currentPlayers) || 0),
    capacity: Math.max(1, Number(match.configuredPlayers) || 1),
    spectators: Math.max(0, Number(match.spectators) || 0),
    startedAt: Number(match.startedAt) || Number(match.createdAt) || null,
    // This endpoint is also the source of the local match directory. Its
    // watch links must stay on the configured game host, never production.
    watchUrl: '',
  }
}

export const GET: APIRoute = async ({ locals }) => {
  const runtimeEnv = (locals as { runtime?: { env?: Record<string, unknown> } }).runtime?.env ?? {}
  const configuredUrl = configuredColyseusUrl(runtimeEnv)
  // No production fallback. An unset URL must fail loudly instead of silently
  // pointing local development at the deployed Colyseus Cloud regions.
  if (!configuredUrl) return json({
    code: 'solz_colyseus_not_configured',
    message: 'SOLZ_COLYSEUS_SERVER_URL is unset in solz-prediction-market. Refusing to guess an upstream.',
  }, 503)
  const sources = [{ label: 'Configured arena', url: httpOrigin(configuredUrl) }]
  try {
    const results = await Promise.allSettled(sources.map(async (source) => ({ source, activity: await readJson(`${source.url}/activity`) })))
    const available = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
    if (!available.length) throw new Error('No SOLZ regional activity feed responded.')
    const primary = available.find((entry) => activityMatches(entry.activity).some((match) => publicMatch(match, entry.source.label))) ?? available[0]!

    return json({
      generatedAt: Date.now(),
      colyseusUrl: primary.source.url,
      gameOrigin: configuredGameOrigin(runtimeEnv),
      activity: primary.activity,
      matches: available.flatMap(({ source, activity }) => activityMatches(activity).flatMap((match) => {
        const result = publicMatch(match, source.label)
        if (result) result.watchUrl = configuredGameOrigin(runtimeEnv)
          ? `${configuredGameOrigin(runtimeEnv)}/game/watch/${encodeURIComponent(result.id)}`
          : ''
        return result ? [result] : []
      })),
      leaderboard: { kills: null, wins: null },
      // Match observation is already public in SOLZ. Custody and paid agent control remain off until their own authorities ship.
      capabilities: {
        orders: {
          ready: false,
          reason: 'The SOLZ prediction escrow program is not deployed yet. Live orders stay locked.',
        },
        prompts: {
          ready: false,
          reason: 'The paid agent-directive relay is not connected yet. Live prompts stay locked.',
        },
      },
    })
  } catch (error) {
    return json({
      code: 'solz_live_source_unavailable',
      message: error instanceof Error ? error.message : 'The SOLZ live match source is unavailable.',
    }, 502)
  }
}
