import { decodeEventLog, encodeAbiParameters, erc20Abi, keccak256, parseAbi, stringToHex, type Address, type Hex, type WalletClient } from 'viem'
import type { QuestionDefinitionInput } from '@somnia-chain/markets-sdk'
import { createDreamDexEventReader } from './event-reader'
import type { DreamDexPublicConfig } from '../../prediction-core/market-data'

// Recovered from the deployed Shannon call, not from a guessed MarketCreated input.
// Selector 0x94f9fdc7 and byte-for-byte decode/re-encode verified against:
// 0xe9ce7423480554c1327d5060b2ea09e7ea22544c735d918347dd9f1e402d1e56
// Names are local descriptive names; canonical types match the deployed selector.
export const gameCreationAbi = parseAbi([
  'function scheduleAndCreateMarket(uint32 operatorId,bytes32 venueId,address adapter,(string questionText,(uint8 sourceType,bytes params)[] sources,(uint8 answerType,string[] discreteOutcomes,(int256 low,int256 high)[] numericIntervals,uint64 numericDecimals) validAnswers,uint256 resolutionTime,uint256 minAgreement,uint256 subcommitteeSize,uint256 subcommitteeThreshold) definition,(uint256 oracleQuestionId,address oracleAdapter,address collateral,(uint256 tickSize,uint256 minQuantity,uint256 lotSize) book,string asset,uint256 strike,uint64 tradingStart,uint64 expiry,uint64 settlementWindow,string question,uint256 referenceQuestionId,bytes context) market,(uint256 nonce,uint256 deadline,bytes signature) authorization) payable returns(uint256 oracleQuestionId,bytes32 marketId,address market)',
  // SDK 0.29 src/eventsAbi.ts binaryModuleEventsAbi (includes the pool nonce).
  'event MarketCreated(bytes32 indexed marketId,address indexed market,address indexed pool,uint256 oracleQuestionId,uint32 operatorId,bytes32 venueId,address creator,address collateral,uint256 yesId,uint256 noId,uint64 nonce,uint8 outcomeSlotCount,uint8 marketType,uint64 tradingStart,uint64 expiry,uint8 voidPolicy,string asset,uint256 strike,string question,bytes context)',
])
export const GAME_IMPLEMENTATION = '0xdf87ac5c4760e2f1dd78e054ce0629a26a4ca5ca' as const
export const GAME_IMPLEMENTATION_HASH = '0x0b8022b33d05a1b21e6034f040728570218538919c74a7e615ebbe572971115d' as const
export interface GameQuestion {
  eventId: string
  roomId: string
  agentId: string
  subjectId: string
  label: string
  sourceUrl: string
  tradingStartsAt: number
  tradingLocksAt: number
  resolutionAt: number
}

export function gameQuestionDefinition(game: GameQuestion): QuestionDefinitionInput {
  const url = new URL(game.sourceUrl)
  if (url.protocol !== 'https:' || url.username || url.password || !game.roomId || !game.agentId || !game.subjectId) throw Error('A public game result source and exact participant identities are required.')
  if (![game.tradingStartsAt, game.tradingLocksAt, game.resolutionAt].every(t => Number.isSafeInteger(t) && t % 1000 === 0) || game.tradingStartsAt >= game.tradingLocksAt || game.tradingLocksAt >= game.resolutionAt) throw Error('Invalid game creation window.')
  return {
    questionText: `${game.label} In SOLZ room ${game.roomId}, does the FINAL winner event name actor ${game.subjectId} (agent ${game.agentId}) as the winner? Answer YES only if the final winner event actorId equals ${game.subjectId}; answer NO if a final winner event names another actor. If the game is cancelled, unfinished, or has no final winner event, do not infer a winner from kills or live scores.`,
    // Prophecy's public source decoder: Website = (string url,bool useResolveUrl,uint8 decimals).
    // https://dev.oracle.somnia.host/_next/static/chunks/44o1b28fy7xvz.js
    // Website sources include question text in their key: twelve questions must NOT
    // deduplicate just because they read the same room's log URL.
    sources: [{ sourceType: 0, params: encodeAbiParameters([{ type: 'string' }, { type: 'bool' }, { type: 'uint8' }], [url.toString(), false, 0]) }],
    validAnswers: { answerType: 1, discreteOutcomes: ['YES', 'NO'], numericIntervals: [], numericDecimals: 0n },
    resolutionTime: BigInt(game.resolutionAt / 1000), minAgreement: 1n, subcommitteeSize: 3n, subcommitteeThreshold: 2n,
  }
}

