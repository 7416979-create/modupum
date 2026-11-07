import test from 'node:test'
import assert from 'node:assert/strict'
import { pageText, watchUrls } from './rare-watch-lib.mjs'

test('본문 글자만 남기고 조회수는 뺀다', () => {
  const a = pageText('<html><script>x=1</script><p>상한제&nbsp;안내</p><span>조회수 : 17,952</span></html>')
  const b = pageText('<html><script>x=2</script><p>상한제&nbsp;안내</p><span>조회수 : 17,953</span></html>')
  assert.equal(a, b)
  assert.equal(a, '상한제 안내')
})

test('원문 링크는 중복 없이 모으고 기관·복지로는 열리는지만 본다', () => {
  const rare = {
    groups: [{ items: [
      { name: 'A', links: [{ label: 'x', url: 'https://a.go.kr/p;jsessionid=ZZ?id=1' }, { label: 'y', url: 'https://www.bokjiro.go.kr/w' }] },
      { name: 'B', links: [{ label: 'x', url: 'https://a.go.kr/p?id=1' }] },
    ] }],
    institutions: [{ name: '센터', url: 'https://c.or.kr/index' }],
  }
  assert.deepEqual(watchUrls(rare), [
    { url: 'https://a.go.kr/p?id=1', label: 'A: x', openOnly: false },
    { url: 'https://www.bokjiro.go.kr/w', label: 'A: y', openOnly: true },
    { url: 'https://c.or.kr/index', label: '센터', openOnly: true },
  ])
})
