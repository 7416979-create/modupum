import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { normTitle, dedupeJobs, specificUrl } from './dedupe-lib.mjs'
import { mergeJobs } from './gojobs-lib.mjs'
import { validateJobs, validateWelfare, isAbnormalDrop } from './validate-lib.mjs'

const rules = JSON.parse(readFileSync(new URL('./keywords.json', import.meta.url), 'utf8'))
const today = '2026-10-21'
const job = (o) => ({ id: 'a', title: '기관 공무직(장애인 제한경쟁) 채용', org: '기관', end: '2026-10-30', url: 'https://x.kr/v?1', disabledOnly: true, ...o })

test('제목 정규화: 공백·괄호·채용공고 제거', () => {
  assert.equal(normTitle('[기관] 공무직 (장애인 제한경쟁) 채용 공고'), normTitle('기관 공무직 장애인제한경쟁'))
})

test('id 가 달라도 기관+제목+마감일이 같으면 하나만, API 쪽을 남긴다', () => {
  const api = job({ id: '100', title: '[기관] 공무직(장애인 제한경쟁) 채용공고', url: 'https://x.kr/a?1' })
  const goj = job({ id: 'gojobs-9', source: '나라일터', url: 'https://gojobs/search' })
  assert.deepEqual(mergeJobs([api], [goj]).map((j) => j.id), ['100'])
  assert.deepEqual(mergeJobs([goj], [api]).map((j) => j.id), ['100'])
})

test('마감일이 다르면 다른 공고', () => {
  assert.equal(dedupeJobs([job({ id: '1' }), job({ id: '2', end: '2026-11-01', url: 'https://x.kr/other?2' })]).items.length, 2)
})

test('같은 원문 URL(공고별 주소)·같은 기관·같은 마감일이면 중복, 일반 홈페이지 주소는 아님', () => {
  const a = job({ id: '1', title: '가 공고 장애인' })
  const b = job({ id: '2', title: '완전히 다른 제목 장애인' })
  assert.equal(dedupeJobs([a, b]).items.length, 1)
  const h1 = job({ id: '1', title: '가나 장애인', url: 'https://x.kr/' })
  const h2 = job({ id: '2', title: '다라 장애인', url: 'https://x.kr/' })
  assert.equal(specificUrl('https://x.kr/'), false)
  assert.equal(dedupeJobs([h1, h2]).items.length, 2)
})

test('같은 출처끼리면 정보가 더 많은 쪽을 남긴다', () => {
  const a = job({ id: '1', source: '나라일터', region: '' })
  const b = job({ id: '2', source: '나라일터', region: '서울', hires: 3, title: a.title + ' 채용공고' })
  assert.equal(dedupeJobs([a, b]).items[0].id, '2')
})

test('검수: 정상 데이터는 통과', () => {
  const r = validateJobs([job()], { today, rules })
  assert.deepEqual(r.errors, [])
  assert.equal(r.items.length, 1)
})

test('검수: 마감 지남·id 중복·내용 중복은 자동 제거', () => {
  const r = validateJobs(
    [job({ id: '1' }), job({ id: '1', title: '다른 장애인' }), job({ id: '2', end: '2026-10-20', title: '지남 장애인', url: 'https://y.kr/p?1' }), job({ id: '3' })],
    { today, rules },
  )
  assert.deepEqual(r.items.map((j) => j.id), ['1'])
  assert.equal(r.fixes.length, 3)
  assert.deepEqual(r.errors, [])
})

test('검수: 필수 항목·날짜 형식·disabledOnly·제외 표현은 오류', () => {
  const r = validateJobs(
    [
      job({ id: 'n', org: '' }),
      job({ id: 'd', end: '2026/11/01', url: 'https://d.kr/p?1', title: 'd 장애인' }),
      job({ id: 'o', disabledOnly: false, url: 'https://o.kr/p?1', title: 'o 장애인' }),
      job({ id: 'p', title: '장애인 우대 채용', url: 'https://p.kr/p?1' }),
      job({ id: 'q', title: '장애인 우선채용', url: 'https://q.kr/p?1' }),
      job({ id: 'r', title: '일반 및 장애인 포함', url: 'https://r.kr/p?1' }),
    ],
    { today, rules },
  )
  const text = r.errors.join('\n')
  for (const k of ['n: 필수 항목 org', 'd: end 날짜 형식', 'o: disabledOnly', "p: 제목에 제외 표현 '우대'", "q: 제목에 제외 표현 '우선채용'", "r: 제목에 제외 표현 '포함'"]) {
    assert.ok(text.includes(k), k)
  }
})

test('건수 급감 판정', () => {
  assert.equal(isAbnormalDrop(39, 19), true)
  assert.equal(isAbnormalDrop(39, 20), false)
  assert.equal(isAbnormalDrop(3, 0), false)
})

test('복지 검수: 중복 제거, id/제목 없음은 오류', () => {
  const w = (o) => ({ id: '1', title: 'T', org: 'O', url: 'https://w', ...o })
  const r = validateWelfare([w(), w({ id: '2' }), w({ id: '' }), w({ id: '3', title: 'T2', url: '' })])
  assert.equal(r.items.length, 2)
  assert.equal(r.fixes.length, 1)
  assert.equal(r.errors.length, 2)
})
