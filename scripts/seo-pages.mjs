// 검색엔진용 정적 페이지: 앱은 #/ 주소라 공고·지역 화면이 검색에 잡히지 않는다.
// vite build 뒤에 dist/chaeyong/ 아래에 공고 모음·지역별·공고별 HTML 과 sitemap.xml 을 만든다(공고 내용은 jobs.json 그대로).
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'

const SITE = 'https://modupum.kr'
const DIST = new URL('../dist/', import.meta.url)
const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)

// App.jsx 의 REGIONS·regionsOf 와 같은 기준(바꾸면 둘 다 바꾼다)
export const REGIONS = [
  ['seoul-gyeonggi', '서울·경기', /서울|인천|경기/],
  ['gangwon', '강원', /강원/],
  ['chungbuk', '충북', /충북|충청북/],
  ['chungnam-daejeon', '충남·대전', /충남|충청남|대전|세종/],
  ['jeonbuk', '전북', /전북|전라북/],
  ['jeonnam-gwangju', '전남·광주', /전남|전라남|광주/],
  ['gyeongbuk-daegu', '경북·대구', /경북|경상북|대구/],
  ['gyeongnam-busan-ulsan', '경남·부산·울산', /경남|경상남|부산|울산/],
  ['jeju', '제주', /제주/],
]
export const regionsOf = (i) => {
  const src = [i.region, i.easy?.어디서, i.org].find((s) => s && REGIONS.some(([, , re]) => re.test(s))) || ''
  const txt = src.replace(/경기도?\s*광주/g, '경기')
  return REGIONS.filter(([, , re]) => re.test(txt)).map(([slug]) => slug)
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const DOW = '일월화수목금토'
export const md = (iso) => {
  const [y, m, d] = iso.split('-').map(Number)
  return `${m}/${d}(${DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]})`
}
const one = (v) => (Array.isArray(v) ? v.join(' ') : v || '')
const role = (j) => (j.verified === true && j.easy?.무슨일고용) || ''

const page = ({ path, title, desc, body }) => `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${SITE}${path}"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${SITE}${path}"><meta property="og:site_name" content="모두품">
<style>
body{margin:0;font-family:-apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif;color:#1d1d1f;background:#fff;line-height:1.65}
main{max-width:720px;margin:0 auto;padding:24px 16px 48px}
a{color:#006b35}header a{font-weight:700;text-decoration:none;font-size:1.1rem}
h1{font-size:1.5rem;line-height:1.35;margin:20px 0 8px}h2{font-size:1.1rem;margin:28px 0 8px}
.sub{color:#555;margin:0 0 16px}ul{padding:0;list-style:none}li{border-top:1px solid #e5e5e5;padding:12px 0}
.d{color:#006b35;font-weight:600}.m{color:#555;font-size:.95rem}dl{margin:0}dt{font-weight:600;margin-top:12px}dd{margin:2px 0 0}
.go{display:inline-block;margin-top:20px;padding:12px 18px;background:#008542;color:#fff;border-radius:10px;text-decoration:none;font-weight:600}
nav a{display:inline-block;margin:0 10px 8px 0}footer{color:#777;font-size:.85rem;margin-top:40px}
</style></head><body><main>
<header><a href="${SITE}/">모두품</a></header>
${body}
<footer>공공기관 채용정보(공공데이터포털)와 한국장애인고용공단 공고를 바탕으로 하루 세 번 새로 모읍니다. 지원 전에 반드시 원문 공고를 확인하세요. 모두품은 지원서를 받거나 채용을 알선하지 않습니다. (${today} 기준)</footer>
</main></body></html>
`

const item = (j) => `<li><a href="/chaeyong/job/${encodeURIComponent(j.id)}/"><strong>${esc(j.title)}</strong></a>
<div class="m"><span class="d">${md(j.end)} 마감</span> · ${esc(j.org)}${j.hires ? ` · ${esc(j.hires)}명` : ''}${role(j) ? ` · ${esc(role(j))}` : ''}${j.mixed ? ' · 일부 분야만 장애인 대상' : ''}</div></li>`

const regionNav = (counts) =>
  `<nav>${REGIONS.filter(([slug]) => counts[slug]).map(([slug, name]) => `<a href="/chaeyong/${slug}/">${esc(name)} ${counts[slug]}건</a>`).join('')}</nav>`

const write = async (path, html) => {
  const dir = new URL(`.${path}`, DIST)
  await mkdir(dir, { recursive: true })
  await writeFile(new URL('index.html', dir), html)
}

export const build = async () => {
  const data = JSON.parse(await readFile(new URL('data/jobs.json', DIST), 'utf8'))
  const jobs = (data.items || []).filter((j) => j.end >= today).sort((a, b) => (a.end < b.end ? -1 : a.end > b.end ? 1 : 0))
  const counts = {}
  for (const j of jobs) for (const r of regionsOf(j)) counts[r] = (counts[r] || 0) + 1
  const urls = ['/', '/chaeyong/']

  await write('/chaeyong/', page({
    path: '/chaeyong/',
    title: `장애인 채용공고 ${jobs.length}건 모음 (공공기관·공무직) | 모두품`,
    desc: `지금 접수 중인 공공기관 장애인 제한경쟁·구분모집 채용공고 ${jobs.length}건을 마감 순서로 모았습니다. 지역별로 볼 수 있습니다.`,
    body: `<h1>장애인 채용공고 ${jobs.length}건</h1><p class="sub">공공기관에서 장애인만 지원할 수 있는 공고(제한경쟁·구분모집)를 마감 순서로 모았습니다.</p>
${regionNav(counts)}<ul>${jobs.map(item).join('\n')}</ul><a class="go" href="/#/jobs">모두품에서 쉬운 요약으로 보기</a>`,
  }))

  for (const [slug, name] of REGIONS) {
    const list = jobs.filter((j) => regionsOf(j).includes(slug))
    if (!list.length) continue
    const path = `/chaeyong/${slug}/`
    urls.push(path)
    await write(path, page({
      path,
      title: `${name} 장애인 채용공고 ${list.length}건 | 모두품`,
      desc: `${name} 지역 공공기관 장애인 제한경쟁·구분모집 채용공고 ${list.length}건(마감 순).`,
      body: `<h1>${esc(name)} 장애인 채용공고 ${list.length}건</h1><p class="sub">${esc(name)} 지역에서 지금 접수 중인 공공기관 장애인 채용공고입니다.</p>
${regionNav(counts)}<ul>${list.map(item).join('\n')}</ul><a class="go" href="/#/jobs">모두품에서 쉬운 요약으로 보기</a>`,
    }))
  }

  for (const j of jobs) {
    const path = `/chaeyong/job/${encodeURIComponent(j.id)}/`
    urls.push(path)
    const e = j.verified === true ? j.easy || {} : {}
    const rows = ['무슨일고용', '어디서', '누가', '몇명', '무슨일', '일하는시간', '급여', '접수', '문의']
      .filter((k) => one(e[k]))
      .map((k) => `<dt>${{ 무슨일고용: '일 · 고용 형태', 어디서: '근무지', 누가: '지원 자격', 몇명: '뽑는 인원', 무슨일: '하는 일', 일하는시간: '근무 시간', 급여: '급여', 접수: '접수 방법', 문의: '문의' }[k]}</dt><dd>${esc(one(e[k]))}</dd>`)
    await write(path, page({
      path,
      title: `${j.org} 장애인 채용 (${md(j.end)} 마감) | 모두품`,
      desc: `${j.title}. ${md(j.end)} 마감${j.hires ? `, ${j.hires}명` : ''}. ${one(e.무슨일).slice(0, 80)}`,
      body: `<h1>${esc(j.title)}</h1><p class="sub"><span class="d">${md(j.end)} 마감</span> · ${esc(j.org)}${j.region ? ` · ${esc(j.region)}` : ''}${j.mixed ? ' · 일부 모집 분야만 장애인 대상' : ''}</p>
${rows.length ? `<dl>${rows.join('')}</dl>` : '<p>자세한 조건은 원문 공고에서 확인해 주세요.</p>'}
<p><a href="${esc(j.url)}" rel="nofollow noopener">원문 공고 보기</a></p>
<a class="go" href="/#/jobs/${encodeURIComponent(j.id)}">모두품에서 보기</a>`,
    }))
  }

  // 나라일터 사본 페이지도 검색에 넣는다
  try {
    for (const sn of await readdir(new URL('gojobs/', DIST))) if (/^\d+$/.test(sn)) urls.push(`/gojobs/${sn}/`)
  } catch {}

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${SITE}${u}</loc><lastmod>${today}</lastmod></url>`).join('\n')}\n</urlset>\n`
  await writeFile(new URL('sitemap.xml', DIST), xml)
  return { jobs: jobs.length, regions: Object.keys(counts).length, urls: urls.length }
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('seo-pages.mjs')) {
  console.log(await build())
}
