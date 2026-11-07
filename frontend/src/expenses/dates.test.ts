import { describe, expect, it } from 'vitest'
import { formatDate, isValidIsoDate, todayIso } from './dates'

describe('dates', () => {
  it('todayIso usa la zona horaria del hogar', () => {
    const instant = new Date('2026-03-10T02:30:00Z')
    expect(todayIso('America/Argentina/Buenos_Aires', instant)).toBe('2026-03-09')
    expect(todayIso('Asia/Tokyo', instant)).toBe('2026-03-10')
  })

  it('todayIso cae al navegador si la zona es inválida o falta', () => {
    const instant = new Date(2026, 2, 10, 12, 0, 0)
    expect(todayIso('No/Existe', instant)).toBe('2026-03-10')
    expect(todayIso(undefined, instant)).toBe('2026-03-10')
  })

  it('formatDate', () => {
    expect(formatDate('2026-03-10')).toBe('10/03/2026')
    expect(formatDate('raro')).toBe('raro')
  })

  it('isValidIsoDate', () => {
    expect(isValidIsoDate('2026-02-28')).toBe(true)
    expect(isValidIsoDate('2024-02-29')).toBe(true)
    expect(isValidIsoDate('2026-02-29')).toBe(false)
    expect(isValidIsoDate('2026-13-01')).toBe(false)
    expect(isValidIsoDate('2026-1-1')).toBe(false)
    expect(isValidIsoDate('')).toBe(false)
  })
})
