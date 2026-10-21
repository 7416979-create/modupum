// 정책 소식 수집: 보건복지부 보도자료 RSS(로그인·키 불필요) → public/data/news.json
// 실패·이상(0건, 건수 감소, 형식 오류) 시 기존 파일을 유지하고 종료 코드 1.
import { readFile, writeFile } from 'node:fs/promises'
import { NEWS_RSS, parseRss, isRelevant, toNews, mergeNews, validateNews } from './news-lib.mjs'

const url = new URL('../public/data/news.json', import.meta.url)
const prev = JSON.parse(await readFile(url, 'utf8').catch(() => '{"items":[]}'))
const prevItems = Array.isArray(prev.items) ? prev.items : []
try {
  const res = await fetch(NEWS_RSS, { headers: { 'User-Agent': 'modupum-bot (+https://modupum.kr)' }, signal: AbortSignal.timeout(30000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const rows = parseRss(await res.text())
  if (rows.length === 0) throw new Error('RSS 에서 받은 글이 없습니다')
  const fresh = rows.filter(isRelevant).map(toNews).filter((n) => n.id && n.title && n.date)
  const items = mergeNews(prevItems, fresh)
  if (items.length < prevItems.length) throw new Error(`건수 감소(${prevItems.length} → ${items.length})`)
  const errors = validateNews(items)
  if (errors.length) throw new Error(errors.join('; '))
  const added = items.length - prevItems.length
  if (added > 0) {
    const kst = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10)
    await writeFile(url, `${JSON.stringify({ sample: false, updatedAt: kst, items }, null, 2)}\n`)
  }
  console.log(`정책 소식: RSS ${rows.length}건 중 관련 ${fresh.length}건, 새로 ${added}건, 전체 ${items.length}건`)
} catch (e) {
  console.error(`정책 소식 수집 실패(기존 유지): ${e.message}`)
  process.exit(1)
}
