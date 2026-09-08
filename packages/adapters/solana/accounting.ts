import { Connection, PublicKey, type VersionedTransactionResponse } from '@solana/web3.js'
import { base58 } from '@scure/base'
import { invariant, quoteCeil } from '../../prediction-core/validation'
import type { PortfolioPosition } from '../../prediction-core/market-data'
import { configAddress, FILL_DATA_LENGTH, marketCollateralAddress, positionAddress, TOKEN_PROGRAM_ID, vaultAddress, vaultCollateralAddress } from './wire'

export interface AccountingMarket { id: string; outcomes: number; slot: number; status: number; winner: number }
export interface AccountingInstruction { programId: string; accounts: string[]; data: Uint8Array; inner: Omit<AccountingInstruction, 'inner'>[] }
export interface AccountingTransaction { signature: string; slot: number; failed: boolean; instructions: AccountingInstruction[]; innerAvailable: boolean }
export interface PositionAccounting { quantity: bigint; costBasis: bigint; realizedPnl: bigint }
export const accountingKey = (market: string, outcome: number) => JSON.stringify([market, outcome])
function u64(data: Uint8Array, offset: number) { invariant(offset + 8 <= data.length, 'UNKNOWN_ACCOUNTING', 'Instruction is truncated.'); return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(offset, true) }
function key(data: Uint8Array, offset: number) { invariant(offset + 32 <= data.length, 'UNKNOWN_ACCOUNTING', 'Instruction key is truncated.'); return new PublicKey(data.subarray(offset, offset + 32)).toBase58() }

/** Integer allocation: floors first, then one atomic remainder unit per positive weight in ID order. */
export function allocateProportionally(total: bigint, weights: bigint[]): bigint[] {
  const sum = weights.reduce((sum, weight) => sum + weight, 0n)
  invariant(total >= 0n && weights.every(weight => weight >= 0n) && (sum > 0n || total === 0n), 'UNKNOWN_ACCOUNTING', 'Invalid payout allocation.')
  if (sum === 0n) return weights.map(() => 0n)
  const allocated = weights.map(weight => total * weight / sum)
  let remainder = total - allocated.reduce((sum, amount) => sum + amount, 0n)
  for (let i = 0; remainder > 0n && i < weights.length; i++) if (weights[i]! > 0n) { allocated[i] = allocated[i]! + 1n; remainder-- }
  invariant(remainder === 0n, 'UNKNOWN_ACCOUNTING', 'Payout dust did not reconcile.')
  return allocated
}
function sell(position: PositionAccounting, quantity: bigint, proceeds: bigint) {
  invariant(quantity > 0n && position.quantity >= quantity && proceeds >= 0n, 'UNKNOWN_ACCOUNTING', 'Position history does not cover the disposal.')
  const released = position.costBasis * quantity / position.quantity
  position.quantity -= quantity; position.costBasis -= released; position.realizedPnl += proceeds - released
}
function transfer(instruction: AccountingInstruction, source: string, destination: string, authority: string): bigint {
  const matching = instruction.inner.filter(inner => inner.programId === TOKEN_PROGRAM_ID.toBase58() && inner.accounts[0] === source && inner.accounts[1] === destination)
  if (!matching.length) return 0n // Program explicitly skips zero-amount SPL transfers.
  invariant(matching.length === 1 && matching[0]!.data.length === 9 && matching[0]!.data[0] === 3 && matching[0]!.accounts[2] === authority, 'UNKNOWN_ACCOUNTING', 'Expected one classic SPL transfer from the canonical authority.')
  return u64(matching[0]!.data, 1)
}

/** Replays successful, chronologically ordered direct program calls from vault creation.
 * Unrecognized CPI histories are deliberately incomplete; current frontend/relayer calls are direct. */
