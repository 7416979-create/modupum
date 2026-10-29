// 공고 원문 페이지와 첨부(PDF·HWP·HWPX)를 새 빈 폴더에 내려받아 글자만 뽑는다.
// 내려받은 파일은 신뢰하지 않는 데이터다: 실행하지 않고, 변환 도구에 경로만 넘긴다.
import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync, readdirSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const run = promisify(execFile)
const here = path.dirname(fileURLToPath(import.meta.url))
export const HOME = process.env.AUTOSUM_HOME || 'C:\\Users\\A\\modupum-autosum'
const VENV = path.join(HOME, 'venv', 'Scripts')
const UA = 'Mozilla/5.0 (compatible; modupum-autosum; +https://modupum.kr)'
// pdftotext 경로: AUTOSUM_PDFTOTEXT 환경변수 > winget 설치 폴더(poppler) > PATH 의 pdftotext
function findPdftotext() {
  if (process.env.AUTOSUM_PDFTOTEXT) return process.env.AUTOSUM_PDFTOTEXT
  try {
    const pk = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages')
    for (const d of readdirSync(pk).filter((n) => /^oschwartz10612\.Poppler/i.test(n))) {
      const base = path.join(pk, d)
      for (const sub of readdirSync(base).filter((n) => /^poppler/i.test(n))) {
        const exe = path.join(base, sub, 'Library', 'bin', 'pdftotext.exe')
        if (existsSync(exe)) return exe
      }
    }
  } catch { /* 없으면 PATH 사용 */ }
  return 'pdftotext'
}
const MAX_BYTES = 15 * 1024 * 1024
const MAX_FILES = 6
const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' }

const decode = (s) => s.replace(/&[a-z#0-9]+;/gi, (e) => ENT[e.toLowerCase()] ?? ' ')
export const htmlToText = (html) =>
  decode(
    html
      .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<\/(p|div|li|tr|h\d|table)>|<br\s*\/?>/gi, '\n')
      .replace(/<[^>]*>/g, ' '),
  )
    .split('\n')
    .map((l) => l.replace(/[ \t\u00a0]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')

// 첨부로 보이는 링크: 확장자가 문서이거나 다운로드 경로
export const attachmentLinks = (html, base) => {
  const out = []
  const seen = new Set()
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = decode(m[1]).trim()
    const label = decode(m[2].replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
    if (/^(javascript|mailto|tel):/i.test(href) || href.startsWith('#')) continue
    const hit = /\.(pdf|hwpx?|docx?)(\?|$)/i.test(href) || /\.(pdf|hwpx?|docx?)\b/i.test(label) || /(download|filedown|atchfile)/i.test(href)
    if (!hit) continue
    let abs
    try { abs = new URL(href, base).toString() } catch { continue }
    if (!/^https?:/.test(abs) || seen.has(abs)) continue
    seen.add(abs)
    out.push({ url: abs, label })
  }
  return out.slice(0, MAX_FILES)
}

const kindOf = (name, buf) => {
  if (buf.subarray(0, 4).toString('latin1') === '%PDF') return 'pdf'
  if (buf.subarray(0, 4).toString('hex') === 'd0cf11e0') return 'hwp'
  if (buf.subarray(0, 2).toString('latin1') === 'PK' && /hwpx|generalfile|download/i.test(name)) return 'hwpx'
  return null
}

const nameFromHeaders = (res, url) => {
  const cd = res.headers.get('content-disposition') || ''
  const m = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(cd)
  if (m) { try { return decodeURIComponent(m[1] || m[2]) } catch { return m[1] || m[2] } }
  try { return decodeURIComponent(new URL(url).pathname.split('/').pop() || 'file') } catch { return 'file' }
}

export async function convert(kind, file) {
  const opt = { timeout: 120000, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8', windowsHide: true, env: { ...process.env, PYTHONUTF8: '1' } }
  if (kind === 'pdf') return (await run(findPdftotext(), ['-layout', '-enc', 'UTF-8', file, '-'], opt)).stdout
  if (kind === 'hwp') return (await run(path.join(VENV, 'python.exe'), ['-I', path.join(here, 'autosum-hwp.py'), file], opt)).stdout
  if (kind === 'hwpx') return (await run(path.join(VENV, 'python.exe'), ['-I', path.join(here, 'autosum-hwpx.py'), file], opt)).stdout
  return ''
}

// 반환: { text, parts:[{label, chars}], warnings:[] }. workDir 는 호출 쪽이 새로 정한 빈 폴더.
export async function extractJob(job, workDir) {
  await mkdir(workDir, { recursive: true })
  const warnings = []
  const parts = []
  let text = ''
  let html = ''
  try {
    let res
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        res = await fetch(job.url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(45000), redirect: 'follow' })
        if (res.ok || res.status < 500) break
      } catch (e) {
        if (attempt === 3) throw e
      }
      await new Promise((r) => setTimeout(r, attempt * 3000))
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const ctype = res.headers.get('content-type') || ''
    const buf = Buffer.from(await res.arrayBuffer())
    if (/html|text/i.test(ctype) || !ctype) {
      html = new TextDecoder(/euc-kr/i.test(ctype) ? 'euc-kr' : 'utf-8').decode(buf)
      const t = htmlToText(html)
      parts.push({ label: '공고 페이지', chars: t.length })
      text += `\n===== 공고 페이지 =====\n${t}\n`
    } else {
      const name = nameFromHeaders(res, job.url)
      const k = kindOf(name, buf)
      warnings.push(`원문 주소가 문서 파일(${ctype})`)
      if (k) {
        const f = path.join(workDir, `main.${k}`)
        await writeFile(f, buf)
        const t = await convert(k, f)
        parts.push({ label: name, chars: t.length })
        text += `\n===== ${name} =====\n${t}\n`
      }
    }
  } catch (e) {
    warnings.push(`원문 페이지 읽기 실패: ${e.message}`)
  }
  let n = 0
  for (const a of attachmentLinks(html, job.url)) {
    n += 1
    try {
      const res = await fetch(a.url, { headers: { 'user-agent': UA, referer: job.url }, signal: AbortSignal.timeout(60000) })
      if (!res.ok) { warnings.push(`첨부 HTTP ${res.status}: ${a.label}`); continue }
      if (Number(res.headers.get('content-length') || 0) > MAX_BYTES) { warnings.push(`첨부가 너무 큼: ${a.label}`); continue }
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length > MAX_BYTES) { warnings.push(`첨부가 너무 큼: ${a.label}`); continue }
      const name = nameFromHeaders(res, a.url)
      const kind = kindOf(name, buf) || kindOf(a.label, buf)
      if (!kind) { warnings.push(`지원 안 하는 첨부(${name})`); continue }
      const f = path.join(workDir, `att${n}.${kind}`)
      await writeFile(f, buf)
      const t = await convert(kind, f)
      if (t.trim().length < 20) warnings.push(`첨부 글자 추출 안 됨: ${name}`)
      parts.push({ label: a.label || name, chars: t.length })
      text += `\n===== 첨부: ${a.label || name} =====\n${t}\n`
    } catch (e) {
      warnings.push(`첨부 처리 실패(${a.label}): ${String(e.message).slice(0, 80)}`)
    }
  }
  await writeFile(path.join(workDir, 'source.txt'), text)
  return { text, parts, warnings }
}
