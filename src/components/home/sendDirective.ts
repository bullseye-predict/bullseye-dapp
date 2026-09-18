import { Buffer } from 'buffer'
import { PublicKey, Transaction } from '@solana/web3.js'
import { awaitConfirmation } from '../../../packages/adapters/solana/manifest/browser'
import type { LiveArenaWalletPort } from '../arena/liveArenaAdapter'
import {
  confirmDirectivePayment,
  directiveToken,
  quoteDirective,
  type DirectiveEffort,
  type DirectivePurchase,
  type DirectiveSettings,
} from '../solz/directiveRelay'
/**
 * ONE DIRECTIVE, END TO END.
 *
 * Three parties have to agree before an agent hears anything: the control plane
 * names the live match and prices the directive, the viewer's wallet pays the
 * transfer, and the control plane confirms the transfer finalized. Each step
 * fails with a sentence the composer can show, because there is no step here a
 * viewer cannot be told the truth about.
 *
 * The match is NOT named by this client, and no room is joined to be told what
 * it is. The control plane owns the arena schedule, so it answers a quote for
 * whatever match is live at that moment. A capability signed by a match's own
 * room is still accepted by the relay for callers that hold one.
 *
 * The stages are reported as they pass. A directive costs real money and takes
 * two confirmations, so a single spinner would leave a viewer unable to tell a
 * slow wallet from a stalled payment.
 */
export type DirectiveStage = 'quote' | 'signature' | 'payment' | 'confirmation'

export type SendDirectiveInput = {
  wallet: LiveArenaWalletPort
  settings: DirectiveSettings
  text: string
  botId?: string
  effort?: DirectiveEffort
  onStage?: (stage: DirectiveStage) => void
}

export async function sendDirective(input: SendDirectiveInput): Promise<DirectivePurchase> {
  const token = directiveToken(input.settings)
  if (!token) throw new Error('Agent directives are not open yet.')
  const stage = (value: DirectiveStage) => input.onStage?.(value)

  stage('quote')
  const quote = await quoteDirective({
    wallet: input.wallet.address,
    token: token.symbol,
    text: input.text,
    botId: input.botId,
    effort: input.effort,
    idempotencyKey: crypto.randomUUID(),
  })

  // The relay builds the transfer, so this is the one place the viewer's own
  // client can check what it is about to be asked to sign. A quote that pays a
  // different amount than it quoted, or that is not payable by this wallet, is
  // refused here rather than after the money has moved.
  const owner = new PublicKey(input.wallet.address)
  const transaction = Transaction.from(Buffer.from(quote.transaction, 'base64'))
  if (!transaction.feePayer?.equals(owner)) throw new Error('The quoted payment is addressed to a different wallet.')
  if (quote.purchase.mint !== token.mint) throw new Error('The quoted payment is for a different token than the relay published.')

  stage('signature')
  const connection = await input.wallet.getConnection()
  const signer = await input.wallet.getSigner()
  const expected = Buffer.from(transaction.serializeMessage())
  const signed = await signer.signTransaction(transaction)
  if (!Buffer.from(signed.serializeMessage()).equals(expected)) throw new Error('The wallet changed the requested payment.')

  stage('payment')
  const signature = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false })
  await awaitConfirmation(connection, signature, quote.lastValidBlockHeight)

  stage('confirmation')
  return confirmDirectivePayment(quote.purchase.id, signature)
}
