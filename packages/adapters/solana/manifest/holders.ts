import { PublicKey, type Connection } from '@solana/web3.js'
import type { Market as ManifestMarket } from '@bonasa-tech/manifest-sdk'
import { decodePosition, decodeVault } from '../accounts'
import { TOKEN_PROGRAM_ID } from '../wire'
import { venueVault, type ManifestBinding, type Outcome } from './wire'

const atoms = (value: { toString(): string }) => BigInt(value.toString())

/** SOLZPOS1 is 8-byte tag ++ vault[32] ++ market[32] ++ balances[16] ++ bump, so
 *  the question market pubkey starts at byte 40. */
const POSITION_BYTES = 201
const POSITION_MARKET_OFFSET = 40
/** Classic SPL token account: mint[32] ++ owner[32] ++ amount(u64 LE) ++ … */
const TOKEN_ACCOUNT_BYTES = 165
const TOKEN_OWNER_OFFSET = 32
const TOKEN_SLICE_BYTES = 40
/** web3.js turns a >100-key read into a JSON-RPC batch, which public Solana
 *  endpoints reject outright. Same chunk the adapter uses. */
const BATCH_KEYS = 96

/**
 * One wallet's holding of one outcome, in claim atoms at 6dp — the same unit the
 * order book and the trade ticket quote.
 *
 * The four buckets are where a share can physically be, and a share is in
 * exactly one of them. Exporting a claim decrements the position balance and
 * mints the SPL in the same instruction and importing reverses it
 * (prediction_market_pinocchio manifest_tokens.rs, tags 24 and 25); depositing
 * to the venue moves that SPL into the book's own vault; resting an ask moves
 * atoms out of seat.baseBalance into the order without touching a token account.
 * So they are summed, never reconciled — and that is why the total is exact
 * rather than best-effort.
 */
export type ManifestClaimHolder = {
  owner: string
  outcome: Outcome
  /** The holder's own SPL claim accounts for this outcome's mint. */
  walletShares: bigint
  /** Withdrawable from the venue seat. */
  seatShares: bigint
  /** Committed to this holder's own resting asks. */
  reservedShares: bigint
  /** Complete sets still held inside the prediction position PDA. */
  vaultShares: bigint
  totalShares: bigint
}

export type ManifestHolderSources = {
  /** claimedSeats() of this outcome's book. */
  seats: readonly { trader: string; shares: bigint }[]
  /** asks() only. A bid reserves collateral, never shares, so counting one would
   *  credit a market maker for shares they have merely offered to buy. */
  asks: readonly { trader: string; shares: bigint }[]
  /** SPL accounts of this outcome's claim mint, venue vault already removed. */
  tokens: readonly { owner: string; shares: bigint }[]
  /** balances[outcome] of every position PDA on this question, by wallet. */
  positions: readonly { owner: string; shares: bigint }[]
}

/** Pure, and exported for tests: the summation rule is what is worth pinning. */
export function aggregateClaimHolders(outcome: Outcome, sources: ManifestHolderSources): ManifestClaimHolder[] {
  const rows = new Map<string, ManifestClaimHolder>()
  const row = (owner: string) => {
    const existing = rows.get(owner)
    if (existing) return existing
    const created: ManifestClaimHolder = { owner, outcome, walletShares: 0n, seatShares: 0n, reservedShares: 0n, vaultShares: 0n, totalShares: 0n }
    rows.set(owner, created)
    return created
  }
  // A wallet may hold the same mint in more than one token account: the export
  // instruction validates the destination by mint and owner only, so claims can
  // legitimately sit outside the canonical ATA. Summing by owner covers both.
  for (const entry of sources.tokens) row(entry.owner).walletShares += entry.shares
  for (const entry of sources.seats) row(entry.trader).seatShares += entry.shares
  for (const entry of sources.asks) row(entry.trader).reservedShares += entry.shares
  for (const entry of sources.positions) row(entry.owner).vaultShares += entry.shares
  return [...rows.values()]
    .map(item => ({ ...item, totalShares: item.walletShares + item.seatShares + item.reservedShares + item.vaultShares }))
    .filter(item => item.totalShares > 0n)
    // Ties break on the address so the leaderboard does not reshuffle between
    // two polls that returned identical balances in a different account order.
    .sort((a, b) => a.totalShares === b.totalShares ? a.owner.localeCompare(b.owner) : a.totalShares > b.totalShares ? -1 : 1)
}

/** `partial` means a source could not be read, not that it was empty — a
 *  leaderboard missing a scan is a different claim from one with no holders. */
export type ManifestHolderRead = { holders: ManifestClaimHolder[]; partial: boolean }

type PositionRow = { owner: string; balances: bigint[] }

/**
 * Every wallet holding either outcome of one guarded Manifest question, read
 * from chain.
 *
 * Seats and resting asks are free: the caller already holds the book accounts.
 * The two scans below are what the book cannot see — a wallet whose claims sit
 * in its own SPL account or in the position PDA appears in neither claimedSeats()
 * nor the order list, so the book can enrich a holder but can never discover one.
 */
export class ManifestHoldersReader {
  constructor(readonly connection: Connection, readonly predictionProgram: PublicKey) {}

