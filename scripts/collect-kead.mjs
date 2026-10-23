// 한국장애인고용공단(KEAD) 채용정보(공사/공기업)의 최신 공고를 읽어 public/data/jobs.json 에 합친다. 키 불필요.
// 정중한 수집: 식별되는 User-Agent, 요청 사이 3초 쉼, 목록은 앞 2쪽만, 상세 본문은 새 공고만(이미 저장된 공고는 다시 읽지 않는다).
// 어떤 오류가 나도 기존 jobs.json 은 건드리지 않고 정상 종료한다(전체 수집·배포를 막지 않는다).

import { readFile, writeFile } from 'node:fs/promises'
import { loadHolidays, jobCollectDecision, isForced } from './workday-lib.mjs'
import { enqueueSave } from './review-lib.mjs'
import { listUrl, viewUrl, parseList, bodyLines, viewTitle, buildJob, mergeKead, isKead, KEAD_SOURCE_LABEL } from './kead-lib.mjs'

const UA = 'modupum-bot (+https://modupum.kr)'
const PAGES = 2
const MAX_DETAIL = 20
const WAIT = 3000
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const rules = JSON.parse(await readFile(new URL('./keywords.json', import.meta.url), 'utf8'))
const kstNow = new Date(Date.now() + 9 * 3600 * 1000)
const today = kstNow.toISOString().slice(0, 10)
const jobsUrl = new URL('../public/data/jobs.json', import.meta.url)

const getText = async (url, options = {}) => {
  let last
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch(url, { ...options, headers: { 'User-Agent': UA, ...(options.headers ?? {}) }, signal: AbortSignal.timeout(30000) })
      if (res.ok) return await res.text()
      last = new Error(`HTTP ${res.status}`)
      if (res.status < 500) break
    } catch (e) {
      last = e
    }
    if (attempt < 3) await sleep(attempt * 5000)
  }
  throw last
}

async function main() {
  const data = JSON.parse(await readFile(jobsUrl, 'utf8'))
  const existing = Array.isArray(data.items) ? data.items : []
  const known = new Map(existing.filter(isKead).map((j) => [j.id, j]))

  const rows = []
  for (let page = 1; page <= PAGES; page += 1) {
    const got = parseList(await getText(listUrl(page)))
    if (got.length === 0) break
    rows.push(...got)
    await sleep(WAIT)
  }
  if (rows.length === 0) throw new Error('목록에서 공고를 읽지 못했습니다(화면 구조가 바뀌었을 수 있음)')
  console.log(`KEAD 목록: ${rows.length}건 읽음`)

  const jobs = []
  let detail = 0
  for (const row of rows) {
    const id = `kead-${row.id}`
    if (row.end && row.end < today) continue
    if (known.has(id) && !known.get(id).notes?.some((n) => n.includes('읽지 못해'))) {
      jobs.push(known.get(id))
      continue
    }
    let lines = []
    if (detail < MAX_DETAIL) {
      detail += 1
      try {
        const html = await getText(viewUrl(row.id))
        // 목록과 같은 글인지 제목으로 확인한다.
        if (viewTitle(html).replace(/\s+/g, '') === row.title.replace(/\s+/g, '')) lines = bodyLines(html)
        else console.error(`KEAD ${row.id}: 상세 제목이 목록과 달라 본문을 쓰지 않습니다`)
      } catch (e) {
        console.error(`KEAD ${row.id}: 본문 읽기 실패(${e.message}). 목록 정보만 사용합니다`)
      }
      await sleep(WAIT)
    }
    const job = buildJob(row, lines, rules)
    if (!job.end) {
      console.error(`KEAD ${row.id}: 마감일을 알 수 없어 제외합니다`)
      continue
    }
    jobs.push(job)
  }

  // 애매한 공고(장애인 대상 제목 명시 없음)는 판정 대기열에 적는다. 노출은 review-run 이 확실로 판정한 것만 한다.
  try {
    const queued = await enqueueSave(jobs, today, rules)
    if (queued) console.log(`KEAD: 판정 대기열에 ${queued}건 추가`)
  } catch (e) {
    console.error(`KEAD 대기열 기록 실패(무시하고 계속): ${e.message}`)
  }
  const r = mergeKead(existing, jobs, today)
  if (r.duplicates.length) console.log(`KEAD: 이미 있는 공고와 겹쳐 제외 ${r.duplicates.join(', ')}`)
  // keadCheckedAt: KEAD 목록을 실제로 읽어 합친 시각(성공했을 때만 바뀐다). 서버에서 KEAD 수집이 되는지 배포된 jobs.json 으로 확인하는 데 쓴다.
  const stamp = kstNow.toISOString().slice(0, 16).replace('T', ' ')
  const out = { ...data, updatedAt: stamp, keadCheckedAt: stamp, items: r.items }
  await writeFile(jobsUrl, `${JSON.stringify(out, null, 2)}\n`)
  console.log(`KEAD(${KEAD_SOURCE_LABEL}): 새로 본문 읽음 ${detail}건, 저장 ${r.added}건 추가`)
}

const decision = jobCollectDecision(today, await loadHolidays(), { force: isForced() })
if (!decision.collect) {
  console.log(`KEAD 수집 건너뜀: ${today} ${decision.reason}. 기존 jobs.json 을 유지합니다`)
  process.exit(0)
}
console.log(`KEAD 수집: ${today} ${decision.reason}`)
try {
  await main()
} catch (e) {
  console.error(`KEAD 수집 실패(기존 데이터 유지): ${e.message}`)
}
