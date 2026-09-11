import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js'
import { createMint, getAccount, getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount, mintTo, createTransferInstruction } from '@solana/spl-token'
import { ManifestBrowserWallet } from '../../packages/adapters/solana/manifest/browser'
import type { ISolana } from '@dynamic-labs/solana-core'
import { ManifestAdapter } from '../../packages/adapters/solana/manifest/adapter'
import { activateBook, bindingAddress, bookAddress, claimMintAddress, freezeAuthority, initializeClaimMint, meta, moveClaims, prepareClaimAccount, registerBinding, takerFee, type ManifestBinding } from '../../packages/adapters/solana/manifest/wire'
import { changePosition, createMarket, initializeConfig, initializePosition, initializeVault, lockMarket, marketAddress, marketCollateralAddress, moveVaultCollateral, resolveMarket, setPause, TOKEN_PROGRAM_ID, vaultAddress, voidMarket } from '../../packages/adapters/solana/wire'

const args=process.argv.slice(2)
if(!args.includes('--local-demo'))throw new Error('Only --local-demo is supported; no production wallet is read')
const opt=(name:string)=>{const i=args.indexOf(name);return i<0?undefined:args[i+1]}
const root=resolve(import.meta.dir,'../..')
const build=JSON.parse(await readFile(resolve(root,'programs/manifest_guard/target/artifacts/build.json'),'utf8'))
const program=Keypair.fromSeed(new Uint8Array(32).fill(1)),manifest=Keypair.fromSeed(new Uint8Array(32).fill(31))
assert.equal(build.predictionProgram,program.publicKey.toBase58());assert.equal(build.manifestProgram,manifest.publicKey.toBase58())
const directory=await mkdtemp(join(tmpdir(),'solz-manifest-proof-'))
const port=19099,connection=new Connection(`http://127.0.0.1:${port}`,'confirmed')
const validator=Bun.spawn(['solana-test-validator','--ledger',join(directory,'ledger'),'--rpc-port',String(port),'--faucet-port',String(port+2),'--dynamic-port-range',`${port+3}-${port+30}`,'--bind-address','127.0.0.1','--bpf-program',program.publicKey.toBase58(),resolve(root,'programs/prediction_market_pinocchio/target/deploy/prediction_market_pinocchio.so'),'--bpf-program',manifest.publicKey.toBase58(),resolve(root,'programs/manifest_guard/target/artifacts/manifest.so'),'--quiet'],{stdout:Bun.file(join(directory,'validator.log')),stderr:'inherit'})
const checks:{name:string;signature?:string;feeLamports?:number}[]=[]
try{
  let ready=false
  for(let i=0;i<120;i++){if(validator.exitCode!==null)throw new Error(`Validator exited: ${await readFile(join(directory,'validator.log'),'utf8')}`);try{if((await connection.getAccountInfo(program.publicKey))?.executable){ready=true;break}}catch{}await Bun.sleep(500)}
  assert(ready,'Local validator must load our fresh prediction program')
  const admin=Keypair.generate(),oracle=Keypair.generate(),maker=Keypair.generate(),alice=Keypair.generate(),recipient=Keypair.generate()
  for(const user of [admin,oracle,maker,alice,recipient]){const signature=await connection.requestAirdrop(user.publicKey,20_000_000_000);await connection.confirmTransaction({signature,...await connection.getLatestBlockhash()},'confirmed')}
  async function send(name:string,tx:Transaction,payer=admin,extra:Keypair[]=[]){
    tx.instructions.unshift(ComputeBudgetProgram.setComputeUnitLimit({units:1_000_000}))
    const signature=await sendAndConfirmTransaction(connection,tx,[payer,...extra],{commitment:'confirmed'})
    const receipt=await connection.getTransaction(signature,{commitment:'confirmed',maxSupportedTransactionVersion:0});assert(receipt?.meta&&!receipt.meta.err)
    checks.push({name,signature,feeLamports:receipt.meta.fee});console.log(`PASS ${name}`)
  }
  async function reject(name:string,tx:Transaction,payer=alice){
    tx.recentBlockhash=(await connection.getLatestBlockhash()).blockhash;tx.feePayer=payer.publicKey;tx.sign(payer)
    const simulation=await connection.simulateTransaction(tx)
    assert(simulation.value.err,`Expected onchain rejection: ${name}`)
    checks.push({name});console.log(`PASS rejects ${name}`)
  }
  const collateral=await createMint(connection,admin,admin.publicKey,null,6)
  await send('initialize prediction',new Transaction().add(initializeConfig(program.publicKey,admin.publicKey,collateral,oracle.publicKey,new Uint8Array(32).fill(9))),admin,[program])
  for(const user of [maker,alice,recipient]){const ata=await getOrCreateAssociatedTokenAccount(connection,admin,collateral,user.publicKey);await mintTo(connection,admin,collateral,ata.address,admin,1_000_000_000n)}
  for(const user of [maker,alice])await send('initialize user vault',new Transaction().add(initializeVault(program.publicKey,user.publicKey,collateral,1_000_000_000n)),user)
  const adapter=new ManifestAdapter(connection,{genesisHash:await connection.getGenesisHash(),predictionProgram:program.publicKey,manifestProgram:manifest.publicKey,collateralMint:collateral})
  async function question(name:string,window=3600){
    const now=(await connection.getBlockTime(await connection.getSlot()))!
    const id=createHash('sha256').update(name).digest(),q=marketAddress(program.publicKey,id)
    await send(`${name}: create question`,new Transaction().add(createMarket(program.publicKey,admin.publicKey,collateral,{matchId:id,outcomeCount:2,startsAtSeconds:BigInt(now+2),locksAtSeconds:BigInt(now+window),expirySeconds:BigInt(now+window+3600)})))
    const bindings:ManifestBinding[]=[]
    for(const outcome of [0,1] as const){
      await send(`${name}: register ${outcome}`,new Transaction().add(registerBinding(program.publicKey,admin.publicKey,q,manifest.publicKey,outcome,recipient.publicKey,30)))
      const b=await adapter.binding(q,outcome);bindings.push(b)
      await send(`${name}: mint ${outcome}`,new Transaction().add(initializeClaimMint(program.publicKey,admin.publicKey,b)))
      await send(`${name}: activate ${outcome}`,new Transaction().add(activateBook(program.publicKey,admin.publicKey,b)))
    }
    for(const user of [maker,alice])await send(`${name}: position and accounts`,new Transaction().add(initializePosition(program.publicKey,user.publicKey,q,vaultAddress(program.publicKey,user.publicKey)),...bindings.map(b=>prepareClaimAccount(user.publicKey,user.publicKey,b.mint))),user)
    return {q,bindings,locks:now+window}
  }
  const {q,bindings}=await question('primary')
  const yes=bindings[0]!,no=bindings[1]!
  await send('idempotent activation resumes',new Transaction().add(registerBinding(program.publicKey,admin.publicKey,q,manifest.publicKey,0,recipient.publicKey,30),initializeClaimMint(program.publicKey,admin.publicKey,yes),activateBook(program.publicKey,admin.publicKey,yes)))
  await reject('immutable fee cannot be rewritten',new Transaction().add(registerBinding(program.publicKey,admin.publicKey,q,manifest.publicKey,0,recipient.publicKey,31)),admin)
  await send('fund complete sets',new Transaction().add(moveVaultCollateral(program.publicKey,maker.publicKey,getAssociatedTokenAddressSync(collateral,maker.publicKey),100_000_000n,'deposit'),changePosition(program.publicKey,maker.publicKey,q,vaultAddress(program.publicKey,maker.publicKey),'split',100_000_000n)),maker)
  for(const b of bindings)await send('export controlled claims',new Transaction().add(moveClaims(program.publicKey,maker.publicKey,b,100_000_000n,'export')),maker)
  const claimAta=(b:ManifestBinding,user:Keypair)=>getAssociatedTokenAddressSync(b.mint,user.publicKey)
  const usdc=(user:Keypair)=>getAssociatedTokenAddressSync(collateral,user.publicKey)
  assert((await getAccount(connection,claimAta(yes,maker))).isFrozen)
  await reject('wallet transfer cannot leak claims into an unrestricted account',new Transaction().add(createTransferInstruction(claimAta(yes,maker),claimAta(yes,alice),maker.publicKey,1n)),maker)
  const thaw=new TransactionInstruction({programId:manifest.publicKey,keys:[meta(q),meta(bindingAddress(program.publicKey,q,0)),meta(yes.mint),meta(claimAta(yes,maker),true),meta(freezeAuthority(manifest.publicKey)),meta(TOKEN_PROGRAM_ID)],data:Buffer.from([250,0])})
  await reject('direct thaw without prediction PDA authorization',new Transaction().add(thaw),maker)
  for(const b of bindings){await send('deposit claim inventory',await adapter.moveTokens(maker.publicKey,b,'claims',100_000_000n,'deposit'),maker)}
  await send('post YES ask',await adapter.order(maker.publicKey,yes,{side:'SELL',quantity:100_000_000n,priceMicros:500_000n,lastValidSlot:0,kind:'LIMIT',maxFeeAtoms:0n}),maker)
  await send('fund YES bid',await adapter.moveTokens(maker.publicKey,yes,'USDC',50_000_000n,'deposit'),maker)
  await send('post YES bid',await adapter.order(maker.publicKey,yes,{side:'BUY',quantity:100_000_000n,priceMicros:490_000n,lastValidSlot:0,kind:'LIMIT',maxFeeAtoms:0n}),maker)
  const buy=()=>adapter.swap(alice.publicKey,yes,{side:'BUY',inputAtoms:5_000_000n,minimumOutputAtoms:10_000_000n,maxFeeAtoms:15_000n})
  await reject('fee cap rolls back a fill',await adapter.swap(alice.publicKey,yes,{side:'BUY',inputAtoms:5_000_000n,minimumOutputAtoms:10_000_000n,maxFeeAtoms:14_999n}))
  const direct=(await buy()).instructions[0]!
  await reject('direct core call without enforcement accounts',new Transaction().add(new TransactionInstruction({programId:direct.programId,keys:direct.keys.slice(0,-8),data:direct.data.subarray(0,-8)})))
  const redirect=(await buy()).instructions[0]!;redirect.keys[redirect.keys.length-2]=meta(usdc(alice),true)
  await reject('fee recipient substitution',new Transaction().add(redirect))
  const feeBefore=(await getAccount(connection,usdc(recipient))).amount
  const browserWallet = (user: Keypair) => new ManifestBrowserWallet(adapter, { address: user.publicKey.toBase58(), getSigner: async () => ({ isConnected: true, publicKey: user.publicKey, signTransaction: async (tx: Transaction) => { tx.sign(user); return tx } }) as unknown as ISolana })
  const freshUser = Keypair.generate()
  const funded = await connection.requestAirdrop(freshUser.publicKey, 1_000_000_000)
  await connection.confirmTransaction({ signature: funded, ...await connection.getLatestBlockhash() }, 'confirmed')
  const prepared = await browserWallet(freshUser).prepare(yes)
  checks.push({ name: 'browser wallet prepares fresh vault, position and token accounts', signature: prepared })
  console.log('PASS browser wallet prepares fresh accounts')
  const purchased = await browserWallet(alice).send(await buy())
  checks.push({ name: 'browser wallet signs unchanged buy and waits for finalization', signature: purchased })
  console.log('PASS browser wallet finalized buy')
  assert.equal((await getAccount(connection,usdc(recipient))).amount-feeBefore,15_000n)
  assert.equal((await getAccount(connection,claimAta(yes,alice))).amount,10_000_000n)
  assert((await getAccount(connection,claimAta(yes,alice))).isFrozen)
  await send('sell YES with mandatory fee',await adapter.swap(alice.publicKey,yes,{side:'SELL',inputAtoms:1_000_000n,minimumOutputAtoms:490_000n,maxFeeAtoms:takerFee(490_000n,30)}),alice)
  assert.equal((await getAccount(connection,usdc(recipient))).amount-feeBefore,16_470n)
  await send('post limited NO depth',await adapter.order(maker.publicKey,no,{side:'SELL',quantity:2_000_000n,priceMicros:500_000n,lastValidSlot:0,kind:'LIMIT',maxFeeAtoms:0n}),maker)
  await send('fund NO IOC',await adapter.moveTokens(alice.publicKey,no,'USDC',5_000_000n,'deposit'),alice)
  await send('IOC partially fills available depth',await adapter.order(alice.publicKey,no,{side:'BUY',quantity:10_000_000n,priceMicros:500_000n,lastValidSlot:0,kind:'IOC',maxFeeAtoms:3000n}),alice)
  const noHoldings=await adapter.holdings(alice.publicKey,no)
  assert.equal(noHoldings.venueAvailableClaims,2_000_000n);assert.equal(noHoldings.venueReservedUsdc,0n);assert.equal(noHoldings.venueAvailableUsdc,4_000_000n)
  const stale=await buy()
  await send('global pause',new Transaction().add(setPause(program.publicKey,admin.publicKey,true)))
  await reject('direct guarded execution respects global pause',stale)
  await send('global unpause',new Transaction().add(setPause(program.publicKey,admin.publicKey,false)))
  await send('early game lock',new Transaction().add(lockMarket(program.publicKey,admin.publicKey,q)))
  await reject('direct guarded execution respects early result lock',stale)
  await assert.rejects(()=>buy(),/closed to trading/)
  for(const b of bindings){
    const book=await adapter.readBook(b),orders=[...book.asks(),...book.bids()].filter(o=>o.trader.equals(maker.publicKey))
    if(orders.length)await send('cancel while locked',await adapter.cancel(maker.publicKey,b,orders.map(o=>BigInt(o.sequenceNumber.toString()))),maker)
    for(const user of [maker,alice]){const h=await adapter.holdings(user.publicKey,b);if(h.venueAvailableClaims>0n)await send('withdraw claims while locked',await adapter.moveTokens(user.publicKey,b,'claims',h.venueAvailableClaims,'withdraw'),user);if(h.venueAvailableUsdc>0n)await send('withdraw USDC while locked',await adapter.moveTokens(user.publicKey,b,'USDC',h.venueAvailableUsdc,'withdraw'),user)}
  }
  await send('resolve authorized game result',new Transaction().add(resolveMarket(program.publicKey,oracle.publicKey,q,0,new Uint8Array(32).fill(7),BigInt((await connection.getBlockTime(await connection.getSlot()))!))),oracle)
  for(const user of [maker,alice]){
    const winning=(await getAccount(connection,claimAta(yes,user))).amount,losing=(await getAccount(connection,claimAta(no,user))).amount
    const tx=new Transaction()
    if(winning)tx.add(moveClaims(program.publicKey,user.publicKey,yes,winning,'import'))
    if(losing)tx.add(moveClaims(program.publicKey,user.publicKey,no,losing,'import'))
    tx.add(changePosition(program.publicKey,user.publicKey,q,vaultAddress(program.publicKey,user.publicKey),'redeem'))
    if(winning)tx.add(moveVaultCollateral(program.publicKey,user.publicKey,usdc(user),winning,'withdraw'))
    const before=(await getAccount(connection,usdc(user))).amount
    await send('burn claims, redeem and withdraw USDC',tx,user)
    assert.equal((await getAccount(connection,usdc(user))).amount-before,winning)
    await reject('duplicate claim import',new Transaction().add(moveClaims(program.publicKey,user.publicKey,yes,1n,'import')),user)
  }
  assert.equal((await getAccount(connection,marketCollateralAddress(program.publicKey,q))).amount,0n)
  const voided=await question('voided')
  await send('fund odd void collateral',new Transaction().add(moveVaultCollateral(program.publicKey,maker.publicKey,usdc(maker),101n,'deposit'),changePosition(program.publicKey,maker.publicKey,voided.q,vaultAddress(program.publicKey,maker.publicKey),'split',101n)),maker)
  for(const b of voided.bindings)await send('export odd void claims',new Transaction().add(moveClaims(program.publicKey,maker.publicKey,b,101n,'export')),maker)
  await send('void question',new Transaction().add(voidMarket(program.publicKey,oracle.publicKey,voided.q,new Uint8Array(32).fill(8))),oracle)
  for(const b of voided.bindings)await send('import and redeem void claims',new Transaction().add(moveClaims(program.publicKey,maker.publicKey,b,101n,'import'),changePosition(program.publicKey,maker.publicKey,voided.q,vaultAddress(program.publicKey,maker.publicKey),'redeem')),maker)
  assert.equal((await getAccount(connection,marketCollateralAddress(program.publicKey,voided.q))).amount,0n)
  const report={createdAt:new Date().toISOString(),network:'isolated local validator',build,testFeePolicy:{model:'taker quote notional',bps:30,productionChoice:false},checks,productionReady:false,remaining:['Production fee policy and recipient selection','Independent review of customized onchain code','Configured test deployment and real-wallet acceptance','Application/indexer production integration and operating liquidity']}
  if(opt('--output'))await writeFile(resolve(opt('--output')!),JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify(report,null,2))
}catch(error){console.error(error);process.exitCode=1}finally{validator.kill('SIGTERM');await validator.exited;await rm(directory,{recursive:true,force:true})}
process.exit(process.exitCode??0)
