import { describe, expect, test } from 'bun:test'
import { decodeMatchIdentity, decodeQuestionIdentity, displayMatchId, encodeMatchIdentity, encodeQuestionIdentity, WINNER_QUESTION_KIND } from './market-identity'

describe('canonical lazy-market identities', () => {
  test('round-trips the contract-compatible match layout', () => {
    const nonce = new Uint8Array(16); nonce[15] = 0xab
    const encoded = encodeMatchIdentity({ gameMode: 2, durationMinutes: 20, kickoffSeconds: 1_800_000_000n, nonce })
    expect(Array.from(encoded.slice(0, 8))).toEqual([83, 79, 76, 90, 1, 2, 0, 20])
    expect(decodeMatchIdentity(encoded)).toEqual({ gameMode: 2, durationMinutes: 20, kickoffSeconds: 1_800_000_000n, nonce })
    expect(displayMatchId(decodeMatchIdentity(encoded), 'BR')).toBe('GM-BR_DR-20_TS-1800000000_ID-000000AB')
  })

  test('distinguishes linked winners from independent propositions by kind', () => {
    const winnerSubject = new Uint8Array(26); winnerSubject[25] = 1
    const killsSubject = new Uint8Array(26); killsSubject[25] = 12
    expect(decodeQuestionIdentity(encodeQuestionIdentity({ kind: WINNER_QUESTION_KIND, subject: winnerSubject })).kind).toBe(1)
    expect(decodeQuestionIdentity(encodeQuestionIdentity({ kind: 2, subject: killsSubject })).kind).toBe(2)
  })
})
