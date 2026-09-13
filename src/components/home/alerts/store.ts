import { useSyncExternalStore } from 'react'

export type AlertLevel = 'error' | 'warning' | 'info' | 'success'
export type AlertRecord = { id: string; level: AlertLevel; title: string; detail?: string; href?: string; at: number }

/** A durable, reviewable log of what happened, separate from toasts. A toast is
 *  transient and easy to miss behind a dialog; this keeps the record until the
 *  user clears it. Module-level so any component can push without prop drilling. */
const MAX = 50
let records: AlertRecord[] = []
const listeners = new Set<() => void>()
const emit = () => listeners.forEach(listener => listener())
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }

export function pushAlert(alert: Omit<AlertRecord, 'id' | 'at'> & { id?: string; at?: number }) {
  const record: AlertRecord = { id: alert.id ?? `${alert.level}:${alert.title}:${records.length}`, at: alert.at ?? Date.now(), ...alert }
  // Replacing by id keeps a retried step from stacking duplicates.
  records = [record, ...records.filter(item => item.id !== record.id)].slice(0, MAX)
  emit()
}
export function clearAlerts() { records = []; emit() }
export function dismissAlert(id: string) { records = records.filter(item => item.id !== id); emit() }

const EMPTY: AlertRecord[] = []
export function useAlerts() {
  return useSyncExternalStore(subscribe, () => records, () => EMPTY)
}