export function replaySolanaAccounting(input: { programId: string; account: string; collateralMint: string; markets: AccountingMarket[]; transactions: AccountingTransaction[] }): Map<string, PositionAccounting> {
  const { programId, account } = input
  const markets = new Map(input.markets.map(market => [market.id, market]))
  const positions = new Map<string, PositionAccounting>()
  const escrow = vaultCollateralAddress(programId, account).toBase58()
  let initialized = false
  let previousSlot = -1
  const get = (market: string, outcome: number) => {
    const id = accountingKey(market, outcome)
    if (!positions.has(id)) positions.set(id, { quantity: 0n, costBasis: 0n, realizedPnl: 0n })
    return positions.get(id)!
  }
  for (const transaction of input.transactions) {
    invariant(transaction.slot >= previousSlot, 'UNKNOWN_ACCOUNTING', 'History is out of chronological order.')
    previousSlot = transaction.slot
    if (transaction.failed) continue
    for (const instruction of transaction.instructions) {
      invariant(!instruction.inner.some(inner => inner.programId === programId && inner.accounts.includes(account)), 'UNKNOWN_ACCOUNTING', 'Program CPI position history is not supported.')
      if (instruction.programId !== programId) continue
      const { data, accounts } = instruction
      invariant(data.length > 0, 'UNKNOWN_ACCOUNTING', 'Program instruction is empty.')
      const tag = data[0]!
      if (tag === 2 && accounts[2] === account) {
        invariant(!initialized && data.length === 9 && accounts[1] === configAddress(programId).toBase58() && accounts[3] === escrow && accounts[4] === input.collateralMint && vaultAddress(programId, accounts[0]!).toBase58() === account, 'UNKNOWN_ACCOUNTING', 'Missing or noncanonical vault creation.')
        initialized = true
        continue
      }
      const relevant = (tag >= 6 && tag <= 8 && accounts[3] === account) || (tag === 16 && (accounts[2] === account || accounts[3] === account))
      if (!relevant) {
        invariant(tag <= 18 || !accounts.includes(account), 'UNKNOWN_ACCOUNTING', 'Unknown program instruction references the vault.')
        continue
      }
      invariant(initialized && transaction.innerAvailable, 'UNKNOWN_ACCOUNTING', 'Complete vault creation and SPL instruction history are required.')
      const marketId = tag === 16 ? accounts[1]! : accounts[2]!
      const market = markets.get(marketId)
      invariant(market && market.outcomes >= 2 && market.outcomes <= 16, 'UNKNOWN_ACCOUNTING', 'History includes an unregistered market.')
      if (transaction.slot > market.slot) continue
      const rows = Array.from({ length: market.outcomes }, (_, index) => get(marketId, index))
      if (tag === 16) {
        invariant(data.length === FILL_DATA_LENGTH && accounts[0] === configAddress(programId).toBase58(), 'UNKNOWN_ACCOUNTING', 'Unknown fill instruction layout.')
        const buyer = key(data, 33), seller = key(data, 171), outcome = data[97]!, quantity = u64(data, 277), price = u64(data, 285)
        invariant(buyer === accounts[2] && seller === accounts[3] && buyer !== seller && key(data, 65) === marketId && key(data, 203) === marketId && outcome < market.outcomes && outcome === data[235] && data[98] === 0 && data[236] === 1 && quantity > 0n, 'UNKNOWN_ACCOUNTING', 'Fill order bodies differ from instruction accounts.')
        invariant(accounts[4] === positionAddress(programId, marketId, buyer).toBase58() && accounts[5] === positionAddress(programId, marketId, seller).toBase58() && accounts[8] === vaultCollateralAddress(programId, buyer).toBase58() && accounts[9] === vaultCollateralAddress(programId, seller).toBase58(), 'UNKNOWN_ACCOUNTING', 'Fill uses noncanonical positions or collateral.')
        const cost = quoteCeil(quantity, price)
        invariant(transfer(instruction, accounts[8]!, accounts[9]!, buyer) === cost, 'UNKNOWN_ACCOUNTING', 'SPL fill payment does not match the execution.')
        if (buyer === account) { rows[outcome]!.quantity += quantity; rows[outcome]!.costBasis += cost }
        else sell(rows[outcome]!, quantity, cost)
      } else {
        invariant(accounts[1] === configAddress(programId).toBase58() && accounts[4] === positionAddress(programId, marketId, account).toBase58() && accounts[5] === escrow && accounts[6] === marketCollateralAddress(programId, marketId).toBase58() && accounts[7] === TOKEN_PROGRAM_ID.toBase58(), 'UNKNOWN_ACCOUNTING', 'Position change uses noncanonical accounts.')
        if (tag === 6 || tag === 7) {
          invariant(data.length === 9, 'UNKNOWN_ACCOUNTING', 'Unknown split/merge instruction layout.')
          const quantity = u64(data, 1)
          invariant(quantity > 0n, 'UNKNOWN_ACCOUNTING', 'Invalid complete-set amount.')
          const payment = tag === 6 ? transfer(instruction, escrow, accounts[6]!, account) : transfer(instruction, accounts[6]!, escrow, marketId)
          invariant(payment === quantity, 'UNKNOWN_ACCOUNTING', 'SPL complete-set payment does not match its instruction.')
          const allocations = allocateProportionally(quantity, rows.map(() => 1n))
          rows.forEach((row, index) => {
            if (tag === 6) { row.quantity += quantity; row.costBasis += allocations[index]! }
            else sell(row, quantity, allocations[index]!)
          })
        } else {
          invariant(data.length === 1 && (market.status === 3 || market.status === 4), 'UNKNOWN_ACCOUNTING', 'Redemption has no immutable final result.')
          const quantities = rows.map(row => row.quantity), total = quantities.reduce((sum, quantity) => sum + quantity, 0n)
          invariant(total > 0n, 'UNKNOWN_ACCOUNTING', 'Redemption history has no shares.')
          const payout = transfer(instruction, accounts[6]!, escrow, marketId)
          let proceeds: bigint[]
          if (market.status === 3) {
            invariant(market.winner < market.outcomes && payout === quantities[market.winner], 'UNKNOWN_ACCOUNTING', 'Winning payout differs from actual SPL transfer.')
            proceeds = quantities.map((_quantity, index) => index === market.winner ? payout : 0n)
          } else {
            invariant(payout === total / BigInt(market.outcomes) || payout === (total + BigInt(market.outcomes) - 1n) / BigInt(market.outcomes), 'UNKNOWN_ACCOUNTING', 'Void payout differs from cumulative program rounding.')
            proceeds = allocateProportionally(payout, quantities)
          }
          rows.forEach((row, index) => { if (row.quantity > 0n) sell(row, row.quantity, proceeds[index]!) })
        }
      }
    }
  }
  invariant(initialized, 'UNKNOWN_ACCOUNTING', 'History does not reach the original vault creation.')
  return positions
}

