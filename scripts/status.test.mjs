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

import { newestNew, showTabNew } from '../src/status.js'
test('tab NEW: newest new date and seen logic', () => {
  assert.equal(newestNew('2026-10-21', ['2026-10-01', '2026-10-19', '2026-10-21', '']), '2026-10-21')
  assert.equal(newestNew('2026-10-21', ['2026-10-01']), '')
  assert.equal(showTabNew('2026-10-21', ''), true)
  assert.equal(showTabNew('2026-10-21', '2026-10-20'), true)
  assert.equal(showTabNew('2026-10-21', '2026-10-21'), false)
  assert.equal(showTabNew('', ''), false)
})

import { criteriaOf, unknownLabel } from '../src/status.js'
test('신청기간 불명 문구: 추가 자격기준 유무', () => {
  assert.equal(unknownLabel({ target: '장애인', title: '장애인 이동 지원', summary: '이동 편의를 돕습니다.' }), '신청기간 확인 필요')
  assert.equal(unknownLabel({ target: '장애인,저소득', summary: '' }), '신청기간 및 자격기준 확인 필요')
  assert.equal(unknownLabel({ target: '장애인', summary: '소득 기준 이하 가구' }), '신청기간 및 자격기준 확인 필요')
  assert.equal(criteriaOf({ target: '', summary: '' }), 'unknown')
  assert.equal(unknownLabel({}), '신청기간 및 자격기준 확인 필요')
})

import { unknownShort } from '../src/status.js'
test('짧은 라벨', () => {
  assert.equal(unknownShort({ target: '장애인', summary: '이동 지원' }), '기간 확인')
  assert.equal(unknownShort({ target: '장애인,저소득' }), '기간·자격 확인')
  assert.equal(unknownShort({}), '기간·자격 확인')
})
