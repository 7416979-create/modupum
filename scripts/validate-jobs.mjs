// 검수 실행: public/data/jobs.json, welfare.json 을 읽어 검사한다. 위반이 있으면 종료 코드 1(워크플로에서 배포 중단).
// 사용: node scripts/validate-jobs.mjs [--fix]   (--fix: 자동 제거 가능한 것을 파일에도 반영)
import { readFile, writeFile } from 'node:fs/promises'
import { validateJobs, validateWelfare } from './validate-lib.mjs'

const fix = process.argv.includes('--fix')
const rules = JSON.parse(await readFile(new URL('./keywords.json', import.meta.url), 'utf8'))
const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
let bad = false

for (const [name, fn] of [
  ['jobs', (items) => validateJobs(items, { today, rules })],
  ['welfare', (items) => validateWelfare(items)],
]) {
  const url = new URL(`../public/data/${name}.json`, import.meta.url)
  const data = JSON.parse(await readFile(url, 'utf8'))
  const r = fn(data.items)
  for (const f of r.fixes) console.log(`[검수:${name}] 자동 정리 - ${f}`)
  for (const e of r.errors) console.error(`[검수:${name}] 오류 - ${e}`)
  if (fix && r.fixes.length) await writeFile(url, `${JSON.stringify({ ...data, items: r.items }, null, 2)}\n`)
  console.log(`[검수:${name}] ${data.items.length}건 → ${r.items.length}건, 오류 ${r.errors.length}건`)
  if (r.errors.length) bad = true
}
if (bad) process.exit(1)