export function decodeAccountingTransaction(value: VersionedTransactionResponse, signature: string): AccountingTransaction {
  invariant(value.meta && value.transaction.signatures[0] === signature, 'UNKNOWN_ACCOUNTING', 'Transaction receipt does not match the requested signature.')
  const message = value.transaction.message
  const keys = message.getAccountKeys({ accountKeysFromLookups: value.meta.loadedAddresses })
  const readKeys = (indices: readonly number[]) => indices.map(index => { const key = keys.get(index); invariant(key, 'UNKNOWN_ACCOUNTING', 'Missing transaction account key.'); return key.toBase58() })
  const instructions = message.compiledInstructions.map((instruction, index) => ({
    programId: readKeys([instruction.programIdIndex])[0]!, accounts: readKeys(instruction.accountKeyIndexes), data: Uint8Array.from(instruction.data),
    inner: (value.meta!.innerInstructions?.find(inner => inner.index === index)?.instructions ?? []).map(inner => ({ programId: readKeys([inner.programIdIndex])[0]!, accounts: readKeys(inner.accounts), data: base58.decode(inner.data) })),
  }))
  return { signature, slot: value.slot, failed: value.meta.err !== null, instructions, innerAvailable: value.meta.innerInstructions !== undefined && value.meta.innerInstructions !== null }
}

