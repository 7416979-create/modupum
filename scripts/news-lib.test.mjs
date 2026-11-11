import test from 'node:test'
import assert from 'node:assert/strict'
import { SOURCES, parseRss, isRelevant, toNews, mergeNews, validateNews } from './news-lib.mjs'

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

test('고용노동부 RSS 파싱(dc:date)', async () => {
  const { SOURCES } = await import('./news-lib.mjs')
  const x = `<item><title><![CDATA[장애인 고용 지원 안내]]></title><link>https://www.moel.go.kr/news/notice/noticeView.do?bbs_seq=20261000655</link><description><![CDATA[장애인 고용 지원 안내]]></description><dc:date>2026-10-19 14:59:59</dc:date></item>`
  const [r] = parseRss(x, SOURCES[2])
  assert.equal(r.id, 'moel-notice-20261000655')
  assert.equal(r.date, '2026-10-19')
  assert.ok(isRelevant(r))
  assert.equal(toNews(r).source, '고용노동부 공지')
})

assert.deepEqual(validateNews([{ id: 'moel-notice-1', title: 't', date: '2026-10-29', url: 'https://www.moel.go.kr/news/notice/noticeView.do?bbs_seq=1' }]), [])
assert.equal(validateNews([{ id: 'x', title: 't', date: '2026-10-29', url: 'https://evil.example/' }]).length, 1)

{
  const src = SOURCES.find((s) => s.prefix === 'seoul-welfare')
  const [r] = parseRss(`<item><title>서울시 장애인 특별공급 안내</title><link>https://news.seoul.go.kr/welfare/archives/584505</link><pubDate>2026-11-09 08:38:14</pubDate><description><![CDATA[서울시 장애인 특별공급 안내]]></description></item>`, src)
  assert.equal(r.id, 'seoul-welfare-584505')
  assert.equal(r.date, '2026-11-09')
  assert.deepEqual(validateNews([toNews(r)]), [])
}

{
  const src = SOURCES.find((s) => s.prefix === 'gg-bodo')
  const [r] = parseRss(`<item><title>경기도 장애인 일자리 확대</title><link>https://gnews.gg.go.kr/briefing/brief_gongbo_view.do?BS_CODE=S017&amp;number=71957</link><pubDate>Tue, 10 Nov 2026 09:00:00 +0900</pubDate><contents>본문</contents></item>`, src)
  assert.equal(r.id, 'gg-bodo-71957')
  assert.equal(r.desc, '본문')
  assert.equal(r.date, '2026-11-10')
  assert.deepEqual(validateNews([toNews(r)]), [])
}
