import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildJobs, rowsOf, toIsoDate, listUrl } from './jobs-lib.mjs'

const rules = JSON.parse(readFileSync(new URL('./keywords.json', import.meta.url), 'utf8'))

const row = (o) => ({ item: { recrutPblntSn: 1, instNm: '기관', recrutPbancTtl: '', pbancBgngYmd: '20261001', pbancEndYmd: '20261231', srcUrl: 'https://example.org/1', ...o } })

test('날짜를 YYYY-MM-DD 로 바꾼다', () => {
  assert.equal(toIsoDate('20261231'), '2026-12-31')
  assert.equal(toIsoDate(''), '')
})

test('result 가 [{item}] 형태든 [item] 형태든 읽는다', () => {
  assert.equal(rowsOf({ result: [row({})] }).length, 1)
  assert.equal(rowsOf({ result: [{ recrutPblntSn: 1 }] }).length, 1)
  assert.equal(rowsOf({}).length, 0)
})

test('제한경쟁·전용 공고만 남기고 우대만 있는 공고는 뺀다', () => {
  const rows = rowsOf({
    result: [
      row({ recrutPblntSn: 1, recrutPbancTtl: '2026년 장애인 제한경쟁 채용' }),
      row({ recrutPblntSn: 2, recrutPbancTtl: '일반 채용 공고', prefCn: '장애인 우대' }),
      row({ recrutPblntSn: 3, recrutPbancTtl: '장애인 우대 채용' }),
      row({ recrutPblntSn: 4, recrutPbancTtl: '청년인턴 모집', aplyQlfcCn: '장애인 구분모집' }),
      row({ recrutPblntSn: 5, recrutPbancTtl: '일반 채용' }),
    ],
  })
  const ids = buildJobs(rows, rules, '2026-10-12').map((j) => j.id)
  assert.deepEqual(ids, ['1', '4'])
})

test('마감된 공고는 뺀다', () => {
  const rows = rowsOf({ result: [row({ recrutPbancTtl: '장애인 제한경쟁', pbancEndYmd: '20260901' })] })
  assert.equal(buildJobs(rows, rules, '2026-10-12').length, 0)
})

test('키는 이미 인코딩된 값이면 그대로 쓴다', () => {
  assert.ok(listUrl('a%2Fb', 1).includes('serviceKey=a%2Fb&'))
  assert.ok(listUrl('a/b', 1).includes('serviceKey=a%2Fb&'))
})
