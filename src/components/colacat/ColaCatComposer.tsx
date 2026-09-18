import { useEffect, useMemo, useRef, useState } from 'react'
import { PromptComposer } from '../home/PromptComposer'
import { createSolzDataSource } from '../solz/solzDataSource'
import type { SolzDataSource, SolzMatch, SolzSnapshot } from '../solz/model'
import { ComposerFrame } from './ComposerFrame'

/**
 * The arena's own PROMPT AGENT composer, wired to the sample source.
 *
 * THIS MODULE IS LOADED IN THE BROWSER AND NOWHERE ELSE. It is split out of
 * ColaCatPromptPanel.tsx purely so that the import list above can never be
 * evaluated on the server: `createSolzDataSource` reaches the Solana adapters,
 * which reach the `buffer` polyfill, which is CommonJS and throws
 * `require is not defined` the moment Astro renders this island on the server.
 * /colacat returned a 500 until this file existed. The panel reaches it through
 * `lazy(() => import('./ColaCatComposer'))` and only renders it after mount, so
 * the whole graph is a separate browser chunk rather than a server import.
 *
 * Keeping it here also keeps the lore page's server bundle to what the page
 * actually is - pictures and prose - instead of the arena's demo economy.
 */

type Ready = { source: SolzDataSource; snapshot: SolzSnapshot; match: SolzMatch }

/** The live match a directive goes to; falls back to the first match the sample has. */
function pickMatch(snapshot: SolzSnapshot): SolzMatch | undefined {
  return snapshot.matches.find((entry) => entry.id === snapshot.highlightMatchId && entry.phase === 'live')
    ?? snapshot.matches.find((entry) => entry.phase === 'live')
    ?? snapshot.matches[0]
}

export default function ColaCatComposer() {
  const [ready, setReady] = useState<Ready | null>(null)
  const [open, setOpen] = useState(false)
  const live = useRef(true)

  const source = useMemo(() => createSolzDataSource(), [])

  useEffect(() => {
    live.current = true
    let stop: (() => void) | undefined
    void source.load().then((first) => {
      if (!live.current) return
      const match = pickMatch(first)
      if (!match) return
      setReady({ source, snapshot: first, match })
      // Subscribed, so the balance and the fuel cost a reader sees after
      // sending a directive are the ones the source actually holds. The
      // unsubscribe below is what stops its 2.6s ticker when the page leaves.
      stop = source.subscribe((next) => {
        if (!live.current) return
        const current = pickMatch(next)
        if (current) setReady({ source, snapshot: next, match: current })
      })
    })
    return () => { live.current = false; stop?.() }
  }, [source])

  if (!ready) return <ComposerFrame />

  return (
    <PromptComposer
      source={ready.source}
      snapshot={ready.snapshot}
      match={ready.match}
      open={open}
      onToggle={() => setOpen(!open)}
      intermission={false}
      simulation
    />
  )
}
