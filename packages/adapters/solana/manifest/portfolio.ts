import { PublicKey } from '@solana/web3.js'
import { getAssociatedTokenAddressSync, unpackAccount, unpackMint } from '@solana/spl-token'
import { Market as ManifestMarket } from '@bonasa-tech/manifest-sdk'
import type { ManifestAdapter } from './adapter'
import { decodeMarket, decodePosition, decodeVault } from '../accounts'
import { positionAddress, TOKEN_PROGRAM_ID, vaultAddress, vaultCollateralAddress } from '../wire'
import { bindingAddress, bookAddress, claimMintAddress, decodeBinding, type Outcome } from './wire'

/** Resting price is a 1e18 fixed point of quote atoms per base atom. Both mints
 *  are 6dp, so dividing by 1e12 yields the same collateral-atom price the trade
 *  ticket sends and the order book renders. */
const PRICE_SCALE = 10n ** 18n
const PRICE_DIVISOR = 10n ** 12n
/** Eight keys per question, so one 96-key request covers twelve of them. */
const KEYS_PER_QUESTION = 8
const BATCH_KEYS = 96
const atoms = (value: { toString(): string }) => BigInt(value.toString())

export type ManifestRestingOrder = {
  sequence: string
  side: 'BUY' | 'SELL'
  /** Collateral atoms per share. */
  price: bigint
  /** Shares still resting. */
  quantity: bigint
  /** Collateral atoms still escrowed by this order. */
  reserved: bigint
  lastValidSlot: number
}

/** Where one outcome's shares and collateral actually sit. The venue seat, the
 *  wallet's own SPL account and the prediction vault are three separate
 *  custodians, and a portfolio that adds them without saying so hides which
 *  balance a trader can sell and which one they must move first. */
export type ManifestOutcomeHolding = {
  outcome: Outcome
  /** The book exists and was readable. */
  opened: boolean
  /** Shares in the trader's own SPL claim account. */
  walletShares: bigint
  /** Shares withdrawable from the venue seat. */
  seatShares: bigint
  /** Shares committed to resting sell orders. */
  reservedShares: bigint
  /** Shares held as complete sets inside the prediction position PDA. */
  vaultShares: bigint
  totalShares: bigint
  /** Collateral withdrawable from the venue seat. */
  seatCollateral: bigint
  /** Collateral escrowed by resting buy orders. */
  reservedCollateral: bigint
  /** Lifetime quote volume this trader has matched on the book. */
  quoteVolume: bigint
  bestBid?: bigint
  bestAsk?: bigint
  orders: ManifestRestingOrder[]
}

export type ManifestQuestionHolding = {
  marketId: string
  /** False before the first trader opens the question on chain. */
  opened: boolean
  /** 0 PENDING, 1 TRADING, 2 LOCKED, 3 RESOLVED, 4 VOIDED. */
  status: number
  winningOutcome: number
  paused: boolean
  startsAt: number
  locksAt: number
  outcomes: [ManifestOutcomeHolding, ManifestOutcomeHolding]
  /** Set when this question could not be decoded; its row is shown as unavailable
   *  rather than as an empty balance. */
  error?: string
}

export type ManifestPortfolio = {
  owner: string
  now: number
  /** Questions found from the trader's own claim accounts rather than from the
   *  live catalogue, so a settled position is not lost when its event rolls. */
  discovered: string[]
  /** Collateral in the trader's own associated token account. */
  walletCollateral: bigint
  /** Collateral parked in the shared prediction vault. */
  vaultCollateral: bigint
  vaultExists: boolean
  questions: ManifestQuestionHolding[]
  /** Questions whose on-chain state could not be read on this pass. */
  failures: number
}

const emptyOutcome = (outcome: Outcome): ManifestOutcomeHolding => ({
  outcome, opened: false, walletShares: 0n, seatShares: 0n, reservedShares: 0n, vaultShares: 0n,
  totalShares: 0n, seatCollateral: 0n, reservedCollateral: 0n, quoteVolume: 0n, orders: [],
})

/** Reserved quote for a resting bid, rounded up the way the venue escrows it.
 *  It takes the raw 1e18 fixed-point price rather than the divided display
 *  price: another client can rest an order at a finer granularity than this
 *  app's whole micro-units, and rounding first would under-report its escrow. */
export const bidEscrow = (quantity: bigint, priceFixedPoint: bigint) => (quantity * priceFixedPoint + PRICE_SCALE - 1n) / PRICE_SCALE

function tokenAmount(key: PublicKey, info: { owner: PublicKey; data: Buffer } | null): bigint {
  if (!info || !info.owner.equals(TOKEN_PROGRAM_ID)) return 0n
  try { return unpackAccount(key, info as never, TOKEN_PROGRAM_ID).amount } catch { return 0n }
}

