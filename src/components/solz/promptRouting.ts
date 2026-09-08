import type { SolzMatch } from './model'

const words = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** Names or agent numbers address specific cans; an unnamed directive addresses the arena. */
export function promptRecipients(match: SolzMatch, text: string, explicitAgentId?: string) {
  if (explicitAgentId) return match.roster.filter((entry) => entry.agentId === explicitAgentId)
  const normalized = ` ${words(text)} `
  const mentioned = match.roster.filter((entry) => {
    const number = Number(entry.agentId.split('-').at(-1))
    return normalized.includes(` ${words(entry.codename)} `)
      || normalized.includes(` agent ${number} `)
      || normalized.includes(` agent ${String(number).padStart(2, '0')} `)
  })
  return mentioned.length ? mentioned : match.roster.filter((entry) => entry.status === 'active')
}
