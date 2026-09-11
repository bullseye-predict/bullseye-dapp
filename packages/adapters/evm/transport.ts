import { createPublicClient, decodeEventLog, http, keccak256, parseAbi, type Hex } from 'viem'
import type { PrivateKeyAccount } from 'viem/accounts'
import type { EvmVenueConfig } from '../config'
import { fillTransaction, type EvmTransactionRequest } from './transactions'
import { resolveTransaction } from './results'
import type { PlannedSettlement, SettlementReceipt, SettlementTransport } from '../../../apps/matcher/settlement'
import { intentHash, signedOrderIntent, type ChainSubmissionJournal, type Submission } from '../../../apps/chain-worker/journal'
import { verifyResult } from '../../../apps/chain-worker/results'
import type { SignedMatchResult } from '../../prediction-core/types'
import { invariant, quoteCeil } from '../../prediction-core/validation'

const EVENTS = parseAbi([
  'event TradeExecuted(bytes32 indexed marketId,bytes32 indexed buyOrderHash,bytes32 indexed sellOrderHash,address buyer,address seller,uint8 outcomeId,uint64 price,uint128 quantity,uint256 collateralAmount)',
  'event MarketResolved(bytes32 indexed marketId,uint8 winningOutcomeId,bytes32 stateHash)',
  'event MarketVoided(bytes32 indexed marketId,bytes32 stateHash)',
])
export interface EvmTransportOptions {
  journal: ChainSubmissionJournal
  relayer?: PrivateKeyAccount
  writesEnabled: boolean
  confirmations?: number
  maxGas?: bigint
  maxGasPriceWei?: bigint
}
type Intent = { kind: 'FILL'; plan: { buy: PlannedSettlement['buy']; sell: PlannedSettlement['sell']; quantity: bigint; price: bigint; collateral: bigint } } | { kind: 'RESULT'; result: SignedMatchResult }

/** A gas-only relayer: order signatures and oracle signatures remain independently verified on chain. */
export class EvmSettlementTransport implements SettlementTransport {
  readonly client
  private readonly chain: string
  private readonly confirmations: bigint
  constructor(readonly config: EvmVenueConfig, readonly options: EvmTransportOptions) {
    this.client = createPublicClient({ transport: http(config.rpcUrl, { timeout: 10_000, retryCount: 0 }) })
    this.chain = JSON.stringify([config.venue, config.chainId, config.settlementAddress.toLowerCase()])
    invariant(Number.isSafeInteger(options.confirmations ?? 2) && (options.confirmations ?? 2) >= 1, 'INVALID_CONFIG', 'At least one confirmation is required.')
    this.confirmations = BigInt(options.confirmations ?? 2)
  }
  private id(id: string): string { return JSON.stringify([this.chain, id]) }
  private intent(plan: Readonly<PlannedSettlement>): Intent {
    invariant(plan.venue === this.config.venue && plan.chainId === this.config.chainId && plan.marketId === plan.buy.marketId && plan.marketId === plan.sell.marketId && plan.price === plan.sell.price && plan.collateral === quoteCeil(plan.quantity, plan.price), 'INVALID_PLAN', 'Settlement plan does not match this deployment or execution price.')
    return { kind: 'FILL', plan: { buy: signedOrderIntent(plan.buy), sell: signedOrderIntent(plan.sell), quantity: plan.quantity, price: plan.price, collateral: plan.collateral } }
  }
  private request(intent: Intent): EvmTransactionRequest {
    return intent.kind === 'FILL' ? fillTransaction(this.config.settlementAddress, intent.plan.buy, intent.plan.sell, intent.plan.quantity) : resolveTransaction(this.config.oracleAddress, intent.result)
  }
  async submit(plan: Readonly<PlannedSettlement>): Promise<SettlementReceipt> { return this.perform(plan.id, this.intent(plan)) }
  async lookup(plan: Readonly<PlannedSettlement>): Promise<SettlementReceipt> { return this.perform(plan.id, this.intent(plan)) }
  async submitResult(id: string, result: SignedMatchResult): Promise<SettlementReceipt> { return this.perform(id, { kind: 'RESULT', result }) }

