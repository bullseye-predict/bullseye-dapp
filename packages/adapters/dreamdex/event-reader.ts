import { SomniaMarkets, SOMNIA_MAINNET_ADDRESSES, SOMNIA_TESTNET_ADDRESSES, binaryModuleReadAbi, type QuestionDefinitionInput, type SomniaMarketsClient } from '@somnia-chain/markets-sdk'
import { somniaMainnet, somniaShannon } from '@somnia-chain/markets-sdk/chains'
import { erc20Abi, type Hex } from 'viem'
import { invariant } from '../../prediction-core/validation'
import type { EventMarketScope, EventMarketVolume } from '../../prediction-core/event-market'

/** Public Shannon endpoint used by browser-side DreamDEX reads and wallet network setup. */
export const SOMNIA_SHANNON_PUBLIC_RPC_URL = 'https://dream-rpc.somnia.network'

export interface DreamDexEventBinding extends EventMarketScope {
  venue: 'DREAMDEX'
  marketId: Hex
  /** These values must come from the confirmed creation receipt/operator configuration. */
  oracleQuestionId: bigint
  tradingStartsAt: number
  tradingLocksAt: number
  voidPolicy: 0 | 2
}

export function dreamDexNetwork(chainId: string) {
  invariant(chainId === '5031' || chainId === '50312', 'INVALID_CONFIG', 'DreamDEX is configured only for Somnia mainnet or Shannon testnet.')
  return chainId === '5031'
    ? { chain: somniaMainnet, addresses: SOMNIA_MAINNET_ADDRESSES, collateralSymbol: 'USDso', collateralDecimals: 18 }
    : {
        chain: {
          ...somniaShannon,
          rpcUrls: {
            ...somniaShannon.rpcUrls,
            default: { ...somniaShannon.rpcUrls.default, http: [SOMNIA_SHANNON_PUBLIC_RPC_URL] },
          },
        },
        addresses: SOMNIA_TESTNET_ADDRESSES,
        collateralSymbol: 'tUSDC',
        collateralDecimals: 6,
      }
}

export type DreamDexEventReads = Pick<SomniaMarketsClient, 'getMarketOnchain' | 'getMarketStats24h' | 'quoteCreateMarketValue'> & {
  verifyNetwork(): Promise<void>
  getEventRecord(id: Hex): Promise<{ oracleQuestionId: bigint; slots: number; collateral: string; oracleAdapter: string; start: bigint; expiry: bigint; voidPolicy: number }>
}

/** Read/quote adapter only. A cost quote is deliberately not a creation or resolution receipt. */
export class DreamDexEventReader {
  readonly network: ReturnType<typeof dreamDexNetwork>
  constructor(readonly chainId: string, private readonly reads: DreamDexEventReads, private readonly now = Date.now) {
    this.network = dreamDexNetwork(chainId)
  }

  async inspect(binding: DreamDexEventBinding) {
    binding = { ...binding }
    invariant(binding.venue === 'DREAMDEX' && binding.chainId === this.chainId && /^0x[0-9a-fA-F]{64}$/.test(binding.marketId) && binding.matchId.trim().length > 0, 'WRONG_MARKET', 'Event belongs to another network or has an invalid identity.')
    invariant(Number.isSafeInteger(binding.tradingStartsAt) && Number.isSafeInteger(binding.tradingLocksAt) && binding.tradingStartsAt >= 0 && binding.tradingStartsAt < binding.tradingLocksAt && binding.tradingStartsAt % 1000 === 0 && binding.tradingLocksAt % 1000 === 0, 'INVALID_TIMING', 'Event timestamps must be whole seconds expressed in milliseconds.')
    await this.reads.verifyNetwork()
    const [record, market] = await Promise.all([this.reads.getEventRecord(binding.marketId), this.reads.getMarketOnchain(binding.marketId)])
    const same = (a: string, b: string | undefined) => a.toLowerCase() === b?.toLowerCase()
    invariant(record.slots === 2 && record.oracleQuestionId === binding.oracleQuestionId && record.voidPolicy === binding.voidPolicy && same(record.oracleAdapter, this.network.addresses.oracleHub), 'WRONG_EVENT', 'On-chain oracle question, binary outcomes, adapter, or void rules do not match the event binding.')
    invariant(same(record.collateral, this.network.addresses.collateral) && same(market.collateral, record.collateral) && market.decimals === this.network.collateralDecimals, 'INVALID_COLLATERAL', 'On-chain collateral does not match the selected network.')
    invariant(record.start * 1000n === BigInt(binding.tradingStartsAt) && record.expiry * 1000n === BigInt(binding.tradingLocksAt) && market.expiry === record.expiry, 'INVALID_TIMING', 'On-chain trading window does not match this match.')
    return { scope: { ...binding }, market, readAt: this.now() }
  }

