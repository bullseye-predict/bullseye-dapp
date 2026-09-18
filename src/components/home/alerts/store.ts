import { create } from 'zustand'
import { persist, type PersistStorage } from 'zustand/middleware'

export type AlertLevel = 'error' | 'warning' | 'info' | 'success'
export type AlertRecord = { id: string; level: AlertLevel; title: string; detail?: string; href?: string; marketScope?: string; at: number }

/** A durable, reviewable log of what happened, separate from toasts. A toast is
 *  transient and easy to miss behind a dialog; this keeps every record — not
 *  only the failures — until the user clears it, and survives a reload because
 *  a wallet redirect or an accidental refresh should not destroy the evidence
 *  of what a trade did. */
const KEY = 'solz:alerts:v1'
/** The only automatic removal in the whole store. Without a ceiling the log
 *  would grow until localStorage refused the write; everything below it stays
 *  until the user clears a record or the list.
 *
 *  The badge stops counting at 99, so a log past that point is a wall of
 *  history nobody reads. At the ceiling the store keeps the newest KEEP
 *  records and drops the rest in one step, which puts the badge back to a
 *  readable number instead of parking it on "99+" for ever. */
const CEILING = 99
const KEEP = 20

/** Newest first, so the survivors are at the head. */
function trim(records: AlertRecord[]): AlertRecord[] {
  return records.length > CEILING ? records.slice(0, KEEP) : records
}
const LEVELS: AlertLevel[] = ['error', 'warning', 'info', 'success']

type Persisted = { records: AlertRecord[] }
type AlertState = Persisted & {
  push: (alert: Omit<AlertRecord, 'id' | 'at'> & { at?: number }) => void
  dismiss: (id: string) => void
  clear: () => void
}

let sequence = 0

/** Records come back from storage as untrusted JSON, so each field is checked
 *  rather than cast: an unknown level would break the icon lookup, and an
 *  arbitrary href would be rendered straight into a link. */
function restore(value: unknown): AlertRecord | null {
  const record = value as Partial<AlertRecord> | null
  if (!record || typeof record.id !== 'string' || typeof record.title !== 'string' || typeof record.at !== 'number') return null
  const href = typeof record.href === 'string' && /^https?:\/\//i.test(record.href) ? record.href : undefined
  return {
    id: record.id,
    title: record.title,
    at: record.at,
    level: LEVELS.includes(record.level as AlertLevel) ? record.level as AlertLevel : 'info',
    ...(typeof record.detail === 'string' ? { detail: record.detail } : {}),
    ...(href ? { href } : {}),
    ...(typeof record.marketScope === 'string' ? { marketScope: record.marketScope } : {}),
  }
}

/** A private window, a full quota or blocked site data must not take the app
 *  down with it; the log then simply lives for this page view only. */
const storage: PersistStorage<Persisted> = {
  getItem: name => {
    if (typeof localStorage === 'undefined') return null
    try {
      const raw = localStorage.getItem(name)
      if (!raw) return null
      const parsed: unknown = JSON.parse(raw)
      // The hand-rolled store this replaced wrote a bare array under the same
      // key. Read those logs rather than discarding someone's history.
      return Array.isArray(parsed) ? { state: { records: parsed } } : parsed as { state: Persisted; version?: number }
    } catch { return null }
  },
  setItem: (name, value) => {
    if (typeof localStorage === 'undefined') return
    try { localStorage.setItem(name, JSON.stringify(value)) } catch { /* keep the in-memory log */ }
  },
  removeItem: name => {
    if (typeof localStorage === 'undefined') return
    try { localStorage.removeItem(name) } catch { /* nothing to undo */ }
  },
}

export const useAlertStore = create<AlertState>()(persist(
  set => ({
    records: [],
    // Append-only. A repeated or retried step gets its own line because this is
    // a log of what happened rather than a status board, so nothing a previous
    // step recorded is ever overwritten.
    push: alert => set(state => {
      const at = alert.at ?? Date.now()
      return { records: trim([{ ...alert, at, id: `${at}-${sequence++}` }, ...state.records]) }
    }),
    dismiss: id => set(state => ({ records: state.records.filter(record => record.id !== id) })),
    clear: () => set({ records: [] }),
  }),
  {
    name: KEY,
    storage,
    partialize: state => ({ records: state.records }),
    merge: (persisted, current) => ({
      ...current,
      records: trim((Array.isArray((persisted as Persisted | undefined)?.records) ? (persisted as Persisted).records : [])
        .map(restore).filter((record): record is AlertRecord => record !== null)),
    }),
  },
))

export function pushAlert(alert: Omit<AlertRecord, 'id' | 'at'> & { at?: number }) { useAlertStore.getState().push(alert) }
export function clearAlerts() { useAlertStore.getState().clear() }
export function dismissAlert(id: string) { useAlertStore.getState().dismiss(id) }
export const getAlerts = () => useAlertStore.getState().records
export function useAlerts() { return useAlertStore(state => state.records) }

// Clearing the log in one tab should not be undone by another tab writing its
// stale copy back over it.
if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  if (event.key !== null && event.key !== KEY) return
  void useAlertStore.persist.rehydrate()
})
