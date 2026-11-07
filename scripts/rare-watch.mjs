// 희귀질환 안내(rare.json)가 기대는 공식 원문이 바뀌었는지 주 1회 확인한다. 고치지는 않고 알리기만 한다.
// 사용: node scripts/rare-watch.mjs <상태 파일> <기록 파일>
// 상태 파일에 원문별 지문을 두고, 바뀐 원문이 있으면 기록 파일 끝에 한 줄을 남긴다(사람이 원문을 보고 rare.json 을 고친다).
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { pageText, watchUrls } from './rare-watch-lib.mjs'

const [statePath, logPath] = process.argv.slice(2)
if (!statePath || !logPath) {
  console.error('사용: node scripts/rare-watch.mjs <상태 파일> <기록 파일>')
  process.exit(2)
}
const rare = JSON.parse(readFileSync(new URL('../public/data/rare.json', import.meta.url), 'utf8'))
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {}
const changed = []
const failed = []
const fresh = []
for (const { url, label, openOnly } of watchUrls(rare)) {
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (modupum rare-watch)' }, signal: AbortSignal.timeout(20000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = openOnly ? 'open' : pageText(await res.text())
    if (!openOnly && text.length < 200) throw new Error(`본문이 너무 짧음(${text.length}자)`)
    const hash = createHash('sha256').update(text).digest('hex').slice(0, 16)
    if (!state[url]) fresh.push(label)
    else if (state[url].hash !== hash) changed.push(label)
    state[url] = { label, hash, checkedAt: new Date().toISOString().slice(0, 10) }
  } catch (e) {
    failed.push(`${label}(${e.message})`)
  }
}
writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n')
const now = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 16)
const result = changed.length ? '바뀜 확인 필요' : failed.length ? '일부 실패' : '변경 없음'
const note = [
  changed.length && `바뀐 원문: ${changed.join(', ')}`,
  failed.length && `못 읽음: ${failed.join(', ')}`,
  fresh.length && `처음 등록 ${fresh.length}곳`,
].filter(Boolean).join(' / ')
appendFileSync(logPath, `${now} | ${result} | 원문 ${Object.keys(state).length}곳 | ${note || '-'}\n`)
console.log(result, note)
