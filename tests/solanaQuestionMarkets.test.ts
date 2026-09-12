import { describe, expect, test } from 'bun:test'
import { parseReservedSolanaQuestions, reservedSolanaView } from '../src/components/home/solanaQuestionMarkets'

const question = { eventId: 'solana-demo', matchId: `0x${'11'.repeat(32)}`, questionId: `0x${'22'.repeat(32)}`, marketId: 'market-pda', label: 'Will SOLZ-LAZY-DEMO win?', outcomes: ['YES', 'NO'], scheduledStartAt: '2026-10-12T00:11:31.000Z', status: 'reserved' }

describe('reserved Solana question view', () => {
  test('parses only canonical binary reservations', () => {
    expect(parseReservedSolanaQuestions({ questions: [question, { ...question, questionId: 'bad' }] })).toHaveLength(1)
  })

  test('shows a neutral read-only price before first-trader activation', () => {
    const { market } = reservedSolanaView(question as ReturnType<typeof parseReservedSolanaQuestions>[number], 1)
    expect(market.outcomes.map(outcome => outcome.probability)).toEqual([.5, .5])
    expect(market.status).toBe('indicative')
    expect(market.rules).toContain('not an executable quote')
  })
})
