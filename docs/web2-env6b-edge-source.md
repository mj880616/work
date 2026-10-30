# ENV-6b: 원본 없는 Edge Function 원본 확보 · 계정-1 사후 검증

- 작업일: 2026-09-26
- 기준: `main` `9e273e2` (#320 포함)
- 세션: 로컬. production은 조회·내려받기만 했다. Supabase MCP read-only `execute_sql`(SELECT), `supabase functions list`, `supabase functions download --use-api`(Docker 없이 서버에서 풀어 받기). 배포·삭제·DB 쓰기 없음.
- 앞 작업: [계정-1 · ENV-6 조사 문서](web2-account1-env6-investigation.md). 함수 판정표는 그 문서 3.3절.

## 1. 계정-1 사후 검증 (읽기 전용)

사용자가 1~6단계를 실행한 뒤 로컬에서 다시 조회했다. 조사 문서 "사후 확인 2"의 기대값과 모두 같다.

| 항목 | 기대 | 조회 결과 |
| --- | --- | --- |
| 전체 계정 | 1 | 1 |
| 9/21 이전 가입 계정 | 1 | 1 |
| Web2 구성원 | 1(owner) | 1(owner) |
| 프로필 | 1 | 1 |
| 쪽지 | 0 | 0 |
| 할 일 | 58 | 58(모두 본인 담당, 담당자 없는 할 일 0) |
| 접근 요청 | 0 | 0 |
| Google 캘린더 연결 | 1(본인) | 1(본인) |
| Google 연결 시도 흔적 | | 1(본인, 만료된 것) |

### 1.1 할 일 화면 57건 vs DB 58건

- DB 58건: 완료 56 + 미완료 2.
  - 미완료 ①: 프로젝트 할 일(프로젝트 연결됨, 기한 9/28).
  - 미완료 ②: 회의 후속 할 일(기한 9/12). **계정-1 A단계에서 삭제된 계정 B → 본인으로 담당자를 옮긴 그 1건이다.** A단계의 수정은 `updated_at`을 바꾸지 않아 수정 시각이 9/12 그대로다.
- 할 일 화면(`app/task-layout.js` `render()`)은 `workspace_id` = 본인 작업공간, `assignee_id` = 본인인 할 일을 **전부** 불러온다. 상태·출처·기한으로 거르는 조건이 없고, 미완료/완료만 나눈다(`group()`). 표 권한(RLS `task12a_owner_all`)도 작업공간 owner에게 전부 허용한다.
- 따라서 현재 DB 상태로 화면을 새로 열면 미완료 2 + 완료 56 = 58건이 나와야 한다.
- 57건이 보인 이유(추정, 조회로 확인할 수 있는 범위): 화면을 본 시점에 회의 후속 할 일의 담당자가 아직 계정 B였다(A단계 전), 또는 A단계 뒤 화면을 새로 불러오지 않았다. A단계 전에는 본인 담당이 57건(완료 56 + 미완료 1)으로 화면 숫자와 정확히 같다.
- 확인 방법: 할 일 화면을 새로 고쳐 미완료가 2건인지 본다. 2건이 아니면 다시 조사한다(고치지 않았다).
- 이 할 일들은 결정사항(기존 할 일 58건 보관 없이 삭제, 21·29)에 따라 없어질 예정이다.

## 2. 원본 확보

### 2.1 방법

- 17개 모두 `supabase functions download <이름> --project-ref <ref> --use-api`로 받았다. 받은 원본 17개와 SHA-256은 사용자 PC(저장소 밖)에도 보관했다.
- 제품별 저장소: Web1·Web2 함수는 이 저장소 `supabase/functions/<이름>/index.ts`, 읽생기 함수 3개는 read-think-write 저장소 같은 경로.
- 커밋 전 검사: 키·토큰·비밀번호 형식(JWT, API 키, 개인 키, 이메일, 전화번호, 긴 16진수·base64 문자열, `password`·`secret`·`token`·`MASTER` 대입)을 검색하고 17개 파일을 모두 눈으로 읽었다. 환경변수(`Deno.env.get`)로 읽는 키는 문제없다.
- 저장소에 넣은 파일은 내려받은 파일과 같은 바이트다(아래 SHA-256).

### 2.2 verify_jwt 기록 (다음 배포 때 값을 바꾸지 않기 위한 기준)

원본 없던 17개만 담은 당시 기록이다. **production 함수 전체의 현재 값은 5절 표가 기준이다.**

저장소에는 `config.toml`이 없다. 기존처럼 문서에 함수별 현재 값을 적는다. 배포할 때는 이 값을 그대로 유지한다: `false`면 `--no-verify-jwt`를 붙이고, `true`면 붙이지 않는다. 시각은 KST, 2026-09-26 `functions list` 기준.

| 이름 | 제품 | 버전 | 마지막 배포 | verify_jwt | 저장소 | SHA-256(앞 16자) |
| --- | --- | --- | --- | --- | --- | --- |
| `auth-handoff` | Web2 | v3 | 09-12 09:13 | false | work, 커밋 | `10b516c07eb7ddf2` |
| `pc0914-checklist` | Web1 공개 페이지 | v4 | 09-11 15:41 | false | work, 커밋 | `bac2bd124c046ce7` |
| `wedding-mc-shared` | 개인 공개 페이지 | v2 | 09-13 22:25 | false | work, 커밋 | `9ed02871a1a8171c` |
| `kptu-board-probe` | 시험용 | v2 | 09-18 22:00 | false | work, 커밋 | `d97b1b9737b6c8fe` |
| `push-notifications` | Web2(제거된 알림) | v4 | 09-25 08:38 | true | work, 커밋 | `d255848a733c1dc7` |
| `rail-1007-page` | Web1 공개 페이지 초기 시도 | v3 | 09-13 05:41 | false | work, 커밋 | `dcc913989474cee6` |
| `rail-1007-page-v2` | Web1 공개 페이지 초기 시도 | v3 | 09-13 05:42 | false | work, 커밋 | `942e4bd15e8e4501` |
| `pc0914-storage-test` | 시험용 | v5 | 09-18 09:05 | true | work, 커밋 | `392ec62968f3f33f` |
| `pc-file-test` | 시험용 | v3 | 09-18 09:05 | true | work, 커밋 | `392ec62968f3f33f` |
| `rail-1007-plan` | Web1 공개 페이지 | v6 | 09-13 06:27 | false | **커밋 안 함**(2.3) | `7fcaa7bf0d0ebd79` |
| `rail-declaration-comments` | Web1 공개 페이지 | v3 | 09-11 03:57 | false | **커밋 안 함**(2.3) | `1ffde26513400685` |
| `rail-declaration-content` | Web1 공개 페이지 | v4 | 09-11 04:10 | false | **커밋 안 함**(2.3) | `8f367208f1886ede` |
| `press-conference-files` | Web1 공개 페이지 | v4 | 09-14 08:49 | false | **커밋 안 함**(2.3) | `b6b47dc408fa5117` |
| `joint-struggle-files` | Web1 공개 페이지 | v3 | 09-12 23:08 | false | **커밋 안 함**(2.3) | `ac2cea90ef3c123b` |
| `rtw-beta-status` | 읽생기 | v1 | 09-21 13:35 | false | read-think-write, 커밋 | `a95ecbe3f936a503` |
| `rtw-owner-claim` | 읽생기(옛 버전) | v3 | 09-18 21:57 | false | read-think-write, 커밋 | `74fcc8598ef940b1` |
| `rtw-owner-setup` | 읽생기(옛 버전) | v4 | 09-17 20:44 | false | read-think-write, 커밋 | `8834e58cde6cdb8b` |

- `pc0914-storage-test`와 `pc-file-test`는 내용이 같은 종료 응답(410)이다.
- `push-notifications`·`rtw-owner-setup`도 종료 응답(410)만 돌려주는 코드다.

### 2.3 커밋하지 않은 파일 (코드에 비밀값이 박혀 있음)

값은 적지 않는다. 위치만 적는다. 원본은 사용자 PC 보관본에만 있다.

| 함수 | 위치 | 내용 | 비고 |
| --- | --- | --- | --- |
| `rail-1007-plan` | `index.ts` 13행 `MASTER` | 편집 비밀번호(평문, 4자리) | 아래 두 함수와 같은 값 |
| `rail-declaration-comments` | `index.ts` 12행 `MASTER_PASSWORD` | 관리자 비밀번호(평문, 4자리) | 모든 댓글 수정·삭제 가능 |
| `rail-declaration-content` | `index.ts` 3행 `MASTER_HASH` | 편집 비밀번호의 SHA-256 | 4자리라 해시만으로 바로 역산 가능 |
| `joint-struggle-files` | `index.ts` 5행 `PAGE_KEY`, 4행 `TARGET_FOLDER_ID` | 업로드 키, Google Drive 폴더 ID | 업로드 키는 공개 페이지 `workforce/joint-struggle-0921/index.html`에도 이미 들어 있음 |
| `press-conference-files` | `index.ts` 4행 `KEY` | 업로드 키 | 공개 파일 `assets/press-0914-tools.js`에도 이미 들어 있음 |

## 3. 판정 확정

기준(사용자 결정): Web1에서 쓰는 것은 유지, Web2 찌꺼기는 삭제. `wedding-mc-shared` 유지, `kptu-board-probe` 삭제. 공개 페이지 함수 6개는 Web1 공개 페이지라 유지.

### 3.1 삭제 목록 (8개, 삭제는 ENV-6c)

| 함수 | 근거 |
| --- | --- |
| `push-notifications` | Web2 알림 기능 제거(#272) 뒤 남은 종료 응답 함수. 앱 코드 호출 없음 |
| `rtw-owner-claim` | 읽생기 옛 소유자 확인. `rtw-claim-personal-owner`로 대체, 읽생기 코드 호출 없음 |
| `rtw-owner-setup` | 읽생기 옛 초기 설정. 이미 종료 응답만 돌려줌, 호출 없음 |
| `rail-1007-page` | 10/7 대의원 페이지 초기 시도. 지금 페이지는 저장소 `rail-council/2026-1007-delegates/` + `rail-1007-plan` 사용 |
| `rail-1007-page-v2` | 위 초기 시도의 덧씌우기 판. `rail-1007-page`만 부름 |
| `pc0914-storage-test` | 저장소 시험용. 이미 종료 응답 |
| `pc-file-test` | 파일 시험용. 이미 종료 응답 |
| `kptu-board-probe` | 게시판 수집 시험용(사용자 결정: 삭제) |

호출처 검색(두 저장소 원격 `main`, `docs/` 제외, 함수 이름 문자열 전체 검색):

- `push-notifications`: 앱 코드 없음. 테스트 모의 응답 2곳(`tests/app-e2e/accessibility-ux.spec.mjs`, `design-system.spec.mjs`)과 "알림 파일이 없어야 한다" CI 검사(`push-notifications-ui`)만 있다. 함수를 지워도 영향 없음.
- `kptu-board-probe`: 시험 페이지 `kptu-probe/index.html`만 부른다. 함수를 지우면 이 페이지가 동작하지 않는다(3.3).
- 나머지 6개: 두 저장소 어디에도 없음. `rail-1007-page-v2` → `rail-1007-page` 호출은 함수끼리이며 둘 다 삭제 목록.

### 3.2 유지 목록 (9개)

| 함수 | 근거 |
| --- | --- |
| `auth-handoff` | Web2 안드로이드 앱 로그인 전달에 지금 쓰임(`app/auth-handoff-client.js`, `app/native-auth-bridge.js`). 찌꺼기 아님 |
| `rtw-beta-status` | 읽생기 `src/api.js`가 매일 부름 |
| `rail-1007-plan` | Web1 공개 페이지(10/7 대의원) |
| `rail-declaration-comments` | Web1 공개 페이지(수련회 선언) |
| `rail-declaration-content` | Web1 공개 페이지(수련회 선언) |
| `pc0914-checklist` | Web1 공개 페이지(9/14 기자회견) |
| `press-conference-files` | Web1 공개 페이지(9/14 기자회견) |
| `joint-struggle-files` | Web1 공개 페이지(9/21 공동투쟁) |
| `wedding-mc-shared` | 사용자 결정: 유지 → **2026-10-29 00:37 KST 운영에서 삭제**(5.2) |

### 3.3 삭제 때 함께 볼 것 (ENV-6c)

- 절차는 조사 문서 3.5절: 함수 이름을 지정한 `supabase functions delete <이름>`, 로컬 세션 manual mode, 또는 사용자가 Supabase 대시보드에서 직접. 삭제 후 요청하면 404인지 확인.
- 되돌리기: 이 저장소·read-think-write에 커밋한 원본으로 같은 이름, 2.2의 verify_jwt 값 그대로 재배포.
- `kptu-probe/` 시험 페이지와 `.github/workflows/kptu-board-probe.yml`(함수를 부르지 않고 직접 게시판을 읽는 수동 실행 작업): 사용자 결정으로 삭제(ENV-6c PR에서 제거).

## 4. 발견사항 (기록만, 고치지 않음)

1. 원본 없던 공개 페이지 함수 6개는 모두 verify_jwt=false이고, 로그인 대신 Origin 확인·4자리 비밀번호·공개 업로드 키로 막는다. Origin은 브라우저 밖에서 쉽게 꾸밀 수 있다. 3개 함수의 비밀번호가 같은 4자리 값이며 시도 횟수 제한이 없다.
2. `rtw-owner-claim`이 9/17~18에 약 1,540회(하루 최대 1,275회) 호출됐다. 코드는 로그인 사용자 확인 후 소유자 여부만 돌려주는 가벼운 함수라, 당시 읽생기 화면의 반복 호출로 보인다(추정). 9/18 22:17 이후 0회.
3. `auth-handoff`: 봉인 키를 service role 키에서 만든다. 봉인 토큰은 5분 동안 몇 번이든 쓸 수 있다(1회용 확인 없음). CORS가 모든 Origin 허용. 조사 문서 3.4의 보안 검토 권장과 같다.

## 5. production 함수 전체 verify_jwt (ENV-7, 배포 때 기준표)

- 조회: 2026-09-26, 로컬 세션, `npx.cmd supabase functions list --project-ref <ref> -o json`(조회만). 모두 `ACTIVE`.
- 기록 합계 **32개**: verify_jwt `true` **8개**, `false` **24개**(2026-10-10 사용자 basket-files v1 최초 배포 보고 반영; 이번 세션 운영 조회 없음). "production 함수는 모두 false"가 아니다.
- 배포할 때 대상 함수의 값을 이 표와 직전 `functions list`로 확인하고 그대로 유지한다. `false`면 `--no-verify-jwt`를 붙이고, `true`면 붙이지 않는다. 배포 뒤 값이 바뀌면 이 표를 같은 PR에서 고친다.
- `false`인 Web2 함수는 함수 코드에서 로그인 사용자를 확인한다. `false`인 Web1 공개 페이지 함수는 로그인 없이 비밀번호·Origin 확인으로 막는다(결정사항, 4절 1번).
- DRV-요약 PR 1(#401 merge `85195bc`)의 `drive-summary`는 **배포 완료**다. 2026-10-03 12:27 KST에 v1, `verify_jwt=false`로 배포됐으며 아래 31행과 production 31개 합계에 포함한다(사용자 제공 배포·사후 점검 기록; 이 PR 2 세션의 production 조회 없음). 예약 호출은 JWT 없이 비밀 헤더를 쓰므로 `verify_jwt=false`를 선택한다. 함수 내부에서 사용자 JWT를 Auth 서버로 검증하고 `kptu-work` 소유자 역할을 확인하거나, `x-drive-summary-cron-secret`을 `DRIVE_SUMMARY_CRON_SECRET`과 SHA-256 고정 길이 비교한다. 비밀값 미설정·불일치·비소유자는 거절한다.

| # | 이름 | 제품 | 버전 | 마지막 배포(KST) | verify_jwt | 원본 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `auth-handoff` | Web2(안드로이드 로그인 전달) | v3 | 09-12 09:13 | false | work |
| 2 | `document-actions` | Web2(자료실 동작·바구니 첨부 자료실 등록·HWP 편집 열기·덮어쓰기) | v8 이후 갱신(버전 번호 미확인) | 2026-10-24 10:02 시작 (승인형 run #54) | **true** | **운영 소스 `f4bd56a`**(LIB-스캔글자읽기 #1101, 직전 운영 소스 `64986f3`(PRESS 서버 #1098, run #52); 되돌리기 ref `64986f3`; run #54 success, verify_jwt 값 변경 없음). 이전 기록: **운영 소스 `afd50774`**(#1013 merge, 검색 ② 첨부 안 글자 읽기 포함; 승인형 workflow run #42 success, verify_jwt 값 변경 없음). 되돌리기 ref는 배포 전 운영 소스 SHA를 기록하지 못해 미확인(10/22 자료실 AI 분류 배포 `ec715971`이 직전 후보이나 확인 안 함). 이하는 v8 시점 기록: work (`74c6fe700c33e81b54e86b80129a4a9c59a79a2c`, #554 main, `hwp-open`·`hwp-overwrite` 포함). v7→v8·JWT 유지·비로그인 POST 401·OPTIONS 200 성공(사용자 실행 보고, 같은 날 폰 확인 완료). 배포 전 운영 v7 출처 `85320da`(#546 main). 되돌리기 ref `85320da4909cd4bdabfe8a6764e52e0f942b03f0` |
| 3 | `document-ai-index` | Web2 | v3 | 09-16 15:44 | **true** | work |
| 4 | `event-media` | Web2 | v5 | 09-25 20:58 | false | work |
| 5 | `google-calendar` | Web2 | v15 | 10-01 | false | work |
| 6 | `google-tasks` | Web2 | v14 | 10-01 | false | work |
| 7 | `library-files` | Web2 | v13 | 09-26 07:09 | false | work |
| 8 | `meeting-ai-draft` | Web2 | v7 | 09-25 20:58 | **true** | work |
| 9 | `meeting-ai-ingest` | Web2 | v7 | 09-21 04:50 | **true** | work |
| 10 | `meeting-files` | Web2 | v7 | 09-26 01:58 | false | work |
| 11 | `page-ai-draft` | Web2 | v5 | 09-25 20:58 | **true** | work |
| 12 | `team-ai` | Web2(은퇴. 원본 삭제 SEC-정리묶음 2026-10-30, 운영 삭제는 명진 대시보드) | v5 | 09-22 07:34 | false | 저장소 원본 없음(git 기록에 남음) |
| 13 | `workspace-drive` | Web2 | v6 | 09-26 01:58 | false | work |
| 14 | `public-page-edit` | Web1 | v6 | 09-20 17:16 | false | work |
| 15 | `public-policy-drive` | Web1 | v15 | 09-23 10:09 | false | work |
| 16 | `pc0921-board` | Web1 공개 페이지 | v23 | 09-21 14:56 | false | work |
| 17 | `pc0914-checklist` | Web1 공개 페이지 | v4 | 09-11 15:41 | false | work |
| 18 | `joint-struggle-files` | Web1 공개 페이지 | v3 | 09-12 23:08 | false | 사용자 PC 보관(2.3) |
| 19 | `press-conference-files` | Web1 공개 페이지 | v4 | 09-14 08:49 | false | 사용자 PC 보관(2.3) |
| 20 | `rail-1007-plan` | Web1 공개 페이지 | v6 | 09-13 06:27 | false | 사용자 PC 보관(2.3) |
| 21 | `rail-declaration-comments` | Web1 공개 페이지 | v3 | 09-11 03:57 | false | 사용자 PC 보관(2.3) |
| 22 | `rail-declaration-content` | Web1 공개 페이지 | v4 | 09-11 04:10 | false | 사용자 PC 보관(2.3) |
| 24 | `rtw-ai-read` | 읽생기 | v7 | 09-21 04:41 | **true** | read-think-write |
| 25 | `rtw-beta-status` | 읽생기 | v1 | 09-21 13:35 | false | read-think-write |
| 26 | `rtw-claim-personal-owner` | 읽생기 | v2 | 09-18 23:23 | false | read-think-write |
| 27 | `rtw-delete-account` | 읽생기 | v4 | 09-26 12:24 | **true** | read-think-write |
| 28 | `rtw-personal-write` | 읽생기 | v2 | 09-18 23:29 | false | read-think-write |
| 29 | `rtw-recommend` | 읽생기 | v8 | 09-21 04:41 | false | read-think-write |
| 30 | `rtw-url-import` | 읽생기 | v8 | 09-21 04:36 | **true** | read-think-write |
| 31 | `drive-summary` | Web2(Drive 읽기용 사본, 배포됨) | v8 이후 갱신(버전 번호 미확인) | 2026-10-24 10:02 시작 (승인형 run #55) | false | **운영 소스 `f4bd56a`**(LIB-스캔글자읽기 #1101; 되돌리기 ref `12acfbf8`; run #55 success, verify_jwt 값 변경 없음). 이전 기록: **운영 소스 `12acfbf8`**(#1028 merge, LIB-글자채우기야간 `text_backfill`; run #45 success, verify_jwt 값 변경 없음). 직전 운영 소스는 10/22 배포 `65c9a96c`(#926)로 추정(그 사이 다른 배포 기록은 못 찾았으나 확인하지 않음). 이하는 v8 시점 기록: work (`0013c56160a62cf45dbd941462f54210104cd105`, #540 main, 사진 글자 Drive 사본 투영 포함). v7→v8·JWT 유지·POST401·OPTIONS204 성공(사용자 실행 보고). 되돌리기 ref `39f1dfec9cd978f9ea5e7c94bca120fb16a0a84e`(v7 소스, #507). v2 출처 미기록 |
| 32 | `basket-files` | Web2(바구니 첨부·사진 글자 읽기·메모 삭제 시 첨부 휴지통·일기 사진 보기) | v5 | 2026-10-18 (승인 버튼) | false | work (`bd7a19d0bee95c25906bc41e04144d8e5bdef255`, #641 main, owner 전용 `action=photo` 추가). v4→v5·JWT 유지, 비로그인 POST 401·OPTIONS 200(사용자 실행 보고). 되돌리기 ref `34874eff5eb3a83db94cdec5001bcec4ea4b1f9b`(v4 소스, #543) |
| 33 | `share-page-read` | Web1 공유 페이지 읽기(SHARE-현장공유) | 운영 배포됨(버전 번호 미확인) | 2026-10-23 11:02 시작 (승인형 run #44) | false | **운영 소스 `ab008dd4`**(ED-② 공유 사진, 사진 주소 응답 추가; run #44 success, 되돌리기 ref `778cbf4`, verify_jwt 값 변경 없음). work (PR 1 서버) |
| 34 | `ai-assist` | Web2 서버 AI 도우미(AI-서버연동, S1은 연결 요약만) | 운영 배포됨(버전 번호 미확인) | 2026-10-24 08:21 시작 (승인형 run #53) | **true** | **운영 소스 `64986f3`**(PRESS 서버 #1098 AI 분류 지침 한 줄; 되돌리기 ref `daed2e7b`; run #53 success, verify_jwt 값 변경 없음). 이전 기록: **운영 소스 `129d200b`**(#1048 주요 일정 제목 다듬기 `schedule_titles`; run #48 success, 되돌리기 ref `a9506005`, verify_jwt 값 변경 없음). 배포 이력(승인형 workflow): 10/22 `eed5df4f`(조직 요약) → `989a9528`(run #41) → 10/23 `a9506005`(run #46, 자료실 AI 분류 보완) → `129d200b`. work (S1 코드·시험) |
| 35 | `share-page-media` | Web2 공유 페이지 사진 올리기·보기 주소·지우기·페이지 완전 삭제(`purge_page`, SHARE-페이지삭제)(ED-통합편집기 ②) | 운영 배포됨(버전 번호 미확인) | 2026-10-23 17:21 시작 (승인형 run #47) | **true** | **운영 소스 `77a83215`**(#1044 사진 같이 지우기; run #47 success, 되돌리기 ref `ab008dd4`). 첫 배포는 10/23 10:35 시작 run #43(ref `ab008dd4`, `first_deploy=true`·verify_jwt=true). verify_jwt 값 변경 없음. work (코드·시험) |
| 36 | `collector-feed` | Web2 수집 받기(CALL-통화메뉴·TG-소식메뉴 2단계, 앱 스크립트가 통화 분석·텔레그램 묶음을 보냄. 읽기 action `context`: 담당조직·프로젝트 이름 목록만, CALL-맥락문서) | 배포 대기 | 없음 | false | work (코드·시험, 첫 배포 전) |
| 37 | `onedrive-photos` | Web2 일기 원드라이브 연결·폴더 지정·사진 읽기·사진 지우기(휴지통 이동)(JOURNAL-일기원드라이브, Files.ReadWrite, 고른 폴더 안 사진만) | 배포 대기 | 없음 | **true** | work (코드·시험, 첫 배포 전) |
| 38 | `meeting-transcribe` | Web2 회의 녹음 파일 → 전사 글(Gemini, MTG-녹음초안 2단계. 녹음은 명진 Drive '웹2/회의자료/회의 녹음'에 올리고, 전사 글은 화면에만 돌려줌. MTG-노트북녹음: 노트북 [녹음] 5분 조각 받기·구간 합치기 `rec_*`) | 배포 대기 | 없음 | **true** | work (코드·시험, 첫 배포 전) |

`meeting-transcribe`(38행)는 **첫 배포 전**이다(MTG-녹음초안 2단계, PR B). 사업 보고 › [회의] 입력 창에서 로그인한 소유자만 부르고 예약 호출이 없으므로 `verify_jwt=true`를 선택한다. 함수 코드도 Auth 서버로 로그인을 다시 확인하고 본인 `app_workspace_members` 행이 `owner`인 작업공간만 받는다.
서버 키는 작업 표 `app_meeting_transcribe_jobs`(migration `20261029071500`, service_role은 정한 칸만 넣기·고치기, 지우기 없음)·Drive 연결 설정 읽기·사용량 기록(`app_ai_external_usage` 넣기)에만 쓴다. 회의 읽기·회의자료 링크 행 넣기·이번 달 사용량 읽기는 호출한 사람의 토큰(소유자 RLS)으로 한다. 전사 글은 저장하지 않는다.
Gemini 열쇠는 새 비밀값 `GEMINI_API_KEY`(명진이 대시보드에서 등록)만 읽는다. 없으면 `준비 중`(503 `not_ready`)으로 답하고 아무것도 올리지 않는다.
첫 배포는 DB 적용 뒤 `first_deploy=true`·`verify_jwt=true`·`expect_unauth_401=true`로 한다. 이전 버전이 없으므로 되돌리기는 화면(PR C)이 아직 부르지 않는 상태 유지, 필요하면 사용자가 대시보드에서 삭제를 판단한다.
MTG-노트북녹음 1단계(설계 `docs/design/laptop-recording.md`)는 같은 함수에 `rec_start`·`rec_piece`·`rec_finish`·`rec_pending`을 더한다. 인증 경계·verify_jwt(true)는 그대로이고, 서버 키는 새 녹음 구간 표 `app_meeting_recordings`(migration `20261029200000`, service_role은 정한 칸만 넣기·고치기, 지우기 없음)와 위 전사 작업 표 넣기(기존 칸 권한)에만 더 쓴다. 조각·합친 녹음은 명진 Drive '웹2/회의자료/회의 녹음'(조각은 그 아래 '녹음 조각', 합친 뒤 휴지통)에만 둔다. 다시 배포는 그 DB 적용 뒤 `verify_jwt=keep`으로 하고, 되돌리기는 이전 운영 소스 SHA로 재배포한다.

`share-page-read`(33행)는 **2026-10-23 기준 운영 배포됨**(위 표 갱신; 아래 문단은 배포 전 설계 기록이며 합계 32개 계산에는 이번 갱신에서 반영하지 않았다 — 운영 조회 없음, 재계산 미확인). 링크를 받은 사람은 로그인하지 않으므로 `verify_jwt=false`를 선택한다(2026-10-20 사용자 결정 S1: 읽기는 Web1 새 주소 + 긴 링크 값).
인증 대신 함수 코드가 링크 값(16진수 64자)의 sha256 지문으로 링크 행 하나를 찾고, 꺼짐·기한·게시 상태를 확인한 뒤 그 페이지의 제목·블록만 돌려준다. 그 밖은 모두 같은 404다.
서버 키는 함수 안에서만 쓰며 DB에서 service_role은 링크 지문·기한·끔과 페이지 id·제목·블록·상태 칸만 SELECT할 수 있다(링크 원문·workspace·쓰기 불가, migration `20261020005000`).
CORS는 `https://work.bokdoong.com`만, 응답은 `no-store`·`noindex`. 첫 배포는 DB 적용 뒤 `first_deploy=true`·`verify_jwt=false`·`expect_unauth_401=false`(공개 읽기라 비로그인 POST 401 검사 대상 아님)로 한다.

`share-page-media`(35행)는 **2026-10-23 기준 운영 배포됨**(위 표 갱신; 아래는 배포 전 설계 기록, 합계 32개 재계산은 미확인)(ED-통합편집기 ②, `docs/design/unified-editor.md` 5절). 신규 함수라 첫 배포는 `first_deploy=true`·`verify_jwt=true`다.
로그인한 소유자만 부르므로 `verify_jwt=true`를 선택하고, 코드에서도 Auth 서버로 로그인을 다시 확인한다. 소유 확인과 사진 기록 읽기·쓰기는 호출자의 로그인 토큰으로 DB가 한다(owner RLS, migration `20261023110000`). 서버 키는 비공개 버킷 `share-page-media`의 저장·삭제·짧은 주소 발급에만 쓴다.
JPEG만(3MB 이하), 머리 구간에 EXIF·XMP·IPTC가 있으면 거절한다. 되돌리기: 화면이 이 함수를 쓰지 않는 상태 유지(화면 PR은 마지막 단계), 필요 시 사용자가 대시보드에서 삭제를 판단한다(자동 삭제 없음). 배포 순서: DB(`20261023110000`) → 대시보드에서 비공개 버킷 생성(정책 없음) → `share-page-media`(first_deploy) → `share-page-read`(사진 주소 추가, 되돌리기 = 이전 SHA 재배포) → 화면 merge.

`ai-assist`(34행)는 **운영 배포됨**(위 표 갱신: S1 이후 2026-10-22~23 여러 번 재배포; 아래는 첫 배포 전 설계 기록, 합계 32개 재계산은 미확인)(AI-서버연동 S1, `docs/design/ai-server.md` 결정 D1~D13).
화면에서 로그인한 소유자만 부르고 예약 호출이 없으므로 `verify_jwt=true`를 선택한다. 함수 코드도 Auth 서버로 로그인을 다시 확인하고, 본인 `app_workspace_members` 행이 `owner`인 작업공간 하나만 쓴다(`private.app_is_workspace_owner`와 같은 기준, 화면이 보낸 작업공간 값은 받지 않음).
서버 관리자 키를 쓰지 않고 재료·사용 기록을 호출한 사람의 로그인 토큰으로 읽고 써서 기존 소유자 RLS가 그대로 걸린다. OpenAI 열쇠는 새 이름 `WEB2_OPENAI_API_KEY`만 읽는다(옛 `OPENAI_API_KEY`는 읽지 않음).
첫 배포는 S2(열쇠 등록) 뒤 `first_deploy=true`·`verify_jwt=true`·`expect_unauth_401=true`로 한다. 이전 버전이 없으므로 되돌리기는 화면(S4)이 아직 부르지 않는 상태 유지, 필요하면 사용자가 대시보드에서 삭제를 판단한다.

`collector-feed`(36행)는 **배포 대기**다(CALL-통화메뉴·TG-소식메뉴 2단계, `docs/design/call-telegram-feed.md` 4.4절). 부르는 쪽은 명진 계정의 Google 앱 스크립트라 사용자 로그인(JWT)이 없으므로 `verify_jwt=false`를 선택한다.
대신 함수 코드가 `x-collector-feed-secret` 헤더를 새 비밀값 `COLLECTOR_FEED_SECRET`(32자 이상)과 SHA-256 고정 길이로 비교한다(`drive-summary` heartbeat와 같은 방식, 비밀값은 따로). 비밀값 미설정·짧음·불일치, `Authorization` 헤더(사용자 JWT), 예약·heartbeat 비밀 헤더가 붙은 요청은 모두 401이다.
업무공간은 서버가 `kptu-work`로 정하고 요청 값은 받지 않는다. DB는 service role로 쓰되 migration `20261024140000_call_tg_feed`의 칸별 grant 안(소식 줄 넣기·중복 확인 세 칸 읽기, 하루 숫자 읽기·넣기·숫자 칸 고치기)만 쓴다.
첫 배포는 DB 적용(run #65) 뒤 `first_deploy=true`·`verify_jwt=false`·`expect_unauth_401=true`(비밀 헤더 없는 POST는 401)로 한다. 되돌리기: 비밀값을 지우면 입구가 바로 닫힌다. 화면·앱 스크립트가 아직 이 함수를 쓰지 않으므로 그동안 영향은 없다. 함수 삭제는 사용자가 대시보드에서 판단한다(자동 삭제 없음).

`onedrive-photos`(37행)는 **배포 대기**다(JOURNAL-일기원드라이브, `docs/design/diary-onedrive.md` 10절: 2026-10-27 결정으로 읽기 전용에서 Files.ReadWrite·사진 지우기로 바뀜). 로그인한 소유자만 부르는 함수라 `verify_jwt=true`를 선택한다(화면은 로그인 토큰을 붙여 부르고, 사진은 받은 바이트를 화면에서 그림으로 바꿔 보여 주므로 로그인 없는 주소가 필요 없다).
함수 코드도 Auth `getUser` + 작업공간 owner 확인을 다시 하고, 갱신 토큰은 service role로만 읽고 쓰며 응답에 싣지 않는다. 비밀값 `ONEDRIVE_CLIENT_ID`·`ONEDRIVE_CLIENT_SECRET`·`ONEDRIVE_REDIRECT_URI`가 없으면 `status`만 `configured:false`로 답하고 나머지는 424로 멈춘다.
첫 배포는 DB 적용(`20261026140000_diary_onedrive_db`) 뒤 `first_deploy=true`·`verify_jwt=true`·`expect_unauth_401=true`로 한다. 비밀값 등록은 배포와 별개이며 사용자가 대시보드에서 직접 넣는다. 되돌리기: 화면이 아직 이 함수를 쓰지 않는 상태 유지, 필요하면 사용자가 대시보드에서 함수 삭제를 판단한다(자동 삭제 없음). 비밀값을 지우면 입구가 바로 닫힌다.

`basket-files`는 2026-10-10 사용자 승인형 #475 신규 배포 경로로 최초 배포 완료했다.
version 1, verify_jwt=false, 비로그인 POST 401, OPTIONS 200, source b466910.
코드에서 로그인 JWT를 Auth getUser로 검증하고 본인 owner workspace만 허용한다.
사용자 실행 보고 기준이며 이번 화면 PR에서 운영 조회·배포·workflow 실행은 없다.
기존 운영 31개와 별도로 신규 1개를 기록했다. 기존 함수의 시점별 실측 수치는 유지한다.

2026-10-14 사용자 승인형 workflow로 `basket-files` v2→v3, `drive-summary` v7→v8을 같은 ref `0013c56`에서 배포했다. 두 함수 모두 verify_jwt=false를 유지했다. 같은 날 DB migration `20261013034836_basket_photo_ocr_db`가 먼저 apply됐다. 위 두 행은 사용자 실행 보고 기준이며, 이를 반영한 OCR-켜기 PR 세션에서는 운영 조회·배포·workflow 실행을 하지 않았다.

같은 날 사용자 승인형 workflow로 `basket-files` v3→v4를 ref `34874ef`(#543 merge, 메모 삭제 시 첨부 Drive 휴지통 `note-delete`)에서 배포했다. verify_jwt=false를 유지했고 되돌리기 ref는 `0013c56`(v3 소스)이다. 사용자 실행·폰 확인 보고 기준이며, 이를 반영한 BASKET-할일출처 PR 세션(Claude Code 웹)에서는 운영 조회·배포·workflow 실행을 하지 않았다.

2026-10-15 사용자 승인형 workflow로 `document-actions` v6→v7을 ref `85320da`(#546 merge, 바구니 첨부를 같은 Drive 원본 참조로 자료실에 등록하는 `register-basket-attachment`)에서 배포했다. verify_jwt=true를 유지했고 비로그인 POST 401, OPTIONS 200을 확인했다. 배포 전 운영 v6은 2026-10-02 00:56 UTC 배포본이며 출처 SHA 기록이 없어 #393 merge `323ae3b`로 추정한다. 되돌리기 ref도 그 추정값이다. 사용자 실행·폰 확인 보고 기준이며, 이를 반영한 UI-바구니버튼정리 PR 세션(Claude Code 웹)에서는 운영 조회·배포·workflow 실행을 하지 않았다.

같은 날 사용자 승인형 workflow로 `document-actions` v7→v8을 ref `74c6fe700c33e81b54e86b80129a4a9c59a79a2c`(#554 merge, HWP-편집기 2단계 `hwp-open`·`hwp-overwrite`)에서 배포했다. verify_jwt=true를 유지했고 비로그인 POST 401, OPTIONS 200을 확인했다. 배포 전 운영 v7 출처는 `85320da`이며 되돌리기 ref는 `85320da4909cd4bdabfe8a6764e52e0f942b03f0`이다. 사용자 실행·폰 확인 보고 기준이며, 이를 반영한 HWP-편집기메뉴 PR 세션(Claude Code 웹)에서는 운영 조회·배포·workflow 실행을 하지 않았다.

### 5.1 ENV-6c 삭제 결과 확인

- ENV-6c 삭제 대상 8개(`push-notifications`·`rtw-owner-claim`·`rtw-owner-setup`·`rail-1007-page`·`rail-1007-page-v2`·`pc0914-storage-test`·`pc-file-test`·`kptu-board-probe`)는 목록에 **없다**.
- 남은 함수는 **30개**(삭제 전 38개 − 8개).
- 3.2 유지 목록 9개는 모두 있고, 버전·배포 시각이 2.2와 같다(삭제 작업 중 바뀌지 않음).
- 원장 ENV-7 행의 "true 10개 포함"(삭제 전 기준 메모)과 계산이 1개 다르다: 지금 true 8개 + 삭제된 true 3개(`push-notifications`·`pc0914-storage-test`·`pc-file-test`) = 11개. 당시 목록 원본이 없어 어느 쪽이 맞는지 확인할 수 없다(추정: 메모 때 셈 차이). 현재 값은 이 표가 기준이다.
- 삭제된 8개의 원본은 되돌리기용으로 저장소에 남아 있다(work 6개 `supabase/functions/`, read-think-write 2개). 되돌릴 때는 2.2의 값으로 재배포한다.

### 5.2 `wedding-mc-shared` 삭제 (2026-10-29)

- 2026-10-29 00:37 KST, 명진 지시로 커맨드센터가 Supabase 대시보드에서 Edge `wedding-mc-shared`를 삭제했다(SEC-공개저장소점검 2차, 화면 `wedding/` 삭제 #1412 뒤 부르는 곳 없음).
- 5절 표에서 23번 행을 뺐다(다른 행 번호는 그대로 둠). 원본 폴더 `supabase/functions/wedding-mc-shared/`도 같은 원장 롤업 PR에서 지웠다. 되돌릴 원본은 git 기록(main `2a74bde7` 이전 커밋)에 남아 있고, 되살릴 때는 2.2의 verify_jwt=false로 재배포한다.
- DB 표 `wedding_mc_shared`는 데이터 보존 원칙에 따라 그대로 둔다(정리 여부는 별도 판단).

### 5.3 저장소 원본 대조 (2026-10-30, SEC-정리묶음)

- 이 세션은 운영 조회 없이 저장소 `supabase/functions/` 폴더 목록과 위 표만 맞춰 봤다(`_shared` 제외).
- 이번에 원본을 지운 폴더: `kptu-board-probe`·`pc-file-test`·`pc0914-storage-test`·`rail-1007-page`·`rail-1007-page-v2`(운영은 ENV-6c에서 이미 삭제, 5.1) · `team-ai`(위 12행, 운영 삭제 대기). 되살릴 원본은 git 기록에 남고, 되살릴 때는 2.2의 verify_jwt 값으로 재배포한다.
- 저장소에 원본이 있으나 위 표에 행이 없는 함수: `push-notifications` 1개. 운영에서는 ENV-6c로 삭제됐다(5.1). 410만 답하는 껍데기이며, 첫 배포 표 행으로 잘못 쓰이지 않게 표에 넣지 않는다. 원본 정리는 별도 판단.
- 표에 있으나 이 저장소에 원본이 없는 함수: 읽생기 7개(24~30행, read-think-write 저장소), Web1 공개 페이지 5개(18~22행, 사용자 PC 보관 2.3). 의도된 상태다.
- 그 밖의 표 행 24개는 저장소 폴더 24개(`push-notifications` 빼고 전부)와 이름이 1:1로 맞는다. verify_jwt 값은 이번에 바꾸지 않았다(운영 조회 없음, 값 근거는 각 행 기록).
