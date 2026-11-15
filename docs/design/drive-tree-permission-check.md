# Drive 자료트리 권한 범위 점검 (DRIVE-자료트리)

📱 폰 가능(조사·설계) — 이 문서는 코드 조사와 설계만 한다. Google 설정·Edge·DB·권한 변경 없음. 권한을 넓히는 일은 §6 정지 지점이며 사용자 승인 전에는 하지 않는다.

- 작성: 2026-10-16, Claude Code 웹. 기준 main `a96161e`.
- 원장 행: `docs/roadmap.md`의 DRIVE-자료트리(2026-10-16 사용자 결정 5건 + 지정 폴더 안 파일만).

## 1. 결론 먼저

- 지금 Web2가 Google Drive에 받은 권한은 **`drive.file` 하나**다. 이 권한으로는 **앱이 직접 만든(올린) 파일**만 보고 고칠 수 있다.
- 그래서 **지정 폴더 안의 기존 파일(Drive 앱·PC에서 직접 넣은 파일)은 목록에 안 보이고, 별표를 읽을 수도 붙일 수도 없다.**
- 자료실에 지금 있는 자료(앱이 올린 파일)는 지금 권한으로도 별표 읽기·쓰기가 된다. 결정 ③("지금 자료실 자료에 한 번에 별표")은 권한을 넓히지 않고 할 수 있다.
- 결정 5건을 모두 지키려면 최소 **`drive.metadata`**(파일 내용은 못 보고 이름·폴더·별표 같은 정보만 보고 고치는 권한)를 더해야 한다. 이것은 Google이 "제한(restricted)"으로 분류하는 권한이라 연결 화면에 경고가 뜬다(§5).

## 2. 지금 Drive 연결 구조 (코드 조사)

| 항목 | 내용 | 위치 |
| --- | --- | --- |
| 권한 요청 | `scope: https://www.googleapis.com/auth/drive.file`, `access_type=offline`, `prompt=consent`, `include_granted_scopes=true` | `supabase/functions/public-policy-drive/index.ts:124-133` |
| Drive 권한 문자열 | 저장소 전체에서 `drive.file` 하나뿐. `drive.readonly`·`drive`·`drive.metadata` 없음 | 전체 검색 |
| 연결하는 사람 | 자료실 [Drive 다시 연결](owner·admin만) → `public-policy-drive` `drive-start` → Google 동의 → 콜백 | `app/library-upload.js:25`, `public-policy-drive/index.ts:101-110, 185-263` |
| 토큰 보관 | **workspace 공용 1개**. refresh token을 DB 표 `public_policy_drive_config`(id=1)에 둔다. 다시 연결하면 모든 Drive 기능의 토큰이 한꺼번에 바뀐다 | `public-policy-drive/index.ts:258` |
| 브라우저 | Drive를 직접 부르지 않는다(Google Picker·gapi 없음). 모든 Drive 호출은 Edge 함수 | — |
| 다른 Google 권한 | 일정·할 일(`calendar.events`, `calendar.calendarlist.readonly`, `tasks`)은 별도 연결(`app_google_calendar_connections`) | `google-calendar/index.ts:81`, `google-tasks/index.ts:61` |

Drive를 쓰는 Edge 함수(모두 같은 공용 토큰, verify_jwt는 `docs/web2-env6b-edge-source.md` 5절):

| 함수 | verify_jwt | 하는 일 |
| --- | --- | --- |
| `public-policy-drive` | false(코드에서 owner·admin 확인) | 연결·토큰 저장 |
| `library-files` | false(코드 owner) | 자료실 폴더 만들기·올리기 |
| `workspace-drive` | false(코드) | 프로젝트 폴더·올리기·내려받기 토큰 |
| `meeting-files` | false(코드) | 회의 폴더·올리기 |
| `basket-files` | false(코드 owner) | "Web2 바구니" 폴더·사진 올리기·OCR·삭제 |
| `document-actions` | true + owner | 휴지통 이동·HWP 편집 백업·HTML 보기 |
| `document-ai-index`, `meeting-ai-ingest` | true | 파일 내용 읽기(AI) |
| `drive-summary` | false(owner 또는 예약 비밀값) | "Web2 읽기용 사본" 만들기 |

부르는 Drive API: 폴더 만들기, 올리기(resumable), 내용 받기(`alt=media`), 휴지통 이동(`PATCH trashed`), 복사, 앱 표시(`appProperties`)로 찾기. **`starred`를 읽거나 쓰는 코드는 아직 없다.** 자료실 표(`app_documents`)에도 별표·중요 표시 칸이 없다.

기존 문서도 같은 판단이다: `docs/basket-design.md:148`(앱 밖에서 만든 파일은 drive.file로 읽을 수 없다고 보아야 함), `docs/web2-work-plan-20261012.md:102`(권한을 넓히지 말고 멈춰 보고), `supabase/functions/drive-summary/README.md`(새 권한 없음).

## 3. 할 수 있는 일 판단표

