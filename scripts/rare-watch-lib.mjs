// 원문 변경 확인용: HTML 에서 본문 글자만 남긴다. 세션 id·날짜처럼 매번 바뀌는 부분은 지문에서 뺀다.
export function pageText(html) {
  return html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/jsessionid=[^\s"&]+/gi, '')
    .replace(/조회수\s*:?\s*[\d,]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// rare.json 의 원문 링크와 기관 링크를 중복 없이 모은다. 같은 주소의 세션 id 차이는 하나로 본다.
// 기관 첫 화면(공지 목록이 자주 바뀜)과 화면을 스크립트로 그리는 복지로는 내용 대신 열리는지만 본다(openOnly).
export function watchUrls(rare) {
  const seen = new Map()
  const add = (url, label, openOnly = false) => {
    const key = url.replace(/;jsessionid=[^?]*/i, '')
    if (!seen.has(key)) seen.set(key, { url: key, label, openOnly: openOnly || /bokjiro\.go\.kr/.test(key) })
  }
  for (const g of rare.groups ?? []) for (const it of g.items ?? []) for (const l of it.links ?? []) add(l.url, `${it.name}: ${l.label}`)
  for (const i of rare.institutions ?? []) add(i.url, i.name, true)
  return [...seen.values()]
}
