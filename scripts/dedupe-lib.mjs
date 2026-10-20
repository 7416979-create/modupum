// 일자리 공고 중복 판정·제거. 공공데이터 API 와 나라일터(gojobs) 수집분을 합칠 때와 검수 단계에서 같이 쓴다.
// 판정 기준(둘 중 하나라도 같으면 같은 공고):
//  1) 정규화한 기관명 + 정규화한 제목 + 마감일이 같다.
//  2) 원문 URL 이 같고(홈페이지 첫 화면처럼 공고마다 같은 주소는 제외), 같은 기관·같은 마감일이다.

const keepChars = (s) => String(s ?? '').toLowerCase().replace(/[^0-9a-z가-힣]/g, '')

// 제목: 공백·괄호 기호·특수문자를 지우고, 의미 없는 말('채용공고' 등)을 뺀다.
const NOISE = ['채용공고', '모집공고', '채용안내', '채용', '모집', '공고', '안내']
export const normTitle = (s) => {
  let t = keepChars(s)
  for (const w of NOISE) t = t.split(w).join('')
  return t
}
export const normOrg = (s) => keepChars(s)

// 공고마다 다른 주소인지(경로·쿼리가 있는지). 'https://site.kr' 또는 'https://site.kr/' 는 일반 주소로 본다.
export const specificUrl = (u) => {
  try {
    const x = new URL(String(u ?? ''))
    return (x.pathname.replace(/\/+$/, '') !== '' || x.search !== '') && x.hostname !== ''
  } catch {
    return false
  }
}

export const titleKey = (j) => `${normOrg(j.org)}|${normTitle(j.title)}|${j.end ?? ''}`
export const urlKey = (j) => (specificUrl(j.url) ? `${String(j.url).trim()}|${normOrg(j.org)}|${j.end ?? ''}` : '')

// 둘 중 남길 쪽: 공공데이터 API(source 없음) 우선 > 채워진 정보가 많은 쪽 > 먼저 있던 쪽.
const filled = (j) => ['region', 'hires', 'start', 'url', 'orgType'].filter((k) => j[k] !== '' && j[k] != null).length
export const better = (a, b) => {
  const aApi = !a.source
  const bApi = !b.source
  if (aApi !== bApi) return aApi ? a : b
  return filled(b) > filled(a) ? b : a
}

// 중복을 없앤 목록과, 지워진 항목(어느 것 때문에 지워졌는지 포함)을 돌려준다. 입력 순서는 유지한다.
export const dedupeJobs = (items) => {
  const kept = []
  const byTitle = new Map()
  const byUrl = new Map()
  const removed = []
  for (const j of items) {
    const tk = titleKey(j)
    const uk = urlKey(j)
    const hitIdx = byTitle.has(tk) ? byTitle.get(tk) : uk && byUrl.has(uk) ? byUrl.get(uk) : -1
    if (hitIdx < 0) {
      byTitle.set(tk, kept.length)
      if (uk) byUrl.set(uk, kept.length)
      kept.push(j)
      continue
    }
    const cur = kept[hitIdx]
    const win = better(cur, j)
    removed.push({ removed: win === cur ? j : cur, keptId: win.id })
    kept[hitIdx] = win
    byTitle.set(tk, hitIdx)
    if (uk) byUrl.set(uk, hitIdx)
  }
  return { items: kept, removed }
}
