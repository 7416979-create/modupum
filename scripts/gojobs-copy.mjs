// 나라일터 사본 저장·삭제(파일 입출력). 순수 함수는 gojobs-copy-lib.mjs.
// 저장 위치: public/gojobs/<공고번호>/index.html + attach-N.<확장자>, 목록: public/gojobs/manifest.json (모두품 저장소 정적 파일)
// 사용: node scripts/gojobs-copy.mjs cleanup   → 마감 지난 사본 삭제(주말·수집 안 하는 날에도 매 실행 때 호출)
import { mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { COPY_DIR, GOJOBS_ORIGIN, MAX_ATTACH_BYTES, attachOrder, copyUrl, expiredSns, extOf, parseView, renderCopyHtml } from './gojobs-copy-lib.mjs'

export const ROOT = new URL(`../public/${COPY_DIR}/`, import.meta.url)
const UA = 'modupum-bot (+https://modupum.kr)'
const kst = (iso) => new Date(Date.parse(iso) + 9 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export const readManifest = async () => JSON.parse(await readFile(new URL('manifest.json', ROOT), 'utf8').catch(() => '{}'))
const writeManifest = async (m) => {
  await mkdir(ROOT, { recursive: true })
  await writeFile(new URL('manifest.json', ROOT), `${JSON.stringify(m, null, 2)}\n`)
}

// 마감일이 지난 사본(폴더 전체=본문+첨부)과 manifest 에 없는 폴더를 지운다. 지운 공고번호 목록을 돌려준다.
export const cleanupCopies = async (today) => {
  const m = await readManifest()
  const items = m.items ?? {}
  const removed = []
  for (const sn of expiredSns(m, today)) {
    await rm(new URL(`${sn}/`, ROOT), { recursive: true, force: true })
    delete items[sn]
    removed.push(sn)
  }
  if (existsSync(fileURLToPath(ROOT))) {
    for (const d of await readdir(ROOT, { withFileTypes: true })) {
      if (d.isDirectory() && !items[d.name]) {
        await rm(new URL(`${d.name}/`, ROOT), { recursive: true, force: true })
        removed.push(d.name)
      }
    }
    if (removed.length) await writeManifest({ ...m, items })
  }
  return removed
}

const post = async (fetchRetry, path, form) => {
  const res = await fetchRetry(`${GOJOBS_ORIGIN}/${path}`, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', Referer: `${GOJOBS_ORIGIN}/apmList.do` },
    body: new URLSearchParams(form).toString(),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res
}

export const fetchView = async (fetchRetry, sn, code = '020') => {
  const res = await post(fetchRetry, 'apmView.do', { flag: 'U', empmnsn: String(sn), searchJobsecode: code, prgl: 'apmList', menuNo: '401', selMenuNo: '400', upperMenuNo: '', listViewYn: 'N', isShowBtn: 'N', wd: '1200' })
  return parseView(await res.text())
}

const download = async (fetchRetry, sn, f) => {
  const res = await post(fetchRetry, 'downFile.do', { filenm: f.name, uuid: f.uuid, saveGbn: f.saveGbn, empmnsn: String(sn) })
  return Buffer.from(await res.arrayBuffer())
}

// 공고 한 건의 사본을 만든다. 성공하면 manifest 항목을, 실패하면 throw. 기존 사본이 있으면 실패해도 건드리지 않는다.
export const makeCopy = async (fetchRetry, job, rowCode, now, prev) => {
  const sn = job.id.replace(/^gojobs-/, '')
  const view = await fetchView(fetchRetry, sn, rowCode)
  if (!view.fields['공고명']) throw new Error('상세 페이지에서 공고명을 읽지 못함')
  if (!view.body && view.files.length === 0) throw new Error('본문과 첨부가 모두 비어 있음')
  const dir = new URL(`${sn}/`, ROOT)
  await mkdir(dir, { recursive: true })
  const saved = []
  let total = 0
  let i = 0
  for (const f of attachOrder(view.files)) {
    const ext = extOf(f.name)
    const name = `attach-${(i += 1)}.${ext}`
    const old = prev?.files?.find((x) => x.uuid === f.uuid && existsSync(fileURLToPath(new URL(`${sn}/${x.file}`, ROOT))))
    try {
      let size
      if (old) {
        size = old.size
        if (old.file !== name) {
          const buf = await readFile(new URL(`${sn}/${old.file}`, ROOT))
          await writeFile(new URL(`${sn}/${name}`, ROOT), buf)
        }
      } else {
        await sleep(1500)
        const buf = await download(fetchRetry, sn, f)
        size = buf.length
        if (size === 0 || size + total > MAX_ATTACH_BYTES) continue // 상한 초과·빈 파일은 생략하고 본문만
        await writeFile(new URL(`${sn}/${name}`, ROOT), buf)
      }
      if (size + total > MAX_ATTACH_BYTES) continue
      total += size
      saved.push({ name: f.name, uuid: f.uuid, file: name, href: name, size })
    } catch (e) {
      console.error(`나라일터 첨부 저장 실패(본문만 둠) ${sn} ${f.name}: ${e.message}`)
    }
  }
  // 이번에 쓰지 않은 옛 첨부 파일 정리
  const keep = new Set(['index.html', ...saved.map((x) => x.file)])
  for (const d of await readdir(dir)) if (!keep.has(d)) await rm(new URL(d, dir), { force: true })
  const html = renderCopyHtml({ job, view: { ...view, files: view.files }, files: saved, collectedAt: now, sn })
  await writeFile(new URL('index.html', dir), html)
  return { end: job.end, title: job.title, collectedAt: new Date(now).toISOString(), url: copyUrl(sn), files: saved.map(({ name, uuid, file, size }) => ({ name, uuid, file, size })), bodyChars: view.body.length }
}

// 접수 중 공고들의 사본을 만들고, 사본이 실제로 만들어진 공고만 url 을 사본 주소로 바꿔 돌려준다. 실패한 공고는 게시하지 않는다.
export const makeCopies = async (fetchRetry, jobs, rows, now) => {
  const m = await readManifest()
  const items = m.items ?? {}
  const ok = []
  const failed = []
  const codeOf = new Map(rows.map((r) => [`gojobs-${r.sn}`, r.code]))
  for (const job of jobs) {
    const sn = job.id.replace(/^gojobs-/, '')
    try {
      items[sn] = await makeCopy(fetchRetry, job, codeOf.get(job.id) ?? '020', now, items[sn])
      ok.push({ ...job, url: copyUrl(sn), copiedAt: kst(items[sn].collectedAt) })
    } catch (e) {
      failed.push({ id: job.id, error: e.message })
      console.error(`나라일터 사본 실패(게시 안 함) ${job.id}: ${e.message}`)
      // 이미 정상 사본이 있으면 그 사본으로 계속 게시한다.
      if (items[sn] && existsSync(fileURLToPath(new URL(`${sn}/index.html`, ROOT)))) ok.push({ ...job, url: copyUrl(sn), copiedAt: kst(items[sn].collectedAt) })
    }
    await sleep(2000)
  }
  // 게시하지 않는 공고의 사본은 남기지 않는다.
  const keep = new Set(ok.map((j) => j.id.replace(/^gojobs-/, '')))
  for (const sn of Object.keys(items)) {
    if (!keep.has(sn)) {
      await rm(new URL(`${sn}/`, ROOT), { recursive: true, force: true })
      delete items[sn]
    }
  }
  await writeManifest({ updatedAt: kst(new Date(now).toISOString()), lastRun: { attempted: jobs.length, failed: failed.length, errors: failed.map((f) => `${f.id}: ${f.error}`).slice(0, 10) }, items })
  return { ok, failed }
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/gojobs-copy.mjs')) {
  if (process.argv[2] === 'cleanup') {
    const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
    const removed = await cleanupCopies(today)
    console.log(`나라일터 사본 정리: 마감 지난 사본 ${removed.length}건 삭제${removed.length ? ` (${removed.join(', ')})` : ''}`)
  }
}
