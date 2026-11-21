import test from 'node:test'
import assert from 'node:assert/strict'
import { findPreferenceOnly, hasRestrictEvidence } from './check-preference-only.mjs'

const base = { id: 'kead-1', title: '일반 사무원 채용', org: '테스트기관', url: 'https://a.kr/1', disabledOnly: true }

test('전용 표시인데 근거가 우대뿐이면 찾는다', () => {
  const j = { ...base, notes: ['장애인 우대사항 적용'] }
  assert.deepEqual(findPreferenceOnly([j]).map((x) => x.id), ['kead-1'])
})

test('고용공단 자동 표시 [장애인만 채용]은 근거로 치지 않아서 우대만 있으면 찾는다', () => {
  const j = { ...base, title: '[장애인만 채용] 검단구 사무원', summary: { 장애인관련: ['- 장애인 우대사항 적용'] } }
  assert.equal(findPreferenceOnly([j]).length, 1)
})

test('기관이 쓴 제한 표현(제한경쟁·장애인 제한 채용)이 있으면 찾지 않는다', () => {
  assert.equal(findPreferenceOnly([{ ...base, notes: ['장애인 우대'], disabledEvidence: '※제한경쟁 채용(장애인)' }]).length, 0)
  assert.equal(findPreferenceOnly([{ ...base, title: '[장애인 전형] 사무원', notes: ['우대 문구'] }]).length, 0)
  assert.equal(findPreferenceOnly([{ ...base, mixedEvidence: '장애인 제한 채용', notes: ['우대'] }]).length, 0)
})

test('전용 표시가 아니거나 우대·가점 문구가 없으면 찾지 않는다', () => {
  assert.equal(findPreferenceOnly([{ ...base, disabledOnly: false, notes: ['장애인 우대'] }]).length, 0)
  assert.equal(findPreferenceOnly([{ ...base, notes: ['마감 임박'] }]).length, 0)
})

test('가점 문구도 우대와 같이 본다', () => {
  assert.equal(findPreferenceOnly([{ ...base, summary: { 장애인관련: ['장애인 가점 부여'] } }]).length, 1)
})

test('판정 문구 확인: 제한 표현 유무', () => {
  assert.equal(hasRestrictEvidence('장애인 전용 공고'), true)
  assert.equal(hasRestrictEvidence('장애인 우대'), false)
  assert.equal(hasRestrictEvidence(undefined), false)
})

test('목록이 없으면 빈 결과', () => {
  assert.deepEqual(findPreferenceOnly(undefined), [])
})
