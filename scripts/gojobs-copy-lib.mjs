// 나라일터 공고 '아카이브 사본' 만들기(순수 함수). 접수 중 공고의 상세 본문·첨부 목록을 읽어 모두품 정적 페이지로 만든다.
// 나라일터 상세는 GET 주소가 없고 apmView.do 폼 POST 로만 열린다(flag=U, empmnsn=<sn>, searchJobsecode=020). 첨부는 downFile.do POST.
// 원문 전체 복제가 아니라 공고 본문 글과 첨부를 마감일까지만 보관하는 사본이며, 마감 후 자동 삭제한다(gojobs-copy.mjs).

export const SITE = 'https://modupum.kr'
export const COPY_DIR = 'gojobs'
export const GOJOBS_ORIGIN = 'https://www.gojobs.go.kr'
export const MAX_ATTACH_BYTES = 10 * 1024 * 1024 // 공고당 첨부 합계 상한

export const copyUrl = (sn) => `${SITE}/${COPY_DIR}/${sn}/`
export const isCopyUrl = (url, sn) => url === copyUrl(sn)

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" }
export const decodeEntities = (s) =>
  String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    const k = e.toLowerCase()
    if (k.startsWith('#x')) return String.fromCodePoint(parseInt(k.slice(2), 16) || 32)
    if (k.startsWith('#') && /^#\d+$/.test(k)) return k === '#39' ? "'" : String.fromCodePoint(parseInt(k.slice(1), 10) || 32)
    return ENT[k] ?? m
  })