export interface SolanaAccountingOptions { maxHistoryTransactions?: number; onIncomplete?: (reason: string) => void }
/** Bounded history reconstruction. Cached finalized receipts are immutable; pagination is still checked every read. */
export class SolanaAccountingReader {
  private readonly receipts = new Map<string, AccountingTransaction>()
  constructor(private readonly connection: Pick<Connection, 'getSignaturesForAddress' | 'getTransactions' | 'getBlockSignatures'>, private readonly programId: string, private readonly collateralMint: string, private readonly options: SolanaAccountingOptions = {}) {}
  async attach(account: string, markets: AccountingMarket[], snapshots: PortfolioPosition[], vaultExists: boolean): Promise<PortfolioPosition[]> {
    if (!vaultExists) {
      const empty = snapshots.every(row => row.quantity === 0n)
      return snapshots.map(row => ({ ...row, costBasis: empty ? 0n : null, realizedPnl: empty ? 0n : null, accountingComplete: empty }))
    }
    try {
      const cap = this.options.maxHistoryTransactions ?? 2000
      invariant(Number.isSafeInteger(cap) && cap > 0 && cap <= 20_000 && markets.length > 0, 'UNKNOWN_ACCOUNTING', 'Invalid or empty history scope.')
      const expected = new Set(markets.flatMap(market => Array.from({ length: market.outcomes }, (_, outcome) => accountingKey(market.id, outcome))))
      invariant(snapshots.length === expected.size && new Set(snapshots.map(row => accountingKey(row.marketId, row.outcomeId))).size === expected.size && snapshots.every(row => row.account === account && expected.has(accountingKey(row.marketId, row.outcomeId))), 'UNKNOWN_ACCOUNTING', 'Every outcome needs a finalized position snapshot.')
      const maxSlot = Math.max(...markets.map(market => market.slot)), vault = new PublicKey(account)
      let before: string | undefined, found = false, scanned = 0
      const transactions: AccountingTransaction[] = [], seen = new Set<string>()
      while (!found && scanned < cap) {
        const page = await this.connection.getSignaturesForAddress(vault, { before, limit: Math.min(250, cap - scanned), minContextSlot: maxSlot }, 'finalized')
        if (!page.length) break
        scanned += page.length
        invariant(page.every(item => !seen.has(item.signature)), 'UNKNOWN_ACCOUNTING', 'Signature pagination repeated a receipt.')
        page.forEach(item => seen.add(item.signature))
        const relevant = page.filter(item => item.slot <= maxSlot)
        const missing = relevant.filter(item => !this.receipts.has(item.signature))
        // Bound RPC batches; one large account cannot fan out unbounded concurrent requests.
        for (let offset = 0; offset < missing.length; offset += 40) {
          const batch = missing.slice(offset, offset + 40)
          const values = await this.connection.getTransactions(batch.map(item => item.signature), { commitment: 'finalized', maxSupportedTransactionVersion: 0 })
          values.forEach((value, index) => {
            invariant(value && value.slot === batch[index]!.slot, 'UNKNOWN_ACCOUNTING', 'Finalized transaction history is unavailable or inconsistent.')
            this.receipts.set(batch[index]!.signature, decodeAccountingTransaction(value, batch[index]!.signature))
          })
        }
        for (const item of relevant) {
          const transaction = this.receipts.get(item.signature)!
          transactions.push(transaction)
          if (!transaction.failed && transaction.instructions.some(instruction => instruction.programId === this.programId && instruction.data[0] === 2 && instruction.accounts[2] === account)) found = true
        }
        before = page[page.length - 1]!.signature
      }
      invariant(found, 'UNKNOWN_ACCOUNTING', 'Vault creation is pruned or exceeds the bounded history scan.')
      const bySlot = new Map<number, AccountingTransaction[]>()
      for (const transaction of transactions) { const group = bySlot.get(transaction.slot) ?? []; group.push(transaction); bySlot.set(transaction.slot, group) }
      const ordered: AccountingTransaction[] = []
      for (const [slot, group] of [...bySlot.entries()].sort((left, right) => left[0] - right[0])) {
        if (group.length > 1) {
          const block = await this.connection.getBlockSignatures(slot, 'finalized')
          const order = new Map(block.signatures.map((signature, index) => [signature, index]))
          invariant(group.every(transaction => order.has(transaction.signature)), 'UNKNOWN_ACCOUNTING', 'Canonical transaction order is unavailable.')
          group.sort((left, right) => order.get(left.signature)! - order.get(right.signature)!)
        }
        ordered.push(...group)
      }
      const ledger = replaySolanaAccounting({ account, programId: this.programId, collateralMint: this.collateralMint, markets, transactions: ordered })
      invariant(snapshots.every(row => (ledger.get(accountingKey(row.marketId, row.outcomeId))?.quantity ?? 0n) === row.quantity), 'UNKNOWN_ACCOUNTING', 'Replayed balances differ from finalized position PDAs.')
      return snapshots.map(row => ({ ...row, costBasis: ledger.get(accountingKey(row.marketId, row.outcomeId))?.costBasis ?? 0n, realizedPnl: ledger.get(accountingKey(row.marketId, row.outcomeId))?.realizedPnl ?? 0n, accountingComplete: true }))
    } catch (error) {
      this.options.onIncomplete?.(error instanceof Error ? error.message : 'Solana accounting history is unavailable.')
      return snapshots.map(row => ({ ...row, costBasis: null, realizedPnl: null, accountingComplete: false }))
    } finally {
      while (this.receipts.size > (this.options.maxHistoryTransactions ?? 2000)) this.receipts.delete(this.receipts.keys().next().value!)
    }
  }
}
