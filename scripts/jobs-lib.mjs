// 재정경제부 공공기관 채용정보 조회서비스(/1051000/recruitment) 응답을 화면용 데이터로 바꾼다.
// 장애인만 지원할 수 있는 공고만 남기는 규칙은 keywords.json 에서 읽는다.

export const toIsoDate = (ymd) => {
  const s = String(ymd ?? '').replace(/\D/g, '')
  return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : ''
}

const itemOf = (row) => (row && typeof row === 'object' && 'item' in row ? row.item : row)

export const rowsOf = (json) => {
  const r = json?.result
  if (Array.isArray(r)) return r.map(itemOf).filter(Boolean)
  if (r && Array.isArray(r.item)) return r.item
  return []
}

// 우대 내용(prefCn, prefCondCn)은 일부러 보지 않는다. 우대 문구가 "전용"으로 오인되면 안 된다.
const textOf = (it) =>
  [it.recrutPbancTtl, it.recrutSeNm, it.hireTypeNmLst, it.aplyQlfcCn].filter(Boolean).join(' ')

export const isDisabledOnly = (it, rules) => {
  const title = it.recrutPbancTtl ?? ''
  if (!(rules.제목_필수 ?? []).every((w) => title.includes(w))) return false
  if ((rules.제목_제외 ?? []).some((w) => title.includes(w))) return false
  const text = textOf(it)
  if (!rules.필수.every((w) => text.includes(w))) return false
  if (rules.전용으로_보는_표현.some((w) => text.includes(w))) return true
  return false
}

// 기관이 채용 첫 화면 주소만 올린 공고(주소 뒤가 비었거나 공고 번호가 없음)는 눌러도 공고가 안 보인다.
// 이때는 같은 공고의 ALIO 상세 화면으로 보낸다(자동 요약도 이 주소에서 원문을 읽는다).
export const alioViewUrl = (id) => `https://job.alio.go.kr/recruitview.do?idx=${id}`
export const isHomepageUrl = (u) => {
  try {
    const { pathname, search } = new URL(u)
    return pathname.replace(/\/+$/, '') === '' || !/\d/.test(pathname + search)
  } catch {
    return true
  }
}
const jobUrl = (it) => (isHomepageUrl(it.srcUrl ?? '') ? alioViewUrl(it.recrutPblntSn) : it.srcUrl)

export const toJob = (it) => ({
  id: String(it.recrutPblntSn),
  title: it.recrutPbancTtl ?? '',
  org: it.instNm ?? '',
  region: it.workRgnNmLst ?? '',
  hires: it.recrutNope ?? null,
  start: toIsoDate(it.pbancBgngYmd),
  end: toIsoDate(it.pbancEndYmd),
  url: jobUrl(it),
  disabledOnly: true,
})

export const buildJobs = (rows, rules, today) =>
  rows
    .filter((it) => isDisabledOnly(it, rules))
    .map(toJob)
    .filter((j) => j.id && j.title && j.end && j.end >= today)
    .sort((a, b) => (a.end < b.end ? -1 : a.end > b.end ? 1 : 0))

export const serviceKeyParam = (key) => (key.includes('%') ? key : encodeURIComponent(key))

export const listUrl = (key, pageNo, numOfRows = 100) =>
  'https://apis.data.go.kr/1051000/recruitment/list' +
  `?serviceKey=${serviceKeyParam(key)}&ongoingYn=Y&numOfRows=${numOfRows}&pageNo=${pageNo}&resultType=json`

export const detailUrl = (key, sn) =>
  `https://apis.data.go.kr/1051000/recruitment/detail?serviceKey=${serviceKeyParam(key)}&resultType=json&sn=${encodeURIComponent(sn)}`
