# 📱 폰 가능 · 연결보기 2차 구현 계획

사용자 2026-10-12 지시 §0–11을 구현한다. 규칙 원문은 AGENTS.md만 따른다.
시작 SHA: `05f7840bea0f129b3c84dbf954a70668a56eda4a` (origin/main fetch).
기존 클라우드 checkout의 지정 작업 브랜치에서 작업한다.

목표: 사용자가 승인한 기록 요약을 연결 RPC로 보내고 조직·프로젝트·홈에서 읽고 CAS로 수정한다.
기술: 기존 ES 모듈·Runtime API/RLS·Node·격리 PostgreSQL·Playwright Chromium·Deno.

## 공통 인터페이스

- `app/basket-link-records.js`: `readLinkRecords({kind,targetIds,linkId,weekStart,weekEnd},rt)` → `{id,summary,note_id,organization_id,project_id,occurred_at,raw_text,type:'basket'}[]`. 같은 업무공간 confirmed note 출처 조직/프로젝트만 페이지 조회. `readRecordPages(path,rt)`는 기존 100행 페이지 방식. `validateLinkSummary(text)`는 원문 보존·Unicode 공백·1–2,000 code point 검사. `updateLinkSummary(id,expected,summary,rt)`는 CAS RPC만. `linkRecordHtml(row)`는 텍스트 이스케이프·메모 날짜·원문 URL·요약 수정 버튼. `mountLinkSummaryEditor(host,{getRecord,isCurrent,onUpdated},rt)`는 이벤트 위임과 메모리 초안, 반환 `clear()/dispose()/hasDraft()`.
- 갱신 이벤트 `kptu:basket-links-changed`: 확정/수정 완료 또는 통신 결과 불명 뒤 관련 표시 재조회. 이벤트 detail은 원문/요약을 포함하지 않는다.

## 작업·검증

1. 공통 처리·연결 전 편집: Node/RPC payload·Unicode·페이지·CAS 실패 테스트와 Chromium 목적지별 초안 테스트 RED → 검증/조회/수정/공통 편집/confirm summary 구현 → GREEN. NULL 예상값 정확성·결과 불명 자동재전송 금지·중복 탭/세션 guard 확인.
2. AI 안내: 날짜·상태·숫자 보존/합성 원문·좋고 나쁜 예 테스트 RED → 브라우저/Edge 배포 내부 동일 안내 → GREEN. 5종 파서와 #500 필터/#504 복사 유지.
3. 조직/프로젝트 상세: 혼합 기록·별도 프로젝트 접힌 목록·NULL/보관·요약 수정·늦은 조회/저장 테스트 RED → 공통 조회/행/editor 연결 → GREEN. 기존 삭제와 계층/메뉴 유지, 이중 쓰기 없음.
4. 홈: 메모 날짜/KST/활성+담당/두 종류 합산 최신5/동시각/실패/캐시·세션 테스트 RED → 기존 홈 조회·모델·캐시 확장 → GREEN. 별도 저장소 없음.
5. 통합: 캐시 index까지 전파·버전 기대/smoke 갱신. Node 전체·격리 PG 연결보기/4a·Chromium 390/1280 키보드/터치 및 전체 회귀·Deno check/lint/functions-only bundle/안내 동일성·저장소 감사.
6. 검토: 공통 권한/세션 경계·새로운 초안 손실·RPC 성공 후 재조회 실패·관련 화면 전환·조회량 초과를 확인. Drive 조직 사본 최근4주 추가는 조사/제안만.
7. PR/최종 SHA 자동 CI 확인·AGENTS 12항목 PR 댓글·원장 같은 행 갱신. 배포/폰 확인 대기, 운영/DB/수동workflow/merge 금지.

## #507 상세 전환 보완 계획

2026-10-12 사용자 보완 지시를 따른다. 기존 branch/PR을 유지한다. 새 fetch main `05f7840bea0f129b3c84dbf954a70668a56eda4a`, 보완 시작 head `f553a3c0c831e74b9eb8687d16c48feefe80b2d6`.

- [x] 조직/프로젝트 390/1280에서 A 렌더 → B 상세 지연 → 갱신 이벤트의 실패를 먼저 확인한다. 새 `basket-link-transition.spec.mjs`는 제목·행·건수·편집기 및 B 로드 뒤 최신 요약을 검사한다.
- [x] 기존 상세 소유자가 요청 대상·로드된 상세 ID·렌더된 DOM ID를 함께 검사한다. 전환 중에는 링크/오류/편집기를 반영하지 않고 메모리 갱신 표시를 보류한다. 렌더와 모달 준비 뒤 보류된 조회를 실행한다. 닫기/세션에서 보류 표시를 정리한다.
- [x] 실제 늦은 CAS 성공 이벤트, 역순 응답, B 로드 실패, 닫기/뒤로가기/세션, 초안/NULL CAS를 검사한다. 새 대상 실패는 새 기록을 이전 제목 아래 게시하지 않는다. 데이터 변경/RPC/URL/권한 구조는 유지한다.
- [ ] 상세 모듈 버전을 index까지 올리고 기존 기대값/smoke를 맞춘다. Node 전체·관련 상세/홈/바구니·전체 Chromium·최종 자동 CI를 확인한다. 이전 로컬4실패와 새 결과/clean main 대조를 구분한다.
- [ ] 원장 기존 연결보기 행·검토 문서와 12항목 PR 보고를 갱신한다. 운영 순서/Edge 복구 ref를 유지하고 파일/PR/자동 CI 뒤 정지한다.

## 운영 준비(유지)

DB `20261012100000` 적용 완료(#12→#13). 새 migration/DB/RLS 변경 없음.
CC 검토 → 사용자 머지 승인 → 화면 squash merge → 사용자 drive-summary 승인 재배포 → 폰 확인 → CC 문서 PR.
현재 v6/source `e1d74835f62a4a15e8c35905475c6869ebb4c973`. 재배포 직전 source 전체 SHA를 다시 확인해 복구 ref로 사용.
`verify_jwt=keep`, `first_deploy=false`, `expect_unauth_401=true`. 운영 표 버전 사전 상승 없음.
화면 PR revert; UI 문제로 요약 칸/저장값 삭제하지 않는다. DB 필요 시 CC 별도 검토·요약 보존·원자적 SQL Editor 복구. rollback 버튼 안내 금지.
