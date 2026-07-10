import { describe, expect, it } from 'vitest'
import { getContentLength, getProgressPercent } from '../src/models/progress'

describe('getContentLength', () => {
  it('header presente con número válido → ese número', () => {
    const headers = new Headers({ 'content-length': '12345' })
    expect(getContentLength(headers)).toBe(12345)
  })

  it('header ausente → null', () => {
    const headers = new Headers()
    expect(getContentLength(headers)).toBeNull()
  })

  it("'0' → null", () => {
    const headers = new Headers({ 'content-length': '0' })
    expect(getContentLength(headers)).toBeNull()
  })

  it('negativo → null', () => {
    const headers = new Headers({ 'content-length': '-1' })
    expect(getContentLength(headers)).toBeNull()
  })

  it('no-numérico → null', () => {
    const headers = new Headers({ 'content-length': 'abc' })
    expect(getContentLength(headers)).toBeNull()
  })
})

describe('getProgressPercent', () => {
  it('(0, 1000) → 0', () => {
    expect(getProgressPercent(0, 1000)).toBe(0)
  })

  it('(500, 1000) → 50', () => {
    expect(getProgressPercent(500, 1000)).toBe(50)
  })

  it('(1000, 1000) → 100', () => {
    expect(getProgressPercent(1000, 1000)).toBe(100)
  })

  it('clamp por encima: (1500, 1000) → 100', () => {
    expect(getProgressPercent(1500, 1000)).toBe(100)
  })

  it('total=null → null', () => {
    expect(getProgressPercent(500, null)).toBeNull()
  })

  it('total=0 → null', () => {
    expect(getProgressPercent(500, 0)).toBeNull()
  })
})
