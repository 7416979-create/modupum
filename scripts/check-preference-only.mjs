// 올라간 공고(public/data/jobs.json) 중 '장애인 전용'으로 표시됐지만 근거에 제한 표현이 없고 '우대'·'가점'만 보이는 공고를 찾는다.
// 일반 공고가 전용으로 올라가지 않게 하는 마지막 확인이다(11-21 검단구 사례). 찾으면 목록을 보여 주고 종료 코드 1.
// 배포를 막지 않도록 daily-check.yml 에서 continue-on-error 로 돈다. 사이트 데이터는 고치지 않는다.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { hasRestrictInBody } from './kead-lib.mjs'

// 제한 표현: kead-lib 의 본문 규칙 + 제목에 흔한 전형 표기(장애인 전형·장애인 전용·제한경쟁).
const TITLE_RESTRICT = /제한\s*경쟁|장애인\s*(전형|전용)/

// 판정 근거로 볼 수 있는 글: 제목, 참고 안내, 요약 항목, 혼합 공고 문구, 전용 근거 한 줄.
export const evidenceText = (job) => {
  const summary = Object.values(job.summary ?? {}).flat().filter((v) => typeof v === 'string')
  return [
    job.title,
    ...(job.notes ?? []),
    ...summary,
    job.mixedEvidence,
    ...(job.mixedFields ?? []),
    job.disabledEvidence,
  ]
    .filter((v) => typeof v === 'string' && v)
    .join(' ')
}

export const hasRestrictEvidence = (text) => hasRestrictInBody([text]) || TITLE_RESTRICT.test(text)

// 전용으로 표시된 공고 중 제한 표현 없이 우대·가점만 있는 것.
export const findPreferenceOnly = (items) =>
  (Array.isArray(items) ? items : []).filter((j) => {
    if (j?.disabledOnly !== true) return false
    const text = evidenceText(j)
    return !hasRestrictEvidence(text) && /우대|가점/.test(text)
  })

const run = async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const data = JSON.parse(await readFile(path.join(root, 'public', 'data', 'jobs.json'), 'utf8'))
  const items = Array.isArray(data.items) ? data.items : []
  const checked = items.filter((j) => j.disabledOnly === true).length
  const flagged = findPreferenceOnly(items)
  console.log(`전용 표시 공고 ${checked}건 점검`)
  if (flagged.length === 0) {
    console.log('우대·가점만 있는 전용 표시 공고 없음')
    return 0
  }
  for (const j of flagged) console.log(`- ${j.id} | ${j.title} | ${j.org} | ${j.url ?? '링크 없음'}`)
  console.log(`원문 확인 필요 ${flagged.length}건: 근거에 제한 표현이 없고 우대·가점만 보입니다.`)
  return 1
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await run()
}