  async read(
    question: PublicKey,
    bindings: readonly (ManifestBinding | null)[],
    books: readonly (ManifestMarket | null)[],
  ): Promise<ManifestHolderRead> {
    let partial = false
    const [positions, tokens] = await Promise.all([
      this.positions(question, () => { partial = true }).catch(() => { partial = true; return [] as PositionRow[] }),
      Promise.all(bindings.map(binding => binding
        ? this.tokenAccounts(binding).catch(() => { partial = true; return [] })
        : Promise.resolve([]))),
    ])
    const holders = ([0, 1] as const).flatMap(outcome => {
      if (!bindings[outcome]) return []
      const book = books[outcome] ?? null
      // An activated outcome whose book would not decode is not an empty book:
      // it silently removes the seat and resting-ask buckets from every holder on
      // that side. Flag the floor rather than publish two of four buckets as the
      // whole board. Before activateBook the book genuinely is empty, so this is
      // conservative in the right direction.
      if (!book) partial = true
      return aggregateClaimHolders(outcome, {
        seats: book ? book.claimedSeats().map(seat => ({ trader: seat.publicKey.toBase58(), shares: atoms(seat.baseBalance) })) : [],
        asks: book ? book.asks().map(order => ({ trader: order.trader.toBase58(), shares: atoms(order.numBaseAtoms) })) : [],
        tokens: tokens[outcome] ?? [],
        positions: positions.map(entry => ({ owner: entry.owner, shares: entry.balances[outcome] ?? 0n })),
      })
    })
    return { holders, partial }
  }

  /** One request returns every internal holder of BOTH outcomes, because a single
   *  position account carries all sixteen outcome balances. getProgramAccounts is
   *  one call returning many accounts, not a batch, so it needs no chunking — the
   *  vault hop below does. */
  private async positions(question: PublicKey, onDrop: () => void): Promise<PositionRow[]> {
    const accounts = await this.connection.getProgramAccounts(this.predictionProgram, {
      commitment: 'confirmed',
      filters: [{ dataSize: POSITION_BYTES }, { memcmp: { offset: POSITION_MARKET_OFFSET, bytes: question.toBase58() } }],
    })
    // decodePosition re-derives and asserts the canonical PDA, so an account that
    // merely matches the filter cannot enter the leaderboard.
    const decoded = accounts.flatMap(({ pubkey, account }) => {
      try {
        const position = decodePosition({ address: pubkey, owner: account.owner, data: account.data }, this.predictionProgram)
        return position.market.equals(question) ? [position] : []
      } catch { return [] }
    })
    // A position names a vault PDA and vaultAddress() is one-way, so the wallet
    // exists only inside the vault account. Without this hop the same person
    // shows up once as a seat and again as an unrenderable PDA.
    const vaults = [...new Set(decoded.map(position => position.vault.toBase58()))]
    const owners = new Map<string, string>()
    for (let offset = 0; offset < vaults.length; offset += BATCH_KEYS) {
      const keys = vaults.slice(offset, offset + BATCH_KEYS).map(value => new PublicKey(value))
      const records = await this.connection.getMultipleAccountsInfo(keys, 'confirmed')
      records.forEach((record, index) => {
        const key = keys[index]!
        // A position exists, so its vault must too — a missing record is a read
        // that did not land, and dropping it quietly deletes a real holder.
        if (!record) { onDrop(); return }
        try { owners.set(key.toBase58(), decodeVault({ address: key, owner: record.owner, data: record.data }, this.predictionProgram).owner.toBase58()) }
        // A vault failing its own PDA check is not a holder; one failing on tag
        // or length is a decode this build cannot do, and that is a floor.
        catch (reason) { if (!(reason instanceof Error) || !/Noncanonical/.test(reason.message)) onDrop() }
      })
    }
    return decoded.flatMap(position => {
      const owner = owners.get(position.vault.toBase58())
      if (!owner) onDrop()
      return owner ? [{ owner, balances: position.balances }] : []
    })
  }

  /** Every SPL account of this outcome's claim mint, with its owner already in
   *  the response. getTokenLargestAccounts cannot do this job: the RPC caps it at
   *  the twenty largest accounts and the rows carry no owner field at all. */
  private async tokenAccounts(binding: ManifestBinding): Promise<{ owner: string; shares: bigint }[]> {
    const accounts = await this.connection.getProgramAccounts(TOKEN_PROGRAM_ID, {
      commitment: 'confirmed',
      filters: [{ dataSize: TOKEN_ACCOUNT_BYTES }, { memcmp: { offset: 0, bytes: binding.mint.toBase58() } }],
      // owner[32] ++ amount(u64 LE). Deliberately stops short of the state byte:
      // claim accounts sit FROZEN between guarded calls, so filtering on state
      // would return an empty list on a perfectly healthy book.
      dataSlice: { offset: TOKEN_OWNER_OFFSET, length: TOKEN_SLICE_BYTES },
    })
    // The book's base vault is a token account owned by its own address, holding
    // every seat balance and every resting ask on the book. Counting it would add
    // the entire Manifest side a second time, under an address nobody recognises.
    const vault = venueVault(binding.program, binding.venue, binding.mint)
    return accounts.flatMap(({ pubkey, account }) => {
      if (pubkey.equals(vault) || account.data.length !== TOKEN_SLICE_BYTES) return []
      const view = new DataView(account.data.buffer, account.data.byteOffset, account.data.byteLength)
      return [{ owner: new PublicKey(account.data.subarray(0, 32)).toBase58(), shares: view.getBigUint64(32, true) }]
    })
  }
}