| 하고 싶은 일 | 지금(`drive.file`) | `drive.metadata.readonly` 추가 | `drive.metadata` 추가 | `drive`(전체) |
| --- | --- | --- | --- | --- |
| 앱이 올린 파일 목록·별표 읽기 | ✅ | ✅ | ✅ | ✅ |
| 앱이 올린 파일 별표 붙이기·떼기 | ✅ | ✅(기존 drive.file로) | ✅ | ✅ |
| 지정 폴더 안 **기존 파일** 목록(나무 구조) | ❌ 안 보임 | ✅ | ✅ | ✅ |
| 기존 파일 별표 **읽기**(Drive 앱에서 붙인 별표 반영) | ❌ | ✅ | ✅ | ✅ |
| 기존 파일 별표 **붙이기·떼기**(Web2 ⭐ → Drive) | ❌ | ❌ | ✅ | ✅ |
| 기존 파일 **내용** 읽기(미리보기·AI) | ❌ | ❌ | ❌ | ✅ |
| Google 분류 | 일반(권장) | 제한 | 제한 | 제한 |

- 결정 ④("Drive 어디서 붙인 별표도 자료실을 열 때 반영, Web2 ⭐는 Drive에 바로 반영")를 기존 파일까지 지키려면 **`drive.metadata`가 최소**다.
- 기존 파일 내용 보기는 결정 5건에 없으므로 넓히지 않는다. 열 때는 Drive 링크(`webViewLink`)로 사용자의 Google 화면에서 연다.
- Google Picker(사용자가 파일을 골라 앱에 열어 주기)는 `drive.file` 안에서 기존 파일을 열 수 있는 다른 길이다. 다만 **파일마다 한 번씩 골라야** 하고, Drive 앱에서 나중에 넣은 파일은 다시 골라야 한다. 폴더를 고르면 폴더만 열리고 안의 파일까지 열리는지는 확실하지 않아 착수 때 시험해야 한다. 결정 ④의 "어디서 붙여도 반영"과 맞지 않아 주 방법으로는 추천하지 않는다.

### 3.1 별표의 "주인" 확인 (결정 ①)

- Drive 별표는 **Google 계정마다 따로** 붙는다. Web2가 읽는 별표는 "Drive 연결에 동의한 Google 계정"의 별표다.
- 결정 ①은 "Web2에 로그인한 사용자 계정의 별표"다. sole-owner라 보통 같은 계정이지만, **Drive 연결 계정과 Web2 로그인 계정이 같은지 사용자 확인이 필요**하다(웹 세션에서는 production 조회를 하지 않으므로 확인하지 않았다). 다르면 결정 ①을 지키려면 Drive를 로그인 계정으로 다시 연결해야 하고, 그러면 기존 "Web2 바구니"·자료실 폴더(소유자 확인을 함)가 새 계정에서 안 보일 수 있다.

## 4. 넓힐 때의 최소안

**`drive.file` 유지 + `drive.metadata` 추가** (두 권한을 함께 요청).

- 내용 읽기 권한(`drive.readonly`·`drive`)은 요청하지 않는다.
- 쓰는 곳을 줄인다: 새 권한이 필요한 호출은 자료트리 기능 하나(목록·별표 읽기/쓰기)에만 둔다. 다른 함수의 동작·코드는 그대로다(토큰은 공용이라 다른 함수도 넓은 토큰을 갖게 되지만, 코드가 부르는 API는 바뀌지 않는다).
- 지정 폴더 밖은 다루지 않는다: 목록은 지정 폴더에서 아래로만 내려간다. 별표 검색(`starred = true`) 결과도 지정 폴더 안인지 확인한 것만 자료실에 넣는다(원장 같은 날 추가 결정).
- 별표 쓰기는 `files.update`의 `starred` 한 칸만 바꾼다. 이름·폴더·공유는 고치지 않는다.
- 코드에서 동의 결과의 실제 권한 목록을 확인한다. Google 동의 화면에서 사용자가 새 권한 칸을 끄고 동의할 수 있으므로, 그때는 자료트리만 "권한 없음"으로 보이고 다른 기능은 그대로 둔다.
- 지정 폴더 id 보관: `app_drive_settings`에 칸 추가(DB 변경, 별도 설계·정지 지점) 또는 기존 `library_folder_id` 재사용(결정 D2).

### 일상어 3줄 (사용자 승인용)

- **무엇이 바뀌나**: Web2가 내 Drive 파일의 이름·폴더·별표를 볼 수 있고 별표를 붙이고 뗄 수 있게 된다. 파일 내용은 지금처럼 앱이 올린 것만 본다.
- **잘못되면**: 다시 연결할 때 다른 Google 계정을 고르면 바구니·자료실 올리기가 멈춘다. 새 권한 칸을 끄고 동의하면 자료트리만 안 된다. 코드 실수로 별표를 잘못 바꿔도 파일 자체는 지워지거나 바뀌지 않는다(별표만).
- **되돌리는 법**: Google 계정의 "타사 앱 연결"에서 Web2 접근을 지운 뒤, 이전 코드로 되돌린 연결 기능으로 [Drive 다시 연결]을 한 번 누르면 지금 권한(`drive.file`)으로 돌아간다. 그 사이 몇 분간 Drive 기능이 멈춘다.

