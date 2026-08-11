import { describe, expect, it } from 'vitest'
import {
  createConsultationEntry,
  getConsultationIssue,
  isUnresolvedConsultation,
  migrateLegacyConsultingState,
  normalizeConsultations,
  reconcileConsultations,
} from './consultationState'

describe('consultation state', () => {
  it('normalizes valid entries and drops malformed or unknown values', () => {
    expect(
      normalizeConsultations({
        milk: {
          itemId: 'milk',
          reason: 'other',
          note: '  大きいサイズならありました  ',
          status: 'queued',
        },
        mismatched: {
          itemId: 'different',
          reason: 'soldOut',
          status: 'shared',
        },
        invalidReason: {
          itemId: 'invalidReason',
          reason: 'closed',
          status: 'queued',
        },
        invalidStatus: {
          itemId: 'invalidStatus',
          reason: 'soldOut',
          status: 'waiting',
        },
      }),
    ).toEqual({
      milk: {
        itemId: 'milk',
        reason: 'other',
        note: '大きいサイズならありました',
        status: 'queued',
      },
    })
  })

  it('reconciles entries to request items and recognizes unresolved states', () => {
    const consultations = normalizeConsultations({
      milk: {
        itemId: 'milk',
        reason: 'notFound',
        status: 'shared',
      },
      bread: {
        itemId: 'bread',
        reason: 'soldOut',
        status: 'resolved',
      },
      stale: {
        itemId: 'stale',
        reason: 'poorCondition',
        status: 'queued',
      },
    })

    expect(reconcileConsultations(consultations, ['milk', 'bread'])).toEqual({
      milk: consultations.milk,
      bread: consultations.bread,
    })
    expect(isUnresolvedConsultation(consultations.milk)).toBe(true)
    expect(isUnresolvedConsultation(consultations.bread)).toBe(false)
  })

  it('creates a queue entry from an issue without changing its meaning', () => {
    const entry = createConsultationEntry(
      'apple',
      { reason: 'conditionMismatch', note: '  赤いものならあり  ' },
      'queued',
    )

    expect(entry).toEqual({
      itemId: 'apple',
      reason: 'conditionMismatch',
      note: '赤いものならあり',
      status: 'queued',
    })
    expect(getConsultationIssue(entry)).toEqual({
      reason: 'conditionMismatch',
      note: '赤いものならあり',
    })
  })

  it('migrates legacy consulting plus itemIssue without changing other purchase data', () => {
    expect(
      migrateLegacyConsultingState(
        {
          milk: 'consulting',
          bread: 'inCart',
          apple: 'notBuying',
        },
        {
          milk: { reason: 'notFound', note: '別容量あり' },
          apple: { reason: 'soldOut' },
        },
        {},
      ),
    ).toEqual({
      checkedState: {
        milk: 'pending',
        bread: 'inCart',
        apple: 'notBuying',
      },
      itemIssues: {
        apple: { reason: 'soldOut' },
      },
      consultations: {
        milk: {
          itemId: 'milk',
          reason: 'notFound',
          note: '別容量あり',
          status: 'queued',
        },
      },
      migratedItemIds: ['milk'],
    })
  })
})
