// 임시 진단: ALIO API 목록·상세 응답의 필드만 logs/diag-alio.json 에 남긴다. 키 값은 출력하지 않는다. 확인 후 삭제한다.
import { writeFile } from 'node:fs/promises'
import { listUrl, rowsOf } from './jobs-lib.mjs'

const key = process.env.DATA_GO_KR_KEY || ''
const clean = (s) => String(s ?? '').split(key).join('[KEY]').split(encodeURIComponent(key)).join('[KEY]')
const out = { at: new Date().toISOString(), rows: 0, keys: [], krict: [], mentions: [], detailTries: [] }
const all = []
for (let p = 1; p <= 30; p += 1) {
  try {
    const r = await fetch(listUrl(key, p), { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30000) })
    const j = await r.json()
    const rows = rowsOf(j)
    if (!rows.length) break
    all.push(...rows)
  } catch (e) { out.listError = clean(e.message); break }
}
out.rows = all.length
out.keys = [...new Set(all.flatMap((r) => Object.keys(r)))]
out.krict = all.filter((r) => /화학연구원/.test(r.instNm ?? '')).map((r) => r)
out.mentions = all.filter((r) => /장애/.test(JSON.stringify(r)) && !/장애/.test(r.recrutPbancTtl ?? '')).map((r) => ({ sn: r.recrutPblntSn, inst: r.instNm, title: r.recrutPbancTtl, end: r.pbancEndYmd, hit: (JSON.stringify(r).match(/.{0,30}장애.{0,30}/g) || []).slice(0, 3) }))
const sn = out.krict[0]?.recrutPblntSn ?? all[0]?.recrutPblntSn
for (const name of ['pblntSn', 'sn', 'recrutPblntSn']) {
  try {
    const url = `https://apis.data.go.kr/1051000/recruitment/detail?serviceKey=${key.includes('%') ? key : encodeURIComponent(key)}&resultType=json&${name}=${sn}`
    const r = await fetch(url, { signal: AbortSignal.timeout(30000) })
    const t = clean(await r.text())
    out.detailTries.push({ name, sn, status: r.status, len: t.length, body: t.slice(0, 20000) })
  } catch (e) { out.detailTries.push({ name, error: clean(e.message) }) }
}
await writeFile(new URL('../logs/diag-alio.json', import.meta.url), JSON.stringify(out, null, 1))
console.log('rows', out.rows, 'krict', out.krict.length, 'mentions', out.mentions.length)
