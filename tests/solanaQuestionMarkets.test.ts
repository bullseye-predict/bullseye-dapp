import { describe, expect, test } from 'bun:test'
import { parseReservedSolanaQuestions, reservedSolanaView, resolveQuestionEvent, solanaQuestionLocksAt, standaloneQuestions, questionKind, questionEvents, linkedQuestionTitle, type ReservedSolanaQuestion } from '../src/components/home/solanaQuestionMarkets'

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

describe('standalone long-lived questions reach the market and event pages', () => {
  // The real 45.5-day question configured in
  // /Users/Shared/march-2026/solz-prediction-backend/.env (SOLANA_LAZY_QUESTIONS_JSON),
  // as /solana/questions serves it once the backend has been restarted.
  const lazy: ReservedSolanaQuestion = {
    eventId: 'lazy-534f4c5a0101ffff000000006aa72600daad32dfabd66ab7d4e7cfbe6ef0fc81',
    matchId: '0x534f4c5a0101ffff000000006aa72600daad32dfabd66ab7d4e7cfbe6ef0fc81',
    questionId: '0x515545530102686967686573742d6b696c6c2d6167656e742d736561736f6e2d',
    marketId: 'Fof6MKW3arFMnmFPe8gnXymAYTgdFVVrdQofqBx6c5Bx',
    label: 'Which agent finishes Season 01 with the most kills? (SPRITE)',
    outcomes: ['YES', 'NO'],
    scheduledStartAt: '2026-09-13T22:38:56.000Z',
    status: 'live',
  }
  const arena: ReservedSolanaQuestion = {
    ...lazy,
    eventId: 'arena-534f4c5a01010014000000006aa729217129606d71a40f50cde20f3291c57a1d',
    matchId: '0x534f4c5a01010014000000006aa729217129606d71a40f50cde20f3291c57a1d',
    questionId: '0x5155455301010f9dcc2247b7e613c796cc77d8b9f9ea35780c6ed6181582207',
    label: 'Will genesis-01 win?',
    // The kickoff encoded in matchId; the backend rejects any other value.
    scheduledStartAt: '2026-09-13T22:52:17.000Z',
  }
  const view = (question: ReservedSolanaQuestion) => ({ ...reservedSolanaView(question, Date.now()), question })

  test('the 45-day question outlives the ~20-minute arena cycle', () => {
    const days = (solanaQuestionLocksAt(lazy) - Date.parse(lazy.scheduledStartAt)) / 86_400_000
    expect(days).toBeCloseTo(45.5, 1)
    expect(solanaQuestionLocksAt(lazy)).toBeGreaterThan(Date.now())
    // The arena questions it must outlive.
    expect(solanaQuestionLocksAt(arena) - Date.parse(arena.scheduledStartAt)).toBe(20 * 60_000)
  })

  test('its event id opens the market detail page with its own market', () => {
    const resolved = resolveQuestionEvent([view(lazy)], lazy.eventId)
    expect(resolved?.match.id).toBe(lazy.eventId)
    expect(resolved?.markets.map((market) => market.title)).toEqual([lazy.label])
    expect(resolveQuestionEvent([view(lazy)], 'no-such-event')).toBeUndefined()
  })

  test('the directory lists it but never a per-match question, even a stale one', () => {
    const views = [view(lazy), view(arena)]
    expect(standaloneQuestions(views, [{ id: arena.eventId }]).map((item) => item.question.eventId)).toEqual([lazy.eventId])
    // Arena matches roll every ~20 minutes. When the match leaves the snapshot
    // its kind-01 questions must NOT become "standalone".
    expect(standaloneQuestions(views, []).map((item) => item.question.eventId)).toEqual([lazy.eventId])
    expect(questionKind(lazy.questionId)).toBe('02')
    expect(questionKind(arena.questionId)).toBe('01')
  })

  test('a team-less question still carries a title for the event heading', () => {
    const { match, market } = view(lazy)
    expect(match.teams).toEqual([])
    expect(market.title).toBe(lazy.label)
    expect(market.outcomes.map((outcome) => outcome.id)).toEqual(['yes', 'no'])
  })
})

