import { describe, expect, it } from 'vitest'
import {
  formatMinor,
  formatMoney,
  lineTotalMinor,
  minorToInputValue,
  parseMoneyToMinor,
} from './money'

describe('parseMoneyToMinor', () => {
  it.each([
    ['1.500,50', 150050],
    ['1500,5', 150050],
    ['1500', 150000],
    ['1.500', 150000],
    ['12.500', 1250000],
    ['0,05', 5],
    ['1.234.567,89', 123456789],
    ['  12,00 ', 1200],
    ['1 500,50', 150050],
    ['0', 0],
  ])('parsea %s', (input, expected) => {
    expect(parseMoneyToMinor(input)).toBe(expected)
  })

  it.each([
    ['12.50', 'punto decimal: ambiguo con miles, se rechaza'],
    ['1500.50', 'punto decimal'],
    ['0.500', 'agrupación con cero inicial'],
    ['1500,', 'coma final'],
    ['+5', 'signo'],
    ['', 'vacío'],
    ['abc', 'texto'],
    ['1,234,5', 'dos comas'],
    ['1,505', 'más decimales que la moneda'],
    ['-5', 'negativo'],
    ['1.50.0', 'agrupación inválida'],
    [',5', 'sin parte entera'],
    ['12,3a', 'texto'],
    ['99999999999999999999', 'no seguro'],
  ])('rechaza %s (%s)', (input) => {
    expect(parseMoneyToMinor(input)).toBeNull()
  })

  it('respeta monedas sin decimales', () => {
    expect(parseMoneyToMinor('1.500', 'JPY')).toBe(1500)
    expect(parseMoneyToMinor('1500', 'JPY')).toBe(1500)
    expect(parseMoneyToMinor('1500,5', 'JPY')).toBeNull()
    expect(parseMoneyToMinor('1500,0', 'JPY')).toBeNull()
  })

  it('acepta hasta el mayor entero seguro (2^53 - 1) y rechaza más', () => {
    expect(parseMoneyToMinor('90071992547409,91')).toBe(Number.MAX_SAFE_INTEGER)
    expect(parseMoneyToMinor('90071992547409,92')).toBeNull()
    expect(parseMoneyToMinor('9007199254740991', 'JPY')).toBe(Number.MAX_SAFE_INTEGER)
    expect(parseMoneyToMinor('9007199254740992', 'JPY')).toBeNull()
  })
})

describe('formatMinor / formatMoney', () => {
  it('formatea con miles y decimales', () => {
    expect(formatMinor(150050)).toBe('1.500,50')
    expect(formatMinor(5)).toBe('0,05')
    expect(formatMinor(0)).toBe('0,00')
    expect(formatMinor(-123456789)).toBe('-1.234.567,89')
  })

  it('formatea monedas sin decimales', () => {
    expect(formatMinor(1500, 'JPY')).toBe('1.500')
    expect(formatMinor(0, 'JPY')).toBe('0')
    expect(formatMoney({ amountMinor: 1234567, currency: 'JPY' })).toBe('JPY 1.234.567')
    expect(minorToInputValue(1234567, 'JPY')).toBe('1234567')
  })

  it('incluye la moneda', () => {
    expect(formatMoney({ amountMinor: 150050, currency: 'ARS' })).toBe('ARS 1.500,50')
  })

  it('rechaza valores que no son enteros seguros', () => {
    expect(() => formatMinor(1.5)).toThrow(RangeError)
    expect(() => formatMinor(Number.NaN)).toThrow(RangeError)
    expect(() => formatMinor(2 ** 53)).toThrow(RangeError)
    expect(formatMinor(Number.MAX_SAFE_INTEGER)).toBe('90.071.992.547.409,91')
  })

  it('round-trip con el parseo', () => {
    for (const minor of [1, 99, 100, 150050, 123456789, Number.MAX_SAFE_INTEGER]) {
      expect(parseMoneyToMinor(formatMinor(minor))).toBe(minor)
      expect(parseMoneyToMinor(minorToInputValue(minor))).toBe(minor)
    }
    for (const minor of [0, 1, 1500, 1234567]) {
      expect(parseMoneyToMinor(formatMinor(minor, 'JPY'), 'JPY')).toBe(minor)
      expect(parseMoneyToMinor(minorToInputValue(minor, 'JPY'), 'JPY')).toBe(minor)
    }
  })
})

describe('lineTotalMinor', () => {
  it.each([
    ['2.000', 150, 300],
    ['1.500', 1001, 1502], // 1501.5 -> half-up
    ['0.333', 100, 33], // 33.3
    ['0.005', 100, 1], // 0.5 -> 1
    ['0.004', 100, 0],
    ['3', 1999, 5997],
    ['999999999.999', 100, 100000000000], // 99999999999,9 -> half-up
  ])('qty %s × %d = %d', (qty, price, expected) => {
    expect(lineTotalMinor(qty, price)).toBe(expected)
  })

  it('rechaza cantidades inválidas y desbordes', () => {
    expect(lineTotalMinor('1,5', 100)).toBeNull()
    expect(lineTotalMinor('-1', 100)).toBeNull()
    expect(lineTotalMinor('1.2345', 100)).toBeNull()
    expect(lineTotalMinor('999999999.999', Number.MAX_SAFE_INTEGER)).toBeNull()
  })

  it('es consistente con el parseo es-AR', () => {
    expect(lineTotalMinor('2', parseMoneyToMinor('1.500,50') ?? 0)).toBe(300100)
    expect(formatMinor(300100)).toBe('3.001,00')
  })
})
