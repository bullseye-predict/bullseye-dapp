import { describe, expect, test } from 'bun:test'
import { explorerClusterParam, solanaCluster, solanaClusterLabel } from './cluster'

const MAINNET = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'
const DEVNET = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'
const TESTNET = '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY'

describe('solana cluster identity', () => {
  test('each cluster is named from its own genesis hash', () => {
    expect(solanaCluster(MAINNET)).toBe('mainnet')
    expect(solanaCluster(DEVNET)).toBe('devnet')
    expect(solanaCluster(TESTNET)).toBe('testnet')
  })

  test('an unknown hash is unknown, never a default', () => {
    // Naming the wrong chain is worse than naming none: a reader acts on it.
    // The old explorer table carried a testnet hash that is not any cluster's,
    // which silently resolved testnet links against mainnet-beta.
    expect(solanaCluster('4uhcVJyUZjqm4vG6QhWm1SxGKPQnHhkFXzChTBDvnPhY')).toBeUndefined()
    expect(solanaCluster(undefined)).toBeUndefined()
    expect(solanaCluster('')).toBeUndefined()
    expect(solanaClusterLabel(undefined)).toBe('UNKNOWN CLUSTER')
  })

  test('only mainnet omits the explorer cluster parameter', () => {
    expect(explorerClusterParam(MAINNET)).toBeUndefined()
    expect(explorerClusterParam(DEVNET)).toBe('devnet')
    expect(explorerClusterParam(TESTNET)).toBe('testnet')
  })
})
