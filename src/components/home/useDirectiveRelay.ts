import { useEffect, useRef, useState } from 'react'
import { readDirectiveSettings, type DirectiveSettings } from '../solz/directiveRelay'

/**
 * The relay's published terms: whether directives are on sale, which mint pays
 * for them and what one costs in USD. An operator changes these in the game
 * admin editor, not here, so this is a read, not a subscription.
 *
 * It is retried, because a single failed read used to close the composer for
 * the life of the page: restart the control plane, or open the page while it is
 * starting, and the price slot said RELAY OFF until a manual reload - with the
 * relay healthy the whole time. A few spaced attempts, plus one more whenever
 * the tab is focused again, covers a restart without polling the endpoint.
 */
const RETRY_DELAYS_MS = [2_000, 5_000, 15_000]

export function useDirectiveRelay(active = true): { settings: DirectiveSettings | null; loading: boolean } {
  const [settings, setSettings] = useState<DirectiveSettings | null>(null)
  const [loading, setLoading] = useState(active)
  // Read by the focus handler, which must see the current value without making
  // the effect depend on it and tear the listener down on every read.
  const settingsRef = useRef<DirectiveSettings | null>(null)
  settingsRef.current = settings
  useEffect(() => {
    if (!active) { setSettings(null); setLoading(false); return }
    const controller = new AbortController()
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let attempt = 0
    const read = () => {
      if (!live) return
      setLoading(true)
      readDirectiveSettings('/api/directives', controller.signal)
        .then(value => { if (live) { attempt = 0; setSettings(value) } })
        .catch(() => {
          if (!live) return
          setSettings(null)
          const delay = RETRY_DELAYS_MS[attempt]
          if (delay === undefined) return
          attempt += 1
          timer = setTimeout(read, delay)
        })
        .finally(() => { if (live) setLoading(false) })
    }
    // A viewer who restarts the control plane and comes back to the tab gets a
    // fresh read, which is the moment they are most likely to have fixed it.
    const onFocus = () => { if (!settingsRef.current) { attempt = 0; read() } }
    read()
    window.addEventListener('focus', onFocus)
    return () => { live = false; controller.abort(); clearTimeout(timer); window.removeEventListener('focus', onFocus) }
  }, [active])
  return { settings, loading }
}
