// 일자리 공고 공유 주소: #/jobs/<공고 id>. 화면 코드와 테스트가 같이 쓰는 순수 함수만 둔다.
export const JOB_PREFIX = '#/jobs/'

export const jobHash = (id) => `${JOB_PREFIX}${encodeURIComponent(String(id))}`

export const jobShareUrl = (origin, pathname, id) => `${origin}${pathname || '/'}${jobHash(id)}`

// '#/jobs/<id>' 에서 id 를 꺼낸다. 아니면 ''.
export const jobIdFromHash = (hash) => {
  const h = String(hash || '')
  if (!h.startsWith(JOB_PREFIX)) return ''
  const raw = h.slice(JOB_PREFIX.length).split(/[?&]/)[0].replace(/\/+$/, '')
  if (!raw) return ''
  try { return decodeURIComponent(raw) } catch { return '' }
}

// 해시 전체를 탭 이름과 공고 id 로 나눈다. routes 에 없는 탭은 'home'.
export const parseRoute = (hash, routes) => {
  const jobId = jobIdFromHash(hash)
  if (jobId) return { tab: 'jobs', jobId }
  const h = String(hash || '').replace('#/', '').replace('#', '')
  return { tab: routes.includes(h) ? h : 'home', jobId: '' }
}

// 목록 순서(items)에서 id 가 있는 쪽 번호(1부터). 없으면 0.
export const pageOfId = (items, id, pageSize) => {
  const idx = items.findIndex((i) => String(i.id) === String(id))
  return idx < 0 ? 0 : Math.floor(idx / pageSize) + 1
}
