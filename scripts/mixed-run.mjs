// 제목에 "장애"가 없는 ALIO 공고 중 일부 모집분야가 장애인 제한경쟁인 공고(mixed)를 찾는다.
// 1단계: API 행의 글(자격·전형·모집단계 이름)로 판정. 2단계: 첨부(PDF·HWP·HWPX)를 받아 글자를 뽑아 판정.
// 판정 결과는 scripts/mixed-cache.json 에 저장해 같은 공고를 다시 받지 않고, 실행당 첨부 확인 건수에 상한을 둔다.
// 실패해도 예외를 던지지 않는다(수집 본체와 기존 jobs.json 을 건드리지 않는다).
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { convert, kindOf, nameFromHeaders } from './autosum-extract.mjs'
import { judgeRow, judgeAttachText, pickCandidates, needsFetch, pruneCache, toMixedJob, MAX_TRIES } from './mixed-lib.mjs'

const run = promisify(execFile)
const here = path.dirname(fileURLToPath(import.meta.url))
const UA = 'modupum-bot (+https://modupum.kr)'
export const CACHE_FILE = new URL('./mixed-cache.json', import.meta.url)
export const MAX_ROWS_PER_RUN = Number(process.env.MIXED_MAX_ROWS || 60) // 실행당 첨부를 받아 보는 공고 수 상한
const MAX_FILES = 4
const MAX_BYTES = 15 * 1024 * 1024
const BUDGET_MS = Number(process.env.MIXED_BUDGET_MIN || 8) * 60 * 1000 // 첨부 확인에 쓰는 총 시간 상한
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const readCache = async () => {
  try {
    const c = JSON.parse(await readFile(CACHE_FILE, 'utf8'))
    return c && typeof c === 'object' && c.items && typeof c.items === 'object' ? c.items : {}
  } catch {
    return {}
  }
}

