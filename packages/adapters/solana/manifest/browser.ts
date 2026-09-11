import { Buffer } from 'buffer'
import { ComputeBudgetProgram, PublicKey, Transaction } from '@solana/web3.js'
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token'
import type { ISolana } from '@dynamic-labs/solana-core'
export interface ManifestWalletPort { address: string; getSigner(): Promise<ISolana> }
import { ManifestAdapter } from './adapter'
import { moveClaims, prepareClaimAccount, type ManifestBinding } from './wire'
import { changePosition, initializePosition, initializeVault, moveVaultCollateral, positionAddress, vaultAddress } from '../wire'

export class ManifestBrowserWallet {
  private active = true
  readonly owner: PublicKey
  constructor(readonly adapter: ManifestAdapter, readonly port: ManifestWalletPort) { this.owner = new PublicKey(port.address) }
  dispose() { this.active = false }
  private async signer() {
    if (!this.active) throw new Error('Network or wallet selection changed. Reconnect before signing.')
    const signer = await this.port.getSigner()
    if (!this.active || !signer.isConnected || !signer.publicKey || !new PublicKey(signer.publicKey.toBytes()).equals(this.owner)) throw new Error('Wallet account changed')
    await this.adapter.verifyDeployment()
    return signer
  }
  async send(tx: Transaction): Promise<string> {
    await this.signer()
    const connection = this.adapter.connection
    const recent = await connection.getLatestBlockhash('confirmed')
    tx.feePayer = this.owner; tx.recentBlockhash = recent.blockhash
    tx.instructions.unshift(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }))
    const expected = Buffer.from(tx.serializeMessage())
    const signed = await (await this.signer()).signTransaction(tx)
    await this.signer()
    if (!Buffer.from(signed.serializeMessage()).equals(expected)) throw new Error('Wallet changed transaction contents')
    const signature = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false })
    try {
      const receipt = await connection.confirmTransaction({ ...recent, signature }, 'finalized')
      if (receipt.value.err) throw new Error(`Transaction failed: ${signature}`)
      return signature
    } catch (error) {
      throw new Error(`Check transaction ${signature} before retrying: ${error instanceof Error ? error.message : 'confirmation unavailable'}`)
    }
  }
  async prepare(b: ManifestBinding) {
    const p = this.adapter.deployment.predictionProgram, vault = vaultAddress(p, this.owner)
    const position = positionAddress(p, b.question, vault)
    const accounts = await this.adapter.connection.getMultipleAccountsInfo([vault, position])
    const tx = new Transaction()
    if (!accounts[0]) tx.add(initializeVault(p, this.owner, b.collateral, 1n))
    if (!accounts[1]) tx.add(initializePosition(p, this.owner, b.question, vault))
    tx.add(createAssociatedTokenAccountIdempotentInstruction(this.owner, getAssociatedTokenAddressSync(b.collateral, this.owner), this.owner, b.collateral), prepareClaimAccount(this.owner, this.owner, b.mint))
    return this.send(tx)
  }
  async collateral(b: ManifestBinding, action: 'deposit' | 'withdraw' | 'split' | 'merge' | 'redeem', atoms?: bigint) {
    const p = this.adapter.deployment.predictionProgram
    const tx = new Transaction()
    if (action === 'deposit' || action === 'withdraw') tx.add(moveVaultCollateral(p, this.owner, getAssociatedTokenAddressSync(b.collateral, this.owner), atoms!, action))
    else tx.add(changePosition(p, this.owner, b.question, vaultAddress(p, this.owner), action, atoms))
    return this.send(tx)
  }
  async claims(b: ManifestBinding, atoms: bigint, direction: 'export' | 'import') {
    return this.send(new Transaction().add(moveClaims(this.adapter.deployment.predictionProgram, this.owner, b, atoms, direction)))
  }
}
