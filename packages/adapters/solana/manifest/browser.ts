import { Buffer } from 'buffer'
import { ComputeBudgetProgram, PublicKey, Transaction } from '@solana/web3.js'
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token'
import type { ISolana } from '@dynamic-labs/solana-core'
export interface ManifestWalletPort { address: string; getSigner(): Promise<ISolana> }
export interface SolanaTransactionPlanner { assertNetwork(): Promise<void>; latestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }> }
import { ManifestAdapter } from './adapter'
import { activateBook, bindingAddress, bookAddress, claimMintAddress, initializeClaimMint, moveClaims, prepareClaimAccount, registerBinding, type ManifestBinding } from './wire'
import { buildCreateQuestionMarket, changePosition, initializePosition, initializeVault, moveVaultCollateral, positionAddress, questionCreationDigest, questionMarketAddress, vaultAddress } from '../wire'

export class ManifestBrowserWallet {
  private active = true
  readonly owner: PublicKey
  constructor(readonly adapter: ManifestAdapter, readonly port: ManifestWalletPort, readonly planner?: SolanaTransactionPlanner) { this.owner = new PublicKey(port.address) }
  dispose() { this.active = false }
  private async signer() {
    if (!this.active) throw new Error('Network or wallet selection changed. Reconnect before signing.')
    const signer = await this.port.getSigner()
    const signerKey = signer.publicKey ? new PublicKey(signer.publicKey.toBytes()) : null
    if (!this.active || !signer.isConnected || !signerKey || !signerKey.equals(this.owner)) {
      const actual = signerKey ? `${signerKey.toBase58().slice(0, 4)}…${signerKey.toBase58().slice(-4)}` : 'disconnected'
      throw new Error(`Wallet account changed to ${actual}. Reconnect this account before trading.`)
    }
    await this.adapter.verifyDeployment()
    return signer
  }
  async send(tx: Transaction): Promise<string> {
    await this.signer()
    const connection = this.adapter.connection
    await this.planner?.assertNetwork()
    const recent = this.planner ? await this.planner.latestBlockhash() : await connection.getLatestBlockhash('confirmed')
    tx.feePayer = this.owner; tx.recentBlockhash = recent.blockhash
    // Keep precompile-relative instruction indexes stable by appending the
    // budget instruction. Runtime preprocesses compute-budget instructions.
    tx.instructions.push(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }))
    const simulation = await connection.simulateTransaction(tx)
    if (simulation.value.err) throw new Error(`Transaction simulation failed: ${JSON.stringify(simulation.value.err)}`)
    const consumed = simulation.value.unitsConsumed ?? 200_000
    tx.instructions[tx.instructions.length - 1] = ComputeBudgetProgram.setComputeUnitLimit({ units: Math.min(1_400_000, Math.max(50_000, Math.ceil(consumed * 1.15) + 5_000)) })
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
  async activateQuestion(apiUrl: string, draft: { eventId: string; matchId: string; questionId: string }): Promise<string[]> {
    const hex = (value: string, name: string, length: number) => {
      if (!new RegExp(`^0x[0-9a-fA-F]{${length * 2}}$`).test(value)) throw new Error(`Invalid ${name}`)
      return Uint8Array.from(Buffer.from(value.slice(2), 'hex'))
    }
    const plainHex = (value: unknown, name: string, length: number) => {
      if (typeof value !== 'string' || !new RegExp(`^[0-9a-fA-F]{${length * 2}}$`).test(value)) throw new Error(`Invalid ${name}`)
      return Uint8Array.from(Buffer.from(value, 'hex'))
    }
    const deployment = this.adapter.deployment
    const matchId = hex(draft.matchId, 'matchId', 32)
    const questionId = hex(draft.questionId, 'questionId', 32)
    const question = questionMarketAddress(deployment.predictionProgram, matchId, questionId)
    const signatures: string[] = []
    const config = await this.adapter.verifyDeployment()
    if (!await this.adapter.connection.getAccountInfo(question, 'confirmed')) {
      const response = await fetch(`${apiUrl.replace(/\/+$/, '')}/solana/market-permit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: this.owner.toBase58(), eventId: draft.eventId, questionId: draft.questionId }) })
      const value = await response.json() as Record<string, unknown>
      if (!response.ok) throw new Error(typeof value.message === 'string' ? value.message : typeof value.error === 'string' ? value.error : 'Question permit unavailable')
      if (value.matchId !== draft.matchId || value.questionId !== draft.questionId || value.marketId !== question.toBase58() || value.authority !== config.oracle.toBase58() || typeof value.expiresAt !== 'number' || !Number.isSafeInteger(value.expiresAt)) throw new Error('Permit does not match the selected question and wallet')
      const digest = plainHex(value.digest, 'permit digest', 32)
      const signature = plainHex(value.signature, 'permit signature', 64)
      const expected = await questionCreationDigest({ programId: deployment.predictionProgram, networkDomain: config.networkDomain, payer: this.owner, matchId, questionId, expirySeconds: BigInt(value.expiresAt as number) })
      if (!Buffer.from(digest).equals(Buffer.from(expected))) throw new Error('Permit digest does not match the selected question and wallet')
      const authority = await crypto.subtle.importKey('raw', Uint8Array.from(config.oracle.toBytes()).buffer, { name: 'Ed25519' }, false, ['verify'])
      if (!await crypto.subtle.verify('Ed25519', authority, Uint8Array.from(signature).buffer, Uint8Array.from(digest).buffer)) throw new Error('Invalid backend question permit signature')
      const create = buildCreateQuestionMarket(deployment.predictionProgram, this.owner, deployment.collateralMint, matchId, questionId, { authority: config.oracle, expirySeconds: BigInt(value.expiresAt as number), digest, signature })
      signatures.push(await this.send(new Transaction().add(...create)))
    }
    for (const outcome of [0, 1] as const) {
      const bindingKey = bindingAddress(deployment.predictionProgram, question, outcome)
      const venue = bookAddress(deployment.predictionProgram, question, outcome)
      const mint = claimMintAddress(deployment.predictionProgram, question, outcome)
      const [bindingRecord, mintRecord, venueRecord] = await this.adapter.connection.getMultipleAccountsInfo([bindingKey, mint, venue], 'confirmed')
      const binding: ManifestBinding = bindingRecord ? await this.adapter.binding(question, outcome) : {
        question,
        program: deployment.manifestProgram,
        venue,
        mint,
        collateral: deployment.collateralMint,
        recipient: PublicKey.default,
        bps: 1,
        outcome,
      }
      const transaction = new Transaction()
      if (!bindingRecord) transaction.add(registerBinding(deployment.predictionProgram, this.owner, question, deployment.manifestProgram, outcome))
      if (!mintRecord) transaction.add(initializeClaimMint(deployment.predictionProgram, this.owner, binding))
      if (!venueRecord) transaction.add(activateBook(deployment.predictionProgram, this.owner, binding))
      if (transaction.instructions.length) signatures.push(await this.send(transaction))
    }
    for (const outcome of [0, 1] as const) await this.adapter.readBook(await this.adapter.binding(question, outcome))
    return signatures
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
