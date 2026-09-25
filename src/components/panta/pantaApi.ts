import { useEffect, useState } from 'react'
import { predictionUrl } from '../../../packages/sdk/prediction-url'
import {
  PANTA_PHASES, isPantaMarketId, parsePantaMarket, parsePantaQuote,
  type PantaMarket, type PantaPhase, type PantaQuote, type PantaTrackedMarket,
} from '../../../packages/prediction-core/panta'

/**
 * The prediction backend's PANTA routes. The key to PANTA stays on the
 * backend; this client only ever talks to our own API.
 */
export type PantaHistoryPoint = [number, string | null, string | null]
export type PantaEventView =
  | { kind: 'market'; marketId: string; market: PantaMarket | null; live: 'ok' | 'unavailable'; tracked: PantaTrackedMarket & { creatorWallet: string | null } | null; history: PantaHistoryPoint[]; tradeUrl: string }
  | { kind: 'group'; groupId: string; title: string; markets: PantaTrackedMarket[] }

export class PantaApiError extends Error {
  constructor(message: string, public readonly code: string, public readonly status: number) { super(message) }
}

const price = (value: unknown) => typeof value === 'string' && /^\d{1,6}(?:\.\d{1,12})?$/.test(value) ? value : null
const iso = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null

export function parsePantaTracked(value: unknown): PantaTrackedMarket {
  const row = value as Record<string, unknown> | null
  if (!row || !isPantaMarketId(row.marketId) || typeof row.title !== 'string' || !PANTA_PHASES.includes(row.phase as PantaPhase)
    || typeof row.endTime !== 'number' || !iso(row.trackedSince) || (row.source !== 'imported' && row.source !== 'created')) throw new Error('Unreadable tracked market.')
  const text = (input: unknown, max: number) => typeof input === 'string' && input ? input.slice(0, max) : null
  const image = typeof row.imageUrl === 'string' && row.imageUrl.startsWith('https://') ? row.imageUrl : null
  return {
    marketId: row.marketId, title: row.title.slice(0, 512), category: typeof row.category === 'string' ? row.category.slice(0, 40) : 'other', phase: row.phase as PantaPhase,
    endTime: row.endTime, imageUrl: image, groupId: text(row.groupId, 80), groupTitle: text(row.groupTitle, 200), source: row.source,
    trackedSince: row.trackedSince as string, lastYes: price(row.lastYes), lastNo: price(row.lastNo), lastAt: iso(row.lastAt),
  }
}

export function parsePantaEvent(value: unknown): PantaEventView {
  const body = value as Record<string, unknown> | null
  if (body?.kind === 'group' && typeof body.groupId === 'string' && typeof body.title === 'string' && Array.isArray(body.markets)) {
    return { kind: 'group', groupId: body.groupId, title: body.title.slice(0, 200), markets: body.markets.slice(0, 50).map(parsePantaTracked) }
  }
  if (body?.kind !== 'market' || !isPantaMarketId(body.marketId) || (body.live !== 'ok' && body.live !== 'unavailable') || typeof body.tradeUrl !== 'string') throw new Error('Unreadable PANTA event.')
  const trade = new URL(body.tradeUrl)
  if (trade.protocol !== 'https:' || !/(^|\.)panta\.market$/.test(trade.hostname)) throw new Error('Unexpected PANTA link.')
  const tracked = body.tracked ? { ...parsePantaTracked(body.tracked), creatorWallet: typeof (body.tracked as { creatorWallet?: unknown }).creatorWallet === 'string' ? String((body.tracked as { creatorWallet: string }).creatorWallet) : null } : null
  const history = Array.isArray(body.history) ? body.history.filter((point): point is unknown[] => Array.isArray(point) && typeof point[0] === 'number')
    .map(point => [point[0] as number, price(point[1]), price(point[2])] as PantaHistoryPoint).slice(-800) : []
  return { kind: 'market', marketId: body.marketId, market: body.market ? parsePantaMarket(body.market) : null, live: body.live, tracked, history, tradeUrl: trade.toString() }
}

