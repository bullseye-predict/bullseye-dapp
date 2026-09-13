import { describe, expect, test } from 'bun:test'
import { parseReservedSolanaQuestions, reservedSolanaView, solanaQuestionLocksAt } from '../src/components/home/solanaQuestionMarkets'

const question = { eventId: 'solana-demo', matchId: '0x0000000000000014000000006aa0000000000000000000000000000000000000', questionId: `0x${'22'.repeat(32)}`, marketId: 'market-pda', label: 'Will SOLZ-LAZY-DEMO win?', outcomes: ['YES', 'NO'], scheduledStartAt: '2026-10-12T00:11:31.000Z', status: 'reserved' }

describe('reserved Solana question view', () => {
  test('parses only canonical binary reservations', () => {
    expect(parseReservedSolanaQuestions({ questions: [question, { ...question, questionId: 'bad' }] })).toHaveLength(1)
  })

  test('shows a neutral read-only price without treating a future schedule as an intermission timer', () => {
    const { match, market } = reservedSolanaView(question as ReturnType<typeof parseReservedSolanaQuestions>[number], 1)
    expect(market.outcomes.map(outcome => outcome.probability)).toEqual([.5, .5])
    expect(market.status).toBe('indicative')
    expect(market.rules).toContain('not an executable quote')
    expect(match.timingType).toBe('open-ended')
  })

  test('keeps a live question tradable until the encoded match duration ends', () => {
    const live = { ...question, status: 'live' }
    const parsed = parseReservedSolanaQuestions({ questions: [live] })[0]!
    const { match, market } = reservedSolanaView(parsed, 1)
    expect(match.phase).toBe('live')
    expect(match.timingType).toBe('countdown')
    expect(match.endsAt).toBe(solanaQuestionLocksAt(parsed))
    expect(market.closesAt).toBe(match.endsAt)
  })
})