## 5. Google 쪽 설정 변경 절차 (승인 뒤, 사용자가 PC 또는 폰 브라우저에서)

사전 확인(지금 바로 해 두면 좋은 것, 읽기만):

1. Google Cloud 콘솔 → Google 인증 플랫폼(Google Auth Platform) → **대상(Audience)**: 앱 사용자 유형(외부/내부)과 게시 상태(테스트 중/프로덕션)를 캡처한다.
   - "테스트 중"이면 지금도 refresh token이 7일마다 끊기는 상태일 수 있다. 실제로 끊긴 적이 없다면 "프로덕션"일 가능성이 높다.
2. 같은 화면 → **데이터 액세스(Data access)**: 등록된 권한 목록에 `drive.file`이 있는지 캡처한다.
3. Drive 연결 계정과 Web2 로그인 계정이 같은지 확인한다(§3.1).

변경 순서:

1. (정지 지점) 커맨드센터 승인.
2. Google Cloud 콘솔 → 데이터 액세스 → 권한 추가 → `https://www.googleapis.com/auth/drive.metadata` → 저장.
   - 제한 권한이라 Google 검증 안내가 뜬다. 개인용(사용자 100명 미만, 본인만)이면 검증 없이 쓸 수 있고 연결할 때 "확인되지 않은 앱" 경고가 뜬다. 조직(Google Workspace) 계정이면 관리자 정책이 막을 수 있다.
3. (정지 지점) `public-policy-drive`의 권한 요청 문자열에 `drive.metadata` 추가 + 콜백에서 받은 권한 목록 확인 → 사용자 승인형 Edge workflow로 배포(verify_jwt=false 유지, 배포 전 현재 운영 소스 SHA 기록).
4. Web2 자료실 → [Drive 다시 연결] → **기존과 같은 Google 계정** 선택 → 경고 화면에서 "고급 → 계속" → 두 권한 칸 모두 체크 → 동의.
5. 확인(데이터 생성 없이): 바구니 사진 올리기 화면 열기·자료실 목록·HWP 열기가 그대로 되는지, 자료트리 시험 화면에서 지정 폴더의 기존 파일 이름이 보이는지.

되돌리기:

1. Google 계정 → 보안 → 타사 앱 연결에서 이 앱 접근 삭제(모든 Drive 권한이 한꺼번에 끊김).
2. `public-policy-drive`를 이전 운영 소스 SHA로 같은 workflow로 재배포(`drive.file`만 요청).
3. [Drive 다시 연결] → 같은 계정 → 동의. 콘솔의 `drive.metadata` 권한 등록은 지워도 되고 남겨도 된다(요청하지 않으면 쓰이지 않음).

## 6. 정지 지점 (AGENTS.md §6)

- Google Cloud 콘솔 권한 추가(외부 설정 변경).
- `public-policy-drive` Edge 배포(권한 요청 변경).
- 자료트리 기능용 Edge 배포(새 함수 또는 기존 함수 동작 추가).
- 지정 폴더·별표 연동 기록을 위한 DB 변경(필요 시).

AI는 어느 것도 실행·승인하지 않는다.

## 7. 결정 필요 (일상어)

- **D1. Drive 권한을 어떻게 할까**
  - ① 파일 정보·별표만 보고 고치는 권한(`drive.metadata`)을 더한다 — **추천**. 이유: 결정 5건을 모두 지키는 가장 작은 권한이다. 파일 내용은 지금처럼 못 본다.
  - ② 정보·별표 읽기만 더한다(`drive.metadata.readonly`). 이유: 더 좁지만 Web2에서 기존 파일에 ⭐를 누르면 Drive에 반영되지 않는다(결정 ④ 일부 포기).
  - ③ 넓히지 않고, 지정 폴더를 앱이 만든 자료실 폴더로 정한다. 이유: 권한 변경이 없지만 Drive 앱에서 직접 넣은 파일은 자료트리에 안 나온다.
- **D2. 지정 폴더를 어떻게 정할까**
  - ① 사용자가 Drive 폴더 주소를 붙여 넣어 한 번 정하고 Web2 DB에 저장 — **추천**. 이유: 원하는 폴더를 고를 수 있고, 바꾸기도 쉽다(DB 칸 추가 1건 필요).
  - ② 지금 자료실 폴더("공공기관사업팀 Workspace/자료실")를 그대로 지정 폴더로. 이유: DB 변경이 없지만 다른 폴더를 쓸 수 없다.
- **D3. Drive 연결 계정과 Web2 로그인 계정이 다르면**
  - ① Drive 연결 계정의 별표를 기준으로 본다 — **추천**. 이유: 계정을 바꾸면 바구니·자료실 폴더 확인이 깨질 수 있어 위험이 크다. sole-owner라 실제로는 같은 사람이다.
  - ② 로그인 계정으로 Drive를 다시 연결한다. 이유: 결정 ① 문구 그대로지만 기존 Drive 폴더를 옮기는 작업이 따로 필요하다.
