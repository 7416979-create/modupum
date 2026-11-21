import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { deflateRawSync } from 'node:zlib'
import { attachKind, attachmentUrl, hwpxText } from './attach-lib.mjs'
import { buildJob, parseList } from './kead-lib.mjs'

const rules = JSON.parse(readFileSync(new URL('./keywords.json', import.meta.url), 'utf8'))
const listHtml = `<table><tbody><tr><td>1</td><td><a onClick="fn_bbsView('217741'); ">[장애인만 채용] 검단구 사무원 채용</a></td><td>인천광역시</td><td>검단구</td><td>공사/공기업</td><td>2026-12-01</td><td>2026-11-20</td></tr></tbody></table>`
const [row] = parseList(listHtml)

// 테스트용 ZIP(stored 0, deflate 8)을 만든다. 실제 HWPX 구조의 최소형.
const makeZip = (files) => {
  const locals = []
  const centrals = []
  let off = 0
  for (const [name, text, method] of files) {
    const nb = Buffer.from(name)
    const raw = Buffer.from(text)
    const data = method === 8 ? deflateRawSync(raw) : raw
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0)
    lh.writeUInt16LE(method, 8)
    lh.writeUInt32LE(data.length, 18)
    lh.writeUInt32LE(raw.length, 22)
    lh.writeUInt16LE(nb.length, 26)
    locals.push(lh, nb, data)
    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0)
    ch.writeUInt16LE(method, 10)
    ch.writeUInt32LE(data.length, 20)
    ch.writeUInt32LE(raw.length, 24)
    ch.writeUInt16LE(nb.length, 28)
    ch.writeUInt32LE(off, 42)
    centrals.push(ch, nb)
    off += 30 + nb.length + data.length
  }
  const cd = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(off, 16)
  return Buffer.concat([...locals, cd, eocd])
}

const sec = (t) => `<hp:p><hp:run><hp:t>${t}</hp:t></hp:run></hp:p>`

test('첨부 링크를 상세 HTML 에서 찾는다', () => {
  const html = '<a href="/cmm/fms/downloadDirect.do?key=9D7CFA59530CD52BF69A" title="다운로드">x</a>'
  assert.equal(attachmentUrl(html), 'https://www.kead.or.kr/cmm/fms/downloadDirect.do?key=9D7CFA59530CD52BF69A')
  assert.equal(attachmentUrl('<p>첨부 없음</p>'), '')
})

test('형식을 첫 바이트로 판별한다', () => {
  assert.equal(attachKind(Buffer.from('%PDF-1.7 xx')), 'pdf')
  assert.equal(attachKind(Buffer.from('d0cf11e0a1b11ae1', 'hex')), 'hwp')
  assert.equal(attachKind(makeZip([['Contents/section0.xml', sec('본문'), 8]])), 'hwpx')
  assert.equal(attachKind(makeZip([['word/document.xml', 'x', 0]])), 'zip')
  assert.equal(attachKind(Buffer.from('<html>')), 'other')
})

test('HWPX 본문 글자를 뽑는다(저장·압축 두 방식, 여러 구역 순서)', () => {
  const zip = makeZip([
    ['mimetype', 'application/hwp+zip', 0],
    ['Contents/section1.xml', sec('둘째 구역 &amp; 끝'), 8],
    ['Contents/section0.xml', sec('장애인 우대사항 적용'), 0],
  ])
  const text = hwpxText(zip)
  assert.match(text, /장애인 우대사항 적용 둘째 구역 & 끝/)
  assert.equal(hwpxText(Buffer.from('not a zip')), '')
})

test('첨부에 우대만 있으면 전용을 해제하고, 제한경쟁이 있으면 유지한다', () => {
  const lines = ['[장애인만 채용]', '※ 장애인 제한경쟁 채용', '- 만 18세 이상']
  const row2 = { ...row, title: '[장애인 제한경쟁] 검단구 사무원 채용' }
  assert.equal(buildJob(row2, lines, rules).disabledOnly, true)
  const pref = { kind: 'hwpx', text: '우대사항 : 장애인 우대(가점), 만 18세 이상' }
  const off = buildJob(row2, lines, rules, pref)
  assert.equal(off.disabledOnly, false)
  assert.ok(off.notes.some((n) => n.includes('우대로만')))
  const kept = buildJob(row2, lines, rules, { kind: 'pdf', text: '장애인 제한경쟁 채용 공고' })
  assert.equal(kept.disabledOnly, true)
})

test('첨부를 못 읽으면 전용을 유지하고 안내만 붙인다', () => {
  const row2 = { ...row, title: '[장애인 제한경쟁] 검단구 사무원 채용' }
  const lines = ['※ 장애인 제한경쟁 채용']
  const j = buildJob(row2, lines, rules, { kind: 'hwp', text: '' })
  assert.equal(j.disabledOnly, true)
  assert.ok(j.notes.some((n) => n.includes('첨부 공고문은 확인하지 못했습니다')))
  assert.equal(buildJob(row2, lines, rules, null).disabledOnly, true)
})

test('일반 공고(전용 아님)는 첨부를 읽어도 바뀌지 않는다', () => {
  const lines = ['[장애인만 채용]', '- 장애인 우대', '- 만 18세 이상']
  const j = buildJob(row, lines, rules, { kind: 'hwpx', text: '장애인 우대 가점' })
  assert.equal(j.disabledOnly, false)
  assert.equal(j.notes.some((n) => n.includes('확인하지 못했습니다')), false)
})
