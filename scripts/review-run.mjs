// 대기열 묶음 판정. 사용: node scripts/review-run.mjs            (Gemini 1차, 주기 지났을 때만)
//                      node scripts/review-run.mjs --haiku verdicts.json   (2차 Haiku 판정 결과 적용, 수동)
// 키: GEMINI_API_KEY 환경변수(GitHub Secret). 값은 출력·기록하지 않는다. 키가 없으면 호출 없이 건너뛴다.
import { readFile, writeFile } from 'node:fs/promises'
import { readQueue, writeQueue, isDue, batchOf, buildPrompt, parseVerdicts, applyVerdicts, confirmedJobs, INTERVAL_DAYS, MAX_BATCH } from './review-lib.mjs'

const UA = 'modupum-bot (+https://modupum.kr)'
const MODEL = process.env.REVIEW_GEMINI_MODEL || 'gemini-2.5-flash'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const jobsUrl = new URL('../public/data/jobs.json', import.meta.url)

// 원문 본문 텍스트(태그 제거). 실패하면 빈 문자열.
const bodyOf = async (url) => {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) })
    if (!res.ok) return ''
    const html = await res.text()
    return html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  } catch {
    return ''
  }
}

const fetchBodies = async (items) => {
  const bodies = {}
  for (const it of items) {
    bodies[it.id] = await bodyOf(it.url)
    await sleep(3000)
  }
  return bodies
}

// Gemini 한 번 호출(묶음). 실패 시 예외를 던지고, 호출자가 전부 needs-haiku 로 넘긴다.
const callGemini = async (prompt, key) => {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0, responseMimeType: 'application/json' } }),
    signal: AbortSignal.timeout(120000),
  })
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`)
  const json = await res.json()
  return json?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? ''
}

// 확정 공고를 노출 데이터(jobs.json)에 반영한다. 이미 있으면 건너뛴다.
const syncJobs = async (queue) => {
  const data = JSON.parse(await readFile(jobsUrl, 'utf8'))
  const items = Array.isArray(data.items) ? data.items : []
  const have = new Set(items.map((j) => j.id))
  const add = confirmedJobs(queue).filter((j) => !have.has(j.id) && j.end >= new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10))
  if (add.length === 0) return 0
  const next = [...items, ...add].sort((a, b) => (a.end < b.end ? -1 : a.end > b.end ? 1 : 0))
  await writeFile(jobsUrl, `${JSON.stringify({ ...data, items: next }, null, 2)}\n`)
  return add.length
}

const summary = (queue) => {
  const c = {}
  for (const q of queue.items) c[q.status] = (c[q.status] ?? 0) + 1
  return JSON.stringify(c)
}

async function runGemini() {
  const now = Date.now()
  const queue = await readQueue()
  if (!isDue(queue, now, INTERVAL_DAYS)) {
    console.log(`[대기열] 호출 없음: 대기 ${summary(queue)}, 주기 ${INTERVAL_DAYS}일 미도래 또는 대기 없음`)
    return
  }
  const key = process.env.GEMINI_API_KEY
  if (!key) {
    console.log('[대기열] Gemini 건너뜀: 키(GEMINI_API_KEY)가 없어 호출하지 않음. 대기 항목 유지')
    return
  }
  const batch = batchOf(queue, MAX_BATCH)
  if (batch.length === 0) {
    console.log(`[대기열] 호출 없음: 새로 판정할 pending 항목이 없음(needs-haiku ${queue.items.filter((q) => q.status === "needs-haiku").length}건은 2차 대기)`)
    return
  }
  let verdicts = {}
  const bodies = await fetchBodies(batch)
  try {
    verdicts = parseVerdicts(await callGemini(buildPrompt(batch, bodies), key))
    console.log(`[대기열] Gemini 1회 호출, ${batch.length}건 요청, 판정 ${Object.keys(verdicts).length}건`)
  } catch (e) {
    console.error(`[대기열] Gemini 실패(2차로 넘김): ${e.message}`)
  }
  let next = applyVerdicts(queue, batch, verdicts, bodies, 'gemini', now)
  next = { ...next, lastRunAt: new Date(now).toISOString() }
  await writeQueue(next)
  const added = await syncJobs(next)
  console.log(`[대기열] 반영 ${added}건, 상태 ${summary(next)}`)
}

async function runHaiku(file) {
  const queue = await readQueue()
  const verdicts = JSON.parse(await readFile(file, 'utf8'))
  const items = queue.items.filter((q) => q.status === 'needs-haiku' && verdicts[q.id])
  const bodies = await fetchBodies(items)
  const next = applyVerdicts(queue, items, verdicts, bodies, 'haiku')
  await writeQueue(next)
  const added = await syncJobs(next)
  console.log(`[대기열] Haiku 적용 ${items.length}건, 반영 ${added}건, 상태 ${summary(next)}`)
}

const arg = process.argv.indexOf('--haiku')
try {
  if (arg > 0) await runHaiku(process.argv[arg + 1])
  else await runGemini()
} catch (e) {
  console.error(`[대기열] 실패(기존 데이터 유지): ${e.message}`)
}
