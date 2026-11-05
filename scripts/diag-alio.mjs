// 임시 진단(확인 후 삭제): 새 규칙을 실제 ALIO 데이터에 돌려 결과만 logs/diag-alio.json 에 남긴다. 키 값은 출력하지 않는다.
import { writeFile } from 'node:fs/promises'
import { listUrl, rowsOf, buildJobs } from './jobs-lib.mjs'
import { collectMixed } from './mixed-run.mjs'
import { readFileSync } from 'node:fs'

const key = process.env.DATA_GO_KR_KEY || ''
const rules = JSON.parse(readFileSync(new URL('./keywords.json', import.meta.url), 'utf8'))
const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
const all = []
for (let p = 1; p <= 30; p += 1) {
  const j = await (await fetch(listUrl(key, p), { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30000) })).json()
  const rows = rowsOf(j)
  if (!rows.length) break
  all.push(...rows)
}
const base = buildJobs(all, rules, today)
const logs = []
const { jobs, stats } = await collectMixed(all, { today, excludeIds: new Set(base.map((j) => j.id)), log: (m) => logs.push(m) })
const kinds = {}
for (const r of all) for (const f of r.files ?? []) { const e = /\.([a-z0-9]+)$/i.exec(f.atchFileNm ?? '')?.[1]?.toLowerCase() ?? '?'; kinds[e] = (kinds[e] ?? 0) + 1 }
await writeFile(new URL('../logs/diag-alio.json', import.meta.url), JSON.stringify({ today, total: all.length, base: base.length, stats, kinds, mixed: jobs.map((j) => ({ id: j.id, org: j.org, title: j.title, end: j.end, src: j.mixedSource, ev: j.mixedEvidence })), logs }, null, 1))
console.log(JSON.stringify(stats), jobs.length)
