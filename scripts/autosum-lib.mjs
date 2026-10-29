// 요약 자동 채우기(autosum) 공통 함수. 순수 함수 위주로 두어 테스트한다.
// 원칙: 이미 채워진 공고의 easy 는 절대 덮어쓰지 않고, 공고를 지우지 않는다. 검증에 통과한 것만 반영한다.

export const NO_INFO = '공고에 안 나와 있어요'
export const REQUIRED = ['언제까지', '무슨일고용', '어디서', '누가', '몇명', '무슨일', '일하는시간', '급여', '접수', '문의']
export const OPTIONAL = ['연장']
export const AUTO_TRIAL_END = '2026-11-12' // 처음 2주 관찰 기간 끝

// 마감 전인데 쉬운 요약이 없는 공고인가(daily-check 의 빈칸 판정과 같은 기준)
export const needsSummary = (j, today) => j?.end >= today && !(j.verified === true && j.easy)

// 클라우드(Actions)가 올리는 대기 목록. since 는 처음 대기에 들어온 날을 이어 둔다.
export const buildPending = (items, today, prevPending = []) => {
  const since = new Map((prevPending || []).map((p) => [p.id, p.since]))
  return (items || [])
    .filter((j) => needsSummary(j, today))
    .map((j) => ({ id: j.id, title: j.title, org: j.org, end: j.end, url: j.url, since: since.get(j.id) || today }))
}

// 수집 때 새로 만든 공고(fresh)에 이전 공고(prev)의 검증된 요약·내부 표시를 옮긴다. 요약이 사라지면 안 된다.
export const carryVerified = (fresh, prev) => {
  if (!prev || prev.verified !== true || !prev.easy) return fresh
  return {
    ...fresh,
    verified: true,
    easy: prev.easy,
    ...(prev.auto ? { auto: prev.auto } : {}),
    ...(prev.urlFixed ? { url: prev.url, urlFixed: true } : {}),
  }
}

const sq = (s) => String(s ?? '').replace(/[\s|]+/g, '')
export const squash = sq

// 글자 속 숫자 덩어리(쉼표 제거). '2,650,380원' -> 2650380
export const numTokens = (s) => [...String(s ?? '').replace(/(\d),(?=\d{3}\b)/g, '$1').matchAll(/\d+/g)].map((m) => String(Number(m[0])) === m[0] ? m[0] : m[0].replace(/^0+(?=\d)/, '') )

const NUM_FIELDS = ['언제까지', '몇명', '급여', '일하는시간', '문의', '연장']
const asText = (v) => (Array.isArray(v) ? v.join(' ') : String(v ?? ''))

