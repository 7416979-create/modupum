import { test } from 'node:test'
import assert from 'node:assert/strict'
import { selectNew, bundleItem, parseResult, planApply, removeHidden, filterHidden, decide, MAX_HIDE } from './ai-review-lib.mjs'

const jobs = [
  { id: 'a', title: 'A', end: '2026-12-01' },
  { id: 'b', title: 'B', end: '2026-12-02' },
  { id: 'c', title: 'C', end: '2026-12-03' },
]
const NONE = new Set()
const plain = (id, extra = {}) => [id, { id, title: '일반 채용 공고', org: 'O', source: 'KEAD', end: '2026-12-01', url: 'u', ...extra }]

test('prep: 이미 판정한 공고 제외, 상한 적용', () => {
  const picked = selectNew(jobs, { a: { verdict: '전용' } }, 15)
  assert.deepEqual(picked.map((j) => j.id), ['b', 'c'])
  assert.equal(selectNew(jobs, {}, 2).length, 2)
  assert.equal(selectNew(jobs, {}, 1)[0].id, 'a')
})

test('prep: 근거 정리, 본문은 4000자 이내, verified 표시', () => {
  const b = bundleItem({ id: 'x', title: 'T', summary: { 장애인관련: ['장애인 제한'] }, bodyText: 'a'.repeat(5000), verified: true })
  assert.equal(b.disabledEvidence, '장애인 제한')
  assert.equal(b.bodyText.length, 4000)
  assert.equal(b.verified, true)
})

test('parse: 정상 JSON 배열, 묶음에 없는 id 무시', () => {
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

test('안전장치 1: 제목에 제한경쟁(보훈·장애인 묶음)이 있으면 아님 판정이어도 숨기지 않음', () => {
  const bundle = new Map([plain('306871', { title: '보훈·장애인 제한경쟁 채용' })])
  const p = planApply([{ id: '306871', verdict: '아님', reason: 'r', quote: '우대' }], {}, { items: [] }, { items: [] }, bundle, 'NOW', NONE)
  assert.deepEqual(p.added.hide, [])
  assert.deepEqual(p.added.kept, ['306871'])
  assert.equal(decide({ id: 'x', verdict: '아님', quote: '' }, { title: '장애인 전형 채용' }).action, 'keep')
})

test('안전장치 2: 수동 확정(mixed-manual 또는 verified) 공고는 숨기지 않음', () => {
  const bundle = new Map([plain('m1'), plain('gojobs-308652', { verified: true, title: '일반' })])
  const results = [
    { id: 'm1', verdict: '아님', reason: 'r', quote: '' },
    { id: 'gojobs-308652', verdict: '애매', reason: 'r', quote: '' },
  ]
  const p = planApply(results, {}, { items: [] }, { items: [] }, bundle, 'NOW', new Set(['m1']))
  assert.deepEqual(p.added.hide, [])
  assert.deepEqual(p.added.queue, ['gojobs-308652']) // 애매는 숨기지 않고 대기열
  assert.deepEqual(p.added.kept, ['m1'])
})

test('안전장치 3: 애매는 숨기지 않고 대기열에만', () => {
  const bundle = new Map([plain('b')])
  const p = planApply([{ id: 'b', verdict: '애매', reason: 'r', quote: 'q' }], {}, { items: [] }, { items: [] }, bundle, 'NOW', NONE)
  assert.deepEqual(p.added.hide, [])
  assert.deepEqual(p.added.queue, ['b'])
  assert.equal(p.queue.items[0].status, 'ai-ambiguous')
})

test('안전장치 4: 아님인데 인용문에 제한 표현이 있으면 대기열(판정 모순)', () => {
  const bundle = new Map([plain('c')])
  const p = planApply([{ id: 'c', verdict: '아님', reason: 'r', quote: '장애인 제한 채용 2명' }], {}, { items: [] }, { items: [] }, bundle, 'NOW', NONE)
  assert.deepEqual(p.added.hide, [])
  assert.deepEqual(p.added.queue, ['c'])
})

test('안전장치 5: 숨김 후보가 3건을 넘으면 아무것도 숨기지 않고 전부 대기열', () => {
  const ids = ['p1', 'p2', 'p3', 'p4']
  const bundle = new Map(ids.map((id) => plain(id)))
  const results = ids.map((id) => ({ id, verdict: '아님', reason: 'r', quote: '' }))
  const p = planApply(results, {}, { items: [] }, { items: [] }, bundle, 'NOW', NONE)
  assert.equal(MAX_HIDE, 3)
  assert.deepEqual(p.added.hide, [])
  assert.equal(p.added.queue.length, 4)
  assert.match(p.added.warning, /4건 > 3건/)
})

test('숨김 3건 이하는 정상 숨김, 같은 결과 재적용해도 중복 없음', () => {
  const bundle = new Map([plain('a'), plain('b')])
  const results = [{ id: 'a', verdict: '아님', reason: 'r', quote: '' }, { id: 'b', verdict: '전용', reason: '', quote: '' }]
  const p = planApply(results, {}, { items: [] }, { items: [] }, bundle, 'NOW', NONE)
  assert.deepEqual(p.added.hide, ['a'])
  assert.equal(p.log.b.verdict, '전용')
  const p2 = planApply(results, p.log, p.hide, p.queue, bundle, 'NOW2', NONE)
  assert.equal(p2.hide.items.length, 1)
})

test('숨김 목록: jobs 에서 제외, 수집 필터에서도 제외', () => {
  const hide = new Set(['a'])
  const r = removeHidden({ sample: false, items: jobs }, hide)
  assert.deepEqual(r.data.items.map((j) => j.id), ['b', 'c'])
  assert.equal(r.removed, 1)
  assert.deepEqual(filterHidden(jobs, hide).map((j) => j.id), ['b', 'c'])
  assert.equal(filterHidden(jobs, new Set()).length, 3)
})
