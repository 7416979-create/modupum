// 클라우드(Actions) 단계: 요약이 빈 공고를 scripts/pending.json 에 올린다. PC 작업(autosum-run)이 이 목록을 처리한다.
// 읽기·목록 기록만 한다. jobs.json 은 건드리지 않는다.
import { readFile, writeFile } from 'node:fs/promises'
import { buildPending } from './autosum-lib.mjs'

const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
const jobsUrl = new URL('../public/data/jobs.json', import.meta.url)
const outUrl = new URL('./pending.json', import.meta.url)
try {
  const jobs = JSON.parse(await readFile(jobsUrl, 'utf8'))
  const prev = JSON.parse(await readFile(outUrl, 'utf8').catch(() => '[]'))
  const list = buildPending(jobs.items, today, prev)
  await writeFile(outUrl, `${JSON.stringify(list, null, 2)}\n`)
  console.log(`요약 대기 ${list.length}건${list.length ? `: ${list.map((p) => p.id).join(', ')}` : ''}`)
} catch (e) {
  console.error(`대기 목록 기록 실패(무시): ${e.message}`) // 기존 pending.json 유지
}
