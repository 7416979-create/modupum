// 요약 자동 채우기(autosum) 공통 함수. 순수 함수 위주로 두어 테스트한다.
// 원칙: 이미 채워진 공고의 easy 는 절대 덮어쓰지 않고, 공고를 지우지 않는다. 검증에 통과한 것만 반영한다.

export const NO_INFO = '공고에 안 나와 있어요'
export const REQUIRED = ['언제까지', '무슨일고용', '어디서', '누가', '몇명', '무슨일', '일하는시간', '급여', '접수', '문의']
export const OPTIONAL = ['연장']
export const AUTO_TRIAL_END = '2026-11-12' // 처음 2주 관찰 기간 끝

// 병행(mixed: 모집분야 중 일부만 장애인 대상) 공고도 자동 요약 대상이다. 단 장애인 전용 표시(disabledOnly)와
// 근거(mixedEvidence 또는 mixedFields)가 있는 것만. 요약은 mixedNote 로 장애인 분야만 쓰게 하고, verifyEasy 가
// 장애인 모집분야 내용이 들어 있는지 따로 검사한다. 조건이 없는 병행 공고는 daily-check 가 '수동 필요'로 알린다.
export const mixedEligible = (j) => j?.mixed === true && j.disabledOnly === true && !!(j.mixedEvidence || (Array.isArray(j.mixedFields) && j.mixedFields.length))

// 마감 전인데 쉬운 요약이 없는 공고인가(daily-check 의 빈칸 판정과 같은 기준)
export const needsSummary = (j, today) => j?.end >= today && !(j.verified === true && j.easy) && (j.mixed !== true || mixedEligible(j))

// 병행 공고 요약 프롬프트에 붙이는 주의 문구. 병행이 아니면 빈 글.
export const mixedNote = (job) => job?.mixed === true
  ? `\n주의: 이 공고는 모집 분야가 여러 개이고 그중 장애인 대상 분야만 이 사이트의 대상이다(장애인 분야 근거: ${[job.mixedEvidence, ...(Array.isArray(job.mixedFields) ? job.mixedFields : [])].filter(Boolean).join(' / ').slice(0, 300)}). 누가·몇명·무슨일·일하는시간·급여는 장애인 대상 분야 내용만 쓰고 일반·보훈·휴직대체 등 다른 분야의 자격·인원·조건은 쓰지 않는다. 장애인 분야와 다른 분야가 구분되지 않는 칸은 "${NO_INFO}. 문의에 물어보세요."라고 쓴다. 누가 칸에는 장애인 대상이라는 조건을 반드시 쓴다. 몇명 칸의 근거는 장애인 모집분야 표기와 그 인원이 함께 보이게 원문에서 복사한다(분야 표기와 인원이 다른 줄이면 "..." 로 이어서 한 근거로 쓴다). 우대·가점 문장은 근거로 쓰지 않는다.\n`
  : ''

// 클라우드(Actions)가 올리는 대기 목록. since 는 처음 대기에 들어온 날을 이어 둔다.
export const buildPending = (items, today, prevPending = []) => {
  const since = new Map((prevPending || []).map((p) => [p.id, p.since]))
  return (items || [])
    .filter((j) => needsSummary(j, today))
    .map((j) => ({ id: j.id, title: j.title, org: j.org, end: j.end, url: j.url, since: since.get(j.id) || today }))
}

