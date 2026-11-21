import { test } from 'node:test'
import assert from 'node:assert/strict'
import { selectNew, bundleItem, parseResult, planApply, removeHidden, filterHidden } from './ai-review-lib.mjs'

const jobs = [
  { id: 'a', title: 'A', end: '2026-12-01' },
  { id: 'b', title: 'B', end: '2026-12-02' },
  { id: 'c', title: 'C', end: '2026-12-03' },
]

test('prep: 이미 판정한 공고 제외, 상한 적용', () => {
  const picked = selectNew(jobs, { a: { verdict: '전용' } }, 15)
  assert.deepEqual(picked.map((j) => j.id), ['b', 'c'])
  assert.equal(selectNew(jobs, {}, 2).length, 2)
  assert.equal(selectNew(jobs, {}, 1)[0].id, 'a')
})

test('prep: 근거 필드 정리, 본문은 4000자 이내', () => {
  const b = bundleItem({ id: 'x', title: 'T', summary: { 장애인관련: ['장애인 제한'] }, bodyText: 'a'.repeat(5000) })
  assert.equal(b.disabledEvidence, '장애인 제한')
  assert.equal(b.bodyText.length, 4000)
  assert.equal(b.url, '')
})

test('parse: 정상 JSON 배열 읽기, 묶음에 없는 id 무시', () => {
  const text = '[{"id":"a","verdict":"아님","reason":"우대만","quote":"장애인 우대"},{"id":"zz","verdict":"전용","reason":"","quote":""}]'
  const r = parseResult(text, new Set(['a', 'b']))
  assert.deepEqual(r.map((x) => x.id), ['a'])
  assert.equal(r[0].verdict, '아님')
})

test('parse: 깨진 입력은 throw', () => {
  const ids = new Set(['a'])
  assert.throws(() => parseResult('', ids))
  assert.throws(() => parseResult('아무 말', ids))
  assert.throws(() => parseResult('[{"id":', ids))
  assert.throws(() => parseResult('[{"id":"a","verdict":"모름"}]', ids))
})

test('apply: 아님 -> 숨김, 애매 -> 숨김 + 대기열, 전용 -> 기록만', () => {
  const bundle = new Map([
    ['a', { id: 'a', title: 'A', org: 'O', source: 'KEAD', end: '2026-12-01', url: 'u' }],
    ['b', { id: 'b', title: 'B' }],
    ['c', { id: 'c', title: 'C' }],
  ])
  const results = [
    { id: 'a', verdict: '아님', reason: 'r1', quote: 'q1' },
    { id: 'b', verdict: '애매', reason: 'r2', quote: 'q2' },
    { id: 'c', verdict: '전용', reason: '', quote: 'q3' },
  ]
  const p = planApply(results, {}, { items: [] }, { items: [] }, bundle, 'NOW')
  assert.deepEqual(p.added.hide, ['a', 'b'])
  assert.deepEqual(p.added.queue, ['b'])
  assert.equal(p.queue.items[0].status, 'ai-ambiguous')
  assert.equal(p.log.c.verdict, '전용')
  assert.equal(p.log.a.checkedAt, 'NOW')
  // 같은 결과를 두 번 적용해도 중복되지 않음
  const p2 = planApply(results, p.log, p.hide, p.queue, bundle, 'NOW2')
  assert.equal(p2.hide.items.length, 2)
  assert.equal(p2.queue.items.length, 1)
})

test('숨김 목록: jobs 에서 제외, 수집 필터에서도 제외', () => {
  const hide = new Set(['a'])
  const r = removeHidden({ sample: false, items: jobs }, hide)
  assert.deepEqual(r.data.items.map((j) => j.id), ['b', 'c'])
  assert.equal(r.removed, 1)
  assert.deepEqual(filterHidden(jobs, hide).map((j) => j.id), ['b', 'c'])
  assert.equal(filterHidden(jobs, new Set()).length, 3)
})
