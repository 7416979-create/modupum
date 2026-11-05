import { useEffect, useMemo, useRef, useState } from 'react'
import { jobShareUrl, parseRoute, pageOfId } from './jobLink'
import { isNew, periodOf, needsRegion, unknownLabel, UNKNOWN_PERIOD_LABEL, newestNew, showTabNew } from './status'

const TABS = [
  { id: 'home', label: '홈' },
  { id: 'welfare', label: '복지' },
  { id: 'jobs', label: '일자리' },
  { id: 'apply', label: '신청' },
  { id: 'calendar', label: '달력' },
  { id: 'news', label: '소식' },
]
const ROUTES = [...TABS.map((t) => t.id), 'about']
const TITLES = { home: '모두품', welfare: '복지 - 모두품', jobs: '일자리 - 모두품', apply: '신청 안내 - 모두품', calendar: '신청·지급 달력 - 모두품', news: '소식 - 모두품', about: '이용 안내 - 모두품' }

// 한국 날짜 기준(UTC 날짜를 쓰면 한국 아침 9시 전에 하루 늦게 계산된다)
const today = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
const daysLeft = (end) => Math.round((Date.parse(end) - Date.parse(today())) / 86400000)

// 테스트 기간(3개월) 설문 마감일. 이 날짜 이후에는 팝업을 띄우지 않는다.
const SURVEY_END = '2027-01-19'

// 제목에 기관명이 없으면 '[기관명] 제목'으로 보여 준다(기관명은 짧게)
const orgLabel = (title, org) => {
  const t = (title || '').replace(/\s/g, '')
  const toks = (org || '').replace(/^학교법인\s*/, '').split(/\s+/).filter(Boolean)
  if (!toks.length) return title
  if (toks.some((k) => k.length >= 3 && t.includes(k.replace(/^학교법인/, '')))) return title
  const rest = toks.length > 1 && /[부처]$/.test(toks[0]) ? toks.slice(1) : toks
  return `[${rest[0].replace(/^학교법인/, '')}] ${title}`
}

const PERIOD_LABEL = { open: '진행중', closed: '마감', unknown: UNKNOWN_PERIOD_LABEL, upcoming: '접수 예정' }

// 상태 배지: 화면에는 짧은 글자 라벨(색에만 의존하지 않음), 스크린리더·마우스 오버에는 전체 문구. 카드당 기간 배지 하나 + 지역 보조 하나.
function Badges({ period, region, full, short }) {
  if (period === 'unknown') period = ''
  if (!period && !region) return null
  const pFull = full || PERIOD_LABEL[period]
  return (
    <>
      {period && <><span className={`st-badge st-${period}`} title={pFull} aria-hidden="true">{short || PERIOD_LABEL[period]}</span><span className="sr">{pFull}</span></>}
      {region && <><span className="st-badge st-region" title="지역 확인 필요" aria-hidden="true">지역 확인</span><span className="sr">{period ? ', ' : ''}지역 확인 필요</span></>}
      <span className="sr">, </span>
    </>
  )
}

// NEW: 제목 텍스트 바로 뒤에 inline. 스크린리더는 '제목, 새 글' 순으로 읽는다.
const NewMark = ({ on }) => on ? <><span className="st-badge st-new st-after" aria-hidden="true">NEW</span><span className="sr">, 새 글</span></> : null

const PAGE_SIZE = 10

function usePaged(items, resetKey = '') {
  const [page, setPage] = useState(1)
  useEffect(() => { setPage(1) }, [resetKey, items.length])
  const total = Math.max(1, Math.ceil(items.length / PAGE_SIZE))
  const cur = Math.min(page, total)
  const slice = items.slice((cur - 1) * PAGE_SIZE, cur * PAGE_SIZE)
  const [note, setNote] = useState('')
  useEffect(() => { setNote('') }, [resetKey, items.length])
  const go = (n) => {
    setPage(n)
    setNote(`${n}쪽으로 이동`)
    window.scrollTo({ top: 0 })
    // 키보드 포커스도 목록 맨 위로 옮겨 화면 밖 페이지 번호에 남지 않게 한다
    document.querySelector('.list')?.focus({ preventScroll: true })
  }
  return { slice, page: cur, total, go, setPage, note, count: items.length }
}

function Pager({ pg }) {
  if (pg.total <= 1) return null
  const from = Math.max(1, Math.min(pg.page - 2, pg.total - 4))
  const to = Math.min(pg.total, from + 4)
  const nums = []
  for (let n = from; n <= to; n += 1) nums.push(n)
  return (
    <nav className="pager" aria-label="페이지 이동">
      <button onClick={() => pg.go(pg.page - 1)} disabled={pg.page === 1}>이전</button>
      {nums.map((n) => (
        <button key={n} className={n === pg.page ? 'on' : ''} aria-current={n === pg.page ? 'page' : undefined} onClick={() => pg.go(n)}>{n}</button>
      ))}
      <button onClick={() => pg.go(pg.page + 1)} disabled={pg.page === pg.total}>다음</button>
      <span className="pager-info">{pg.page} / {pg.total} 쪽 · 전체 {pg.count}건</span>
      <span className="sr" role="status">{pg.note}</span>
    </nav>
  )
}

function useData(name) {
  const [data, setData] = useState(null)
  useEffect(() => {
    fetch(`./data/${name}.json`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ items: [], error: true }))
  }, [name])
  return data
}

