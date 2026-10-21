import test from 'node:test'
import assert from 'node:assert/strict'
import { isNew, periodOf, needsRegion, parseEnd } from '../src/status.js'
import { stampFirstSeen } from './welfare-lib.mjs'

test('NEW: 3일 이내만', () => {
  assert.equal(isNew('2026-10-21', '2026-10-18'), true)
  assert.equal(isNew('2026-10-21', '2026-10-17'), false)
  assert.equal(isNew('2026-10-21', undefined, ''), false)
})
test('기간: 모르면 마감 처리하지 않는다', () => {
  assert.equal(periodOf('2026-10-21', { summary: '지원합니다' }), 'unknown')
  assert.equal(periodOf('2026-10-21', { summary: 'x' }, { applyEnd: '2026-10-20' }), 'closed')
  assert.equal(periodOf('2026-10-21', { summary: 'x' }, { applyEnd: '2026-10-21' }), 'open')
  assert.equal(periodOf('2026-10-21', { summary: '연중 신청 가능' }), 'open')
  assert.equal(parseEnd('신청기간 2026.3.2~2026.10.31'), '2026-10-31')
  assert.equal(parseEnd('2025.12.31 기준 자료'), '')
})
test('지역 확인', () => {
  assert.equal(needsRegion({ title: '지역사회서비스 투자사업', summary: '' }), true)
  assert.equal(needsRegion({ title: '에너지바우처', summary: '지역난방 등 이용 비용', org: '기후에너지환경부' }), false)
  assert.equal(needsRegion({ orgType: '지자체' }, 'jobs'), true)
})
test('firstSeen: 첫 도입엔 안 찍고 이후 신규만 찍는다', () => {
  assert.deepEqual(stampFirstSeen([], [{ id: 'a' }], 'D'), [{ id: 'a' }])
  const out = stampFirstSeen([{ id: 'a' }, { id: 'b', firstSeen: 'X' }], [{ id: 'a' }, { id: 'b' }, { id: 'c' }], 'D')
  assert.deepEqual(out, [{ id: 'a' }, { id: 'b', firstSeen: 'X' }, { id: 'c', firstSeen: 'D' }])
})
