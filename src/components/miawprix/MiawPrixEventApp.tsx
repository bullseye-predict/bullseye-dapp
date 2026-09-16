import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { ArrowLeft, Check, Copy } from 'lucide-react'
import { AppShell } from '../solz/AppShell'
import { CoinIdentity } from './CoinIdentity'
import { countdown, kickoffParts, matchState, programmeLabel } from './board'
import { miawPrixSource, type MiawPrixMatch } from './miawPrixSource'
import { useTokenMeta } from '../solz/tokenMeta'
import { resolvedTokenLogo } from '../solz/tokenIcon'
import '../../styles/miaw-prix.css'

/** Colosseum's canonical match namespace, not a Solana question ID. */
export const isMiawPrixMatchId = (id: string) => /^0x534f4c5a[0-9a-f]{56}$/i.test(id)

export function MiawPrixEventApp({ matchId, endpoint }: { matchId: string; endpoint: string }) {
  useLayoutEffect(() => { document.getElementById('boot-skeleton')?.remove() }, [])
  const source = useMemo(() => miawPrixSource(endpoint, '/api/prediction'), [endpoint])
  const [match, setMatch] = useState<MiawPrixMatch | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    source.match(matchId, controller.signal)
      .then((item) => { if (!controller.signal.aborted) setMatch(item) })
      .catch(() => { if (!controller.signal.aborted) setError('The MIAW PRIX programme is unavailable right now.') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [source, matchId])

  const tokenMeta = useTokenMeta(match?.sides.map((side) => side.mint) ?? [])
  const displayMatch = useMemo(() => match ? {
    ...match,
    sides: match.sides.map((side) => {
      const meta = tokenMeta.get(side.mint)
      return meta ? {
        ...side,
        name: side.name === side.symbol && meta.name ? meta.name : side.name,
        logoUrl: resolvedTokenLogo(side.logoUrl, meta.icon) || undefined,
      } : { ...side, logoUrl: resolvedTokenLogo(side.logoUrl) || undefined }
    }),
  } : null, [match, tokenMeta])
  const kickoff = kickoffParts(displayMatch?.scheduledStartAt ?? 0)
  const state = displayMatch ? matchState(displayMatch, now) : 'upcoming'
  const winner = displayMatch?.result
    ? displayMatch.sides.find((side) => side.teamId === displayMatch.result?.winnerTeamId || side.mint === displayMatch.result?.winnerMint)
    : null
  const relativeKickoff = displayMatch
    ? state === 'live'
      ? 'LIVE NOW'
      : state === 'upcoming'
        ? displayMatch.scheduledStartAt > now ? `IN ${countdown(displayMatch.scheduledStartAt - now)}` : 'NOT STARTED · AWAITING VERIFIED RESULT'
        : ''
    : ''
  return <AppShell className="solz-home mp-app" mainId="miaw-prix-event" mainClassName="mp-main mp-event-main" active="miawprix" skipTo="#miaw-prix-event" skipLabel="Skip to MIAW PRIX event" backToTopHref="#miaw-prix-event">
    <a className="mp-event-back" href="/miaw-prix"><ArrowLeft size={16} aria-hidden="true" /> MIAW PRIX schedule</a>
    <header className="mp-event-heading">
      <span className="mp-event-kicker">MATCH EVENT</span>
      <h1>{loading ? 'Loading matchup' : displayMatch ? `${displayMatch.sides.map((side) => side.symbol).join(' vs ')}` : 'Match unavailable'}</h1>
      {displayMatch && <p>CATWALK #{displayMatch.cycleIndex === null ? '—' : displayMatch.cycleIndex + 1} <span aria-hidden="true">/</span> {programmeLabel(displayMatch)} <span aria-hidden="true">/</span> {state}</p>}
    </header>
    {loading ? <div className="mp-event-panel mp-event-pending" aria-busy="true"><p className="sr-only" role="status">Loading the match event.</p><i className="mp-pending mp-pending--symbol" /><i className="mp-pending mp-pending--programme" /></div>
      : error || !displayMatch ? <div className="mp-event-panel" role="alert">{error || 'This recorded MIAW PRIX match could not be found.'}</div>
      : <>
        <section className="mp-event-panel" aria-label="Matchup">
          <div className="mp-event-kickoff"><span>KICKOFF</span><strong>{kickoff.date}</strong><b>{kickoff.time}</b>{relativeKickoff && <em>{relativeKickoff}</em>}</div>
          <div className="mp-event-pair">
            {displayMatch.sides[0] && <CoinIdentity {...displayMatch.sides[0]} />}
            <span className="mp-event-vs">VS</span>
            {displayMatch.sides[1] && <CoinIdentity {...displayMatch.sides[1]} />}
          </div>
        </section>
        <section className="mp-event-market" aria-label="Prediction market">
          <div>
            <h2>{displayMatch.result ? 'Prediction market closed' : 'Prediction market'}</h2>
            <p>{displayMatch.result
              ? `Match recorded${winner ? ` · ${winner.symbol} won` : ''}. Trading is closed; on-chain market settlement is tracked separately from this Colosseum result.`
              : 'This match ID is the prediction-market reference. Trading closes against the authoritative kickoff and result.'}</p>
          </div>
          <button type="button" aria-label={copied ? 'Match ID copied' : 'Copy match ID'} title={copied ? 'Copied' : 'Copy match ID'} onClick={async () => {
            try { await navigator.clipboard.writeText(displayMatch.matchId); setCopied(true); window.setTimeout(() => setCopied(false), 1_600) } catch { /* Clipboard access is optional. */ }
          }}>{copied ? <Check size={17} aria-hidden="true" /> : <Copy size={17} aria-hidden="true" />}</button>
        </section>
      </>}
  </AppShell>
}
