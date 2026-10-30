import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseList, bodyLines, bodyEndDate, summarize, buildJob, isKeadDisabledTitle, mergeKead, viewUrl, UNKNOWN } from './kead-lib.mjs'

const rules = JSON.parse(readFileSync(new URL('./keywords.json', import.meta.url), 'utf8'))

const tr = (n, id, title, end, start) => `<tr><td>${n}</td><td><a class="view_link" href="javascript:void(0);" onClick="javascript:fn_bbsView('${id}'); ">
 ${title} </a></td><td>서울특별시</td><td>영등포구</td><td>공사/공기업</td><td> ${end}</td><td>${start}</td></tr>`
const html = `<table><tbody>${tr(2, 217086, '[서울남부지사] 중증장애인 사무보조 채용공고(~11.5. 16시)', '2026-11-05', '2026-10-22')}
${tr(1, 217000, '[강원지사] 조달청 공무직 장애인 전형 공고(장애인만)', '2026-10-28', '2026-10-16')}</tbody></table>`

test('목록 행을 읽는다', () => {
  const rows = parseList(html)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].id, '217086')
  assert.equal(rows[0].end, '2026-11-05')
  assert.equal(rows[0].region, '서울특별시 영등포구')
})

const body = `<div class="main_text"><p>1. 사업체명 : 한국해외인프라도시개발지원공사&nbsp;</p>
<p>4. 채용인원 : 3명</p><p>5. 근무조건 : 계약직 시간제</p>
<p>9. 지원자격 : 중증장애인에 해당하는 자</p>
<p>10. 모집기간 :&nbsp; 2026. 10. 22.(목) ~ 2026. 11. 6.(목) 16:00 접수마감</p>
<p>12. 지원방법 : 이메일 제출, abc@kead.or.kr로 보내주시기 바랍니다.</p>
<p>13. 문의: 담당자 장애인고용공단 02-000-0000</p></div>`

test('본문에서 확인되는 사실만 요약하고 이메일은 가린다', () => {
  const lines = bodyLines(body)
  const s = summarize(lines)
  assert.equal(s.hires, 3)
  assert.match(s.summary.접수방법, /이메일/)
  assert.ok(!s.summary.접수방법.includes('abc@'))
  assert.deepEqual(s.summary.장애인관련, ['9. 지원자격 : 중증장애인에 해당하는 자'])
})
test('본문에 없는 항목은 확인 안 됨', () => {
  const s = summarize(['아무 내용 없음'])
  assert.equal(s.summary.채용인원, UNKNOWN)
  assert.equal(s.summary.접수방법, UNKNOWN)
  assert.deepEqual(s.summary.장애인관련, [UNKNOWN])
})
test('마감일이 목록과 본문이 다르면 본문 우선 + 안내문', () => {
  const rows = parseList(html)
  assert.equal(bodyEndDate(bodyLines(body), '2026-11-05'), '2026-11-06')
  const job = buildJob(rows[0], bodyLines(body), rules)
  assert.equal(job.end, '2026-11-06')
  assert.ok(job.notes.some((n) => n.includes('다릅니다')))
  assert.equal(job.url, viewUrl('217086'))
  assert.equal(job.org, '한국해외인프라도시개발지원공사')
})
test('제목에 장애인 대상이 없으면 disabledOnly 가 false 이고 안내문은 붙이지 않는다', () => {
  const [a, b] = parseList(html)
  const c = { ...a, title: '[서울지역본부] 경성고등학교 미화 1명 모집(채용시)' }
  assert.equal(buildJob(a, [], rules).disabledOnly, true)
  assert.equal(buildJob(c, [], rules).disabledOnly, false)
  assert.equal(buildJob(a, [], rules).eligibilityNote, undefined)
  assert.equal(buildJob(b, [], rules).disabledOnly, true)
})
test('합칠 때 마감 지난 것·이미 있는 공고는 넣지 않고 이전 KEAD 분은 바꾼다', () => {
  const [a] = parseList(html)
  const job = buildJob(a, bodyLines(body), rules)
  const old = { ...job, id: 'kead-1', title: '옛 공고', end: '2026-11-30' }
  const same = { id: 'x', title: 'zz', org: '한국해외인프라도시개발지원공사', end: '2026-11-06', url: 'https://a.kr/x?1', disabledOnly: true }
  assert.equal(mergeKead([old], [job], '2026-10-22').items.some((j) => j.id === 'kead-1'), false)
  assert.equal(mergeKead([same], [job], '2026-10-22').added, 0)
  assert.equal(mergeKead([], [{ ...job, end: '2026-10-01' }], '2026-10-22').added, 0)
})
test('이전 KEAD 공고에 채운 쉬운 요약(verified, easy)은 다시 합쳐도 남는다', () => {
  const [a] = parseList(html)
  const job = { ...buildJob(a, bodyLines(body), rules), disabledOnly: true, end: '2026-11-30' }
  const prev = { ...job, verified: true, easy: { 언제까지: 'x' } }
  const r = mergeKead([prev], [job], '2026-10-22')
  const got = r.items.find((j) => j.id === job.id)
  assert.equal(got.verified, true)
  assert.deepEqual(got.easy, { 언제까지: 'x' })
})

test('KEAD 제목에 장애인 대상이 드러나면 통과, 기관명·우대·혼합은 거른다', () => {
  const ok = [
    '[서울남부지사] 2026년 한국해외인프라도시개발지원공사 중증장애인 사무보조 채용공고(~11.5. 16시)',
    '[경기북부지사] 의정부지방공소청 장애인 공무직근로자(사무원) 경력경쟁채용',
    '[광주보훈요양원]2026년 제3차 중증장애인 체험형 청년인턴(단시간_일4시간)채용공고',
    '[서울동부지사] 대한무역투자진흥공사 장애인 체험형 청년 인턴 채용(~11/8)',
    '[장애인채용] 2026년 농촌진흥청 일반직공무원 경력경쟁채용시험 공고',
    '장애인 근로자 모집',
  ]
  for (const t of ok) assert.equal(isKeadDisabledTitle(t), true, t)
  const no = [
    '[경기동부지사] 용인시장애인자립생활센터 권리중심형 일자리 추가 모집',
    '[서울지역본부] 한국언론진흥재단 체험형 청년인턴 2명 모집(~11/9)',
    '[서울지역본부] 경성고등학교 미화 1명 모집(채용시)',
    '일반직 채용 (장애인 우대)',
    '비장애인 포함 공개경쟁 채용',
  ]
  for (const t of no) assert.equal(isKeadDisabledTitle(t), false, t)
})
