import { expect, test } from 'bun:test'
import { startPredictionApi } from '../../apps/api/main'

test('standalone API serves health and resumes durable read-only WebSocket events', async () => {
  const app = startPredictionApi({ PREDICTION_PORT: '0', PREDICTION_DATABASE_PATH: ':memory:' })
  try {
    const health = await (await fetch(new URL('/health', app.server.url))).json()
    expect(health.configuredVenues).toEqual([])
    expect(health.hermesConfigured).toBe(false)
    const first = app.database.appendEvent('matches:local', 'MATCH_TELEMETRY', { sequence: 1 })
    app.database.appendEvent('matches:local', 'MATCH_TELEMETRY', { sequence: 2 })
    const url = new URL(`/matches/local?after=${first}`, app.server.url)
    url.protocol = 'ws:'
    const socket = new WebSocket(url)
    const event = await new Promise<{ payload: { sequence: number } }>((resolve, reject) => {
      const timer = setTimeout(() => { socket.close(); reject(new Error('WebSocket event timeout')) }, 2000)
      socket.onmessage = message => { clearTimeout(timer); socket.close(); resolve(JSON.parse(String(message.data))) }
      socket.onerror = () => { clearTimeout(timer); reject(new Error('WebSocket connection failed')) }
    })
    expect(event.payload.sequence).toBe(2)
  } finally { app.stop() }
})