describe('linked questions group into one event', () => {
  const agentQuestion = (n: number): ReservedSolanaQuestion => ({
    eventId: 'lazy-534f4c5a0101ffff000000006aa72600daad32dfabd66ab7d4e7cfbe6ef0fc81',
    matchId: '0x534f4c5a0101ffff000000006aa72600daad32dfabd66ab7d4e7cfbe6ef0fc81',
    questionId: `0x5155455301025330312d6d6f73742d6b696c6c732d67656e657369732d${String(n).padStart(2, '0')}00`,
    marketId: `market-${n}`,
    label: `Will genesis-${String(n).padStart(2, '0')} finish Season 01 with the most kills?`,
    outcomes: ['YES', 'NO'], scheduledStartAt: '2026-09-13T22:38:56.000Z', status: 'live',
  })
  const views = [1, 2, 3].map((n) => ({ ...reservedSolanaView(agentQuestion(n), Date.now()), question: agentQuestion(n) }))

  test('twelve questions on one event are one directory entry, not twelve', () => {
    const events = questionEvents(views)
    expect(events.length).toBe(1)
    expect(events[0].length).toBe(3)
    // Separate events stay separate.
    const other = { ...reservedSolanaView(agentQuestion(9), Date.now()), question: { ...agentQuestion(9), eventId: 'lazy-other' } }
    expect(questionEvents([...views, other]).length).toBe(2)
  })

  test('the event title is the shared tail of its linked questions', () => {
    expect(linkedQuestionTitle(views.map((view) => view.market.title)))
      .toBe('Finish Season 01 with the most kills?')
  })

  test('a lone question keeps its own label, and unrelated questions do not invent one', () => {
    expect(linkedQuestionTitle(['Will it rain?'])).toBe('Will it rain?')
    expect(linkedQuestionTitle(['Will it rain?', 'Who wins the cup?'])).toBe('Will it rain?')
    expect(linkedQuestionTitle([])).toBe('')
  })
})

describe('the selected market names its own question', () => {
  const q = (n: number): ReservedSolanaQuestion => ({
    eventId: 'lazy-event',
    matchId: '0x534f4c5a0101ffff000000006aa72600daad32dfabd66ab7d4e7cfbe6ef0fc81',
    questionId: `0x5155455301025330312d6d6f73742d6b696c6c732d67656e657369732d${String(n).padStart(2, '0')}00`,
    marketId: `market-${n}`,
    label: `Will genesis-${String(n).padStart(2, '0')} finish Season 01 with the most kills?`,
    outcomes: ['YES', 'NO'], scheduledStartAt: '2026-09-13T22:38:56.000Z', status: 'live',
  })
  const views = [1, 2, 3].map((n) => ({ ...reservedSolanaView(q(n), Date.now()), question: q(n) }))

  test('every linked question is returned, aligned with its market', () => {
    const resolved = resolveQuestionEvent(views, 'lazy-event')!
    expect(resolved.questions.length).toBe(3)
    // The trade ticket keys off market.id, so each market must name its question.
    for (const [index, market] of resolved.markets.entries()) {
      expect(market.id.toLowerCase()).toBe(resolved.questions[index].questionId.toLowerCase())
    }
  })

  test('picking the third market resolves the third question, not the first', () => {
    const resolved = resolveQuestionEvent(views, 'lazy-event')!
    const selected = resolved.markets[2]
    const question = resolved.questions.find((item) => item.questionId.toLowerCase() === selected.id.toLowerCase())
    expect(question?.label).toContain('genesis-03')
    // Activation uses this marketId; the event's first question would be wrong.
    expect(question?.marketId).toBe('market-3')
    expect(resolved.question.marketId).toBe('market-1')
  })
})
