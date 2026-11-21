// 판정 결과 적용: 기록(ai-review-log.json), 숨김(ai-review-hide.json), '애매'는 review-queue.json 에 넣고,
// 숨김 공고는 jobs.json 에서도 뺀다. 결과가 없거나 깨졌으면 아무 파일도 바꾸지 않고 종료 코드 1.
// 사용: node scripts/ai-review-apply.mjs [--dry-run]
import { writeFile, readFile } from 'node:fs/promises'
import {
  JOBS_FILE, LOG_FILE, HIDE_FILE, QUEUE_FILE, BUNDLE_FILE, RESULT_FILE,
  readJsonOr, parseResult, planApply, removeHidden,
} from './ai-review-lib.mjs'

const dry = process.argv.includes('--dry-run')
const save = (file, obj) => writeFile(file, `${JSON.stringify(obj, null, 2)}\n`)

let text
try {
  text = await readFile(RESULT_FILE, 'utf8')
} catch {
  console.log('판정 결과 파일이 없습니다. 아무것도 바꾸지 않습니다')
  process.exit(0)
}

const bundle = await readJsonOr(BUNDLE_FILE, null)
if (!bundle || !Array.isArray(bundle.items)) {
  console.error('검토 묶음을 읽지 못했습니다. 아무것도 바꾸지 않습니다')
  process.exit(1)
}
const bundleById = new Map(bundle.items.map((b) => [b.id, b]))

let results
try {
  results = parseResult(text, new Set(bundleById.keys()))
} catch (e) {
  console.error(`판정 결과가 깨졌습니다(${e.message}). 아무것도 바꾸지 않습니다`)
  process.exit(1)
}
if (results.length === 0) {
  console.log('묶음 공고와 맞는 판정이 없습니다. 아무것도 바꾸지 않습니다')
  process.exit(0)
}

const log = await readJsonOr(LOG_FILE, {})
const hide = await readJsonOr(HIDE_FILE, { items: [] })
const queue = await readJsonOr(QUEUE_FILE, { lastRunAt: null, items: [] })
const jobs = await readJsonOr(JOBS_FILE, null)
const now = new Date().toISOString()
const plan = planApply(results, log, hide, queue, bundleById, now)
const hideIds = new Set(plan.hide.items.map((x) => x.id))
const cut = jobs && Array.isArray(jobs.items) ? removeHidden(jobs, hideIds) : null

const counts = results.reduce((a, r) => ({ ...a, [r.verdict]: (a[r.verdict] || 0) + 1 }), {})
console.log(`판정 ${results.length}건: ${JSON.stringify(counts)}`)
for (const r of results) if (r.verdict !== '전용') console.log(`- ${r.verdict} ${r.id}: ${r.reason} | 근거: ${r.quote}`)
console.log(`숨김 추가 ${plan.added.hide.length}건, 대기열 추가 ${plan.added.queue.length}건, jobs.json 에서 제외 ${cut ? cut.removed : 0}건`)

if (dry) {
  console.log('--dry-run: 파일은 바꾸지 않았습니다')
  process.exit(0)
}

await save(LOG_FILE, plan.log)
await save(HIDE_FILE, plan.hide)
await save(QUEUE_FILE, plan.queue)
if (cut && cut.removed > 0) await save(JOBS_FILE, cut.data)
console.log('적용 완료')
