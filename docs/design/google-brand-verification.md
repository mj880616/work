# 구글 로그인·권한 화면에 '웹2' 이름 보이기 (AUTH-구글화면이름)

- 요청: Web2 요청함 [11/01 00:04]. 명진 결정 11/01 00:06 "a안 ㄱ"(구글 브랜드 인증 먼저, 맞춤 로그인 주소는 보류).
- 상태: 설계. 구현(처리방침 페이지·콘솔 입력)은 커맨드센터가 한다.
- 공개 페이지(S47-8): 소개 `https://work.bokdoong.com/work/about/`, 처리방침 `…/about/privacy/`, 약관 `…/about/terms/`, 로고 `about/nojoplus-logo-120.png`(120×120). 저장소 `about/`. 로그인 화면 아래에 소개·처리방침 링크.

## 1. 지금 왜 주소가 보이나 (사실)

- 구글 로그인·Drive 연결 화면 제목에 Supabase 프로젝트 주소(`<프로젝트>.supabase.co`)가 뜨고, 노란 '구글 인증을 받지 않은 앱' 안내가 붙는다(명진 화면 캡처 11/01 00:04).
- Supabase 문서: 설정하지 않으면 동의 화면에 프로젝트 주소가 보이고, 구글 인증 플랫폼 콘솔 '브랜딩'에 이름·로고를 넣고 브랜드 인증을 받으면 프로젝트 주소 대신 그 이름이 보인다. 브랜드 인증은 자동이 아니고 영업일 며칠 걸린다. 맞춤 주소(`auth.예시.com`)도 함께 권한다.
- Web2가 구글에 요청하는 권한(저장소 코드 기준):
  - `calendar.events`, `calendar.calendarlist.readonly` (`google-calendar`)
  - `tasks` (`google-tasks`)
  - `drive.file` (`public-policy-drive`, 모든 사용자)
  - `drive` (`public-policy-drive`가 운영자 작업공간 연결에서만 더 요청 — 사진 출처 `gdrive-photos`·파일 탐색기 `cloud-files`용. S50-8, 명진 결정 11/05 '가')
- `drive`(Drive 전체)는 구글 분류상 **제한 권한**, 캘린더·할 일은 **민감 권한**이다(추정 — 콘솔 '데이터 접근' 화면에서 확인).

## 2. 무엇을 하나 (A안)

1. **공개 소개 페이지**: 로그인 없이 열리는 Web1 페이지 하나(예: `bokdoong.com/about/` 또는 기존 공개 경로 안). 첫 줄에 앱 이름 '웹2'를 동의 화면 이름과 **글자까지 똑같이** 쓰고, 무엇을 하는 앱인지 한두 문장. 구글은 동의 화면 이름과 홈페이지 이름이 다르면 바로 거절한다(같은 Supabase 사용자의 거절 사례가 구글 포럼에 있음).
2. **개인정보 처리방침 페이지**: 같은 Web1 공개 경로. 구글 데이터(캘린더·할 일·Drive)를 무엇에 쓰는지, 어디에 저장하는지, 남과 나누지 않음, 지우는 방법, 연락처(공개용 주소만). 개인 이름·개인 메일은 쓰지 않는다(공개 저장소).
3. **도메인 소유 확인**: 구글 Search Console에서 `bokdoong.com` 소유 확인(DNS TXT 한 줄 — Cloudflare에서 CC가 넣을 수 있음, 브라우저 연결 필요).
4. **콘솔 '브랜딩' 입력**: 앱 이름 `웹2`, 지원 메일, 로고(120×120, 기존 앱 아이콘), 홈페이지 = 1의 주소, 처리방침 = 2의 주소, 승인된 도메인 `bokdoong.com`. 그 뒤 '인증 센터'에서 브랜드 인증 신청.
5. 결과 기다림(며칠). 구글이 메일로 묻는 게 있으면 CC가 답 초안을 만들고 명진이 보낸다.

## 3. 노란 안내는 따로

