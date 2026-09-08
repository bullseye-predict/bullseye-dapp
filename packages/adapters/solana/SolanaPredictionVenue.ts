import { PublicKey } from '@solana/web3.js'
import type { PlaceOrderInput, SignedOrder } from '../../prediction-core/types'
import { HttpPredictionVenue, type VenueClientOptions } from '../../sdk/HttpPredictionVenue'
import { decodeConfig, decodeOrderState, decodeVault } from './accounts'
import { address, configAddress, encodeOrderBody, fixedBytes, millisecondsToSeconds, orderDigest, orderStateAddress, vaultAddress, type AddressInput, type SolanaOrder } from './wire'

export interface SolanaAccountReader {
  (account: PublicKey): Promise<{ owner: PublicKey; data: Uint8Array } | null>
}
export interface SolanaVenueConfig {
  programId: AddressInput
  networkDomain: Uint8Array
  chainId: string
  readAccount: SolanaAccountReader
  now?: () => number
}
export interface SolanaMessageSigner {
  publicKey: AddressInput
  /** Called only after canonical order construction and current vault validation. */
  signMessage(message: Uint8Array): Promise<Uint8Array>
}
interface SignatureEnvelope {
  scheme: 'SOLZ_SOLANA_V1'
  signer: string
  sessionEpoch: string
  signature: string
}
const hex = (value: Uint8Array) => Array.from(value, byte => byte.toString(16).padStart(2, '0')).join('')
function fromHex(value: string, bytes: number): Uint8Array {
  if (!new RegExp(`^[a-f0-9]{${bytes * 2}}$`).test(value)) throw new Error('Invalid signature encoding')
  return Uint8Array.from(value.match(/../g)!, byte => parseInt(byte, 16))
}
function parseEnvelope(value: string): SignatureEnvelope {
  if (value.length > 1024) throw new Error('Signature envelope too large')
  const parsed: unknown = JSON.parse(value)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('Invalid signature envelope')
  const object = parsed as Record<string, unknown>
  if (object.scheme !== 'SOLZ_SOLANA_V1' || typeof object.signer !== 'string' || typeof object.sessionEpoch !== 'string' || !/^(0|[1-9][0-9]*)$/.test(object.sessionEpoch) || typeof object.signature !== 'string') throw new Error('Invalid signature envelope')
  if (Object.keys(object).sort().join() !== 'scheme,sessionEpoch,signature,signer') throw new Error('Unexpected signature fields')
  address(object.signer); fromHex(object.signature, 64)
  if (BigInt(object.sessionEpoch) > 0xffff_ffff_ffff_ffffn) throw new Error('Invalid session epoch')
  return object as unknown as SignatureEnvelope
}
async function liveVault(config: SolanaVenueConfig, vault: AddressInput) {
  const configuration = configAddress(config.programId)
  const [configInfo, vaultInfo] = await Promise.all([config.readAccount(configuration), config.readAccount(address(vault))])
  if (!configInfo || !vaultInfo) throw new Error('Prediction config and user vault must be initialized')
  const global = decodeConfig({ ...configInfo, address: configuration }, config.programId)
  const state = decodeVault({ ...vaultInfo, address: vault }, config.programId)
  if (hex(global.networkDomain) !== hex(fixedBytes(config.networkDomain, 32)) || !global.mint.equals(state.mint)) throw new Error('Solana deployment configuration mismatch')
  return { global, state }
}
function authorized(state: ReturnType<typeof decodeVault>, signer: AddressInput, epoch: bigint, now: number): boolean {
  if (epoch !== state.sessionEpoch) return false
  if (state.owner.equals(address(signer))) return true
  return state.enabled && state.agent.equals(address(signer)) && millisecondsToSeconds(now) < state.expirySeconds
}
function withinSessionLimits(state: ReturnType<typeof decodeVault>, order: SolanaOrder, remainingQuantity = order.quantity): boolean {
  if (state.owner.equals(address(order.signer))) return true
  const notional = (order.quantity * order.price + 999_999n) / 1_000_000n
  const remainingNotional = (remainingQuantity * order.price + 999_999n) / 1_000_000n
  return order.expirySeconds <= state.expirySeconds && notional <= state.maxOrderSize &&
    (order.side !== 'BUY' || (state.spentCapital + remainingNotional <= state.maxCapital && state.exposure + remainingQuantity <= state.maxExposure))
}
function envelope(signer: AddressInput, epoch: bigint, signature: Uint8Array): string {
  return JSON.stringify({ scheme: 'SOLZ_SOLANA_V1', signer: address(signer).toBase58(), sessionEpoch: epoch.toString(), signature: hex(fixedBytes(signature, 64)) } satisfies SignatureEnvelope)
}
export function solanaWireOrder(order: Readonly<SignedOrder>): SolanaOrder {
  const signature = parseEnvelope(order.signature)
  return { signer: signature.signer, vault: order.maker, market: order.marketId, outcomeId: order.outcomeId, side: order.side, price: order.price, quantity: order.quantity, nonce: order.nonce, expirySeconds: millisecondsToSeconds(order.expiresAt), sessionEpoch: BigInt(signature.sessionEpoch) }
}
export function solanaOrderSignature(order: Readonly<SignedOrder>): Uint8Array {
  return fromHex(parseEnvelope(order.signature).signature, 64)
}
export function createSolanaOrderSigner(config: SolanaVenueConfig, owner: AddressInput, signer: SolanaMessageSigner, nextNonce: () => Promise<bigint>) {
  const vault = vaultAddress(config.programId, owner)
  return async (input: PlaceOrderInput): Promise<SignedOrder> => {
    const { global, state } = await liveVault(config, vault)
    const now = (config.now ?? Date.now)()
    if (global.paused || !authorized(state, signer.publicKey, state.sessionEpoch, now)) throw new Error('Solana trader is paused or unauthorized')
    const nonce = await nextNonce()
    const order: SolanaOrder = { signer: signer.publicKey, vault, market: input.marketId, outcomeId: input.outcomeId, side: input.side, price: input.price, quantity: input.quantity, nonce, expirySeconds: millisecondsToSeconds(input.expiresAt), sessionEpoch: state.sessionEpoch }
    if (order.expirySeconds <= millisecondsToSeconds(now)) throw new Error('Order has expired after rounding to seconds')
    if (!withinSessionLimits(state, order)) throw new Error('Order exceeds session capital or exposure policy')
    const hash = await orderDigest(config.programId, config.networkDomain, order)
    return { ...input, venue: 'SOLANA', chainId: config.chainId, maker: vault.toBase58(), nonce, orderId: hex(hash), signature: envelope(signer.publicKey, state.sessionEpoch, await signer.signMessage(hash)) }
  }
}
async function verifyEd25519(signer: AddressInput, message: Uint8Array, signature: Uint8Array): Promise<boolean> {
  const publicKey = await crypto.subtle.importKey('raw', Uint8Array.from(address(signer).toBytes()).buffer, 'Ed25519', false, ['verify'])
  return crypto.subtle.verify('Ed25519', publicKey, Uint8Array.from(signature).buffer, Uint8Array.from(message).buffer)
}
/** API admission verification; the program independently repeats authorization,
 * nonce, balance, position, cutoff and signature checks during atomic fill. */
