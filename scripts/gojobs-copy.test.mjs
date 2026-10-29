import test from 'node:test'
import assert from 'node:assert/strict'
import { parseView, bodyToText, renderCopyHtml, expiredSns, copyUrl, isCopyUrl, attachOrder } from './gojobs-copy-lib.mjs'
import { validateJobs } from './validate-lib.mjs'

const view = `<table id="apmViewTbl"><tr><th scope="col">공고명</th><td colspan="3">장애인 제한경쟁 &amp; 채용</td></tr>
<tr><th>기관명</th><td>가나다청</td><th>조회</th><td>5</td></tr>
<tr><th>접수마감일</th><td>2026-11-13</td></tr>
<tr><th>첨부파일</th><td><p><a href="javascript:gfn_fileDown('공고 (재).hwpx','2195','employ/가나다청')">x</a></p>
<p><a href="javascript:gfn_fileDown('공고 (재).pdf','1025','employ/가나다청')">y</a></p></td></tr>
<tr><td colspan="4"><textarea id="content" style="display:none;" title="내용입력">ㅇ 모집 &lt;b&gt;1명&lt;/b&gt;
ㅇ 문의 : 054-000-0000&lt;script&gt;alert(1)&lt;/script&gt;</textarea></td></tr></table>`

test('상세 페이지에서 항목·첨부·본문을 읽는다', () => {
  const v = parseView(view)
  assert.equal(v.fields['공고명'], '장애인 제한경쟁 & 채용')
  assert.equal(v.fields['접수마감일'], '2026-11-13')
  assert.deepEqual(v.files.map((f) => [f.name, f.uuid, f.saveGbn]), [['공고 (재).hwpx', '2195', 'employ/가나다청'], ['공고 (재).pdf', '1025', 'employ/가나다청']])
  assert.match(v.body, /모집 1명/)
  assert.doesNotMatch(v.body, /<|alert\(1\)>/)
})

test('PDF 를 먼저 둔다', () => {
  assert.deepEqual(attachOrder(parseView(view).files).map((f) => f.name.split('.').pop()), ['pdf', 'hwpx'])
})

test('본문은 태그를 버리고 줄바꿈을 유지한다', () => {
  assert.equal(bodyToText('<p>가</p><p>나<br>다</p>'), '가\n나\n다')
  assert.equal(bodyToText('a\r\n\r\n\r\n\r\nb'), 'a\n\nb')
})

test('사본 HTML 은 출처 고지·수집 시각을 담고 값을 이스케이프한다', () => {
  const job = { id: 'gojobs-1', title: '<img src=x onerror=1> 제목', org: '기관', start: '2026-10-01', end: '2026-11-13' }
  const html = renderCopyHtml({ job, view: parseView(view), files: [{ name: 'a.pdf', href: 'attach-1.pdf', size: 2048 }], collectedAt: Date.UTC(2026, 9, 29, 3, 0), sn: '1' })
  assert.match(html, /사본입니다/)
  assert.match(html, /최종 확인은 나라일터에서/)
  assert.match(html, /2026년 10월 29일\(목\) 12:00/)
  assert.match(html, /gojobs\.go\.kr/)
  assert.match(html, /noindex/)
  assert.doesNotMatch(html, /<img src=x/)
  assert.match(html, /href="attach-1\.pdf"/)
})

test('마감일이 지난 사본·manifest 없는 날짜는 삭제 대상', () => {
  const m = { items: { 1: { end: '2026-10-28' }, 2: { end: '2026-10-29' }, 3: {} } }
  assert.deepEqual(expiredSns(m, '2026-10-29'), ['1', '3'])
})

test('검수: 사본이 없거나 링크가 사본 주소가 아닌 나라일터 공고는 게시하지 않는다', () => {
  const rules = { 필수: [], 전용으로_보는_표현: [] }
  const mk = (sn, url) => ({ id: `gojobs-${sn}`, title: '장애인 제한경쟁 채용', org: '기관', end: '2099-01-01', url, disabledOnly: true, source: '나라일터' })
  const items = [mk('1', copyUrl('1')), mk('2', copyUrl('2')), mk('3', 'https://www.gojobs.go.kr/apmList.do?x=1')]
  const r = validateJobs(items, { today: '2026-10-29', rules, copyExists: (sn) => sn !== '2' })
  assert.deepEqual(r.items.map((j) => j.id), ['gojobs-1'])
  assert.equal(r.fixes.length, 2)
  assert.equal(isCopyUrl(copyUrl('9'), '9'), true)
})
