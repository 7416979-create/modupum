import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const dir = mkdtempSync(path.join(tmpdir(), 'mixed-test-'))
process.env.MIXED_CACHE_FILE = path.join(dir, 'cache.json')
const { collectMixed } = await import('./mixed-run.mjs')

const row = (sn, o = {}) => ({ recrutPblntSn: sn, instNm: '기관', recrutPbancTtl: `2026년 ${sn} 계약직 채용 공고`, pbancBgngYmd: '20261104', pbancEndYmd: '20261119', srcUrl: 'https://example.org/x', ...o })

test('상세의 모집단계에 장애인 제한경쟁이 있으면 게시하고, 판정은 저장해 다시 받지 않는다', async () => {
  let calls = 0
  const getDetail = async (sn) => {
    calls += 1
    return sn === '1' ? { steps: [{ recrutPbancTtl: '일반계약직(장애인 제한경쟁) 행정직' }], files: [] } : { steps: [], files: [] }
  }
  const quiet = () => {}
  const r1 = await collectMixed([row(1), row(2)], { today: '2026-11-05', getDetail, log: quiet })
  assert.deepEqual(r1.jobs.map((j) => j.id), ['1'])
  assert.equal(r1.jobs[0].mixed, true)
  assert.match(r1.jobs[0].mixedEvidence, /장애인 제한경쟁/)
  assert.equal(calls, 2)
  // 두 번째 실행: 1번은 게시 유지(상세 호출 없음), 2번은 첨부 없음 → 글자 없음으로 저장돼 다시 시도 가능 횟수만큼만 호출
  const r2 = await collectMixed([row(1), row(2)], { today: '2026-11-05', getDetail, log: quiet })
  assert.deepEqual(r2.jobs.map((j) => j.id), ['1'])
  assert.equal(calls, 3)
  const saved = JSON.parse(readFileSync(process.env.MIXED_CACHE_FILE, 'utf8')).items
  assert.equal(saved['1'].state, 'yes')
  assert.equal(saved['2'].state, 'noText')
  assert.equal(saved['2'].tries, 2)
})

test('실행당 확인 건수 상한과, 상세 조회 연속 실패 시 새 확인 중단(이미 판정한 공고는 유지)', async () => {
  const quiet = () => {}
  const okDetail = async () => ({ steps: [{ recrutPbancTtl: '행정(장애인 제한경쟁)' }], files: [] })
  const first = await collectMixed([row(10)], { today: '2026-11-05', getDetail: okDetail, log: quiet })
  assert.equal(first.jobs.length, 1)
  let calls = 0
  const failing = async () => { calls += 1; throw new Error('HTTP 429') }
  const rows = [row(10), row(11), row(12), row(13), row(14), row(15)]
  const r = await collectMixed(rows, { today: '2026-11-05', getDetail: failing, log: quiet })
  assert.deepEqual(r.jobs.map((j) => j.id), ['10'])
  assert.equal(calls, 3)
  assert.equal(r.stats.미확인대기, 5)
})

test('마감 지난 공고와 우대 제목은 후보에서 빠져 상세를 부르지 않는다', async () => {
  let calls = 0
  const getDetail = async () => { calls += 1; return { steps: [], files: [] } }
  await collectMixed([row(20, { pbancEndYmd: '20260101' }), row(21, { recrutPbancTtl: '채용 장애인 우대' })], { today: '2026-11-05', getDetail, log: () => {} })
  assert.equal(calls, 0)
})
