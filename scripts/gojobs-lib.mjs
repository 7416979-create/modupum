// 나라일터(gojobs.go.kr) 공개 채용공고 목록(공고명 검색 결과)에서 제목·기관·마감일만 읽어 화면용 데이터로 바꾼다.
// 공고 상세 본문·첨부는 gojobs-copy.mjs 가 사본으로 저장하고, 카드의 원문 링크는 그 사본(모두품 주소)을 가리킨다.

import { dedupeJobs } from './dedupe-lib.mjs'
import { copyUrl } from './gojobs-copy-lib.mjs'

export const GOJOBS_LIST = 'https://www.gojobs.go.kr/apmList.do'

const clean = (s) =>
  String(s ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()

const ymd = /^\d{4}-\d{2}-\d{2}$/

// 목록 아이콘의 alt(공공·국가·지자체·교육 등)를 화면에서 쓰는 기관 종류 이름으로 바꾼다.
export const orgTypeOf = (alt) => {
  const a = String(alt ?? '')
  if (a.includes('공공')) return '공공기관'
  if (a.includes('국가') || a.includes('중앙')) return '국가기관'
  if (a.includes('지자체') || a.includes('지방자치')) return '지자체'
  if (a.includes('교육')) return '교육청'
  return ''
}

// 목록 표의 행을 읽는다. 열 순서: 번호, 공고명(기관유형 아이콘 포함), 기관, 게시일, 마감일, 조회수
export const parseList = (html) => {
  const body = html.includes('<tbody') ? html.slice(html.indexOf('<tbody')) : html
  const total = Number(/Total\s+(\d[\d,]*)/.exec(html)?.[1]?.replace(/,/g, '') ?? 0)
  const rows = []
  for (const m of body.matchAll(/<tr\s*>([\s\S]*?)<\/tr>/g)) {
    const tds = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((t) => t[1])
    if (tds.length < 6) continue
    const view = /fn_apmView\(\s*'([^']*)'\s*,\s*'(\d+)'\s*\)/.exec(tds[1])
    if (!view) continue
    const title = clean(tds[1])
    const start = clean(tds[3])
    const end = clean(tds[4])
    if (!title || !ymd.test(end)) continue
    const alt = /<img[^>]*\balt="([^"]*)"/.exec(tds[1])?.[1] ?? ''
    rows.push({ code: view[1], sn: view[2], title, org: clean(tds[2]), orgType: orgTypeOf(alt), start: ymd.test(start) ? start : '', end })
  }
  return { total, rows }
}

// 제목만으로 장애인 전용 공고인지 본다(keywords.json 규칙과 같은 기준).
// 띄어쓰기가 제각각이라('장애인제한', '장애인 제한 경쟁') 공백을 모두 지우고 비교한다.
const squash = (s) => String(s ?? '').replace(/\s+/g, '')

export const isDisabledOnlyTitle = (title, rules) => {
  const t = squash(title)
  if (!(rules.제목_필수 ?? []).every((w) => t.includes(squash(w)))) return false
  if ((rules.제목_제외 ?? []).some((w) => t.includes(squash(w)))) return false
  if (!rules.필수.every((w) => t.includes(squash(w)))) return false
  return rules.전용으로_보는_표현.some((w) => t.includes(squash(w)))
}

// 합격자 발표처럼 지원할 수 없는 글은 목록에서 뺀다.
export const isNotice = (title, rules) => (rules.나라일터_제외 ?? []).some((w) => String(title).includes(w))

// (참고용) 제목 검색 목록 주소. 마감 후 '자료가 없습니다'로 열려 원문 링크로는 쓰지 않는다.
export const searchUrl = (title, code = '020') =>
  `${GOJOBS_LIST}?menuNo=401&mngrMenuYn=N&selMenuNo=400&upperMenuNo=&searchJobsecode=${encodeURIComponent(code)}&searchKeyword=${encodeURIComponent(title)}`

export const toJob = (row, rules) => ({
  id: `gojobs-${row.sn}`,
  title: row.title,
  org: row.org,
  region: '',
  hires: null,
  start: row.start,
  end: row.end,
  url: copyUrl(row.sn),
  disabledOnly: isDisabledOnlyTitle(row.title, rules),
  orgType: row.orgType || '',
  source: '나라일터',
})

// 나라일터에서 '장애'로 검색한 접수 중 공고 가운데 장애인 제한경쟁·제한전형(disabledOnly)만 담는다.
// 장애인 우대·우선채용, 일반인과 경쟁하는 공고는 뺀다.
export const buildGojobs = (rows, rules, today) =>
  rows
    .filter((r) => r.end >= today && !isNotice(r.title, rules))
    .map((r) => toJob(r, rules))
    .filter((j) => j.disabledOnly)

// 이미 있는 공고(기관·제목·마감일이 같거나 원문 주소가 같은 것)는 하나만 남긴다. 규칙은 dedupe-lib.mjs.
export const mergeJobs = (base, extra) =>
  dedupeJobs([...base, ...extra]).items.sort((a, b) => (a.end < b.end ? -1 : a.end > b.end ? 1 : 0))
