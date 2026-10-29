// 일일 점검: 사이트 응답, 자동 수집 커밋, 데이터 JSON, 검수 스크립트, 라이브 대조, 소식 최신 글.
// 결과를 logs/daily-check.md 에 추가하고(날짜별 한 줄 + 이상 시 상세), 이상이면 종료 코드 1.
// 환경: DAILY_CHECK_SITE(기본 https://modupum.kr), DAILY_CHECK_NO_WRITE=1 이면 로그 파일을 쓰지 않는다.
// 비밀값은 사용하지 않는다. 사이트를 고치지 않고 보고만 한다.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { loadHolidays, jobCollectDecision } from './workday-lib.mjs'
import { expiredCount } from './validate-lib.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SITE = (process.env.DAILY_CHECK_SITE || 'https://modupum.kr').replace(/\/$/, '')
const STALE_HOURS = 8 // 하루 5회 수집 기준, 이 시간 이상 자동 갱신 커밋이 없으면 이상
const DROP_RATIO = 0.3 // 직전 기록 대비 30% 이상 급감하면 이상
const LOG = path.join(root, 'logs', 'daily-check.md')

const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
const issues = [] // 이상(실패 처리)
const notes = [] // 참고(실패 아님)
const evidence = []

const parseKst = (s) => {
  if (!s) return NaN
  const m = String(s).match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?/)
  return m ? Date.parse(`${m[1]}T${m[2] || '00:00'}:00+09:00`) : NaN
}
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const fetchText = async (url) => {
  const t0 = Date.now()
  const res = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { 'user-agent': 'modupum-daily-check' } })
  return { status: res.status, ms: Date.now() - t0, text: await res.text() }
}

// 1) 사이트 응답
try {
  const r = await fetchText(`${SITE}/`)
  evidence.push(`사이트 ${r.status} (${r.ms}ms)`)
  if (r.status !== 200) issues.push(`사이트 응답 ${r.status} (200 아님)`)
} catch (e) {
  issues.push(`사이트 응답 실패: ${e.message}`)
}

// 2) 자동 수집 커밋 (로컬 저장소의 현재 이력 기준)
try {
  const out = git('log', '--grep=^data: auto update', '-1', '--format=%h %cI')
  if (!out) {
    issues.push("'data: auto update' 커밋을 찾지 못함(이력이 얕거나 수집이 멈춤)")
  } else {
    const [hash, iso] = out.split(' ')
    const hours = (Date.now() - Date.parse(iso)) / 3600000
    evidence.push(`최근 수집 커밋 ${hash} ${hours.toFixed(1)}시간 전`)
    // 주말·공휴일에는 일자리 수집을 쉬므로 오래된 수집 커밋만으로는 이상으로 보지 않는다(복지·소식 변화가 없으면 커밋도 없다).
    const dayOff = !jobCollectDecision(today, await loadHolidays()).collect
    if (hours >= STALE_HOURS && dayOff) notes.push(`일자리 수집 휴무일(주말·공휴일)이라 수집 커밋 ${hours.toFixed(1)}시간 경과는 이상으로 보지 않음`)
    else if (hours >= STALE_HOURS) issues.push(`자동 수집 커밋이 ${hours.toFixed(1)}시간째 없음(기준 ${STALE_HOURS}시간): ${hash} ${iso}`)
  }
} catch (e) {
  issues.push(`커밋 이력 확인 실패: ${e.message.split('\n')[0]}`)
}

