import {expect,test} from 'bun:test'
import {complementaryMatch} from './matching'
import {nextBinaryBuy} from './limit'
const row=(price:bigint,quantity=1_000_000n)=>({price,quantity})
test('88 YES / 60 NO is a funded match, not two persistent probabilities',()=>{
 const plan=complementaryMatch([row(880000n)],[row(600000n)],10_000_000n,30,30)!
 expect(plan.quantity).toBe(1_000_000n);expect(plan.minimumProfit).toBe(474000n)
 expect(plan.yesReturn+plan.noReturn-plan.maximumYesFee-plan.maximumNoFee).toBeGreaterThanOrEqual(plan.quantity)
})
test('matching respects capital, thinner depth and fees',()=>{
 expect(complementaryMatch([row(880000n)],[row(600000n)],100000n,30,30)?.quantity).toBe(100000n)
 expect(complementaryMatch([row(500000n)],[row(500000n)],1_000_000n,30,30)).toBeNull()
 expect(complementaryMatch([row(501000n)],[row(500000n)],1_000_000n,30,30)).toBeNull()
 expect(complementaryMatch([],[],1_000_000n,30,30)).toBeNull()
})
test('incoming NO 60 limit consumes YES 88 at NO 12 instead of resting crossed',()=>{
 expect(nextBinaryBuy([], [row(880000n)],1_000_000n,600000n)).toEqual({route:'complete-set',quantity:1_000_000n,price:120000n,maximumCost:120000n})
})
test('route segments maintain price priority across both books and respect quantity',()=>{
 const asks=[row(300000n)],bids=[row(880000n),row(500000n)]
 expect(nextBinaryBuy(asks,bids,3_000_000n,600000n)?.quantity).toBe(1_000_000n)
 expect(nextBinaryBuy(asks,[row(500000n)],2_000_000n,600000n)?.route).toBe('direct')
 expect(nextBinaryBuy([],[row(500000n)],1_000_000n,400000n)).toBeNull()
})
