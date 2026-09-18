import { Buffer } from 'buffer'
import { ComputeBudgetProgram, PublicKey, Transaction, TransactionMessage, VersionedTransaction, type Connection } from '@solana/web3.js'
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token'
import type { ISolana } from '@dynamic-labs/solana-core'
export interface ManifestWalletPort { address: string; getSigner(): Promise<ISolana> }
export interface SolanaTransactionPlanner { assertNetwork(): Promise<void>; latestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }> }
/** Per-transaction progress. The first trade on a question sends several
 *  transactions and the wallet prompts for each one; without a label the user
 *  cannot tell which prompt is which. */
export type SolanaTransactionStage = { step: string; status: 'preparing' | 'signing' | 'sent' | 'failed'; signature?: string; error?: string }
/** Node skew and provider throttling: the transaction is fine, the node that
 *  answered is behind or busy. Worth another pass either way. */
export const TRANSIENT = /blockhash not found|blockhashnotfound|429|rate limit/i

/** How often the signature is asked about while a transaction is in flight. */
const CONFIRM_POLL_MS = 2_500
/** Block height is only read to decide when to GIVE UP, and a blockhash lives
 *  about 60-90 seconds, so asking every sixth poll is six times more often than
 *  the answer can matter. */
const HEIGHT_EVERY = 6
/** A backstop for a node that keeps answering but never advances. Comfortably
 *  longer than blockhash expiry, so the height check is what normally ends it. */
const CONFIRM_TIMEOUT_MS = 150_000

/**
 * Wait for a signature, without a request per second.
 *
 * `connection.confirmTransaction` polls `getBlockHeight` every 1000 ms for the
 * whole life of the blockhash (web3.js lib/index.cjs.js, `checkBlockHeight`).
 * A first trade is six sequential transactions, so that alone was hundreds of
 * requests per trade — on the same two-slot gate the transactions themselves
 * are queued behind, and against the same rate limit they were losing to.
 *
 * `getSignatureStatuses` answers the question actually being asked, and once
 * every 2.5 seconds is fast enough: nothing downstream reacts to a confirmation
 * sooner than the next wallet prompt. Expiry still ends the wait, just read at
 * a cadence proportional to how fast it can change.
 */
export async function awaitConfirmation(
  connection: Connection,
  signature: string,
  lastValidBlockHeight: number,
  pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)),
  now = () => Date.now(),
): Promise<void> {
  const deadline = now() + CONFIRM_TIMEOUT_MS
  for (let poll = 0; ; poll++) {
    const statuses = await connection.getSignatureStatuses([signature], { searchTransactionHistory: false })
    const status = statuses.value[0]
    if (status) {
      if (status.err) throw new Error(`Transaction failed: ${signature}`)
      // Confirmed, not finalized. Every read in this adapter is already at
      // 'confirmed', so waiting for finalization buys no guarantee the rest of
      // the flow relies on, and costs another 13-32 seconds per transaction.
      if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') return
    }
    // Only after a real gap: a transaction landing in the first second or two
    // must not also cost a height read.
    if (poll > 0 && poll % HEIGHT_EVERY === 0) {
      const height = await connection.getBlockHeight('confirmed')
      if (height > lastValidBlockHeight) throw new Error('Blockhash expired before the transaction confirmed')
    }
    if (now() >= deadline) throw new Error('Confirmation timed out')
    await pause(CONFIRM_POLL_MS)
  }
}
export interface SolanaTransactionNotifier { (stage: SolanaTransactionStage): void }
import { ManifestAdapter } from './adapter'
import { TRADE_STEPS } from './steps'
import { beginSigningRun } from './throttle'
import { activateBook, bindingAddress, bookAddress, claimMintAddress, initializeClaimMint, moveClaims, prepareClaimAccount, registerBinding, type ManifestBinding } from './wire'
import { buildCreateQuestionMarket, changePosition, initializePosition, initializeVault, moveVaultCollateral, positionAddress, questionCreationDigest, questionMarketAddress, vaultAddress } from '../wire'