// 3) 데이터 JSON
const counts = {}
const data = {}
for (const name of ['jobs', 'welfare', 'news']) {
  try {
    const d = JSON.parse(await readFile(path.join(root, 'public/data', `${name}.json`), 'utf8'))
    data[name] = d
    const items = Array.isArray(d.items) ? d.items : []
    counts[name] = items.length
    const dupBy = (fn) => items.length - new Set(items.map(fn)).size
    const dupId = dupBy((i) => i.id)
    // 일자리는 기관 대표 링크를 공유할 수 있으므로 제목+링크 조합으로 중복을 본다
    const dupUrl = dupBy((i) => (name === 'jobs' ? `${i.title}|${i.url}` : i.url))
    evidence.push(`${name} ${items.length}건 updatedAt=${d.updatedAt} 중복 id${dupId}/링크${dupUrl}`)
    if (!items.length) issues.push(`${name}.json 건수 0`)
    if (d.sample) issues.push(`${name}.json sample 플래그 true(샘플 데이터 노출)`)
    if (dupId) issues.push(`${name}.json id 중복 ${dupId}건`)
    if (dupUrl) issues.push(`${name}.json 링크 중복 ${dupUrl}건`)
    if (!d.updatedAt) issues.push(`${name}.json updatedAt 없음`)
    if (name === 'jobs') {
      // 마감 전인데 쉬운 요약(easy)이 없는 공고는 화면에 빈칸이 생긴다. 원문 확인 후 채워야 한다.
      const blank = items.filter((i) => i.end >= today && !(i.verified === true && i.easy)).map((i) => i.id)
      if (blank.length) issues.push(`jobs.json 쉬운 요약 없는 공고 ${blank.length}건: ${blank.join(', ')} (원문 확인 후 easy 채우기)`)
      // 요약 자동 채우기(autosum, PC 작업) 기록: 어제까지의 성공/실패, 확인 필요 목록, 자동 요약 건수를 참고로 남긴다(2주 관찰: ~2026-11-12).
      try {
        const stats = JSON.parse(await readFile(path.join(root, 'logs/autosum-stats.json'), 'utf8').catch(() => '{}'))
        const review = JSON.parse(await readFile(path.join(root, 'logs/autosum-review.json'), 'utf8').catch(() => '[]'))
        const days = Object.keys(stats).sort()
        const sum = days.reduce((a, d) => ({ ok: a.ok + stats[d].ok, fail: a.fail + stats[d].fail }), { ok: 0, fail: 0 })
        const last = days.length ? stats[days[days.length - 1]] : null
        const autoLive = items.filter((i) => i.auto).length
        notes.push(`자동요약 누적 성공${sum.ok}·실패${sum.fail}${last ? ` (최근 ${days[days.length - 1]} 성공${last.ok}·실패${last.fail})` : ' (아직 실행 기록 없음)'}, 자동 요약 공개 ${autoLive}건, 확인 필요 ${review.length}건${review.length ? `: ${review.map((r) => `${r.id}(${r.org}, ${String(r.reasons?.[0] ?? '').slice(0, 40)})`).join('; ')}` : ''}`)
        evidence.push(`autosum 실행일 ${days.length}일`)
      } catch (e) {
        notes.push(`자동요약 기록 읽기 실패: ${e.message}`)
      }
    }
  } catch (e) {
    counts[name] = 0
    issues.push(`${name}.json 읽기 실패: ${e.message}`)
  }
}

// 직전 기록 대비 급감
let prev = null
let prevDate = null
if (existsSync(LOG)) {
  const lines = (await readFile(LOG, 'utf8')).split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(/^(\d{4}-\d{2}-\d{2}) \| .*\| 일자리(\d+)·복지(\d+)·소식(\d+)건/)
    if (m && m[1] !== today) { prev = { jobs: +m[2], welfare: +m[3], news: +m[4] }; prevDate = m[1]; break }
  }
}
// 일자리는 마감일이 지나 자연히 빠진 공고(만료)를 감소로 치지 않는다: 직전 점검 시점(10:00 KST)의 jobs.json 에서 end < 오늘 인 건수를 뺀 값을 기준으로 삼는다.
// 이력을 못 읽으면 보정 없이 기존 방식(직전 건수 대비)으로 판정한다.
let expired = 0
if (prev && prevDate) {
  try {
    const h = git('log', '-1', '--format=%H', `--before=${prevDate}T10:00:00+09:00`, '--', 'public/data/jobs.json')
    if (h) expired = expiredCount(JSON.parse(git('show', `${h}:public/data/jobs.json`)).items, today)
  } catch { expired = 0 }
}
// 의도한 수집 중단·출처 제거 커밋(제목에 '수집 중단' 또는 '[baseline]')이 직전 점검 이후 data 를 바꿨으면 급감을 이상으로 치지 않는다(10-29 오탐 재발 방지).
let intentionalReset = ''
if (prev && prevDate) {
  try {
    const out = git('log', `--since=${prevDate}T10:00:00+09:00`, '--format=%h %s', '-i', '-E', '--grep=수집 중단|[[]baseline[]]', '--', 'public/data') || ''
    intentionalReset = out.split(String.fromCharCode(10))[0] || ''
  } catch { intentionalReset = '' }
}

