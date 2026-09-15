import { useEffect, useState, type ReactNode } from 'react'
import { Tabs, TabPanel } from '../solz/ui'

/**
 * The three programme surfaces, laid out the way the page owner asked for them:
 *
 *   DESKTOP — two columns. Standings take three units on the left; the schedule
 *   takes two on the right, with the results stacked UNDER the schedule in that
 *   same right-hand column. Standings are the season's answer and get the room;
 *   the schedule and the results are the same kind of thing (a list of cards,
 *   one before and one after) so they share a column and read as one stack.
 *
 *   MOBILE — the same three surfaces as TABS.
 *
 * THE SWITCH IS REAL, NOT COSMETIC. Only one of the two layouts is ever built,
 * and inside the tab layout only the selected panel's children are built. The
 * cheap version of this — render everything, hide the rest with CSS or with
 * `hidden` — leaves three full tables in the DOM on a phone: a screen reader
 * walks rows the reader cannot see, in-page find matches them, and the browser
 * pays to lay all of them out. `hidden` is still set on the inactive panels so
 * their ids stay valid targets for the tablist's aria-controls, but they carry
 * nothing.
 *
 * The breakpoint is the one the rest of this page already turns on (900px, where
 * the season panel drops to a single column), so the layout changes once rather
 * than twice.
 */
export const MIAW_PRIX_NARROW = '(max-width: 900px)'

/**
 * Whether this viewport gets the tab layout.
 *
 * FALSE until the browser answers, which is what the server renders and what a
 * client without `matchMedia` keeps. That default is deliberate: the two-column
 * layout is a grid that stacks perfectly well when it is narrow, so a viewer who
 * never gets the switch sees all three surfaces rather than a tablist whose
 * buttons cannot do anything.
 */
export function useNarrow(media: string = MIAW_PRIX_NARROW): boolean {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const query = window.matchMedia?.(media)
    if (!query) return
    setNarrow(query.matches)
    const listen = () => setNarrow(query.matches)
    query.addEventListener('change', listen)
    return () => query.removeEventListener('change', listen)
  }, [media])
  return narrow
}

export type ProgrammeSurface = 'standings' | 'schedule' | 'results'

const TABS: ReadonlyArray<{ id: ProgrammeSurface; label: string }> = [
  { id: 'standings', label: 'Standings' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'results', label: 'Results' },
]

export function ProgrammeLayout({ narrow, standings, schedule, results }: {
  /** Supplied by the caller rather than read here, so the layout is a pure
   *  function of the viewport and can be rendered either way in a test. */
  narrow: boolean
  standings: ReactNode
  schedule: ReactNode
  results: ReactNode
}) {
  const [tab, setTab] = useState<ProgrammeSurface>('standings')

  if (!narrow) {
    return <div className="mp-board">
      <div className="mp-board-main">{standings}</div>
      <div className="mp-board-side">{schedule}{results}</div>
    </div>
  }

  const surfaces: Record<ProgrammeSurface, ReactNode> = { standings, schedule, results }
  return <div className="mp-board mp-board--tabs">
    <Tabs tabs={TABS} value={tab} onChange={setTab} label="MIAW PRIX programme" idPrefix="mp" className="mp-tabs" />
    {TABS.map((item) => <TabPanel key={item.id} id={item.id} idPrefix="mp" active={item.id === tab} className="mp-tab-panel">
      {item.id === tab ? surfaces[item.id] : null}
    </TabPanel>)}
  </div>
}
