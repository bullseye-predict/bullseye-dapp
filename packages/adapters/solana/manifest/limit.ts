import { Buffer } from 'buffer'
import { FillLog } from '@bonasa-tech/manifest-sdk'
import type { ManifestBrowserWallet } from './browser'
import { takerFee, type ManifestBinding } from './wire'
import { LIMIT_LEGS, TRADE_STEPS } from './steps'
import { MANIFEST_LOG, manifestLogBody, manifestProgramFrames } from './logs'

const SCALE=1_000_000n
const cost=(q:bigint,p:bigint)=>(q*p+SCALE-1n)/SCALE
type Level={price:bigint;quantity:bigint}
/** Quote only the next best-price segment. Re-read after each confirmed leg. */
export function nextBinaryBuy(asks:readonly Level[], oppositeBids:readonly Level[], quantity:bigint, limit:bigint) {
  const valid=(rows:readonly Level[])=>rows.filter(r=>r.quantity>0n&&r.price>0n&&r.price<SCALE).slice().sort((a,b)=>a.price<b.price?-1:a.price>b.price?1:0)
  const direct=valid(asks),complement=valid(oppositeBids.map(r=>({price:SCALE-r.price,quantity:r.quantity})))
  const route=(complement[0]?.price??SCALE)<(direct[0]?.price??SCALE)?'complete-set' as const:'direct' as const
  const ladder=route==='direct'?direct:complement, other=(route==='direct'?complement:direct)[0]?.price??SCALE
  let filled=0n,worst=0n
  for(const row of ladder){if(row.price>limit||row.price>other)break;const take=row.quantity<quantity-filled?row.quantity:quantity-filled;filled+=take;worst=row.price;if(filled===quantity)break}
  // What must be in the wallet at submission, which is not what the order costs:
  // the complete-set route mints a whole set at 1.00 per share and sells the
  // opposite leg back, so it needs the full quantity up front even though the
  // net is `maximumCost`. Mirrors binaryBuyQuote (quotes.ts) so the limit path
  // and the market path report the same requirement.
  return filled?{route,quantity:filled,price:worst,maximumCost:cost(filled,worst),upfrontCollateral:route==='complete-set'?filled:cost(filled,worst)}:null
}

/** One execute transaction, as the books stand now.
 *
 *  `maximumCost` is the whole leg at the worst level it touches, which is what
 *  the flow deposits before it sends. `fillCost` is what the leg really costs at
 *  the maker prices it takes, so the difference between them stays on the book
 *  seat and can pay for the leg after it. */
export type BuyLeg={route:'direct'|'complete-set';quantity:bigint;maximumCost:bigint;fillCost:bigint}

/**
 * The legs placeBinaryLimitBuy will send against the books as they stand.
 *
 * The same quote the loop below takes, run to exhaustion against a working copy
 * of the two ladders instead of against the chain. One entry per execute
 * transaction. A leg ends where the cheaper of the two books changes, NOT at a
 * price level: nextBinaryBuy takes every level of one ladder that beats the
 * other ladder's best price, so thirteen asks in a row are one signature and one
 * alternation between the books is two.
 *
 * The count exists only so the dialog can state it before the first wallet
 * prompt. It was previously discovered one prompt at a time, which a trader
 * cannot tell apart from a trade adding transactions behind their back.
 *
 * Pure, and an upper bound on nothing: the books can move between this walk and
 * the run, which is why the plan built from it still carries the loop ceiling.
 */
export function walkBinaryBuy(asks:readonly Level[], oppositeBids:readonly Level[], quantity:bigint, limit:bigint) {
 const direct=asks.map(row=>({...row})),opposite=oppositeBids.map(row=>({...row}))
 const legs:BuyLeg[]=[]
 let remaining=quantity
 for(let step=0;step<LIMIT_LEGS&&remaining>0n;step++){
  const next=nextBinaryBuy(direct,opposite,remaining,limit)
  if(!next)break
  remaining-=next.quantity
  // Take the fill off the ladder this leg used, cheapest level first, which is
  // the order nextBinaryBuy fills in. An opposite bid is held at its own price
  // and only ordered by its complement, so the two ladders sort opposite ways.
  const rows=next.route==='direct'
   ?direct.slice().sort((a,b)=>a.price<b.price?-1:a.price>b.price?1:0)
   :opposite.slice().sort((a,b)=>a.price>b.price?-1:a.price<b.price?1:0)
  // A direct ask is priced as it stands; an opposite bid is paid at its
  // complement, which is what the complete-set route actually costs per share.
  const paid=(price:bigint)=>next.route==='direct'?price:SCALE-price
  let take=next.quantity,fillCost=0n
  for(const row of rows){if(take<=0n)break;const off=row.quantity<take?row.quantity:take;row.quantity-=off;take-=off;fillCost+=cost(off,paid(row.price))}
  legs.push({route:next.route,quantity:next.quantity,maximumCost:next.maximumCost,fillCost})
 }
 return {legs,resting:remaining}
}

