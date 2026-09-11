import { createDreamDexEventReader, type DreamDexEventBinding } from '../../packages/adapters/dreamdex/event-reader'
import { atomic, integer, invariant, record, textField } from '../../packages/prediction-core/validation'
import { stringify } from '../../packages/prediction-core/serialization'

/** Separate read-only host: never feed DreamDEX records into the custom EVM matcher. */
export function parseDreamDexInspection(input: unknown) {
  const config = record(input)
  const event = record(config.binding)
  const marketId = textField(event.marketId, 'marketId')
  invariant(/^0x[0-9a-fA-F]{64}$/.test(marketId), 'INVALID_CONFIG', 'marketId must be the bytes32 DreamDEX ID, not a pool address.')
  const chainId = textField(config.chainId, 'chainId')
  const voidPolicy = integer(event.voidPolicy, 'voidPolicy', 0, 2)
  invariant(voidPolicy === 0 || voidPolicy === 2, 'INVALID_CONFIG', 'Explicit supported void policy is required.')
  const binding: DreamDexEventBinding = {
    venue: 'DREAMDEX', chainId, marketId: marketId as `0x${string}`,
    matchId: textField(event.matchId, 'matchId'),
    oracleQuestionId: atomic(event.oracleQuestionId, 'oracleQuestionId', (1n << 256n) - 1n),
    tradingStartsAt: integer(event.tradingStartsAt, 'tradingStartsAt'),
    tradingLocksAt: integer(event.tradingLocksAt, 'tradingLocksAt'),
    voidPolicy,
  }
  return { chainId, indexerUrl: textField(config.indexerUrl, 'indexerUrl', 2048), wsRpcUrl: textField(config.wsRpcUrl, 'wsRpcUrl', 2048), binding }
}

if (import.meta.main) {
  const file = Bun.argv[2]
  if (!file || file === '--help') {
    console.log('Usage: bun run inspect:dreamdex <config.json>\nRead-only check of a confirmed game-event binding and its separate network volume.\nConfig: {chainId, indexerUrl, wsRpcUrl, binding: {matchId, marketId, oracleQuestionId: "decimal", tradingStartsAt: milliseconds, tradingLocksAt: milliseconds, voidPolicy: 0|2}}\nMainnet 5031 = USDso; testnet 50312 = tUSDC. This does not create or resolve a market.')
    if (!file) process.exitCode = 1
  } else {
    try {
      const config = parseDreamDexInspection(await Bun.file(file).json())
      const { reader, close } = createDreamDexEventReader(config)
      try {
        const snapshot = await reader.inspect(config.binding)
        const volume = await reader.volume(config.binding)
        console.log(stringify({ snapshot, volume }))
      } finally { await close() }
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'DreamDEX inspection failed.')
      process.exitCode = 1
    }
  }
}
