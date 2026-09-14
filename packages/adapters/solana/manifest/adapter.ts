import './runtime'
import BN from 'bn.js'
import { Connection, PublicKey, Transaction } from '@solana/web3.js'
import { getAssociatedTokenAddressSync, unpackAccount, unpackMint } from '@solana/spl-token'
import { createBatchUpdateInstruction, createClaimSeatInstruction, createSwapInstruction, Market as ManifestMarket, OrderType } from '@bonasa-tech/manifest-sdk'
import { decodeConfig, decodeMarket, decodePosition, decodeVault } from '../accounts'
import { configAddress, positionAddress, TOKEN_PROGRAM_ID, u64, vaultAddress } from '../wire'
import { bindingAddress, decodeBinding, freezeAuthority, guarded, tokenMovement, venueVault, type ManifestBinding, type Outcome } from './wire'

export interface ManifestDeployment { genesisHash: string; predictionProgram: PublicKey; manifestProgram: PublicKey; collateralMint: PublicKey }
export const MANIFEST_CAPABILITIES = Object.freeze({ matching: 'onchain', offchainMatcher: false, cutoff: 'onchain-timestamp-and-prediction-lock', platformFee: 'immutable-taker-quote-notional', globalOrders: false, reverseOrders: false, agentSigning: false, independentReviewComplete: false })
export class ManifestAdapter {
  constructor(readonly connection: Connection, readonly deployment: ManifestDeployment) {
    if (deployment.manifestProgram.toBase58()==='MNFSTqtC93rEfYHB6hF82sKdZpUDFWkViLByLd1k1Ms' || deployment.manifestProgram.equals(deployment.predictionProgram)) throw new Error('A separate guarded Manifest deployment is required')
  }
  private verified?: Promise<Awaited<ReturnType<ManifestAdapter['runVerifyDeployment']>>>
  /** The deployment cannot change under a live client, so verify once and reuse.
   *  This previously re-ran on every binding() call, which made one order-book
   *  poll cost two extra round trips per outcome and put the browser straight
   *  into RPC 429s. A failure is not cached. */
  verifyDeployment() {
    return this.verified ??= this.runVerifyDeployment().catch(error => { this.verified = undefined; throw error })
  }
  private async runVerifyDeployment() {
    if (await this.connection.getGenesisHash()!==this.deployment.genesisHash) throw new Error('Wrong Solana genesis identity')
    const keys=[this.deployment.predictionProgram,this.deployment.manifestProgram,configAddress(this.deployment.predictionProgram)]
    const records=await this.connection.getMultipleAccountsInfo(keys,'confirmed')
    if (!records[0]?.executable || !records[1]?.executable || !records[2]) throw new Error('Programs or prediction config are not deployed')
    const config=decodeConfig({...records[2],address:keys[2]!},this.deployment.predictionProgram)
    if (!config.mint.equals(this.deployment.collateralMint)) throw new Error('Wrong configured collateral')
    return config
  }
  async binding(question: PublicKey,outcome: Outcome): Promise<ManifestBinding> {
    await this.verifyDeployment()
    const address=bindingAddress(this.deployment.predictionProgram,question,outcome)
    const record=await this.connection.getAccountInfo(address,'confirmed')
    if (!record) throw new Error('Question is not activated for Manifest')
    const b=decodeBinding(this.deployment.predictionProgram,address,record.owner,record.data)
    if (!b.program.equals(this.deployment.manifestProgram)||!b.collateral.equals(this.deployment.collateralMint)) throw new Error('Wrong Manifest deployment binding')
    return b
  }
  /** Many bindings in one round trip. `binding()` costs one getAccountInfo, so a
   *  twelve-question event priced one outcome at a time was 24 sequential reads
   *  and a rate limit; this is one request. Entries that are missing or fail
   *  validation come back null rather than throwing, because an unactivated
   *  outcome is the normal pre-first-trade state and must not blank its siblings. */
  async bindings(requests: readonly { question: PublicKey; outcome: Outcome }[]): Promise<(ManifestBinding|null)[]> {
    if (!requests.length) return []
    await this.verifyDeployment()
    const keys=requests.map(r=>bindingAddress(this.deployment.predictionProgram,r.question,r.outcome))
    const records=await this.accounts(keys)
    return records.map((record,index)=>{
      if(!record)return null
      try{
        const b=decodeBinding(this.deployment.predictionProgram,keys[index]!,record.owner,record.data)
        return b.program.equals(this.deployment.manifestProgram)&&b.collateral.equals(this.deployment.collateralMint)?b:null
      }catch{return null}
    })
  }
  /** The book accounts for many bindings in one round trip, with the same owner
   *  and asset assertions readBook() makes. Null for an unreadable book. */
  async books(bindings: readonly (ManifestBinding|null)[]): Promise<(ManifestMarket|null)[]> {
    const present=bindings.map((b,index)=>({b,index})).filter((entry): entry is {b:ManifestBinding;index:number}=>entry.b!==null)
    if(!present.length)return bindings.map(()=>null)
    const records=await this.accounts(present.map(entry=>entry.b.venue))
    const result: (ManifestMarket|null)[]=bindings.map(()=>null)
    present.forEach((entry,position)=>{
      const record=records[position]
      if(!record?.owner.equals(this.deployment.manifestProgram))return
      try{
        const book=ManifestMarket.loadFromBuffer({address:entry.b.venue,buffer:record.data})
        if(!book.baseMint().equals(entry.b.mint)||!book.quoteMint().equals(entry.b.collateral)||book.baseDecimals()!==6||book.quoteDecimals()!==6)return
        result[entry.index]=book
      }catch{/* A book that cannot be decoded reads as absent, never as empty. */}
    })
    return result
  }
  /** web3.js turns a >100-key read into a JSON-RPC batch, which public Solana
   *  endpoints reject outright. Chunk so every request stays singular. */
  private async accounts(keys: readonly PublicKey[]) {
    const out: Awaited<ReturnType<Connection['getMultipleAccountsInfo']>>=[]
    for(let offset=0;offset<keys.length;offset+=96) out.push(...await this.connection.getMultipleAccountsInfo(keys.slice(offset,offset+96) as PublicKey[],'confirmed'))
    return out
  }
  private async validate(b: ManifestBinding,trading: boolean) {
    const current=await this.binding(b.question,b.outcome)
    if (!current.venue.equals(b.venue)||!current.mint.equals(b.mint)||!current.recipient.equals(b.recipient)||current.bps!==b.bps) throw new Error('Binding changed')
    const keys=[b.question,b.mint,b.collateral]
    const records=await this.connection.getMultipleAccountsInfo(keys,'confirmed')
    if (records.some(r=>!r)) throw new Error('Question or claim mint missing')
    const q=decodeMarket({...records[0]!,address:b.question},this.deployment.predictionProgram)
    const mint=unpackMint(b.mint,records[1]!,TOKEN_PROGRAM_ID),quote=unpackMint(b.collateral,records[2]!,TOKEN_PROGRAM_ID)
    if(!q.manifestGuarded||q.outcomeCount!==2||!q.mint.equals(b.collateral)||mint.decimals!==6||quote.decimals!==6||!mint.mintAuthority?.equals(b.question)||!mint.freezeAuthority?.equals(freezeAuthority(b.program))) throw new Error('Invalid guarded claims')
    if(trading){
      const config=await this.verifyDeployment()
      const now=await this.connection.getBlockTime(await this.connection.getSlot('confirmed'))
      if(now===null||config.paused||q.paused||q.status>1||BigInt(now)<q.startsAtSeconds||BigInt(now)>=q.locksAtSeconds) throw new Error('Question is closed to trading')
    }
    return q
  }
  async readBook(b: ManifestBinding) {
    const r=await this.connection.getAccountInfo(b.venue,'confirmed')
    if(!r?.owner.equals(this.deployment.manifestProgram))throw new Error('Wrong orderbook owner')
    const book=ManifestMarket.loadFromBuffer({address:b.venue,buffer:r.data})
    if(!book.baseMint().equals(b.mint)||!book.quoteMint().equals(b.collateral)||book.baseDecimals()!==6||book.quoteDecimals()!==6)throw new Error('Wrong orderbook assets')
    return book
  }
  async moveTokens(owner:PublicKey,b:ManifestBinding,asset:'claims'|'USDC',atoms:bigint,direction:'deposit'|'withdraw'){
    await this.validate(b,direction==='deposit')
    const book=await this.readBook(b),tx=new Transaction()
    if(direction==='deposit'&&!book.hasSeat(owner))tx.add(guarded(this.deployment.predictionProgram,owner,b,createClaimSeatInstruction({payer:owner,market:b.venue},b.program),0n))
    return tx.add(guarded(this.deployment.predictionProgram,owner,b,tokenMovement(owner,b,asset,atoms,direction),0n))
  }
  async order(owner:PublicKey,b:ManifestBinding,input:{side:'BUY'|'SELL';quantity:bigint;priceMicros:bigint;lastValidSlot:number;kind:'LIMIT'|'IOC'|'POST_ONLY';maxFeeAtoms:bigint}){
    u64(input.quantity)
    if(input.quantity<=0n||input.priceMicros<=0n||input.priceMicros>=1_000_000n||!['BUY','SELL'].includes(input.side)||!Number.isInteger(input.lastValidSlot)||input.lastValidSlot<0||input.lastValidSlot>0xffff_ffff)throw new RangeError('Invalid order terms')
    const orderType={LIMIT:OrderType.Limit,IOC:OrderType.ImmediateOrCancel,POST_ONLY:OrderType.PostOnly}[input.kind]
    if(orderType===undefined)throw new Error('Unsupported order type')
    await this.validate(b,true);await this.readBook(b)
    return new Transaction().add(guarded(this.deployment.predictionProgram,owner,b,createBatchUpdateInstruction({payer:owner,market:b.venue},{params:{traderIndexHint:null,cancels:[],orders:[{baseAtoms:new BN(input.quantity.toString()),priceMantissa:Number(input.priceMicros),priceExponent:-6,isBid:input.side==='BUY',lastValidSlot:input.lastValidSlot,orderType}]}},b.program),input.maxFeeAtoms))
  }
  async cancel(owner:PublicKey,b:ManifestBinding,sequences:bigint[]){
    if(sequences.length<1||sequences.length>20)throw new RangeError('Cancel 1–20 orders per transaction')
    sequences.forEach(u64);await this.validate(b,false);await this.readBook(b)
    const core=createBatchUpdateInstruction({payer:owner,market:b.venue},{params:{traderIndexHint:null,cancels:sequences.map(n=>({orderSequenceNumber:new BN(n.toString()),orderIndexHint:null})),orders:[]}},b.program)
    return new Transaction().add(guarded(this.deployment.predictionProgram,owner,b,core,0n))
  }
  async swap(owner:PublicKey,b:ManifestBinding,input:{side:'BUY'|'SELL';inputAtoms:bigint;minimumOutputAtoms:bigint;maxFeeAtoms:bigint}){
    u64(input.inputAtoms);u64(input.minimumOutputAtoms)
    if(input.inputAtoms<=0n||input.minimumOutputAtoms<=0n||!['BUY','SELL'].includes(input.side))throw new RangeError('Positive input and output bound required')
    await this.validate(b,true);await this.readBook(b)
    const core=createSwapInstruction({payer:owner,market:b.venue,traderBase:getAssociatedTokenAddressSync(b.mint,owner),traderQuote:getAssociatedTokenAddressSync(b.collateral,owner),baseVault:venueVault(b.program,b.venue,b.mint),quoteVault:venueVault(b.program,b.venue,b.collateral),tokenProgramBase:TOKEN_PROGRAM_ID,baseMint:b.mint,tokenProgramQuote:TOKEN_PROGRAM_ID,quoteMint:b.collateral},{params:{inAtoms:new BN(input.inputAtoms.toString()),outAtoms:new BN(input.minimumOutputAtoms.toString()),isBaseIn:input.side==='SELL',isExactIn:true}},b.program)
    return new Transaction().add(guarded(this.deployment.predictionProgram,owner,b,core,input.maxFeeAtoms))
  }
  /** Exact custody locations; do not add market collateral backing to holdings. */
  async holdings(owner:PublicKey,b:ManifestBinding){
    await this.validate(b,false)
    const book=await this.readBook(b),seat=book.claimedSeats().find(s=>s.publicKey.equals(owner))
    const asks=book.asks().filter(o=>o.trader.equals(owner)),bids=book.bids().filter(o=>o.trader.equals(owner))
    const atoms=(n:{toString():string})=>BigInt(n.toString()),scale=10n**18n
    const reservedClaims=asks.reduce((sum,o)=>sum+atoms(o.numBaseAtoms),0n)
    const reservedUsdc=bids.reduce((sum,o)=>sum+(atoms(o.numBaseAtoms)*atoms(o.price)+scale-1n)/scale,0n)
    const vault=vaultAddress(this.deployment.predictionProgram,owner)
    const keys=[getAssociatedTokenAddressSync(b.mint,owner),getAssociatedTokenAddressSync(b.collateral,owner),positionAddress(this.deployment.predictionProgram,b.question,vault),vault]
    const records=await this.connection.getMultipleAccountsInfo(keys,'confirmed')
    const token=(i:number)=>records[i]?unpackAccount(keys[i]!,records[i]!,TOKEN_PROGRAM_ID).amount:0n
    const internalClaims=records[2]?decodePosition({...records[2],address:keys[2]!},this.deployment.predictionProgram).balances[b.outcome]!:0n
    const availableClaims=seat?atoms(seat.baseBalance):0n
    return {walletClaims:token(0),venueAvailableClaims:availableClaims,venueReservedClaims:reservedClaims,internalClaims,totalClaims:token(0)+availableClaims+reservedClaims+internalClaims,walletUsdc:token(1),venueAvailableUsdc:seat?atoms(seat.quoteBalance):0n,venueReservedUsdc:reservedUsdc,sharedPredictionVaultUsdc:records[3]?decodeVault({...records[3],address:keys[3]!},this.deployment.predictionProgram).available:0n}
  }
}