const tipHref = (site) =>
  site?.tipUrl || (site?.tipEmail ? `mailto:${site.tipEmail}?subject=${encodeURIComponent('[모두품] 정보 제보')}` : '')

function ExternalLink({ href, className, onClick, label, track, children }) {
  const handleClick = (e) => {
    if (track) { try { window.umami?.track('outlink', track) } catch {} }
    onClick?.(e)
  }
  return (
    <a className={className} href={href} aria-label={label ? `${label} (새 창에서 열림)` : undefined} target="_blank" rel="noopener noreferrer" onClick={handleClick}>
      {children}
      <span className="sr"> (새 창에서 열림)</span>
    </a>
  )
}

function SampleNotice({ data }) {
  if (!data?.sample) return null
  return <p className="notice">지금은 샘플 화면입니다. 공공 데이터가 연결되면 실제 정보로 바뀝니다.</p>
}

// 원문에 없는 칸은 이 문구로 통일한다(요약 형식 버전 11).
const NO_INFO = '공고에 안 나와 있어요. 문의에 물어보세요.'
const infoOr = (v) => (v && v !== '확인 안 됨' ? v : NO_INFO)
// 원문 대조가 끝나지 않은 공고는 요약을 숨기고 이 배지만 보인다(item.verified === true 일 때만 요약 공개).
// 요약이 아직 없으면 "준비 중" 대신 원문으로 안내한다(빈칸·준비중 문구 금지, 요약은 daily-check 가 알려 채운다).
const PENDING = '"원문 보기"에서 확인해 주세요'

