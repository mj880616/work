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
| `wedding-mc-shared` | 사용자 결정: 유지 |

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
- 합계 **30개**: verify_jwt `true` **8개**, `false` **22개**. "production 함수는 모두 false"가 아니다.
- 배포할 때 대상 함수의 값을 이 표와 직전 `functions list`로 확인하고 그대로 유지한다. `false`면 `--no-verify-jwt`를 붙이고, `true`면 붙이지 않는다. 배포 뒤 값이 바뀌면 이 표를 같은 PR에서 고친다.
- `false`인 Web2 함수는 함수 코드에서 로그인 사용자를 확인한다. `false`인 Web1 공개 페이지 함수는 로그인 없이 비밀번호·Origin 확인으로 막는다(결정사항, 4절 1번).

| # | 이름 | 제품 | 버전 | 마지막 배포(KST) | verify_jwt | 원본 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `auth-handoff` | Web2(안드로이드 로그인 전달) | v3 | 09-12 09:13 | false | work |
| 2 | `document-actions` | Web2 | v4 | 09-25 20:58 | **true** | work |
| 3 | `document-ai-index` | Web2 | v3 | 09-16 15:44 | **true** | work |
| 4 | `event-media` | Web2 | v5 | 09-25 20:58 | false | work |
| 5 | `google-calendar` | Web2 | v14 | 09-26 11:55 | false | work |
| 6 | `google-tasks` | Web2 | v6 | 09-24 18:07 | false | work |
| 7 | `library-files` | Web2 | v13 | 09-26 07:09 | false | work |
| 8 | `meeting-ai-draft` | Web2 | v7 | 09-25 20:58 | **true** | work |
| 9 | `meeting-ai-ingest` | Web2 | v7 | 09-21 04:50 | **true** | work |
| 10 | `meeting-files` | Web2 | v7 | 09-26 01:58 | false | work |
| 11 | `page-ai-draft` | Web2 | v5 | 09-25 20:58 | **true** | work |
| 12 | `team-ai` | Web2 | v5 | 09-22 07:34 | false | work |
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
| 23 | `wedding-mc-shared` | 개인 공개 페이지 | v2 | 09-13 22:25 | false | work |
| 24 | `rtw-ai-read` | 읽생기 | v7 | 09-21 04:41 | **true** | read-think-write |
| 25 | `rtw-beta-status` | 읽생기 | v1 | 09-21 13:35 | false | read-think-write |
| 26 | `rtw-claim-personal-owner` | 읽생기 | v2 | 09-18 23:23 | false | read-think-write |
| 27 | `rtw-delete-account` | 읽생기 | v4 | 09-26 12:24 | **true** | read-think-write |
| 28 | `rtw-personal-write` | 읽생기 | v2 | 09-18 23:29 | false | read-think-write |
| 29 | `rtw-recommend` | 읽생기 | v8 | 09-21 04:41 | false | read-think-write |
| 30 | `rtw-url-import` | 읽생기 | v8 | 09-21 04:36 | **true** | read-think-write |

### 5.1 ENV-6c 삭제 결과 확인

- ENV-6c 삭제 대상 8개(`push-notifications`·`rtw-owner-claim`·`rtw-owner-setup`·`rail-1007-page`·`rail-1007-page-v2`·`pc0914-storage-test`·`pc-file-test`·`kptu-board-probe`)는 목록에 **없다**.
- 남은 함수는 **30개**(삭제 전 38개 − 8개).
- 3.2 유지 목록 9개는 모두 있고, 버전·배포 시각이 2.2와 같다(삭제 작업 중 바뀌지 않음).
- 원장 ENV-7 행의 "true 10개 포함"(삭제 전 기준 메모)과 계산이 1개 다르다: 지금 true 8개 + 삭제된 true 3개(`push-notifications`·`pc0914-storage-test`·`pc-file-test`) = 11개. 당시 목록 원본이 없어 어느 쪽이 맞는지 확인할 수 없다(추정: 메모 때 셈 차이). 현재 값은 이 표가 기준이다.
- 삭제된 8개의 원본은 되돌리기용으로 저장소에 남아 있다(work 6개 `supabase/functions/`, read-think-write 2개). 되돌릴 때는 2.2의 값으로 재배포한다.
