// 고용공단 공고 첨부(PDF·HWPX)를 받아 글자로 바꾼다. 실행하지 않고, 형식은 첫 바이트로 판별한다.
// 읽지 못하면 text 를 '' 로 돌려 주고, 호출하는 쪽은 기존 판정을 그대로 둔다(더 엄격한 쪽으로만 바꾼다).
// PDF 는 poppler 의 pdftotext(수집 워크플로가 poppler-utils 를 먼저 설치한다). HWPX 는 ZIP 을 직접 풀어 본문 XML 에서 글자만 뽑는다.
// HWP(이진)는 읽지 않는다('확인 못 함' 처리).
import { execFile } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { promisify } from 'node:util'
import { BASE } from './kead-lib.mjs'

const run = promisify(execFile)
export const MAX_ATTACH_BYTES = 15 * 1024 * 1024
const MAX_TEXT = 2 * 1024 * 1024

// 상세 페이지의 첫 번째 첨부 링크(/cmm/fms/downloadDirect.do?key=…). 로그인 없이 받아진다(11-21 확인).
export const attachmentUrl = (html) => {
  const m = /href="(\/cmm\/fms\/downloadDirect\.do\?key=[A-Za-z0-9]+)"/.exec(String(html ?? ''))
  return m ? `${BASE}${m[1]}` : ''
}

// ZIP 중앙 디렉터리를 읽어 항목 목록을 만든다.
const zipEntries = (buf) => {
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) return []
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const out = []
  for (let k = 0; k < count && p + 46 <= buf.length; k += 1) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break
    const nlen = buf.readUInt16LE(p + 28)
    const xlen = buf.readUInt16LE(p + 30)
    const clen = buf.readUInt16LE(p + 32)
    out.push({
      name: buf.toString('utf8', p + 46, p + 46 + nlen),
      method: buf.readUInt16LE(p + 10),
      csize: buf.readUInt32LE(p + 20),
      local: buf.readUInt32LE(p + 42),
    })
    p += 46 + nlen + xlen + clen
  }
  return out
}

const SECTION = /^Contents\/section(\d+)\.xml$/

// 형식 판별: pdf · hwp(이진) · hwpx(ZIP 안에 Contents/section*.xml) · zip · other
export const attachKind = (buf) => {
  if (!buf || buf.length < 4) return 'other'
  if (buf.subarray(0, 4).toString('latin1') === '%PDF') return 'pdf'
  if (buf.subarray(0, 4).toString('hex') === 'd0cf11e0') return 'hwp'
  if (buf.subarray(0, 2).toString('latin1') === 'PK') {
    return zipEntries(buf).some((e) => SECTION.test(e.name)) ? 'hwpx' : 'zip'
  }
  return 'other'
}

const xmlText = (s) =>
  s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[-]/g, '') // 한글 파일의 사용자 정의 글자(깨진 글자) 제거

// HWPX 본문(Contents/section*.xml)의 글자. 실패하면 ''.
export const hwpxText = (buf) => {
  let text = ''
  try {
    const list = zipEntries(buf)
      .filter((e) => SECTION.test(e.name))
      .sort((a, b) => Number(SECTION.exec(a.name)[1]) - Number(SECTION.exec(b.name)[1]))
    for (const e of list) {
      if (buf.readUInt32LE(e.local) !== 0x04034b50) continue
      const start = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28)
      const raw = buf.subarray(start, start + e.csize)
      const data =
        e.method === 0 ? raw : e.method === 8 ? inflateRawSync(raw, { maxOutputLength: MAX_TEXT * 4 }) : null
      if (!data) continue
      text += ` ${xmlText(data.toString('utf8'))}`
      if (text.length > MAX_TEXT) break
    }
  } catch {
    return ''
  }
  return text.replace(/\s+/g, ' ').trim()
}

// PDF 글자(pdftotext). 도구가 없거나 실패하면 ''. 임시 폴더는 항상 지운다.
export const pdfText = async (buf) => {
  let dir = ''
  try {
    dir = await mkdtemp(path.join(tmpdir(), 'modupum-attach-'))
    const file = path.join(dir, 'attach.pdf')
    await writeFile(file, buf)
    const { stdout } = await run('pdftotext', ['-enc', 'UTF-8', '-layout', file, '-'], {
      timeout: 60000,
      maxBuffer: MAX_TEXT * 4,
    })
    return String(stdout).replace(/\s+/g, ' ').trim()
  } catch {
    return ''
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

// 첨부 한 건을 받아 형식과 글자를 돌려 준다. 실패는 모두 { kind:'error' 또는 'http', text:'' }.
export const readAttachment = async (url, ua) => {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': ua }, signal: AbortSignal.timeout(30000) })
    if (!res.ok) return { kind: 'http', text: '' }
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > MAX_ATTACH_BYTES) return { kind: 'too-big', text: '' }
    const kind = attachKind(buf)
    const text = kind === 'pdf' ? await pdfText(buf) : kind === 'hwpx' ? hwpxText(buf) : ''
    return { kind, text }
  } catch {
    return { kind: 'error', text: '' }
  }
}
