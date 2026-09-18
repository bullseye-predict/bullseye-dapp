import { expect, test } from 'bun:test'
import { resolveAgentTarget } from '../src/components/home/AgentTrader'

/**
 * WHAT THE AGENT PANEL'S OPTIONAL ID FIELD ACCEPTS.
 *
 * The field exists so a trader can arm a match they are not looking at. A
 * market address names one market already; a match id does not, because a match
 * carries one question per agent. See src/components/home/AgentTrader.tsx.
 */

const PROGRAM = '11111111111111111111111111111111'
const MATCH = `0x${'ab'.repeat(32)}`
const question = (suffix: string, marketId: string, label: string) => ({
  eventId: 'arena-1', matchId: MATCH, questionId: `0x${suffix.repeat(32)}`, marketId, label,
  outcomes: ['YES', 'NO'], scheduledStartAt: new Date().toISOString(), status: 'live',
})

const catalogue = (...questions: unknown[]) => async () => ({ questions })

test('a market address is used as it stands, and the catalogue is never read', async () => {
  const address = 'So11111111111111111111111111111111111111112'
  let read = 0
  const target = await resolveAgentTarget(address, '', PROGRAM, async () => { read += 1; return { questions: [] } })
  expect(target).toBe(address)
  expect(read).toBe(0)
})

test('a match id with one question resolves to that question\'s market', async () => {
  const address = 'So11111111111111111111111111111111111111112'
  const target = await resolveAgentTarget(MATCH, '', PROGRAM, catalogue(question('cd', address, 'Will A win?')))
  expect(target).toBe(address)
})

test('a match id with several questions names them instead of picking one', async () => {
  const load = catalogue(
    question('cd', 'So11111111111111111111111111111111111111112', 'Will A win?'),
    question('ce', 'So11111111111111111111111111111111111111113', 'Will B win?'),
  )
  await expect(resolveAgentTarget(MATCH, '', PROGRAM, load)).rejects.toThrow(/2 questions/)
})

test('a question id picks its own market out of the same match', async () => {
  const load = catalogue(
    question('cd', 'So11111111111111111111111111111111111111112', 'Will A win?'),
    question('ce', 'So11111111111111111111111111111111111111113', 'Will B win?'),
  )
  expect(await resolveAgentTarget(`0x${'ce'.repeat(32)}`, '', PROGRAM, load)).toBe('So11111111111111111111111111111111111111113')
})

test('an id that is neither shape is refused before any read', async () => {
  let read = 0
  await expect(resolveAgentTarget('match-01', '', PROGRAM, async () => { read += 1; return { questions: [] } }))
    .rejects.toThrow(/match id or question id/)
  expect(read).toBe(0)
})

test('an unknown id is reported as unknown', async () => {
  await expect(resolveAgentTarget(MATCH, '', PROGRAM, catalogue())).rejects.toThrow(/No question/)
})
