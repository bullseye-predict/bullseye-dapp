import { expect, test } from 'bun:test'
import { createToastIds } from '../src/components/home/alerts/toastIds'

test('a spinner and its result share one id, so "Approve in your wallet" turns into its own outcome', () => {
  const toasts = createToastIds('solana-tx')
  const signing = toasts.idFor('Funding the book with fUSDC')
  expect(toasts.idFor('Funding the book with fUSDC')).toBe(signing)
})

test('a retry cannot overwrite the failure it is retrying, which is what made the error toast disappear', () => {
  const toasts = createToastIds('solana-tx')
  const failed = toasts.idFor('Funding the book with fUSDC')
  toasts.settle('Funding the book with fUSDC')
  // The error toast keeps `failed`; the next attempt must land somewhere else or
  // the success of the retry replaces the error the user never got to read.
  const retry = toasts.idFor('Funding the book with fUSDC')
  expect(retry).not.toBe(failed)
  expect(toasts.idFor('Funding the book with fUSDC')).toBe(retry)
})

test('separate steps never share a toast', () => {
  const toasts = createToastIds('solana-tx')
  expect(toasts.idFor('Activating the outcome book')).not.toBe(toasts.idFor('Submitting your order'))
})

test('a second submit collides with nothing left on screen from the first', () => {
  const first = createToastIds('solana-tx')
  const second = createToastIds('solana-tx')
  expect(second.idFor('Submitting your order')).not.toBe(first.idFor('Submitting your order'))
})

test('the prefix is kept, so a toast is still identifiable as a Solana transaction', () => {
  expect(createToastIds('solana-tx').idFor('Submitting your order')).toStartWith('solana-tx:Submitting your order:')
})
