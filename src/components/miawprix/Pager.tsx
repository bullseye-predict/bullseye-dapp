import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'

/**
 * ONE pager for every MIAW PRIX table that needs one.
 *
 * The standings list every walking coin and the results list every settled
 * match of a month-long season, so both outgrow the page rather than the
 * viewport: a scroller inside a two-column board hides its own overflow behind
 * a thumb nobody looks for. Paging states the size of the thing up front
 * ("Showing 1-10 of 25") and makes the rest reachable in a known number of
 * steps.
 *
 * The schedule deliberately does NOT use this. It is the short, live surface —
 * what is about to happen, read top to bottom — and it keeps its sticky-header
 * scroller so a kickoff never moves to page two while someone is watching it.
 */
export function usePaged<T>(rows: readonly T[], pageSize: number) {
  const [page, setPage] = useState(1)
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
  // A refresh that drops rows must not strand the reader on a page that no
  // longer exists; clamping here rather than in every caller keeps the two
  // tables honest in the same way.
  useEffect(() => { setPage((current) => Math.min(current, pageCount)) }, [pageCount])
  const current = Math.min(page, pageCount)
  return {
    page: current,
    pageCount,
    visible: rows.slice((current - 1) * pageSize, current * pageSize),
    total: rows.length,
    from: rows.length ? (current - 1) * pageSize + 1 : 0,
    to: Math.min(current * pageSize, rows.length),
    move: (next: number) => setPage(Math.max(1, Math.min(pageCount, next))),
  }
}

/** The bar under a paged table: what is on screen, and how to reach the rest.
 *  It renders nothing at all when there is nothing to page through, so a season
 *  with four results does not carry a disabled control that never lights. */
export function Pager({ page, pageCount, from, to, total, noun, label, onMove }: {
  page: number
  pageCount: number
  from: number
  to: number
  total: number
  /** Plural noun for the range line, e.g. `coins`. */
  noun: string
  /** Accessible name for the navigation, e.g. `Standings pages`. */
  label: string
  onMove: (next: number) => void
}) {
  if (total === 0) return null
  return <div className="mp-pager">
    <span className="mp-pager-range" role="status">Showing {from}&ndash;{to} of {total} {noun}</span>
    {pageCount > 1 && <nav className="mp-pager-nav" aria-label={label}>
      <button type="button" onClick={() => onMove(page - 1)} disabled={page === 1}>
        <ArrowLeft size={14} aria-hidden="true" />Previous
      </button>
      <span>Page <b>{page}</b> of {pageCount}</span>
      <button type="button" onClick={() => onMove(page + 1)} disabled={page === pageCount}>
        Next<ArrowRight size={14} aria-hidden="true" />
      </button>
    </nav>}
  </div>
}