- 브랜드 인증은 **이름·로고**만 바꾼다. 노란 '인증을 받지 않은 앱' 안내는 제한·민감 권한을 쓰는 한 남을 수 있다.
- 없애려면 권한(scope) 인증이 필요하다. Drive 전체(`drive`)는 제한 권한이라 해마다 외부 보안 점검(유료)이 요구될 수 있다. 개인용 앱에는 과하다.
- 그래서 이번 범위는 이름만. 노란 안내는 '그대로 둠'을 추천(본인만 쓰는 앱이라 '고급 → 이동'으로 넘어가는 지금 흐름 유지).
- S50-8(명진 결정 11/05 '가'): 다른 사람(운영자 아닌 작업공간)의 Drive 연결은 `drive.file`만 요청한다(서버가 작업공간 기준으로 정함, 화면 값 무시). 제한 등급 `drive`는 운영자(명진) 연결에서만 요청하고, 명진 연결은 다시 연결시키지 않는다. 그래서 다른 사람이 보는 동의 화면에는 제한 권한이 나오지 않는다.
- 남는 것(추정): 콘솔 '데이터 액세스'에 `drive`가 등록돼 있으면 민감 권한 인증만으로는 앱 전체 경고가 남을 수 있다. 인증 신청 때 `drive`를 목록에서 빼고 신청할지(운영자 연결은 미인증 경고를 넘겨 그대로 씀), 운영자 전용 목적으로 적을지 CC가 콘솔 화면을 보고 정한다. 설계: `multi-user-audit.md` 8절.

## 4. 보안·영향

- 서버·DB·Edge·로그인 설정은 바꾸지 않는다(콘솔 표시 정보와 공개 페이지 두 개만).
- 읽생기도 같은 구글 로그인 앱을 쓰면 읽생기 로그인 화면 이름도 '웹2'로 바뀐다. 콘솔에서 OAuth 클라이언트가 읽생기와 같은지 먼저 확인하고, 같으면 명진에게 한 줄 알린다.
- 앱 상태가 '테스트'면 구글이 7일마다 다시 로그인을 요구할 수 있다. 콘솔에서 '프로덕션'인지 같이 확인만 한다(바꾸는 건 별도 결정).
- B안(맞춤 로그인 주소 `auth.bokdoong.com`)은 유료 추가 기능이고 읽생기와 로그인 주소를 같이 바꿔야 해서 보류.

## 5. 나눠 맡기

| 누가 | 무엇 |
| --- | --- |
| CC | 1·2 공개 페이지 PR·merge·배포 확인, 3 DNS 줄(브라우저 연결 시), 4 입력값 준비·입력, 4절 확인 |
| 명진 | 구글 클라우드 콘솔·Search Console 로그인과 2단계 인증, 브랜드 인증 '제출' 버튼, 구글 메일 답장 |

## 6. 완료 기준

- 콘솔 인증 센터에 브랜드 '인증됨'.
- 명진 폰·PC에서 Web2 로그인·Drive 연결 화면 제목에 '웹2'가 보임(실기기 확인).

## 7. 참고

- Supabase, Login with Google: https://supabase.com/docs/guides/auth/social-login/auth-google
- 구글 포럼, Supabase 콜백 주소 때문의 이름 불일치 거절 사례: https://discuss.google.dev/t/oauth-branding-verification-stuck-name-mismatch-due-to-supabase-callback-domain-no-trust-safety-email-received/389007

## 노조+ 전환 (BRAND-웹2흔적지우기, 2026-11-16)

