// 공공 API에서 데이터를 받아 public/data/*.json 으로 저장한다.
// API 키는 환경변수 DATA_GO_KR_KEY 로만 받고 코드나 파일에는 쓰지 않는다.
// 키가 없거나 호출이 실패하면 기존 파일을 그대로 두고 끝낸다(빈 데이터로 덮어쓰지 않는다).

import { readFile, writeFile } from 'node:fs/promises'
import { buildJobs, listUrl, rowsOf } from './jobs-lib.mjs'
import { GOJOBS_LIST, parseList, buildGojobs, mergeJobs, toJob } from './gojobs-lib.mjs'
import { makeCopies, readManifest } from './gojobs-copy.mjs'
import { isKead } from './kead-lib.mjs'
import { carryVerified } from './autosum-lib.mjs'
import { loadHolidays, jobCollectDecision, isForced } from './workday-lib.mjs'
import { validateJobs, validateWelfare, isAbnormalDrop } from './validate-lib.mjs'
import { listUrl as welfareListUrl, parseList as parseWelfareList, toWelfare, stampFirstSeen, applyTargetOverrides } from './welfare-lib.mjs'

const key = process.env.DATA_GO_KR_KEY

if (!key) {
  console.log('DATA_GO_KR_KEY 가 없어 수집을 건너뜁니다. 기존 데이터를 그대로 사용합니다.')
  process.exit(0)
}

const rules = JSON.parse(await readFile(new URL('./keywords.json', import.meta.url), 'utf8'))
const kstNow = new Date(Date.now() + 9 * 3600 * 1000)
const today = kstNow.toISOString().slice(0, 10)

// 네트워크 오류나 5xx는 잠시 뒤 다시 시도한다(최대 4번).
const fetchRetry = async (url, options) => {
  let last
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const res = await fetch(url, { ...options, signal: AbortSignal.timeout(30000) })
      if (res.status < 500) return res
      last = new Error(`HTTP ${res.status}`)
    } catch (e) {
      last = e
    }
    if (attempt < 4) await new Promise((r) => setTimeout(r, attempt * 5000))
  }
  throw last
}

