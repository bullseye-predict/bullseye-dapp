import { expect, test } from 'bun:test'
import type { AlertRecord } from '../src/components/home/alerts/store'

const KEY = 'solz:alerts:v1'

/** The store reads localStorage the moment it is imported, so every case installs
 *  its own storage and then loads a fresh copy of the module. */
async function load(seed?: unknown) {
  const cells = new Map<string, string>()
  if (seed !== undefined) cells.set(KEY, JSON.stringify(seed))
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => cells.get(key) ?? null,
    setItem: (key: string, value: string) => { cells.set(key, value) },
    removeItem: (key: string) => { cells.delete(key) },
  }
  const store = await import(`../src/components/home/alerts/store?${cells.size}${Math.random()}`) as typeof import('../src/components/home/alerts/store')
  return {
    ...store,
    raw: () => JSON.parse(cells.get(KEY) ?? 'null') as unknown,
    written: () => (JSON.parse(cells.get(KEY) ?? 'null') as { state?: { records?: AlertRecord[] } } | null)?.state?.records ?? null,
  }
}

// getAlerts is the snapshot getAlerts hands to useSyncExternalStore, so the
// state can be read here without standing up a renderer.

test('a reload keeps the log, because a wallet redirect must not destroy the record of a trade', async () => {
  const stored = [{ id: '1', level: 'success', title: 'Funding the book with fUSDC', detail: 'Confirmed on Solana', at: 1_700_000_000_000 }]
  const { getAlerts } = await load(stored)
  expect(getAlerts()).toEqual(stored as AlertRecord[])
})

test('a repeated step is appended rather than replacing the earlier one, so retries stay on the record', async () => {
  const { pushAlert, getAlerts } = await load([])
  pushAlert({ level: 'info', title: 'Funding the book with fUSDC', detail: 'Waiting for your wallet signature' })
  pushAlert({ level: 'success', title: 'Funding the book with fUSDC', detail: 'Confirmed on Solana' })
  const alerts = getAlerts()
  expect(alerts).toHaveLength(2)
  expect(alerts.map(alert => alert.detail)).toEqual(['Confirmed on Solana', 'Waiting for your wallet signature'])
  expect(alerts[0]!.id).not.toBe(alerts[1]!.id)
})

test('every push is written through, so the newest record survives the next reload', async () => {
  const { pushAlert, written } = await load([])
  pushAlert({ level: 'error', title: 'Submitting your order', detail: 'Blockhash expired' })
  expect(written()).toHaveLength(1)
  expect(written()![0]!.detail).toBe('Blockhash expired')
})

test('only the user removes records: one dismissal and a clear, both persisted', async () => {
  const { pushAlert, dismissAlert, clearAlerts, getAlerts, written } = await load([])
  pushAlert({ level: 'success', title: 'first' })
  pushAlert({ level: 'success', title: 'second' })
  dismissAlert(getAlerts()[0]!.id)
  expect(getAlerts().map(alert => alert.title)).toEqual(['first'])
  expect(written()).toHaveLength(1)
  clearAlerts()
  expect(getAlerts()).toEqual([])
  expect(written()).toEqual([])
})

test('the log stops growing at 200 and drops the oldest, the one automatic removal there is', async () => {
  const { pushAlert, getAlerts } = await load([])
  for (let index = 0; index < 205; index += 1) pushAlert({ level: 'info', title: `step ${index}` })
  const alerts = getAlerts()
  expect(alerts).toHaveLength(200)
  expect(alerts[0]!.title).toBe('step 204')
  expect(alerts[199]!.title).toBe('step 5')
})

test('storage is untrusted input: a bad level cannot break the icon lookup and a script href is dropped', async () => {
  const { getAlerts } = await load([
    { id: 'a', level: 'catastrophe', title: 'unknown level', at: 1 },
    { id: 'b', level: 'success', title: 'hostile link', at: 2, href: 'javascript:alert(1)' },
    { id: 'c', level: 'success', title: 'real link', at: 3, href: 'https://explorer.solana.com/tx/abc' },
    { id: 'd', level: 'success', at: 4 },
    'not a record',
  ])
  const alerts = getAlerts()
  expect(alerts.map(alert => alert.title)).toEqual(['unknown level', 'hostile link', 'real link'])
  expect(alerts[0]!.level).toBe('info')
  expect(alerts[1]!.href).toBeUndefined()
  expect(alerts[2]!.href).toBe('https://explorer.solana.com/tx/abc')
})

test('unreadable storage leaves an empty log rather than taking the page down', async () => {
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: () => '{ not json',
    setItem: () => { throw Error('quota') },
  }
  const store = await import(`../src/components/home/alerts/store?broken${Math.random()}`) as typeof import('../src/components/home/alerts/store')
  expect(store.getAlerts()).toEqual([])
  expect(() => store.pushAlert({ level: 'error', title: 'still works' })).not.toThrow()
  expect(store.getAlerts()).toHaveLength(1)
})

test('a log written by the hand-rolled store this replaced is adopted, not discarded', async () => {
  // That store wrote a bare array under the same key. Someone mid-session must
  // not lose their history to the migration.
  const legacy = [{ id: 'old', level: 'error', title: 'Submitting your order', detail: 'Blockhash expired', at: 1_700_000_000_000 }]
  const { getAlerts, pushAlert, raw, written } = await load(legacy)
  expect(getAlerts()).toEqual(legacy as AlertRecord[])
  pushAlert({ level: 'success', title: 'Submitting your order' })
  // And is rewritten in the new envelope, so the legacy read happens once.
  expect((raw() as { state: unknown }).state).toBeDefined()
  expect(written()).toHaveLength(2)
})
