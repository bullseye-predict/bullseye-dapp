import { decodeAbiParameters, encodeAbiParameters, isAddress, parseAbi, recoverMessageAddress, zeroAddress, type Address, type Hex, type PublicClient } from 'viem'
import { invariant } from '../../prediction-core/validation'

const ENVELOPE = [{ type: 'uint256' }, { type: 'bytes' }] as const
const ABI = parseAbi([
  'function owner() view returns (address)',
  'function settlement() view returns (address)',
  'function collateral() view returns (address)',
  'function policyNonce() view returns (uint256)',
  'function policy() view returns (address operator,uint128 maxCapital,uint128 maxOrderSize,uint128 maxExposure,uint64 expiresAt,bool enabled)',
])

export type VaultRequestClient = Pick<PublicClient, 'getBlockNumber' | 'getBytecode' | 'readContract' | 'verifyMessage'>
export interface VaultRequestScope { method: string; pathname: string }
export interface VaultRequestConfig { settlementAddress: Address; collateralToken: Address }

/** Bind a request to this authorization epoch; an old session cannot be revived by rewriting its envelope. */
export function vaultRequestMessage(message: string, policyNonce: bigint): string {
  invariant(policyNonce >= 0n && policyNonce < (1n << 256n), 'INVALID_NONCE', 'Invalid vault policy nonce.')
  return `${message}\nSOLZ_VAULT_POLICY:${policyNonce}`
}

export function encodeVaultRequestSignature(policyNonce: bigint, signature: Hex): Hex {
  return encodeAbiParameters(ENVELOPE, [policyNonce, signature])
}

/**
 * The authenticator must construct message and request from the same HTTP request.
 * Proof.account remains the vault; the immutable owner or a permitted active operator signs.
 * This authorizes off-chain requests only and never changes ERC1271 order verification.
 */
export async function verifyVaultRequest(
  client: VaultRequestClient,
  config: VaultRequestConfig,
  account: string,
  message: string,
  signature: string,
  request: VaultRequestScope,
  now = Date.now(),
): Promise<boolean> {
  try {
    if (!isAddress(account) || !/^0x[0-9a-fA-F]+$/.test(signature) || signature.length > 8192 || !Number.isSafeInteger(now) || now < 0) return false
    const [epoch, innerSignature] = decodeAbiParameters(ENVELOPE, signature as Hex)
    const blockNumber = await client.getBlockNumber({ cacheTime: 0 })
    const address = account as Address
    const code = await client.getBytecode({ address, blockNumber })
    if (!code || code === '0x') return false
    const [owner, settlement, collateral, policyNonce, policy] = await Promise.all([
      client.readContract({ address, abi: ABI, functionName: 'owner', blockNumber }),
      client.readContract({ address, abi: ABI, functionName: 'settlement', blockNumber }),
      client.readContract({ address, abi: ABI, functionName: 'collateral', blockNumber }),
      client.readContract({ address, abi: ABI, functionName: 'policyNonce', blockNumber }),
      client.readContract({ address, abi: ABI, functionName: 'policy', blockNumber }),
    ])
    if (owner === zeroAddress || owner.toLowerCase() === account.toLowerCase() || epoch !== policyNonce ||
      settlement.toLowerCase() !== config.settlementAddress.toLowerCase() || collateral.toLowerCase() !== config.collateralToken.toLowerCase()) return false
    const wrappedMessage = vaultRequestMessage(message, epoch)
    let recovered: Address | undefined
    try { recovered = await recoverMessageAddress({ message: wrappedMessage, signature: innerSignature }) } catch { /* Contract owners may use ERC1271 signatures. */ }
    const ownerSigned = recovered?.toLowerCase() === owner.toLowerCase() ||
      await client.verifyMessage({ address: owner, message: wrappedMessage, signature: innerSignature, blockNumber })
    if (!ownerSigned) {
      const [operator, , , , expiresAt, enabled] = policy
      const method = request.method.toUpperCase()
      const tradingRequest = (method === 'DELETE' && /^\/orders\/[^/]+$/.test(request.pathname)) ||
        (method === 'POST' && ['/orders', '/orders/cancel-all'].includes(request.pathname))
      if (!tradingRequest || !enabled || expiresAt * 1000n <= BigInt(now) || recovered?.toLowerCase() !== operator.toLowerCase()) return false
    }
    // A concurrent owner revocation observed after the snapshot invalidates this request too.
    return epoch === await client.readContract({ address, abi: ABI, functionName: 'policyNonce' })
  } catch {
    // Foreign contracts, malformed envelopes and unavailable RPC must never grant authority.
    return false
  }
}
