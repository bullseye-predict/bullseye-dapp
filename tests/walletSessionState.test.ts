import { describe, expect, test } from 'bun:test'
import { getWalletSessionState } from '../src/components/arena/walletSessionState'

describe('wallet session restoration', () => {
  test('does not authorize a persisted wallet before SDK restoration finishes', () => {
    expect(getWalletSessionState(false, true, true)).toBe('restoring')
  })
  test('requires sign-in when a wallet survives an expired session', () => {
    expect(getWalletSessionState(true, false, true)).toBe('needs-signature')
  })
  test('restores readiness only with both authentication and a Solana wallet', () => {
    expect(getWalletSessionState(true, true, true)).toBe('ready')
    expect(getWalletSessionState(true, true, false)).toBe('needs-wallet')
    expect(getWalletSessionState(true, false, false)).toBe('signed-out')
  })
})
