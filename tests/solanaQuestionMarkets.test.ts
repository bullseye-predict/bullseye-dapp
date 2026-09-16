import { describe, expect, test } from 'bun:test'
import { parseReservedSolanaQuestions, reservedSolanaView, resolveMatchMarkets, resolveQuestionEvent, solanaQuestionLocksAt, standaloneQuestions, questionKind, questionEvents, linkedAnswerLabel, linkedQuestionTitle, type ReservedSolanaQuestion } from '../src/components/home/solanaQuestionMarkets'
import type { PublicPredictionVenue } from '../packages/prediction-core/market-data'

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

  test('a stale reserved status becomes result pending after the encoded match window', () => {
    const parsed = parseReservedSolanaQuestions({ questions: [question] })[0]!
    const { match, market } = reservedSolanaView(parsed, solanaQuestionLocksAt(parsed) + 1)
    expect(match).toMatchObject({ phase: 'settled', round: 'RESULT PENDING' })
    expect(market.status).toBe('closed')
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
      .toBe('Which Genesis agent will finish Season 01 with the most kills?')
  })

  test('legacy linked rows infer a short answer identity without changing their market ids', () => {
    const resolved = resolveQuestionEvent(views, views[0]!.question.eventId)!
    expect(resolved.markets.map((market) => market.presentation?.answer?.label)).toEqual(['genesis-01', 'genesis-02', 'genesis-03'])
    expect(resolved.markets.map((market) => market.id)).toEqual(views.map((view) => view.market.id))
    expect(linkedAnswerLabel(agentQuestion(1).label, 'Finish Season 01 with the most kills?')).toBe('genesis-01')
  })

  test('a lone question keeps its own label, and unrelated questions do not invent one', () => {
    expect(linkedQuestionTitle(['Will it rain?'])).toBe('Will it rain?')
    expect(linkedQuestionTitle(['Will it rain?', 'Who wins the cup?'])).toBe('Will it rain?')
    expect(linkedQuestionTitle([])).toBe('')
  })
})

describe('head-to-head presentation', () => {
  test('builds a scheduled matchup with a direct two-team moneyline', () => {
    const matchup: ReservedSolanaQuestion = {
      eventId: 'jup-ansem', matchId: '0x534f4c5a01010014000000006abc510048db8621b407e9609db4854d98e14593',
      questionId: '0x515545530102935a11a11e5f2b9189719486a1e222cb074320eeab8b77b3e0b2', marketId: 'market-jup-ansem',
      label: 'Who will win: JUP or ANSEM?', outcomes: ['JUP', 'ANSEM'], scheduledStartAt: '2026-09-30T00:00:00.000Z', status: 'reserved',
      presentation: { kind: 'head-to-head', eventTitle: 'JUP vs ANSEM', outcomes: [{ id: 0, label: 'JUP', teamId: 'team-jup', color: '#3fdcff' }, { id: 1, label: 'ANSEM', teamId: 'team-ansem', color: '#ff7a1a' }] },
    }
    const { match, market } = reservedSolanaView(matchup, Date.parse('2026-09-14T00:00:00Z'))
    expect(match.teams.map((team) => team.symbol)).toEqual(['JUP', 'ANSEM'])
    expect(match.startedAt).toBe(Date.parse('2026-09-30T00:00:00Z'))
    expect(match.round).toBe('MONEYLINE')
    expect(market.presentation?.eventTitle).toBe('JUP vs ANSEM')
    expect(market.title).toBe('Who will win: JUP or ANSEM?')
    expect(market.outcomes.every((outcome) => outcome.indicative)).toBe(true)
    expect(market.outcomes.map((outcome) => outcome.label)).toEqual(['JUP', 'ANSEM'])
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

describe('a canonical match is tradable from its own identity', () => {
  // The live arena match the prediction backend actually serves: twelve linked
  // binary questions, all sharing one eventId, all keyed to one canonical matchId.
  const matchId = '0x534f4c5a01010014000000006aaa7840e8a343a5681f0c087f10dcd4d8255908'
  const eventId = `arena-${matchId.slice(2)}`
  const program = 'PredJavXFRGRsEwsxMZfyGYCkFMd5BbXpBWAAAAAAAA'
  const venue = { programId: program, manifestProgramId: program, publicRpcUrl: 'https://rpc.example', chainId: 'genesis', collateralToken: program, collateralDecimals: 6 } as unknown as PublicPredictionVenue
  const entrants = ['COKE', 'PEPSI', 'SPRITE', 'FANTA', 'MIRINDA', 'CRUSH', 'SCHWEPPES', 'TANGO', 'DEW', 'SEVEN-UP', 'BRU', 'RC']
  const catalogue: ReservedSolanaQuestion[] = entrants.map((label, index) => ({
    presentation: { kind: 'linked', eventTitle: 'Who will win this match?',
      answer: { label, participantId: `genesis-${String(index + 1).padStart(2, '0')}` },
      outcomes: [{ id: 0, label: 'Yes' }, { id: 1, label: 'No' }] },
    eventId, matchId,
    questionId: `0x515545530101${(index + 1).toString(16).padStart(2, '0').repeat(26)}`,
    marketId: `market-pda-${index}`, label: `Will ${label} win?`, outcomes: ['YES', 'NO'],
    scheduledStartAt: '2026-09-16T11:06:40Z', status: 'live',
  }))
  const markets = catalogue.map((question) => reservedSolanaView(question, Date.parse('2026-09-16T11:10:00Z'), venue).market)

  test('an FFA field trades as one linked binary question per entrant, with no arena feed', () => {
    // The regression: /arena/events was the only thing that could produce a
    // tradable market, so whenever that importer-backed endpoint was slow,
    // stalled or down, twelve valid catalogue questions rendered zero markets
    // and the ticket showed "Prediction feed unavailable" for a live match.
    const resolved = resolveMatchMarkets([], markets)
    expect(resolved.markets).toHaveLength(12)
    expect(resolved.canonical).toBe(true)
    // The two canonical IDs are what trades: the market's id IS the questionId,
    // and every one carries the venue binding derived from (matchId, questionId).
    expect(resolved.markets.map((market) => market.id)).toEqual(catalogue.map((question) => question.questionId))
    expect(resolved.markets.every((market) => market.matchId === eventId)).toBe(true)
    expect(resolved.markets.every((market) => market.onchain?.marketId)).toBe(true)
  })

  test('the arena feed still wins when it has the questions, so recorded answers survive', () => {
    const settled = [{ ...markets[0]!, id: 'winner-genesis-01', outcomes: markets[0]!.outcomes.map((outcome) => ({ ...outcome, probability: 1 })) }]
    const resolved = resolveMatchMarkets(settled, markets)
    expect(resolved.markets).toEqual(settled)
    // Not canonical: these rows came from the feed, so the venue pipeline keeps
    // treating them exactly as it did before.
    expect(resolved.canonical).toBe(false)
  })

  test('no source means no market, rather than an invented one', () => {
    expect(resolveMatchMarkets([], [])).toEqual({ markets: [], canonical: false })
  })

  test('a linked answer carries its participant so the options list draws the agent', () => {
    expect(markets[2]!.outcomes.map((outcome) => outcome.participantId)).toEqual(['genesis-03', 'genesis-03'])
    expect(markets[2]!.presentation?.eventTitle).toBe('Who will win this match?')
    expect(markets[2]!.outcomes.map((outcome) => outcome.label)).toEqual(['Yes', 'No'])
  })
})
