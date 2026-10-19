import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseList, buildGojobs, mergeJobs, searchUrl, isDisabledOnlyTitle } from './gojobs-lib.mjs'

const rules = JSON.parse(readFileSync(new URL('./keywords.json', import.meta.url), 'utf8'))

const tr = (n, title, org, start, end, sn) => `<tr >
 <td align="center" scope="row">${n}</td>
 <td class="ta_l elip"> <div><img src="/images/icon/rec_img3.png" alt="공공"/></div>
  <a style="x" href="javascript:fn_apmView('020', '${sn}')"> ${title} </a> </td>
 <td align="center"> ${org} </td> <td align="center"> ${start}</b> </td> <td align="center"> ${end} </td> <td align="center"> 22 </td> </tr>`

const html = `<div>Total 3397 (1/340)</div><table><tbody>
${tr(1, '2026년 제28차 충남사회서비스원 본부 기간제(사무보조-장애인전형) 직원 공개채용 재공고', '충남사회서비스원', '2026-10-19', '2026-10-29', 306018)}
${tr(2, '국립현대미술관 청주관운영부 공무직근로자(학예원) 장애인 제한경쟁채용 공고', '국립현대미술관', '2026-10-19', '2026-10-26', 306017)}
${tr(3, '2026년도 제1차 직원(일반정규직, 보훈제한경쟁 포함), 체험형 청년인턴(장애인 제한경쟁) 채용', '한국어딘가', '2026-10-18', '2026-10-30', 306016)}
${tr(4, '장애인 제한경쟁 마감된 공고', '기관', '2026-09-01', '2026-09-10', 300001)}
</tbody></table>`

test('목록 행을 읽는다', () => {
  const { total, rows } = parseList(html)
  assert.equal(total, 3397)
  assert.equal(rows.length, 4)
  assert.deepEqual(rows[0], { code: '020', sn: '306018', title: '2026년 제28차 충남사회서비스원 본부 기간제(사무보조-장애인전형) 직원 공개채용 재공고', org: '충남사회서비스원', start: '2026-10-19', end: '2026-10-29' })
})

test('접수 중 공고를 모두 담고, 장애인전형·제한경쟁만 전용으로 표시한다(마감된 공고는 뺀다)', () => {
  const jobs = buildGojobs(parseList(html).rows, rules, '2026-10-19')
  assert.deepEqual(jobs.map((j) => [j.id, j.disabledOnly]), [
    ['gojobs-306018', true],
    ['gojobs-306017', true],
    ['gojobs-306016', false],
  ])
  assert.equal(jobs[0].source, '나라일터')
})

test('전용 표현이 없으면 제외한다', () => {
  assert.equal(isDisabledOnlyTitle('장애인 우대 채용', rules), false)
})

test('원문 링크는 제목으로 검색한 목록 주소다', () => {
  assert.match(searchUrl('가 나', '020'), /searchKeyword=%EA%B0%80%20%EB%82%98$/)
})

test('같은 기관·제목은 한 번만 넣는다', () => {
  const base = [{ id: '1', org: '충남사회서비스원', title: '공고 A', end: '2026-11-01' }]
  const extra = [
    { id: 'g1', org: '충남사회서비스원', title: '공고  A', end: '2026-11-01' },
    { id: 'g2', org: '다른기관', title: '공고 B', end: '2026-10-25' },
  ]
  assert.deepEqual(mergeJobs(base, extra).map((j) => j.id), ['g2', '1'])
})
