import { expect, test } from 'bun:test'
import {
  confirmDirectivePayment,
  directiveCostStatus,
  directiveToken,
  directiveTokenLabel,
  directiveUnavailableReason,
  directiveUsd,
  directivePrice,
  parseDirectiveSettings,
  quoteDirective,
  tokenAmountLabel,
  usdLabel,
} from '../src/components/solz/directiveRelay'
import { proxyDirectives } from '../src/server/directive-proxy'
import { applyPredictionArena } from '../src/components/home/predictionArena'
import { createSolzDataSource } from '../src/components/solz/solzDataSource'
import { canSubmitDirective } from '../src/components/home/directiveSubmit'

const runtime = { SOLZ_GAME_API_ORIGIN: 'http://localhost:3100' }

test('the paid relay is not disabled by a missing local roster or stale match projection', () => {
  expect(canSubmitDirective({
    relayOpen: true,
    walletReady: true,
    sampleReady: false,
    pending: false,
    fueling: false,
    prompt: 'all gunner stops 6sec',
  })).toBe(true)
})
const closedPayload = {
  ok: true,
  version: 0,
  settings: {
    enabled: false, treasury: '',
    tokens: [
      { symbol: 'SOLZ', mint: '', decimals: 6, tokenProgram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', snakePerSecond: '10000', bombPrice: '0' },
      { symbol: 'COLACAT', mint: '', decimals: 6, tokenProgram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', snakePerSecond: '0', bombPrice: '0' },
    ],
    prompt: { mode: 'usd', token: 'SOLZ', baseUsd: '0', markup: 5, fastFactor: 2 },
    priceSource: 'dexscreener', minimumLiquidityUsd: 10000, quoteSeconds: 60,
  },
  policy: 'Only for this match. All purchases are final.',
}
const openPayload = {
  ...closedPayload,
  settings: {
    ...closedPayload.settings,
    enabled: true,
    treasury: 'BrZ7WeDARopFAtiA3DP6c8F3eQFJnb4X8q1P5CaLQMjK',
    tokens: [
      { ...closedPayload.settings.tokens[0], mint: '6TTTa6dXV7CojyrSwX1TZkwMqHKbtN9ezmgSdVgKr3UP' },
      closedPayload.settings.tokens[1],
    ],
    prompt: { mode: 'usd', token: 'SOLZ', baseUsd: '0.02', markup: 5, fastFactor: 2 },
  },
}

test('an unpriced relay publishes no price at all, rather than a zero or a sample', () => {
  const settings = parseDirectiveSettings(closedPayload)
  expect(settings.enabled).toBe(false)
  expect(directiveToken(settings)).toBeUndefined()
  expect(directiveUsd(settings)).toBeNull()
  expect(directiveUnavailableReason(settings)).toBe('Agent directives are not open yet.')
  expect(directiveUnavailableReason(null)).toBe('The directive relay is unreachable. Try again shortly.')
})

test('the fee shown is the operator USD the control plane charges, at the same fixed point', () => {
  const settings = parseDirectiveSettings(openPayload)
  // baseUsd 0.02 with a markup of 5 is 10 cents; fast doubles it. Both are read
  // the way _solz-elysia reads them, so the screen cannot drift from the charge.
  expect(usdLabel(directiveUsd(settings)!)).toBe('$0.10')
  expect(usdLabel(directiveUsd(settings, 'fast')!)).toBe('$0.20')
  expect(usdLabel(directiveUsd({ ...settings, prompt: { mode: 'usd' as const, token: 'SOLZ' as const, baseUsd: '0.0006', markup: 5, fastFactor: 2 } })!)).toBe('$0.003')
  expect(directiveUnavailableReason(settings)).toBeUndefined()
})

test('a fixed price is published in tokens, and no dollar figure is invented for it', () => {
  // The operator typed 1000 SOLZ per directive. Nothing here reads a market.
  const settings = parseDirectiveSettings({
    ...openPayload,
    settings: {
      ...openPayload.settings,
      prompt: { mode: 'fixed', baseUsd: '0', markup: 5, fastFactor: 2 },
      tokens: [{ ...openPayload.settings.tokens[0], promptPrice: '1000' }, openPayload.settings.tokens[1]],
    },
  })
  const token = directiveToken(settings)!
  expect(directiveUsd(settings)).toBeNull()
  expect(tokenAmountLabel(directivePrice(settings, token)!.atoms!.toString(), token.decimals)).toBe('1,000')
  expect(tokenAmountLabel(directivePrice(settings, token, 'fast')!.atoms!.toString(), token.decimals)).toBe('2,000')
  expect(directiveUnavailableReason(settings)).toBeUndefined()
})

test('a fixed mode with no token price is unpriced, not free', () => {
  const settings = parseDirectiveSettings({
    ...openPayload,
    settings: { ...openPayload.settings, prompt: { mode: 'fixed', baseUsd: '0.02', markup: 5, fastFactor: 2 } },
  })
  expect(directivePrice(settings, directiveToken(settings))).toBeNull()
  expect(directiveUnavailableReason(settings)).toBe('Agent directives are not priced yet.')
})

test('a closed prompt switch closes the composer even while the relay accepts purchases', () => {
  // Bombs and snake control stay on sale in the game; this site sells prompts.
  const settings = parseDirectiveSettings({
    ...openPayload,
    settings: { ...openPayload.settings, actions: { prompt: false, snake_control: true, bomb: true } },
  })
  expect(settings.enabled).toBe(true)
  expect(directiveCostStatus(settings, false)).toBe('NOT OPEN')
  expect(directiveUnavailableReason(settings)).toBe('Agent directives are not open yet.')
  // A relay that predates the switches sold every kind, and still does.
  expect(parseDirectiveSettings(openPayload).actions.prompt).toBe(true)
  expect(directiveUnavailableReason(parseDirectiveSettings(openPayload))).toBeUndefined()
})

test('prompts are bought in the slot the operator chose, falling back to the funded one', () => {
  const both = {
    ...openPayload,
    settings: {
      ...openPayload.settings,
      prompt: { ...openPayload.settings.prompt, token: 'COLACAT' },
      tokens: [
        openPayload.settings.tokens[0],
        { ...openPayload.settings.tokens[1], mint: '4N7d177zYPmGZeEhvsUaV9u8KCEPaW64L4YBtMf4ZTNf' },
      ],
    },
  }
  expect(directiveToken(parseDirectiveSettings(both))?.symbol).toBe('COLACAT')
  // The chosen slot has no mint, so the funded one is charged rather than none.
  const unfunded = { ...both, settings: { ...both.settings, tokens: openPayload.settings.tokens } }
  expect(directiveToken(parseDirectiveSettings(unfunded))?.symbol).toBe('SOLZ')
})

test('the token is the slot an operator funded, named by its mint where the chain knows it', () => {
  const settings = parseDirectiveSettings(openPayload)
  const token = directiveToken(settings)!
  expect(token.symbol).toBe('SOLZ')
  expect(token.mint).toBe('6TTTa6dXV7CojyrSwX1TZkwMqHKbtN9ezmgSdVgKr3UP')
  // A slot with no mint is not for sale, so asking for it falls back to one that is.
  expect(directiveToken(settings, 'COLACAT')?.symbol).toBe('SOLZ')
  expect(directiveTokenLabel(token)).toBe('SOLZ')
  expect(directiveTokenLabel(token, new Map([[token.mint, { symbol: 'fSOLZZ' }]]))).toBe('fSOLZZ')
})

test('a quoted amount is rendered from the relay atoms, never derived locally', () => {
  expect(tokenAmountLabel('1234567890', 6)).toBe('1,234.5678')
  expect(tokenAmountLabel('1000000', 6)).toBe('1')
  expect(tokenAmountLabel('not-atoms', 6)).toBe('')
})

test('a live match carries the game match id the relay accepts, beside this site’s own board id', async () => {
  const roomId = 'real-room'
  const matchId = `0x534f4c5a01010014${'01'.repeat(24)}`
  const feed = {
    agents: [{ agentId: 'genesis-01', slot: 0, codename: 'COKE', archetype: 'BREACHER', balanceCentilitres: '100000' }],
    current: { roomId, matchId, status: 'live' as const, gameMode: 'deathmatch', teamFormat: 'ffa', participants: [] },
    matches: [{ roomId, matchId, status: 'live' as const, gameMode: 'deathmatch', teamFormat: 'ffa', participants: [] }],
    upcoming: [], historyError: null, readAt: Date.now(),
  }
  const snapshot = applyPredictionArena(await createSolzDataSource().load(), feed as never, { events: [] })
  const match = snapshot.matches[0]!
  expect(match.id).toBe(`arena-${matchId.slice(2)}`)
  expect(match.sourceMatchId).toBe(matchId)
  expect(match.roomId).toBe(roomId)
})

test('the proxy forwards only the relay routes', async () => {
  const seen: Array<{ url: string; headers: Record<string, string> }> = []
  const fetcher = async (input: string | URL | Request) => {
    seen.push({ url: String(input), headers: {} })
    return Response.json(openPayload)
  }
  const ok = await proxyDirectives(new Request('http://site/api/directives/settings'), 'settings', runtime, fetcher)
  expect(ok.status).toBe(200)
  expect(seen[0]!.url).toBe('http://localhost:3100/api/v1/viewer-actions/settings')

  const unknown = await proxyDirectives(new Request('http://site/api/directives/admin'), 'admin', runtime, fetcher)
  expect(unknown.status).toBe(404)
  const wrongMethod = await proxyDirectives(new Request('http://site/api/directives/quotes'), 'quotes', runtime, fetcher)
  expect(wrongMethod.status).toBe(405)
  // An origin this host cannot vouch for is refused rather than guessed at.
  const unset = await proxyDirectives(new Request('http://site/api/directives/settings'), 'settings', { SOLZ_GAME_API_ORIGIN: 'http://evil.example' }, fetcher)
  expect(unset.status).toBe(503)
})

test('the proxy strips browser identity from the wallet-paid quote', async () => {
  let headers = new Headers()
  const fetcher = async (_input: string | URL | Request, init?: RequestInit) => {
    headers = new Headers(init?.headers)
    return Response.json({ ok: true, purchase: { id: 'p1', amountAtoms: '1000000' } })
  }
  const request = new Request('http://site/api/directives/quotes', {
    method: 'POST',
    headers: { authorization: 'Bearer jwt', cookie: 'session=secret', 'x-forwarded-for': '10.0.0.1' },
    body: '{"text":"hold the west relay"}',
  })
  await proxyDirectives(request, 'quotes', runtime, fetcher)
  expect(headers.get('authorization')).toBeNull()
  expect(headers.get('cookie')).toBeNull()
  expect(headers.get('x-forwarded-for')).toBeNull()
})

test('the quote client sends no auth and accepts the explicit SPL payment contract', async () => {
  let headers = new Headers()
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    headers = new Headers(init?.headers)
    return Response.json({
      ok: true,
      purchase: { id: 'quote-1', amountAtoms: '1000000' },
      payment: {
        kind: 'spl-token', walletAddress: 'treasury', tokenAccountAddress: 'treasury-ata',
        amountAtoms: '1000000', memoId: 'solz-action:v1:match:quote-1', quoteId: 'quote-1',
      },
      transaction: 'base64', lastValidBlockHeight: 42, policy: 'policy',
    })
  }) as unknown as typeof fetch
  const quote = await quoteDirective({
    wallet: '11111111111111111111111111111111', token: 'SOLZ', text: 'hold the west relay', idempotencyKey: crypto.randomUUID(),
  })
  expect(headers.get('authorization')).toBeNull()
  expect(quote.payment.memoId).toBe('solz-action:v1:match:quote-1')
  expect(quote.payment.quoteId).toBe(quote.purchase.id)
})

test('a payment is retried only while the relay is still waiting on finality', async () => {
  const codes = ['action_payment_unconfirmed', 'action_payment_unconfirmed']
  const calls: number[] = []
  globalThis.fetch = (async () => {
    calls.push(calls.length)
    const code = codes.shift()
    return code
      ? Response.json({ ok: false, error: code }, { status: 400 })
      : Response.json({ ok: true, purchase: { id: 'p1', amountAtoms: '1000000', decimals: 6, state: 'paid' } })
  }) as unknown as typeof fetch
  const purchase = await confirmDirectivePayment('p1', 'sig', '/api/directives', async () => undefined)
  expect(calls.length).toBe(3)
  expect(purchase.state).toBe('paid')
})