/** Match both books before posting any remainder. A changed book or incomplete
 * receipt stops the flow rather than placing a new crossed order or retrying a
 * purchase whose outcome is uncertain. Each confirmed leg is separately logged. */
export async function placeBinaryLimitBuy(wallet:ManifestBrowserWallet, selected:ManifestBinding, opposite:ManifestBinding, quantity:bigint, price:bigint) {
  if(quantity<=0n||price<=0n||price>=SCALE||selected.outcome===opposite.outcome||!selected.question.equals(opposite.question))throw Error('Invalid binary order')
  const adapter=wallet.adapter,owner=wallet.owner
  let remaining=quantity
  const signatures:string[]=[]
  for(let step=0;step<LIMIT_LEGS;step++) {
    const books=await Promise.all([adapter.readBook(selected),adapter.readBook(opposite)])
    const levels=(rows:ReturnType<typeof books[0]['bids']>)=>rows.filter(o=>!o.trader.equals(owner)).map(o=>({price:BigInt(o.price.toString())/10n**12n,quantity:BigInt(o.numBaseAtoms.toString())}))
    const next=nextBinaryBuy(levels(books[0]!.asks()),levels(books[1]!.bids()),remaining,price)
    // The opposite book's own bids are filtered out of the quote above, so a
    // route that exists on the public book can be absent here. Say which order
    // caused that and what it prices, rather than reporting no liquidity on a
    // book the trader can see a quote on.
    const ownCross=books[1]!.bids().filter(o=>o.trader.equals(owner)).map(o=>BigInt(o.price.toString())/10n**12n).filter(q=>q+price>=SCALE).reduce<bigint|undefined>((best,q)=>best===undefined||q>best?q:best,undefined)
    if(!next&&ownCross!==undefined)throw Error(`Your own ${opposite.outcome===0?'YES':'NO'} bid at ${(Number(ownCross)/10_000).toFixed(2)}¢ is the ${(Number(SCALE-ownCross)/10_000).toFixed(2)}¢ quote you are trying to take, and you cannot fill your own order. Cancel that bid first.`)
    if(next?.route==='complete-set'){
      await wallet.prepare(opposite)
      const holdings=await adapter.holdings(owner,opposite),fee=takerFee(next.quantity,opposite.bps)
      if(holdings.walletUsdc<next.quantity+fee)throw Error('This purchase needs temporary complete-set collateral in your wallet. Earlier confirmed steps remain in Activity.')
      signatures.push(await wallet.completeSetBuy(opposite,next.quantity,next.maximumCost,fee))
      remaining-=next.quantity
    } else {
      await wallet.prepare(selected)
      const qty=next?.quantity??remaining, executionPrice=next?.price??price, amount=cost(qty,executionPrice), fee=takerFee(amount,selected.bps)
      const holdings=await adapter.holdings(owner,selected), missing=amount>holdings.venueAvailableUsdc?amount-holdings.venueAvailableUsdc:0n
      if(holdings.walletUsdc<missing+fee)throw Error('Insufficient wallet collateral for the remaining order. Earlier confirmed steps remain in Activity.')
      if(missing)await wallet.send(await adapter.moveTokens(owner,selected,'USDC',missing,'deposit'),TRADE_STEPS.fundRemaining)
      // Recheck after the funding wallet prompt. No stale pre-prompt snapshot
      // may authorize resting while the opposite side has become marketable.
      if(!next){
        const oppositeBook=await adapter.readBook(opposite)
        if(oppositeBook.bids().some(o=>BigInt(o.price.toString())/10n**12n+price>=SCALE))continue
      }
      const hash=await wallet.send(await adapter.order(owner,selected,{side:'BUY',quantity:qty,priceMicros:executionPrice,lastValidSlot:0,kind:next?'IOC':'LIMIT',maxFeeAtoms:fee}),next?TRADE_STEPS.match:TRADE_STEPS.rest)
      signatures.push(hash)
      if(!next)return {signatures,matched:quantity-remaining,resting:remaining}
      const receipt=await adapter.connection.getTransaction(hash,{commitment:'confirmed',maxSupportedTransactionVersion:0})
      const logs=receipt?.meta?.logMessages
      if(!logs||receipt?.meta?.err||logs.some(l=>/truncated/i.test(l)))throw Error(`Check transaction ${hash} before continuing; its fill receipt is unavailable.`)
      let filled=0n
      for(const frame of manifestProgramFrames(logs,selected.program.toBase58())){
        const body=manifestLogBody(frame.encoded,MANIFEST_LOG.fill);if(!body)continue
        const [fill]=FillLog.deserialize(Buffer.from(body))
        if(fill.market.equals(selected.venue)&&fill.taker.equals(owner)&&fill.takerIsBuy)filled+=BigInt(fill.baseAtoms.inner.toString())
      }
      if(filled<=0n||filled>qty)throw Error(`Liquidity changed. Check transaction ${hash}; no additional order was placed.`)
      remaining-=filled
    }
    if(!remaining)return {signatures,matched:quantity,resting:0n}
  }
  throw Error('Prices changed repeatedly. Earlier confirmed purchases are in Activity; review the remaining amount before continuing.')
}
