import { ComputeBudgetProgram, Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js'
import { base58 } from '@scure/base'
import type { PlannedSettlement, SettlementReceipt, SettlementTransport } from '../../../apps/matcher/settlement'
import { intentHash, signedOrderIntent, type ChainSubmissionJournal, type Submission } from '../../../apps/chain-worker/journal'
import { verifyResult } from '../../../apps/chain-worker/results'
import type { SignedMatchResult } from '../../prediction-core/types'
import { invariant, quoteCeil } from '../../prediction-core/validation'
import type { SolanaGatewayConfig } from './gateway'
import { decodePosition, decodeOrderState, decodeMarket } from './accounts'
import { solanaWireOrder, solanaOrderSignature } from './SolanaPredictionVenue'
import { buildFillOrders, initializeOrCancelNonce, initializePosition, lockMarket, resolveMarket, voidMarket, millisecondsToSeconds, orderStateAddress, positionAddress } from './wire'

export interface SolanaTransportOptions { journal: ChainSubmissionJournal; relayer?: Keypair; oracle?: Keypair; writesEnabled: boolean; computeUnitLimit?: number; priorityFeeMicroLamports?: number }
type Intent = { kind: 'FILL'; buy: PlannedSettlement['buy']; sell: PlannedSettlement['sell']; quantity: bigint; price: bigint; collateral: bigint } | { kind: 'RESULT'; result: SignedMatchResult } | { kind: 'SETUP'; market: string; orders: PlannedSettlement['buy'][] }
const domain = (config: SolanaGatewayConfig) => Uint8Array.from(config.networkDomain.match(/../g)!, value => parseInt(value, 16))
const bytes32 = (value: string) => Uint8Array.from(value.slice(2).match(/../g)!, value => parseInt(value, 16))

/** Uses exact persisted signed transactions. An expired ambiguous blockhash never permits a fresh replacement fill. */
export class SolanaSettlementTransport implements SettlementTransport {
  readonly connection: Connection
  private readonly chain: string
  constructor(readonly config: SolanaGatewayConfig, readonly options: SolanaTransportOptions) {
    this.connection = new Connection(config.rpcUrl, { commitment: 'finalized', disableRetryOnRateLimit: true, fetch: ((url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(10_000) })) as typeof fetch })
    this.chain = JSON.stringify([config.venue, config.chainId, config.programId])
    invariant(Number.isSafeInteger(options.computeUnitLimit ?? 1_000_000) && (options.computeUnitLimit ?? 1_000_000) > 0 && (options.computeUnitLimit ?? 1_000_000) <= 1_400_000 && Number.isSafeInteger(options.priorityFeeMicroLamports ?? 0) && (options.priorityFeeMicroLamports ?? 0) >= 0, 'INVALID_CONFIG', 'Invalid Solana transaction fee policy.')
  }
  private id(id: string): string { return JSON.stringify([this.chain, id]) }
  private async checkChain(): Promise<void> { invariant(await this.connection.getGenesisHash() === this.config.chainId, 'WRONG_CHAIN', 'Solana relayer RPC genesis does not match configuration.') }
  async submit(plan: Readonly<PlannedSettlement>): Promise<SettlementReceipt> { return this.fill(plan) }
  async lookup(plan: Readonly<PlannedSettlement>): Promise<SettlementReceipt> { return this.fill(plan) }
  private async fill(plan: Readonly<PlannedSettlement>): Promise<SettlementReceipt> {
    invariant(plan.venue === 'SOLANA' && plan.chainId === this.config.chainId && plan.marketId === plan.buy.marketId && plan.marketId === plan.sell.marketId && plan.price === plan.sell.price && plan.collateral === quoteCeil(plan.quantity, plan.price), 'INVALID_PLAN', 'Solana plan scope or execution price is invalid.')
    await this.checkChain()
    const address = new PublicKey(plan.marketId)
    const account = await this.connection.getAccountInfo(address, 'finalized')
    invariant(account && !decodeMarket({ ...account, address }, this.config.programId).manifestGuarded, 'WRONG_ENGINE', 'Manifest questions cannot use the offchain fill transport.')
    const intent: Intent = { kind: 'FILL', buy: signedOrderIntent(plan.buy), sell: signedOrderIntent(plan.sell), quantity: plan.quantity, price: plan.price, collateral: plan.collateral }
    const existing = this.options.journal.get(this.id(plan.id))
    if (!existing?.prepared) {
      const setup: Intent = { kind: 'SETUP', market: plan.marketId, orders: [signedOrderIntent(plan.buy), signedOrderIntent(plan.sell)] }
      const missing = await this.setupInstructions(setup)
      if (missing.length || this.options.journal.get(this.id(`${plan.id}:accounts`))) {
        const prepared = await this.perform(`${plan.id}:accounts`, setup, missing)
        if (prepared.status !== 'CONFIRMED') return prepared.status === 'FAILED' ? { status: 'FAILED', reason: 'Position or nonce initialization failed before any fill was submitted.' } : { status: 'UNKNOWN' }
      }
    }
    return this.perform(plan.id, intent)
  }
  async submitResult(id: string, result: SignedMatchResult): Promise<SettlementReceipt> {
    await this.checkChain()
    return this.perform(id, { kind: 'RESULT', result })
  }
  private async setupInstructions(intent: Extract<Intent, { kind: 'SETUP' }>): Promise<TransactionInstruction[]> {
    const result: TransactionInstruction[] = []
    for (const order of intent.orders) {
      const position = positionAddress(this.config.programId, intent.market, order.maker)
      const nonce = orderStateAddress(this.config.programId, order.maker, order.nonce)
      const [positionInfo, nonceInfo] = await this.connection.getMultipleAccountsInfo([position, nonce], 'finalized')
      if (positionInfo) decodePosition({ ...positionInfo, address: position }, this.config.programId)
      else {
        invariant(this.options.relayer, 'RELAYER_DISABLED', 'Position creation requires the configured rent payer.')
        result.push(initializePosition(this.config.programId, this.options.relayer.publicKey, intent.market, order.maker))
      }
      if (nonceInfo) decodeOrderState({ ...nonceInfo, address: nonce }, this.config.programId)
      else {
        invariant(this.options.relayer, 'RELAYER_DISABLED', 'Nonce creation requires the configured rent payer.')
        result.push(initializeOrCancelNonce(this.config.programId, this.options.relayer.publicKey, order.maker, order.nonce))
      }
    }
    return result
  }
  private async instructions(intent: Intent): Promise<TransactionInstruction[]> {
    if (intent.kind === 'SETUP') return this.setupInstructions(intent)
    if (intent.kind === 'FILL') return buildFillOrders({ programId: this.config.programId, networkDomain: domain(this.config), buy: solanaWireOrder(intent.buy), sell: solanaWireOrder(intent.sell), buySignature: solanaOrderSignature(intent.buy), sellSignature: solanaOrderSignature(intent.sell), quantity: intent.quantity, executionPrice: intent.price, fillInstructionIndex: 3 })
    invariant(this.options.oracle && this.options.oracle.publicKey.toBase58() === this.config.oracleAuthority, 'ORACLE_DISABLED', 'An explicitly configured matching oracle transaction signer is required.')
    const result = intent.result
    if (result.voided) return [voidMarket(this.config.programId, this.options.oracle.publicKey, result.marketId, bytes32(result.stateHash))]
    const info = await this.connection.getAccountInfo(new PublicKey(result.marketId), 'confirmed')
    invariant(info, 'MISSING_MARKET', 'Result market does not exist.')
    const market = decodeMarket({ ...info, address: result.marketId }, this.config.programId)
    return [ ...(market.status < 2 ? [lockMarket(this.config.programId, this.options.oracle.publicKey, result.marketId)] : []), resolveMarket(this.config.programId, this.options.oracle.publicKey, result.marketId, result.winningOutcomeId, bytes32(result.stateHash), millisecondsToSeconds(result.matchEndedAt)) ]
  }
  private async perform(id: string, intent: Intent, initialInstructions?: TransactionInstruction[]): Promise<SettlementReceipt> {
    const key = this.id(id)
    let value = this.options.journal.get(key)
    invariant(!value || value.intentHash === intentHash(intent), 'SUBMISSION_CONFLICT', 'Submission ID has another intent.')
    if (value?.receipt?.status === 'CONFIRMED' || value?.receipt?.status === 'FAILED') return value.receipt
    if (!value?.prepared) {
      invariant(this.options.writesEnabled && this.options.relayer, 'RELAYER_DISABLED', 'No explicitly enabled Solana relayer is configured.')
      value = this.options.journal.claim(key, this.chain, intent)
      if (!value) return { status: 'UNKNOWN' }
      if (value.receipt?.status === 'CONFIRMED' || value.receipt?.status === 'FAILED') return value.receipt
      if (!value.prepared) {
        if (intent.kind === 'RESULT' && !await verifyResult(intent.result, this.config)) return this.options.journal.failUnsigned(key, 'Result attestation or deadline is no longer valid; no transaction was signed.')
        const latest = await this.connection.getLatestBlockhash('confirmed')
        const transaction = new Transaction({ feePayer: this.options.relayer.publicKey, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight })
        transaction.add(ComputeBudgetProgram.setComputeUnitLimit({ units: this.options.computeUnitLimit ?? 1_000_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: this.options.priorityFeeMicroLamports ?? 0 }), ...(initialInstructions ?? await this.instructions(intent)))
        const signers = [this.options.relayer, ...(intent.kind === 'RESULT' && this.options.oracle ? [this.options.oracle] : [])]
        transaction.sign(...signers.filter((signer, index) => signers.findIndex(other => other.publicKey.equals(signer.publicKey)) === index))
        const raw = transaction.serialize()
        invariant(raw.length <= 1232 && transaction.signature, 'TRANSACTION_TOO_LARGE', 'Transaction exceeds Solana packet size.')
        value = this.options.journal.signed(key, { raw: Buffer.from(raw).toString('base64'), txHash: base58.encode(transaction.signature), lastValidBlockHeight: latest.lastValidBlockHeight })
      }
    }
    invariant(value.prepared, 'UNSIGNED_SUBMISSION', 'Submission has no signed transaction.')
    let receipt = await this.inspect(value)
    if (receipt.status !== 'CONFIRMED' && receipt.status !== 'FAILED' && this.options.writesEnabled) {
      const height = await this.connection.getBlockHeight('finalized')
      if (height <= value.prepared.lastValidBlockHeight!) {
        try {
          const signature = await this.connection.sendRawTransaction(Buffer.from(value.prepared.raw, 'base64'), { skipPreflight: false, maxRetries: 0, preflightCommitment: 'confirmed' })
          invariant(signature === value.prepared.txHash, 'INVALID_BROADCAST', 'RPC returned a different transaction signature.')
        } catch { /* Unknown broadcast outcomes are recovered only from the same transaction. */ }
      }
      receipt = await this.inspect(value)
    }
    return this.options.journal.record(key, receipt)
  }
  private async inspect(value: Submission): Promise<SettlementReceipt> {
    const prepared = value.prepared!
    try {
      const status = (await this.connection.getSignatureStatuses([prepared.txHash], { searchTransactionHistory: true })).value[0]
      if (!status || status.confirmationStatus !== 'finalized') return { status: 'PENDING', txHash: prepared.txHash }
      const result = await this.connection.getTransaction(prepared.txHash, { commitment: 'finalized', maxSupportedTransactionVersion: 0 })
      if (!result?.meta || result.transaction.signatures[0] !== prepared.txHash) return { status: 'UNKNOWN', txHash: prepared.txHash }
      const original = Transaction.from(Buffer.from(prepared.raw, 'base64'))
      if (!Buffer.from(result.transaction.message.serialize()).equals(original.serializeMessage())) return { status: 'UNKNOWN', txHash: prepared.txHash }
      if (result.meta.err) return { status: 'FAILED', txHash: prepared.txHash, reason: 'Finalized Solana transaction failed; all instructions rolled back.' }
      if (result.blockTime === null || result.blockTime === undefined) return { status: 'UNKNOWN', txHash: prepared.txHash }
      // Exact finalized message equality binds program ID, accounts, order bodies,
      // precompile signatures, fill quantity, result winner and every instruction.
      return { status: 'CONFIRMED', txHash: prepared.txHash, confirmedAt: result.blockTime * 1000 }
    } catch { return { status: 'UNKNOWN', txHash: prepared.txHash } }
  }
}
