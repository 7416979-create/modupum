// 임시 진단(확인 후 삭제): 상세 API 한 건의 응답 본문(오류 코드 포함)만 남긴다. 키 값은 출력하지 않는다.
import { writeFile } from 'node:fs/promises'
import { detailUrl } from './jobs-lib.mjs'
const key = process.env.DATA_GO_KR_KEY || ''
const clean = (s) => String(s ?? '').split(key).join('[KEY]').split(encodeURIComponent(key)).join('[KEY]')
const r = await fetch(detailUrl(key, '306734'), { signal: AbortSignal.timeout(30000) })
const t = clean(await r.text())
await writeFile(new URL(`../logs/diag-probe-${process.env.GITHUB_RUN_ID || 'local'}.json`, import.meta.url), JSON.stringify({ status: r.status, ctype: r.headers.get('content-type'), len: t.length, head: t.slice(0, 600) }, null, 1))