export class ManifestBrowserWallet {
  private active = true
  readonly owner: PublicKey
  constructor(readonly adapter: ManifestAdapter, readonly port: ManifestWalletPort, readonly planner?: SolanaTransactionPlanner, readonly notify?: SolanaTransactionNotifier) { this.owner = new PublicKey(port.address) }
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
  async send(tx: Transaction, step = 'Solana transaction'): Promise<string> {
    // Every signature in the app goes through here, so marking the run here
    // covers the trade ticket, the release flow and anything added later
    // without each of them having to remember to. The background pollers stand
    // down for as long as it lasts: a book price refreshed during a wallet
    // prompt is a request taken from the transaction the trader is waiting on.
    const endRun = beginSigningRun()
    this.notify?.({ step, status: 'preparing' })
    try {
      return await this.submit(tx, step)
    } catch (error) {
      this.notify?.({ step, status: 'failed', error: error instanceof Error ? error.message : String(error) })
      throw error
    } finally {
      endRun()
    }
  }
  private async submit(tx: Transaction, step: string): Promise<string> {
    await this.signer()
    const connection = this.adapter.connection
    await this.planner?.assertNetwork()
    tx.feePayer = this.owner
    // Keep precompile-relative instruction indexes stable by appending the
    // budget instruction. Runtime preprocesses compute-budget instructions.
    tx.instructions.push(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }))
    // Simulation must not depend on a client-fetched blockhash. A pooled RPC can
    // answer getLatestBlockhash from one node and simulateTransaction from another
    // node which has not seen it yet, producing BlockhashNotFound before any
    // instruction has run. The versioned simulation asks the RPC to replace the
    // placeholder hash with one from the node doing the simulation.
    let recent: { blockhash: string; lastValidBlockHeight: number }
    let simulation: Awaited<ReturnType<typeof connection.simulateTransaction>> | undefined
    for (let attempt = 0; ; attempt++) {
      // web3.js reports a rejected simulation two different ways: older paths
      // return it as value.err, newer ones throw SendTransactionError. Reading
      // only value.err meant the retry below never ran for the case it exists
      // for, and a transient skew or 429 killed the whole trade instead.
      let failure: string | null = null
      try {
        const message = new TransactionMessage({
          payerKey: this.owner,
          recentBlockhash: PublicKey.default.toBase58(),
          instructions: tx.instructions,
        }).compileToV0Message()
        simulation = await connection.simulateTransaction(new VersionedTransaction(message), {
          sigVerify: false,
          replaceRecentBlockhash: true,
        })
        if (!simulation.value.err) break
        failure = JSON.stringify(simulation.value.err)
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error)
      }
      // Anything that is not transient is a real rejection and must surface now.
      if (!TRANSIENT.test(failure) || attempt >= 4) throw new Error(`Transaction simulation failed: ${failure}`)
      await new Promise(resolve => setTimeout(resolve, 400 * 2 ** attempt))
    }
    if (!simulation) throw new Error('Transaction simulation did not complete')
    const consumed = simulation.value.unitsConsumed ?? 200_000
    tx.instructions[tx.instructions.length - 1] = ComputeBudgetProgram.setComputeUnitLimit({ units: Math.min(1_400_000, Math.max(50_000, Math.ceil(consumed * 1.15) + 5_000)) })
    // This is the transaction the wallet signs. Finalized avoids the same pool
    // skew during the subsequent preflight and confirmation calls.
    recent = await connection.getLatestBlockhash('finalized')
    tx.recentBlockhash = recent.blockhash
    const expected = Buffer.from(tx.serializeMessage())
    const signer = await this.signer()
    this.notify?.({ step, status: 'signing' })
    const signed = await signer.signTransaction(tx)
    await this.signer()
    if (!Buffer.from(signed.serializeMessage()).equals(expected)) throw new Error('Wallet changed transaction contents')
    // The send runs its own preflight, on whichever node answers it, and that is
    // a second chance for the skew the loop above already retries: the blockhash
    // simulated cleanly moments ago and then came back "Blockhash not found"
    // from a node that had not caught up, which killed the trade after the
    // trader had already approved it in their wallet.
    //
    // Resending is safe to repeat. These are the same signed bytes, so they are
    // the same transaction with the same signature — the cluster deduplicates
    // it rather than executing twice — and no second wallet prompt is needed.
    let signature: string
    for (let attempt = 0; ; attempt++) {
      try {
        signature = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false })
        break
      } catch (error) {
        const failure = error instanceof Error ? error.message : String(error)
        if (!TRANSIENT.test(failure) || attempt >= 2) throw error
        await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt))
      }
    }
    try {
      await awaitConfirmation(connection, signature, recent.lastValidBlockHeight)
      this.notify?.({ step, status: 'sent', signature })
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
      signatures.push(await this.send(new Transaction().add(...create), TRADE_STEPS.question))
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
      if (transaction.instructions.length) signatures.push(await this.send(transaction, TRADE_STEPS.book(outcome)))
    }
    for (const outcome of [0, 1] as const) await this.adapter.readBook(await this.adapter.binding(question, outcome))
    return signatures
  }
  async prepare(b: ManifestBinding) {
    const p = this.adapter.deployment.predictionProgram, vault = vaultAddress(p, this.owner)
    const position = positionAddress(p, b.question, vault)
    const ownerQuote = getAssociatedTokenAddressSync(b.collateral, this.owner)
    const recipientQuote = getAssociatedTokenAddressSync(b.collateral, b.recipient)
    const ownerClaims = getAssociatedTokenAddressSync(b.mint, this.owner)
    const accounts = await this.adapter.connection.getMultipleAccountsInfo([vault, position, ownerQuote, recipientQuote, ownerClaims])
    const tx = new Transaction()
    if (!accounts[0]) tx.add(initializeVault(p, this.owner, b.collateral, 1n))
    if (!accounts[1]) tx.add(initializePosition(p, this.owner, b.question, vault))
    // The guard transfers the taker fee to the venue recipient and requires that
    // account to already be an initialised SPL account; a missing one is System-owned
    // and fails the check as Custom(8100) on the first order that actually fills.
    // Idempotent, so it is a no-op once any trader has paid the one-time rent.
    if (!accounts[2]) tx.add(createAssociatedTokenAccountIdempotentInstruction(this.owner, ownerQuote, this.owner, b.collateral))
    if (!accounts[3]) tx.add(createAssociatedTokenAccountIdempotentInstruction(this.owner, recipientQuote, b.recipient, b.collateral))
    if (!accounts[4]) tx.add(prepareClaimAccount(this.owner, this.owner, b.mint))
    return tx.instructions.length ? this.send(tx, TRADE_STEPS.accounts) : undefined
  }
  /** Atomic complete-set purchase: collateralize both outcomes, sell the
   * opposite one with an on-chain minimum return, retain the selected claim.
   * A failed sale rolls back the deposit, split and export together. */
  async completeSetBuy(opposite: ManifestBinding, quantity: bigint, maximumCost: bigint, maximumFee: bigint) {
    if (quantity <= 0n || maximumCost <= 0n || maximumCost >= quantity) throw new Error('Invalid complete-set quote')
    const p = this.adapter.deployment.predictionProgram
    const tx = new Transaction().add(
      moveVaultCollateral(p, this.owner, getAssociatedTokenAddressSync(opposite.collateral, this.owner), quantity, 'deposit'),
      changePosition(p, this.owner, opposite.question, vaultAddress(p, this.owner), 'split', quantity),
      moveClaims(p, this.owner, opposite, quantity, 'export'),
    )
    const sale = await this.adapter.swap(this.owner, opposite, {
      side: 'SELL', inputAtoms: quantity, minimumOutputAtoms: quantity - maximumCost, maxFeeAtoms: maximumFee,
    })
    tx.add(...sale.instructions)
    return this.send(tx, TRADE_STEPS.completeSet(opposite.outcome))
  }
  /** `step` names the wallet prompt, for the same reason `claims` takes one: a
   *  claim run sends this twice — a redeem and then a vault withdrawal — and two
   *  unlabelled sends would reconcile onto one rail row. */
  async collateral(b: ManifestBinding, action: 'deposit' | 'withdraw' | 'split' | 'merge' | 'redeem', atoms?: bigint, step = 'Solana transaction') {
    const p = this.adapter.deployment.predictionProgram
    const tx = new Transaction()
    if (action === 'deposit' || action === 'withdraw') tx.add(moveVaultCollateral(p, this.owner, getAssociatedTokenAddressSync(b.collateral, this.owner), atoms!, action))
    else tx.add(changePosition(p, this.owner, b.question, vaultAddress(p, this.owner), action, atoms))
    return this.send(tx, step)
  }
  /** `step` names the wallet prompt. A trade must pass one: the stepper joins a
   *  stage onto a planned step by this string, and toast identity is keyed on it
   *  too, so two unlabelled sends in one flow would share an identity. */
  async claims(b: ManifestBinding, atoms: bigint, direction: 'export' | 'import', step = 'Solana transaction') {
    return this.send(new Transaction().add(moveClaims(this.adapter.deployment.predictionProgram, this.owner, b, atoms, direction)), step)
  }
}