export function createPantaApi(apiUrl: string, fetcher: typeof fetch = fetch) {
  async function request(path: string, init: { signal?: AbortSignal; body?: unknown; timeoutMs?: number } = {}) {
    const timeout = AbortSignal.timeout(init.timeoutMs ?? 12_000)
    const response = await fetcher(predictionUrl(path, apiUrl), {
      method: init.body === undefined ? 'GET' : 'POST',
      headers: { accept: 'application/json', ...(init.body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
    })
    const value = await response.json().catch(() => null) as Record<string, unknown> | null
    if (!response.ok) throw new PantaApiError(typeof value?.message === 'string' ? value.message : 'PANTA is temporarily unavailable. Try again.', typeof value?.error === 'string' ? value.error : 'UNAVAILABLE', response.status)
    return value
  }
  return {
    async event(id: string, signal?: AbortSignal) { return parsePantaEvent(await request(`/panta/events/${encodeURIComponent(id)}`, { signal })) },
    async tracked(signal?: AbortSignal) {
      const body = await request('/panta/tracked', { signal })
      return (Array.isArray(body?.items) ? body.items : []).flatMap(item => { try { return [parsePantaTracked(item)] } catch { return [] } })
    },
    async createConfig(signal?: AbortSignal) { return (await request('/panta/create/config', { signal }))?.available === true },
    async quote(wallet: string, draft: unknown, signal?: AbortSignal): Promise<PantaQuote> { return parsePantaQuote(await request('/panta/create/quote', { signal, body: { wallet, draft } })) },
    async build(wallet: string, createId: string, signal?: AbortSignal) {
      const body = await request('/panta/create/build', { signal, body: { wallet, createId } })
      if (typeof body?.transaction !== 'string' || typeof body.expectedEventPda !== 'string') throw new PantaApiError('PANTA returned no transaction to sign.', 'UNAVAILABLE', 502)
      return { transaction: body.transaction, expectedEventPda: body.expectedEventPda }
    },
    /** Sending and confirming on mainnet can take a while; allow for it. */
    async submit(wallet: string, createId: string, signedTransaction: string, signal?: AbortSignal) {
      const body = await request('/panta/create/submit', { signal, body: { wallet, createId, signedTransaction }, timeoutMs: 90_000 })
      if (!isPantaMarketId(body?.marketId) || typeof body?.signature !== 'string') throw new PantaApiError('The market was created but its address could not be read. Check your wallet history.', 'UNAVAILABLE', 502)
      return { marketId: body.marketId, signature: body.signature }
    },
  }
}
export type PantaApi = ReturnType<typeof createPantaApi>

export type PantaEventState = { phase: 'loading' } | { phase: 'missing' } | { phase: 'unavailable'; message: string } | { phase: 'loaded'; view: PantaEventView }

/** One event page's data: polled every 60 s, backing off to 10 minutes on
 *  failure, and never again after a 404. */
export function usePantaEvent(apiUrl: string, id: string, fetcher: typeof fetch = fetch): PantaEventState {
  const [state, setState] = useState<PantaEventState>({ phase: 'loading' })
  useEffect(() => {
    const api = createPantaApi(apiUrl, fetcher)
    const controller = new AbortController()
    let timer: number | undefined
    let failures = 0
    setState({ phase: 'loading' })
    const load = async () => {
      let next = 60_000
      try {
        const view = await api.event(id, controller.signal)
        failures = 0
        if (!controller.signal.aborted) setState({ phase: 'loaded', view })
      } catch (reason) {
        if (controller.signal.aborted) return
        if (reason instanceof PantaApiError && reason.status === 404) { setState({ phase: 'missing' }); return }
        failures = Math.min(failures + 1, 8)
        next = Math.min(600_000, 60_000 * 2 ** (failures - 1))
        const message = reason instanceof PantaApiError && reason.code === 'PANTA_NOT_CONFIGURED' ? 'PANTA is not connected on this deployment yet.' : 'PANTA could not be reached. Trying again shortly.'
        setState(previous => previous.phase === 'loaded' ? previous : { phase: 'unavailable', message })
      }
      if (!controller.signal.aborted) timer = window.setTimeout(() => void load(), next)
    }
    void load()
    return () => { controller.abort(); if (timer) window.clearTimeout(timer) }
  }, [apiUrl, id, fetcher])
  return state
}
