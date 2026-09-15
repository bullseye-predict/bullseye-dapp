/** Reproduce a public order book on an isolated validator. No upstream signing. */
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js'
import { getAccount, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import type { ISolana } from '@dynamic-labs/solana-core'
import { ManifestAdapter } from '../../packages/adapters/solana/manifest/adapter'
import { ManifestBrowserWallet } from '../../packages/adapters/solana/manifest/browser'
import { manifestConnection } from '../../packages/adapters/solana/manifest/rpc'
import { buildComplementaryMatch, readComplementaryMatch } from '../../packages/adapters/solana/manifest/matching'
import { placeBinaryLimitBuy } from '../../packages/adapters/solana/manifest/limit'
import { binaryQuotes } from '../../packages/adapters/solana/manifest/quotes'
import { bindingAddress, manifestConfigAddress, venueVault } from '../../packages/adapters/solana/manifest/wire'
import { configAddress, marketCollateralAddress } from '../../packages/adapters/solana/wire'
const option = (name:string) => { const i=process.argv.indexOf(name); if(i<0 || !process.argv[i+1])throw Error(`${name} is required`);return process.argv[i+1]! }
const cfg=await Bun.file(option('--public-config')).json()
const venue=cfg.venues.find((v:{family:string})=>v.family==='SOLANA')
const deployment={predictionProgram:new PublicKey(venue.programId),manifestProgram:new PublicKey(venue.manifestProgramId),collateralMint:new PublicKey(venue.collateralToken),genesisHash:venue.chainId}
const source=new ManifestAdapter(manifestConnection(venue.publicRpcUrl),deployment)
const question=new PublicKey(option('--question'))
const yes=await source.binding(question,0),no=await source.binding(question,1)
const addresses=[configAddress(deployment.predictionProgram),manifestConfigAddress(deployment.predictionProgram),question,marketCollateralAddress(deployment.predictionProgram,question),deployment.collateralMint,...[yes,no].flatMap(b=>[bindingAddress(deployment.predictionProgram,question,b.outcome),b.mint,b.venue,venueVault(b.program,b.venue,b.mint),venueVault(b.program,b.venue,b.collateral),getAssociatedTokenAddressSync(b.collateral,b.recipient)])]
const unique=[...new Map(addresses.map(k=>[k.toBase58(),k])).values()]
const records=await source.connection.getMultipleAccountsInfo(unique,'confirmed')
const dir=await mkdtemp(join(tmpdir(),'solz-binary-local-'))
const args:string[]=[]
async function genesis(address:PublicKey, account:{lamports:number;owner:PublicKey;data:Buffer;executable:boolean}) {
  const path=join(dir,`${address.toBase58()}.json`)
  await writeFile(path,JSON.stringify({pubkey:address.toBase58(),account:{...account,owner:account.owner.toBase58(),data:[account.data.toString('base64'),'base64'],rentEpoch:0}}))
  args.push('--account',address.toBase58(),path)
}
for(let i=0;i<unique.length;i++)if(records[i])await genesis(unique[i]!,{...records[i]!,lamports:Math.max(records[i]!.lamports,1_000_000_000)})
const operator=Keypair.generate(),maker=Keypair.generate()
for(const user of [operator,maker]) {
  await genesis(user.publicKey,{lamports:20_000_000_000,owner:SystemProgram.programId,data:Buffer.alloc(0),executable:false})
  const ata=getAssociatedTokenAddressSync(deployment.collateralMint,user.publicKey),tokens=Buffer.alloc(165)
  deployment.collateralMint.toBuffer().copy(tokens);user.publicKey.toBuffer().copy(tokens,32);tokens.writeBigUInt64LE(100_000_000n,64);tokens[108]=1
  await genesis(ata,{lamports:20_000_000,owner:TOKEN_PROGRAM_ID,data:tokens,executable:false})
}
const cash=getAssociatedTokenAddressSync(deployment.collateralMint,operator.publicKey)
const backend=resolve(option('--backend'))
const port=19189, connection=new Connection(`http://127.0.0.1:${port}`,'confirmed')
const sourceSlot=await source.connection.getSlot('confirmed')
const validator=Bun.spawn(['solana-test-validator','--warp-slot',String(sourceSlot+10),'--clone-feature-set','--url',venue.publicRpcUrl,'--ledger',join(dir,'ledger'),'--rpc-port',String(port),'--faucet-port',String(port+2),'--dynamic-port-range',`${port+3}-${port+30}`,'--bind-address','127.0.0.1','--upgradeable-program',deployment.predictionProgram.toBase58(),join(backend,'programs/prediction_market_pinocchio/target/deploy/prediction_market_pinocchio.so'),'none','--upgradeable-program',deployment.manifestProgram.toBase58(),join(backend,'programs/manifest_guard/target/artifacts/manifest.so'),'none',...args,'--log'],{env:{...process.env,RUST_LOG:'info'},stdout:Bun.file(join(dir,'validator.log')),stderr:Bun.file(join(dir,'validator-error.log'))})
try {
  for(let i=0;;i++){try { await connection.getGenesisHash();break }catch{if(i>90 || validator.exitCode!==null)throw Error(`Validator unavailable: ${await Bun.file(join(dir,'validator-error.log')).text()}`);await Bun.sleep(500)}}
  const originalSimulate=connection.simulateTransaction.bind(connection)
  connection.simulateTransaction=(async(...args:any[])=>{const result=await (originalSimulate as any)(...args);if(result.value.err)console.log('REJECTED',result.value.logs);return result}) as typeof connection.simulateTransaction
  const adapter=new ManifestAdapter(connection,{...deployment,genesisHash:await connection.getGenesisHash()})
  const browserWallet=(user:Keypair)=>new ManifestBrowserWallet(adapter,{address:user.publicKey.toBase58(),getSigner:async()=>({isConnected:true,publicKey:user.publicKey,signTransaction:async(tx:Transaction)=>{tx.sign(user);return tx}}) as unknown as ISolana})
  const wallet=browserWallet(operator),makerWallet=browserWallet(maker)
  await wallet.prepare(yes);await wallet.prepare(no)
  // Seed the regression only on the isolated validator so this proof remains
  // repeatable after the real Devnet crossing has been repaired.
  for(const [binding,price] of [[yes,880000n],[no,600000n]] as const){
    await makerWallet.prepare(binding)
    await makerWallet.send(await adapter.moveTokens(maker.publicKey,binding,'USDC',2_000_000n,'deposit'))
    await makerWallet.send(await adapter.order(maker.publicKey,binding,{side:'BUY',quantity:2_000_000n,priceMicros:price,lastValidSlot:0,kind:'LIMIT',maxFeeAtoms:6000n}))
  }
  const before=(await getAccount(connection,cash)).amount
  let matches=0
  while(matches<20){
    const plan=await readComplementaryMatch(adapter,operator.publicKey,yes,no,20_000_000n)
    if(!plan)break
    const tx=await buildComplementaryMatch(adapter,operator.publicKey,yes,no,plan)
    await wallet.send(tx,'Match complementary bids')
    matches++
    console.log('Matched',JSON.stringify(plan,(_,v)=>typeof v==='bigint'?v.toString():v))
  }
  const after=(await getAccount(connection,cash)).amount
  assert(matches>0,'Fixture must contain crossed bids')
  assert(after>=before,'Matching must not consume operator collateral')
  const books=await Promise.all([adapter.readBook(yes),adapter.readBook(no)])
  const level=(orders:ReturnType<typeof books[0]['bids']>)=>orders.map(o=>({price:BigInt(o.price.toString())/10n**12n,quantity:BigInt(o.numBaseAtoms.toString())}))
  const quotes=binaryQuotes(level(books[0]!.asks()),level(books[0]!.bids()),level(books[1]!.asks()),level(books[1]!.bids()))
  assert(!quotes.yes.crossed,'Legacy crossing must actually disappear on-chain')
  assert.equal(quotes.yes.mid!+quotes.no.mid!,1_000_000n)
  const positionBefore=await adapter.holdings(operator.publicKey,no)
  const order=await placeBinaryLimitBuy(wallet,no,yes,1_000_000n,600000n)
  const positionAfter=await adapter.holdings(operator.publicKey,no)
  assert.equal(order.matched,1_000_000n);assert.equal(order.resting,0n)
  assert.equal(positionAfter.internalClaims-positionBefore.internalClaims,1_000_000n)
  assert.equal(positionBefore.walletUsdc-positionAfter.walletUsdc,501500n)
  console.log('PASS limit receives NO at 50 instead of resting a crossed 60 bid')
  console.log('PASS',JSON.stringify({matches,operatorGain:after-before,quotes},(_,v)=>typeof v==='bigint'?v.toString():v))
} finally { validator.kill();await validator.exited;await rm(dir,{recursive:true,force:true}) }

process.exit(0)
