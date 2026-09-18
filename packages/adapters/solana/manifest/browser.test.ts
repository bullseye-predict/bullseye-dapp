import { expect, test } from 'bun:test'
import { Connection, Keypair, SystemProgram, Transaction } from '@solana/web3.js'
import type { ISolana } from '@dynamic-labs/solana-core'
import { ManifestAdapter } from './adapter'
import { ManifestBrowserWallet, awaitConfirmation } from './browser'
function setup() {
  const user = Keypair.generate(), keys = Array.from({ length:3 }, () => Keypair.generate().publicKey)
  const adapter = new ManifestAdapter(new Connection('http://127.0.0.1:1'), { genesisHash:'local-fixture',predictionProgram:keys[0]!,manifestProgram:keys[1]!,collateralMint:keys[2]! })
  adapter.verifyDeployment = async () => ({}) as never
  let sends = 0, mutate = false, afterSign = () => {}
  // The confirmation is a signature-status poll now, not confirmTransaction's
  // once-a-second block-height loop. Counting both proves the budget.
  let statusPolls = 0, heightPolls = 0
  const commitment = 'confirmed'
  let signerUser = user
  Object.assign(adapter.connection, { getLatestBlockhash: async () => ({ blockhash:Keypair.generate().publicKey.toBase58(),lastValidBlockHeight:100 }),simulateTransaction:async()=>({value:{err:null,unitsConsumed:10_000}}),sendRawTransaction: async () => { sends++; return 'fixture-signature' },getSignatureStatuses: async () => { statusPolls++; return {value:[{err:null,confirmationStatus:commitment}]} },getBlockHeight: async () => { heightPolls++; return 1 } })
  const wallet = new ManifestBrowserWallet(adapter,{ address:user.publicKey.toBase58(),getSigner:async () => ({isConnected:true,publicKey:signerUser.publicKey,signTransaction:async (tx:Transaction) => { if(mutate) tx.instructions[1]!.data[0]=255; tx.sign(signerUser);afterSign();return tx }}) as unknown as ISolana })
  const transaction = () => new Transaction().add(SystemProgram.transfer({fromPubkey:user.publicKey,toPubkey:keys[0]!,lamports:1}))
  return { wallet,transaction,sends:()=>sends,commitment:()=>commitment,statusPolls:()=>statusPolls,heightPolls:()=>heightPolls,tamper:()=>{mutate=true},changeAccount:()=>{signerUser=Keypair.generate()},leaveDuringSigning:()=>{afterSign=()=>wallet.dispose()} }
}
test('wallet adapter checks exact signed contents and waits for a confirmed receipt',async () => {
  const f=setup();expect(await f.wallet.send(f.transaction())).toBe('fixture-signature');expect(f.sends()).toBe(1);expect(f.commitment()).toBe('confirmed')
})
/** confirmTransaction asked getBlockHeight once a second for the life of the
 *  blockhash. A transaction that lands immediately must now cost one request. */
test('a confirmation that lands at once costs one status read and no height read',async () => {
  const f=setup();await f.wallet.send(f.transaction());expect(f.statusPolls()).toBe(1);expect(f.heightPolls()).toBe(0)
})
test('wallet mutation cannot change a reviewed transaction',async () => {
  const f=setup();f.tamper();await expect(f.wallet.send(f.transaction())).rejects.toThrow('changed transaction');expect(f.sends()).toBe(0)
})
test('leaving a network while wallet approval is pending prevents broadcast',async () => {
  const f=setup();f.leaveDuringSigning();await expect(f.wallet.send(f.transaction())).rejects.toThrow('selection changed');expect(f.sends()).toBe(0)
})
test('a signer account change is blocked before broadcast with a reconnect instruction',async () => {
  const f=setup();f.changeAccount();await expect(f.wallet.send(f.transaction())).rejects.toThrow('Reconnect this account');expect(f.sends()).toBe(0)
})

/** web3.js throws SendTransactionError for a rejected simulation rather than
 *  returning value.err, so a retry that only read value.err never ran. A pooled
 *  RPC answering getLatestBlockhash and simulateTransaction from nodes at
 *  different slots makes this the common first-trade failure, not a rare one. */
