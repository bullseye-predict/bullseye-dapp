import { useId } from 'react'
import type { AgentTraits } from '../solz/model'

const axes: { key: keyof AgentTraits; label: string }[] = [
  { key: 'power', label: 'POWER' }, { key: 'mobility', label: 'MOBILITY' },
  { key: 'tactics', label: 'TACTICS' }, { key: 'defense', label: 'DEFENSE' }, { key: 'teamwork', label: 'TEAMWORK' },
]
const point = (index: number, radius: number) => ({ x: 160 + Math.cos(-Math.PI / 2 + index * Math.PI * 2 / 5) * radius, y: 151 + Math.sin(-Math.PI / 2 + index * Math.PI * 2 / 5) * radius })
const polygon = (radius: number) => axes.map((_, index) => { const p = point(index, radius); return `${p.x},${p.y}` }).join(' ')

export function AgentTraitRadar({ name, traits }: { name: string; traits: AgentTraits }) {
  const titleId = useId(), descriptionId = useId()
  return <figure className="ga-trait-radar">
    <figcaption><span>TRAINING TRAITS</span><small>SAMPLE / 100</small></figcaption>
    <svg viewBox="0 0 320 294" role="img" aria-labelledby={`${titleId} ${descriptionId}`}>
      <title id={titleId}>{name} training traits</title><desc id={descriptionId}>{axes.map(({ key, label }) => `${label}: ${traits[key]} out of 100`).join('. ')}. Illustrative training profile.</desc>
      {[.25, .5, .75, 1].map((scale) => <polygon key={scale} className={`ga-radar-ring ${scale === 1 ? 'is-outer' : ''}`} points={polygon(91 * scale)}/>)}
      {axes.map((axis, index) => { const p = point(index, 91); return <line key={axis.key} className="ga-radar-axis" x1="160" y1="151" x2={p.x} y2={p.y}/> })}
      <polygon className="ga-radar-fill" points={axes.map(({ key }, index) => { const p = point(index, 91 * Math.max(0, Math.min(100, traits[key])) / 100); return `${p.x},${p.y}` }).join(' ')}/>
      {axes.map(({ key, label }, index) => { const p = point(index, 91 * traits[key] / 100); const text = point(index, 124); return <g key={key}><circle cx={p.x} cy={p.y} r="3" className="ga-radar-point"/><text x={text.x} y={text.y - 5} textAnchor="middle" className="ga-radar-label">{label}</text><text x={text.x} y={text.y + 11} textAnchor="middle" className="ga-radar-value">{traits[key]}</text></g> })}
      <g className="ga-radar-can" aria-hidden="true"><rect x="151" y="133" width="18" height="34" rx="4"/><ellipse cx="160" cy="136" rx="7" ry="2"/><path d="m162 143-7 10h5l-2 8 7-11h-5Z"/></g>
    </svg>
  </figure>
}