const getJson = async (url) => {
  const res = await fetchRetry(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// 나라일터(국가기관·지자체·교육청) 공고: 공고명에 '장애'가 들어간 목록의 앞쪽 쪽만 읽는다.
// 사이트 부담을 줄이려고 요청 사이에 3초씩 쉬고, 실패하면 이 부분만 건너뛴다.
const GOJOBS_PAGES = 20
const GOJOBS_MAX_AGE_DAYS = 45
const GOJOBS_UA = 'modupum-bot (+https://modupum.kr)'

async function collectGojobs() {
  const rows = []
  for (let page = 1; page <= GOJOBS_PAGES; page += 1) {
    const qs = new URLSearchParams({
      menuNo: '401',
      mngrMenuYn: 'N',
      selMenuNo: '400',
      upperMenuNo: '',
      searchJobsecode: '020',
      searchKeyword: '장애',
      pageIndex: String(page),
    })
    const res = await fetchRetry(`${GOJOBS_LIST}?${qs}`, { headers: { 'User-Agent': GOJOBS_UA } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const parsed = parseList(await res.text())
    if (parsed.rows.length === 0) break
    // 쪽 번호가 먹히지 않아 같은 쪽이 다시 오면 멈춘다.
    if (rows.length > 0 && parsed.rows[0].sn === rows[rows.length - parsed.rows.length]?.sn) break
    rows.push(...parsed.rows)
    // 게시일 순이라, 한 쪽 전체가 오래된 공고면 더 읽지 않는다.
    const cutoff = new Date(Date.parse(today) - GOJOBS_MAX_AGE_DAYS * 86400000).toISOString().slice(0, 10)
    if (parsed.rows.every((r) => r.start && r.start < cutoff)) break
    await new Promise((r) => setTimeout(r, 3000))
  }
  if (rows.length === 0) throw new Error('받은 공고가 없습니다')
  // 사본 방식: 접수 중 공고의 상세 본문·첨부를 모두품 저장소에 저장하고, 사본이 실제로 만들어진 공고만 게시한다(사본 주소가 카드 원문 링크).
  // 제목에 장애인 대상이 없는 공고의 판정 대기열 적재는 하지 않는다(대기열 확정 공고는 사본이 없어 게시되지 않기 때문).
  const wanted = buildGojobs(rows, rules, today)
  const { ok, failed } = await makeCopies(fetchRetry, wanted, rows, Date.now())
  console.log(`나라일터 사본: 대상 ${wanted.length}건 중 성공 ${ok.length}건, 실패 ${failed.length}건`)
  if (wanted.length > 0 && failed.length / wanted.length >= 0.3) console.error(`[경고] 나라일터 사본 실패율 높음: ${failed.length}/${wanted.length} (${failed.map((f) => `${f.id} ${f.error}`).join('; ')})`)
  return ok
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
  const apiItems = buildJobs(all, rules, today)
  // 나라일터 공고: 2026-10-28 수집 중단(원문 링크 깨짐) → 2026-10-29 '아카이브 사본' 방식으로 재개. 실패하면 이 부분만 건너뛴다.
  let items = apiItems
  const prevAll = JSON.parse(await readFile(new URL('../public/data/jobs.json', import.meta.url), 'utf8').catch(() => '{}'))
  try {
    const extra = await collectGojobs()
    items = mergeJobs(apiItems, extra)
    console.log(`나라일터: ${extra.length}건 중 새로 추가 ${items.length - apiItems.length}건`)
  } catch (e) {
    console.error(`나라일터 수집 실패(이전에 게시한 나라일터 공고 중 마감 전·사본 있는 것만 이어 둠): ${e.message}`)
    const manifest = await readManifest()
    const keepGo = (Array.isArray(prevAll.items) ? prevAll.items : []).filter((j) => j.source === '나라일터' && j.end >= today && manifest.items?.[j.id.replace(/^gojobs-/, '')])
    items = mergeJobs(apiItems, keepGo)
  }
  // KEAD 공고는 별도 단계(collect-kead.mjs)가 채운다. 여기서 지워지지 않게 이전 분 가운데 마감 전인 것을 이어 둔다.
  const prevJobs = JSON.parse(await readFile(new URL('../public/data/jobs.json', import.meta.url), 'utf8').catch(() => '{}'))
  const keepKead = (Array.isArray(prevJobs.items) ? prevJobs.items : []).filter((j) => isKead(j) && j.end >= today)
  // 사람이 검증한 요약(verified, easy)은 수집 때마다 지워지지 않게 이전 값을 id 기준으로 옮긴다.
  const prevById = new Map((Array.isArray(prevJobs.items) ? prevJobs.items : []).filter((j) => j.verified === true).map((j) => [j.id, j]))
  items = items.map((j) => {
    // urlFixed: 수집 API 의 원문 주소가 잘려 사람이 바로잡은 주소는 그대로 둔다. auto: 자동 요약 내부 표시도 함께 옮긴다.
    return carryVerified(j, prevById.get(j.id))
  })
  items = [...items, ...keepKead].sort((a, b) => (a.end < b.end ? -1 : a.end > b.end ? 1 : 0))
  const out = { sample: false, updatedAt: kstNow.toISOString().slice(0, 16).replace('T', ' '), items }
  await writeFile(new URL('../public/data/jobs.json', import.meta.url), `${JSON.stringify(out, null, 2)}\n`)
  console.log(`일자리: 전체 ${all.length}건 중 ${items.length}건 저장`)
}

let failed = false
// 일자리는 평일(KST)에만 수집한다. 주말·공휴일에는 건너뛰고 기존 jobs.json 을 그대로 둔다(FORCE_COLLECT=1 이면 항상 수집).
// 복지 수집은 이 판정과 무관하게 계속한다.
const decision = jobCollectDecision(today, await loadHolidays(), { force: isForced() })
if (decision.collect) {
  console.log(`일자리 수집: ${today} ${decision.reason}`)
  try {
    await collectJobs()
  } catch (e) {
    failed = true
    console.error(`일자리 수집 실패: ${e.message}`)
  }
} else {
  console.log(`일자리 수집 건너뜀: ${today} ${decision.reason}. 기존 jobs.json 을 유지합니다`)
}

async function collectWelfare() {
  const all = []
  let total = Infinity
  for (let page = 1; all.length < total && page <= 20; page += 1) {
    const res = await fetchRetry(welfareListUrl(key, page))
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const { code, total: t, items } = parseWelfareList(await res.text())
    if (code !== '0' && code !== '') throw new Error(`API 응답 코드 ${code}`)
    total = t
    if (items.length === 0) break
    all.push(...items)
  }
  if (all.length === 0) throw new Error('받은 복지서비스가 없습니다')
  const targetOverrides = JSON.parse(await readFile(new URL('./welfare-target-overrides.json', import.meta.url), 'utf8').catch(() => '{}')).items
  const checked = validateWelfare(applyTargetOverrides(all.map(toWelfare), targetOverrides).filter((i) => i.id && i.title))
  for (const f of checked.fixes) console.log(`[검수:welfare] 자동 정리 - ${f}`)
  if (checked.errors.length) {
    checked.errors.forEach((e) => console.error(`[검수:welfare] 오류 - ${e}`))
    throw new Error(`검수 실패(${checked.errors.length}건): 기존 welfare.json 을 유지합니다`)
  }
  const welfareUrl = new URL('../public/data/welfare.json', import.meta.url)
  const prev = JSON.parse(await readFile(welfareUrl, 'utf8').catch(() => '{}'))
  const prevCount = Array.isArray(prev.items) ? prev.items.length : 0
  const items = stampFirstSeen(prev.items, checked.items, today)
  if (isAbnormalDrop(prevCount, items.length)) {
    console.warn(`[검수:welfare] 경고 - 건수 급감(${prevCount}건 → ${items.length}건). 기존 welfare.json 을 유지합니다`)
    return
  }
  const out = { sample: false, updatedAt: kstNow.toISOString().slice(0, 16).replace('T', ' '), items }
  await writeFile(welfareUrl, `${JSON.stringify(out, null, 2)}\n`)
  console.log(`복지: ${items.length}건 저장`)
}

try {
  await collectWelfare()
} catch (e) {
  failed = true
  console.error(`복지 수집 실패: ${e.message}`)
}

if (failed) process.exit(1)