function retrySetup(failures: number, message: string) {
  const user = Keypair.generate(), keys = Array.from({ length: 3 }, () => Keypair.generate().publicKey)
  const adapter = new ManifestAdapter(new Connection('http://127.0.0.1:1'), { genesisHash: 'local-fixture', predictionProgram: keys[0]!, manifestProgram: keys[1]!, collateralMint: keys[2]! })
  adapter.verifyDeployment = async () => ({}) as never
  let simulations = 0, sends = 0
  const simulationConfigs: unknown[] = []
  Object.assign(adapter.connection, {
    getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 100 }),
    simulateTransaction: async (_transaction: unknown, config: unknown) => { simulationConfigs.push(config); if (simulations++ < failures) throw new Error(message); return { value: { err: null, unitsConsumed: 10_000 } } },
    sendRawTransaction: async () => { sends++; return 'fixture-signature' },
    getSignatureStatuses: async () => ({ value: [{ err: null, confirmationStatus: 'confirmed' }] }),
    getBlockHeight: async () => 1,
  })
  const wallet = new ManifestBrowserWallet(adapter, { address: user.publicKey.toBase58(), getSigner: async () => ({ isConnected: true, publicKey: user.publicKey, signTransaction: async (tx: Transaction) => { tx.sign(user); return tx } }) as unknown as ISolana })
  const transaction = () => new Transaction().add(SystemProgram.transfer({ fromPubkey: user.publicKey, toPubkey: keys[0]!, lamports: 1 }))
  return { wallet, transaction, simulations: () => simulations, sends: () => sends, simulationConfigs: () => simulationConfigs }
}

test('a blockhash-not-found simulation is retried with the RPC replacing its hash', async () => {
  const f = retrySetup(2, 'Simulation failed. \nMessage: Transaction simulation failed: Blockhash not found. \nLogs: [].')
  expect(await f.wallet.send(f.transaction())).toBe('fixture-signature')
  expect(f.simulations()).toBe(3)
  expect(f.simulationConfigs()).toEqual([
    { sigVerify: false, replaceRecentBlockhash: true },
    { sigVerify: false, replaceRecentBlockhash: true },
    { sigVerify: false, replaceRecentBlockhash: true },
  ])
  expect(f.sends()).toBe(1)
})

test('a thrown rate-limit simulation is retried rather than failing the trade', async () => {
  const f = retrySetup(1, '429 Too Many Requests: {"jsonrpc":"2.0","error":{"code":-32429,"message":"rate limited"}}')
  expect(await f.wallet.send(f.transaction())).toBe('fixture-signature')
  expect(f.sends()).toBe(1)
})

test('a genuine program rejection is not retried and never broadcasts', async () => {
  const f = retrySetup(9, 'Simulation failed. \nMessage: Transaction simulation failed: Error processing Instruction 0: custom program error: 0x1771.')
  await expect(f.wallet.send(f.transaction())).rejects.toThrow('custom program error')
  expect(f.simulations()).toBe(1)
  expect(f.sends()).toBe(0)
})

