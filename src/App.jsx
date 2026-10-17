import { useEffect, useMemo, useRef, useState } from 'react'

const TABS = [
  { id: 'home', label: '홈' },
  { id: 'welfare', label: '복지' },
  { id: 'jobs', label: '일자리' },
  { id: 'apply', label: '신청' },
  { id: 'news', label: '소식' },
]
const ROUTES = [...TABS.map((t) => t.id), 'about']
const TITLES = { home: '모두품', welfare: '복지 - 모두품', jobs: '일자리 - 모두품', apply: '신청 안내 - 모두품', news: '소식 - 모두품', about: '이용 안내 - 모두품' }

const today = () => new Date().toISOString().slice(0, 10)

const PAGE_SIZE = 10

function usePaged(items, resetKey = '') {
  const [page, setPage] = useState(1)
  useEffect(() => { setPage(1) }, [resetKey, items.length])
  const total = Math.max(1, Math.ceil(items.length / PAGE_SIZE))
  const cur = Math.min(page, total)
  const slice = items.slice((cur - 1) * PAGE_SIZE, cur * PAGE_SIZE)
  const go = (n) => {
    setPage(n)
    window.scrollTo({ top: 0 })
  }
  return { slice, page: cur, total, go, count: items.length }
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

function ExternalLink({ href, className, children }) {
  return (
    <a className={className} href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <span className="sr"> (새 창에서 열림)</span>
    </a>
  )
}

function SampleNotice({ data }) {
  if (!data?.sample) return null
  return <p className="notice">지금은 샘플 화면입니다. 공공 데이터가 연결되면 실제 정보로 바뀝니다.</p>
}

function Home({ go }) {
  return (
    <section className="hero">
      <span className="mono">Modupum — Information for everyone</span>
      <h1>모두를<br />품는<br /><span className="glow">정보.</span></h1>
      <p className="lead">복지 제도와 공공기관 장애인 채용 공고를 한곳에서 쉽게 찾아보세요.</p>
      <ul className="index">
        <li>
          <button onClick={() => go('welfare')}>
            <span className="no" aria-hidden="true">01</span>
            <span className="t">복지</span>
            <span className="d">받을 수 있는 복지서비스 찾기 →</span>
          </button>
        </li>
        <li>
          <button onClick={() => go('jobs')}>
            <span className="no" aria-hidden="true">02</span>
            <span className="t">일자리</span>
            <span className="d">공공기관 장애인 채용 공고 →</span>
          </button>
        </li>
        <li>
          <button onClick={() => go('apply')}>
            <span className="no" aria-hidden="true">03</span>
            <span className="t">신청 안내</span>
            <span className="d">이용권·바우처 신청 방법 →</span>
          </button>
        </li>
        <li>
          <button onClick={() => go('news')}>
            <span className="no" aria-hidden="true">04</span>
            <span className="t">소식</span>
            <span className="d">공식 기관이 발표한 복지 소식 →</span>
          </button>
        </li>
        <li>
          <button className="soon" disabled>
            <span className="no" aria-hidden="true">05</span>
            <span className="t">커뮤니티</span>
            <span className="d">준비 중</span>
          </button>
        </li>
      </ul>
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
    <section className="more" aria-labelledby={`more-${kind}`}>
      <h2 id={`more-${kind}`} className="more-title">더 찾아보기</h2>
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
    </section>
  )
}

function Welfare() {
  const data = useData('welfare')
  const [q, setQ] = useState('')
  const items = useMemo(() => {
    const list = data?.items ?? []
    const k = q.trim()
    return k ? list.filter((i) => `${i.title}${i.summary}${i.category}${i.target}`.includes(k)) : list
  }, [data, q])
  const pg = usePaged(items, q)

  return (
    <section>
      <h1 className="page-h">복지</h1>
      <SampleNotice data={data} />
      <input className="search" type="search" placeholder="검색어를 입력하세요" value={q} onChange={(e) => setQ(e.target.value)} aria-label="복지 검색" />
      <p className="sr" role="status">{data ? `${items.length}건` : ''}</p>
      <ul className="list">
        {pg.slice.map((i) => (
          <li key={i.id} className="item">
            <details>
              <summary>
                <h2>{i.title}</h2>
                <span className="sum-tag">{i.category}</span>
              </summary>
              <div className="detail">
                <div className="tags"><span>{i.category}</span><span>{i.target}</span></div>
                <p>{i.summary}</p>
                <ExternalLink href={i.url}>원문 보기 · 출처 {i.source}</ExternalLink>
              </div>
            </details>
          </li>
        ))}
        {data && items.length === 0 && <li className="empty">표시할 항목이 없습니다.</li>}
      </ul>
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
      <p className="mono only-note">{data?.scope ?? ''}</p>
      <p className="apply-note">금액과 기준은 해마다, 지역마다 달라집니다. 신청하기 전에 아래 원문 안내에서 다시 확인하세요. 확인한 날: {data?.checkedAt ?? ''}</p>
      <ul className="list">
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

function News() {
  const data = useData('news')
  const items = data?.items ?? []
  const pg = usePaged(items)
  return (
    <section>
      <h1 className="page-h">소식</h1>
      <SampleNotice data={data} />
      <p className="mono only-note">공식 기관이 발표한 소식만 원문 링크와 함께 올립니다</p>
      <ul className="list">
        {pg.slice.map((n) => (
          <li key={n.id} className="item">
            <details>
              <summary>
                <h2>{n.title}</h2>
                <span className="sum-tag">{n.date}</span>
              </summary>
              <div className="detail">
                <div className="tags"><span>{n.source}</span><span>{n.date}</span></div>
                <p>{n.summary}</p>
                <ExternalLink href={n.url}>원문 보기</ExternalLink>
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

function Jobs() {
  const data = useData('jobs')
  const items = useMemo(() => {
    const t = today()
    // 장애인만 지원할 수 있는 공고(장애인 전용·제한경쟁)만 보여 준다. 우대 공고와 마감된 공고는 제외.
    return (data?.items ?? []).filter((i) => i.end >= t && i.disabledOnly)
  }, [data])
  const pg = usePaged(items)

  return (
    <section>
      <h1 className="page-h">일자리</h1>
      <SampleNotice data={data} />
      <p className="mono only-note">장애인만 지원할 수 있는 공공기관 채용 공고만 모았습니다</p>
      <ul className="list">
        {pg.slice.map((i) => (
          <li key={i.id} className="item">
            <details>
              <summary>
                <h2>{i.title}</h2>
                <span className="sum-tag">마감 {i.end}</span>
              </summary>
              <div className="detail">
                <div className="tags"><span>{i.org}</span><span>마감 {i.end}</span></div>
                <ExternalLink href={i.url}>원문 보기</ExternalLink>
              </div>
            </details>
          </li>
        ))}
        {data && items.length === 0 && <li className="empty">현재 접수 중인 공고가 없습니다.</li>}
      </ul>
      <Pager pg={pg} />
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
  const hasTip = Boolean(tipHref(useData('site')))
  return (
    <section className="about">
      <h1 className="page-h">이용 안내</h1>
      <h2>모두품은</h2>
      <p>장애인과 가족이 복지 제도와 공공기관의 장애인 채용 공고를 한곳에서 찾아볼 수 있도록 정보를 모아 안내합니다. 이용료가 없고 가입도 필요하지 않습니다.</p>
      <h2>정보의 출처</h2>
      <p>복지 정보는 복지로(한국사회보장정보원), 채용 공고는 공공기관 채용정보(재정경제부)를 바탕으로 합니다. 공공데이터포털에서 받아 하루 세 번(10시, 14시, 18시) 갱신하며, 항목마다 출처와 원문 링크를 표시합니다.</p>
      <h2>확인해 주세요</h2>
      <p>이곳의 내용은 안내를 돕기 위한 것입니다. 신청 자격과 접수 기간은 바뀔 수 있으니 반드시 원문에서 확인하세요.</p>
      <h2>하지 않는 일</h2>
      <p>지원서를 받지 않으며, 채용을 알선하거나 사람을 추천하지 않습니다.</p>
      <h2>개인정보</h2>
      <p>가입과 로그인이 없고, 이용 기록으로 개인을 알아보지 않습니다.{hasTip ? ' 정보를 알려 주시는 경우 보내신 내용은 확인하고 올리는 데에만 사용합니다.' : ''}</p>
    </section>
  )
}

const readHash = () => {
  const h = window.location.hash.replace('#/', '').replace('#', '')
  return ROUTES.includes(h) ? h : 'home'
}

export default function App() {
  const [tab, setTabState] = useState(readHash)
  const site = useData('site')
  const mainRef = useRef(null)
  const first = useRef(true)

  const setTab = (id) => {
    window.location.hash = id === 'home' ? '' : `#/${id}`
    window.scrollTo({ top: 0 })
  }

  useEffect(() => {
    const onHash = () => setTabState(readHash())
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
              <button key={t.id} className={tab === t.id ? 'on' : ''} aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>{t.label}</button>
            ))}
          </nav>
        </div>
      </header>
      <main id="main" ref={mainRef} tabIndex={-1}>
        {tab === 'home' && <Home go={setTab} />}
        {tab === 'welfare' && <Welfare />}
        {tab === 'jobs' && <Jobs />}
        {tab === 'apply' && <Apply />}
        {tab === 'news' && <News />}
        {tab === 'about' && <About />}
      </main>
      <footer>
        <p>모두품은 공공데이터를 바탕으로 정보를 안내합니다. 항목마다 출처와 원문 링크를 표시하며, 정확한 내용은 반드시 원문에서 확인하세요.</p>
        <p>지원서 접수나 채용 알선은 하지 않습니다.</p>
        <p>
          <button className="foot-link" onClick={() => setTab('about')}>이용 안내</button>
          {site?.feedbackUrl && <ExternalLink className="foot-link foot-gap" href={site.feedbackUrl}>의견 보내기</ExternalLink>}
        </p>
      </footer>
    </>
  )
}
