import { useEffect, useState } from 'react'
import { subscribeDirectives, type DirectiveEntry } from './directiveHistory'
import type { PromptStatus } from '../solz/model'

/**
 * The directives this browser has paid for, newest first. Every caller shares
 * one store - see src/components/home/directiveHistory.ts - so the composer
 * that writes and the rail that reads never hold two copies of the same row.
 */
export function useDirectiveHistory(): DirectiveEntry[] {
  const [entries, setEntries] = useState<DirectiveEntry[]>([])
  useEffect(() => subscribeDirectives(setEntries), [])
  return entries
}

/**
 * The relay's purchase state said in the rail's own words.
 *
 * `paid` means the money landed and the agent has not been handed the directive
 * yet; `consumed` means it has. Neither is a word a spectator reads, and the
 * rail already paints `pending`, `accepted`, `executed` and `ignored`.
 */
export function directiveStatus(state: DirectiveEntry['state']): PromptStatus {
  switch (state) {
    case 'executed': return 'executed'
    case 'consumed': return 'accepted'
    case 'failed':
    case 'paid_expired': return 'ignored'
    default: return 'pending'
  }
}
