export type WalletSessionState = 'restoring' | 'signed-out' | 'needs-signature' | 'needs-wallet' | 'ready'

// Wallet discovery is independent of Dynamic authentication. Never expose a
// signing port while the persisted session is still restoring or unauthenticated.
export function getWalletSessionState(sdkHasLoaded: boolean, authenticated: boolean, hasSolanaWallet: boolean): WalletSessionState {
  if (!sdkHasLoaded) return 'restoring'
  if (!authenticated) return hasSolanaWallet ? 'needs-signature' : 'signed-out'
  return hasSolanaWallet ? 'ready' : 'needs-wallet'
}
