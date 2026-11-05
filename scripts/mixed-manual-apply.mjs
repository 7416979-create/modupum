// 수동 확정 공고(scripts/mixed-manual.json)를 public/data/jobs.json 에 넣는다. 수집 단계 뒤에 실행한다(공공데이터 호출과 무관하게 동작).
// 실패하면 기존 jobs.json 을 그대로 둔다.
import { readFile, writeFile } from 'node:fs/promises'
import { applyManual } from './mixed-lib.mjs'

const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
const jobsUrl = new URL('../public/data/jobs.json', import.meta.url)
try {
  const manual = JSON.parse(await readFile(new URL('./mixed-manual.json', import.meta.url), 'utf8')).items
  const data = JSON.parse(await readFile(jobsUrl, 'utf8'))
  const r = applyManual(Array.isArray(data.items) ? data.items : [], manual, today)
  if (r.added > 0) await writeFile(jobsUrl, `${JSON.stringify({ ...data, items: r.items }, null, 2)}
`)
  console.log(`수동 확정 공고: 새로 추가 ${r.added}건`)
} catch (e) {
  console.error(`수동 확정 공고 적용 실패(기존 jobs.json 유지): ${e.message}`)
}
