import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { dreamDexNetwork } from '../../packages/adapters/dreamdex/event-reader'
import { DreamDexGameCreator } from '../../packages/adapters/dreamdex/game-creation'
import { GameDemoService } from './game-service'

// Separate local testnet host: does not replace the running game's backend.
if (!Bun.argv.includes('--testnet-demo')) throw Error('Explicit --testnet-demo is required.')
const key = process.env.PVT_KEY
if (!key) throw Error('A testnet sponsor PVT_KEY is required in the server environment.')
const account = privateKeyToAccount((key.startsWith('0x') ? key : `0x${key}`) as `0x${string}`)
const { id, name, nativeCurrency, rpcUrls, blockExplorers } = dreamDexNetwork('50312').chain
const wallet = createWalletClient({ account, chain: { id, name, nativeCurrency, rpcUrls, blockExplorers }, transport: http(rpcUrls.default.http[0]) })
const checkpoint = await Bun.file(new URL('./demo-deployment.json', import.meta.url)).json()
if (!checkpoint.halted || checkpoint.owner.toLowerCase() !== account.address.toLowerCase()) throw Error('Expected the halted legacy demo owned by this sponsor.')
const creator = new DreamDexGameCreator({ chainId: '50312', label: 'Shannon · SOLZ game events', indexerUrl: 'https://dev.smk.somnia.host/v1/graphql', wsRpcUrl: 'wss://api.infra.testnet.somnia.network/ws', markets: [] }, wallet, checkpoint.operatorId, checkpoint.venueId)
await creator.verifyImplementation()
const databasePath = process.env.DREAMDEX_GAME_DATABASE ?? '.data/dreamdex-games.sqlite'
mkdirSync(dirname(databasePath), { recursive: true })
const service = new GameDemoService(new Database(databasePath), creator, process.env.SOLZ_GAME_API_ORIGIN ?? 'https://solz-elysia-production.up.railway.app')
const origins = (process.env.DREAMDEX_GAME_ORIGINS ?? 'http://127.0.0.1:4321,http://localhost:4321').split(',')
const server = Bun.serve({ hostname: '127.0.0.1', port: Number(process.env.DREAMDEX_GAME_PORT ?? 8789), maxRequestBodySize: 2048, idleTimeout: 255,
  async fetch(request) {
    const origin = request.headers.get('origin')
    if (origin && !origins.includes(origin)) return new Response('Origin denied', { status: 403 })
    const headers: Record<string, string> = { 'cache-control': 'no-store', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type', vary: 'Origin' }
    if (origin) headers['access-control-allow-origin'] = origin
    const json = (value: unknown, status = 200) => Response.json(value, { status, headers })
    try {
      const path = new URL(request.url).pathname
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
      if (path === '/config' && request.method === 'GET') return json({ audience: '', venues: [], dreamdex: [service.publicConfig()] })
      if (path === '/dreamdex/game-markets' && request.method === 'POST') {
        const input = await request.json()
        if (typeof input.eventId !== 'string' || typeof input.agentId !== 'string') return json({ error: 'Select a game and agent.' }, 400)
        return json(await service.create(input.eventId, input.agentId))
      }
      if (path === '/dreamdex/faucet' && request.method === 'POST') {
        const input = await request.json()
        if (typeof input.address !== 'string') return json({ error: 'Connect your Dynamic EVM wallet first.' }, 400)
        return json(await service.fund(input.address))
      }
      return json({ error: 'Not found' }, 404)
    } catch (e) { return json({ error: e instanceof Error ? e.message : 'Creation failed' }, 409) }
  },
})
console.log(`DreamDEX game demo listening at ${server.url}; sponsor ${account.address}; current twelve-agent game questions only.`)
