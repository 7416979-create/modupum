// 한국장애인고용공단(KEAD) 채용정보 게시판(공사/공기업 분류)에서 공고 목록과 본문을 읽어 화면용 데이터로 바꾼다.
// 본문은 요약 항목(인원·고용형태·접수방법·장애인 관련 문구)만 남기고, 본문에서 확인되지 않는 항목은 '확인 안 됨'으로 둔다.
// 원문 전체는 저장하지 않고, 공단 원문 링크를 함께 둔다.

import { dedupeJobs, normOrg, normTitle } from './dedupe-lib.mjs'
import { isDisabledOnlyTitle } from './gojobs-lib.mjs'
import { carryVerified } from './autosum-lib.mjs'

export const KEAD_SOURCE = 'KEAD'
export const KEAD_SOURCE_LABEL = '한국장애인고용공단(KEAD)'
export const KEAD_ORG = '한국장애인고용공단'
export const UNKNOWN = '확인 안 됨'
export const BASE = 'https://www.kead.or.kr'

export const listUrl = (page = 1) =>
  `${BASE}/bbs/jobinfo/bbsPage.do?pageIndex=${page}&bbsCode=jobinfo&bbsCnId=&bbsNm=${encodeURIComponent('채용정보')}` +
  '&menuId=MENU2201&registDeptCode=&adt2Code=&adt3Code=&adt1Code=public&searchKeyword=&recordCountPerPage=10'

// 상세는 목록에서 POST 로 열리지만 같은 주소로 GET 해도 같은 글이 열려서, 바로 갈 수 있는 원문 링크로 쓴다.
export const viewUrl = (id) => `${BASE}/bbs/jobinfo/bbsView.do?bbsCode=jobinfo&bbsCnId=${encodeURIComponent(id)}&menuId=MENU2201`

