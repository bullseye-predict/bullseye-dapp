import { PublicKey, Transaction } from '@solana/web3.js'
import { getAssociatedTokenAddressSync } from '@solana/spl-token'
import { changePosition, moveVaultCollateral, vaultAddress } from '../wire'
import { moveClaims, takerFee, type ManifestBinding } from './wire'
import type { ManifestAdapter } from './adapter'

const SCALE = 1_000_000n
const cost = (q: bigint, p: bigint) => q * p / SCALE
export type ComplementaryMatch = { quantity: bigint; yesReturn: bigint; noReturn: bigint; maximumYesFee: bigint; maximumNoFee: bigint; minimumProfit: bigint }
type Bid = { price: bigint; quantity: bigint }
/** Cross only funded, strictly profitable bids. Exact $1 pairs are already a
 * coherent quote; a keeper must not spend its own balance paying fees on them. */
export function complementaryMatch(yes: readonly Bid[], no: readonly Bid[], capital: bigint, yesBps: number, noBps: number): ComplementaryMatch | null {
  const best = (rows: readonly Bid[]) => rows.filter(r => r.quantity > 0n && r.price > 0n && r.price < SCALE).slice().sort((a,b) => a.price > b.price ? -1 : a.price < b.price ? 1 : 0)[0]
  const y = best(yes), n = best(no)
  if (!y || !n || capital <= 0n || y.price + n.price <= SCALE) return null
  const quantity = [capital,y.quantity,n.quantity].reduce((a,b) => a < b ? a : b)
  const yesReturn = cost(quantity,y.price), noReturn = cost(quantity,n.price)
  if (!yesReturn || !noReturn) return null
  // A better fill may incur a larger fee. Reserve the maximum fee per share;
  // minimum return on each leg must cover both bounds as well as collateral.
  const maximumYesFee = takerFee(quantity,yesBps), maximumNoFee = takerFee(quantity,noBps)
  const minimumProfit = yesReturn + noReturn - quantity - maximumYesFee - maximumNoFee
  return minimumProfit < 0n ? null : {quantity,yesReturn,noReturn,maximumYesFee,maximumNoFee,minimumProfit}
}

export async function readComplementaryMatch(adapter: ManifestAdapter, owner: PublicKey, yes: ManifestBinding, no: ManifestBinding, capital: bigint) {
  if (yes.outcome !== 0 || no.outcome !== 1 || !yes.question.equals(no.question) || !yes.collateral.equals(no.collateral) || !yes.program.equals(no.program)) throw new Error('Matching requires both outcomes of the same question')
  const books = await Promise.all([adapter.readBook(yes),adapter.readBook(no)])
  const bids = books.map(book => book.bids().filter(o => !o.trader.equals(owner)).map(o => ({price:BigInt(o.price.toString()) / 10n ** 12n,quantity:BigInt(o.numBaseAtoms.toString())})))
  return complementaryMatch(bids[0]!,bids[1]!,capital,yes.bps,no.bps)
}

/** Both sales and their collateral backing commit together or roll back.
 * The caller must prepare its two claim accounts and position before this. */
export async function buildComplementaryMatch(adapter: ManifestAdapter, owner: PublicKey, yes: ManifestBinding, no: ManifestBinding, match: ComplementaryMatch) {
  if (yes.outcome !== 0 || no.outcome !== 1 || !yes.question.equals(no.question) || !yes.collateral.equals(no.collateral) || !yes.program.equals(no.program)) throw new Error('Matching requires both outcomes of the same question')
  if (match.quantity <= 0n || match.yesReturn + match.noReturn < match.quantity + match.maximumYesFee + match.maximumNoFee) throw new Error('Match cannot consume operator collateral')
  const p = adapter.deployment.predictionProgram
  const tx = new Transaction().add(
    moveVaultCollateral(p,owner,getAssociatedTokenAddressSync(yes.collateral,owner),match.quantity,'deposit'),
    changePosition(p,owner,yes.question,vaultAddress(p,owner),'split',match.quantity),
    moveClaims(p,owner,yes,match.quantity,'export'),
    moveClaims(p,owner,no,match.quantity,'export'),
  )
  for (const [b,minimumOutputAtoms,maxFeeAtoms] of [[yes,match.yesReturn,match.maximumYesFee],[no,match.noReturn,match.maximumNoFee]] as const) {
    const sale = await adapter.swap(owner,b,{side:'SELL',inputAtoms:match.quantity,minimumOutputAtoms,maxFeeAtoms})
    tx.add(...sale.instructions)
  }
  return tx
}
