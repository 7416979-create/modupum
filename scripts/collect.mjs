// 공공 API에서 데이터를 받아 public/data/*.json 으로 저장한다.
// API 키는 환경변수 DATA_GO_KR_KEY 로만 받고 코드나 파일에는 쓰지 않는다.
// 키가 없거나 호출이 실패하면 기존 파일을 그대로 두고 끝낸다(빈 데이터로 덮어쓰지 않는다).

import { readFile, writeFile } from 'node:fs/promises'
import { buildJobs, listUrl, rowsOf } from './jobs-lib.mjs'
import { listUrl as welfareListUrl, parseList as parseWelfareList, toWelfare } from './welfare-lib.mjs'

const key = process.env.DATA_GO_KR_KEY

if (!key) {
  console.log('DATA_GO_KR_KEY 가 없어 수집을 건너뜁니다. 기존 데이터를 그대로 사용합니다.')
  process.exit(0)
}

const rules = JSON.parse(await readFile(new URL('./keywords.json', import.meta.url), 'utf8'))
const kstNow = new Date(Date.now() + 9 * 3600 * 1000)
const today = kstNow.toISOString().slice(0, 10)

const getJson = async (url) => {
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function collectJobs() {
  const all = []
  let total = Infinity
  for (let page = 1; all.length < total && page <= 30; page += 1) {
    const json = await getJson(listUrl(key, page))
    const code = Number(json?.resultCode ?? 0)
    if (code !== 0 && code !== 200) throw new Error(`API 응답 코드 ${code}`)
    total = Number(json?.totalCount ?? 0)
    const rows = rowsOf(json)
    if (rows.length === 0) break
    all.push(...rows)
  }
  if (all.length === 0) throw new Error('받은 공고가 없습니다')
  const items = buildJobs(all, rules, today)
  const out = { sample: false, updatedAt: kstNow.toISOString().slice(0, 16).replace('T', ' '), items }
  await writeFile(new URL('../public/data/jobs.json', import.meta.url), `${JSON.stringify(out, null, 2)}\n`)
  console.log(`일자리: 전체 ${all.length}건 중 ${items.length}건 저장`)
}

let failed = false
try {
  await collectJobs()
} catch (e) {
  failed = true
  console.error(`일자리 수집 실패: ${e.message}`)
}

async function collectWelfare() {
  const all = []
  let total = Infinity
  for (let page = 1; all.length < total && page <= 20; page += 1) {
    const res = await fetch(welfareListUrl(key, page))
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const { code, total: t, items } = parseWelfareList(await res.text())
    if (code !== '0' && code !== '') throw new Error(`API 응답 코드 ${code}`)
    total = t
    if (items.length === 0) break
    all.push(...items)
  }
  if (all.length === 0) throw new Error('받은 복지서비스가 없습니다')
  const items = all.map(toWelfare).filter((i) => i.id && i.title)
  const out = { sample: false, updatedAt: kstNow.toISOString().slice(0, 16).replace('T', ' '), items }
  await writeFile(new URL('../public/data/welfare.json', import.meta.url), `${JSON.stringify(out, null, 2)}\n`)
  console.log(`복지: ${items.length}건 저장`)
}

try {
  await collectWelfare()
} catch (e) {
  failed = true
  console.error(`복지 수집 실패: ${e.message}`)
}

if (failed) process.exit(1)
