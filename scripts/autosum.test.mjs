import test from 'node:test'
import assert from 'node:assert/strict'
import { needsSummary, buildPending, carryVerified, applyResults, verifyEasy, updateReview, numTokens, NO_INFO } from './autosum-lib.mjs'
import { mergeKead } from './kead-lib.mjs'
import { attachmentLinks, htmlToText } from './autosum-extract.mjs'

const today = '2026-10-29'
const src = `채용 공고\n접수기간 2026. 10. 15. ~ 10. 30. 18:00\n근무지 대전청사 월 2,160,000원 세전\n모집인원 장애 전형 5명\n문의 042-620-6239\n${'지원 자격은 장애인 등록을 한 사람이며 공고 내용을 자세히 읽어야 합니다. '.repeat(10)}`
const easy = {
  언제까지: '2026년 10월 30일 18:00까지', 무슨일고용: '사무 · 계약직', 어디서: '대전청사', 누가: ['장애인 등록을 한 사람'], 몇명: '5명',
  무슨일: '사무를 해요.', 일하는시간: `${NO_INFO}. 문의에 물어보세요.`, 급여: '월 2,160,000원 (세전)', 접수: `${NO_INFO}.`, 문의: '042-620-6239',
}
const ev = {
  언제까지: ['접수기간 2026. 10. 15. ~ 10. 30. 18:00'], 무슨일고용: ['채용 공고'], 어디서: ['근무지 대전청사'], 누가: ['지원 자격은 장애인 등록을 한 사람이며'],
  몇명: ['모집인원 장애 전형 5명'], 무슨일: ['공고 내용을 자세히 읽어야 합니다'], 일하는시간: [], 급여: ['월 2,160,000원 세전'], 접수: [], 문의: ['문의 042-620-6239'],
}

test('요약 필요 판정', () => {
  assert.ok(needsSummary({ end: '2026-10-30' }, today))
  assert.ok(!needsSummary({ end: '2026-10-30', verified: true, easy: {} }, today))
  assert.ok(!needsSummary({ end: '2026-10-28' }, today))
})

test('대기 목록은 처음 들어온 날을 이어 둔다', () => {
  const items = [{ id: 'a', end: '2026-11-01', title: 't', org: 'o', url: 'u' }, { id: 'b', end: '2026-11-01', verified: true, easy: {} }]
  const p = buildPending(items, today, [{ id: 'a', since: '2026-10-27' }])
  assert.deepEqual(p.map((x) => [x.id, x.since]), [['a', '2026-10-27']])
})

test('수집 때 검증된 요약과 자동 표시가 사라지지 않는다', () => {
  const prev = { id: '1', verified: true, easy, auto: { at: today }, url: 'fixed', urlFixed: true }
  const out = carryVerified({ id: '1', url: 'cut' }, prev)
  assert.equal(out.easy, easy)
  assert.equal(out.auto.at, today)
  assert.equal(out.url, 'fixed')
  assert.deepEqual(carryVerified({ id: '2' }, undefined), { id: '2' })
})

test('KEAD 재수집에도 자동 요약이 유지된다', () => {
  const prev = { id: 'kead-1', source: 'KEAD', title: '[x] 장애인만 채용', org: '한국장애인고용공단', end: '2026-11-10', disabledOnly: true, verified: true, easy, auto: { at: today } }
  const fresh = { ...prev, easy: undefined, verified: undefined, auto: undefined }
  const m = mergeKead([prev], [fresh], today)
  assert.equal(m.items[0].easy, easy)
  assert.equal(m.items[0].auto.at, today)
})

test('반영은 기존 요약을 덮어쓰지 않고 공고를 지우지 않는다', () => {
  const items = [
    { id: 'a', end: '2026-11-01' },
    { id: 'b', end: '2026-11-01', verified: true, easy: { 언제까지: '사람이 쓴 것' } },
    { id: 'c', end: '2026-11-01' },
  ]
  const results = [{ id: 'a', ok: true, easy }, { id: 'b', ok: true, easy }, { id: 'c', ok: false, easy }, { id: 'zzz', ok: true, easy }]
  const r = applyResults(items, results, today)
  assert.equal(r.items.length, 3)
  assert.deepEqual(r.applied, ['a'])
  assert.equal(r.items[1].easy.언제까지, '사람이 쓴 것')
  assert.equal(r.items[0].verified, true)
  assert.ok(r.items[0].auto.trialUntil)
  assert.equal(r.items[2].easy, undefined)
})

test('검증 통과 사례', () => {
  const v = verifyEasy(easy, ev, src)
  assert.deepEqual(v.reasons, [])
  assert.ok(v.ok)
})

test('급여 숫자가 원문과 다르면 실패', () => {
  const v = verifyEasy({ ...easy, 급여: '월 2,610,000원' }, ev, src)
  assert.ok(!v.ok)
  assert.match(v.reasons.join(), /숫자/)
})

test('근거 문장이 원문에 없으면 실패', () => {
  const v = verifyEasy(easy, { ...ev, 어디서: ['서울 본사 근무'] }, src)
  assert.ok(!v.ok)
  assert.match(v.reasons.join(), /근거가 원문에 없음/)
})

test('근거 없는 칸·빈 칸·글자 부족·빈칸 문구 남발은 실패', () => {
  assert.ok(!verifyEasy(easy, { ...ev, 어디서: [] }, src).ok)
  assert.ok(!verifyEasy({ ...easy, 어디서: '' }, ev, src).ok)
  assert.ok(!verifyEasy(easy, ev, '짧음').ok)
  const blank = Object.fromEntries(Object.keys(easy).map((k) => [k, k === '누가' ? [`${NO_INFO}.`] : `${NO_INFO}.`]))
  assert.match(verifyEasy(blank, {}, src).reasons.join(), /빈칸 문구/)
})

test('원문에 없는 이메일·주소와 준비 중 문구는 실패', () => {
  assert.ok(!verifyEasy({ ...easy, 접수: 'a@evil.com 으로 보내요' }, { ...ev, 접수: ['문의 042-620-6239'] }, src).ok)
  assert.ok(!verifyEasy({ ...easy, 무슨일: '준비 중' }, ev, src).ok)
})

test('확인 필요 목록: 실패는 시도 횟수가 늘고 성공은 빠진다', () => {
  let r = updateReview([], [{ id: 'a', ok: false, reasons: ['x'] }], today)
  r = updateReview(r, [{ id: 'a', ok: false, reasons: ['y'] }, { id: 'b', ok: false, reasons: ['z'] }], today)
  assert.equal(r.find((x) => x.id === 'a').attempts, 2)
  r = updateReview(r, [{ id: 'a', ok: true, reasons: [] }], today)
  assert.deepEqual(r.map((x) => x.id), ['b'])
})

test('숫자 덩어리·첨부 링크 찾기', () => {
  assert.deepEqual(numTokens('월 2,650,380원 09:00'), ['2650380', '9', '0'])
  const html = '<a href="/f/x.hwp">공고문.hwp</a><a href="javascript:void(0)">x</a><a href="/file/generalFileDownload?a=1">붙임</a><a href="/about">소개</a>'
  assert.equal(attachmentLinks(html, 'https://e.kr/a/b').length, 2)
  assert.match(htmlToText('<p>가</p><script>x</script><p>나</p>'), /가\n나/)
})
