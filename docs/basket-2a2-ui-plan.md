# BASKET-2a-2 화면 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 기존 바구니 입력·상세에 순차 파일 첨부와 첨부 조회를 연결하고 AI 제외 표시를 숨긴다.
**Architecture:** `basket-upload.js`가 메모별 첨부 순차 전송·사본 생성·오류 중단과 기존 자료실 선택 UI 패턴을 담당한다. `home-quick.js`와 `basket.js`는 기존 상태 소유권·세션 경계를 유지한다. 글만 저장은 `basket-data.js` REST 경로를 유지한다.
**Tech Stack:** 기존 JavaScript ES modules, KPTURuntime, Playwright/Chromium, Node test.
**Spec:** 2026-10-10 사용자 BASKET-2a-2 화면 지시와 `supabase/functions/basket-files/README.md` 계약.

## Global Constraints

- 시작 SHA b466910e32e8e1a68e2570059144d96985791f59. 브랜치 codex/basket-2a2-ui.
- 파일당 104857600 bytes, 메모당 첨부 20개, 원문 20,000 Unicode 문자.
- `copyUploadFile` 사본을 만들고 한 요청에 한 파일만 전송. 첫 성공 뒤 note_id 재사용.
- 503 결과 불명·409 note_changed 중단, 완료 파일 재전송 없음. 운영·DB·RLS·Edge·서버 함수 변경/실행 없음.
- AI 제외 UI 호출 없음. 새 메모 ai_export_allowed 필드 생략, 기존 값 보존.
- 캐시 변경은 index.html 및 고정 버전 검사까지 반영. PR 생성 후 merge는 커맨드센터.

## Review Focus

- 첫 파일 성공 후 후속 오류: 성공 파일 보존·중복 전송 없음.
- 파일 사본 생성 중 사용자/공간 전환: 후속 요청·화면 복원 금지.
- 글 수정 중 기존 메모 첨부 추가: 미저장 원문 유지.
- 결과 불명·응답 손실: 큐 정지 후 명시적 확인, 자동 전송 없음.
- 악성 Drive ID/파일 이름: 안전한 링크와 텍스트 표시.

### Task 1: 첨부 전송과 화면

**Files:** app/basket-upload.js, app/basket-data.js, app/home-quick.js, app/basket.js; tests/basket-upload.test.mjs, tests/basket-data.test.mjs, tests/app-e2e/basket.spec.mjs.
**Interfaces:** createUploadBatch(note_id, attachments), uploadBatch(batch, {raw_text, rt, isCurrent, onChange}), mountBasketPicker(host, options), driveFileUrl(id).

- [x] Node·브라우저 실패 테스트 작성·확인.
- [x] 순차 전송·원문/첨부 조회·AI 숨김 구현 및 세션/중복/오류 검증.
- [x] 관련 Node·390/1280px Chromium spec 통과 및 캡처 확인.

### Task 2: 캐시·운영 기록·검증·PR

**Files:** app/home-read.js, app/view-loader.js, app/loader-v2.js, app/app.js, app/index.html, 버전 기대 spec, .github/workflows/app-smoke-check.yml, docs/roadmap.md, docs/migration-history.md, docs/web2-env6b-edge-source.md.

- [x] 캐시 의존 체인·고정 버전 기대 갱신.
- [x] 사용자 제공 DB 2차 apply·basket-files v1 배포 사실과 원장 진행중/대기 행 기록.
- [x] 정적·Node·기존 자료실/회의/홈 관련 spec 실행. 서버/DB 테스트 실행 제외.
- [ ] diff 검토·커밋·push 후 연결 GitHub PR 생성, CI 조회·12항목 보고. merge 없음.
