// 목록 상태 표시 계산(프론트). 신청기간을 알 수 없으면 절대 '마감'으로 단정하지 않고 '신청기간 확인 필요'로 둔다.

const YMD = /^\d{4}-\d{2}-\d{2}$/
const dayDiff = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000)
const iso = (y, m, d) => {
  const s = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  return YMD.test(s) && new Date(s).toISOString().slice(0, 10) === s ? s : ''
}

export const NEW_DAYS = 3

// NEW: 게시일(date) 또는 최초 수집일(firstSeen)이 오늘 포함 최근 3일 이내.
export const isNew = (today, ...dates) =>
  dates.some((d) => {
    const s = String(d || '').slice(0, 10)
    if (!YMD.test(s)) return false
    const age = dayDiff(today, s)
    return age >= 0 && age <= NEW_DAYS
  })

// 탭 NEW 배지: 새 항목(isNew) 중 가장 최근 날짜. 없으면 ''. seen(마지막 확인 날짜)보다 새로울 때만 배지를 보인다.
export const newestNew = (today, dates) =>
  (dates || []).filter((d) => isNew(today, d)).map((d) => String(d).slice(0, 10)).sort().pop() || ''
export const showTabNew = (newest, seen) => !!newest && !(YMD.test(String(seen || '')) && seen >= newest)

// 본문에서 신청 종료일을 보수적으로 읽는다: 연도가 있는 날짜 + '까지' 또는 '~' 바로 뒤에서만.
const D = String.raw`(\d{4})\s*[.\-년]\s*(\d{1,2})\s*[.\-월]\s*(\d{1,2})`
export const parseEnd = (text) => {
  const t = String(text || '')
  const m = t.match(new RegExp(`[~∼～]\s*${D}`)) || t.match(new RegExp(`${D}\s*[.일]?\s*까지`))
  return m ? iso(m[1], m[2], m[3]) : ''
}
const ONGOING = /(상시|연중|수시)\s*(신청|접수|모집)/

// 신청기간 판정: ovr 는 welfare-status.json 의 항목(applyStart/applyEnd/ongoing), 없으면 본문에서만 추정.
export const periodOf = (today, item, ovr = {}) => {
  const end = [ovr.applyEnd, item.applyEnd, item.end].find((v) => YMD.test(String(v || ''))) || parseEnd(item.summary)
  const start = [ovr.applyStart, item.applyStart, item.start].find((v) => YMD.test(String(v || ''))) || ''
  if (end) return end < today ? 'closed' : start && start > today ? 'upcoming' : 'open'
  if (start && start > today) return 'upcoming'
  if (ovr.ongoing === true || item.ongoing === true || ONGOING.test(String(item.summary || ''))) return 'open'
  return 'unknown'
}

// 지역별로 대상·지원이 달라질 수 있는 항목: 지자체 소관·지역 한정 표현. '지역난방'은 제외하고 본다.
const REGION = /(지자체|지방자치|시[·ㆍ]도|시도별|시[·ㆍ]군[·ㆍ]구|시군구|광역|거주지|주민센터|읍[·ㆍ]면[·ㆍ]동|지역사회|지방세|지역별|관할)/
const REGION_TITLE = /지역(?!난방)/
export const needsRegion = (item, kind = 'welfare') => {
  if (kind === 'jobs') return item.orgType === '지자체' || item.orgType === '교육청'
  const txt = `${item.title || ''} ${item.summary || ''} ${item.org || ''}`.replace(/지역난방/g, '')
  return REGION.test(txt) || REGION_TITLE.test(item.title || '')
}

// 장애인 외 추가 자격기준(소득·연령·등급·거주지 등) 유무: 'extra' | 'none' | 'unknown'(판별 불가: 대상 정보 없음).
const EXTRA = /(소득|수급|차상위|기초생활|연령|\d+\s*세|영유아|아동|청소년|노인|어르신|학생|재학|등급|중증|경증|거주|재산|임산부|취업|근로|사업자|보호자)/
export const criteriaOf = (item) => {
  const toks = String(item.target || '').split(',').map((x) => x.trim()).filter(Boolean)
  if (!toks.length) return 'unknown'
  if (toks.some((x) => x !== '장애인')) return 'extra'
  return EXTRA.test(`${item.title || ''} ${item.summary || ''}`) ? 'extra' : 'none'
}
export const UNKNOWN_PERIOD_LABEL = '신청기간 확인 필요'
export const UNKNOWN_PERIOD_LABEL_EXTRA = '신청기간 및 자격기준 확인 필요'
export const unknownLabel = (item) => (criteriaOf(item) === 'none' ? UNKNOWN_PERIOD_LABEL : UNKNOWN_PERIOD_LABEL_EXTRA)
export const unknownShort = (item) => (criteriaOf(item) === 'none' ? '기간 확인' : '기간·자격 확인')
