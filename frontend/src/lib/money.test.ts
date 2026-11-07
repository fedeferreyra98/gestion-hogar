import { describe, expect, it } from 'vitest'
import { formatMinor, formatMoney, minorToInputValue, parseMoneyToMinor } from './money'

describe('parseMoneyToMinor', () => {
  it.each([
    ['1.500,50', 150050],
    ['1500,5', 150050],
    ['1500', 150000],
    ['1.500', 150000],
    ['1.234.567,89', 123456789],
    ['1500.50', 150050],
    ['0,05', 5],
    ['  12,00 ', 1200],
  ])('parsea %s', (input, expected) => {
    expect(parseMoneyToMinor(input)).toBe(expected)
  })

  it.each(['', 'abc', '1,234,5', '1,505', '-5', '1.50.0', ',5', '12,3a', '99999999999999999999'])(
    'rechaza %s',
    (input) => {
      expect(parseMoneyToMinor(input)).toBeNull()
    },
  )

  it('respeta monedas sin decimales', () => {
    expect(parseMoneyToMinor('1.500', 'JPY')).toBe(1500)
    expect(parseMoneyToMinor('1500,5', 'JPY')).toBeNull()
  })
})

describe('formatMinor / formatMoney', () => {
  it('formatea con miles y decimales', () => {
    expect(formatMinor(150050)).toBe('1.500,50')
    expect(formatMinor(5)).toBe('0,05')
    expect(formatMinor(0)).toBe('0,00')
    expect(formatMinor(-123456789)).toBe('-1.234.567,89')
    expect(formatMinor(1500, 'JPY')).toBe('1.500')
  })

  it('incluye la moneda', () => {
    expect(formatMoney({ amountMinor: 150050, currency: 'ARS' })).toBe('ARS 1.500,50')
  })

  it('round-trip con el parseo', () => {
    for (const minor of [1, 99, 100, 150050, 123456789]) {
      expect(parseMoneyToMinor(formatMinor(minor))).toBe(minor)
      expect(parseMoneyToMinor(minorToInputValue(minor))).toBe(minor)
    }
  })
})
