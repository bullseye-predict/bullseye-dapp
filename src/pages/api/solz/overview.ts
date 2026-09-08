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

export const GET: APIRoute = async ({ locals }) => {
  const runtimeEnv = (locals as { runtime?: { env?: Record<string, unknown> } }).runtime?.env ?? {}
  const colyseusUrl = configuredColyseusUrl(runtimeEnv)
  if (!colyseusUrl) {
    return json({
      code: 'solz_live_source_not_configured',
      message: 'The SOLZ live match source is not configured on this server.',
    }, 503)
  }

  const baseUrl = httpOrigin(colyseusUrl)
  try {
    const [activityResult, killsResult, winsResult] = await Promise.allSettled([
      readJson(`${baseUrl}/activity`),
      readJson(`${baseUrl}/leaderboard/users?sort=kills&limit=12`),
      readJson(`${baseUrl}/leaderboard/users?sort=wins&limit=12`),
    ])
    if (activityResult.status === 'rejected') throw activityResult.reason

    return json({
      generatedAt: Date.now(),
      colyseusUrl,
      gameOrigin: configuredGameOrigin(runtimeEnv) || null,
      activity: activityResult.value,
      leaderboard: {
        kills: killsResult.status === 'fulfilled' ? killsResult.value : null,
        wins: winsResult.status === 'fulfilled' ? winsResult.value : null,
      },
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
