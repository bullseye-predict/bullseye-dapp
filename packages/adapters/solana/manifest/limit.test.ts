import {expect,test} from 'bun:test'
import {Keypair,Transaction} from '@solana/web3.js'
import BN from 'bn.js'
import {FillLog} from '@bonasa-tech/manifest-sdk'
import {MANIFEST_LOG} from './logs'
import {placeBinaryLimitBuy,walkBinaryBuy} from './limit'
import {LIMIT_LEGS} from './steps'
import type {ManifestBrowserWallet} from './browser'
function fixture(){
 const k=()=>Keypair.generate().publicKey,owner=k(),maker=k(),question=k(),program=k(),collateral=k(),recipient=k()
 const yes={question,program,collateral,recipient,venue:k(),mint:k(),bps:30,outcome:0 as const},no={...yes,venue:k(),mint:k(),outcome:1 as const}
 let phase=0,missingReceipt=false,selfBid=false
 const orders:{kind:string;quantity:bigint}[]=[],comp:bigint[]=[]
 const row=(price:bigint,trader=maker)=>({trader,price:price*10n**12n,numBaseAtoms:1_000_000n})
 const wallet={owner,prepare:async()=>undefined,completeSetBuy:async(_b:unknown,q:bigint)=>{comp.push(q);phase++;return 'complement'},send:async()=>{phase++;return 'direct'},adapter:{
   readBook:async(b:{outcome:0|1})=>({asks:()=>b.outcome===0&&phase===1?[row(300000n)]:[],bids:()=>b.outcome===1&&phase===0?[row(880000n,selfBid?owner:maker)]:[]}),
   holdings:async()=>({walletUsdc:100_000_000n,venueAvailableUsdc:100_000_000n}),
   order:async(_owner:unknown,_b:unknown,input:{kind:string;quantity:bigint})=>{orders.push(input);return new Transaction()},
   connection:{getTransaction:async()=>missingReceipt?null:{meta:{err:null,logMessages:[`Program ${program} invoke [1]`, `Program data: ${Buffer.concat([MANIFEST_LOG.fill,FillLog.fromArgs({market:yes.venue,maker,taker:owner,baseMint:yes.mint,quoteMint:collateral,price:{inner:new BN('300000000000000000')} as never,baseAtoms:{inner:new BN(1000000)} as never,quoteAtoms:{inner:new BN(300000)} as never,makerSequenceNumber:new BN(1),takerSequenceNumber:new BN(2),takerIsBuy:true,isMakerGlobal:false,padding:Array(14).fill(0)}).serialize()[0]]).toString('base64')}`,`Program ${program} success`]}}},
 }} as unknown as ManifestBrowserWallet
 return {wallet,yes,no,orders,comp,missing:()=>{missingReceipt=true},self:()=>{selfBid=true}}
}
test('limit order consumes complementary depth then direct asks before resting the remainder',async()=>{
 const f=fixture(),result=await placeBinaryLimitBuy(f.wallet,f.yes,f.no,3_000_000n,600000n)
 expect(f.comp).toEqual([1_000_000n]);expect(f.orders.map(o=>[o.kind,o.quantity])).toEqual([['IOC',1_000_000n],['LIMIT',1_000_000n]])
 expect(result.matched).toBe(2_000_000n);expect(result.resting).toBe(1_000_000n)
})
test('missing confirmed fill details stop before any additional order can be posted',async()=>{
 const f=fixture();f.missing()
 await expect(placeBinaryLimitBuy(f.wallet,f.yes,f.no,3_000_000n,600000n)).rejects.toThrow('receipt is unavailable')
 expect(f.orders).toHaveLength(1)
})
test('a wallet cannot leave a crossed bid against its own opposite order',async()=>{
 const f=fixture();f.self()
 // Naming the resting bid and the quote it produces is the point: the public
 // book still shows a 12¢ NO ask, so "no liquidity" would contradict the screen.
 await expect(placeBinaryLimitBuy(f.wallet,f.yes,f.no,3_000_000n,600000n)).rejects.toThrow('Your own NO bid at 88.00¢ is the 12.00¢ quote')
 expect(f.orders).toHaveLength(0);expect(f.comp).toHaveLength(0)
})

const level=(cents:number,shares:number)=>({price:BigInt(cents*10_000),quantity:BigInt(shares)*1_000_000n})

/**
 * A leg is not a price level.
 *
 * nextBinaryBuy takes every level of one ladder that beats the other ladder's
 * best price, so a long run of asks is ONE signature. The dialog used to say "a
 * limit order signs once per price level it takes", which predicted thirteen
 * transactions for the ladder below and two for the book that really does cost
 * more — exactly backwards.
 */
test('a ladder on one book is one leg, however many rungs it has',()=>{
 // 2 shares at each of 44c through 56c, no opposite bids, a 50c limit.
 const asks=[44,45,46,47,48,49,50,51,52,53,54,55,56].map(cents=>level(cents,2))
 const run=walkBinaryBuy(asks,[],1_000_000_000n,500_000n)
 expect(run.legs).toHaveLength(1)
 expect(run.legs[0]!.route).toBe('direct')
 // Seven rungs at or under the limit, two shares each.
 expect(run.legs[0]!.quantity).toBe(14_000_000n)
 // The remainder rests, which is the second and last signature.
 expect(run.resting).toBe(986_000_000n)
})

test('a leg ends where the cheaper book changes, and the walk counts each one',()=>{
 // Alternating: the opposite bid at 53c complements to 47c, which beats the 48c
 // ask; the 49c ask then beats the next bid's 51c complement, and so on.
 const asks=[48,49,52].map(cents=>level(cents,10))
 const bids=[53,51].map(cents=>level(cents,10))
 const run=walkBinaryBuy(asks,bids,100_000_000n,600_000n)
 expect(run.legs.map(leg=>leg.route)).toEqual(['complete-set','direct','complete-set','direct'])
 expect(run.legs.reduce((total,leg)=>total+leg.quantity,0n)).toBe(50_000_000n)
 expect(run.resting).toBe(50_000_000n)
})

test('the walk stops at the same ceiling the loop does',()=>{
 // Enough alternation to outrun the loop. It reports the legs it can send, not
 // every leg the books could theoretically support.
 const asks=Array.from({length:20},(_,i)=>level(20+2*i,1))
 const bids=Array.from({length:20},(_,i)=>level(79-2*i,1))
 expect(walkBinaryBuy(asks,bids,100_000_000n,900_000n).legs.length).toBeLessThanOrEqual(LIMIT_LEGS)
})

test('books with nothing inside the limit are one resting order',()=>{
 const run=walkBinaryBuy([level(70,10)],[],5_000_000n,500_000n)
 expect(run.legs).toHaveLength(0)
 expect(run.resting).toBe(5_000_000n)
})
