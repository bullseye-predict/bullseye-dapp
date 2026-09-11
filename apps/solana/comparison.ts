/** Runs deployed venue bytecode against locally minted test collateral only.
 * Prerequisites: cargo build-sbf with external-venue-comparison; solana program
 * dump for Manifest and DAMM v2. Supply their directory with --artifacts.
 * Never reads a wallet file, production credentials or application .env values.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { ComputeBudgetProgram, Connection, Keypair, Transaction, sendAndConfirmTransaction, type Signer } from '@solana/web3.js'
import { createMint, getAccount, getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount, mintTo } from '@solana/spl-token'
import { derivePositionNftAccount, CP_AMM_PROGRAM_ID } from '@meteora-ag/cp-amm-sdk'
import { ManifestComparisonAdapter, MeteoraComparisonAdapter, MANIFEST_PROGRAM_ID, EXTERNAL_VENUE_READINESS } from '../../packages/adapters/solana/external-comparison'
import { initializeOutcomeMint, moveOutcomeTokens, outcomeMintAddress, prepareOutcomeAccount, type BinaryOutcome } from '../../packages/adapters/solana/outcome-tokens'
import { changePosition, createMarket, initializeConfig, initializePosition, initializeVault, lockMarket, marketAddress, moveVaultCollateral, resolveMarket, vaultAddress } from '../../packages/adapters/solana/wire'

const args = process.argv.slice(2)
if (!args.includes('--local-demo')) throw new Error('Use --local-demo; this script only runs an isolated local validator')
const argument = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined }
const artifacts = argument('--artifacts')
if (!artifacts) throw new Error('--artifacts must contain prediction_market_pinocchio.so, manifest.so, meteora.so')
const files = Object.fromEntries(await Promise.all(['prediction_market_pinocchio', 'manifest', 'meteora'].map(async name => {
  const path = resolve(artifacts, `${name}.so`)
  return [name, { path, sha256: createHash('sha256').update(await readFile(path)).digest('hex') }]
})))
const directory = await mkdtemp(join(tmpdir(), 'solz-venues-'))
const program = Keypair.generate(); const admin = Keypair.generate(); const oracle = Keypair.generate()
const port = Number(argument('--port') ?? '18999')
if (!Number.isInteger(port) || port < 1024 || port > 60000) throw new Error('Invalid local port')
const connection = new Connection(`http://127.0.0.1:${port}`, 'confirmed')
const validator = Bun.spawn(['solana-test-validator', '--ledger', join(directory, 'ledger'), '--rpc-port', String(port), '--faucet-port', String(port + 2), '--dynamic-port-range', `${port + 3}-${port + 30}`, '--bind-address', '127.0.0.1', '--bpf-program', program.publicKey.toBase58(), files.prediction_market_pinocchio!.path, '--bpf-program', MANIFEST_PROGRAM_ID.toBase58(), files.manifest!.path, '--bpf-program', CP_AMM_PROGRAM_ID.toBase58(), files.meteora!.path, '--quiet'], { stdout: Bun.file(join(directory, 'validator.log')), stderr: 'inherit' })
const steps: { action: string; signature: string; feeLamports: number; payerDebitLamports: number; computeUnits: number | null }[] = []
try {
  let ready = false
  for (let attempt = 0; attempt < 120; attempt++) {
    if (validator.exitCode !== null) throw new Error(`Validator exited: ${await readFile(join(directory, 'validator.log'), 'utf8')}`)
    try { await connection.getVersion(); ready = true; break } catch { await Bun.sleep(500) }
  }
  if (!ready) throw new Error('Local validator did not start')
  async function fund(who: Keypair) {
    const signature = await connection.requestAirdrop(who.publicKey, 20_000_000_000)
    await connection.confirmTransaction({ signature, ...await connection.getLatestBlockhash() }, 'confirmed')
  }
  async function send(action: string, tx: Transaction, payer: Keypair, extra: Signer[] = []) {
    tx.instructions.unshift(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }))
    const before = await connection.getBalance(payer.publicKey)
    const signature = await sendAndConfirmTransaction(connection, tx, [payer, ...extra], { commitment: 'confirmed' })
    const receipt = await connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })
    if (!receipt?.meta || receipt.meta.err) throw new Error(`Missing successful receipt for ${action}`)
    steps.push({ action, signature, feeLamports: receipt.meta.fee, payerDebitLamports: before - await connection.getBalance(payer.publicKey), computeUnits: receipt.meta.computeUnitsConsumed ?? null })
    console.log(`PASS ${action}`)
  }
  await fund(admin); await fund(oracle)
  const collateral = await createMint(connection, admin, admin.publicKey, null, 6)
  await send('initialize shared prediction program', new Transaction().add(initializeConfig(program.publicKey, admin.publicKey, collateral, oracle.publicKey, new Uint8Array(32).fill(9))), admin, [program])
  const results = []
  for (const selectedOutcome of [0, 1] as const) for (const kind of ['Manifest', 'Meteora DAMM v2'] as const) {
    const label = `${kind} (${selectedOutcome === 0 ? 'YES' : 'NO'})`
    const maker = Keypair.generate(); const alice = Keypair.generate()
    await fund(maker); await fund(alice)
    const now = (await connection.getBlockTime(await connection.getSlot()))!
    const matchId = createHash('sha256').update(`${kind}:${selectedOutcome}`).digest()
    const market = marketAddress(program.publicKey, matchId)
    await send(`${label}: create binary prediction`, new Transaction().add(createMarket(program.publicKey, admin.publicKey, collateral, { matchId, outcomeCount: 2, startsAtSeconds: BigInt(now + 2), locksAtSeconds: BigInt(now + 3600), expirySeconds: BigInt(now + 7200) })), admin)
    for (const outcome of [0, 1] as const) await send(`${label}: initialize ${outcome === 0 ? 'YES' : 'NO'} mint`, new Transaction().add(initializeOutcomeMint(program.publicKey, admin.publicKey, market, collateral, outcome)), admin)
    for (const user of [maker, alice]) {
      const usdc = await getOrCreateAssociatedTokenAccount(connection, admin, collateral, user.publicKey)
      await mintTo(connection, admin, collateral, usdc.address, admin, 500_000_000n)
      await send(`${label}: initialize ${user === maker ? 'maker' : 'Alice'} vault`, new Transaction().add(initializeVault(program.publicKey, user.publicKey, collateral, 500_000_000n), initializePosition(program.publicKey, user.publicKey, market, vaultAddress(program.publicKey, user.publicKey)), prepareOutcomeAccount(program.publicKey, user.publicKey, user.publicKey, market, 0), prepareOutcomeAccount(program.publicKey, user.publicKey, user.publicKey, market, 1)), user)
    }
    while ((await connection.getBlockTime(await connection.getSlot()))! < now + 2) await Bun.sleep(500)
    await send(`${label}: deposit 100 test USDC and split full sets`, new Transaction().add(moveVaultCollateral(program.publicKey, maker.publicKey, getAssociatedTokenAddressSync(collateral, maker.publicKey), 100_000_000n, 'deposit'), changePosition(program.publicKey, maker.publicKey, market, vaultAddress(program.publicKey, maker.publicKey), 'split', 100_000_000n)), maker)
    await send(`${label}: export 100 backed YES and 100 backed NO`, new Transaction().add(...([0, 1] as const).map(outcome => moveOutcomeTokens(program.publicKey, maker.publicKey, market, outcome, 100_000_000n, 'export'))), maker)
    const binding = { programId: program.publicKey, predictionMarket: market, collateralMint: collateral, outcome: selectedOutcome as BinaryOutcome }
    const adapter = kind === 'Manifest' ? new ManifestComparisonAdapter(connection, binding) : new MeteoraComparisonAdapter(connection, binding)
    let venue: import('@solana/web3.js').PublicKey
    let lpPosition: import('@solana/web3.js').PublicKey | undefined
    let nft: Keypair | undefined
    if (adapter instanceof ManifestComparisonAdapter) {
      const venueKey = Keypair.generate(); venue = venueKey.publicKey
      await send(`${label}: create outcome/USDC orderbook`, await adapter.create(maker.publicKey, venue), maker, [venueKey])
      await send(`${label}: deposit outcome inventory`, await adapter.deposit(maker.publicKey, venue, 'outcome', 100_000_000n), maker)
      await send(`${label}: deposit 50 USDC bid inventory`, await adapter.deposit(maker.publicKey, venue, 'USDC', 50_000_000n), maker)
      await send(`${label}: place 100 claims bid at 0.49`, await adapter.limitOrder(maker.publicKey, venue, 'BUY', 100_000_000n, 490_000n, (await connection.getSlot()) + 5000), maker)
      await send(`${label}: place 100 claims ask at 0.50`, await adapter.limitOrder(maker.publicKey, venue, 'SELL', 100_000_000n, 500_000n, (await connection.getSlot()) + 5000), maker)
    } else {
      nft = Keypair.generate()
      const created = await adapter.create(maker.publicKey, nft.publicKey, 100_000_000n, 50_000_000n, 30)
      venue = created.pool; lpPosition = created.position
      await send(`${label}: create outcome/USDC pool with 100 claims + 50 USDC`, created.tx, maker, [nft])
    }
    const ata = getAssociatedTokenAddressSync(outcomeMintAddress(program.publicKey, market, selectedOutcome), alice.publicKey)
    const minimum = adapter instanceof MeteoraComparisonAdapter ? BigInt((await adapter.quote(venue, 'BUY', 5_000_000n, 1)).minSwapOutAmount.toString()) : 10_000_000n
    await send(`${label}: Alice buys claims with 5 USDC`, await adapter.swap(alice.publicKey, venue, 'BUY', 5_000_000n, minimum), alice)
    const received = (await getAccount(connection, ata)).amount
    assert(received >= minimum)
    const minimumSell = adapter instanceof MeteoraComparisonAdapter ? BigInt((await adapter.quote(venue, 'SELL', 1_000_000n, 1)).minSwapOutAmount.toString()) : 490_000n
    const usdcBeforeSell = (await getAccount(connection, getAssociatedTokenAddressSync(collateral, alice.publicKey))).amount
    await send(`${label}: Alice sells one claim`, await adapter.swap(alice.publicKey, venue, 'SELL', 1_000_000n, minimumSell), alice)
    assert((await getAccount(connection, getAssociatedTokenAddressSync(collateral, alice.publicKey))).amount - usdcBeforeSell >= minimumSell)
    // Build before locking. A confirmed execution after lock proves that an app
    // preflight is insufficient to enforce prediction rules on either exchange.
    const bypass = await adapter.swap(alice.publicKey, venue, 'BUY', 1_000_000n, 1n)
    await send(`${label}: lock prediction`, new Transaction().add(lockMarket(program.publicKey, admin.publicKey, market)), admin)
    await assert.rejects(() => adapter.swap(alice.publicKey, venue, 'BUY', 1_000_000n, 1n), /not accepting trades/)
    await send(`${label}: demonstrate direct venue bypass after prediction lock`, bypass, alice)
    const totalClaims = (await getAccount(connection, ata)).amount
    if (adapter instanceof ManifestComparisonAdapter) {
      const book = await adapter.read(venue)
      for (const order of [...book.asks(), ...book.bids()]) await send(`${label}: cancel maker order after cutoff`, await adapter.cancel(maker.publicKey, venue, BigInt(order.sequenceNumber.toString())), maker)
      await send(`${label}: withdraw unfilled inventory`, await adapter.withdraw(maker.publicKey, venue, 'outcome', 100_000_000n - totalClaims), maker)
      await send(`${label}: withdraw maker proceeds`, await adapter.withdraw(maker.publicKey, venue, 'USDC', 55_510_000n), maker)
    } else {
      await send(`${label}: remove LP and close position after cutoff`, await adapter.removeLiquidity(maker.publicKey, venue, lpPosition!, derivePositionNftAccount(nft!.publicKey), 0n, 0n), maker)
    }
    const ended = (await connection.getBlockTime(await connection.getSlot()))!
    await send(`${label}: oracle resolves purchased outcome`, new Transaction().add(resolveMarket(program.publicKey, oracle.publicKey, market, selectedOutcome, createHash('sha256').update(`${label}:result`).digest(), BigInt(ended))), oracle)
    const aliceUsdc = getAssociatedTokenAddressSync(collateral, alice.publicKey)
    const beforeRedeem = (await getAccount(connection, aliceUsdc)).amount
    await send(`${label}: Alice imports, redeems and withdraws winnings`, new Transaction().add(moveOutcomeTokens(program.publicKey, alice.publicKey, market, selectedOutcome, totalClaims, 'import'), changePosition(program.publicKey, alice.publicKey, market, vaultAddress(program.publicKey, alice.publicKey), 'redeem'), moveVaultCollateral(program.publicKey, alice.publicKey, aliceUsdc, totalClaims, 'withdraw')), alice)
    assert.equal((await getAccount(connection, aliceUsdc)).amount - beforeRedeem, totalClaims)
    assert.equal((await getAccount(connection, ata)).amount, 0n)
    const makerClaims = (await getAccount(connection, getAssociatedTokenAddressSync(outcomeMintAddress(program.publicKey, market, selectedOutcome), maker.publicKey))).amount
    if (makerClaims > 0n) await send(`${label}: maker redeems remaining winning claims`, new Transaction().add(moveOutcomeTokens(program.publicKey, maker.publicKey, market, selectedOutcome, makerClaims, 'import'), changePosition(program.publicKey, maker.publicKey, market, vaultAddress(program.publicKey, maker.publicKey), 'redeem')), maker)
    results.push({ venue: kind, outcome: selectedOutcome, prediction: market.toBase58(), trading: venue.toBase58(), firstPurchaseUsdcAtoms: '5000000', firstPurchaseOutcomeAtoms: received.toString(), totalAlicePayoutUsdcAtoms: totalClaims.toString(), directCutoffBypassConfirmed: true })
  }
  const report = { generatedAt: new Date().toISOString(), network: 'isolated local validator', collateral: 'locally minted six-decimal test USDC', ...EXTERNAL_VENUE_READINESS, artifacts: files, scenarios: results, steps, costNote: 'Measured local transaction fees and payer SOL debits; include rent deposits/returns where applicable. These are not a mainnet quote. Test minting, airdrops and setup helpers are excluded. LP capital and prediction collateral are not fees.' }
  const output = argument('--output')
  if (output) await writeFile(resolve(output), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  validator.kill('SIGTERM')
  await validator.exited
  await rm(directory, { recursive: true, force: true })
}

// web3 subscription reconnect timers must not keep the demo alive after its validator exits.
process.exit(process.exitCode ?? 0)
