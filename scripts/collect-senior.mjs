// 노인복지 '수집만' 시험. 사이트·기존 데이터(public/data)는 건드리지 않고 senior-result/ 에만 쓴다.
// 키는 환경변수 DATA_GO_KR_KEY 로만 받는다.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { parseList, serviceKeyParam, toWelfare } from './welfare-lib.mjs'

const key = process.env.DATA_GO_KR_KEY
if (!key) {
  console.error('DATA_GO_KR_KEY 가 없습니다.')
  process.exit(1)
}

const TERMS = ['노인', '어르신', '기초연금', '노인일자리']
const url = (word, pageNo) =>
  'https://apis.data.go.kr/B554287/NationalWelfareInformationsV001/NationalWelfarelistV001' +
  `?serviceKey=${serviceKeyParam(key)}&callTp=L&pageNo=${pageNo}&numOfRows=100` +
  `&srchKeyCode=003&searchWrd=${encodeURIComponent(word)}`

const fetchRetry = async (u) => {
  let last
  for (let a = 1; a <= 4; a += 1) {
    try {
      const res = await fetch(u, { signal: AbortSignal.timeout(30000) })
      if (res.status < 500) return res
      last = new Error(`HTTP ${res.status}`)
    } catch (e) {
      last = e
    }
    if (a < 4) await new Promise((r) => setTimeout(r, a * 5000))
  }
  throw last
}

const byTerm = {}
const map = new Map()
for (const word of TERMS) {
  let total = Infinity
  const ids = new Set()
  for (let page = 1; ids.size < total && page <= 30; page += 1) {
    const res = await fetchRetry(url(word, page))
    if (!res.ok) throw new Error(`HTTP ${res.status} (${word})`)
    const { code, total: t, items } = parseList(await res.text())
    if (code && code !== '0' && code !== '00') throw new Error(`resultCode ${code} (${word})`)
    total = t
    if (items.length === 0) break
    for (const it of items) {
      ids.add(it.id)
      if (!map.has(it.id)) map.set(it.id, { ...toWelfare(it), cycle: it.cycle, type: it.type, terms: [] })
      map.get(it.id).terms.push(word)
    }
  }
  byTerm[word] = { reported: total === Infinity ? 0 : total, got: ids.size }
}

const items = [...map.values()]
const old = JSON.parse(await readFile(new URL('../public/data/welfare.json', import.meta.url), 'utf8').catch(() => '{}'))
const oldIds = new Set((old.items || []).map((i) => i.id))
const dup = items.filter((i) => oldIds.has(i.id)).length
const pct = (n) => (items.length ? `${((n / items.length) * 100).toFixed(1)}%` : '0%')
const fill = (f) => items.filter(f).length

const lines = [
  `총 건수: ${items.length} (id 중복 제거 후)`,
  '검색어별 건수(API 보고/수집): ' + TERMS.map((w) => `${w} ${byTerm[w].reported}/${byTerm[w].got}`).join(', '),
  `welfare.json(${oldIds.size}건)과 id 중복: ${dup}건 (${pct(dup)}), 신규 ${items.length - dup}건`,
  `채움 비율 - 제목 ${pct(fill((i) => i.title))}, 요약 ${pct(fill((i) => i.summary))}, 대상 ${pct(fill((i) => i.target))}, ` +
    `신청방법 ${pct(fill((i) => i.applyMethod))}(목록 API 미제공), 문의처 ${pct(fill((i) => i.contact))}(목록 API 미제공)`,
  '샘플 제목 5개: ' + items.slice(0, 5).map((i) => i.title).join(' / '),
]
await mkdir('senior-result', { recursive: true })
await writeFile('senior-result/senior.json', JSON.stringify({ collectedAt: new Date().toISOString(), items }, null, 2))
await writeFile('senior-result/summary.txt', lines.join('\n') + '\n')
console.log(lines.join('\n'))