const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ', '&middot;': '·', '&hellip;': '…' }
const decode = (s) => String(s ?? '').replace(/&[a-z#0-9]+;/gi, (e) => ENT[e.toLowerCase()] ?? ' ')

const clean = (s) =>
  decode(String(s ?? '').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()

const ymd = /^\d{4}-\d{2}-\d{2}$/
const pad = (n) => String(n).padStart(2, '0')

// 목록 표의 행. 열 순서: 번호, 제목, 도·광역시, 시·군·구, 분류, 마감일, 등록일
export const parseList = (html) => {
  const body = html.includes('<tbody') ? html.slice(html.indexOf('<tbody')) : html
  const rows = []
  for (const m of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const view = /fn_bbsView\(\s*'(\d+)'\s*\)/.exec(m[1])
    if (!view) continue
    const tds = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((t) => clean(t[1]))
    if (tds.length < 7) continue
    const title = tds[1]
    const end = tds[tds.length - 2]
    const start = tds[tds.length - 1]
    if (!title) continue
    rows.push({
      id: view[1],
      title,
      region: [tds[2], tds[3]].filter(Boolean).join(' '),
      category: tds[4],
      end: ymd.test(end) ? end : '',
      start: ymd.test(start) ? start : '',
    })
  }
  return rows
}

// 본문 HTML 을 줄 단위 글자로 바꾼다.
export const bodyLines = (html) => {
  const main = /<div class="main_text">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? ''
  return decode(
    main
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<\/(p|div|li|tr|h\d)>|<br\s*\/?>/gi, '\n')
      .replace(/<[^>]*>/g, ' '),
  )
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

// 상세 화면의 제목(h1). 목록 제목과 같은 글인지 확인하는 데 쓴다.
export const viewTitle = (html) => clean(/<article class="board_view data-info">[\s\S]*?<h1>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? '')

const cut = (s, n = 90) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const noEmail = (s) => s.replace(/[\w.+-]*\s?@\s?[\w-]+(\.[\w-]+)+/g, '이메일(주소는 원문 참조)')
const afterLabel = (line, re) => {
  const m = re.exec(line)
  return m ? line.slice(m.index + m[0].length).replace(/^[\s:：\-–]+/, '').trim() : ''
}

// 날짜를 YYYY-MM-DD 로. '2026. 11. 5.' '2026-11-05' '2026.11.5' 형태. 연도가 없으면 기준 연도를 쓴다.
const datesIn = (s, fallbackYear) => {
  const out = []
  for (const m of s.matchAll(/(?:(20\d{2})\s*[.\-/년]\s*)?(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*(?:[.일]|\b)/g)) {
    const y = m[1] ? Number(m[1]) : fallbackYear
    const mo = Number(m[2])
    const d = Number(m[3])
    if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) continue
    out.push(`${y}-${pad(mo)}-${pad(d)}`)
  }
  return out
}

// 본문 접수기간 줄에서 마감일을 찾는다. 못 찾으면 ''.
export const bodyEndDate = (lines, listEnd) => {
  const fy = Number((listEnd || '').slice(0, 4)) || new Date().getFullYear()
  for (const l of lines) {
    if (!/(모집|접수|지원|공고|신청)\s*기간|접수\s*마감|원서\s*접수/.test(l)) continue
    const part = l.includes('~') ? l.slice(l.lastIndexOf('~') + 1) : l
    const ds = datesIn(part, fy).filter((d) => ymd.test(d) && !Number.isNaN(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d)
    if (ds.length) return ds[ds.length - 1]
  }
  return ''
}

const TYPE_WORDS = ['정규직', '무기계약직', '무기계약', '계약직', '기간제', '시간제', '단시간', '체험형', '인턴', '공무직', '파견직', '일용직', '상용직', '비정규직']

// 본문에서 확인되는 사실만 뽑는다. 없으면 '확인 안 됨'.
export const summarize = (lines) => {
  let hiresText = ''
  let typeText = ''
  let applyText = ''
  for (const l of lines) {
    if (!hiresText) hiresText = afterLabel(l, /(채용|모집|선발)\s*(인원|규모)/)
    if (!typeText) typeText = afterLabel(l, /(고용\s*형태|채용\s*형태|근무\s*형태|채용\s*구분|모집\s*구분|근로\s*형태)/)
    if (!applyText) applyText = afterLabel(l, /(지원\s*방법|접수\s*방법|접수\s*처|제출\s*방법|응시\s*방법|신청\s*방법)/)
  }
  if (!typeText) {
    const found = TYPE_WORDS.filter((w) => lines.some((l) => l.includes(w)))
    if (found.length) typeText = `본문에 ${found.join('·')} 표현이 있음`
  }
  const dis = lines
    .filter((l) => l.includes('장애') && !/문의|담당|전화|☎|TEL/i.test(l) && !/사업체명/.test(l))
    .slice(0, 3)
    .map((l) => cut(l.replace(/^[-·●○※★\s]+/, '')))
  const hiresNum = /^(\d+)\s*명/.exec(hiresText)
  return {
    hires: hiresNum ? Number(hiresNum[1]) : null,
    summary: {
      채용인원: hiresText ? cut(hiresText, 60) : UNKNOWN,
      고용형태: typeText ? cut(typeText, 70) : UNKNOWN,
      접수방법: applyText ? cut(noEmail(applyText), 90) : UNKNOWN,
      장애인관련: dis.length ? dis : [UNKNOWN],
    },
  }
}

// 본문 '사업체명' 에서 실제 채용 기관 이름을 읽는다(없으면 '').
export const employerOf = (lines) => {
  for (const l of lines) {
    const v = afterLabel(l, /사업체\s*명|기관\s*명|업체\s*명/)
    if (v) return cut(v.replace(/\(.*$/, '').trim(), 40)
  }
  return ''
}

// KEAD 는 장애인 고용 전문 게시판이라 제목에 장애인 대상이 드러나면('장애인 체험형 인턴', '중증장애인 사무보조', '[장애인채용]') 전용 표현(제한경쟁 등)이 없어도 장애인 대상으로 본다.
// 기관명(장애인자립생활센터 등)·'비장애인'·우대·여러 직종 혼합('포함')은 대상 표시로 보지 않는다.
const ORG_WORD = /장애인[가-힣]{0,12}(센터|복지관|협회|단체|공단|재단|시설|학교|회관|연합|협의회|부모회|직업재활|보호작업장|근로사업장)/g
export const isKeadDisabledTitle = (title) => {
  const t = String(title ?? '').replace(/\s+/g, '').replace(/비장애인/g, '').replace(ORG_WORD, '')
  if (!t.includes('장애인')) return false
  return !/우대|포함/.test(t)
}

// 장애인 전용인지는 제목에 분명한 표현(제한경쟁·전용 등)이 있을 때만 true. 그 밖에는 단정하지 않는다.
export const buildJob = (row, lines, rules) => {
  const s = lines.length ? summarize(lines) : { hires: null, summary: null }
  const listEnd = row.end
  const bodyEnd = lines.length ? bodyEndDate(lines, listEnd) : ''
  const end = bodyEnd || listEnd
  const notes = []
  if (bodyEnd && listEnd && bodyEnd !== listEnd) {
    notes.push(`접수 마감일이 목록(${listEnd})과 본문(${bodyEnd})에서 다릅니다. 본문 기준으로 표시했으니 원문에서 꼭 확인하세요.`)
  } else if (!bodyEnd && lines.length) {
    notes.push('본문에서 접수 마감일을 확인하지 못해 목록의 마감일을 표시했습니다. 원문에서 확인하세요.')
  }
  if (!lines.length) notes.push('본문을 읽지 못해 요약이 없습니다. 원문에서 확인하세요.')
  const disabledOnly = isDisabledOnlyTitle(row.title, rules) || isKeadDisabledTitle(row.title)
  const org = (lines.length && employerOf(lines)) || KEAD_ORG
  return {
    id: `kead-${row.id}`,
    title: row.title,
    org,
    region: row.region,
    hires: s.hires,
    start: row.start,
    end,
    url: viewUrl(row.id),
    disabledOnly,
    orgType: '공공기관',
    source: KEAD_SOURCE,
    sourceLabel: KEAD_SOURCE_LABEL,
    summary: s.summary,
    notes,
  }
}

export const isKead = (j) => j?.source === KEAD_SOURCE

// 이미 있는 공고와 겹치는 KEAD 공고인지: 제목·기관·마감이 같거나, 본문 사업체명이 있어 기관과 마감일이 같다.
export const duplicatesOf = (job, existing) => {
  const tk = `${normOrg(job.org)}|${normTitle(job.title)}|${job.end}`
  const realOrg = job.org !== KEAD_ORG
  return existing.some(
    (e) =>
      `${normOrg(e.org)}|${normTitle(e.title)}|${e.end}` === tk ||
      (realOrg && normOrg(e.org) === normOrg(job.org) && e.end === job.end),
  )
}

// 기존 목록에서 이전 KEAD 분을 빼고 새 KEAD 공고를 합친다. 마감 지난 것·이미 있는 공고와 겹치는 것은 넣지 않는다.
export const mergeKead = (existing, keadJobs, today) => {
  const base = existing.filter((j) => !isKead(j))
  // 장애인 대상이 제목에 명시된 공고만 담는다(명시 없음은 노출하지 않는다).
  const fresh = keadJobs.filter((j) => j.end && j.end >= today && j.disabledOnly === true)
  const dupes = fresh.filter((j) => duplicatesOf(j, base))
  // 사람이 원문을 보고 채운 쉬운 요약(verified, easy)은 매번 새로 만드는 KEAD 공고에도 id 기준으로 옮긴다.
  const prev = new Map(existing.filter((j) => isKead(j) && j.verified === true && j.easy).map((j) => [j.id, j]))
  const add = fresh.filter((j) => !dupes.includes(j)).map((j) => carryVerified(j, prev.get(j.id)))
  const merged = dedupeJobs([...base, ...add]).items.sort((a, b) => (a.end < b.end ? -1 : a.end > b.end ? 1 : 0))
  return { items: merged, added: add.length, duplicates: dupes.map((d) => d.id) }
}