// HWP(5.x): hwp5html(표 포함) → 실패하면 hwp5txt. 리눅스 러너에서는 pip 의 pyhwp 가 있어야 한다.
const hwpText = async (file, dir) => {
  const opt = { timeout: 100000, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8', windowsHide: true }
  try {
    const out = path.join(dir, 'html')
    await run('hwp5html', ['--output', out, file], opt)
    const x = await readFile(path.join(out, 'index.xhtml'), 'utf8')
    const t = x
      .replace(/<style[\s\S]*?<\/style>/g, '')
      .replace(/<\/(p|tr|div|h\d|li)>|<br\s*\/?>/gi, '\n')
      .replace(/<\/t[dh]>/gi, ' | ')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
    if (t.trim().length >= 50) return t
  } catch { /* hwp5txt 로 대신한다 */ }
  return (await run('hwp5txt', [file], opt)).stdout
}

const hwpxText = async (file) => {
  const py = process.platform === 'win32' ? 'python' : 'python3'
  return (await run(py, ['-I', path.join(here, 'autosum-hwpx.py'), file], { timeout: 100000, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8', windowsHide: true, env: { ...process.env, PYTHONUTF8: '1' } })).stdout
}

// 첨부 한 개의 글자. 지원하지 않는 형식·실패는 { error } 로 돌려준다.
const attachText = async (file, workDir, n) => {
  if (!file?.url || !/^https:\/\/www\.alio\.go\.kr\//.test(file.url)) return { error: '지원하지 않는 첨부 주소' }
  const res = await fetch(file.url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60000) })
  if (!res.ok) return { error: `HTTP ${res.status}` }
  if (Number(res.headers.get('content-length') || 0) > MAX_BYTES) return { error: '첨부가 너무 큼' }
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > MAX_BYTES) return { error: '첨부가 너무 큼' }
  const name = file.atchFileNm || nameFromHeaders(res, file.url)
  const kind = kindOf(`${name}`, buf)
  if (!kind) return { error: `지원 안 하는 형식(${name})` }
  const f = path.join(workDir, `att${n}.${kind}`)
  await writeFile(f, buf)
  const text = kind === 'pdf' ? await convert('pdf', f) : kind === 'hwp' ? await hwpText(f, workDir) : await hwpxText(f)
  return { text, name }
}

// 첨부들에서 판정. 근거를 찾으면 바로 끝낸다. 반환 { state, evidence?, source?, why? }
const judgeAttachments = async (it) => {
  const files = (Array.isArray(it.files) ? it.files : []).slice(0, MAX_FILES)
  if (files.length === 0) return { state: 'noText', why: '첨부 없음' }
  const dir = await mkdtemp(path.join(tmpdir(), 'mixed-'))
  let anyText = false
  let why = ''
  try {
    for (const [i, f] of files.entries()) {
      try {
        const r = await attachText(f, dir, i + 1)
        if (r.error) { why = r.error; continue }
        const v = judgeAttachText(r.text, `첨부: ${r.name}`)
        if (v.state === 'yes') return v
        if (v.state === 'no') anyText = true
        else why = `글자를 못 읽음(${r.name})`
      } catch (e) {
        why = `첨부 처리 실패: ${String(e.message).slice(0, 60)}`
      }
      await sleep(1000)
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
  return anyText ? { state: 'no' } : { state: 'noText', why: why || '글자 없음' }
}

// rows: 전체 ALIO 행. excludeIds: 이미 제목 규칙으로 올라가는 공고 id. 반환: { jobs, stats }
// getDetail(sn): 상세 응답의 result(첨부 files·모집단계 steps 포함)를 돌려주는 함수. 목록 응답에는 첨부가 없다.
export const collectMixed = async (rows, { today, excludeIds = new Set(), getDetail, log = console.log } = {}) => {
  const items = pruneCache(await readCache(), today)
  const stats = { 후보: 0, 행근거: 0, 첨부확인: 0, 근거없음: 0, 글자없음: 0, 미확인대기: 0 }
  const cands = pickCandidates(rows, { today, excludeIds })
  stats.후보 = cands.length
  const started = Date.now()
  let fetched = 0
  const jobs = []
  for (const it of cands) {
    const id = String(it.recrutPblntSn)
    const end = String(it.pbancEndYmd).replace(/\D/g, '').replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3')
    let e = items[id]
    if (!e || e.state !== 'yes') {
      const r1 = judgeRow(it)
      if (r1) e = { ...r1, end, tries: 0, checkedAt: today }
    }
    if (needsFetch(e)) {
      if (fetched >= MAX_ROWS_PER_RUN || Date.now() - started > BUDGET_MS) { stats.미확인대기 += 1; continue }
      let detail
      try {
        detail = await getDetail(id)
        if (!detail || typeof detail !== 'object') throw new Error('상세 응답 없음')
      } catch (err) {
        log(`[mixed] 상세 조회 실패(다음에 다시 시도) ${id}: ${String(err.message).slice(0, 60)}`)
        stats.미확인대기 += 1
        continue
      }
      fetched += 1
      const merged = { ...it, ...detail }
      const v = judgeRow(merged) ?? (await judgeAttachments(merged))
      await sleep(500)
      e = { ...v, end, tries: v.state === 'noText' ? (e?.tries ?? 0) + 1 : 0, checkedAt: today }
      stats.첨부확인 += 1
      if (v.state === 'noText') log(`[mixed] 탈락(본문 글자 없음) ${id} ${it.instNm} ${String(it.recrutPbancTtl).slice(0, 40)} - ${v.why} (시도 ${e.tries}/${MAX_TRIES})`)
    }
    items[id] = e
    if (e.state === 'yes') { jobs.push(toMixedJob(it, e)); stats.행근거 += e.source === '공고 정보' ? 1 : 0 }
    else if (e.state === 'no') stats.근거없음 += 1
    else stats.글자없음 += 1
  }
  await writeFile(CACHE_FILE, `${JSON.stringify({ updatedAt: today, items }, null, 1)}\n`)
  return { jobs, stats }
}