/**
 * One finalized-enough view of every configured question for one trader.
 *
 * Reads are batched by account rather than by market: a twelve-question event is
 * two `getMultipleAccounts` requests, not twenty-four sequential book reads. The
 * deployment check is delegated to the shared ManifestAdapter, which memoises it
 * for every other panel on the page.
 */
export class ManifestPortfolioReader {
  constructor(private readonly adapter: ManifestAdapter, private readonly now: () => number = Date.now, private readonly commitment: 'confirmed' | 'finalized' = 'confirmed') {}

  /**
   * Questions this trader holds a claim account for, read from the chain.
   *
   * The question catalogue only lists questions that are still open, so an
   * unclaimed winning position disappears from it minutes after the match ends.
   * A claim mint is a PDA whose mint authority is its own question, which makes
   * the trader's own token accounts an authoritative index of every question
   * they have traded — derived back and checked, never trusted.
   */
  async discover(owner: string, limit = 96): Promise<string[]> {
    const { predictionProgram, collateralMint } = this.adapter.deployment
    const connection = this.adapter.connection
    const accounts = await connection.getParsedTokenAccountsByOwner(new PublicKey(owner), { programId: TOKEN_PROGRAM_ID }, this.commitment)
    const mints = [...new Set(accounts.value.flatMap(item => {
      const mint: unknown = (item.account.data.parsed as { info?: { mint?: unknown } })?.info?.mint
      return typeof mint === 'string' && mint !== collateralMint.toBase58() ? [mint] : []
    }))].slice(0, limit)
    if (!mints.length) return []
    const infos = await connection.getMultipleAccountsInfo(mints.map(mint => new PublicKey(mint)), this.commitment)
    const found = new Set<string>()
    infos.forEach((info, index) => {
      const mint = mints[index]!
      if (!info) return
      let authority: PublicKey | null
      try { authority = unpackMint(new PublicKey(mint), info, TOKEN_PROGRAM_ID).mintAuthority } catch { return }
      if (!authority) return
      // A claim mint's authority is its own question, so deriving the mint back
      // from the authority is what proves this token belongs to this venue.
      for (const outcome of [0, 1] as const) {
        if (claimMintAddress(predictionProgram, authority, outcome).toBase58() === mint) found.add(authority.toBase58())
      }
    })
    return [...found]
  }