  private async perform(id: string, intent: Intent): Promise<SettlementReceipt> {
    invariant(String(await this.client.getChainId()) === this.config.chainId, 'WRONG_CHAIN', 'Relayer RPC chain does not match configuration.')
    const key = this.id(id)
    let value = this.options.journal.get(key)
    invariant(!value || value.intentHash === intentHash(intent), 'SUBMISSION_CONFLICT', 'Submission ID has another intent.')
    if (value?.receipt?.status === 'CONFIRMED' || value?.receipt?.status === 'FAILED') return value.receipt
    const request = this.request(intent)
    if (!value?.prepared) {
      invariant(this.options.writesEnabled && this.options.relayer, 'RELAYER_DISABLED', 'No explicitly enabled relayer is configured.')
      value = this.options.journal.claim(key, this.chain, intent)
      if (!value) return { status: 'UNKNOWN' }
      if (value.receipt?.status === 'CONFIRMED' || value.receipt?.status === 'FAILED') return value.receipt
      // A claimed nonce survives a crash before signing. Recreate the ORIGINAL intent
      // at its bounded gas ceiling even if it now reverts, consuming that nonce safely.
      let gas = this.options.maxGas ?? 2_000_000n
      if (value.nonce === undefined && !value.prepared) {
        if (intent.kind === 'RESULT' && !await verifyResult(intent.result, this.config)) return this.options.journal.failUnsigned(key, 'Result authorization or deadline is no longer valid; no transaction was signed.')
        try {
          const estimate = await this.client.estimateGas({ account: this.options.relayer.address, ...request })
          gas = estimate + estimate / 5n + 10_000n
        } catch { return this.options.journal.failUnsigned(key, 'Preflight simulation failed before signing or broadcasting.') }
      }
      const gasPrice = await this.client.getGasPrice()
      invariant(gas <= (this.options.maxGas ?? 2_000_000n) && gasPrice <= (this.options.maxGasPriceWei ?? 100_000_000_000n), 'GAS_LIMIT', 'Transaction exceeds configured relayer gas limits.')
      const pending = BigInt(await this.client.getTransactionCount({ address: this.options.relayer.address, blockTag: 'pending' }))
      value = this.options.journal.claim(key, this.chain, intent, { account: this.options.relayer.address, pending, scope: JSON.stringify(['EVM', this.config.chainId]) })
      if (!value) return { status: 'UNKNOWN' }
      if (!value.prepared) {
        invariant(value.nonce !== undefined && value.nonce <= BigInt(Number.MAX_SAFE_INTEGER), 'INVALID_NONCE', 'Relayer nonce cannot be represented safely.')
        const raw = await this.options.relayer.signTransaction({ ...request, chainId: Number(this.config.chainId), nonce: Number(value.nonce), gas, gasPrice, type: 'legacy' })
        value = this.options.journal.signed(key, { raw, txHash: keccak256(raw) })
      }
    } else {
      // Even recovery must reject a caller attempting to reuse an ID with different bytes.
      this.options.journal.claim(key, this.chain, intent)
    }
    invariant(value.prepared, 'UNSIGNED_SUBMISSION', 'Submission is missing signed bytes.')
    const receipt = await this.inspect(value, intent, request)
    if (receipt.status === 'CONFIRMED' || receipt.status === 'FAILED') return this.options.journal.record(key, receipt)
    if (this.options.writesEnabled) {
      try {
        const hash = await this.client.sendRawTransaction({ serializedTransaction: value.prepared.raw as Hex })
        invariant(hash.toLowerCase() === value.prepared.txHash.toLowerCase(), 'INVALID_BROADCAST', 'RPC returned another transaction hash.')
      } catch { /* Already known, transient errors and timeouts retain the exact signed transaction. */ }
    }
    return this.options.journal.record(key, await this.inspect(value, intent, request))
  }

  private async inspect(value: Submission, intent: Intent, request: EvmTransactionRequest): Promise<SettlementReceipt> {
    const hash = value.prepared!.txHash as Hex
    try {
      const receipt = await this.client.getTransactionReceipt({ hash })
      const head = await this.client.getBlockNumber({ cacheTime: 0 })
      if (head - receipt.blockNumber + 1n < this.confirmations) return { status: 'PENDING', txHash: hash }
      const [block, transaction] = await Promise.all([this.client.getBlock({ blockNumber: receipt.blockNumber }), this.client.getTransaction({ hash })])
      if (block.hash !== receipt.blockHash || transaction.to?.toLowerCase() !== request.to.toLowerCase() || transaction.input.toLowerCase() !== request.data.toLowerCase() || transaction.value !== 0n) return { status: 'UNKNOWN', txHash: hash }
      if (receipt.status === 'reverted') return { status: 'FAILED', txHash: hash, reason: 'Canonical confirmed transaction reverted.' }
      const events = receipt.logs.filter(log => log.address.toLowerCase() === this.config.settlementAddress.toLowerCase()).flatMap(log => {
        try { return [decodeEventLog({ abi: EVENTS, data: log.data, topics: log.topics })] } catch { return [] }
      })
      let matches = 0
      for (const event of events) {
        if (intent.kind === 'FILL' && event.eventName === 'TradeExecuted') {
          const p = intent.plan; const e = event.args
          if (e.marketId.toLowerCase() === p.buy.marketId.toLowerCase() && e.buyOrderHash.toLowerCase() === p.buy.orderId.toLowerCase() && e.sellOrderHash.toLowerCase() === p.sell.orderId.toLowerCase() && e.buyer.toLowerCase() === p.buy.maker.toLowerCase() && e.seller.toLowerCase() === p.sell.maker.toLowerCase() && e.outcomeId === p.buy.outcomeId && e.price === p.price && e.quantity === p.quantity && e.collateralAmount === p.collateral) matches++
        } else if (intent.kind === 'RESULT' && (event.eventName === 'MarketResolved' || event.eventName === 'MarketVoided')) {
          const r = intent.result
          if (event.args.marketId.toLowerCase() === r.marketId.toLowerCase() && event.args.stateHash.toLowerCase() === r.stateHash.toLowerCase() && (r.voided ? event.eventName === 'MarketVoided' : event.eventName === 'MarketResolved' && event.args.winningOutcomeId === r.winningOutcomeId)) matches++
        }
      }
      if (matches !== 1) return { status: 'UNKNOWN', txHash: hash }
      return { status: 'CONFIRMED', txHash: hash, confirmedAt: Number(block.timestamp) * 1000 }
    } catch { return { status: 'PENDING', txHash: hash } }
  }
}
