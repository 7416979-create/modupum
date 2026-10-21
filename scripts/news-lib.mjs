// 보건복지부 보도자료 RSS에서 장애 관련 정책 소식만 골라 news.json 형태로 만든다.
export const NEWS_RSS = 'https://www.mohw.go.kr/rss/board.es?mid=a10503000000&bid=0027'
export const NEWS_KEYWORDS = ['장애', '활동지원', '발달', '희귀질환', '보조기기', '재활', '바우처', '개인예산']
export const NEWS_SOURCE = '보건복지부 보도자료'
// 수집 출처 목록(추가 시 여기에 한 줄). id 는 출처별 접두+글 번호, 링크는 정규화한 원문 주소.
export const SOURCES = [
  { name: NEWS_SOURCE, rss: NEWS_RSS, prefix: 'mohw', idRe: /list_no=(d+)/, link: (no) => `https://www.mohw.go.kr/board.es?mid=a10503000000&bid=0027&act=view&list_no=${no}` },
  { name: '고용노동부 정책자료', rss: 'https://www.moel.go.kr/rss/policy.do', prefix: 'moel-policy', idRe: /bbs_seq=(d+)/, link: (no) => `https://www.moel.go.kr/policy/policydata/view.do?bbs_seq=${no}` },
  { name: '고용노동부 공지', rss: 'https://www.moel.go.kr/rss/notice.do', prefix: 'moel-notice', idRe: /bbs_seq=(d+)/, link: (no) => `https://www.moel.go.kr/news/notice/noticeView.do?bbs_seq=${no}` },
]
export const MAX_NEWS = 200

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', rarr: '→', hellip: '…' }
const decode = (s) =>
  s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m)
const field = (block, tag) => {
  const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))
  if (!m) return ''
  return decode(m[1].replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '')).replace(/\s+/g, ' ').trim()
}

export const parseRss = (xml, src = SOURCES[0]) =>
  String(xml).split('<item>').slice(1).map((b) => {
    const no = field(b, 'link').match(src.idRe)?.[1]
    // 복지부는 pubDate(GMT), 고용노동부는 dc:date(한국시간 'YYYY-MM-DD HH:MM:SS')
    const dc = field(b, 'dc:date').slice(0, 10)
    const t = Date.parse(field(b, 'pubDate'))
    return {
      id: no ? `${src.prefix}-${no}` : '',
      title: field(b, 'title'),
      desc: field(b, 'description'),
      url: no ? src.link(no) : '',
      source: src.name,
      date: /^d{4}-d{2}-d{2}$/.test(dc) ? dc : Number.isNaN(t) ? '' : new Date(t + 9 * 3600000).toISOString().slice(0, 10),
    }
  })

// 제목에 키워드가 있거나, 본문 앞부분(300자)에 '장애'가 있으면 관련 소식으로 본다.
export const isRelevant = (r) => NEWS_KEYWORDS.some((k) => r.title.includes(k)) || r.desc.slice(0, 300).includes('장애')

// 원문 전재를 피하려고 첫 문장만 140자 안으로 줄인다. 적절한 문장이 없으면 제목을 쓴다.
export const shortSummary = (r) => {
  const at = r.desc.indexOf('보건복지부(')
  const body = at >= 0 ? r.desc.slice(at) : ''
  const s = (body.match(/^.{20,}?다\.(?=\s|$)/)?.[0] || '').replace(/\s+/g, ' ').trim()
  if (!s) return r.title
  return s.length > 140 ? `${s.slice(0, 139)}…` : s
}

export const toNews = (r) => ({ id: r.id, title: r.title, summary: shortSummary(r), source: r.source || NEWS_SOURCE, date: r.date, url: r.url })

// 기존 목록과 합친다: id·원문 URL 중복 제거, 최신순, 상한.
export const mergeNews = (prev, fresh) => {
  const seen = new Set()
  const out = []
  for (const n of [...prev, ...fresh]) {
    if (!n?.id || seen.has(n.id) || seen.has(n.url)) continue
    seen.add(n.id)
    seen.add(n.url)
    out.push(n)
  }
  return out.sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, MAX_NEWS)
}

export const validateNews = (items) => {
  const errors = []
  const ymd = /^\d{4}-\d{2}-\d{2}$/
  for (const n of items) {
    if (!n.id || !n.title || !ymd.test(n.date) || !/^https:\/\/www\.mohw\.go\.kr\//.test(n.url)) errors.push(`형식 오류: ${n.id || n.title}`)
  }
  return errors
}