  async read(owner: string, marketIds: readonly string[], discovered: readonly string[] = []): Promise<ManifestPortfolio> {
    const { predictionProgram, manifestProgram, collateralMint } = this.adapter.deployment
    const connection = this.adapter.connection
    await this.adapter.verifyDeployment()
    const trader = new PublicKey(owner)
    const vault = vaultAddress(predictionProgram, trader)

    const head = [vault, vaultCollateralAddress(predictionProgram, vault), getAssociatedTokenAddressSync(collateralMint, trader)]
    const headInfo = await connection.getMultipleAccountsInfo(head, this.commitment)
    let vaultCollateral = 0n
    let vaultExists = false
    if (headInfo[0]) {
      try {
        const decoded = decodeVault({ ...headInfo[0], address: vault }, predictionProgram)
        if (!decoded.mint.equals(collateralMint)) throw new Error('Vault uses another collateral.')
        vaultExists = true
        vaultCollateral = decoded.available
      } catch { throw new Error('Prediction vault balance is unavailable.') }
    }

    const questions = marketIds.map(id => new PublicKey(id))
    const keys = questions.flatMap(question => [
      question,
      bindingAddress(predictionProgram, question, 0),
      bindingAddress(predictionProgram, question, 1),
      bookAddress(predictionProgram, question, 0),
      bookAddress(predictionProgram, question, 1),
      getAssociatedTokenAddressSync(claimMintAddress(predictionProgram, question, 0), trader),
      getAssociatedTokenAddressSync(claimMintAddress(predictionProgram, question, 1), trader),
      positionAddress(predictionProgram, question, vault),
    ])
    const infos: (Awaited<ReturnType<typeof connection.getMultipleAccountsInfo>>[number])[] = []
    // web3.js turns a >100-key read into a JSON-RPC batch, which public Solana
    // endpoints reject outright. Chunk it here so every request stays single.
    for (let offset = 0; offset < keys.length; offset += BATCH_KEYS) {
      infos.push(...await connection.getMultipleAccountsInfo(keys.slice(offset, offset + BATCH_KEYS), this.commitment))
    }

    let failures = 0
    const holdings = marketIds.map((marketId, index) => {
      const base = index * KEYS_PER_QUESTION
      const question = questions[index]!
      const positionInfo = infos[base + 7]
      let vaultShares: bigint[] = []
      try {
        if (positionInfo) {
          const position = decodePosition({ ...positionInfo, address: keys[base + 7]! }, predictionProgram)
          if (position.market.equals(question) && position.vault.equals(vault)) vaultShares = position.balances
        }
      } catch { failures++ }

      const outcomes: [ManifestOutcomeHolding, ManifestOutcomeHolding] = [emptyOutcome(0), emptyOutcome(1)]
      for (const outcome of [0, 1] as const) {
        const holding = outcomes[outcome]
        holding.walletShares = tokenAmount(keys[base + 5 + outcome]!, infos[base + 5 + outcome] as never)
        holding.vaultShares = vaultShares[outcome] ?? 0n
        const bindingInfo = infos[base + 1 + outcome]
        const bookInfo = infos[base + 3 + outcome]
        if (!bindingInfo || !bookInfo) { holding.totalShares = holding.walletShares + holding.vaultShares; continue }
        try {
          const binding = decodeBinding(predictionProgram, keys[base + 1 + outcome]!, bindingInfo.owner, bindingInfo.data)
          if (!binding.program.equals(manifestProgram) || !binding.collateral.equals(collateralMint)) throw new Error('Wrong Manifest deployment binding.')
          if (!bookInfo.owner.equals(manifestProgram)) throw new Error('Wrong orderbook owner.')
          const book = ManifestMarket.loadFromBuffer({ address: binding.venue, buffer: bookInfo.data })
          if (!book.baseMint().equals(binding.mint) || !book.quoteMint().equals(binding.collateral)) throw new Error('Wrong orderbook assets.')
          const seat = book.claimedSeats().find(claimed => claimed.publicKey.equals(trader))
          const mine = (side: 'BUY' | 'SELL') => (side === 'BUY' ? book.bids() : book.asks())
            .filter(order => order.trader.equals(trader))
            .map(order => {
              const raw = atoms(order.price)
              const quantity = atoms(order.numBaseAtoms)
              return { sequence: order.sequenceNumber.toString(), side, price: raw / PRICE_DIVISOR, quantity, reserved: side === 'BUY' ? bidEscrow(quantity, raw) : 0n, lastValidSlot: Number(order.lastValidSlot) }
            })
          const bids = mine('BUY'), asks = mine('SELL')
          holding.opened = true
          holding.seatShares = seat ? atoms(seat.baseBalance) : 0n
          holding.seatCollateral = seat ? atoms(seat.quoteBalance) : 0n
          holding.quoteVolume = seat ? atoms(seat.quoteVolume) : 0n
          holding.reservedShares = asks.reduce((sum, order) => sum + order.quantity, 0n)
          holding.reservedCollateral = bids.reduce((sum, order) => sum + order.reserved, 0n)
          holding.orders = [...bids, ...asks]
          // Best prices come from the whole book, not only this trader's rows.
          holding.bestBid = book.bids().reduce<bigint | undefined>((best, order) => {
            const price = atoms(order.price) / PRICE_DIVISOR
            return best === undefined || price > best ? price : best
          }, undefined)
          holding.bestAsk = book.asks().reduce<bigint | undefined>((best, order) => {
            const price = atoms(order.price) / PRICE_DIVISOR
            return best === undefined || price < best ? price : best
          }, undefined)
        } catch { failures++ }
        holding.totalShares = holding.walletShares + holding.seatShares + holding.reservedShares + holding.vaultShares
      }

      const marketInfo = infos[base]
      if (!marketInfo) return { marketId, opened: false, status: 0, winningOutcome: 255, paused: false, startsAt: 0, locksAt: 0, outcomes }
      try {
        const decoded = decodeMarket({ ...marketInfo, address: question }, predictionProgram)
        return {
          marketId, opened: true, status: decoded.status, winningOutcome: decoded.winningOutcome, paused: decoded.paused,
          startsAt: Number(decoded.startsAtSeconds) * 1000, locksAt: Number(decoded.locksAtSeconds) * 1000, outcomes,
        }
      } catch (reason) {
        failures++
        return { marketId, opened: true, status: 0, winningOutcome: 255, paused: false, startsAt: 0, locksAt: 0, outcomes, error: reason instanceof Error ? reason.message : 'Question state is unreadable.' }
      }
    })

    return { owner, now: this.now(), discovered: [...discovered], walletCollateral: tokenAmount(head[2]!, headInfo[2] as never), vaultCollateral, vaultExists, questions: holdings, failures }
  }
}