- 요청: 명진 11/16 09:23 "로그인할 때 나타나는 파비콘이 옛 웹2 파비콘" · "웹2의 흔적 이름, 파비콘 등 다 지우고 노조플러스로".
- 저장소: 공개 페이지 로고를 `about/nojoplus-logo-120.png`(120×120, `app/app-icon.svg`에서 그림)로 바꿨다. 옛 `about/web2-logo-120.png`는 지웠다.
- 구글 콘솔(명진 로그인 필요, 나머지는 CC): 구글 인증 플랫폼 → '브랜딩'
  1. 앱 이름: `노동조합+` (소개 페이지 첫 줄과 글자까지 같게)
  2. 앱 로고: 저장소 `about/nojoplus-logo-120.png` 파일을 올린다(또는 `https://nojoplus.com/work/about/nojoplus-logo-120.png`에서 받아 올림).
  3. 홈페이지·처리방침·약관 주소는 그대로.
  4. 저장 → 이름·로고가 바뀌면 브랜드 인증을 다시 받는다('인증 센터'). 결과가 나올 때까지 동의 화면에는 옛 이름·로고가 남을 수 있다.

## 구글 창구 둘로 나누기 (AUTH-구글권한나누기, S71-01, 2026-11-26)

- 배경(사실): 구글 OAuth 심사가 멈춤. 구글 메일 11/06·11/18·11/22 — 콘솔에 등록한 권한(tasks·calendar.events)과 앱이 실제로 요청한 권한(drive·tasks.readonly 포함)이 다르다. 요청 권한과 콘솔 권한은 글자까지 같아야 하고(최소 권한), 동의 화면을 영어로 띄운 데모 영상을 다시 내야 한다.
- `tasks.readonly`는 코드에 없었다. 모든 연결 시작이 `include_granted_scopes=true`였으므로 예전에 허락한 권한이 새 요청에 합쳐져 보였을 가능성이 크다(추정). 이번에 모든 시작에서 뺐다.
- 명진 결정(2026-11-26 10:02 'ㄱ', CC 추천안): 구글 로그인 창구를 둘로 나눈다. 이 결정은 S62-11(모든 작업공간이 drive 전체 요청)을 바꾼다.

### 새 구조

| 창구 | OAuth 클라이언트 | 누가 | 요청 권한 | 심사 |
| --- | --- | --- | --- | --- |
| 심사용 창구(`review`) | 지금 클라이언트(앱 값은 `public_policy_drive_config` id=1) | 모든 사용자 | 아래 표 6개 안에서만, 기능별로 필요한 것만 | 받음 |
| 명진 전용 창구(`full`) | 새 구글 클라우드 프로젝트의 클라이언트(Edge 비밀값 `GOOGLE_DRIVE_FULL_CLIENT_ID`·`GOOGLE_DRIVE_FULL_CLIENT_SECRET`) | 운영자 작업공간만(서버 허용 표 `calls`, `app_operator_feature_workspace`) | `https://www.googleapis.com/auth/drive` 하나 | 안 받음(동의 화면 '테스트', 시험 사용자 = 명진 계정) |

- 권한 목록·동의 화면 주소·창구 고르기·토큰 새로 받기는 `supabase/functions/_shared/google-oauth-clients.mjs` 한 곳에 있다. `include_granted_scopes`는 어디에도 없다.
- Drive 연결(`public-policy-drive`): 운영자 + 비밀값 둘 다 있음 → 명진 전용 창구로 `drive`. 그 밖(운영자 아님, 비밀값 없음) → 심사용 창구로 `drive.file`. 화면이 보낸 값은 보지 않는다. 콜백도 운영자인지 다시 확인하고, 연결 행 옆 `app_drive_connection_clients`에 창구(`review`/`full`)를 적는다(행 없음 = `review`).
- 토큰 새로 받기: `workspace-drive-token.ts`(자료실·회의·문서 등 공용)·`gdrive-photos`·`cloud-files`·`drive-summary`가 모두 같은 도우미로 그 연결을 내준 창구의 앱 값을 쓴다. 비밀값이 없으면 창구 기록을 읽지 않고 심사용 창구로 본다(그때 남은 `full` 연결은 갱신이 실패해 '[Drive 다시 연결]'이 뜨고, 다시 연결하면 심사용 창구로 저장된다).
- 달력·할 일 연결(`google-calendar`·`google-tasks`)과 그 토큰은 늘 심사용 창구다.
- 운영자가 아닌 사람: Drive 전체를 요청하지 않으므로 사진의 구글 드라이브 칸·[파일]의 구글 쪽은 새로 연결해서는 열리지 않는다(예전에 `drive`를 허락한 연결은 그 허락이 살아 있는 동안 그대로). 화면 안내 정리는 범위 밖(PR 본문 '범위 밖 발견사항').

