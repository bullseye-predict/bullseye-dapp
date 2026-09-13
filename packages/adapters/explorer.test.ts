import { expect, test } from 'bun:test'
import { explorerTxUrl } from './explorer'

const solanaDevnet = { family: 'SOLANA', chainId: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG', explorerUrl: 'https://explorer.solana.com' }

test('a Solana venue links to Solana with its own cluster, never to another chain', () => {
  expect(explorerTxUrl(solanaDevnet, 'SIG')).toBe('https://explorer.solana.com/tx/SIG?cluster=devnet')
  expect(explorerTxUrl({ ...solanaDevnet, chainId: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d' }, 'SIG'))
    .toBe('https://explorer.solana.com/tx/SIG')
  expect(explorerTxUrl({ ...solanaDevnet, explorerUrl: 'https://explorer.solana.com/' }, 'SIG'))
    .toBe('https://explorer.solana.com/tx/SIG?cluster=devnet')
})

test('an EVM venue uses its own explorer, and an unknown cluster omits the parameter', () => {
  expect(explorerTxUrl({ family: 'EVM', chainId: '50312', explorerUrl: 'https://shannon-explorer.somnia.network' }, '0xabc'))
    .toBe('https://shannon-explorer.somnia.network/tx/0xabc')
  expect(explorerTxUrl({ ...solanaDevnet, chainId: 'unknown-genesis' }, 'SIG')).toBe('https://explorer.solana.com/tx/SIG')
})

test('no explorer configured renders no link rather than a wrong-chain link', () => {
  expect(explorerTxUrl(null, 'SIG')).toBeUndefined()
  expect(explorerTxUrl({ family: 'SOLANA', chainId: 'x' }, 'SIG')).toBeUndefined()
  expect(explorerTxUrl(solanaDevnet, '')).toBeUndefined()
})
