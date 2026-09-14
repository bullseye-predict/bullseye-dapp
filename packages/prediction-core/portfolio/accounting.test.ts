import { describe, expect, test } from 'bun:test'
import { replayPortfolio } from './accounting'
import { parsePresentation, type PortfolioEvent } from './model'
const unit=1_000_000n
const e=(n:number,kind:PortfolioEvent['kind'],fields:Partial<PortfolioEvent>={}):PortfolioEvent=>({id:String(n),signature:String(n),slot:n,transactionIndex:0,index:0,at:n*1000,owner:'alice',marketId:'market',outcome:0,kind,finality:'finalized',...fields})
const trade=(n:number,kind:'BUY'|'SELL',shares:number,price:number,fee=0)=>e(n,kind,{shares:(BigInt(shares)*unit).toString(),price:String(price),collateral:(BigInt(shares)*BigInt(price)).toString(),fee:String(fee)})
describe('portfolio accounting',()=>{
 test('weighted entries, partial disposal and actual fees preserve cost',()=>{
  const a=replayPortfolio([trade(1,'BUY',10,400000,1000),trade(2,'BUY',10,600000,1000),trade(3,'SELL',5,800000,1000)])
  expect(a.positions[0]).toMatchObject({quantity:'15000000',costBasis:'7501500',average:'500100',realized:'1498500',pnl:'4498500'})
  expect(a.points.at(-1)?.value).toBe('5997000')
 })
 test('orders do not mark prices or create holdings and funding is not profit',()=>{
  const a=replayPortfolio([trade(1,'BUY',10,400000),e(2,'ORDER',{price:'900000',shares:'100000000'}),e(3,'DEPOSIT',{collateral:'500000000'}),e(4,'CUSTODY',{shares:'10000000'})])
  expect(a.positions[0]?.current).toBe('400000');expect(a.points.at(-1)?.value).toBe('0')
 })
 test('external transfers enter and leave at contemporaneous marks',()=>{
  const a=replayPortfolio([e(1,'MARK',{price:'400000'}),e(2,'TRANSFER_IN',{shares:'10000000'}),e(3,'MARK',{price:'600000'}),e(4,'TRANSFER_OUT',{shares:'5000000'})])
  expect(a.positions[0]).toMatchObject({costBasis:'2000000',realized:'1000000',pnl:'1000000'});expect(a.points.at(-1)?.value).toBe('2000000')
 })
 test('unknown acquisition remains unknown even when a later mark exists',()=>{
  const a=replayPortfolio([e(1,'TRANSFER_IN',{shares:'10000000'}),e(2,'MARK',{price:'900000'})]);expect(a.positions[0]?.costBasis).toBeNull();expect(a.points.at(-1)?.value).toBeNull()
 })
 test('split and merge conserve collateral with atomic dust',()=>{
  const a=replayPortfolio([e(1,'SPLIT',{outcome:undefined,shares:'3',collateral:'3'}),e(2,'MERGE',{outcome:undefined,shares:'3',collateral:'3'})]);expect(a.positions.map(p=>p.realized)).toEqual(['0','0']);expect(a.points.at(-1)?.value).toBe('0')
 })
 test('claim redeems vault shares only and uses the receipt payment',()=>{
  const a=replayPortfolio([e(1,'SPLIT',{outcome:undefined,shares:'10000000',collateral:'10000000'}),e(2,'CUSTODY',{shares:'5000000',vaultChange:'-5000000'}),e(3,'SETTLEMENT',{price:'1000000'}),e(4,'SETTLEMENT',{outcome:1,price:'0'}),e(5,'CLAIM',{outcome:undefined,collateral:'5000000'})]);expect(a.positions[0]).toMatchObject({quantity:'5000000',realized:'2500000'});expect(a.positions[1]).toMatchObject({quantity:'0',realized:'-5000000'});expect(a.points.at(-1)?.value).toBe('0')
 })
 test('void refund dust reconciles exactly',()=>{
  const a=replayPortfolio([e(1,'SPLIT',{outcome:undefined,shares:'3',collateral:'3'}),e(2,'SETTLEMENT',{price:'500000'}),e(3,'SETTLEMENT',{outcome:1,price:'500000'}),e(4,'CLAIM',{outcome:undefined,collateral:'3'})]);expect(a.points.at(-1)?.value).toBe('0')
 })
 test('deduplicates, ignores unfinalized and sorts same-slot transactions',()=>{
  const buy=trade(1,'BUY',10,400000),sell={...trade(1,'SELL',5,600000),id:'sell',signature:'sell',transactionIndex:1}
  const a=replayPortfolio([sell,buy,buy,{...trade(2,'BUY',99,500000),finality:'confirmed'}]);expect(a.positions[0]?.quantity).toBe('5000000')
 })
 test('incomplete coverage never invents a zero P/L curve',()=>{const a=replayPortfolio([trade(1,'BUY',10,400000)],6,false);expect(a.complete).toBe(false);expect(a.points[0]?.value).toBeNull()})
 test('presentation retains explicit contract mapping for every category',()=>{
  expect(parsePresentation({kind:'linked',outcomes:[{id:0,label:'Yes'},{id:1,label:'No'}]})?.outcomes.map(o=>o.label)).toEqual(['Yes','No'])
  for(const [kind,a,b] of [['head-to-head','Team A','Team B'],['general','Over','Under']])expect(parsePresentation({kind,outcomes:[{id:0,label:a},{id:1,label:b}]})?.outcomes.map(o=>o.label)).toEqual([a,b])
  expect(parsePresentation({kind:'head-to-head',outcomes:[{id:1,label:'A'},{id:0,label:'B'}]})).toBeUndefined()
 })
})