// 자세히보기: 공고 핵심 칸을 크게 보여준다. 전화번호가 있을 때만 전화 버튼을 보인다.
function AskHelp({ item }) {
  const [open, setOpen] = useState(false)
  const facts = [
    ['기관', infoOr(item.org)],
    ['마감', item.end ? `${item.end}까지` : NO_INFO],
    ['채용 인원', item.verified === true ? infoOr(item.summary?.채용인원) : PENDING],
    ['고용 형태', item.verified === true ? infoOr(item.summary?.고용형태) : PENDING],
  ]
  return (
    <div className="ask-box">
      <button type="button" className="ask-btn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        자세히보기
      </button>
      {open && (
        <div className="ask-panel">
          <dl>
            {facts.map(([k, v]) => (
              <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
            ))}
          </dl>
          {item.phone && (
            <div className="ask-actions">
              <a className="ask-btn" href={`tel:${item.phone}`}>전화하기 {item.phone}</a>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Home({ go }) {
  const welfare = useData('welfare')
  const jobs = useData('jobs')
  const wn = welfare?.items?.length
  const jn = jobs ? (jobs.items ?? []).filter((i) => i.end >= today()).length : null
  return (
    <section className="hero">
      <img className="hero-mark" src="./brand/modupum-mark.svg" alt="" width="72" height="64" />
      <h1>모두를 품는<br />정보.</h1>
      <p className="lead">복지 제도와 장애인 채용 공고를 한곳에서.</p>
      <div className="cards">
        <button className="card" onClick={() => go('welfare')}>
          <span className="card-t">복지</span>
          <span className="card-n">{wn != null ? `${wn}건` : ' '}</span>
          <span className="card-d">받을 수 있는 복지서비스 찾기</span>
        </button>
        <button className="card" onClick={() => go('jobs')}>
          <span className="card-t">일자리</span>
          <span className="card-n">{jn != null ? `접수 중 ${jn}건` : ' '}</span>
          <span className="card-d">공공기관·국가기관·지자체 장애 관련 채용 공고</span>
        </button>
      </div>
      <p className="home-links">
        <button onClick={() => go('apply')}>신청 안내</button>
        <button onClick={() => go('news')}>소식</button>
      </p>
    </section>
  )
}

function TipBox() {
  const href = tipHref(useData('site'))
  if (!href) return null
  return (
    <section className="tip" aria-labelledby="tip-title">
      <h2 id="tip-title" className="more-title">알고 계신 정보가 있나요</h2>
      <p>복지 제도나 장애인 채용 소식을 알려 주시면 확인한 뒤 올립니다. 출처 링크를 함께 보내 주세요.</p>
      <ExternalLink className="tip-btn" href={href}>정보 알려주기</ExternalLink>
    </section>
  )
}

function MoreLinks({ kind }) {
  const data = useData('links')
  const list = data?.[kind] ?? []
  if (list.length === 0) return null
  return (
    <details className="more">
      <summary>관련 사이트</summary>
      <ul className="more-list">
        {list.map((l) => (
          <li key={l.url}>
            <ExternalLink href={l.url}>
              <strong>{l.name}</strong>
              <span>{l.org} · {l.desc}</span>
            </ExternalLink>
          </li>
        ))}
      </ul>
    </details>
  )
}

function Welfare() {
  const data = useData('welfare')
  const ovr = useData('welfare-status')
  const [q, setQ] = useState('')
  const items = useMemo(() => {
    const t = today()
    const k = q.trim()
    const list = (data?.items ?? [])
      .filter((i) => !k || `${i.title}${i.summary}${i.category}${i.target}`.includes(k))
      .map((i) => ({ ...i, _period: periodOf(t, i, ovr?.items?.[i.id]), _new: isNew(t, i.firstSeen), _region: needsRegion(i) || ovr?.items?.[i.id]?.region === true }))
    // 마감 항목은 목록 아래로(그 안의 순서는 그대로)
    return [...list.filter((i) => i._period !== 'closed'), ...list.filter((i) => i._period === 'closed')]
  }, [data, ovr, q])
  const pg = usePaged(items, q)
  const [opened, setOpened] = useState({})
  useEffect(() => { setOpened({}) }, [q])
  const toggle = (id) => setOpened((o) => ({ ...o, [id]: !o[id] }))

  return (
    <section>
      <h1 className="page-h">복지</h1>
      <SampleNotice data={data} />
      <input className="search" type="search" placeholder="검색어를 입력하세요" value={q} onChange={(e) => setQ(e.target.value)} aria-label="복지 검색" />
      <p className="sr" role="status">{data ? `${items.length}건` : ''}</p>
      <ul className="list list-w" tabIndex={-1}>
        {pg.slice.map((i) => {
          const isOpen = !!opened[i.id]
          const panelId = `w-panel-${i.id}`
          return (
            <li key={i.id} className={`item item-w${i._period === 'closed' ? ' closed' : ''}`}>
              <h2 className="w-h">
                <button type="button" className="w-head" aria-expanded={isOpen} aria-controls={panelId} onClick={() => toggle(i.id)}>
                  <span className="w-tags">
                    <span className="w-tag">{i.org}</span>
                    {i.category && <span className="w-tag">{i.category.split(',')[0]}</span>}
                    <Badges period={i._period} region={i._region} />
                  </span>
                  <span className="w-title">{i.title}<NewMark on={i._new} /></span>
                  <span className="w-sum">{i.summary}</span>
                  <span className="w-arrow" aria-hidden="true" />
                </button>
              </h2>
              <div id={panelId} className={`w-panel${isOpen ? ' open' : ''}`}>
                <div>
                  <div className="w-body">
                    {i._period === 'unknown' && (
                      <p className="period-note"><strong>{unknownLabel(i)}</strong> 신청 전 공식 기관에서 {unknownLabel(i) === UNKNOWN_PERIOD_LABEL ? '신청기간을' : '신청기간과 자격을'} 확인하세요.</p>
                    )}
                    <p><strong>지원 대상</strong> {i.target || '원문에서 확인'}</p>
                    <ExternalLink className="w-link" href={i.url} track={{ tab: 'welfare', org: i.source }} label={`${i.title} 신청 방법 원문 보기 · 출처 ${i.source}`}>신청 방법 · 원문 보기 (출처 {i.source})</ExternalLink>
                  </div>
                </div>
              </div>
            </li>
          )
        })}
        {data && items.length === 0 && <li className="empty">표시할 항목이 없습니다.</li>}
      </ul>
      <p className="sub status-note">신청기간을 확인하지 못한 항목은 항목을 열면 '확인 필요' 안내가 나옵니다. 지역 확인 필요 항목은 거주 지역에 따라 대상·지원이 다를 수 있습니다.</p>
      <Pager pg={pg} />
      <MoreLinks kind="welfare" />
      <TipBox />
    </section>
  )
}

function Apply() {
  const data = useData('guides')
  const items = data?.items ?? []
  const pg = usePaged(items)
  return (
    <section>
      <h1 className="page-h">신청 안내</h1>
      <SampleNotice data={data} />
      <p className="sub">{data?.scope ?? ''}</p>
      <p className="apply-note">금액과 기준은 해마다, 지역마다 달라집니다. 신청 전에 원문에서 다시 확인하세요. ({data?.checkedAt ?? ''} 확인)</p>
      <ul className="list" tabIndex={-1}>
        {pg.slice.map((g) => (
          <li key={g.id} className="item">
            <details>
              <summary>
                <h2>{g.name}</h2>
                {g.aka && <span className="sum-tag">{g.aka}</span>}
              </summary>
              <div className="detail">
                <p>{g.summary}</p>
                <dl className="facts">
                  {g.facts.map(([k, v]) => (
                    <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
                  ))}
                </dl>
                <p className="src-links">
                  {g.links.map((l) => (
                    <ExternalLink key={l.url} href={l.url}>{l.label}</ExternalLink>
                  ))}
                </p>
              </div>
            </details>
          </li>
        ))}
        {data && items.length === 0 && <li className="empty">표시할 항목이 없습니다.</li>}
      </ul>
      <Pager pg={pg} />
      <TipBox />
    </section>
  )
}

// 신청·지급 달력: 날짜는 calendar.json 에만 둔다. 이번 달 = 매월 항목 + months 에 이번 달이 든 항목. 월별 = months 기준, 매월·비정기는 따로 모은다.
const tagOf = (it) => {
  if (it.cycle === '매월') return `매월 ${it.day}일`
  const m = it.months ?? []
  if (!m.length) return it.cycle
  return m.length === 1 ? `매년 ${m[0]}월` : `매년 ${m[0]}~${m[m.length - 1]}월`
}

function CalItem({ it }) {
  return (
    <li className="item">
      <details>
        <summary>
          <h3>{it.name}</h3>
          <span className="sum-tag dday">{tagOf(it)}</span>
        </summary>
        <div className="detail">
          <p>{it.easy}</p>
          <dl className="facts">
            <div><dt>언제</dt><dd>{it.when}</dd></div>
            <div><dt>누가</dt><dd>{it.target}</dd></div>
          </dl>
          <p className="src-links">
            <ExternalLink href={it.source} label={`${it.name} 출처 ${it.sourceLabel}`}>출처: {it.sourceLabel}</ExternalLink>
          </p>
          <p className="cal-checked">{it.checkedAt} 확인</p>
        </div>
      </details>
    </li>
  )
}

function Calendar() {
  const data = useData('calendar')
  const items = data?.items ?? []
  const month = Number(today().slice(5, 7))
  const monthly = items.filter((i) => i.cycle === '매월').sort((a, b) => a.day - b.day)
  const thisMonth = [...monthly, ...items.filter((i) => i.cycle !== '매월' && i.months?.includes(month))]
  const loose = items.filter((i) => i.cycle !== '매월' && !i.months?.length)
  const months = Array.from({ length: 12 }, (_, k) => k + 1)
    .map((m) => ({ m, list: items.filter((i) => i.cycle !== '매월' && i.months?.includes(m)) }))
    .filter((x) => x.list.length > 0)
  return (
    <section>
      <h1 className="page-h">신청·지급 달력</h1>
      <SampleNotice data={data} />
      <p className="sub">해마다, 다달이 챙기는 일을 모았어요. 날짜는 바뀔 수 있으니 눌러서 출처를 꼭 확인하세요. ({data?.checkedAt ?? ''} 확인)</p>
      <h2 className="cal-h">이번 달({month}월) 챙길 일</h2>
      <ul className="list" tabIndex={-1}>
        {thisMonth.map((it) => <CalItem key={it.id} it={it} />)}
        {data && thisMonth.length === 0 && <li className="empty">이번 달에 챙길 일이 없습니다.</li>}
      </ul>
      {months.length > 0 && <h2 className="cal-h">월별로 보기</h2>}
      {months.map(({ m, list }) => (
        <details key={m} className="check-guide" open={m === month}>
          <summary>{m}월 ({list.length}건)</summary>
          <ul className="list cal-inner">
            {list.map((it) => <CalItem key={it.id} it={it} />)}
          </ul>
        </details>
      ))}
      {loose.length > 0 && (
        <>
          <h2 className="cal-h">때가 정해져 있지 않은 일</h2>
          <ul className="list">
            {loose.map((it) => <CalItem key={it.id} it={it} />)}
          </ul>
        </>
      )}
      <TipBox />
    </section>
  )
}

function News() {
  const data = useData('news')
  const items = data?.items ?? []
  const pg = usePaged(items)
  return (
    <section>
      <h1 className="page-h">소식</h1>
      <SampleNotice data={data} />
      <p className="sub">공식 기관이 발표한 소식만 올립니다.</p>
      <ul className="list" tabIndex={-1}>
        {pg.slice.map((n) => (
          <li key={n.id} className="item">
            <details>
              <summary>
                <h2>{n.title}<NewMark on={isNew(today(), n.date)} /></h2>
                <span className="sum-tag">{n.date}</span>
              </summary>
              <div className="detail">
                <div className="tags"><span>{n.source}</span><span>{n.date}</span></div>
                <p>{n.summary}</p>
                <ExternalLink href={n.url} track={{ tab: 'news', org: n.source }} label={`${n.title} 원문 보기`}>원문 보기</ExternalLink>
              </div>
            </details>
          </li>
        ))}
        {data && items.length === 0 && <li className="empty">표시할 소식이 없습니다.</li>}
      </ul>
      <Pager pg={pg} />
      <TipBox />
    </section>
  )
}

// 지역 탭: 광역시는 가까운 도에 묶는다. region 칸 → '어디서' 요약 → 기관명 순으로 찾고, 못 찾으면 '전체'에만 보인다.
const REGIONS = [
  ['서울·경기', /서울|인천|경기/],
  ['강원', /강원/],
  ['충북', /충북|충청북/],
  ['충남·대전', /충남|충청남|대전|세종/],
  ['전북', /전북|전라북/],
  ['전남·광주', /전남|전라남|광주/],
  ['경북·대구', /경북|경상북|대구/],
  ['경남·부산·울산', /경남|경상남|부산|울산/],
  ['제주', /제주/],
]
const regionsOf = (i) => {
  const src = [i.region, i.easy?.어디서, i.org].find((s) => s && REGIONS.some(([, re]) => re.test(s))) || ''
  // '경기도 광주시'의 광주는 전남·광주가 아니다
  const txt = src.replace(/경기도?\s*광주/g, '경기')
  return REGIONS.filter(([, re]) => re.test(txt)).map(([k]) => k)
}

// 폰에서 옆으로 밀리는 칩 줄: 누른 칩을 가운데로 데려와 다음 칩이 보이게 한다
const chipIntoView = (e) => e.currentTarget.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })

// 공유하기: 공유창이 되는 기기는 시스템 공유창, 아니면 주소를 복사한다. 사용자가 공유창을 닫은 경우엔 아무 안내도 하지 않는다.
function ShareButton({ item }) {
  const [msg, setMsg] = useState('')
  const name = orgLabel(item.title, item.org)
  const url = jobShareUrl(window.location.origin, window.location.pathname, item.id)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      return true
    } catch {
      try {
        const ta = document.createElement('textarea')
        ta.value = url
        ta.setAttribute('readonly', '')
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(ta)
        return ok
      } catch { return false }
    }
  }
  const share = async () => {
    setMsg('')
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: `${name} - 모두품`, url })
        return
      } catch (e) {
        if (e && e.name === 'AbortError') return
      }
    }
    setMsg((await copy()) ? '주소를 복사했어요' : `주소를 복사하지 못했어요. 이 주소를 직접 복사해 주세요: ${url}`)
  }
  return (
    <>
      <button type="button" className="ask-btn share-btn" aria-label={`${name} 공고 공유하기`} onClick={share}>공유하기</button>
      <span className="share-msg" role="status" aria-live="polite">{msg}</span>
    </>
  )
}

