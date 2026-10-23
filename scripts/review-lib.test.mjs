import test from 'node:test'
import assert from 'node:assert/strict'
import { enqueue, isDue, batchOf, parseVerdicts, quoteInBody, applyVerdicts, confirmedJobs, isAmbiguous } from './review-lib.mjs'
import { validateJobs } from './validate-lib.mjs'

const TODAY = '2026-10-23'
const rules = { 나라일터_제외: ['결과', '최종합격', '발표'] }
const job = (id, extra = {}) => ({ id, title: `채용 ${id}`, org: '기관', url: `https://ex.test/${id}`, end: '2026-11-01', source: 'KEAD', disabledOnly: false, ...extra })

test('애매한 공고만 대기열에 들어가고 확정·마감·결과 공지는 빠진다', () => {
  const jobs = [job('a'), job('b', { disabledOnly: true }), job('c', { end: '2026-10-01' }), job('d', { title: '최종합격자 발표', source: '나라일터' })]
  const r = enqueue({ lastRunAt: null, items: [] }, jobs, TODAY, rules, 0)
  assert.deepEqual(r.queue.items.map((q) => q.id), ['a'])
  assert.equal(r.added, 1)
  // 같은 공고를 다시 넣어도 중복되지 않는다
  assert.equal(enqueue(r.queue, jobs, TODAY, rules, 0).added, 0)
})

test('대기 항목이 없으면 주기와 무관하게 호출하지 않는다', () => {
  assert.equal(isDue({ lastRunAt: null, items: [] }), false)
  assert.equal(isDue({ lastRunAt: null, items: [{ id: 'a', status: 'confirmed' }] }), false)
})

test('주기: 하루 1회 기본. 마지막 실행 후 하루가 안 지났으면 호출하지 않는다', () => {
  const q = { lastRunAt: '2026-10-23T01:00:00.000Z', items: [{ id: 'a', status: 'pending' }] }
  assert.equal(isDue(q, Date.parse('2026-10-23T10:00:00.000Z'), 1), false)
  assert.equal(isDue(q, Date.parse('2026-10-24T01:00:00.000Z'), 1), true)
  assert.equal(isDue(q, Date.parse('2026-10-24T01:00:00.000Z'), 2), false)
  assert.equal(isDue(q, Date.parse('2026-10-25T01:00:00.000Z'), 2), true)
})

test('묶음 상한: 한 번에 max 건까지만 담는다', () => {
  const items = Array.from({ length: 25 }, (_, i) => ({ id: `x${i}`, status: 'pending' }))
  assert.equal(batchOf({ items }, 20).length, 20)
})

test('판정 응답 파싱은 잘못된 형식을 무시한다', () => {
  assert.deepEqual(parseVerdicts('[{"id":"a","verdict":"확실","quote":"장애인 제한경쟁"}]'), { a: { verdict: '확실', quote: '장애인 제한경쟁' } })
  assert.deepEqual(parseVerdicts('응답 없음'), {})
  assert.deepEqual(parseVerdicts('[{"id":"a","verdict":"아마도"}]'), {})
})

test('확실이라도 인용문이 본문에 없으면 확정하지 않는다', () => {
  assert.equal(quoteInBody('장애인 제한경쟁', '이 공고는 장애인 제한 경쟁 입니다'), true)
  assert.equal(quoteInBody('장애인 제한경쟁', '일반 공개채용'), false)
  const q = { lastRunAt: null, items: [job('a', { status: 'pending' })] }
  const bodies = { a: '일반 공개채용' }
  const next = applyVerdicts(q, [q.items[0]], { a: { verdict: '확실', quote: '장애인 제한경쟁' } }, bodies, 'gemini', 0)
  assert.equal(next.items[0].status, 'needs-haiku')
})

test('Gemini 실패(판정 없음)·불명확은 2차로, 불가는 숨김으로 간다', () => {
  const q = { lastRunAt: null, items: [job('a', { status: 'pending' }), job('b', { status: 'pending' }), job('c', { status: 'pending' })] }
  const bodies = { a: '', b: '본문', c: '본문' }
  const next = applyVerdicts(q, q.items, { b: { verdict: '불명확', quote: '' }, c: { verdict: '불가', quote: '' } }, bodies, 'gemini', 0)
  assert.deepEqual(next.items.map((i) => i.status), ['needs-haiku', 'needs-haiku', 'hidden'])
})

test('확정 공고는 검수를 통과하고 근거·원문 URL 을 남긴다', () => {
  const q = { lastRunAt: null, items: [job('a', { status: 'pending' })] }
  const next = applyVerdicts(q, q.items, { a: { verdict: '확실', quote: '장애인 제한경쟁 채용' } }, { a: '공고: 장애인 제한경쟁 채용 안내' }, 'gemini', 0)
  const out = confirmedJobs(next)
  assert.equal(out.length, 1)
  assert.equal(out[0].disabledOnly, true)
  assert.equal(out[0].reviewed.evidenceUrl, 'https://ex.test/a')
  const v = validateJobs(out, { today: TODAY, rules: {} })
  assert.deepEqual(v.errors, [])
})

test('애매함 판정 함수', () => {
  assert.equal(isAmbiguous(job('a'), TODAY, rules), true)
  assert.equal(isAmbiguous(job('a', { disabledOnly: true }), TODAY, rules), false)
})