export function gameCreationArgs(game: GameQuestion, operatorId: number, venueId: Hex, addresses: { oracleHub?: Address; collateral?: Address }) {
  if (!addresses.oracleHub || !addresses.collateral) throw Error('Missing DreamDEX contracts.')
  return [operatorId, venueId, addresses.oracleHub, gameQuestionDefinition(game), {
    oracleQuestionId: 0n, oracleAdapter: addresses.oracleHub, collateral: addresses.collateral,
    book: { tickSize: 1000n, minQuantity: 1_000_000n, lotSize: 1_000_000n },
    asset: game.agentId, strike: 0n, tradingStart: BigInt(game.tradingStartsAt / 1000), expiry: BigInt(game.tradingLocksAt / 1000),
    settlementWindow: 3600n, question: game.label, referenceQuestionId: 0n,
    context: stringToHex(JSON.stringify({ version: 1, eventId: game.eventId, roomId: game.roomId, agentId: game.agentId, subjectId: game.subjectId })),
  }, { nonce: 0n, deadline: 0n, signature: '0x' as Hex }] as const
}

/** Admin sponsors creation only. User approvals, orders and positions stay in their wallet. */
export class DreamDexGameCreator {
  readonly resources: ReturnType<typeof createDreamDexEventReader>
  constructor(readonly config: DreamDexPublicConfig, readonly wallet: WalletClient, readonly operatorId: number, readonly venueId: Hex) {
    if (config.chainId !== '50312') throw Error('Game demo creation is Shannon-only.')
    this.resources = createDreamDexEventReader(config)
  }
  close() { return this.resources.close() }
  async verifyImplementation() {
    const rpc = this.resources.client.getViemClient()
    const slot = await rpc.getStorageAt({ address: this.resources.reader.network.addresses.binaryModule!, slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc' })
    if (await rpc.getChainId() !== 50312 || slot?.slice(-40).toLowerCase() !== GAME_IMPLEMENTATION.slice(2)) throw Error('DreamDEX implementation changed; creation codec needs revalidation.')
    const code = await rpc.getCode({ address: GAME_IMPLEMENTATION })
    if (!code || keccak256(code) !== GAME_IMPLEMENTATION_HASH) throw Error('DreamDEX implementation bytecode changed.')
  }
  async prepare(game: GameQuestion) {
    await this.verifyImplementation()
    const rpc = this.resources.client.getViemClient(), addresses = this.resources.reader.network.addresses
    const now = Number((await rpc.getBlock()).timestamp) * 1000
    if (game.tradingLocksAt <= now + 60_000) throw Error('Too late to open this game question. Wait for the next match.')
    const args = gameCreationArgs(game, this.operatorId, this.venueId, addresses)
    const value = await this.resources.client.quoteCreateMarketValue(args[3])
    if (value > 3_000_000_000_000_000_000n) throw Error('Creation exceeds the 3 test SOMI per-question budget.')
    const account = this.wallet.account ?? (await this.wallet.getAddresses())[0]!
    const owner = typeof account === 'string' ? account : account.address
    if (await rpc.getBalance({ address: owner }) < value + 1_000_000_000_000_000_000n) throw Error('The demo sponsor needs more test SOMI for creation and gas.')
    const simulation = await rpc.simulateContract({ address: addresses.binaryModule!, abi: gameCreationAbi, functionName: 'scheduleAndCreateMarket', args, value, account: account as never, gas: 100_000_000n })
    return { request: simulation.request, value }
  }
  async create(game: GameQuestion, beforeSend: () => void, submitted: (hash: Hex) => void) {
    const prepared = await this.prepare(game)
    beforeSend()
    const hash = await this.wallet.writeContract(prepared.request as never)
    submitted(hash)
    return { hash, market: await this.confirm(game, hash) }
  }
  async seed(marketId: Hex) {
    await this.verifyImplementation()
    const client = this.resources.client, rpc = client.getViemClient(), account = this.wallet.account
    if (!account) throw Error('The demo liquidity sponsor must be a server-side signer.')
    const market = await client.getMarketOnchain(marketId)
    if (market.status !== 1 || market.expiry <= (await rpc.getBlock()).timestamp) throw Error('The game is closed to new liquidity.')
    if ((await client.getOwnOpenOrdersOnchain(market.pool, account.address)).length) return
    const quantity = 10_000_000n
    if (await rpc.readContract({ address: market.collateral, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] }) < quantity) throw Error('The demo sponsor needs tUSDC for starter liquidity.')
    const approval = await this.wallet.writeContract({ address: market.collateral, abi: erc20Abi, functionName: 'approve', args: [market.pool, quantity], account, chain: this.wallet.chain })
    if ((await rpc.waitForTransactionReceipt({ hash: approval })).status !== 'success') throw Error('Starter liquidity approval failed.')
    const trader = client.createTrader({ walletClient: this.wallet as never, account: account as never, publicClient: rpc, gas: 50_000_000n })
    const mint = await trader.mintSet({ pool: market.pool, collateral: market.collateral, amount: quantity, autoApprove: false })
    if (mint.receipt.status !== 'success') throw Error('Starter liquidity mint failed.')
    for (const side of ['SELL_YES', 'SELL_NO'] as const) {
      const order = await trader.placeOrder({ pool: market.pool, side, price: side === 'SELL_YES' ? 550_000n : 450_000n, quantity, expireTimestampNs: market.expiry * 1_000_000_000n, orderType: 0, collateral: market.collateral, outcomeToken: market.outcomeToken, yesId: market.yesId, noId: market.noId })
      if (order.receipt.status !== 'success' || order.orderId === undefined) throw Error('Starter liquidity did not rest on the book.')
    }
  }
  async confirm(game: GameQuestion, hash: Hex): Promise<DreamDexPublicConfig['markets'][number]> {
    const receipt = await this.resources.client.getViemClient().waitForTransactionReceipt({ hash })
    if (receipt.status !== 'success') throw Error(`Game creation reverted: ${hash}`)
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== this.resources.reader.network.addresses.binaryModule!.toLowerCase()) continue
      let event
      try { event = decodeEventLog({ abi: gameCreationAbi, eventName: 'MarketCreated', data: log.data, topics: log.topics }) } catch { continue }
      const a = event.args
      if (a.operatorId !== this.operatorId || a.venueId !== this.venueId || a.question !== game.label || a.asset !== game.agentId || a.outcomeSlotCount !== 2 || a.voidPolicy !== 0) throw Error('Creation receipt does not match the game request.')
      const market = { eventId: game.eventId, questionId: `winner-${game.agentId}`, subjectId: game.agentId, label: game.label, marketId: a.marketId, oracleQuestionId: a.oracleQuestionId.toString(), tradingStartsAt: Number(a.tradingStart) * 1000, tradingLocksAt: Number(a.expiry) * 1000, voidPolicy: 0 as const }
      await this.resources.reader.inspect({ venue: 'DREAMDEX', chainId: '50312', matchId: game.eventId, ...market, oracleQuestionId: a.oracleQuestionId })
      return market
    }
    throw Error(`Creation confirmed without the expected event: ${hash}. Do not resubmit.`)
  }
}
