import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { jobCollectDecision, weekdayOf, kstDate } from './workday-lib.mjs'

const h = JSON.parse(readFileSync(new URL('./holidays.json', import.meta.url), 'utf8'))

test('평일은 수집한다(2026-10-23 금)', () => {
  assert.equal(weekdayOf('2026-10-23'), 5)
  assert.equal(jobCollectDecision('2026-10-23', h).collect, true)
})
test('주말은 건너뛴다(10/24 토, 10/25 일)', () => {
  assert.equal(jobCollectDecision('2026-10-24', h).collect, false)
  assert.equal(jobCollectDecision('2026-10-25', h).collect, false)
})
test('공휴일·대체공휴일은 건너뛴다', () => {
  for (const d of ['2026-10-05', '2026-10-09', '2026-03-02', '2026-09-25', '2027-02-09', '2027-10-11', '2027-12-27']) {
    assert.equal(jobCollectDecision(d, h).collect, false, d)
  }
})
test('공휴일 바로 다음 평일은 수집한다', () => {
  assert.equal(jobCollectDecision('2026-10-06', h).collect, true)
  assert.equal(jobCollectDecision('2026-10-12', h).collect, true)
})
test('force 면 주말·공휴일에도 수집한다', () => {
  assert.equal(jobCollectDecision('2026-10-25', h, { force: true }).collect, true)
  assert.equal(jobCollectDecision('2026-10-09', h, { force: true }).collect, true)
})
test('KST 기준으로 날짜를 센다(UTC 금요일 16시 = KST 토요일 01시)', () => {
  assert.equal(kstDate(Date.parse('2026-10-23T16:00:00Z')), '2026-10-24')
})
test('공휴일 목록의 날짜가 형식에 맞고 중복이 없다', () => {
  assert.ok(h.dates.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))
  assert.equal(new Set(h.dates).size, h.dates.length)
})
