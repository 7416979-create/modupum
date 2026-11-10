import test from 'node:test'
import assert from 'node:assert/strict'
import { applyManual, findDedicated, judgeRow, judgeAttachText, pickCandidates, needsFetch, toMixedJob, pruneCache, squash } from './mixed-lib.mjs'
import { validateJobs } from './validate-lib.mjs'
import { needsSummary } from './autosum-lib.mjs'

const row = (o) => ({ recrutPblntSn: 9001, instNm: '기관', recrutPbancTtl: '2026년 11차 계약직 채용 공고', pbancBgngYmd: '20261104', pbancEndYmd: '20261119', srcUrl: 'https://example.org/1', ...o })

test('제목에 장애가 없어도 모집분야에 장애인 제한경쟁이 있으면 통과한다', () => {
  const t = '대외협력실 | 일반계약직(장애인 제한경쟁) | 행정직 | 1명 | 대전'
  const v = findDedicated(`모집분야\n${t}\n연구직 | 일반계약직 | 3명`)
  assert.ok(v)
  assert.ok(v.evidence.includes('장애인 제한경쟁'))
})

test('표 안에서 글자가 갈라져도 잡는다', () => {
  assert.ok(findDedicated('일반계약직 (장애인\n제한 경쟁)'.replace('\n', ' ')))
  assert.ok(findDedicated('제한경쟁(장애인) 1명'))
  assert.ok(findDedicated('장애인 구분모집 2명'))
  assert.ok(judgeRow(row({ aplyQlfcCn: '○ 장애인전형 응시자격 : 등록 장애인' })))
})

test('제목에 장애인 제한경쟁이 있어도 포함 같은 혼합 공고는 통과한다', () => {
  assert.ok(judgeRow(row({ recrutPbancTtl: '직원(보훈제한경쟁 포함, 장애인 제한경쟁채용 포함) 채용' })))
})

test('우대·가점만 있으면 탈락한다', () => {
  assert.equal(findDedicated('장애인 우대 및 가점 부여'), null)
  assert.equal(findDedicated('취업지원대상자 및 장애인에 대하여 만점의 5% 가산'), null)
  assert.equal(findDedicated('장애인 전형단계별 가산점 적용'), null)
  assert.equal(judgeRow(row({ prefCn: '장애인 제한경쟁', prefCondCn: '장애인 전형' })), null)
})

test('비장애인·결격사유·법령 문구만 있으면 탈락한다', () => {
  assert.equal(findDedicated('비장애인 제한경쟁 채용'), null)
  assert.equal(findDedicated('육체적·정신적 장애로 인하여 업무수행이 곤란하다고 인정된 자는 결격사유'), null)
  assert.equal(findDedicated('「장애인고용촉진 및 직업재활법」 제2조에 따른 장애인구분'), null)
  assert.equal(findDedicated('장애인복지법 제59조의3(장애인관련기관 취업제한)'), null)
  assert.equal(findDedicated('장애인 제한없이 지원 가능'), null)
  assert.equal(findDedicated('(우대사항) 장애인(5%/장애인 제한경쟁 미해당), 지역인재(3%/장애인 제한경쟁 미해당)'), null)
  assert.equal(findDedicated('장애인(5%/장애인 제한경쟁 분야 미적용)'), null)
  assert.equal(findDedicated(''), null)
})

test('첨부 글자 판정: 근거 있음·없음·글자 없음(이미지)', () => {
  const body = `${'공고 안내 문구입니다. '.repeat(12)}\n행정직 일반계약직(장애인 제한경쟁) 1명`
  assert.equal(judgeAttachText(body, '첨부: a.pdf').state, 'yes')
  assert.equal(judgeAttachText(body, '첨부: a.pdf').source, '첨부: a.pdf')
  assert.equal(judgeAttachText('공고 안내 문구입니다. '.repeat(12), 'x').state, 'no')
  assert.equal(judgeAttachText('  \n ', 'x').state, 'noText')
  assert.equal(judgeAttachText('이미지', 'x').state, 'noText')
})

test('후보 선정: 마감 지난 공고·우대 제목·이미 올라가는 공고는 뺀다', () => {
  const rows = [
    row({ recrutPblntSn: 1 }),
    row({ recrutPblntSn: 2, pbancEndYmd: '20260101' }),
    row({ recrutPblntSn: 3, recrutPbancTtl: '일반 채용 장애인 우대' }),
    row({ recrutPblntSn: 4 }),
    row({ recrutPblntSn: 5, aplyQlfcCn: '장애인 등록자' }),
    row({ recrutPblntSn: 6, recrutPbancTtl: '최종합격자 발표' }),
  ]
  const ids = pickCandidates(rows, { today: '2026-11-05', excludeIds: new Set(['4']) }).map((r) => r.recrutPblntSn)
  assert.deepEqual(ids, [5, 1])
})