if (prev) {
  for (const k of ['jobs', 'welfare', 'news']) {
    const base = k === 'jobs' ? Math.max(prev[k] - expired, 0) : prev[k]
    if (k === 'jobs' && expired > 0 && counts[k] < prev[k]) notes.push(`jobs 감소 ${prev[k]} → ${counts[k]} 중 마감 만료 ${expired}건 감안(기준 ${base})`)
    if (base > 0 && counts[k] < base * (1 - DROP_RATIO) && intentionalReset) { notes.push(`${k} 건수 감소 ${prev[k]} → ${counts[k]}: 의도한 변경 커밋 감안(${intentionalReset})`); continue }
    if (base > 0 && counts[k] < base * (1 - DROP_RATIO)) issues.push(`${k} 건수 급감: ${prev[k]} → ${counts[k]}${k === 'jobs' && expired ? ` (마감 만료 ${expired}건 제외 기준 ${base})` : ''}`)
  }
}

// 3-1) 나라일터 사본(아카이브): 카드 원문 링크가 가리키는 사본이 저장소에 있고 라이브에서 열리는지, 사본 수집 실패율이 높지 않은지 본다.
// 나라일터 공고가 늘어나는 것은 정상(10-29 수집 재개)이라 건수 증가는 이상으로 치지 않는다.
{
  const go = (data.jobs?.items || []).filter((j) => j.source === '나라일터')
  evidence.push(`나라일터 공고 ${go.length}건`)
  let manifest = {}
  try { manifest = JSON.parse(await readFile(path.join(root, 'public/gojobs/manifest.json'), 'utf8')) } catch { manifest = {} }
  const lr = manifest.lastRun
  if (lr && lr.attempted > 0 && lr.failed / lr.attempted >= 0.3) issues.push(`나라일터 사본 실패율 높음: ${lr.failed}/${lr.attempted} (${(lr.errors || []).slice(0, 3).join('; ')})`)
  else if (lr) notes.push(`나라일터 사본 최근 수집 실패 ${lr.failed}/${lr.attempted}`)
  const missing = go.filter((j) => !existsSync(path.join(root, 'public/gojobs', String(j.id).replace(/^gojobs-/, ''), 'index.html')))
  if (missing.length) issues.push(`나라일터 사본 파일 없음 ${missing.length}건: ${missing.slice(0, 3).map((j) => j.id).join(', ')}`)
  const stale = Object.entries(manifest.items || {}).filter(([, v]) => v.end < today)
  if (stale.length) issues.push(`마감 지난 나라일터 사본이 남아 있음 ${stale.length}건: ${stale.slice(0, 3).map(([k]) => k).join(', ')}`)
  for (const j of go.slice(0, 3)) {
    try {
      const r = await fetchText(`${j.url}?t=${Date.now()}`)
      if (r.status !== 200) notes.push(`라이브 사본 응답 ${r.status}: ${j.id}`)
    } catch (e) { notes.push(`라이브 사본 확인 실패: ${j.id} ${e.message}`) }
  }
}

