import test from 'node:test'
import assert from 'node:assert/strict'
import { parseList, toWelfare, listUrl } from './welfare-lib.mjs'

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<wantedList>
  <totalCount>2</totalCount><pageNo>1</pageNo><numOfRows>100</numOfRows>
  <resultCode>0</resultCode><resultMessage>SUCCESS</resultMessage>
  <servList>
    <inqNum>10</inqNum><intrsThemaArray>생활지원</intrsThemaArray><jurMnofNm>보건복지부</jurMnofNm>
    <servDgst>장애인 &amp; 가족에게 지원합니다</servDgst><servDtlLink>https://www.bokjiro.go.kr/a</servDtlLink>
    <servId>WLF1</servId><servNm><![CDATA[장애인연금]]></servNm><trgterIndvdlArray>장애인</trgterIndvdlArray>
  </servList>
  <servList><servId>WLF2</servId><servNm>장애아동 지원</servNm><jurMnofNm>보건복지부</jurMnofNm></servList>
</wantedList>`

test('목록 XML을 읽는다', () => {
  const r = parseList(xml)
  assert.equal(r.code, '0')
  assert.equal(r.total, 2)
  assert.equal(r.items.length, 2)
  assert.equal(r.items[0].title, '장애인연금')
  assert.equal(r.items[0].summary, '장애인 & 가족에게 지원합니다')
})

test('화면용 항목으로 바꾸고 링크가 없으면 복지로 상세 주소를 만든다', () => {
  const [a, b] = parseList(xml).items.map(toWelfare)
  assert.equal(a.url, 'https://www.bokjiro.go.kr/a')
  assert.ok(b.url.includes('WLF2'))
  assert.equal(a.source, '복지로')
})

test('목록 주소에 필수 변수가 들어간다', () => {
  const u = listUrl('k/1', 2)
  assert.ok(u.includes('callTp=L') && u.includes('srchKeyCode=003') && u.includes('pageNo=2'))
})

test('applyTargetOverrides: 보정 id 만 target 을 바꾼다', async () => {
  const { applyTargetOverrides } = await import('./welfare-lib.mjs')
  const out = applyTargetOverrides([{ id: 'A', target: '다자녀' }, { id: 'B', target: '저소득' }], { A: { target: '무주택 세대주' } })
  assert.equal(out[0].target, '무주택 세대주')
  assert.equal(out[1].target, '저소득')
})
