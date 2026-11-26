# 설계: 구글 드라이브 사진·파일을 각자 자기 것으로 (MULTI-구글드라이브사진모두)

- 상태: 구현(S62-11 — ① DB #2627, ② Edge #2629, ③ 화면). 사용자 결정(11/15): 1 가(구글 승인 신청 없이 100명 한도 안에서), 2 예(다른 사람도 같은 쓰기 규칙). 설계 검토는 S62-08a.
- 앞 작업: S46-24 사진 출처 구글 드라이브(`docs/design/photo-gdrive-permission.md`), MULTI ②-2 사람별 Drive 연결(`docs/design/multi-user-audit.md` 8절), MULTI-처음쓰는사람(`docs/design/new-user-start.md`, #2574).
- 사용자 확정(요청함 V29, 11/14 22:11 "구글 드라이브 가" · 22:18 덧붙임): 모든 작업공간의 Drive 연결이 전체 권한(`drive`)을 요청하고, 사진의 구글 드라이브 칸과 [파일] 메뉴를 Drive를 연결한 사람 모두에게 연다. 각자 자기 드라이브·자기 작업공간만.
- 표시: [사실] = 저장소에서 확인(파일:줄), [추정] = 운영 확인이 필요(9절 읽기 전용 SQL·확인 목록).

## 0. 한 줄 요약

지금은 사진의 구글 드라이브 칸과 [파일]이 "운영자 기능 키 + 단 하나의 운영자 작업공간 + 프로젝트 전체 Drive 연결 1개(`public_policy_drive_config` id=1)"로 묶여 있다. 이것을 "로그인 + 본인이 owner인 자기 작업공간 + 그 작업공간의 Drive 연결(`app_drive_connections`)"로 바꾼다. 사진·파일 색인 표는 이미 작업공간별이라 표 구조는 그대로 쓰고, 기능 키 판정(`gdrive_photos`·`files`)만 걷어낸다.

## 1. 지금 구조 (사실 조사)

### 1-1. 서버 문 — 사진(Edge `gdrive-photos`)

| 문 | 위치 | 내용 |
| --- | --- | --- |
| ① 로그인 | `supabase/functions/gdrive-photos/handler.ts` 154~157줄 | `auth/v1/user`로 Auth 확인, 아니면 401 `session_required` |
| ② owner | 같은 파일 158~160줄 | `app_workspace_members` owner 행 정확히 1개 → 그 작업공간. 화면 값 안 씀 |
| ③ 기능 키 | 같은 파일 161~167줄 | 로그인 토큰으로 `app_my_features()` → `gdrive_photos` 없으면 403 `feature_required` |
| ④ 단 하나 작업공간 | 같은 파일 168~170줄 | `app_operator_feature_workspace('gdrive_photos')` = 내 작업공간 **그리고** `slug = 'kptu-work'`(20줄 `DRIVE_WORKSPACE_SLUG`) = 내 작업공간, 아니면 403 `drive_owner_mismatch` |
| 토큰 | 같은 파일 186~190줄 | `public_policy_drive_config` id=1의 `google_refresh_token`(프로젝트 전체 1개 = 사용자 연결). 작업공간별 연결 표를 읽지 않음 |
| 권한 확인 | 같은 파일 91~93줄 `scopeHas`, 215~222줄, 233~236줄 | 토큰 응답 `scope`에 `https://www.googleapis.com/auth/drive`가 없으면 403 `scope_missing`(상태 요청은 `scope:false`, 420~424줄) |
| 쓰기 안전 | 같은 파일 5~6줄 | 바꾸기·옮기기·휴지통은 `confirm:true`일 때만, 영구 삭제·휴지통 비우기 없음 |
| Edge 설정 | `supabase/functions/gdrive-photos/index.ts` 4~7줄 | `verify_jwt=true`, `withWebCors`(공용 Origin 목록) |

→ 핵심: ③④를 빼는 것만으로는 안 된다. 토큰을 id=1에서 읽기 때문에, 문만 열면 **다른 사람이 사용자 드라이브를 읽게 된다**. 토큰 읽기를 작업공간별 연결로 바꾸는 것이 먼저다.

### 1-2. 서버 문 — 파일(Edge `cloud-files`)

| 문 | 위치 | 내용 |
| --- | --- | --- |
| ①② 로그인·owner | `supabase/functions/cloud-files/handler.ts` 304~310줄 | 사진과 같음 |
| ③ 기능 키 `files` | 같은 파일 311~317줄, 33줄 `FEATURE = "files"` | 없으면 403 `feature_required`(원드라이브·구글 둘 다) |
| ④ 구글만 단 하나 작업공간 | 같은 파일 319~327줄 `gdOwner` | `app_operator_feature_workspace('files')` + slug `kptu-work` |
| 구글 토큰 | 같은 파일 365줄 | id=1 refresh token |
| 원드라이브 토큰 | 같은 파일 409줄 | `app_onedrive_connections`(작업공간별, 이미 사람별) |
| 서버 예약 입구 | 같은 파일 1371~1390줄 `cronSweep` | 작업공간을 `app_operator_feature_workspace('files')` 하나로 정함 → 다른 사람 작업(클라우드 사이 복사)은 5분 예약이 깨우지 않음 |

### 1-3. DB

| 대상 | 위치 | 지금 |
| --- | --- | --- |
| 사진 색인 `app_gdrive_sync`·`app_gdrive_folders`·`app_gdrive_photos` | `supabase/migrations/20261031120000_gdrive_photo_index.sql` 52~100줄 | **이미 작업공간별**(키 `workspace_id`), RLS 켬·정책 없음·service_role만. 바꿀 것 없음 |
| 파일 색인 `app_cloud_items`·`app_cloud_stars` 읽기 정책 | `supabase/migrations/20261102160000_cloud_files_index.sql` 126~129줄 | `app_is_workspace_owner(workspace_id) and app_workspace_has_feature(workspace_id, 'files')` |
| 파일 작업표 `app_cloud_jobs` 읽기 정책 | `supabase/migrations/20261104162800_cloud_jobs.sql` 115~116줄 | 위와 같음(owner + `files`) |
| 찾기 함수 `app_cloud_find_in` | `supabase/migrations/20261104120000_cloud_find_sources.sql` 115~122줄 | owner 1개 + `has_feature(v_ws,'files')` 아니면 0줄 |
| `app_cloud_list`·`app_cloud_trail`·`app_cloud_find` | `20261102160000_cloud_files_index.sql` 139·164·186줄 | [추정] 위 RLS를 따름(본문 확인은 구현 PR에서) |
| 사람별 Drive 연결 `app_drive_connections` | `supabase/migrations/20261104233000_workspace_drive_connections.sql` 34~49줄 | 작업공간당 1행, `full_drive boolean`(37줄), RLS 켬·정책 없음·service_role 칸 단위 권한만 |
| 운영자 허용 표 `app_operator_features` | `20261029090000_operator_features.sql` 71줄, 키 검사 `20261113230000_arsenal_outside_features.sql` 37줄 | `gdrive_photos`·`files` 행은 운영자 작업공간 1개 |

### 1-4. 연결(Edge `public-policy-drive`)

| 내용 | 위치 |
| --- | --- |
| 전체 권한은 운영자 기능(`gdrive_photos` 또는 `files`)이 있는 작업공간만 요청, 나머지는 `drive.file`만 | `supabase/functions/public-policy-drive/index.ts` 146~163줄(`fullDriveAllowed`) |
| 동의 요청 `scope`·`prompt=consent`·`include_granted_scopes=true` | 같은 파일 165~191줄 |
| 연결 저장: 부른 사람이 owner인 작업공간(state의 user_id → `callerOwnerWorkspace`, 화면 값 안 씀) | 같은 파일 296~302줄 |
| `full_drive` = 요청 허용 && 구글이 실제로 줌 | 같은 파일 318~320줄 |
| 운영자(`calls`)면 id=1도 같이 갱신(Expand 단계 흔적) | 같은 파일 337~345줄 |
| 안내 `photos=scope_missing`은 전체 권한을 요청한 작업공간에서 빠졌을 때만 | 같은 파일 347줄 |
| 공용 도우미(작업공간별 토큰, 대체 연결 없음, 424 `drive_not_connected`) | `supabase/functions/_shared/workspace-drive-token.ts` 1~6줄, 48~66줄, 69줄~ |

### 1-5. 화면 판정

| 내용 | 위치 |
| --- | --- |
| 칩 판정 `gdriveAllowed`(기능 키 `gdrive_photos`) | `app/photo-sources-model.mjs` 13~17줄 |
| 다시 연결 대상 코드 `GDRIVE_RECONNECT = ['scope_missing','drive_auth_expired','drive_not_connected']` | 같은 파일 75~77줄 |
| 오류 글(`feature_required`·`drive_owner_mismatch`) | 같은 파일 68줄 |
| 사진 화면 `gdOn`·`ensureGd`·`gdNoteHtml` | `app/photos.js` 44줄, 187줄, 514~535줄 |
| 기능 목록 읽기 | `app/gdrive-photos.js` 2·14~15줄(`my-features.js` 공용) |
| [파일] 메뉴 `feature: 'files'` | `app/menu-model.mjs` 24줄, 빼기 `withFeatures` 120~125줄 |
| 11/13 결정 '파일은 사용자 계정만' | `docs/design/new-user-start.md` 25·40·87줄 |
| 결정 문서 | `docs/design/multi-user-audit.md` 293~296줄, `docs/design/photo-gdrive-permission.md` 0절 '쓰기 안전 규칙' 첫 줄 |

### 1-6. 그 밖에 id=1 토큰을 읽는 곳 (이번 범위 밖, 참고)

- `supabase/functions/drive-summary/core.mjs` 325줄 — 운영자 전용 요약. 이번에 바꾸지 않는다(id=1 Contract 단계는 별도).

## 2. 바뀐 뒤 구조

### 2-1. 문 (사진·파일 공통)

1. 로그인(Auth) — 그대로.
2. 본인이 owner인 작업공간 정확히 1개 — 그대로. 화면이 보낸 작업공간·사용자 값은 받지 않는다(몸통에 와도 무시, 지금처럼).
3. **그 작업공간의 `app_drive_connections` 행**으로만 토큰을 받는다(`_shared/workspace-drive-token.ts`). 행이 없으면 424 `drive_not_connected` → 화면 '[연결]'. 다른 작업공간 연결로 넘어가는 길·id=1로 넘어가는 길 없음.
4. 토큰의 실제 권한에 `drive`가 있는지 매번 확인 — 그대로(`scope_missing`).
5. 기능 키(`gdrive_photos`·`files`) 판정과 slug `kptu-work` 판정을 **뺀다**.
6. 원드라이브(파일)는 지금처럼 `app_onedrive_connections` 그 작업공간 행.

### 2-2. 변경 목록

| 단계 | 대상 | 바꾸는 것 |
| --- | --- | --- |
| ① DB | `app_cloud_items`·`app_cloud_stars`·`app_cloud_jobs` 읽기 정책 | 같은 이름으로 다시 만들며 `and app_workspace_has_feature(workspace_id,'files')`만 뺀다 → `app_is_workspace_owner(workspace_id)`. 대상 역할 `authenticated` 그대로 |
| ① DB | `app_cloud_find_in`(그리고 같은 판정이 있으면 `app_cloud_list`·`app_cloud_trail`·`app_cloud_find`) | 본문에서 `has_feature(v_ws,'files')` 줄만 뺀다. owner 1개 확인·SECURITY 종류·search_path·실행 권한(authenticated만)은 그대로 |
| ① DB | `app_operator_features`의 `gdrive_photos`·`files` 행 | **지우지 않는다**(되돌리기 쉽게). 아무도 판정에 쓰지 않게 될 뿐. 정리는 나중 별도 결정 |
| ② Edge | `public-policy-drive` | `fullDriveAllowed`를 "모든 작업공간 true"로(= 늘 `drive.file` + `drive` 요청). `full_drive` = 구글이 실제로 준 경우만(그대로). `photos=scope_missing` 안내는 모두에게. id=1 갱신 조건(운영자 `calls`)은 그대로 |
| ② Edge | `gdrive-photos` | ③④ 문 삭제, `driveToken`을 `workspaceDriveToken`(작업공간별)으로. 토큰 기억 키는 지금도 `작업공간 id + 갱신 토큰 지문`이라 섞이지 않음(179~182줄) |
| ② Edge | `cloud-files` | ③ 기능 키·`gdOwner` 삭제, 구글 토큰을 작업공간별로. `cronSweep`은 "멈춘 줄이 있는 작업공간들"을 서버가 표에서 찾아 차례로(작업공간마다 lease 그대로). 몸통·비밀 머리 규칙 그대로 |
| ③ 화면 | `photo-sources-model.mjs`·`photos.js`·`gdrive-photos.js` | 칩 판정을 기능 키 대신 "Drive 연결 상태(서버 `status` 답)"로. 연결 전이면 원드라이브처럼 '구글 드라이브 연결 뒤 쓸 수 있어요 [연결]'. `drive.file`만 받은 연결이면 '권한 없음 · [Drive 다시 연결]' 한 줄(기존 `GDRIVE_RECONNECT`) |
| ③ 화면 | `menu-model.mjs` | `files` 항목의 `feature: 'files'` 삭제(모두에게) |
| ③ 화면 | 업데이트 기록 | `app/release-notes/…json` 1개(AGENTS.md 10절) |
| 문서 | `multi-user-audit.md` 296줄, `photo-gdrive-permission.md` 0절 첫 줄, `new-user-start.md` 25·40·87줄, `AGENTS.md` 5절 | '운영자 작업공간만' → '각자 자기 것(자기 작업공간·자기 Drive 연결)'. AGENTS.md 5절은 "Operator-only features (calls, Telegram collection)"라 사진·파일이 이미 목록에 없음 → [추정] 고칠 필요 없음, 구현 PR에서 한 번 더 확인 |

### 2-3. 금지 확인표

| 항목 | 지킴 |
| --- | --- |
| anon·PUBLIC 권한 | 새 grant 없음. 정책 대상은 `authenticated` 그대로, 연결 표·사진 색인 표는 service_role만 그대로 |
| RLS 끄기 | 없음. 정책 교체는 같은 이름·같은 표·같은 역할, 조건에서 기능 키만 뺌(owner 조건은 남음) |
| 다른 작업공간 읽기·쓰기 | 없음. 작업공간은 서버가 owner 행으로 정하고, 토큰도 그 작업공간 연결로만. id=1 대체 없음 |
| 화면이 보낸 작업공간 값 | 받지 않음(지금과 같음). 시험으로 고정 |
| Origin 와일드카드 | 없음. `withWebCors` 공용 목록 그대로 |
| 영구 삭제 | 없음. 휴지통으로만·`confirm:true`·한 번에 상한 그대로 |

참고: 정책에서 기능 키 조건을 빼는 것은 "읽을 수 있는 사람을 넓히는 정책 교체"라, `docs/ops-db-workflow.md` 확장 규칙상 승인형 workflow가 자동으로 받지 않을 수 있다. 넓어지는 범위는 "자기 작업공간 owner가 자기 줄을 읽는 것"뿐이지만, 규칙대로 거절되면 커맨드센터가 SQL Editor 경로(AGENTS.md 7절·폰 경로 C)로 적용한다.

## 3. 위험과 막는 법

### 3-1. 구글 — 전체 권한(`drive`)을 모두에게 요청할 때

Google 공식 문서로 확인한 사실:

- `https://www.googleapis.com/auth/drive`는 **제한(Restricted)** 등급, `drive.file`은 비민감 등급. 출처: [Google Drive API — Choose scopes](https://developers.google.com/drive/about-auth).
- 검증받지 않은 앱은 동의 화면 앞에 '확인되지 않은 앱' 화면이 나오고, **검증 전까지 새 사용자 100명까지**만 받는다: "your app will be limited to 100 new users until it is verified". 출처: [Unverified apps — Google Cloud 고객센터](https://support.google.com/cloud/answer/7454865).
- 이 100명 한도는 **프로젝트 평생 누적이며 되돌리거나 바꿀 수 없다**: "The user cap applies over the entire lifetime of the project, and it cannot be reset or changed." / 표: "100 new users in total, after the app presents the unverified app screen". 출처: [Manage App Audience — Google Cloud 고객센터](https://support.google.com/cloud/answer/15549945).
- 앱이 '테스트' 상태면 테스트 사용자 100명까지이고, **테스트 사용자의 동의는 7일 뒤 만료**(갱신 토큰도 만료): "Authorizations by a test user will expire seven days from the time of consent." 출처: 같은 문서.
- 제한 등급을 정식으로 쓰려면 Google 지정 보안 평가 기관의 평가와 12개월마다 재검증이 필요: "must go through a security assessment from Google-empanelled security assessors", "at least every 12 months". 개인용(직접 아는 소수만 쓰는 앱) 예외가 문서에 있다. 출처: [Restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification).
- 확인 못 한 것: '고급 → (앱 이름)(으)로 이동' 버튼 문구는 위 공식 문서에 적혀 있지 않다(실제 화면 캡처로 확인).

우리에게 뜻하는 것:

| 위험 | 막는 법 |
| --- | --- |
| 앱이 아직 '테스트' 상태면 연결이 7일마다 끊김 | [추정] 운영 상태 확인 필요(9-2절 ①). '프로덕션' 상태면 해당 없음 |
| 새 사용자가 '확인되지 않은 앱' 경고를 봄 | 연결 버튼 옆 한 줄 안내(경고가 나오면 '고급'을 눌러 계속)와 PR 첨부 사진. 노조 사람 많아야 10명(AGENTS.md 5절)이라 100명 한도 안 |
| 100명 한도는 프로젝트 평생 누적·되돌릴 수 없음 | 이 Google 프로젝트를 RTW(읽생기)·구독 판매와 같이 쓰면 함께 소모. [추정] 지금까지 경고 화면을 거친 사용자 수는 Google Cloud 콘솔에서만 보임 → 사용자 확인 항목(10절). 구독 판매(PRODUCT-노조구독판매) 때 유료 보안 평가 여부를 따로 결정 |
| D4 결정(심사 범위를 민감 등급 이하로)과 충돌 | 이번 사용자 확정('가')으로 D4의 그 부분을 바꾼다. `multi-user-audit.md` 296줄에 바뀐 날짜·이유를 적는다 |
| 사용자가 동의 화면에서 `drive` 칸만 끄고 동의 | 연결은 저장(`drive.file` 기능 그대로), `full_drive=false`, 사진·파일의 구글 칸만 '권한 없음 · [Drive 다시 연결]' — 지금 운영자에게 하는 방식 그대로 모두에게 |
| 이미 `drive.file`로 연결한 사람 | 연결은 그대로 동작(바구니·자료실). 사진·파일 구글 칸을 열면 서버가 `scope_missing` → '[Drive 다시 연결]' 한 줄. 누르면 같은 연결 흐름(`prompt=consent`, `include_granted_scopes=true`)으로 다시 동의 → 같은 작업공간 행을 고침(패치 → 없으면 넣기, 296~336줄 그대로) |
| 전체 권한 토큰이 새는 경우 피해가 커짐 | 토큰은 지금처럼 service_role 표에만, 응답·로그에 싣지 않음. 쓰기는 `confirm:true` + 휴지통만. 영구 삭제·공유 링크·권한 바꾸기 함수 없음(시험이 문자열로 막음, `cloud-files/handler.ts` 14~15줄) |

### 3-2. (나) 폴더 고르기 안이 안 되는 이유 (기록)

`drive.file` + Google Picker로 폴더를 골라도 그 폴더 안 **기존** 파일 목록을 읽을 수 없다(고른 파일 하나하나만 열림). 사진 칸은 폴더 안 전체를 색인해야 하므로 (나)는 불가 → 사용자 (가) 확정. 출처: 요청함 V29 조사(Google 개발자 포럼).

### 3-3. 데이터 경계

- 사진·파일 색인 표는 이미 `(workspace_id, item_id)` 키라 두 사람 드라이브가 섞이지 않는다.
- 같은 사진 한 장 규칙·사진 정보 고치기(`app_photo_info_edits`, `20261105220000`)는 작업공간별 owner RLS 그대로.
- 사용자 작업공간: id=1과 `app_drive_connections` 운영자 행은 같은 갱신 토큰(20261104233000 51~70줄 확인 블록). 전환 뒤에도 사용자 사진·파일은 그대로 보인다(9-2절 ③에서 운영 확인).

## 4. 단계 나누기 (줄 세우기)

| 순서 | PR | 내용 | 정지 지점 | 되돌리기 |
| --- | --- | --- | --- | --- |
| A1 | Edge `public-policy-drive` | 모두에게 `drive` 요청 + 안내 | Edge 배포(§6) | 이전 운영 SHA 재배포. 이미 넓은 권한으로 연결한 사람의 권한은 남지만 쓰는 함수가 아직 막혀 있어 해 없음 |
| A2 | Edge `gdrive-photos` | 문 바꾸기 + 작업공간별 토큰 | Edge 배포 | 이전 SHA 재배포(운영자만 다시) |
| A3 | 화면 사진 칩 | 연결 상태로 판정, [연결]·[다시 연결] | Pages | PR revert |
| B1 | DB | `files` 조건 빼기(정책 3개 + 찾기 함수), migration 짝 5파일(`.precheck/.snapshot/.postcheck/.rollback.sql`, `.summary.md`) | DB 적용(§6·§7). 시험 적용(dry-run) 먼저 | rollback SQL = 기능 키 조건을 다시 넣은 원래 정의(snapshot 그대로) |
| B2 | Edge `cloud-files` | 문 바꾸기 + 작업공간별 구글 토큰 + 예약 입구 작업공간 여러 개 | Edge 배포 | 이전 SHA 재배포 |
| B3 | 화면 메뉴 | `menu-model.mjs` 파일 항목 기능 키 삭제 + `new-user-start.md` 고침 | Pages | PR revert |

- A와 B는 서로 다른 파일이라 나란히 가능. 단 A1이 먼저 운영에 들어가야 새 연결이 `drive`를 받는다.
- B1(DB) → B2(Edge) 순서. B2를 먼저 배포하면 Edge는 통과해도 RLS가 색인을 안 보여 줘 빈 목록이 된다(보안 문제는 없지만 화면이 이상).
- B3은 B2 운영 반영 뒤.
- **겹치는 파일**: `app/menu-model.mjs`는 뉴스 설계(S62-08b, `docs/design/news-for-all.md`)의 `outside` 항목도 고친다 → B3과 뉴스 메뉴 PR을 앞뒤로 세운다(같은 PR로 묶어도 됨, 줄 다름). MULTI-처음쓰는사람 남은 PR이 `menu-model.mjs`를 만지면 그 뒤.

## 5. 시험 목록 (구현 PR에서)

- `gdrive-photos`·`cloud-files`: 기능 키가 없는 작업공간도 자기 연결로 200, 연결 없으면 424 `drive_not_connected`, `drive.file`만이면 `scope_missing`.
- 몸통에 다른 `workspace_id`·`user_id`를 넣어도 무시되고 자기 작업공간 결과만(시험으로 고정).
- 두 작업공간 A·B: A의 요청이 B 연결 토큰을 읽지 않음(가짜 fetch로 토큰 요청 본문의 refresh token 확인), id=1 표를 읽지 않음(경로 문자열로 확인).
- 토큰 기억 키가 작업공간마다 다름(기존 시험 유지).
- `public-policy-drive`: 모든 작업공간에서 `scope`에 `drive` 포함, `full_drive`는 구글 응답에 `drive`가 있을 때만.
- RLS: `authenticated` B가 A의 `app_cloud_items`를 못 읽음(postcheck SQL), anon 0줄.
- `cronSweep`: 비밀 머리 없으면 401, 작업공간 여러 개를 서버가 찾음, 몸통 `{}` 외 400(기존 유지).
- E2E: 새 계정 메뉴에 [파일], 사진 화면에 구글 드라이브 칸, 연결 전 [연결] 문구.

## 6. 완료 기준 (요청함 그대로)

새 계정(삼성 인터넷)에서 Drive 연결(경고 넘기기) → 사진 화면에 구글 드라이브 칸 → 자기 드라이브 사진만 보임, 사용자 계정 사진은 그대로, 다른 작업공간 요청은 서버 거절 시험, 새 계정 메뉴 판에 [파일]·열면 자기 드라이브만 + PC·폰 화면 사진 PR 첨부(예시 사진).

## 7. 파일 메뉴 안 다른 칸 확인 ([추정] → 구현 PR에서 확인)

[파일] 화면(`app/files.js`)이 부르는 서버: `cloud-files`(status·sync·folder·job·open-url 등, 104~116줄 주석), 자료실 보내기(`basket-library-send.js`, 자료실은 이미 모두에게), '이 폰'(폰 앱 다리, 서버 저장 없음, 104~110줄), '내 PC'(바구니 PC 앱 로컬 문 127.0.0.1, 111줄~). [추정] 사용자 전용 서버 기능을 부르는 칸은 없다 — 구현 PR이 `files.js`의 호출을 전수 확인하고, 있으면 그 칸만 서버 판정으로 뺀다.

## 8. 요청함 방 추천 (사용자 확정 아님)

- 사진 정리(이름 바꾸기·옮기기·Drive 휴지통으로)도 사용자와 같은 규칙(누를 때만·확인 한 번·영구 삭제 없음)으로 각자 자기 드라이브에. → 지금 함수 구조상 문만 바꾸면 그대로 따라오므로 이 설계는 **추천대로** 그린다. 막으려면 10절 질문 2에 '아니오'.

## 9. 커맨드센터 운영 확인 (읽기 전용)

### 9-1. 읽기 전용 SQL (select만, PR 댓글에도 같은 내용)

```sql
-- ① Drive 연결 현황: 작업공간 수, 전체 권한 받은 수 (토큰 값은 읽지 않음)
select count(*) as connections, count(*) filter (where full_drive) as full_drive
  from public.app_drive_connections;
-- ② 운영자 허용 표의 사진·파일 키 (작업공간 수만)
select feature, count(*) from public.app_operator_features
 where feature in ('gdrive_photos','files') group by feature;
-- ③ 운영자 연결 행과 id=1이 같은 토큰인지 (참·거짓만)
select (d.google_refresh_token = c.google_refresh_token) as same_token
  from public.app_drive_connections d
  join public.app_operator_features f on f.workspace_id = d.workspace_id and f.feature = 'gdrive_photos'
  cross join public.public_policy_drive_config c where c.id = 1;
-- ④ 파일 정책·찾기 함수의 지금 정의
select polname, pg_get_expr(polqual, polrelid) from pg_policy
 where polrelid in ('public.app_cloud_items'::regclass,'public.app_cloud_stars'::regclass,'public.app_cloud_jobs'::regclass);
select p.proname, position('''files''' in pg_get_functiondef(p.oid)) > 0 as checks_files
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname like 'app_cloud_%';
-- ⑤ 작업공간 수(가입자 규모)
select count(*) from public.app_workspace_members where role = 'owner';
```

### 9-2. 대시보드 확인

1. Google Cloud 콘솔 → OAuth 동의 화면(대상): 게시 상태가 '테스트'인지 '프로덕션'인지, 검증 상태, 지금까지 사용자 수(한도 표시). (사용자 로그인 필요할 수 있음)
2. 동의 화면에 `.../auth/drive` 범위가 등록돼 있는지.
3. 전환 뒤 사용자 계정 사진·파일 그대로인지(②-2 같은 토큰 확인 ③이 true면 안전).

## 10. 사용자 결정이 더 필요한 것

1. 구글 앱의 '테스트 사용자 100명·7일마다 다시 연결'이나 '평생 100명' 한도를 받아들이고 그대로 갈까요? (노조 10명이면 충분. 판매 때 유료 심사는 그때 따로 결정)
2. 다른 사람도 사진·파일을 이름 바꾸기·옮기기·휴지통으로 보내기까지 할 수 있게 할까요? (추천: 예 — 사용자와 같은 규칙)