test('first-trader preparation creates missing claim and fee token accounts', async () => {
  const f = setup()
  const keys = Array.from({ length: 6 }, () => Keypair.generate().publicKey)
  const binding = { question: keys[0]!, program: keys[1]!, venue: keys[2]!, mint: keys[3]!, collateral: keys[4]!, recipient: keys[5]!, bps: 30, outcome: 1 as const }
  let prepared: Transaction | undefined
  f.wallet.adapter.connection.getMultipleAccountsInfo = async () => [null, null, null, null, null]
  f.wallet.send = async tx => { prepared = tx; return 'preparation-signature' }
  expect(await f.wallet.prepare(binding)).toBe('preparation-signature')
  expect(prepared?.instructions).toHaveLength(5)
  const tokenCreates = prepared!.instructions.filter(ix => ix.programId.toBase58() === 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
  expect(tokenCreates).toHaveLength(3)
  expect(tokenCreates.some(ix => ix.keys[2]!.pubkey.equals(binding.recipient) && ix.keys[3]!.pubkey.equals(binding.collateral))).toBe(true)
  expect(tokenCreates.some(ix => ix.keys[2]!.pubkey.equals(f.wallet.owner) && ix.keys[3]!.pubkey.equals(binding.mint))).toBe(true)
  prepared = undefined
  f.wallet.adapter.connection.getMultipleAccountsInfo = async () => Array(5).fill({ data: Buffer.alloc(1) })
  expect(await f.wallet.prepare(binding)).toBeUndefined()
  expect(prepared).toBeUndefined()
})

test('RPC preparation failures do not tell the user a wallet signature is pending', async () => {
  const f = setup()
  const stages: string[] = []
  f.wallet.adapter.connection.getLatestBlockhash = async () => { throw new Error('429 Too Many Requests') }
  const wallet = new ManifestBrowserWallet(f.wallet.adapter, f.wallet.port, undefined, stage => stages.push(stage.status))
  await expect(wallet.send(f.transaction())).rejects.toThrow('429')
  expect(stages).toEqual(['preparing', 'failed'])
  expect(f.sends()).toBe(0)
})

test('complete-set buy keeps split and bounded opposite sale in one transaction', async () => {
  const f = setup(), keys = Array.from({length:6}, () => Keypair.generate().publicKey)
  const b = { question:keys[0]!,program:keys[1]!,venue:keys[2]!,mint:keys[3]!,collateral:keys[4]!,recipient:keys[5]!,bps:30,outcome:0 as const }
  let sent: Transaction | undefined, terms: unknown
  f.wallet.adapter.swap = async (_owner, _binding, input) => { terms = input; return f.transaction() }
  f.wallet.send = async tx => { sent = tx; return 'atomic' }
  expect(await f.wallet.completeSetBuy(b,1_000_000n,120_000n,3000n)).toBe('atomic')
  expect(terms).toEqual({side:'SELL',inputAtoms:1_000_000n,minimumOutputAtoms:880_000n,maxFeeAtoms:3000n})
  expect(sent!.instructions.map(ix => ix.data[0])).toEqual([4,6,24,2])
  await expect(f.wallet.completeSetBuy(b,1_000_000n,1_000_000n,3000n)).rejects.toThrow('Invalid complete-set')
})

/** The confirmation wait, isolated. `confirmTransaction` read getBlockHeight
 *  once a second for the life of the blockhash; these pin the budget that
 *  replaced it. */
function confirmFixture(statuses: ({ err: unknown; confirmationStatus: string } | null)[], height = 1) {
  let status = 0, heights = 0
  const connection = {
    getSignatureStatuses: async () => ({ value: [statuses[Math.min(status++, statuses.length - 1)] ?? null] }),
    getBlockHeight: async () => { heights++; return height },
  } as unknown as Connection
  return { connection, statusReads: () => status, heightReads: () => heights }
}

test('a slow confirmation reads the signature, not the block height, on every pass', async () => {
  const f = confirmFixture([null, null, null, { err: null, confirmationStatus: 'confirmed' }])
  await awaitConfirmation(f.connection, 'sig', 100, async () => {})
  expect(f.statusReads()).toBe(4)
  // Four passes is inside the every-sixth height check, so none was needed.
  expect(f.heightReads()).toBe(0)
})

test('block height is read once per six passes, not once per second', async () => {
  const f = confirmFixture([...Array(13).fill(null), { err: null, confirmationStatus: 'confirmed' }])
  await awaitConfirmation(f.connection, 'sig', 100, async () => {})
  expect(f.statusReads()).toBe(14)
  expect(f.heightReads()).toBe(2)
})

test('an expired blockhash ends the wait instead of polling to the timeout', async () => {
  const f = confirmFixture([null], 999)
  await expect(awaitConfirmation(f.connection, 'sig', 100, async () => {})).rejects.toThrow('Blockhash expired')
})

test('a failed transaction is reported as failed, never as unconfirmed', async () => {
  const f = confirmFixture([{ err: { InstructionError: [0, 'Custom'] }, confirmationStatus: 'confirmed' }])
  await expect(awaitConfirmation(f.connection, 'sig', 100, async () => {})).rejects.toThrow('Transaction failed')
})
