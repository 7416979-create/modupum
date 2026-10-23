// 애매한 채용 공고 대기열. 수집 단계에서 '장애인 대상이 제목으로 확정되지 않은' 공고를 쌓고,
// 하루 한 번 묶음으로 Gemini(1차) 판정 → 불명확·실패는 needs-haiku(2차, 사람·에이전트 수동 적용).
// 확실로 판정된 것만 노출 데이터에 반영한다. 나머지는 숨김 유지.
import { readFile, writeFile } from 'node:fs/promises'
import { isNotice } from './gojobs-lib.mjs'

export const QUEUE_FILE = process.env.REVIEW_QUEUE_FILE || new URL('./review-queue.json', import.meta.url)
export const INTERVAL_DAYS = Number(process.env.REVIEW_INTERVAL_DAYS || 1) // 묶음 실행 주기(일)
export const MAX_BATCH = Number(process.env.REVIEW_MAX_BATCH || 20) // 1회 실행당 Gemini 요청에 담는 최대 건수
export const BODY_LIMIT = 4000 // 원문 본문은 앞 4000자만 판정에 쓴다
export const VERDICTS = ['확실', '불명확', '불가']

export const emptyQueue = () => ({ lastRunAt: null, items: [] })

export const readQueue = async (file = QUEUE_FILE) => {
  try {
    const q = JSON.parse(await readFile(file, 'utf8'))
    return { lastRunAt: q.lastRunAt ?? null, items: Array.isArray(q.items) ? q.items : [] }
  } catch {
    return emptyQueue()
  }
}

export const writeQueue = (queue, file = QUEUE_FILE) => writeFile(file, `${JSON.stringify(queue, null, 2)}\n`)

// 애매함: 장애인 전용으로 확정되지 않았고, 접수 중이며, 결과·합격 공지가 아닌 공고.
export const isAmbiguous = (job, today, rules = {}) =>
  job?.disabledOnly !== true &&
  typeof job?.end === 'string' && job.end >= today &&
  !isNotice(job.title ?? '', rules)

// 대기열에 새 항목만 추가(이미 있으면 상태 유지). 마감 지난 항목은 정리한다.
export const enqueue = (queue, jobs, today, rules = {}, now = Date.now()) => {
  const known = new Set(queue.items.map((q) => q.id))
  const added = []
  for (const j of jobs) {
    if (!isAmbiguous(j, today, rules) || known.has(j.id)) continue
    known.add(j.id)
    added.push({ id: j.id, title: j.title, org: j.org, url: j.url, end: j.end, source: j.source, status: 'pending', addedAt: new Date(now).toISOString() })
  }
  const items = [...queue.items, ...added].filter((q) => q.status === 'confirmed' || !(q.end < today))
  return { queue: { ...queue, items }, added: added.length }
}

// 마지막 실행 후 주기가 지났는지. 대기 항목이 없으면 호출하지 않는다.
export const isDue = (queue, now = Date.now(), intervalDays = INTERVAL_DAYS) => {
  if (!queue.items.some((q) => q.status === 'pending' || q.status === 'needs-haiku')) return false
  if (!queue.lastRunAt) return true
  return now - Date.parse(queue.lastRunAt) >= intervalDays * 86400000
}

// 한 번의 Gemini 요청에 담을 묶음(최대 max 건).
export const batchOf = (queue, max = MAX_BATCH) => queue.items.filter((q) => q.status === 'pending').slice(0, max)

const norm = (s) => String(s ?? '').replace(/\s+/g, '')

// 근거 인용문이 실제 원문 본문에 있는지(띄어쓰기 무시). 없으면 판정을 믿지 않는다.
export const quoteInBody = (quote, body) => {
  const q = norm(quote)
  return q.length >= 4 && norm(body).includes(q)
}

export const buildPrompt = (items, bodies) =>
  [
    '아래 채용 공고 각각이 장애인이 지원할 수 있는지 원문 본문만 근거로 판정하라.',
    '판정: 확실(장애인 대상·제한경쟁·구분모집·장애인 전형이 본문에 명시) / 불명확 / 불가(장애인 지원 불가이거나 장애인 대상 표현 없음).',
    '확실이면 근거가 되는 본문 문장을 그대로 한 개 인용(quote)한다. 본문에 없는 말은 인용하지 마라. 추정 금지.',
    '응답은 JSON 배열만: [{"id":"...","verdict":"확실|불명확|불가","quote":"..."}]',
    '',
    ...items.map((it) => `### id=${it.id}\n제목: ${it.title}\n기관: ${it.org}\n원문: ${it.url}\n본문:\n${String(bodies[it.id] ?? '(본문 없음)').slice(0, BODY_LIMIT)}\n`),
  ].join('\n')

// 모델 응답에서 JSON 배열을 꺼낸다. 형식이 맞지 않으면 빈 객체.
export const parseVerdicts = (text) => {
  const m = /\[[\s\S]*\]/.exec(String(text ?? ''))
  if (!m) return {}
  let arr
  try {
    arr = JSON.parse(m[0])
  } catch {
    return {}
  }
  const out = {}
  for (const v of Array.isArray(arr) ? arr : []) {
    if (v?.id && VERDICTS.includes(v.verdict)) out[String(v.id)] = { verdict: v.verdict, quote: String(v.quote ?? '') }
  }
  return out
}

// 판정 적용. judge: 'gemini' | 'haiku'. verdicts: {id: {verdict, quote}}. bodies: {id: 본문}.
// 확실 + 인용문이 본문에 실제 있을 때만 confirmed. 불명확(Gemini)·판정 없음은 needs-haiku, 2차 불명확·불가는 hidden.
export const applyVerdicts = (queue, items, verdicts, bodies, judge, now = Date.now()) => {
  const at = new Date(now).toISOString()
  const ids = new Set(items.map((i) => i.id))
  const next = queue.items.map((q) => {
    if (!ids.has(q.id)) return q
    const v = verdicts[q.id]
    const body = bodies[q.id] ?? ''
    const base = { ...q, judge, judgedAt: at }
    if (v?.verdict === '확실' && quoteInBody(v.quote, body)) {
      return { ...base, status: 'confirmed', verdict: '확실', evidence: v.quote, evidenceUrl: q.url }
    }
    if (judge === 'haiku') return { ...base, status: 'hidden', verdict: v?.verdict === '확실' ? '불명확' : (v?.verdict ?? '불명확') }
    if (v?.verdict === '불가') return { ...base, status: 'hidden', verdict: '불가' }
    return { ...base, status: 'needs-haiku', verdict: v?.verdict ?? '판정 실패' }
  })
  return { ...queue, items: next }
}

// 노출 데이터에 넣을 확정 공고(jobs.json 형식). 장애인 전용 표시와 근거를 남긴다.
export const confirmedJobs = (queue) =>
  queue.items
    .filter((q) => q.status === 'confirmed')
    .map((q) => ({
      id: q.id,
      title: q.title,
      org: q.org,
      region: '',
      hires: null,
      start: '',
      end: q.end,
      url: q.url,
      disabledOnly: true,
      source: q.source,
      reviewed: { verdict: q.verdict, judge: q.judge, evidence: q.evidence, evidenceUrl: q.evidenceUrl, judgedAt: q.judgedAt },
    }))

// 수집 단계에서 호출: 애매한 공고를 대기열 파일에 적는다(판정은 하지 않는다).
export const enqueueSave = async (jobs, today, rules = {}, file = QUEUE_FILE) => {
  const r = enqueue(await readQueue(file), jobs, today, rules)
  await writeQueue(r.queue, file)
  return r.added
}