### 콘솔에 맞출 권한 목록(심사용 창구 '데이터 액세스')

| 권한 | 쓰는 곳 |
| --- | --- |
| `openid` | 로그인·연결 계정 확인 |
| `email` | 연결한 구글 계정 표시 |
| `https://www.googleapis.com/auth/calendar.events` | 달력 일정 읽기·쓰기(`google-calendar`, `google-tasks` 연결에도 함께) |
| `https://www.googleapis.com/auth/calendar.calendarlist.readonly` | 보여 줄 캘린더 고르기 |
| `https://www.googleapis.com/auth/tasks` | 구글 할 일(`google-tasks`) |
| `https://www.googleapis.com/auth/drive.file` | 자료실·메모·회의가 만든 파일만(`public-policy-drive`) |

- 이 밖의 권한(`drive`·`drive.readonly`·`tasks.readonly`·`calendar` 전체 등)은 콘솔 목록에서 뺀다. 시험 `tests/security/google-oauth-scopes.test.mjs`가 코드 쪽 목록을 지킨다.
- 확인 필요(추정): Supabase 로그인(구글 로그인 버튼)이 같은 OAuth 클라이언트를 쓰면 로그인 때 `profile`(`userinfo.profile`)도 요청된다. 콘솔 '데이터 액세스'에 그것도 있어야 하는지, Supabase 구글 로그인 설정의 클라이언트 ID가 위 심사용 창구와 같은지 CC가 콘솔에서 확인한다.

### CC 할 일(순서)

1. DB `20261126100000_drive_connection_clients` 적용(승인형 DB workflow, dry-run 먼저).
2. 코드 PR merge → Edge 배포(PR 본문 목록 순서대로, 한 번에 하나, 되돌리기 ref 기록).
3. 새 구글 클라우드 프로젝트 만들기(심사 안 받음): OAuth 동의 화면 'External·테스트' 상태, 시험 사용자에 명진 계정 하나. '데이터 액세스'에 `https://www.googleapis.com/auth/drive` 하나. Drive API 켜기.
4. 그 프로젝트에 OAuth 클라이언트(웹 애플리케이션) 만들기: 승인된 리디렉션 주소 = `https://<프로젝트>.supabase.co/functions/v1/public-policy-drive/callback`(지금 클라이언트와 같은 주소).
5. Edge 비밀값 두 개 넣기: `GOOGLE_DRIVE_FULL_CLIENT_ID`, `GOOGLE_DRIVE_FULL_CLIENT_SECRET`(값은 채팅·문서·로그에 쓰지 않는다).
6. 명진이 앱에서 기존 '[Drive 다시 연결]'을 한 번 누른다(명진 전용 창구로 드라이브 전체 동의). 사진·파일 구글 칸·자료실이 열리는지 실기기 확인.
7. 심사용 창구 콘솔 '데이터 액세스'를 위 표 6개와 같게 맞춘다(`drive`·`tasks.readonly` 빼기).
8. 동의 화면을 영어로 띄운 데모 영상 다시 찍기(명진 화면 녹화) → 구글 메일에 답장(명진 보냄, CC가 초안).

### 되돌리기

- Edge 함수를 이전 운영 커밋으로 되돌리면 지금(창구 하나, `include_granted_scopes=true`) 그대로다. 명진 전용 창구로 받은 연결은 이전 코드에서 갱신이 실패하므로 '[Drive 다시 연결]'을 한 번 누른다.
- DB 표는 남아 있어도 이전 코드는 읽지 않는다(짝 rollback은 기록 1행만 지움).
