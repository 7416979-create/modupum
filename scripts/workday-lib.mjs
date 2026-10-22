// 일자리 수집(공공데이터포털·나라일터·KEAD)을 할 날인지 판정한다. 기준은 한국시간(KST) 요일 + holidays.json 공휴일.
// 주말·공휴일(대체공휴일 포함)에는 일자리만 수집하지 않는다. 복지·소식(RSS) 수집과 배포는 이 판정과 무관하게 계속한다.
// 수동 실행은 FORCE_COLLECT=1(또는 명령에 --force)이면 항상 수집한다.
import { readFile } from 'node:fs/promises'

export const loadHolidays = async () => JSON.parse(await readFile(new URL('./holidays.json', import.meta.url), 'utf8'))

export const kstDate = (ms = Date.now()) => new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10)
// 0=일 ... 6=토 (날짜 글자 기준이라 실행 PC의 시간대와 무관)
export const weekdayOf = (ymd) => new Date(`${ymd}T00:00:00Z`).getUTCDay()

export const isForced = (env = process.env, argv = process.argv) =>
  ['1', 'true'].includes(String(env.FORCE_COLLECT ?? '').toLowerCase()) || argv.includes('--force')

// { collect: boolean, reason: string }
export const jobCollectDecision = (ymd, holidays, { force = false } = {}) => {
  const wd = weekdayOf(ymd)
  const covered = (holidays.coveredYears ?? []).includes(Number(ymd.slice(0, 4)))
  let reason = ''
  if (wd === 0 || wd === 6) reason = `주말(${wd === 0 ? '일' : '토'}요일)`
  else if ((holidays.dates ?? []).includes(ymd)) reason = '공휴일'
  if (force) return { collect: true, reason: reason ? `강제 실행(원래는 ${reason}이라 건너뜀)` : '강제 실행' }
  if (reason) return { collect: false, reason }
  // 공휴일 목록이 없는 해의 평일은 공휴일 여부를 모르므로 수집한다(데이터가 멈추는 쪽보다 낫다).
  return { collect: true, reason: covered ? '평일' : '평일(이 해의 공휴일 목록 없음)' }
}
