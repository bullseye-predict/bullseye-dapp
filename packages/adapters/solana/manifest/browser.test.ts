import { expect, test } from 'bun:test'
import { Connection, Keypair, SystemProgram, Transaction } from '@solana/web3.js'
import type { ISolana } from '@dynamic-labs/solana-core'
import { ManifestAdapter } from './adapter'
import { ManifestBrowserWallet } from './browser'
function setup() {
  const user = Keypair.generate(), keys = Array.from({ length:3 }, () => Keypair.generate().publicKey)
  const adapter = new ManifestAdapter(new Connection('http://127.0.0.1:1'), { genesisHash:'local-fixture',predictionProgram:keys[0]!,manifestProgram:keys[1]!,collateralMint:keys[2]! })
  adapter.verifyDeployment = async () => ({}) as never
  let sends = 0, commitment = '', mutate = false, afterSign = () => {}
  let signerUser = user
  Object.assign(adapter.connection, { getLatestBlockhash: async () => ({ blockhash:Keypair.generate().publicKey.toBase58(),lastValidBlockHeight:100 }),simulateTransaction:async()=>({value:{err:null,unitsConsumed:10_000}}),sendRawTransaction: async () => { sends++; return 'fixture-signature' },confirmTransaction: async (_:unknown, c:string) => { commitment=c; return {value:{err:null}} } })
  const wallet = new ManifestBrowserWallet(adapter,{ address:user.publicKey.toBase58(),getSigner:async () => ({isConnected:true,publicKey:signerUser.publicKey,signTransaction:async (tx:Transaction) => { if(mutate) tx.instructions[1]!.data[0]=255; tx.sign(signerUser);afterSign();return tx }}) as unknown as ISolana })
  const transaction = () => new Transaction().add(SystemProgram.transfer({fromPubkey:user.publicKey,toPubkey:keys[0]!,lamports:1}))
  return { wallet,transaction,sends:()=>sends,commitment:()=>commitment,tamper:()=>{mutate=true},changeAccount:()=>{signerUser=Keypair.generate()},leaveDuringSigning:()=>{afterSign=()=>wallet.dispose()} }
}
test('wallet adapter checks exact signed contents and waits for finalized receipt',async () => {
  const f=setup();expect(await f.wallet.send(f.transaction())).toBe('fixture-signature');expect(f.sends()).toBe(1);expect(f.commitment()).toBe('finalized')
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
