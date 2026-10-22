// 올리기 직전 검수. 자동으로 고칠 수 있는 것(중복·마감 지남)은 지우고 기록하며, 나머지 위반은 오류로 돌려준다.
import { dedupeJobs } from './dedupe-lib.mjs'

const YMD = /^\d{4}-\d{2}-\d{2}$/
const validDate = (s) => YMD.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s
const BAD_TITLE = ['우선채용', '우대']
export const MAX_DROP = 0.5

export const validateJobs = (items, { today, rules = {} }) => {
  const fixes = []
  const errors = []
  const list = Array.isArray(items) ? items : []
  if (!Array.isArray(items)) errors.push('items 가 목록이 아닙니다')

  // 1) 자동 제거: id 중복 → 마감 지남 → 내용 중복(기관+제목+마감일, 원문 URL)
  const ids = new Set()
  let cur = []
  for (const j of list) {
    if (j?.id && ids.has(j.id)) {
      fixes.push(`id 중복 제거: ${j.id}`)
      continue
    }
    if (j?.id) ids.add(j.id)
    cur.push(j)
  }
  cur = cur.filter((j) => {
    if (validDate(j?.end) && j.end < today) {
      fixes.push(`마감 지남 제거: ${j.id} (${j.end})`)
      return false
    }
    return true
  })
  const d = dedupeJobs(cur.filter((j) => j && typeof j === 'object'))
  for (const r of d.removed) fixes.push(`중복 제거: ${r.removed.id} (남긴 공고 ${r.keptId})`)
  cur = d.items

  // 2) 오류: 자동으로 못 고치는 위반
  const titleExclude = [...(rules.제목_제외 ?? []), ...BAD_TITLE]
  for (const j of cur) {
    const tag = j?.id ?? '(id 없음)'
    for (const f of ['id', 'title', 'org', 'end', 'url']) {
      if (!j?.[f] || typeof j[f] !== 'string') errors.push(`${tag}: 필수 항목 ${f} 없음`)
    }
    // KEAD(한국장애인고용공단) 공고는 장애인 전용인지 단정하지 않으므로 disabledOnly·제목의 '장애' 검사를 하지 않는다.
    const kead = j.source === 'KEAD'
    if (kead) {
      if (typeof j.disabledOnly !== 'boolean') errors.push(`${tag}: disabledOnly 가 true/false 가 아님`)
      if (j.disabledOnly !== true && !j.eligibilityNote) errors.push(`${tag}: 장애인 전용이 아닌 KEAD 공고에 지원 가능 여부 안내문(eligibilityNote)이 없음`)
    } else if (j.disabledOnly !== true) errors.push(`${tag}: disabledOnly 가 true 가 아님`)
    for (const f of ['start', 'end']) {
      if (j[f] && !validDate(j[f])) errors.push(`${tag}: ${f} 날짜 형식 오류(${j[f]})`)
    }
    if (validDate(j.end) && j.start && validDate(j.start) && j.start > j.end) {
      errors.push(`${tag}: 시작일이 마감일보다 늦음`)
    }
    const t = String(j.title ?? '')
    const hit = kead ? undefined : titleExclude.find((w) => t.includes(w))
    if (hit) errors.push(`${tag}: 제목에 제외 표현 '${hit}'`)
    if (t && !kead && !t.includes('장애')) errors.push(`${tag}: 제목에 '장애' 없음`)
  }
  return { items: cur, fixes, errors }
}

// 복지: 가볍게 id/제목+기관 중복만 자동 제거, id·제목·url 누락은 오류.
export const validateWelfare = (items) => {
  const fixes = []
  const errors = []
  const seen = new Set()
  const seenKey = new Set()
  const out = []
  for (const w of Array.isArray(items) ? items : []) {
    if (!w?.id || !w?.title) {
      errors.push(`복지 ${w?.id ?? '(id 없음)'}: id 또는 제목 없음`)
      continue
    }
    const key = `${String(w.org ?? '').replace(/\s+/g, '')}|${String(w.title).replace(/\s+/g, '')}`
    if (seen.has(w.id) || seenKey.has(key)) {
      fixes.push(`복지 중복 제거: ${w.id}`)
      continue
    }
    seen.add(w.id)
    seenKey.add(key)
    if (!w.url) errors.push(`복지 ${w.id}: 원문 url 없음`)
    out.push(w)
  }
  return { items: out, fixes, errors }
}

// 직전 건수 대비 급감 여부. prev 가 5건 미만이면 비교하지 않는다.
export const isAbnormalDrop = (prevCount, nextCount) => prevCount >= 5 && nextCount < prevCount * (1 - MAX_DROP)
