// 제목에 "장애"가 없어도 모집분야 중 일부가 장애인 제한경쟁인 공고(mixed)를 가려내는 규칙.
// 판정은 키워드 규칙만 쓰고(AI 키 불필요), 근거 문장을 데이터에 남긴다. 애매하면 숨긴다.
// 우대·가점만 있는 공고, 비장애인 문구, 결격사유·법령 문구만 있는 공고는 통과시키지 않는다.
import { toJob } from './jobs-lib.mjs'

// 공백·기호를 모두 지운 글자로 비교한다(표 안에서 글자가 갈라져도 잡기 위해).
export const squash = (s) => String(s ?? '').normalize('NFKC').replace(/[\s​|·・ㆍ,，、:：;；]+/g, '')

// 장애인 전용을 뜻하는 표현(공백 제거 후). 우대·가점·법령 이름은 여기에 없다.
const DEDICATED = [
  /장애인(제한경쟁|제한채용|제한전형|제한|구분모집|구분채용|전용|전형|별도채용|특별채용|특별전형|단독채용)/,
  /(제한경쟁|구분모집|전용)[(\[<（]?장애인/,
  /장애인에한(함|하여|정)/,
  /장애인만(지원|응시|채용)/,
]

// 근거 주변에 이런 말이 있으면 전용이 아니라고 보고 버린다.
const NEGATIVE = ['비장애인', '우대', '가점', '가산', '결격', '고용촉진', '직업재활', '장애인복지법', '「', '」', '『', '』', '의무고용', '해당없음', '제한없', '구분없', '불문']

const WINDOW = 16

// 글 전체에서 근거가 되는 줄을 찾는다. 반환: { evidence } 또는 null
export const findDedicated = (text) => {
  const lines = String(text ?? '').split(/\r?\n|(?<=[.。])\s/)
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, ' ').trim()
    if (!line) continue
    const sq = squash(line)
    for (const re of DEDICATED) {
      const g = new RegExp(re.source, 'g')
      for (const m of sq.matchAll(g)) {
        const around = sq.slice(Math.max(0, m.index - WINDOW), m.index + m[0].length + WINDOW)
        if (NEGATIVE.some((w) => around.includes(w))) continue
        return { evidence: line.length > 140 ? `${line.slice(0, 140)}…` : line }
      }
    }
  }
  return null
}

const stepTitles = (it) => (Array.isArray(it.steps) ? it.steps.map((s) => s?.recrutPbancTtl).filter(Boolean) : [])

// 공고 API 행 자체에 들어 있는 글(제목·자격·전형·모집단계 이름). 우대(prefCn·prefCondCn)와 결격사유는 일부러 뺀다.
export const rowText = (it) =>
  [it.recrutPbancTtl, it.recrutSeNm, it.hireTypeNmLst, it.aplyQlfcCn, it.scrnprcdrMthdExpln, it.nonatchRsn, ...stepTitles(it)]
    .filter(Boolean)
    .join('\n')

// 제외할 제목: 우대 공고, 합격자 발표 같은 지원할 수 없는 글
const BAD_TITLE = ['우선채용', '우대', '합격자', '최종합격', '결과', '발표']
export const titleOk = (title) => !BAD_TITLE.some((w) => String(title ?? '').includes(w))

// 1단계: 행 글자로 판정. 반환 { state, evidence, source }
export const judgeRow = (it) => {
  const hit = findDedicated(rowText(it))
  return hit ? { state: 'yes', evidence: hit.evidence, source: '공고 정보' } : null
}

// 2단계: 첨부 글자로 판정. text 가 비었거나 너무 짧으면 'noText'(이미지 공고 등), 있는데 근거가 없으면 'no'
export const judgeAttachText = (text, source) => {
  if (String(text ?? '').replace(/\s+/g, '').length < 80) return { state: 'noText' }
  const hit = findDedicated(text)
  return hit ? { state: 'yes', evidence: hit.evidence, source } : { state: 'no' }
}

export const toMixedJob = (it, verdict) => ({
  ...toJob(it),
  mixed: true,
  mixedEvidence: verdict.evidence,
  mixedSource: verdict.source,
})

export const MAX_TRIES = 3

// 판정 결과 저장소(cache) 갱신용: 이미 판정한 공고는 다시 받지 않는다. noText 는 최대 MAX_TRIES 번만 다시 본다.
export const needsFetch = (entry) => !entry || (entry.state === 'noText' && (entry.tries ?? 0) < MAX_TRIES)

// 오늘 이후 마감이고 모두품이 이미 올리는 공고가 아닌 후보를 고른다. 장애 언급이 있는 공고를 먼저, 그다음 최신순.
export const pickCandidates = (rows, { today, excludeIds = new Set() }) => {
  const mention = (it) => /장애/.test(JSON.stringify([it.prefCn, it.prefCondCn, it.aplyQlfcCn, it.scrnprcdrMthdExpln, it.recrutPbancTtl]))
  return rows
    .filter((it) => it?.recrutPblntSn && it.recrutPbancTtl && it.pbancEndYmd && titleOk(it.recrutPbancTtl))
    .filter((it) => !excludeIds.has(String(it.recrutPblntSn)))
    .filter((it) => {
      const e = String(it.pbancEndYmd).replace(/\D/g, '')
      return e.length === 8 && `${e.slice(0, 4)}-${e.slice(4, 6)}-${e.slice(6, 8)}` >= today
    })
    .sort((a, b) => Number(mention(b)) - Number(mention(a)) || Number(b.recrutPblntSn) - Number(a.recrutPblntSn))
}

// 캐시에서 오늘 이후 마감인 것만 남긴다.
export const pruneCache = (cache, today) =>
  Object.fromEntries(Object.entries(cache ?? {}).filter(([, v]) => v?.end && v.end >= today))