  async volume(binding: DreamDexEventBinding): Promise<EventMarketVolume> {
    binding = { ...binding }
    await this.inspect(binding)
    // A recycled pool contains several historical markets. Query only the immutable ID.
    const stats = await this.reads.getMarketStats24h({ marketId: binding.marketId })
    invariant(stats.volume24h >= 0n && Number.isSafeInteger(stats.trades24h) && stats.trades24h >= 0, 'INVALID_VOLUME', 'Invalid indexed market volume.')
    return { matchId: binding.matchId, venue: binding.venue, chainId: binding.chainId, marketId: binding.marketId, collateralToken: this.network.addresses.collateral!, collateralSymbol: this.network.collateralSymbol, collateralDecimals: this.network.collateralDecimals, volume24h: stats.volume24h, trades24h: stats.trades24h, readAt: this.now() }
  }

  async quoteCreation(question: QuestionDefinitionInput) {
    question = structuredClone(question)
    invariant(question.validAnswers.answerType === 1 && question.validAnswers.discreteOutcomes.length === 2 && question.validAnswers.discreteOutcomes[0] === 'YES' && question.validAnswers.discreteOutcomes[1] === 'NO' && question.validAnswers.numericIntervals.length === 0 && question.validAnswers.numericDecimals === 0n, 'INVALID_OUTCOMES', 'Game events require ordered discrete YES/NO outcomes.')
    invariant(question.questionText.trim().length > 0 && question.sources.length > 0 && question.sources.every(source => [0, 1, 2].includes(source.sourceType) && /^0x(?:[0-9a-fA-F]{2})+$/.test(source.params)), 'INVALID_SOURCE', 'A game event needs an explicitly encoded oracle source; question text alone cannot bind a match.')
    invariant(question.resolutionTime > BigInt(Math.floor(this.now() / 1000)) && question.minAgreement > 0n && question.minAgreement <= BigInt(question.sources.length) && question.subcommitteeThreshold > 0n && question.subcommitteeThreshold <= question.subcommitteeSize, 'INVALID_QUESTION', 'Invalid oracle timing or agreement thresholds.')
    await this.reads.verifyNetwork()
    const requiredValue = await this.reads.quoteCreateMarketValue(question)
    invariant(requiredValue >= 0n, 'INVALID_QUOTE', 'Invalid protocol creation quote.')
    return { venue: 'DREAMDEX' as const, chainId: this.chainId, nativeSymbol: this.network.chain.nativeCurrency.symbol, requiredValue, gasIncluded: false as const, readAt: this.now() }
  }
}

/** Host supplies endpoints; no signer, key, transaction, or process environment in this adapter. */
export function createDreamDexEventReader(config: { chainId: string; indexerUrl: string; wsRpcUrl: string }) {
  const network = dreamDexNetwork(config.chainId)
  invariant(['https:', 'http:'].includes(new URL(config.indexerUrl).protocol) && ['wss:', 'ws:'].includes(new URL(config.wsRpcUrl).protocol), 'INVALID_CONFIG', 'Invalid DreamDEX endpoint protocol.')
  // Copy chain data only: SDK/host viem versions can expose incompatible optional hooks.
  const { id, name, nativeCurrency, rpcUrls, blockExplorers } = network.chain
  const exchange = new SomniaMarkets({ chain: { id, name, nativeCurrency, rpcUrls, blockExplorers }, addresses: network.addresses, indexerUrl: config.indexerUrl, wsRpcUrl: config.wsRpcUrl,
    ...(config.chainId === '50312' ? { fees: { maxFeePerGas: 10_000_000_000n, maxPriorityFeePerGas: 2_000_000_000n } } : {}),
  })
  const client = exchange.client
  const reader = new DreamDexEventReader(config.chainId, {
    getMarketOnchain: id => client.getMarketOnchain(id),
    getMarketStats24h: target => client.getMarketStats24h(target),
    quoteCreateMarketValue: question => client.quoteCreateMarketValue(question),
    async verifyNetwork() {
      const rpc = client.getViemClient()
      const [chainId, decimals] = await Promise.all([rpc.getChainId(), rpc.readContract({ address: network.addresses.collateral!, abi: erc20Abi, functionName: 'decimals' })])
      invariant(chainId === network.chain.id && decimals === network.collateralDecimals, 'WRONG_NETWORK', 'RPC chain or collateral decimals do not match the selected network.')
    },
    async getEventRecord(id) {
      const record = await client.getViemClient().readContract({ address: network.addresses.binaryModule!, abi: binaryModuleReadAbi, functionName: 'markets', args: [id] })
      return { oracleQuestionId: record[0], slots: record[1], voidPolicy: record[2], collateral: record[3], oracleAdapter: record[6], start: record[12], expiry: record[13] }
    },
  })
  return { reader, client, close: () => exchange.close() }
}
