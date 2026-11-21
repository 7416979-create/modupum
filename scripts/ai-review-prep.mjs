// 검토 묶음 만들기: 사이트(jobs.json)에 올라와 있고 아직 AI 판정 기록이 없는 공고만 최대 N건(기본 15) 골라 ai-review-bundle.json 에 쓴다.
// 사용: node scripts/ai-review-prep.mjs [--max 10]
import { writeFile } from 'node:fs/promises'
import { JOBS_FILE, LOG_FILE, BUNDLE_FILE, MAX_ITEMS, readJsonOr, selectNew, bundleItem } from './ai-review-lib.mjs'

const argMax = process.argv.indexOf('--max')
const max = argMax > -1 ? Number(process.argv[argMax + 1]) : MAX_ITEMS
if (!Number.isInteger(max) || max < 1) {
  console.error('--max 값이 올바르지 않습니다')
  process.exit(1)
}

const data = await readJsonOr(JOBS_FILE, null)
if (!data || !Array.isArray(data.items)) {
  console.error('jobs.json 을 읽지 못했습니다. 묶음을 만들지 않습니다')
  process.exit(1)
}
const log = await readJsonOr(LOG_FILE, {})
const picked = selectNew(data.items, log, max)
const bundle = { createdAt: new Date().toISOString(), count: picked.length, items: picked.map(bundleItem) }
await writeFile(BUNDLE_FILE, `${JSON.stringify(bundle, null, 2)}\n`)
console.log(`AI 검토 묶음: ${picked.length}건 (기록 있음 ${Object.keys(log).length}건 제외)`)
