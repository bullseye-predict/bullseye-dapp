import { expect, test } from 'bun:test'
import { solanaRpcEndpoint } from './solanaRpc'

// There is no default endpoint on purpose: mainnet and devnet must carry distinct
// RPC configuration (PREDICTION_PRODUCTION_PLAN.md:120), and a built-in devnet
// fallback would let a misconfigured mainnet build sign against devnet in silence.
test('refuses to guess a cluster when VITE_SOLANA_RPC_ENDPOINT is unset', () => {
  delete process.env.VITE_SOLANA_RPC_ENDPOINT
  expect(() => solanaRpcEndpoint()).toThrow(/is not set/)
})

test('uses the configured endpoint and keeps its api-key query intact', () => {
  process.env.VITE_SOLANA_RPC_ENDPOINT = 'https://devnet.helius-rpc.com/?api-key=abc'
  expect(solanaRpcEndpoint()).toBe('https://devnet.helius-rpc.com/?api-key=abc')
  delete process.env.VITE_SOLANA_RPC_ENDPOINT
})

test('refuses embedded credentials, non-https remotes and garbage rather than trusting them', () => {
  for (const [bad, reason] of [
    ['https://user:pass@rpc.example.com', /credentials/],
    ['http://rpc.example.com', /https/],
    ['not a url', /valid URL/],
  ] as const) {
    process.env.VITE_SOLANA_RPC_ENDPOINT = bad
    expect(() => solanaRpcEndpoint()).toThrow(reason)
  }
  process.env.VITE_SOLANA_RPC_ENDPOINT = 'http://127.0.0.1:8899'
  expect(solanaRpcEndpoint()).toBe('http://127.0.0.1:8899/')
  delete process.env.VITE_SOLANA_RPC_ENDPOINT
})