export async function verifySolanaOrder(order: Readonly<SignedOrder>, config: SolanaVenueConfig): Promise<boolean> {
  try {
    if (order.venue !== 'SOLANA' || order.chainId !== config.chainId) return false
    const wire = solanaWireOrder(order)
    const { global, state } = await liveVault(config, wire.vault)
    const now = (config.now ?? Date.now)()
    if (global.paused || !authorized(state, wire.signer, wire.sessionEpoch, now) || wire.expirySeconds <= millisecondsToSeconds(now)) return false
    let remainingQuantity = wire.quantity
    const nonceAddress = orderStateAddress(config.programId, wire.vault, wire.nonce)
    const nonceInfo = await config.readAccount(nonceAddress)
    if (nonceInfo) {
      const nonce = decodeOrderState({ ...nonceInfo, address: nonceAddress }, config.programId)
      if (nonce.cancelled || nonce.filled >= wire.quantity) return false
      remainingQuantity -= nonce.filled
      if (nonce.bound && (nonce.sessionEpoch !== wire.sessionEpoch || hex(nonce.orderBody) !== hex(encodeOrderBody(wire)))) return false
    }
    if (!withinSessionLimits(state, wire, remainingQuantity)) return false
    const hash = await orderDigest(config.programId, config.networkDomain, wire)
    return order.orderId === hex(hash) && await verifyEd25519(wire.signer, hash, solanaOrderSignature(order))
  } catch { return false }
}
function requestMessage(config: SolanaVenueConfig, epoch: bigint, message: string): Uint8Array {
  return new TextEncoder().encode(['SOLZ_SOLANA_REQUEST_V1', address(config.programId).toBase58(), hex(fixedBytes(config.networkDomain, 32)), epoch.toString(), message].join('\n'))
}
export interface SolanaRequestMeta { method: string; path: string }
function sessionRequestAllowed(message: string, request: SolanaRequestMeta | undefined): boolean {
  if (!request) return false
  const parts = message.split('\n')
  if (parts.length !== 10 || parts[0] !== 'SOLZ_PREDICTION_REQUEST_V1' || parts[2] !== request.method.toUpperCase()) return false
  try {
    const signedUrl = new URL(parts[3]!, 'https://solz.invalid')
    const requestUrl = new URL(request.path, 'https://solz.invalid')
    if (signedUrl.pathname !== requestUrl.pathname) return false
    return (request.method.toUpperCase() === 'DELETE' && /^\/orders\/[^/]+$/.test(requestUrl.pathname)) ||
      (request.method.toUpperCase() === 'POST' && ['/orders', '/orders/cancel-all'].includes(requestUrl.pathname))
  } catch { return false }
}
export function createSolanaRequestSigner(config: SolanaVenueConfig, owner: AddressInput, signer: SolanaMessageSigner) {
  const vault = vaultAddress(config.programId, owner)
  return async (message: string): Promise<string> => {
    const { state } = await liveVault(config, vault)
    if (!authorized(state, signer.publicKey, state.sessionEpoch, (config.now ?? Date.now)())) throw new Error('Solana trader is unauthorized')
    const parts = message.split('\n')
    if (!state.owner.equals(address(signer.publicKey)) && !sessionRequestAllowed(message, { method: parts[2] ?? '', path: parts[3] ?? '' })) throw new Error('Session keys may only place or cancel orders')
    return envelope(signer.publicKey, state.sessionEpoch, await signer.signMessage(requestMessage(config, state.sessionEpoch, message)))
  }
}
export async function verifySolanaRequest(account: string, message: string, signature: string, config: SolanaVenueConfig, request?: SolanaRequestMeta): Promise<boolean> {
  try {
    const parsed = parseEnvelope(signature)
    const { state } = await liveVault(config, account)
    const epoch = BigInt(parsed.sessionEpoch)
    if (!authorized(state, parsed.signer, epoch, (config.now ?? Date.now)())) return false
    if (!state.owner.equals(address(parsed.signer)) && !sessionRequestAllowed(message, request)) return false
    return await verifyEd25519(parsed.signer, requestMessage(config, epoch, message), fromHex(parsed.signature, 64))
  } catch { return false }
}
export interface SolanaPredictionVenueOptions extends Omit<VenueClientOptions, 'venue' | 'chainId' | 'account' | 'signOrder' | 'signRequest'> {
  deployment: SolanaVenueConfig
  owner: AddressInput
  signer: SolanaMessageSigner
  nextNonce: () => Promise<bigint>
}
/** Account is the vault PDA, not the owner/session wallet. Requests use a
 * vault-aware signature envelope; configure verifySolanaOrder/Request on the API. */
export class SolanaPredictionVenue extends HttpPredictionVenue {
  constructor(options: SolanaPredictionVenueOptions) {
    const { deployment, owner, signer, nextNonce, ...http } = options
    super({ ...http, venue: 'SOLANA', chainId: deployment.chainId, account: vaultAddress(deployment.programId, owner).toBase58(), signOrder: createSolanaOrderSigner(deployment, owner, signer, nextNonce), signRequest: createSolanaRequestSigner(deployment, owner, signer) })
  }
}
