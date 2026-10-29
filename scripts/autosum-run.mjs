// PC 정기 작업: 요약이 빈 공고를 원문에서 읽어 채운다(검증 통과분만 jobs.json 반영·푸시).
// 사용: node scripts/autosum-run.mjs [--dry] [--ids a,b] [--force]
//   --dry   : git pull/commit/push 를 하지 않고 결과만 작업 폴더에 쓴다(jobs.json 도 건드리지 않는다)
//   --ids   : 대상 id 를 지정(기본은 요약 빈 공고 전부)
//   --force : 이미 요약이 있는 공고도 시험 대상으로 삼는다(--dry 와 함께만 허용, 대조용)
import { readFile, writeFile, mkdir, appendFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { HOME, extractJob } from './autosum-extract.mjs'
import { askHaiku } from './autosum-ai.mjs'
import { needsSummary, verifyEasy, applyResults, updateReview, buildPending, MAX_ATTEMPTS } from './autosum-lib.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const dry = args.includes('--dry')
const force = args.includes('--force')
if (force && !dry) throw new Error('--force 는 --dry 와 함께만 쓸 수 있습니다')
const idsArg = args.includes('--ids') ? args[args.indexOf('--ids') + 1].split(',') : null
const kst = new Date(Date.now() + 9 * 3600 * 1000)
const today = kst.toISOString().slice(0, 10)
const stamp = kst.toISOString().slice(0, 16).replace(/[-:T]/g, '')
const P = {
  jobs: path.join(root, 'public/data/jobs.json'),
  pending: path.join(root, 'scripts/pending.json'),
  review: path.join(root, 'logs/autosum-review.json'),
  stats: path.join(root, 'logs/autosum-stats.json'),
  log: path.join(root, 'logs/autosum.md'),
}
const readJson = async (f, d) => JSON.parse(await readFile(f, 'utf8').catch(() => 'null')) ?? d
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

// task.log 에 실행마다 남기는 한 줄(타임스탬프·대상·통과·확인필요). daily-check 가 이 줄을 읽는다.
const runSummary = { total: 0, ok: 0, fail: 0, state: '오류(중간 중단)', dry }
const runLogLine = (s) => `[${new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ')}] 실행결과 | 대상 ${s.total} | 통과 ${s.ok} | 확인필요 ${s.fail} | ${s.state}${s.dry ? ' (시험)' : ''}`

// 동시에 두 번 돌지 않게 한다(2시간 넘은 잠금은 죽은 것으로 보고 지운다).
await mkdir(HOME, { recursive: true })
const lock = path.join(HOME, 'run.lock')
if (existsSync(lock) && Date.now() - Number((await readFile(lock, 'utf8').catch(() => '0')) || 0) < 7200000) {
  console.log('이미 실행 중이어서 건너뜁니다')
  console.log(runLogLine({ total: 0, ok: 0, fail: 0, state: '건너뜀(이미 실행 중)', dry }))
  process.exit(0)
}
await writeFile(lock, String(Date.now()))
const unlock = () => rm(lock, { force: true })

try {
  if (!dry) {
    git('pull', '--rebase', '--autostash', 'origin', 'main')
  }
  const jobsFile = await readJson(P.jobs, { items: [] })
  const review = await readJson(P.review, [])
  const attempts = new Map(review.map((r) => [r.id, r.attempts || 0]))
  let targets = (jobsFile.items || []).filter((j) => (force ? true : needsSummary(j, today)))
  if (idsArg) targets = targets.filter((j) => idsArg.includes(j.id))
  // 3번 실패한 공고는 사람이 보기 전까지 다시 시도하지 않는다(--ids 로 지정하면 시도).
  if (!idsArg) targets = targets.filter((j) => (attempts.get(j.id) || 0) < MAX_ATTEMPTS)
  console.log(`대상 ${targets.length}건: ${targets.map((j) => j.id).join(', ') || '-'}`)

  const outcomes = []
  const outDir = path.join(HOME, 'runs', stamp)
  for (const job of targets) {
    const wd = path.join(outDir, String(job.id).replace(/[^\w-]/g, '_'))
    const o = { id: job.id, title: job.title, org: job.org, end: job.end, url: job.url, ok: false, reasons: [] }
    try {
      const ex = await extractJob(job, wd)
      o.parts = ex.parts
      o.warnings = ex.warnings
      console.log(`[${job.id}] 글자 ${ex.text.length}자 (${ex.parts.map((p) => `${p.label}:${p.chars}`).join(', ')}) ${ex.warnings.join(' / ')}`)
      if (ex.text.replace(/\s/g, '').length < 300) {
        o.reasons.push(`원문 글자 부족(${ex.text.replace(/\s/g, '').length}자). ${ex.warnings.join(' / ')}`.trim())
      } else {
        let ai = await askHaiku(job, ex.text, path.join(wd, 'ai'))
        if (ai.error) ai = await askHaiku(job, ex.text, path.join(wd, 'ai')) // 한 번 더 시도
        if (ai.error) o.reasons.push(`요약 생성 실패: ${ai.error}`)
        else {
          await writeFile(path.join(wd, 'ai.json'), JSON.stringify(ai.json, null, 2))
          let v = verifyEasy(ai.json.easy, ai.json.evidence, ex.text)
          if (!v.ok) {
            // 검사에서 걸린 이유를 알려 주고 한 번만 고쳐 쓰게 한다(통과 기준은 그대로).
            const ai2 = await askHaiku(job, ex.text, path.join(wd, 'ai'), v.reasons.slice(0, 8).join(String.fromCharCode(10)))
            if (!ai2.error) {
              const v2 = verifyEasy(ai2.json.easy, ai2.json.evidence, ex.text)
              await writeFile(path.join(wd, 'ai2.json'), JSON.stringify(ai2.json, null, 2))
              if (v2.ok || v2.reasons.length < v.reasons.length) { ai = ai2; v = v2 }
            }
          }
          o.ok = v.ok
          o.reasons.push(...v.reasons)
          o.easy = v.easy ?? ai.json.easy
          o.model = 'haiku'
        }
      }
    } catch (e) {
      o.reasons.push(`처리 오류: ${String(e.message).slice(0, 150)}`)
    }
    console.log(`[${job.id}] ${o.ok ? '검증 통과' : `확인 필요: ${o.reasons.slice(0, 3).join(' | ')}`}`)
    outcomes.push(o)
  }
  await mkdir(outDir, { recursive: true })
  await writeFile(path.join(outDir, 'outcomes.json'), JSON.stringify(outcomes, null, 2))
  runSummary.total = outcomes.length
  runSummary.ok = outcomes.filter((o) => o.ok).length
  runSummary.fail = outcomes.length - runSummary.ok
  runSummary.state = outcomes.length === 0 ? '처리할 공고 없음' : '오류(반영·푸시 실패)'

  if (!dry && outcomes.length === 0) {
    console.log('처리할 공고 없음: 기록·커밋 없이 끝냅니다')
  } else if (dry) {
    console.log(`시험 실행 끝: 통과 ${outcomes.filter((o) => o.ok).length}/${outcomes.length}. 결과 ${outDir}`)
  } else {
    // 반영: 최신 jobs.json 을 다시 읽어 검증된 결과만 넣는다. 푸시가 거절되면 최신으로 맞춘 뒤 같은 결과를 다시 넣는다.
    const stamp2 = `${today} ${kst.toISOString().slice(11, 16)}`
    const okN = outcomes.filter((o) => o.ok).length
    const failN = outcomes.length - okN
    for (let round = 1; round <= 4; round += 1) {
      const cur = await readJson(P.jobs, { items: [] })
      const { items, applied } = applyResults(cur.items, outcomes, today)
      if (items.length < cur.items.length) throw new Error('공고 수가 줄어들어 중단')
      if (applied.length) await writeFile(P.jobs, `${JSON.stringify({ ...cur, items }, null, 2)}\n`)
      const stillBlank = new Set(items.filter((j) => needsSummary(j, today)).map((j) => j.id)) // 마감·삭제된 공고는 확인 필요 목록에서 뺀다
      const newReview = updateReview(await readJson(P.review, []), outcomes, today).filter((r) => stillBlank.has(r.id))
      await mkdir(path.dirname(P.review), { recursive: true })
      await writeFile(P.review, `${JSON.stringify(newReview, null, 2)}\n`)
      const stats = await readJson(P.stats, {})
      const d = stats[today] || { runs: 0, ok: 0, fail: 0, failIds: [] }
      { d.runs += 1; d.ok += okN; d.fail += failN; d.failIds = [...new Set([...d.failIds, ...outcomes.filter((o) => !o.ok).map((o) => o.id)])] }
      stats[today] = d
      await writeFile(P.stats, `${JSON.stringify(stats, null, 2)}\n`)
      const pendingNow = buildPending(items, today, await readJson(P.pending, []))
      await writeFile(P.pending, `${JSON.stringify(pendingNow, null, 2)}\n`)
      {
        if (!existsSync(P.log)) await writeFile(P.log, '# 요약 자동 채우기 로그 (PC 작업, 처음 2주 관찰: ~2026-11-12)\n\n')
        await appendFile(P.log, `${stamp2} | 대상 ${outcomes.length} | 통과 ${okN} | 확인 필요 ${failN}${failN ? ` (${outcomes.filter((o) => !o.ok).map((o) => `${o.id}: ${o.reasons[0]}`).join('; ').slice(0, 300)})` : ''}\n`)
      }
      git('add', 'public/data/jobs.json', 'scripts/pending.json', 'logs/autosum.md', 'logs/autosum-review.json', 'logs/autosum-stats.json')
      const dirty = git('status', '--porcelain', '--', 'public/data/jobs.json', 'scripts/pending.json', 'logs')
      if (!dirty) { console.log('바뀐 것 없음'); break }
      git('commit', '-m', `autosum: 요약 ${applied.length}건 자동 채움, 확인 필요 ${failN}건`)
      try {
        git('push', 'origin', 'HEAD:main')
        console.log(`푸시 완료: 반영 ${applied.join(', ') || '없음'}`)
        break
      } catch (e) {
        console.log(`푸시 거절(${round}회): 최신으로 맞춰 다시 시도`)
        git('fetch', 'origin', 'main')
        git('reset', '--hard', 'origin/main')
        if (round === 4) throw new Error('푸시 4번 실패')
      }
    }
  }
  if (outcomes.length) runSummary.state = '완료'
} finally {
  console.log(runLogLine(runSummary))
  await unlock()
}
