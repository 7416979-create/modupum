import test from 'node:test'
import assert from 'node:assert/strict'
import { parseRss, isRelevant, toNews, mergeNews } from './news-lib.mjs'

const xml = `<rss><channel><item><title><![CDATA[최중증 발달장애인·희귀질환자 가족에 의한 활동지원 2028년까지 연장]]></title>
<link>https://www.mohw.go.kr/board.es?mid=a10503000000&amp;bid=0027&amp;list_no=1492211&amp;act=view</link>
<description><![CDATA[ 제목 보건복지부(장관 정은경)는 13일 국무회의에서 시행령 개정안이 의결되었다고 밝혔다. 다음 문장.]]></description>
<pubDate>Tue, 13 Oct 2026 05:00:00 GMT</pubDate></item>
<item><title>무관한 글</title><link>https://www.mohw.go.kr/x?list_no=1</link><description>치과</description><pubDate>Tue, 13 Oct 2026 05:00:00 GMT</pubDate></item></channel></rss>`

test('파싱·필터·요약', () => {
  const rows = parseRss(xml)
  assert.equal(rows.length, 2)
  assert.equal(rows.filter(isRelevant).length, 1)
  const n = toNews(rows[0])
  assert.equal(n.id, 'mohw-1492211')
  assert.equal(n.date, '2026-10-13')
  assert.ok(n.summary.length <= 140)
})
test('합치기: 중복 제거·최신순', () => {
  const a = { id: 'a', url: 'u1', date: '2026-10-01' }
  const b = { id: 'b', url: 'u2', date: '2026-10-05' }
  assert.deepEqual(mergeNews([a], [b, { ...a }]).map((x) => x.id), ['b', 'a'])
})
