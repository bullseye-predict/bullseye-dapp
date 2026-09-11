import BN from 'bn.js'
import { expect, test } from 'bun:test'
import { Keypair } from '@solana/web3.js'
import { FillLog, QuoteAtoms, BaseAtoms, QuoteAtomsPerBaseAtom } from '@bonasa-tech/manifest-sdk'
import { manifestCandles } from './history'
import type { ManifestBinding } from './wire'
const key = () => Keypair.generate().publicKey
const b: ManifestBinding = { question:key(), program:key(), venue:key(), mint:key(), collateral:key(), recipient:key(), bps:30, outcome:0 }
function log() {
  const [bytes] = FillLog.fromArgs({ market:b.venue, maker:key(), taker:key(), baseMint:b.mint, quoteMint:b.collateral, price:QuoteAtomsPerBaseAtom.fromArgs({ inner: new BN('500000000000000000') }), baseAtoms:BaseAtoms.fromArgs({inner:new BN(2000000)}), quoteAtoms:QuoteAtoms.fromArgs({inner:new BN(1000000)}), makerSequenceNumber:new BN(1), takerSequenceNumber:new BN(2), takerIsBuy:true, isMakerGlobal:false, padding:Array(14).fill(0) }).serialize()
  return `Program data: ${Buffer.concat([Buffer.from([58,230,242,3,75,113,4,169]),bytes]).toString('base64')}`
}
test('only the active Manifest invocation can supply chart fills', () => {
  const data = log(), foreign = key().toBase58(), program = b.program.toBase58()
  const lines = [`Program ${program} invoke [1]`, `Program ${foreign} invoke [2]`,data,`Program ${foreign} success`,data,`Program ${program} success`]
  const candles = manifestCandles(lines,b,1000)
  expect(candles).toHaveLength(1)
  expect(candles[0]?.close).toBe(500_000n)
  expect(candles[0]?.volume).toBe(2_000_000n)
  expect(manifestCandles([data],b,1000)).toHaveLength(0)
  expect(manifestCandles(lines,{...b,venue:key()},1000)).toHaveLength(0)
  expect(() => manifestCandles([...lines,'Log truncated'],b,1000)).toThrow('truncated')
})