const oneLine = (s) => decodeEntities(String(s ?? '').replace(/<br\s*\/?>/gi, ' / ').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').replace(/(\s\/)+\s*$/, '').trim()

// 본문: 일반 글이거나 편집기가 만든 HTML 이다. 어느 쪽이든 안전한 글(줄바꿈 유지)로 바꾼다. 태그·스크립트는 모두 버린다.
export const bodyToText = (raw) => {
  let s = decodeEntities(String(raw ?? ''))
  if (/<\/?[a-z][^>]*>/i.test(s)) {
    s = s
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|tr|h[1-6]|table|ul|ol)>/gi, '\n')
      .replace(/<\/(td|th)>/gi, '\t')
      .replace(/<li[^>]*>/gi, '· ')
      .replace(/<[^>]*>/g, '')
    s = decodeEntities(s)
  }
  return s
    .replace(/\r/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/[ \t ]+\n/g, '\n')
    .replace(/\t+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// 상세 페이지(apmView.do) → { fields, files, body }
export const parseView = (html) => {
  const tbl = /<table[^>]*id="apmViewTbl"[^>]*>([\s\S]*?)<\/table>/.exec(html)?.[1] ?? ''
  const fields = {}
  for (const tr of tbl.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...tr[1].matchAll(/<(th|td)[^>]*>([\s\S]*?)<\/\1>/g)]
    for (let i = 0; i < cells.length - 1; i += 1) {
      if (cells[i][1] === 'th' && cells[i + 1][1] === 'td') fields[oneLine(cells[i][2])] = oneLine(cells[i + 1][2])
    }
  }
  const files = []
  for (const m of tbl.matchAll(/gfn_fileDown\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*'([^']*)'\s*,\s*'((?:[^'\\]|\\.)*)'\s*\)/g)) {
    files.push({ name: decodeEntities(m[1].replace(/\\'/g, "'")), uuid: m[2], saveGbn: decodeEntities(m[3].replace(/\\'/g, "'")) })
  }
  const bodyRaw = /<textarea[^>]*id="content"[^>]*>([\s\S]*?)<\/textarea>/.exec(tbl)?.[1] ?? ''
  return { fields, files, body: bodyToText(bodyRaw) }
}

export const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const WD = ['일', '월', '화', '수', '목', '금', '토']
export const kstLabel = (ms) => {
  const d = new Date(ms + 9 * 3600 * 1000)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}년 ${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일(${WD[d.getUTCDay()]}) ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
}

export const extOf = (name) => (/\.([A-Za-z0-9]{1,5})$/.exec(String(name))?.[1] ?? 'bin').toLowerCase()
const ORDER = { pdf: 0, hwpx: 1, hwp: 2 }
export const attachOrder = (files) => [...files].sort((a, b) => (ORDER[extOf(a.name)] ?? 9) - (ORDER[extOf(b.name)] ?? 9))
const human = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`)

const CSS = `
:root{color-scheme:light dark;--bg:#fff;--fg:#1a1a1a;--sub:#4a4a4a;--line:#c9c9c9;--card:#f5f7f5;--pt:#0b6b3a;--ptfg:#fff;--warn-bg:#fff7e0;--warn-line:#b7791f}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#121512;--fg:#f2f2f2;--sub:#cfd4cf;--line:#4b524b;--card:#1b201b;--pt:#7ad9a0;--ptfg:#08160d;--warn-bg:#2b2410;--warn-line:#e0b24a}}
*{box-sizing:border-box}
html{font-size:112.5%;-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font-family:"Pretendard","Noto Sans KR","Malgun Gothic",system-ui,sans-serif;line-height:1.75;word-break:keep-all;overflow-wrap:anywhere}
.wrap{max-width:46rem;margin:0 auto;padding:16px 16px 56px}
.skip{position:absolute;left:-999px}.skip:focus{left:8px;top:8px;background:var(--pt);color:var(--ptfg);padding:8px 12px;z-index:9}
.top{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;margin-bottom:8px}
a{color:var(--pt);text-underline-offset:3px}
a:focus-visible,summary:focus-visible{outline:3px solid var(--pt);outline-offset:3px}
.btn{display:inline-flex;align-items:center;min-height:48px;padding:8px 18px;border:2px solid var(--pt);border-radius:10px;font-weight:700;text-decoration:none;background:var(--pt);color:var(--ptfg)}
.btn.ghost{background:transparent;color:var(--pt)}
.notice{background:var(--warn-bg);border:2px solid var(--warn-line);border-radius:10px;padding:12px 14px;margin:12px 0}
.notice p{margin:4px 0}
h1{font-size:1.45rem;line-height:1.4;margin:16px 0 12px}
h2{font-size:1.2rem;margin:28px 0 8px}
dl.meta{display:grid;grid-template-columns:max-content 1fr;gap:6px 14px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px;margin:0}
dl.meta dt{font-weight:700;color:var(--sub)}dl.meta dd{margin:0}
.body{white-space:pre-wrap;border-left:4px solid var(--pt);padding:4px 0 4px 14px;margin:0}
ul.files{list-style:none;padding:0;margin:0;display:grid;gap:10px}
ul.files a{display:block;border:1px solid var(--line);border-radius:10px;padding:12px 14px;background:var(--card);font-weight:700}
ul.files small{display:block;font-weight:400;color:var(--sub)}
footer{margin-top:32px;border-top:1px solid var(--line);padding-top:14px;color:var(--sub);font-size:.9rem}
@media (max-width:480px){dl.meta{grid-template-columns:1fr}dl.meta dt{margin-top:6px}}
@media print{.top,.skip{display:none}}
`

// 사본 페이지(HTML 한 장). files: [{name, href, size}] 실제로 저장된 첨부만.
export const renderCopyHtml = ({ job, view, files, collectedAt, sn }) => {
  const f = view.fields
  const get = (k) => f[k] || ''
  const rows = [
    ['기관', job.org || get('기관명')],
    ['등록일', get('등록일') || job.start],
    ['접수 시작', get('접수시작일') || job.start],
    ['접수 마감', get('접수마감일') || job.end],
    ['채용 직급', get('채용직급')],
    ['근무 지역', get('근무지역')],
    ['장애인 채용·우대', get('장애인 채용 / 우대')],
  ].filter(([, v]) => v)
  const origin = `${GOJOBS_ORIGIN}/`
  const body = view.body ? `<h2 id="body-h">공고 내용</h2>\n<p class="body" aria-labelledby="body-h">${esc(view.body)}</p>` : '<h2>공고 내용</h2>\n<p>본문이 비어 있습니다. 첨부 공고문을 확인해 주세요.</p>'
  const attach = files.length
    ? `<h2>공고문 첨부</h2>
<ul class="files">${files.map((x) => {
        const hwp = /^hwpx?$/.test(extOf(x.name))
        const dl = hwp ? ` download="${esc(x.name)}"` : ' target="_blank" rel="noopener"'
        return `<li><a href="${esc(x.href)}"${dl}>${esc(x.name)}<small>${esc(extOf(x.name).toUpperCase())} · ${human(x.size)}${hwp ? ' · 한글 파일은 휴대폰에서 안 열릴 수 있어요. 위 공고 내용을 먼저 보세요.' : ''}</small></a></li>`
      }).join('')}</ul>`
    : f['첨부파일'] || view.files.length ? '<h2>공고문 첨부</h2>\n<p>첨부 파일은 용량이 커서 이 사본에 담지 못했어요. 나라일터에서 확인해 주세요.</p>' : ''
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(job.title)} (나라일터 공고 사본) - 모두품</title>
<style>${CSS}</style>
</head>
<body>
<a class="skip" href="#main">본문으로 건너뛰기</a>
<div class="wrap">
<div class="top"><a class="btn ghost" href="${SITE}/" >모두품으로 돌아가기</a><a class="btn ghost" href="${origin}" target="_blank" rel="noopener noreferrer">나라일터 열기<span class="sr-only"> (새 창)</span></a></div>
<div class="notice" role="note">
<p><strong>이 페이지는 나라일터 공고의 사본입니다.</strong> 최종 확인은 나라일터에서 해 주세요.</p>
<p>출처: 나라일터(gojobs.go.kr, 인사혁신처). 수집 시각: <time datetime="${new Date(collectedAt).toISOString()}">${kstLabel(collectedAt)}</time> (한국시간). 접수 마감일이 지나면 이 사본은 자동으로 지워집니다.</p>
</div>
<main id="main">
<h1>${esc(job.title)}</h1>
<dl class="meta">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
${body}
${attach}
</main>
<footer>
<p>원 출처: 나라일터 모집공고(일반채용) 공고번호 ${esc(sn)}. 모두품이 이용자 편의를 위해 보관한 사본입니다. 내용이 바뀌었거나 정정 공고가 있을 수 있으니 지원 전에 반드시 나라일터에서 최종 확인하세요.</p>
<p><a href="${SITE}/">모두품 첫 화면</a></p>
</footer>
</div>
<style>.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}</style>
</body>
</html>
`
}

// 정리 대상 판정: manifest = { items: { [sn]: { end } } }. 마감일이 지났거나 manifest 에 없는 폴더는 지운다.
export const expiredSns = (manifest, today) =>
  Object.entries(manifest?.items ?? {})
    .filter(([, v]) => !/^\d{4}-\d{2}-\d{2}$/.test(v?.end ?? '') || v.end < today)
    .map(([sn]) => sn)
