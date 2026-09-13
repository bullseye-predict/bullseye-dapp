import { expect, test } from 'bun:test'
import { solanaRpcEndpoint } from './solanaRpc'

test('falls back to public devnet when VITE_SOLANA_RPC_ENDPOINT is unset', () => {
  delete process.env.VITE_SOLANA_RPC_ENDPOINT
  expect(solanaRpcEndpoint()).toBe('https://api.devnet.solana.com')
})

test('uses the configured endpoint and keeps its api-key query intact', () => {
  process.env.VITE_SOLANA_RPC_ENDPOINT = 'https://devnet.helius-rpc.com/?api-key=abc'
  expect(solanaRpcEndpoint()).toBe('https://devnet.helius-rpc.com/?api-key=abc')
  delete process.env.VITE_SOLANA_RPC_ENDPOINT
})

test('refuses embedded credentials, non-https remotes and garbage rather than trusting them', () => {
  for (const bad of ['https://user:pass@rpc.example.com', 'http://rpc.example.com', 'not a url']) {
    process.env.VITE_SOLANA_RPC_ENDPOINT = bad
    expect(solanaRpcEndpoint()).toBe('https://api.devnet.solana.com')
  }
  process.env.VITE_SOLANA_RPC_ENDPOINT = 'http://127.0.0.1:8899'
  expect(solanaRpcEndpoint()).toBe('http://127.0.0.1:8899/')
  delete process.env.VITE_SOLANA_RPC_ENDPOINT
})
