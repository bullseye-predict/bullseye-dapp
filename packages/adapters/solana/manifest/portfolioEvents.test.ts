import { expect, test } from 'bun:test'
import BN from 'bn.js'
import { FillLog, genAccDiscriminator } from '@bonasa-tech/manifest-sdk'
import { PublicKey, Transaction, TransactionInstruction, type VersionedTransactionResponse } from '@solana/web3.js'
import { decodePortfolioEvents } from './portfolioEvents'
import type { ManifestBinding } from './wire'
const key=(n:number)=>new PublicKey(new Uint8Array(32).fill(n))
const owner=key(1),other=key(2),program=key(3),manifest=key(4)
const b:ManifestBinding={question:key(5),venue:key(6),mint:key(7),collateral:key(8),recipient:key(9),program:manifest,outcome:0,bps:30}
const instruction=new TransactionInstruction({programId:manifest,keys:[{pubkey:owner,isSigner:true,isWritable:true}],data:Buffer.from([4])})
const fill=(maker=other,taker=owner,book=b)=>{
 const log=FillLog.fromArgs({market:book.venue,maker,taker,baseMint:book.mint,quoteMint:book.collateral,price:{inner:new BN('500000000000000000')} as never,baseAtoms:{inner:new BN('10000000')} as never,quoteAtoms:{inner:new BN('5000000')} as never,makerSequenceNumber:new BN(1),takerSequenceNumber:new BN(2),takerIsBuy:true,isMakerGlobal:false,padding:new Array(14).fill(0)})
 return `Program data: ${Buffer.concat([Buffer.from(genAccDiscriminator('manifest::logs::FillLog')),log.serialize()[0]]).toString('base64')}`
}
function receipt(logs:string[]):VersionedTransactionResponse {
 const tx=new Transaction({feePayer:owner,recentBlockhash:key(10).toBase58()}).add(instruction)
 return {slot:100,blockTime:1000,transaction:{signatures:['receipt'],message:tx.compileMessage()},meta:{err:null,fee:5000,preBalances:[1,1],postBalances:[1,1],innerInstructions:[],logMessages:logs}} as unknown as VersionedTransactionResponse
}
const logs=(...entries:string[])=>[`Program ${manifest} invoke [1]`,...entries,`Program ${manifest} success`]
test('portfolio decoder keeps maker and taker executions and exact shares',()=>{
 const taker=decodePortfolioEvents(receipt(logs(fill())),owner.toBase58(),program.toBase58(),manifest.toBase58(),[b],2)
 expect(taker.find(e=>e.kind==='BUY')).toMatchObject({shares:'10000000',collateral:'5000000',price:'500000',fee:'0',transactionIndex:2})
 const maker=decodePortfolioEvents(receipt(logs(fill(owner,other))),owner.toBase58(),program.toBase58(),manifest.toBase58(),[b],2)
 expect(maker.some(e=>e.kind==='SELL')).toBe(true)
})
test('a multi-book receipt is decoded fully with unique identities',()=>{
 const second={...b,outcome:1 as const,venue:key(11),mint:key(12)}
 const rows=decodePortfolioEvents(receipt(logs(fill(),fill(other,owner,second))),owner.toBase58(),program.toBase58(),manifest.toBase58(),[b,second],0)
 expect(rows.filter(e=>e.kind==='BUY').map(e=>e.outcome)).toEqual([0,1]);expect(new Set(rows.map(e=>e.id)).size).toBe(rows.length)
})
test('truncated receipts fail coverage instead of silently dropping executions',()=>{
 expect(()=>decodePortfolioEvents(receipt(logs(fill(),'Log truncated')),owner.toBase58(),program.toBase58(),manifest.toBase58(),[b],0)).toThrow('incomplete')
})
test('self trades produce marks but no fictional buys or sells',()=>{
 const rows=decodePortfolioEvents(receipt(logs(fill(owner,owner))),owner.toBase58(),program.toBase58(),manifest.toBase58(),[b],0)
 expect(rows.map(e=>e.kind)).toEqual(['MARK'])
})

test('external CPI share transfers are recorded, while nested trading stays incomplete', async () => {
  const { base58 } = await import('@scure/base')
  const { TOKEN_PROGRAM_ID } = await import('@solana/spl-token')
  const source = key(20), destination = key(21), external = key(22)
  const tx = new Transaction({ feePayer: owner, recentBlockhash: key(10).toBase58() }).add(new TransactionInstruction({ programId: external, data: Buffer.alloc(0), keys: [source, destination, TOKEN_PROGRAM_ID, manifest].map(pubkey => ({pubkey, isSigner:false, isWritable:true})) }))
  const message = tx.compileMessage()
  const index = (address: PublicKey) => message.accountKeys.findIndex(k => k.equals(address))
  const data = Buffer.alloc(9); data[0]=3; data.writeBigUInt64LE(123456n,1)
  const r = receipt([])
  r.transaction.message = message
  r.meta!.logMessages = [`Program ${external} invoke [1]`, `Program ${external} success`]
  r.meta!.preTokenBalances = [{accountIndex:index(source),mint:b.mint.toBase58(),owner:other.toBase58(),uiTokenAmount:{amount:'123456',decimals:6,uiAmount:0.123456}}]
  r.meta!.postTokenBalances = [{accountIndex:index(destination),mint:b.mint.toBase58(),owner:owner.toBase58(),uiTokenAmount:{amount:'123456',decimals:6,uiAmount:0.123456}}]
  r.meta!.innerInstructions = [{index:0,instructions:[{programIdIndex:index(TOKEN_PROGRAM_ID),accounts:[index(source),index(destination),0],data:base58.encode(data)}]}]
  expect(decodePortfolioEvents(r,owner.toBase58(),program.toBase58(),manifest.toBase58(),[b],0)).toMatchObject([{kind:'TRANSFER_IN',shares:'123456',outcome:0}])
  r.meta!.innerInstructions[0]!.instructions.push({programIdIndex:index(manifest),accounts:[0],data:base58.encode(Buffer.from([4]))})
  expect(() => decodePortfolioEvents(r,owner.toBase58(),program.toBase58(),manifest.toBase58(),[b],0)).toThrow('Nested trading')
})
