// 한국사회보장정보원 중앙부처복지서비스(/B554287/NationalWelfareInformationsV001) 응답을 화면용 데이터로 바꾼다.
// 응답은 XML이다. 필요한 태그만 가볍게 읽는 작은 해석기를 쓴다.

const decode = (s) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim()

export const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))
  return m ? decode(m[1]) : ''
}

export const blocks = (xml, name) =>
  [...xml.matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'g'))].map((m) => m[1])

export const parseList = (xml) => ({
  code: tag(xml, 'resultCode'),
  total: Number(tag(xml, 'totalCount') || 0),
  items: blocks(xml, 'servList').map((b) => ({
    id: tag(b, 'servId'),
    title: tag(b, 'servNm'),
    summary: tag(b, 'servDgst'),
    ministry: tag(b, 'jurMnofNm'),
    org: tag(b, 'jurOrgNm'),
    target: tag(b, 'trgterIndvdlArray'),
    theme: tag(b, 'intrsThemaArray'),
    life: tag(b, 'lifeArray'),
    cycle: tag(b, 'sprtCycNm'),
    type: tag(b, 'srvPvsnNm'),
    link: tag(b, 'servDtlLink'),
    registeredAt: tag(b, 'svcfrstRegTs'),
  })),
})

export const toWelfare = (it) => ({
  id: it.id,
  title: it.title,
  summary: it.summary,
  category: it.theme || it.life,
  target: it.target,
  org: it.ministry,
  source: '복지로',
  url: it.link || `https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=${it.id}`,
})

export const serviceKeyParam = (key) => (key.includes('%') ? key : encodeURIComponent(key))

// 검색어는 "장애인", 제목과 내용 모두에서 찾는다(srchKeyCode=003).
export const listUrl = (key, pageNo, numOfRows = 100) =>
  'https://apis.data.go.kr/B554287/NationalWelfareInformationsV001/NationalWelfarelistV001' +
  `?serviceKey=${serviceKeyParam(key)}&callTp=L&pageNo=${pageNo}&numOfRows=${numOfRows}` +
  `&srchKeyCode=003&searchWrd=${encodeURIComponent('장애인')}`

// 최초 수집일(firstSeen) 기록: 이전 목록에 있던 항목은 이전 값을 그대로 이어받고(없으면 비워 둠 → NEW 아님),
// 이전 목록이 있는데 새로 나타난 항목만 오늘 날짜를 찍는다. 이전 목록이 비어 있으면(첫 도입) 아무도 찍지 않는다.
export const stampFirstSeen = (prevItems, items, today) => {
  const prev = new Map((Array.isArray(prevItems) ? prevItems : []).map((p) => [p.id, p]))
  return items.map((it) => {
    const old = prev.get(it.id)
    if (old) return old.firstSeen ? { ...it, firstSeen: old.firstSeen } : it
    return prev.size > 0 ? { ...it, firstSeen: today } : it
  })
}

// 항목별 지원 대상 보정(welfare-target-overrides.json 의 items). 보정 값이 있는 id 만 target 을 바꾼다.
export const applyTargetOverrides = (items, overrides) =>
  items.map((it) => {
    const t = overrides?.[it.id]?.target
    return t ? { ...it, target: t } : it
  })
