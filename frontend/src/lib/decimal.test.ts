import {
  compareDecimal,
  decimalPlaces,
  formatDecimal,
  isPositiveDecimal,
  normalizeDecimal,
} from './decimal'

describe('decimal helpers', () => {
  it('compares without floats', () => {
    expect(compareDecimal('0.500', '1')).toBe(-1)
    expect(compareDecimal('1.0', '1')).toBe(0)
    expect(compareDecimal('10', '9.99')).toBe(1)
    expect(compareDecimal('999999999.999', '999999999.998')).toBe(1)
  })

  it('formats for display', () => {
    expect(formatDecimal('0.500')).toBe('0,5')
    expect(formatDecimal('3.000')).toBe('3')
    expect(formatDecimal('100.000')).toBe('100')
    expect(formatDecimal('3')).toBe('3')
  })

  it('normalizes and validates', () => {
    expect(normalizeDecimal(' 2,5 ')).toBe('2.5')
    expect(isPositiveDecimal('2.5')).toBe(true)
    expect(isPositiveDecimal('0.000')).toBe(false)
    expect(isPositiveDecimal('-1')).toBe(false)
    expect(isPositiveDecimal('abc')).toBe(false)
    expect(decimalPlaces('1.250')).toBe(3)
    expect(decimalPlaces('1')).toBe(0)
  })
})
