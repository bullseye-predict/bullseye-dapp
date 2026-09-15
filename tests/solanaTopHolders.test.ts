import { describe, expect, test } from 'bun:test'
import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import { aggregateClaimHolders, ManifestHoldersReader } from '../packages/adapters/solana/manifest/holders'
import { positionAddress, TOKEN_PROGRAM_ID, vaultAddress } from '../packages/adapters/solana/wire'
import { venueVault, type ManifestBinding } from '../packages/adapters/solana/manifest/wire'

const program = Keypair.generate().publicKey
const manifest = Keypair.generate().publicKey
const question = Keypair.generate().publicKey
const collateral = Keypair.generate().publicKey

const binding = (outcome: 0 | 1): ManifestBinding => ({
  question, program: manifest, venue: Keypair.generate().publicKey, mint: Keypair.generate().publicKey,
  collateral, recipient: Keypair.generate().publicKey, bps: 1, outcome,
})

const u64 = (value: bigint) => { const out = Buffer.alloc(8); out.writeBigUInt64LE(value); return out }

/** SOLZPOS1: tag ++ vault[32] ++ market[32] ++ balances[16] ++ bump. */
function positionAccount(owner: PublicKey, balances: [bigint, bigint]) {
  const vault = vaultAddress(program, owner)
  const data = Buffer.concat([
    Buffer.from('SOLZPOS1'), vault.toBuffer(), question.toBuffer(),
    ...Array.from({ length: 16 }, (_, index) => u64(balances[index as 0 | 1] ?? 0n)),
    Buffer.from([0]),
  ])
  return { pubkey: positionAddress(program, question, vault), account: { owner: program, data } }
}

/** SOLZVLT2: tag ++ owner ++ agent ++ mint ++ escrow ++ 7 x u64 ++ 3 flags ++ u64. */
function vaultAccount(owner: PublicKey) {
  const key = vaultAddress(program, owner)
  const data = Buffer.concat([
    Buffer.from('SOLZVLT2'), owner.toBuffer(), PublicKey.default.toBuffer(), collateral.toBuffer(), PublicKey.default.toBuffer(),
    ...Array.from({ length: 7 }, () => u64(0n)),
    Buffer.from([1, 0, 0]), u64(0n),
  ])
  return { key, record: { owner: program, data } }
}

/** The scan slices [32..72) of a token account: owner[32] ++ amount(u64 LE). */
const tokenAccount = (address: PublicKey, owner: PublicKey, amount: bigint) =>
  ({ pubkey: address, account: { owner: TOKEN_PROGRAM_ID, data: Buffer.concat([owner.toBuffer(), u64(amount)]) } })

const book = (seats: [PublicKey, bigint][], asks: [PublicKey, bigint][]) => ({
  claimedSeats: () => seats.map(([publicKey, baseBalance]) => ({ publicKey, baseBalance })),
  asks: () => asks.map(([trader, numBaseAtoms]) => ({ trader, numBaseAtoms })),
}) as never