// 자동 생성 요약을 원문 글자와 대조한다. 통과하면 {ok:true}, 아니면 {ok:false, reasons:[...]}.
export const verifyEasy = (easyIn, evidence, sourceText) => {
  let easy = easyIn
  const reasons = []
  const src = sq(sourceText)
  if (src.length < 300) reasons.push(`원문 글자가 너무 적음(${src.length}자)`)
  if (!easy || typeof easy !== 'object') return { ok: false, reasons: [...reasons, 'easy 없음'] }
  for (const k of REQUIRED) {
    const v = easy[k]
    if (k === '누가' ? !Array.isArray(v) || !v.length || v.some((t) => typeof t !== 'string' || !t.trim()) : typeof v !== 'string' || !v.trim()) reasons.push(`칸 비어 있음: ${k}`)
  }
  const keys = Object.keys(easy).filter((k) => !(k === '연장' && /안 나와 있어요|없어요/.test(asText(easy[k])))) // 연장 칸은 원문에 있을 때만 쓴다
  for (const k of keys) if (![...REQUIRED, ...OPTIONAL].includes(k)) reasons.push(`알 수 없는 칸: ${k}`)
  if (reasons.length) return { ok: false, reasons }

  // 연장 칸은 근거가 원문에 그대로 있을 때만 쓴다. 아니면 칸을 뺀다(실패로 보지 않는다).
  if ('연장' in easy) {
    const evs = [].concat(evidence?.['연장'] ?? []).filter((x) => typeof x === 'string' && sq(x).length >= 4)
    if (!evs.length || !evs.every((q) => src.includes(sq(q)))) { easy = { ...easy }; delete easy.연장 }
  }
  const srcNums = new Set(numTokens(sourceText))
  let noInfo = 0
  for (const k of keys) {
    const text = asText(easy[k])
    if (text.length > 900) reasons.push(`너무 김: ${k}`)
    if (/준비\s*중|확인\s*안\s*됨|undefined|null/.test(text)) reasons.push(`금지 문구: ${k}`)
    if (/https?:\/\/|@/.test(text) && !src.includes(sq(text.match(/https?:\/\/\S+|[\w.+-]+@[\w.-]+/)?.[0] ?? '\u0000'))) reasons.push(`원문에 없는 주소·이메일: ${k}`)
    const hasNoInfo = /안 나와 있어요|나와 있지 않아요/.test(text)
    if (hasNoInfo) noInfo += 1
    // 근거 문장: 빈칸 문구가 아닌 칸은 근거가 1개 이상 있어야 하고, 모두 원문에 그대로 있어야 한다.
    const ev = [].concat(evidence?.[k] ?? []).filter((x) => typeof x === 'string' && x.trim())
    if (!hasNoInfo && ev.length === 0) reasons.push(`근거 문장 없음: ${k}`)
    for (const q of ev) {
      // 표 칸을 건너뛰며 "..." 로 이은 근거는 조각마다 원문에 있어야 한다.
      const frags = q.split(/\.{2,}|…/).map(sq).filter((f) => f.length >= 2)
      if (!frags.some((f) => f.length >= 4)) reasons.push(`근거가 너무 짧음: ${k}`)
      else if (!frags.every((f) => src.includes(f))) reasons.push(`근거가 원문에 없음: ${k} "${q.slice(0, 30)}"`)
    }
    if (NUM_FIELDS.includes(k)) {
      for (const t of numTokens(text)) if (!srcNums.has(t)) reasons.push(`숫자 ${t} 가 원문에 없음: ${k}`)
    }
  }
  // 빈칸 문구가 너무 많으면 글자 추출이 덜 된 것이다(원문 확인 전에 비우지 않는다).
  if (noInfo >= 5) reasons.push(`빈칸 문구가 ${noInfo}칸: 추출이 덜 됐을 수 있음`)
  return { ok: reasons.length === 0, reasons, easy }
}

// 검증 통과한 결과만 최신 공고 목록에 넣는다. 이미 요약이 있는 공고·없는 공고 id 는 건드리지 않는다.
export const applyResults = (items, results, today) => {
  const byId = new Map((results || []).filter((r) => r?.ok && r.easy).map((r) => [r.id, r]))
  const applied = []
  const out = items.map((j) => {
    const r = byId.get(j.id)
    if (!r || (j.verified === true && j.easy)) return j
    applied.push(j.id)
    return { ...j, verified: true, easy: r.easy, auto: { at: today, model: r.model || 'haiku', trialUntil: AUTO_TRIAL_END } }
  })
  return { items: out, applied }
}

// 시도 기록(확인 필요 목록)을 갱신한다. 성공한 id 는 빼고, 실패는 시도 횟수를 센다.
export const updateReview = (review, outcomes, today) => {
  const map = new Map((review || []).map((r) => [r.id, r]))
  for (const o of outcomes) {
    if (o.ok) { map.delete(o.id); continue }
    const prev = map.get(o.id)
    map.set(o.id, { id: o.id, title: o.title, org: o.org, end: o.end, url: o.url, attempts: (prev?.attempts || 0) + 1, last: today, reasons: o.reasons.slice(0, 8) })
  }
  return [...map.values()]
}

export const MAX_ATTEMPTS = 3
