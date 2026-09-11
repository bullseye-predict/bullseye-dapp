/** Stable browser-rendered identicon: no files, requests, or stored image assets. */
export function canonicalMatchId(id: string) { return id.trim().toLowerCase().replace(/^arena-/, '').replace(/^0x/, '') }
export function matchGlyph(id: string) {
  let hash = 2166136261
  for (const c of canonicalMatchId(id)) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619)
  if (!hash) hash = 1
  const hue = (hash >>> 0) % 360
  const cells: [number, number][] = []
  for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) {
    hash ^= hash << 13; hash ^= hash >>> 17; hash ^= hash << 5
    if (hash & 1) { cells.push([x, y]); if (x !== 2) cells.push([4 - x, y]) }
  }
  return { hue, cells }
}
export function MatchAvatar({ id }: { id: string }) {
  const { hue, cells } = matchGlyph(id)
  return <svg className="pf-match-avatar" viewBox="0 0 7 7" aria-hidden="true"><rect width="7" height="7" rx="1" fill={`hsl(${hue} 25% 17%)`}/>{cells.map(([x, y]) => <rect key={`${x}:${y}`} x={x + 1} y={y + 1} width="1" height="1" fill={`hsl(${hue} 65% 70%)`}/>)}</svg>
}
export type MatchMetadata = { matchId: string; displayMatchId?: string; matchNumber?: number; status?: string; scheduledStartAt?: string }
export function matchStartedAt(id: string, fallback: number, metadata?: MatchMetadata) {
  const scheduled = Date.parse(metadata?.scheduledStartAt ?? '')
  if (Number.isFinite(scheduled)) return scheduled
  const hex = canonicalMatchId(id)
  if (/^534f4c5a01[0-9a-f]{54}$/.test(hex)) {
    const timestamp = Number(BigInt(`0x${hex.slice(16, 32)}`)) * 1000
    if (Number.isSafeInteger(timestamp) && timestamp > 0 && timestamp <= 8640000000000000) return timestamp
  }
  return fallback
}
export function matchLabel(id: string, starts: number, metadata?: MatchMetadata) {
  if (Number.isSafeInteger(metadata?.matchNumber) && metadata!.matchNumber! > 0) return `MATCH #${metadata!.matchNumber}`
  if (/^MATCH\s*#?\d+$/i.test(metadata?.displayMatchId ?? '')) return metadata!.displayMatchId!
  return `${new Date(matchStartedAt(id, starts, metadata)).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · ${canonicalMatchId(id).slice(-8).toUpperCase()}`
}
