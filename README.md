# 모두품 (장애인 정보 공유)

복지 제도와 공공기관 장애인 채용 공고를 모아 보여 주는 가입 없는 정보 사이트입니다.

## 구조
- `src/` React + Vite 화면
- `public/data/*.json` 화면이 읽는 데이터 (자동 수집이 갱신)
- `public/brand/` 로고와 아이콘, `showcase.html`(브랜드 예시), `ideas.html`(로고 아이디어)
- `scripts/collect.mjs` 공공 API에서 데이터를 받아 JSON으로 저장
- `.github/workflows/update-and-deploy.yml` 하루 3번(한국시간 오전 10시·오후 2시·6시 전후, GitHub 스케줄 특성상 지연될 수 있음) 갱신과 배포

## 개발
```bash
npm install
npm run dev
```

## 비밀값
공공데이터포털 서비스키는 코드나 파일에 쓰지 않습니다. GitHub 저장소의
Settings → Secrets and variables → Actions 에 `DATA_GO_KR_KEY` 로만 등록합니다.

## 원칙
- 모든 항목에 출처 기관명과 원문 링크를 표시한다.
- 일자리는 원문 링크만 제공한다. 지원서 접수, 추천, 알선은 하지 않는다.
- 민간 언론사 기사는 허락 없이 자동 수집하지 않는다.
- 회원가입과 개인정보 수집은 하지 않는다. (커뮤니티는 나중 단계)

## 남은 일
1. 공공데이터포털 활용신청 (복지로 중앙부처복지서비스, 인사혁신처 공공채용정보)
2. 활용가이드의 응답 항목을 확인해 `scripts/collect.mjs` 구현
3. GitHub 저장소 생성, Secrets 등록, Pages 켜기
