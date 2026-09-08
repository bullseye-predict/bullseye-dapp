import { useEffect, useState } from 'react'
import type { SolzDataSource, SolzSnapshot } from '../solz/model'

export function useHomeData(source: SolzDataSource) {
  const [snapshot, setSnapshot] = useState<SolzSnapshot | null>(null)
  const [referenceSnapshot, setReferenceSnapshot] = useState<SolzSnapshot | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    let unsubscribe: (() => void) | undefined
    setError('')
    source.load().then((initial) => {
      if (!active) return
      setSnapshot(initial)
      setReferenceSnapshot(initial)
      unsubscribe = source.subscribe(setSnapshot)
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'The arena could not load.')
    })
    return () => { active = false; unsubscribe?.() }
  }, [source, attempt])

  return { snapshot, referenceSnapshot, error, retry: () => setAttempt((value) => value + 1) }
}