function Jobs({ focusId = '' }) {
  const data = useData('jobs')
  const [sort, setSort] = useState('최신순')
  const all = useMemo(() => {
    const t = today()
    const open = (data?.items ?? []).filter((i) => i.end >= t).map((i) => ({ ...i, orgType: i.orgType || '공공기관', _regions: regionsOf(i) }))
    // 최신순: 올라온 날 내림차순, 마감임박순: 마감일 오름차순. 같으면 다른 기준으로 정한다.
    const byStart = (x, y) => String(y.start).localeCompare(String(x.start))
    const byEnd = (x, y) => String(x.end).localeCompare(String(y.end))
    return [...open].sort(sort === '최신순' ? (x, y) => byStart(x, y) || byEnd(x, y) : (x, y) => byEnd(x, y) || byStart(x, y))
  }, [data, sort])
  // 최근 신규 안내: start 기준(접수 중 공고만). NEW 배지와 같은 기준(NEW_DAYS)으로 센다. 0건이면 마지막 신규일을 보여준다.
  const fresh = useMemo(() => {
    const t = today()
    const days = all.map((i) => String(i.start || '').slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= t)
    if (!days.length) return null
    const newN = all.filter((i) => isNew(t, i.start)).length
    const last = days.reduce((a, b) => (a > b ? a : b))
    const week = days.filter((d) => Math.round((Date.parse(t) - Date.parse(d)) / 86400000) <= 6).length
    return { newN, last: last.slice(5), lastN: days.filter((d) => d === last).length, week }
  }, [all])
  const [area, setArea] = useState('전체')
  const areas = useMemo(() => ['전체', ...REGIONS.map(([k]) => k).filter((k) => all.some((i) => i._regions.includes(k)))], [all])
  const items = useMemo(() => (area === '전체' ? all : all.filter((i) => i._regions.includes(area))), [all, area])
  const pg = usePaged(items, area + sort)

  // 공유 주소(#/jobs/<id>)로 들어오면 지역 탭·쪽과 상관없이 그 공고를 찾아 펼친다. 없으면(마감 등) 안내만 한다.
  const [reveal, setReveal] = useState('')
  const [missing, setMissing] = useState(false)
  useEffect(() => {
    setMissing(false)
    setReveal('')
    if (!focusId || !data) return
    if (all.some((i) => String(i.id) === focusId)) { setArea('전체'); setReveal(focusId) } else setMissing(true)
  }, [focusId, data, all])
  useEffect(() => {
    if (!reveal || area !== '전체') return
    const n = pageOfId(items, reveal, PAGE_SIZE)
    if (n && n !== pg.page) { pg.setPage(n); return }
    const li = [...document.querySelectorAll('.list > li[data-job-id]')].find((el) => el.dataset.jobId === reveal)
    if (!li) return
    const d = li.querySelector('details')
    if (d) d.open = true
    li.scrollIntoView({ block: 'start' })
    li.querySelector('summary')?.focus({ preventScroll: true })
    setReveal('')
  }, [reveal, area, items, pg.page, pg.slice]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section>
      <h1 className="page-h">일자리</h1>
      {missing && <p className="share-gone" role="status">이 공고는 마감되어 내려갔어요. 아래에서 접수 중인 다른 공고를 확인해 보세요.</p>}
      <SampleNotice data={data} />
      {areas.length > 2 && (
        <div className="kinds kinds-row" role="group" aria-label="지역">
          {areas.map((k) => (
            <button key={k} className={k === area ? 'on' : ''} aria-pressed={k === area} onClick={(e) => { setArea(k); chipIntoView(e) }}>{k}</button>
          ))}
        </div>
      )}
      <div className="jobs-notes">
        {fresh && (
          <div className="fresh-bar" role="status">
            <strong>{fresh.newN > 0 ? `새 공고(NEW) ${fresh.newN}건!` : '지금 새 공고(NEW)가 없어요!'}</strong>
            <span className="fresh-sub">{fresh.newN > 0 ? '' : `마지막 신규 등록 ${fresh.last}(${fresh.lastN}건) · `}최근 7일 신규 {fresh.week}건</span>
          </div>
        )}
        {data?.updatedAt && <p className="sub">마지막 갱신 {data.updatedAt} · 접수 중 {all.length}건</p>}
        <details className="jobs-help">
          <summary>안내 보기</summary>
          <p className="sub">공공기관·국가기관·지자체의 채용 공고 가운데 제목에 장애인 대상이 명시된 공고를 싣습니다(예: 장애인 제한경쟁·장애인 구분모집). 제목에 없어도 공고문에 장애인 제한경쟁 모집분야가 있으면 '일부 모집분야만 장애인 대상'이라고 표시해 싣습니다. 장애인 대상이 드러나지 않은 일반 공개채용은 싣지 않습니다.</p>
        </details>
      </div>
      <div className="seg-wrap">
        <div className="seg" role="group" aria-label="정렬">
          {['최신순', '마감임박순'].map((k) => (
            <button key={k} className={k === sort ? 'on' : ''} aria-pressed={k === sort} onClick={() => setSort(k)}>{k}</button>
          ))}
        </div>
      </div>
      <ul className="list" tabIndex={-1}>
        {pg.slice.map((i) => {
          const left = daysLeft(i.end)
          const soon = left <= 3
          return (
            <li key={i.id} className="item" data-job-id={String(i.id)}>
              <details onToggle={(e) => { if (e.currentTarget.open) { try { window.umami?.track('easy-open', { type: 'job' }) } catch { /* 무시 */ } } }}>
                <summary>
                  <h2><Badges period={periodOf(today(), { end: i.end })} region={needsRegion(i, 'jobs')} />{orgLabel(i.title, i.org)}<NewMark on={isNew(today(), i.start)} />{i.mixed && <span className="mixed-chip">일부 분야만 장애인 대상</span>}</h2>
                  <span className={`sum-tag dday${soon ? ' soon' : ''}`}>{left === 0 ? '오늘 마감' : `마감 ${left}일 남음${i.end ? ` · ${String(i.end).slice(5).replace('-', '.')}` : ''}`}</span>
                </summary>
                <div className="detail">
                  {i.easy && (
                    <>
                      <dl className="job-brief" aria-label="쉬운 요약">
                        <div><dt>누가 지원할 수 있어요</dt><dd><ul>{(i.easy.누가 ?? []).map((t) => <li key={t}>{t}</li>)}</ul></dd></div>
                        <div><dt>몇 명</dt><dd>{i.easy.몇명}</dd></div>
                        <div><dt>무슨 일</dt><dd>{i.easy.무슨일}</dd></div>
                        <div><dt>일하는 시간</dt><dd>{i.easy.일하는시간}</dd></div>
                        <div><dt>급여</dt><dd>{i.easy.급여}</dd></div>
                        <div><dt>어떻게 지원해요</dt><dd>{i.easy.접수}</dd></div>
                        {i.easy.연장 && <div><dt>계약 기간 연장</dt><dd>{i.easy.연장}</dd></div>}
                        <div><dt>문의</dt><dd>{i.easy.문의}</dd></div>
                      </dl>
                      <p className="src-line">출처: {i.sourceLabel || i.source || i.org}</p>
                    </>
                  )}
                  <dl className="job-brief" aria-label="한눈에 보기">
                    <div><dt>언제까지</dt><dd>{i.easy ? `${i.easy.언제까지} (${left === 0 ? '오늘 마감' : `${left}일 남음`})` : (i.end ? `${i.end}까지 (${left === 0 ? '오늘' : `${left}일 남음`})` : NO_INFO)}</dd></div>
                    <div><dt>무슨 일 · 고용 형태</dt><dd>{i.easy ? i.easy.무슨일고용 : (i.verified === true ? infoOr(i.summary?.고용형태) : PENDING)}</dd></div>
                    <div><dt>어디서</dt><dd>{i.easy ? (i.easy.어디서 ?? NO_INFO) : ([i.org, i.region].filter(Boolean).join(' · ') || NO_INFO)}</dd></div>
                  </dl>
                  {i.mixed && (
                    <p className="period-note"><strong>일부 모집분야만 장애인 대상이에요.</strong> 해당 분야를 공고에서 꼭 확인하세요.{(i.mixedFields ?? []).length > 0 ? <><br />해당 분야: {i.mixedFields.join(' / ')}</> : null}{i.mixedEvidence ? <><br />공고에 적힌 글: {i.mixedEvidence}</> : null}</p>
                  )}
                  {(i.notes ?? []).map((n) => (
                    <p key={n} className="period-note"><strong>참고</strong> {n}</p>
                  ))}
                  {!i.easy && (
                    <div className="tags">
                      {soon && <span className="soon">{left === 0 ? '오늘 마감' : `마감 임박 · ${left}일 남음`}</span>}
                      <span>{i.org}</span>
                      <span>{i.orgType}</span>
                      <span>마감 {i.end}</span>
                      {i.source && <span>출처 {i.sourceLabel || i.source}</span>}
                    </div>
                  )}
                  {i.summary && i.verified === true && !i.easy && (
                    <dl className="job-summary" aria-label="공고 본문 요약">
                      <div><dt>채용 인원</dt><dd>{infoOr(i.summary.채용인원)}</dd></div>
                      <div><dt>고용 형태</dt><dd>{infoOr(i.summary.고용형태)}</dd></div>
                      <div><dt>어떻게 지원해요</dt><dd>{infoOr(i.summary.접수방법)}</dd></div>
                      <div><dt>장애인 관련 문구</dt><dd>{infoOr((i.summary.장애인관련 ?? []).join(' / '))}</dd></div>
                    </dl>
                  )}
                  <div className="detail-actions">
                    <ExternalLink href={i.url} track={{ tab: 'jobs', org: i.sourceLabel }} label={`${orgLabel(i.title, i.org)} 원문 보기${i.sourceLabel ? ` · 출처 ${i.sourceLabel}` : ''}`}>원문 보기{i.sourceLabel ? ` · 출처 ${i.sourceLabel}` : ''}</ExternalLink>
                    <ShareButton item={i} />
                  </div>
                  {i.source === '나라일터' && (
                    <p className="copy-note">모두품이 보관한 사본이에요. 최종 확인은 나라일터에서 해 주세요.{i.copiedAt ? ` (수집 ${i.copiedAt})` : ''}</p>
                  )}
                  {!i.easy && <AskHelp item={i} />}
                </div>
              </details>
            </li>
          )
        })}
        {data && items.length === 0 && <li className="empty">{all.length ? '이 지역에 접수 중인 공고가 없어요. \'전체\'를 눌러 보세요.' : '현재 접수 중인 공고가 없습니다.'}</li>}
      </ul>
      <Pager pg={pg} />
      <details className="check-guide">
        <summary>어려운 말 풀이</summary>
        <ul>
          <li>계약직: 정해진 기간만 일해요.</li>
          <li>정규직: 기간 없이 계속 일해요.</li>
          <li>시보(6개월): 정규직이 되기 전 시험 기간이에요.</li>
          <li>제한경쟁: 장애인만 지원할 수 있어요.</li>
        </ul>
      </details>
      <details className="check-guide">
        <summary>지원하기 전에 공고에서 확인할 것</summary>
        <ul>
          <li>지원 자격(장애 유형, 장애 정도)이 내게 맞는지</li>
          <li>중증장애인 우대 여부와 장애인등록증(또는 증명서) 제출 여부</li>
          <li>한국장애인고용공단 추천이 필요한지</li>
          <li>근무지 접근성과 출퇴근 지원, 재택·하이브리드 가능 여부</li>
          <li>근무시간 조정, 보조공학기기 지원, 면접·시험 편의 제공 여부</li>
          <li>수습 기간 적용 여부와 4대보험, 정규직 전환 조건</li>
        </ul>
        <p>일반적인 안내이며, 정확한 조건은 반드시 원문 공고에서 확인하세요.</p>
      </details>
      <MoreLinks kind="jobs" />
      <TipBox />
    </section>
  )
}