test('이미 판정한 공고는 다시 받지 않고 글자 없음은 3번까지만 다시 본다', () => {
  assert.equal(needsFetch(undefined), true)
  assert.equal(needsFetch({ state: 'no' }), false)
  assert.equal(needsFetch({ state: 'yes' }), false)
  assert.equal(needsFetch({ state: 'noText', tries: 1 }), true)
  assert.equal(needsFetch({ state: 'noText', tries: 3 }), false)
})

test('캐시는 마감 지난 항목을 지운다', () => {
  assert.deepEqual(Object.keys(pruneCache({ a: { end: '2026-11-01' }, b: { end: '2026-11-06' } }, '2026-11-05')), ['b'])
})

test('mixed 공고는 검수를 통과하고(근거 필수) 근거가 있으면 자동 요약 대기에 들어간다', () => {
  const j = toMixedJob(row({ recrutPblntSn: 9002 }), { evidence: '일반계약직(장애인 제한경쟁) 행정직 1명', source: '첨부: a.pdf' })
  assert.equal(j.mixed, true)
  assert.equal(j.disabledOnly, true)
  const ok = validateJobs([j], { today: '2026-11-05', rules: { 제목_제외: ['포함'] } })
  assert.deepEqual(ok.errors, [])
  assert.equal(ok.items.length, 1)
  const noEvidence = validateJobs([{ ...j, mixedEvidence: '' }], { today: '2026-11-05', rules: {} })
  assert.equal(noEvidence.errors.length, 1)
  assert.equal(needsSummary(j, '2026-11-05'), true) // 11-10 정책: 병행 공고도 근거가 있으면 장애인 분야만 요약(verifyEasy 가 따로 검사)
  assert.equal(needsSummary({ ...j, mixedEvidence: '' }, '2026-11-05'), false) // 근거가 없으면 자동 요약 안 함(수동)
  assert.equal(squash(' 장애인 | 제한 경쟁 '), '장애인제한경쟁')
})

test('제목에 포함이 있는 mixed 도 통과하지만 우대 제목은 검수 오류다', () => {
  const j = toMixedJob(row({ recrutPblntSn: 9003, recrutPbancTtl: '직원(보훈제한경쟁 포함, 장애인 제한경쟁채용 포함) 채용' }), { evidence: 'x', source: '공고 정보' })
  assert.deepEqual(validateJobs([j], { today: '2026-11-05', rules: { 제목_제외: ['포함'] } }).errors, [])
  const bad = { ...j, title: '채용 장애인 우대' }
  assert.equal(validateJobs([bad], { today: '2026-11-05', rules: {} }).errors.length, 1)
})

test('수동 확정 목록은 검수를 통과하고 근거·출처가 있다', async () => {
  const { readFileSync } = await import('node:fs')
  const manual = JSON.parse(readFileSync(new URL('./mixed-manual.json', import.meta.url), 'utf8')).items
  assert.ok(manual.length >= 1)
  for (const j of manual) {
    assert.ok(j.mixedEvidence && j.mixedSource && j.url.startsWith('https://'))
    const r = validateJobs([j], { today: j.start, rules: { 제목_제외: ['포함'] } })
    assert.deepEqual(r.errors, [])
    assert.equal(r.items.length, 1)
  }
  // 마감이 지나면 검수가 자동으로 뺀다
  assert.equal(validateJobs([manual[0]], { today: '2099-01-01', rules: {} }).items.length, 0)
})

test('수동 확정 공고는 마감 전이면 넣고, 이미 있으면 중복 없이 한 번만, 마감 지나면 넣지 않는다', async () => {
  const { readFileSync } = await import('node:fs')
  const manual = JSON.parse(readFileSync(new URL('./mixed-manual.json', import.meta.url), 'utf8')).items
  const base = [{ id: '1', title: '다른 공고', org: '기관', end: '2026-11-30', url: 'https://a.kr/1', disabledOnly: true }]
  const r1 = applyManual(base, manual, '2026-11-05')
  assert.equal(r1.added, 1)
  assert.equal(r1.items.length, 2)
  assert.equal(applyManual(r1.items, manual, '2026-11-05').added, 0)
  assert.equal(applyManual(base, manual, '2026-11-20').added, 0)
  // 같은 공고가 공공데이터에도 올라오면(기관·제목·마감일 같음) 하나만 남고 공공데이터 쪽이 우선한다
  const api = { id: '306999', title: manual[0].title, org: manual[0].org, end: manual[0].end, url: 'https://x.kr', disabledOnly: true, mixed: true, mixedEvidence: 'e' }
  const r3 = applyManual([api], manual, '2026-11-05')
  assert.equal(r3.items.length, 1)
  assert.equal(r3.items[0].id, '306999')
})
