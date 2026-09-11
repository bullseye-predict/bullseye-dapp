import { expect, test } from 'bun:test'
import { proxyPrediction } from '../src/server/upstream-proxy'

test('same-origin prediction proxy reaches the single Railway service and preserves its path', async () => {
  let target = ''
  const response = await proxyPrediction(
    new Request('https://some-coola.vercel.app/api/prediction/arena/feed?limit=12'),
    'arena/feed',
    { PUBLIC_PREDICTION_API_URL: 'https://coola-backend-production.up.railway.app' },
    async input => { target = String(input); return Response.json({ ok: true }) },
  )
  expect(target).toBe('https://coola-backend-production.up.railway.app/arena/feed?limit=12')
  expect(response.status).toBe(200)
})

test('prediction proxy rejects an unsafe configured origin', async () => {
  const response = await proxyPrediction(new Request('https://app.test/api/prediction/config'), 'config', { PUBLIC_PREDICTION_API_URL: 'http://example.com' })
  expect(response.status).toBe(503)
})
