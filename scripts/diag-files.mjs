// 임시 진단(확인 후 삭제): 키 없이 ALIO 첨부 다운로드·글자 추출이 되는지만 확인한다.
import { readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { attachText } from './mixed-run.mjs'
import { judgeAttachText } from './mixed-lib.mjs'

const d = JSON.parse(readFileSync(new URL('../logs/diag-samples.json', import.meta.url), 'utf8'))
const out = []
const dir = await mkdtemp(path.join(tmpdir(), 'dfiles-'))
for (const s of d.samples ?? []) {
  for (const [i, f] of (s.files ?? []).slice(0, 4).entries()) {
    const t0 = Date.now()
    try {
      const r = await attachText(f, dir, i + 1)
      const len = (r.text ?? '').replace(/\s/g, '').length
      out.push({ sn: s.sn, name: f.atchFileNm, error: r.error, len, state: r.text ? judgeAttachText(r.text, 'x').state : '-', ms: Date.now() - t0, head: (r.text ?? '').replace(/\s+/g, ' ').slice(0, 80) })
    } catch (e) { out.push({ sn: s.sn, name: f.atchFileNm, error: String(e.message).slice(0, 120) }) }
  }
}
writeFileSync(new URL(`../logs/diag-files-${process.env.GITHUB_RUN_ID || 'local'}.json`, import.meta.url), JSON.stringify(out, null, 1))