// 4) 검수 스크립트 (--fix 없이 읽기 전용)
{
  const r = spawnSync(process.execPath, ['scripts/validate-jobs.mjs'], { cwd: root, encoding: 'utf8' })
  const tail = `${r.stdout || ''}${r.stderr || ''}`.trim().split('\n').slice(-4).join(' / ')
  evidence.push(`검수 종료코드 ${r.status}`)
  if (r.status !== 0) issues.push(`검수 스크립트 오류(종료코드 ${r.status}): ${tail}`)
}

// 5) 라이브 대조 + 소식 최신 글
for (const name of ['jobs', 'welfare', 'news']) {
  try {
    const r = await fetchText(`${SITE}/data/${name}.json?t=${Date.now()}`)
    if (r.status !== 200) { issues.push(`라이브 ${name}.json 응답 ${r.status}`); continue }
    const live = JSON.parse(r.text)
    const local = data[name]
    if (local && live.updatedAt !== local.updatedAt) {
      const lag = (parseKst(local.updatedAt) - parseKst(live.updatedAt)) / 3600000
      const msg = `라이브 ${name}.json updatedAt 불일치(라이브 ${live.updatedAt} / 저장소 ${local.updatedAt})`
      // 저장소가 방금 갱신돼 배포가 진행 중일 수 있으므로 3시간 넘게 뒤처질 때만 이상
      if (lag > 3) issues.push(`${msg}, 배포 지연 ${lag.toFixed(1)}시간`)
      else notes.push(`${msg}, 배포 진행 중일 수 있음`)
    } else if (local && live.items?.length !== local.items?.length) {
      notes.push(`라이브 ${name}.json 건수 불일치(${live.items?.length} / ${local.items?.length})`)
    }
  } catch (e) {
    issues.push(`라이브 ${name}.json 확인 실패: ${e.message}`)
  }
}
const newsItems = data.news?.items || []
if (newsItems.length) {
  const top = [...newsItems].sort((a, b) => String(b.date).localeCompare(String(a.date)))[0]
  evidence.push(`소식 최신 ${top.date} ${String(top.title).slice(0, 40)}`)
  const age = (Date.now() - parseKst(top.date)) / 86400000
  if (age > 30) notes.push(`소식 최신 글이 ${Math.floor(age)}일 전`)
}

// 6) 로그 기록
const ok = issues.length === 0
const summary = `일자리${counts.jobs}·복지${counts.welfare}·소식${counts.news}건`
const special = ok ? (notes.join('; ') || '없음') : issues.join('; ')
let block = `${today} | ${ok ? '성공' : '실패'} | ${summary} | ${special}\n`
if (!ok || notes.length) {
  if (issues.length) block += `  - 원인: ${issues.join(' / ')}\n`
  if (notes.length) block += `  - 참고: ${notes.join(' / ')}\n`
  block += `  - 증빙: ${evidence.join(' | ')}\n`
}
console.log(block.trim())

if (!process.env.DAILY_CHECK_NO_WRITE) {
  await mkdir(path.dirname(LOG), { recursive: true })
  if (!existsSync(LOG)) {
    await writeFile(LOG, '# 모두품 일일 점검 로그\n\n형식: 날짜 | 성공/실패 | 건수 | 특이사항 (GitHub Actions daily-check가 자동 추가)\n\n')
  }
  await appendFile(LOG, block)
}
// 이슈 본문용 상세
if (process.env.DAILY_CHECK_REPORT) {
  const report = path.join(process.env.RUNNER_TEMP || root, 'daily-check-report.md')
  await writeFile(report, `## ${today} 점검 결과: ${ok ? '정상' : '이상'}\n\n**요약**: ${summary}\n\n### 원인\n${issues.map((i) => `- ${i}`).join('\n') || '- 없음'}\n\n### 증빙\n${evidence.map((i) => `- ${i}`).join('\n')}\n`)
}
process.exit(ok ? 0 : 1)