// daily-check 용: 요약이 빈 공고를 '자동 채우기 대기 중'과 '막힘'으로 나눈다.
// 대기 목록에 들어온 지 하루 이하면 다음 자동 실행(하루 세 번)을 기다리는 중이라 실패로 보지 않는다.
// 하루를 넘겼거나 대기 목록에도 없으면 막힌 것이라 사람이 봐야 한다.
export const splitBlank = (items, pending, today) => {
  const since = new Map((pending || []).map((p) => [p.id, p.since]))
  const yesterday = new Date(Date.parse(today) - 86400000).toISOString().slice(0, 10)
  const waiting = []
  const stuck = []
  for (const j of (items || []).filter((x) => needsSummary(x, today))) {
    const s = since.get(j.id)
    ;(s && s >= yesterday ? waiting : stuck).push(j.id)
  }
  return { waiting, stuck }
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

// 대조용 정규화: 전각·호환 문자(NFKC)를 맞추고, 물결·대시·가운뎃점·글머리 기호 표기 차이는 같은 글자로 본다. 공백과 | 는 지운다.
const sq = (s) => String(s ?? '')
  .normalize('NFKC')
  .replace(/[~∼〜～]/g, '~')
  .replace(/[‐‑‒–—―−－ー]/g, '-')
  .replace(/[·・ㆍ•●○◦▪■□◆◇▶▷※*]/g, '')
  .replace(/[\s|]+/g, '')
export const squash = sq

// 원문의 한글 수 표기('두 명', '열 시')를 숫자로 바꿔 숫자 대조에 쓴다. 인원·시각 단위가 붙은 경우만 본다.
const NATIVE_NUM = { 한: 1, 두: 2, 세: 3, 네: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10 }
export const nativeNumTokens = (s) =>
  [...String(s ?? '').matchAll(/(한|두|세|네|다섯|여섯|일곱|여덟|아홉|열)\s?(?=명|시|개|곳|회|분)/g)].map((m) => String(NATIVE_NUM[m[1]]))

// 글자 속 숫자 덩어리(쉼표 제거). '2,650,380원' -> 2650380
export const numTokens = (s) => [...String(s ?? '').replace(/(\d),(?=\d{3}\b)/g, '$1').matchAll(/\d+/g)].map((m) => String(Number(m[0])) === m[0] ? m[0] : m[0].replace(/^0+(?=\d)/, '') )

// 시각 문자열("오후 4시", "16:00", "18 시")에서 24시간제 '시'만 뽑는다. 없으면 null.
const clockHour = (ampm, h, colon) => {
  let n = Number(h)
  if (ampm === '오후' && n < 12) n += 12
  if (ampm === '오전' && n === 12) n = 0
  return colon === undefined && n > 24 ? null : n
}
export const firstClockHour = (s) => {
  const m = /(오[전후])?\s*(\d{1,2})\s*(?:[:：]\s*\d{2}|시)/.exec(String(s ?? ''))
  return m ? clockHour(m[1], m[2]) : null
}
// 원문에서 "접수마감일 16:00까지", "마감 당일 18시까지 접수분에 한함" 같은 마감일 시각 제한의 '시'들을 찾는다.
export const deadlineLimitHours = (text) => {
  const t = String(text ?? '').replace(/\s+/g, ' ')
  const hours = new Set()
  for (const m of t.matchAll(/마감\s?(?:일|당일)\s?(?:은|에는|에|의|까지)?\s?(오[전후])?\s?(\d{1,2})\s?(?:[:：]\s?\d{2}|시(?:\s?\d{1,2}\s?분)?)\s?까지/g)) {
    const h = clockHour(m[1], m[2])
    if (h !== null && h <= 24) hours.add(h)
  }
  return [...hours]
}

// 글 속 주소·이메일만 뽑는다. '(https://a.kr)에서', 'a.kr.' 처럼 뒤에 붙은 괄호·조사·문장부호는 주소가 아니다.
export const linkTokens = (s) =>
  [...String(s ?? '').matchAll(/https?:\/\/[A-Za-z0-9._~:/?#@!$&*+=%-]+|[\w.+-]+\s?@\s?[\w-]+(?:\.[\w-]+)+/g)]
    .map((m) => m[0].replace(/[.,:;!?]+$/, ''))

const NUM_FIELDS =['언제까지', '몇명', '급여', '일하는시간', '문의', '연장']
const asText = (v) => (Array.isArray(v) ? v.join(' ') : String(v ?? ''))

// 자동 생성 요약을 원문 글자와 대조한다. 통과하면 {ok:true}, 아니면 {ok:false, reasons:[...]}.
export const verifyEasy = (easyIn, evidence, sourceText, job = null) => {
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

  // 접수 마감일에 별도 시각 제한("접수마감일 16:00까지 접수에 한함")이 있으면 '언제까지' 칸의 첫 시각이 그 시각이어야 한다.
  const lim = deadlineLimitHours(sourceText)
  if (lim.length) {
    const first = firstClockHour(asText(easy['언제까지']))
    if (first === null || !lim.includes(first)) reasons.push(`마감일 시각 제한(${lim.map((h) => `${h}시`).join('·')}까지)이 '언제까지' 칸 첫 시각과 다름: 그 시각을 우선 쓰고, 공고에 적힌 다른 시각은 괄호로 덧붙이세요`)
  }

  // 연장 칸은 근거가 원문에 그대로 있을 때만 쓴다. 아니면 칸을 뺀다(실패로 보지 않는다).
  if ('연장' in easy) {
    const evs = [].concat(evidence?.['연장'] ?? []).filter((x) => typeof x === 'string' && sq(x).length >= 4)
    if (!evs.length || !evs.every((q) => src.includes(sq(q)))) { easy = { ...easy }; delete easy.연장 }
  }
  const srcNums = new Set([...numTokens(sourceText), ...nativeNumTokens(sourceText)])
  let noInfo = 0
  for (const k of keys) {
    if (!(k in easy)) continue // 위에서 뺀 연장 칸은 검사하지 않는다
    const text = asText(easy[k])
    if (text.length > 900) reasons.push(`너무 김: ${k}`)
    if (/준비\s*중|확인\s*안\s*됨|undefined|null/.test(text)) reasons.push(`금지 문구: ${k}`)
    if (/https?:\/\/|@/.test(text)) {
      const links = linkTokens(text)
      if (!links.length || !links.every((l) => src.includes(sq(l)))) reasons.push(`원문에 없는 주소·이메일: ${k}`)
    }
    const hasNoInfo = /안 나와 있어요|나와 있지 않아요/.test(text)
    if (hasNoInfo) noInfo += 1
    // 근거 문장: 빈칸 문구가 아닌 칸은 근거가 1개 이상 있어야 하고, 모두 원문에 그대로 있어야 한다.
    const ev = [].concat(evidence?.[k] ?? []).filter((x) => typeof x === 'string' && x.trim())
    if (!hasNoInfo && ev.length === 0) reasons.push(`근거 문장 없음: ${k}`)
    for (const q of ev) {
      // 표 칸을 건너뛰며 "..." 로 이은 근거는 조각마다 원문에 있어야 한다.
      const frags = q.split(/\.{2,}|…/).map(sq).filter((f) => f.length >= 1)
      if (frags.join('').length < 4) reasons.push(`근거가 너무 짧음: ${k}`)
      else if (!frags.every((f) => src.includes(f))) reasons.push(`근거가 원문에 없음: ${k} "${q.slice(0, 30)}"`)
    }
    if (NUM_FIELDS.includes(k)) {
      for (const t of numTokens(text)) if (!srcNums.has(t)) reasons.push(`숫자 ${t} 가 원문에 없음: ${k}`)
    }
  }
  // 빈칸 문구가 너무 많으면 글자 추출이 덜 된 것이다(원문 확인 전에 비우지 않는다).
  if (noInfo >= 5) reasons.push(`빈칸 문구가 ${noInfo}칸: 추출이 덜 됐을 수 있음`)
  // 병행 공고: 장애인 모집분야 내용이 누가·몇명 칸과 근거 문장에 들어 있어야 한다(다른 분야 자격을 쓰는 사고 방지).
  if (job?.mixed === true) {
    if (!/장애/.test(`${asText(easy['누가'])} ${asText(easy['몇명'])}`)) reasons.push('병행 공고: 누가·몇명 칸에 장애인 모집분야 내용이 없음')
    // 우대·가점·가산·% 가 든 문장은 장애인 모집분야를 보여 주는 근거로 치지 않는다(mixed-lib 의 NEGATIVE 와 같은 생각).
    const disabledEv = (q) => /장애/.test(String(q)) && !/우대|가점|가산|%/.test(String(q))
    const evs = [].concat(evidence?.['누가'] ?? [], evidence?.['몇명'] ?? [])
    if (!evs.some(disabledEv)) reasons.push('병행 공고: 장애인 분야를 보여 주는 근거 문장이 없음')
    // 다른 분야 인원이 섞이지 않게: 몇명 숫자는 '장애인' 이 든 근거 문장에 같이 있거나, 수집 때 남긴 장애인 분야 근거(mixedEvidence·mixedFields)에 있어야 한다.
    const nums = numTokens(asText(easy['몇명']))
    if (nums.length) {
      const hay = [job.mixedEvidence, ...(Array.isArray(job.mixedFields) ? job.mixedFields : [])].filter(Boolean).join(' ')
      const byEvidence = [].concat(evidence?.['몇명'] ?? []).some((q) => disabledEv(q) && nums.every((n) => numTokens(q).includes(n)))
      const byMixed = hay && nums.every((n) => numTokens(hay).includes(n))
      if (!byEvidence && !byMixed) reasons.push('병행 공고: 몇명 숫자가 장애인 모집분야와 함께 나온 근거 문장이 없음(분야 표기와 인원이 다른 줄이면 "..." 로 이어서 한 근거로 복사)')
    }
  }
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
    return { ...j, verified: true, easy: r.easy, auto: { at: today, model: r.model || 'haiku', trialUntil: AUTO_TRIAL_END, ...(j.mixed === true ? { mixed: true } : {}) } }
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

// 공고 문제가 아니라 PC의 Claude 로그인 만료. 공고별 실패로 세지 않는다.
export const isAuthError = (msg) => /Failed to authenticate|OAuth session expired|Please run \/login|Not logged in/i.test(String(msg ?? ''))
