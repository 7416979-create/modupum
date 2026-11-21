// AI 재검토(Haiku) 공통 로직. 새로 올라간 공고만 원문을 한 번 더 보고 '내리는 쪽'으로만 쓴다.
// 올리는 판단은 하지 않는다. 판정 결과가 깨졌거나 비어 있으면 아무것도 바꾸지 않는다.
import { readFile } from 'node:fs/promises'

export const VERDICTS = ['전용', '아님', '애매']
export const HIDE_VERDICTS = ['아님', '애매']
export const MAX_ITEMS = 15
export const JOBS_FILE = new URL('../public/data/jobs.json', import.meta.url)
export const LOG_FILE = new URL('./ai-review-log.json', import.meta.url)
export const HIDE_FILE = new URL('./ai-review-hide.json', import.meta.url)
export const QUEUE_FILE = new URL('./review-queue.json', import.meta.url)
export const BUNDLE_FILE = new URL('./ai-review-bundle.json', import.meta.url)
export const RESULT_FILE = new URL('./ai-review-result.json', import.meta.url)

export const readJsonOr = async (file, fallback) => {
  try {
    return JSON.parse((await readFile(file, 'utf8')).replace(/^﻿/, ''))
  } catch {
    return fallback
  }
}

// 숨김 목록의 id 집합. 파일이 없거나 깨졌으면 빈 집합(수집을 막지 않는다).
export const loadHideIds = async (file = HIDE_FILE) => {
  const h = await readJsonOr(file, { items: [] })
  return new Set((Array.isArray(h.items) ? h.items : []).map((x) => x && x.id).filter(Boolean))
}

export const filterHidden = (items, hideIds) => (hideIds && hideIds.size ? items.filter((j) => !hideIds.has(j.id)) : items)

// 아직 판정 기록(log)이 없는 공고만, 최대 max 건.
export const selectNew = (jobs, log, max = MAX_ITEMS) =>
  jobs.filter((j) => j && typeof j.id === 'string' && !Object.hasOwn(log, j.id)).slice(0, max)

const evidenceOf = (j) => {
  if (j.disabledEvidence) return String(j.disabledEvidence)
  const s = j.summary && j.summary.장애인관련
  return Array.isArray(s) ? s.join(' / ') : s ? String(s) : ''
}

export const bundleItem = (j) => ({
  id: j.id,
  title: j.title || '',
  org: j.org || '',
  source: j.source || '',
  end: j.end || '',
  url: j.url || '',
  mixedEvidence: j.mixedEvidence || '',
  disabledEvidence: evidenceOf(j),
  bodyText: typeof j.bodyText === 'string' ? j.bodyText.slice(0, 4000) : '',
})

// 모델 출력에서 JSON 배열을 찾아 검증한다. 형식이 하나라도 틀리면 throw(아무것도 바꾸지 않음).
// 묶음에 없는 id 는 무시한다.
export const parseResult = (text, validIds) => {
  if (typeof text !== 'string' || !text.trim()) throw new Error('결과가 비어 있습니다')
  const m = text.match(/\[[\s\S]*\]/)
  if (!m) throw new Error('JSON 배열을 찾지 못했습니다')
  let arr
  try {
    arr = JSON.parse(m[0])
  } catch {
    throw new Error('JSON 파싱에 실패했습니다')
  }
  if (!Array.isArray(arr)) throw new Error('배열이 아닙니다')
  const out = []
  for (const r of arr) {
    if (!r || typeof r.id !== 'string' || !validIds.has(r.id)) continue
    if (!VERDICTS.includes(r.verdict)) throw new Error(`알 수 없는 판정: ${String(r.verdict).slice(0, 20)}`)
    out.push({
      id: r.id,
      verdict: r.verdict,
      reason: String(r.reason || '').slice(0, 200),
      quote: String(r.quote || '').slice(0, 80),
    })
  }
  return out
}

// 판정 결과를 기록(log)과 숨김 대상으로 나눈다. 입력 객체는 바꾸지 않는다.
export const planApply = (results, log, hide, queue, bundleById, now) => {
  const newLog = { ...log }
  const newHide = [...(hide.items || [])]
  const hidden = new Set(newHide.map((x) => x.id))
  const newQueue = { ...queue, items: [...(queue.items || [])] }
  const queued = new Set(newQueue.items.map((x) => x.id))
  const added = { hide: [], queue: [] }
  for (const r of results) {
    newLog[r.id] = { verdict: r.verdict, reason: r.reason, quote: r.quote, checkedAt: now }
    if (!HIDE_VERDICTS.includes(r.verdict) || hidden.has(r.id)) continue
    const b = bundleById.get(r.id) || {}
    const entry = { id: r.id, title: b.title || '', verdict: r.verdict, reason: r.reason, at: now }
    newHide.push(entry)
    hidden.add(r.id)
    added.hide.push(r.id)
    if (r.verdict === '애매' && !queued.has(r.id)) {
      newQueue.items.push({
        id: r.id,
        title: b.title || '',
        org: b.org || '',
        url: b.url || '',
        end: b.end || '',
        source: b.source || '',
        status: 'ai-ambiguous',
        addedAt: now,
      })
      queued.add(r.id)
      added.queue.push(r.id)
    }
  }
  return { log: newLog, hide: { items: newHide }, queue: newQueue, added }
}

// 숨김 대상을 사이트 데이터에서도 바로 뺀다.
export const removeHidden = (data, hideIds) => {
  const items = Array.isArray(data.items) ? data.items : []
  const kept = items.filter((j) => !hideIds.has(j.id))
  return { data: { ...data, items: kept }, removed: items.length - kept.length }
}
