import { describe, expect, it } from 'vitest'
import { MARKET_METER_DEFAULT_THRESHOLD, SMART_MONEY_DEFAULT_MIN_RVOL, SMART_MONEY_DEFAULT_MIN_ZMOVE } from '../aggregate'
import { METRIC_DOCS, OWN_DEFINITION_NOTE } from '../metricDocs'
import { STRENGTH_TONE_THRESHOLDS } from '../strength'

const ALL_TEXT = Object.values(METRIC_DOCS).flatMap((doc) => [doc.title, doc.formula, ...doc.definition, ...doc.limits])

describe('METRIC_DOCS', () => {
  it('gives every invented metric a formula, a definition and at least one limit', () => {
    for (const doc of Object.values(METRIC_DOCS)) {
      expect(doc.formula.length).toBeGreaterThan(0)
      expect(doc.definition.length).toBeGreaterThan(0)
      expect(doc.limits.length).toBeGreaterThan(0)
    }
  })

  it('quotes the thresholds the computing code actually uses, not copies of them', () => {
    expect(METRIC_DOCS.smartMoney.formula).toContain(`rvol ≥ ${SMART_MONEY_DEFAULT_MIN_RVOL}`)
    expect(METRIC_DOCS.smartMoney.formula).toContain(`|zMove| ≥ ${SMART_MONEY_DEFAULT_MIN_ZMOVE}`)
    expect(METRIC_DOCS.marketMeter.formula).toContain(`t = ${MARKET_METER_DEFAULT_THRESHOLD}%`)
    expect(METRIC_DOCS.strength.definition.join(' ')).toContain(`at or above ${STRENGTH_TONE_THRESHOLDS.high}`)
  })

  it('never claims or implies a match with any other product', () => {
    for (const line of ALL_TEXT) {
      expect(line).not.toMatch(/reference|commercial|dashboard's|same as|matches|replicat|equivalent to/i)
    }
    expect(OWN_DEFINITION_NOTE).toMatch(/not intended to match/i)
  })
})