function About() {
  return (
    <section className="about">
      <h1 className="page-h">이용 안내</h1>
      <h2>모두품은</h2>
      <p>장애인과 가족이 복지 제도와 공공기관의 장애인 채용 공고를 한곳에서 찾아볼 수 있게 모아 안내합니다. 이용료도, 가입도 없습니다.</p>
      <h2>정보의 출처</h2>
      <p>복지는 복지로(한국사회보장정보원), 채용은 공공기관 채용정보를 공공데이터포털에서 받아 하루 세 번(오전 10시·오후 2시·6시 전후) 갱신합니다. 항목마다 출처와 원문 링크를 표시합니다.</p>
      <h2>알아두세요</h2>
      <p>신청 자격과 접수 기간은 바뀔 수 있으니 반드시 원문에서 확인하세요. 지원서를 받거나 채용을 알선하지 않습니다.</p>
      <h2>개인정보</h2>
      <p>가입과 로그인이 없고, 이용 기록으로 개인을 알아보지 않습니다.</p>
    </section>
  )
}

// 테스트 기간 동안 띄우는 설문 팝업. 서로 다른 날짜로 2번째 방문한 날부터 표시. '오늘은 닫기'는 오늘(한국 날짜)만, '다시 보지 않기'·설문 참여는 영구 숨김.
function SurveyPopup({ url }) {
  const [open, setOpen] = useState(false)
  const closeTodayRef = useRef(() => {})
  useEffect(() => {
    if (!url) return
    try {
      // 판단 순서: 영구 숨김 -> 종료일 -> 방문일 수(서로 다른 날 2번째부터) -> 오늘 닫음
      if (localStorage.getItem('survey-closed')) return
      if (today() > SURVEY_END) return
      const first = localStorage.getItem('survey-first-day')
      if (!first) {
        localStorage.setItem('survey-first-day', today())
        return
      }
      if (first === today()) return
      if (localStorage.getItem('survey-closed-day') === today()) return
    } catch {
      // 저장소를 쓸 수 없으면 방문일 수를 알 수 없으므로 띄우지 않는다(첫 방문 보호).
      return
    }
    const t = setTimeout(() => setOpen(true), 1500)
    return () => clearTimeout(t)
  }, [url])
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape') closeTodayRef.current() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])
  const hide = (key, value) => {
    try {
      localStorage.setItem(key, value)
    } catch {
      // 저장 실패는 무시한다.
    }
    setOpen(false)
  }
  const closeToday = () => hide('survey-closed-day', today())
  const closeForever = () => hide('survey-closed', '1')
  closeTodayRef.current = closeToday
  return (
    <>
      <p className="sr" role="status">{open ? '화면 아래에 테스트 설문 안내가 있습니다. Esc 키로 닫을 수 있습니다.' : ''}</p>
      {open && (
        <div className="survey-pop" role="dialog" aria-modal="false" aria-labelledby="survey-t">
          <div className="survey-box">
            <button className="survey-close" aria-label="닫기" onClick={closeToday}>×</button>
            <h2 id="survey-t">테스트 설문 (1분)</h2>
            <p>한두 문항만 답해 주세요.</p>
            <div className="survey-row">
              <ExternalLink className="tip-btn" href={url} onClick={closeForever}>설문 참여하기</ExternalLink>
              <button className="survey-x" onClick={closeToday}>오늘은 닫기</button>
              <button className="survey-x" onClick={closeForever}>다시 보지 않기</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// 방문 수 익명 집계(GoatCounter). site.json 의 analytics.goatcounter 코드가 비어 있으면 아무것도 하지 않는다.
function useAnalytics(code, tab) {
  const on = typeof code === 'string' && /^[a-z0-9-]+$/i.test(code) && typeof window !== 'undefined' &&
    !['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname) && navigator.doNotTrack !== '1'
  const tabRef = useRef(tab)
  const ready = useRef(false)
  tabRef.current = tab
  const count = () => {
    try { window.goatcounter?.count?.({ path: `/${tabRef.current}` }) } catch { /* 집계 실패는 무시 */ }
  }
  useEffect(() => {
    if (!on) return undefined
    try {
      window.goatcounter = { no_onload: true }
      const s = document.createElement('script')
      s.async = true
      s.dataset.goatcounter = `https://${code}.goatcounter.com/count`
      s.src = 'https://gc.zgo.at/count.js'
      s.onload = () => { ready.current = true; count() }
      s.onerror = () => {}
      document.head.appendChild(s)
    } catch { /* 무시 */ }
    return undefined
  }, [on, code])
  useEffect(() => { if (on && ready.current) count() }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps
  return on
}

const readRoute = () => parseRoute(window.location.hash, ROUTES)

const SEEN_KEY = 'tab-seen-'
const readSeen = (id) => { try { return localStorage.getItem(SEEN_KEY + id) || '' } catch { return '' } }

// 탭별 최신 새 글 날짜(복지=firstSeen, 일자리=start, 소식=date, 홈=세 탭 중 최신, 신청=날짜 데이터 없어 제외). 열람하면 그 날짜까지 본 것으로 저장한다.
function useTabNew(tab) {
  const welfare = useData('welfare')
  const jobs = useData('jobs')
  const news = useData('news')
  const [seen, setSeen] = useState(() => ({ home: readSeen('home'), welfare: readSeen('welfare'), jobs: readSeen('jobs'), news: readSeen('news') }))
  const t = today()
  const newest = {
    welfare: newestNew(t, (welfare?.items ?? []).map((i) => i.firstSeen)),
    jobs: newestNew(t, (jobs?.items ?? []).map((i) => i.start)),
    news: newestNew(t, (news?.items ?? []).map((i) => i.date)),
  }
  newest.home = [newest.welfare, newest.jobs, newest.news].sort().pop()
  const cur = newest[tab] || ''
  useEffect(() => {
    if (!cur) return
    try { localStorage.setItem(SEEN_KEY + tab, cur) } catch { /* 저장 실패 시 배지는 계속 표시 */ }
    setSeen((s) => ({ ...s, [tab]: cur }))
  }, [tab, cur])
  return (id) => (id in newest && id !== tab ? showTabNew(newest[id], seen[id]) : false)
}

export default function App() {
  const [route, setRoute] = useState(readRoute)
  const tab = route.tab
  const site = useData('site')
  const counting = useAnalytics(site?.analytics?.goatcounter, tab)
  const hasNew = useTabNew(tab)
  const mainRef = useRef(null)
  const first = useRef(true)

  const setTab = (id) => {
    window.location.hash = id === 'home' ? '' : `#/${id}`
    window.scrollTo({ top: 0 })
  }

  useEffect(() => {
    const onHash = () => setRoute(readRoute())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    document.title = TITLES[tab]
    if (first.current) {
      first.current = false
      return
    }
    mainRef.current?.focus()
  }, [tab])

  return (
    <>
      <a className="skip" href="#main" onClick={(e) => { e.preventDefault(); mainRef.current?.focus() }}>본문 바로가기</a>
      <header className="nav">
        <div className="nav-inner">
          <button className="brand" onClick={() => setTab('home')} aria-label="모두품 홈">
            <img src="./brand/app-icon.svg" alt="" width="38" height="38" onError={(e) => (e.currentTarget.style.display = 'none')} />
            모두품
          </button>
          <nav aria-label="주 메뉴">
            {TABS.map((t) => (
              <button key={t.id} data-umami-event={t.id === 'calendar' ? 'calendar-open' : undefined} className={tab === t.id ? 'on' : ''} aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>{t.label}{hasNew(t.id) && <><span className="tab-new" aria-hidden="true">NEW</span><span className="sr">, 새 글 있음</span></>}</button>
            ))}
          </nav>
        </div>
      </header>
      <main id="main" ref={mainRef} tabIndex={-1}>
        {tab === 'home' && <Home go={setTab} />}
        {tab === 'welfare' && <Welfare />}
        {tab === 'jobs' && <Jobs focusId={route.jobId} />}
        {tab === 'apply' && <Apply />}
        {tab === 'calendar' && <Calendar />}
        {tab === 'news' && <News />}
        {tab === 'about' && <About />}
      </main>
      <SurveyPopup url={site?.feedbackUrl} />
      <footer>
        <p>공공데이터를 바탕으로 안내합니다. 정확한 내용은 반드시 원문에서 확인하세요.</p>
        <p className="foot-row">
          <button className="foot-link" onClick={() => setTab('about')}>이용 안내</button>
          {site?.feedbackUrl && <ExternalLink className="foot-link" href={site.feedbackUrl}>의견 보내기</ExternalLink>}
        </p>
        {counting && <p>방문 수만 익명으로 집계합니다(쿠키·개인정보 수집 없음).</p>}
      </footer>
    </>
  )
}