describe('on-chain claim holders', () => {
  test('sums the four custody buckets per wallet and drops empty holders', () => {
    const [a, b] = [Keypair.generate().publicKey.toBase58(), Keypair.generate().publicKey.toBase58()]
    const rows = aggregateClaimHolders(0, {
      seats: [{ trader: a, shares: 10n }],
      asks: [{ trader: a, shares: 5n }],
      // Two token accounts for the same wallet: the export instruction validates
      // its destination by mint and owner only, so claims can sit outside the ATA.
      tokens: [{ owner: a, shares: 3n }, { owner: a, shares: 2n }, { owner: b, shares: 0n }],
      positions: [{ owner: a, shares: 100n }, { owner: b, shares: 0n }],
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ owner: a, seatShares: 10n, reservedShares: 5n, walletShares: 5n, vaultShares: 100n, totalShares: 120n })
  })

  test('ranks by total shares and breaks ties on the address so polls do not reshuffle', () => {
    // Fixed addresses, deliberately fed in descending order: generated keys made
    // the tie already-sorted about half the time, so the test passed without the
    // tie-break roughly as often as with it.
    const [high, low] = ['zzTieBreakerHigh', 'aaTieBreakerLow']
    const rows = aggregateClaimHolders(1, {
      seats: [{ trader: high, shares: 7n }, { trader: low, shares: 7n }, { trader: 'mmWinner', shares: 9n }],
      asks: [], tokens: [], positions: [],
    })
    expect(rows.map(row => row.totalShares)).toEqual([9n, 7n, 7n])
    expect(rows.map(row => row.owner)).toEqual(['mmWinner', low, high])
    expect(rows.every(row => row.outcome === 1)).toBe(true)
  })

  test('the position scan filters on the market pubkey at byte 40 and slices owner+amount at byte 32', async () => {
    const holder = Keypair.generate().publicKey
    const connection = new Connection('http://localhost:1')
    const seen: { owner: string; filters: unknown[]; slice?: { offset: number; length: number } }[] = []
    connection.getProgramAccounts = (async (owner: PublicKey, config: { filters: unknown[]; dataSlice?: { offset: number; length: number } }) => {
      seen.push({ owner: owner.toBase58(), filters: config.filters, slice: config.dataSlice })
      return owner.equals(program) ? [positionAccount(holder, [5n, 0n])] : []
    }) as never
    const vault = vaultAccount(holder)
    connection.getMultipleAccountsInfo = (async (keys: PublicKey[]) => keys.map(key => key.equals(vault.key) ? vault.record : null)) as never

    const bindings = [binding(0), binding(1)] as const
    await new ManifestHoldersReader(connection, program).read(question, bindings, [null, null])

    const positions = seen.find(entry => entry.owner === program.toBase58())!
    // Byte 40 is where SOLZPOS1 puts the market: 8-byte tag then vault[32].
    expect(positions.filters).toEqual([{ dataSize: 201 }, { memcmp: { offset: 40, bytes: question.toBase58() } }])
    const scans = seen.filter(entry => entry.owner === TOKEN_PROGRAM_ID.toBase58())
    // Byte 0 is the mint and byte 32 the owner; the 40-byte window is
    // owner[32] ++ amount(u64 LE) and stops short of the state byte on purpose,
    // because claim accounts sit frozen between guarded calls.
    expect(scans.map(entry => entry.filters)).toEqual(bindings.map(item => [{ dataSize: 165 }, { memcmp: { offset: 0, bytes: item.mint.toBase58() } }]))
    expect(scans.map(entry => entry.slice)).toEqual([{ offset: 32, length: 40 }, { offset: 32, length: 40 }])
  })

  test('an activated outcome whose book will not decode reports a floor, not an empty book', async () => {
    const connection = new Connection('http://localhost:1')
    connection.getProgramAccounts = (async () => []) as never
    connection.getMultipleAccountsInfo = (async () => []) as never
    // Both bindings decoded, neither book did: seats and resting asks — two of the
    // four buckets — are missing from every holder on that side.
    const { holders, partial } = await new ManifestHoldersReader(connection, program)
      .read(question, [binding(0), binding(1)], [null, null])
    expect(holders).toEqual([])
    expect(partial).toBe(true)
  })

  test('a position whose vault account does not read is a floor, not a missing holder', async () => {
    const holder = Keypair.generate().publicKey
    const connection = new Connection('http://localhost:1')
    connection.getProgramAccounts = (async (owner: PublicKey) => owner.equals(program) ? [positionAccount(holder, [70n, 0n])] : []) as never
    connection.getMultipleAccountsInfo = (async (keys: PublicKey[]) => keys.map(() => null)) as never

    const { holders, partial } = await new ManifestHoldersReader(connection, program)
      .read(question, [binding(0), null], [book([], []), null])

    expect(holders).toEqual([])
    expect(partial).toBe(true)
  })

  test('reads both outcomes from chain, resolves vault PDAs to wallets and skips the venue vault', async () => {
    const holder = Keypair.generate().publicKey
    const seatTrader = Keypair.generate().publicKey
    const bindings = [binding(0), binding(1)] as const
    const vault = vaultAccount(holder)
    const connection = new Connection('http://localhost:1')
    const venue = venueVault(bindings[0].program, bindings[0].venue, bindings[0].mint)
    let mintScans = 0
    connection.getProgramAccounts = (async (owner: PublicKey, config: { filters: { memcmp?: { bytes: string } }[] }) => {
      if (owner.equals(program)) return [positionAccount(holder, [400n, 0n])]
      mintScans++
      if (config.filters.find(filter => filter.memcmp)!.memcmp!.bytes !== bindings[0].mint.toBase58()) return []
      // The book's own base vault is a token account owned by its own address,
      // holding every seat balance on the book. Counting it would add the whole
      // Manifest side a second time under an unrecognisable address.
      return [tokenAccount(Keypair.generate().publicKey, seatTrader, 25n), tokenAccount(venue, venue, 9_999n)]
    }) as never
    connection.getMultipleAccountsInfo = (async (keys: PublicKey[]) =>
      keys.map(key => key.equals(vault.key) ? vault.record : null)) as never

    const reader = new ManifestHoldersReader(connection, program)
    const { holders, partial } = await reader.read(question, bindings, [
      book([[seatTrader, 11n]], [[seatTrader, 4n]]),
      book([], []),
    ])

    expect(partial).toBe(false)
    expect(mintScans).toBe(2)
    const yes = holders.filter(row => row.outcome === 0)
    expect(yes.map(row => row.totalShares)).toEqual([400n, 40n])
    expect(yes[0]).toMatchObject({ owner: holder.toBase58(), vaultShares: 400n })
    expect(yes[1]).toMatchObject({ owner: seatTrader.toBase58(), seatShares: 11n, reservedShares: 4n, walletShares: 25n })
    expect(holders.some(row => row.owner === venue.toBase58())).toBe(false)
  })

  test('a failed scan reports partial rather than an empty leaderboard', async () => {
    const seatTrader = Keypair.generate().publicKey
    const bindings = [binding(0), null] as const
    const connection = new Connection('http://localhost:1')
    connection.getProgramAccounts = (async () => { throw new Error('gPA disabled on this RPC') }) as never
    connection.getMultipleAccountsInfo = (async () => []) as never

    const { holders, partial } = await new ManifestHoldersReader(connection, program)
      .read(question, bindings, [book([[seatTrader, 12n]], []), null])

    expect(partial).toBe(true)
    // The book is still readable, so the seat holder survives the failed scans.
    expect(holders).toHaveLength(1)
    expect(holders[0]).toMatchObject({ owner: seatTrader.toBase58(), seatShares: 12n, totalShares: 12n })
  })
})
