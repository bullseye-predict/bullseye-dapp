import { useSyncExternalStore } from 'react'

export type AlertLevel = 'error' | 'warning' | 'info' | 'success'
export type AlertRecord = { id: string; level: AlertLevel; title: string; detail?: string; href?: string; at: number }

/** A durable, reviewable log of what happened, separate from toasts. A toast is
 *  transient and easy to miss behind a dialog; this keeps every record — not
 *  only the failures — until the user clears it, and survives a reload because
 *  a wallet redirect or an accidental refresh should not destroy the evidence
 *  of what a trade did. Module-level so any component can push without prop
 *  drilling; a hand-rolled useSyncExternalStore store, so no zustand or
 *  nanostores dependency is involved. */
const KEY = 'solz:alerts:v1'
/** The only automatic removal in the whole store. Without a ceiling the log
 *  would grow until localStorage refused the write; everything below it stays
 *  until the user clears a record or the list. */
const MAX = 200
const LEVELS: AlertLevel[] = ['error', 'warning', 'info', 'success']

let sequence = 0
let records: AlertRecord[] = load()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach(listener => listener())
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }

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
  }
}

function load(): AlertRecord[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(stored) ? stored.map(restore).filter((record): record is AlertRecord => record !== null).slice(0, MAX) : []
  } catch { return [] }
}

function save() {
  if (typeof localStorage === 'undefined') return
  // A private window or a full quota must not take the app down with it; the
  // log then simply lives for this page view only.
  try { localStorage.setItem(KEY, JSON.stringify(records)) } catch { /* keep the in-memory log */ }
}

export function pushAlert(alert: Omit<AlertRecord, 'id' | 'at'> & { at?: number }) {
  const at = alert.at ?? Date.now()
  // Append-only. A repeated or retried step gets its own line because this is a
  // log of what happened rather than a status board, so nothing a previous step
  // recorded is ever overwritten.
  records = [{ ...alert, at, id: `${at}-${sequence++}` }, ...records].slice(0, MAX)
  emit(); save()
}
export function clearAlerts() { records = []; emit(); save() }
export function dismissAlert(id: string) { records = records.filter(record => record.id !== id); emit(); save() }

// Clearing the log in one tab should not be undone by another tab writing its
// stale copy back over it.
if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  if (event.key !== null && event.key !== KEY) return
  records = load()
  emit()
})

const EMPTY: AlertRecord[] = []
export function useAlerts() {
  return useSyncExternalStore(subscribe, () => records, () => EMPTY)
}
