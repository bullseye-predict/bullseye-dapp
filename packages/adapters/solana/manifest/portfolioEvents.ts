import {
  FillLog,
  PlaceOrderLog,
  CancelOrderLog,
} from '@bonasa-tech/manifest-sdk'
import { PublicKey, type VersionedTransactionResponse } from '@solana/web3.js'
import { getAssociatedTokenAddressSync } from '@solana/spl-token'
import { decodeAccountingTransaction } from '../accounting'
import { TOKEN_PROGRAM_ID, vaultAddress } from '../wire'
import { MANIFEST_LOG, manifestLogBody, manifestProgramFrames } from './logs'
import type { ManifestBinding } from './wire'
import type {
  PortfolioEvent,
  PortfolioEventKind,
} from '../../../prediction-core/portfolio/model'
const atoms = (v: { inner: { toString(): string } }) =>
  BigInt(v.inner.toString())
const u64 = (data: Uint8Array, offset = 1) => {
  if (data.length < offset + 8) throw new Error('Truncated account event')
  return Buffer.from(data).readBigUInt64LE(offset)
}
/** Decode a whole receipt for an owner, never cache a single book's parse as a receipt. */
export function decodePortfolioEvents(
  tx: VersionedTransactionResponse,
  owner: string,
  program: string,
  manifest: string,
  bindings: readonly ManifestBinding[],
  transactionIndex: number,
): PortfolioEvent[] {
  if (tx.meta?.err) return []
  if (
    !tx.meta?.logMessages ||
    tx.blockTime == null ||
    tx.meta.logMessages.some((l) => /log truncated/i.test(l))
  )
    throw new Error('Transaction history is incomplete')
  const signature = tx.transaction.signatures[0]!,
    decoded = decodeAccountingTransaction(tx, signature)
  const rows: PortfolioEvent[] = [],
    trader = new PublicKey(owner),
    vault = vaultAddress(program, owner).toBase58()
  const base = {
    signature,
    slot: tx.slot,
    transactionIndex,
    at: tx.blockTime * 1000,
    owner,
    finality: 'finalized' as const,
  }
  const add = (
    kind: PortfolioEventKind,
    index: number,
    fields: Partial<PortfolioEvent>,
  ) =>
    rows.push({
      ...base,
      id: `${signature}:${index}:${kind}:${fields.outcome ?? ''}`,
      index,
      kind,
      ...fields,
    })
  const byBook = new Map(bindings.map((b) => [b.venue.toBase58(), b]))
  const frames = manifestProgramFrames(tx.meta.logMessages, manifest)
  // Map framed logs to their actual outer instruction, preserving split then
  // export then trade ordering even when they share one transaction.
  const roots = new Map<number, number>()
  let root = -1
  tx.meta.logMessages.forEach((line, i) => {
    if (/^Program \w+ invoke \[1\]$/.test(line)) root++
    roots.set(i, root)
  })
  const eventOrder = (index: number) =>
    (roots.get(index) ?? 0) * 1_000_000 + index * 10 + 100
  for (const frame of frames) {
    const body = manifestLogBody(frame.encoded, MANIFEST_LOG.fill)
    if (body) {
      const [log] = FillLog.deserialize(body),
        b = byBook.get(log.market.toBase58())
      if (
        !b ||
        !log.baseMint.equals(b.mint) ||
        !log.quoteMint.equals(b.collateral)
      )
        continue
      const quantity = atoms(log.baseAtoms),
        collateral = atoms(log.quoteAtoms)
      if (!quantity) continue
      const price = (collateral * 1_000_000n) / quantity
      const fields = {
        marketId: b.question.toBase58(),
        outcome: b.outcome,
        price: price.toString(),
      }
      add('MARK', eventOrder(frame.index), fields)
      const maker = log.maker.equals(trader),
        taker = log.taker.equals(trader)
      if (maker === taker) continue
      const buy = taker ? log.takerIsBuy : !log.takerIsBuy
      // The fee transfer is verified from actual token instructions. Allocate a
      // receipt's fee below across its taker fills, preserving atomic dust.
      add(buy ? 'BUY' : 'SELL', eventOrder(frame.index) + 1, {
        ...fields,
        shares: quantity.toString(),
        collateral: collateral.toString(),
        fee: taker ? null : '0',
        detail: taker ? 'Taker' : 'Maker',
      })
      continue
    }
    const placed = manifestLogBody(frame.encoded, MANIFEST_LOG.place)
    if (placed) {
      const [log] = PlaceOrderLog.deserialize(placed),
        b = byBook.get(log.market.toBase58())
      if (b && log.trader.equals(trader))
        add('ORDER', eventOrder(frame.index), {
          marketId: b.question.toBase58(),
          outcome: b.outcome,
          orderId: log.orderSequenceNumber.toString(),
          side: log.isBid ? 'BUY' : 'SELL',
          shares: atoms(log.baseAtoms).toString(),
          price: (atoms(log.price) / 1_000_000_000_000n).toString(),
        })
    }
    const cancelled = manifestLogBody(frame.encoded, MANIFEST_LOG.cancel)
    if (cancelled) {
      const [log] = CancelOrderLog.deserialize(cancelled),
        b = byBook.get(log.market.toBase58())
      if (b && log.trader.equals(trader))
        add('CANCEL', eventOrder(frame.index), {
          marketId: b.question.toBase58(),
          outcome: b.outcome,
          orderId: log.orderSequenceNumber.toString(),
        })
    }
  }
  const instructions = decoded.instructions
  const takers = rows.filter(
    (e) => (e.kind === 'BUY' || e.kind === 'SELL') && e.detail === 'Taker',
  )
  if (decoded.innerAvailable)
    instructions.forEach((instruction, outer) => {
      if (instruction.programId !== manifest) return
      const related = takers.filter(
        (e) => Math.floor(e.index / 1_000_000) === outer,
      )
      const feeAccounts = new Set(
        bindings
          .filter((b) =>
            related.some(
              (e) =>
                e.marketId === b.question.toBase58() && e.outcome === b.outcome,
            ),
          )
          .map(getAssociatedTokenAccountIdempotentAddress),
      )
      let actualFee = 0n
      for (const inner of instruction.inner)
        if (
          inner.programId === TOKEN_PROGRAM_ID.toBase58() &&
          inner.data[0] === 3 &&
          feeAccounts.has(inner.accounts[1]!) &&
          inner.accounts[2] === owner
        )
          actualFee += u64(inner.data)
      const total = related.reduce((n, e) => n + BigInt(e.collateral!), 0n)
      let remaining = actualFee
      related.forEach((e, i) => {
        const fee =
          i === related.length - 1
            ? remaining
            : total
              ? (actualFee * BigInt(e.collateral!)) / total
              : 0n
        e.fee = fee.toString()
        remaining -= fee
      })
    })
  const keySet = new Set(bindings.map((b) => b.question.toBase58()))
  instructions.forEach((instruction, index) => {
    const { accounts: a, data } = instruction,
      tag = data[0]
    const eventIndex = index * 1_000_000
    if (instruction.programId === program) {
      const marketId = a[2]
      if ((tag === 10 || tag === 11) && marketId && keySet.has(marketId)) {
        for (const outcome of [0, 1] as const)
          add('SETTLEMENT', eventIndex + outcome, {
            marketId,
            outcome,
            price: (tag === 11
              ? 500_000n
              : data[1] === outcome
                ? 1_000_000n
                : 0n
            ).toString(),
          })
      }
      if (a[0] !== owner) return
      if (tag === 4 || tag === 5)
        add(tag === 4 ? 'DEPOSIT' : 'WITHDRAW', eventIndex, {
          collateral: u64(data).toString(),
          detail: 'Prediction vault',
        })
      if (marketId && a[3] === vault && keySet.has(marketId)) {
        if (tag === 6 || tag === 7)
          add(tag === 6 ? 'SPLIT' : 'MERGE', eventIndex, {
            marketId,
            shares: u64(data).toString(),
            collateral: u64(data).toString(),
          })
        if (tag === 8) {
          if (!decoded.innerAvailable)
            throw new Error('Redemption payment instructions are unavailable')
          const payout = instruction.inner
            .filter(
              (i) =>
                i.programId === TOKEN_PROGRAM_ID.toBase58() &&
                i.data[0] === 3 &&
                i.accounts[0] === a[6] &&
                i.accounts[1] === a[5],
            )
            .reduce((n, i) => n + u64(i.data), 0n)
          add('CLAIM', eventIndex, {
            marketId,
            collateral: payout.toString(),
            detail: 'Settled payout redeemed',
          })
        }
        if (tag === 24 || tag === 25) {
          const binding = bindings.find(
            (b) =>
              b.question.toBase58() === marketId && b.mint.toBase58() === a[6],
          )
          if (!binding) throw new Error('Claim custody metadata is unavailable')
          add('CUSTODY', eventIndex, {
            marketId,
            outcome: binding.outcome,
            shares: u64(data).toString(),
            vaultChange: ((tag === 24 ? -1n : 1n) * u64(data)).toString(),
            detail:
              tag === 24
                ? 'Claims exported to wallet'
                : 'Claims imported to vault',
          })
        }
      }
    }
    if (
      instruction.programId === manifest &&
      a[0] === owner &&
      (tag === 2 || tag === 3)
    ) {
      const b = byBook.get(a[1]!)
      if (b)
        add('CUSTODY', eventIndex, {
          marketId: b.question.toBase58(),
          outcome: b.outcome,
          detail:
            tag === 2 ? 'Deposited to order book' : 'Withdrawn from order book',
          shares: a[5] === b.mint.toBase58() ? u64(data).toString() : undefined,
          collateral:
            a[5] === b.collateral.toBase58() ? u64(data).toString() : undefined,
        })
    }
    // Known program transfers belong to the operation decoded above. Other
    // programs may transfer tokens by CPI; those are external portfolio flows.
    if (
      instruction.programId !== program &&
      instruction.programId !== manifest &&
      instruction.inner.some(
        (i) => i.programId === program || i.programId === manifest,
      )
    )
      throw new Error(
        'Nested trading operation requires a supported receipt decoder',
      )
    const transfers =
      instruction.programId === program || instruction.programId === manifest
        ? []
        : [instruction, ...instruction.inner]
    transfers.forEach((transfer, transferIndex) => {
      const transferTag = transfer.data[0]
      if (
        transfer.programId === TOKEN_PROGRAM_ID.toBase58() &&
        (transferTag === 3 || transferTag === 12)
      ) {
        const source = transfer.accounts[0],
          destination = transfer.accounts[transferTag === 12 ? 2 : 1]
        const balances = [
          ...(tx.meta!.preTokenBalances ?? []),
          ...(tx.meta!.postTokenBalances ?? []),
        ]
        const keys = tx.transaction.message.getAccountKeys({
          accountKeysFromLookups: tx.meta!.loadedAddresses,
        })
        const token = (address: string | undefined) =>
          balances.find((b) => keys.get(b.accountIndex)?.toBase58() === address)
        const from = token(source),
          to = token(destination)
        if ((from?.owner === owner) === (to?.owner === owner)) return
        const mine = from?.owner === owner ? from : to,
          incoming = to?.owner === owner
        const b = bindings.find((b) => b.mint.toBase58() === mine?.mint)
        if (b)
          add(
            incoming ? 'TRANSFER_IN' : 'TRANSFER_OUT',
            eventIndex + transferIndex,
            {
              marketId: b.question.toBase58(),
              outcome: b.outcome,
              shares: u64(transfer.data).toString(),
            },
          )
        else if (bindings.some((b) => b.collateral.toBase58() === mine?.mint))
          add(incoming ? 'DEPOSIT' : 'WITHDRAW', eventIndex + transferIndex, {
            collateral: u64(transfer.data).toString(),
            detail: 'External wallet transfer',
          })
      }
    })
  })
  return rows
}
function getAssociatedTokenAccountIdempotentAddress(b: ManifestBinding) {
  return getAssociatedTokenAddressSync(b.collateral, b.recipient).toBase58()
}
