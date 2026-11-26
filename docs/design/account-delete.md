# 계정 삭제 (S69 STORE-계정삭제)

구글 플레이 정책: 계정을 만들 수 있는 앱은 (1) 앱 안에서 계정 삭제를 시작할 수 있어야 하고 (2) 앱 밖 웹 주소로도 삭제를 요청할 수 있어야 한다.
이 문서는 WORK ON+ 1차 구현의 설계 기록이다. 결정이 필요한 선택지는 맨 아래에 있다.

## 1. 흐름

| 단계 | 어디 | 하는 일 |
| --- | --- | --- |
| 입구 | 내 프로필 '계정' 칸 [계정 삭제] (`app/account-delete.js`) | 확인 창: 한 줄 요약(삭제·로그아웃·되돌릴 수 없음·구글 원본은 남음) + 접힌 자세한 목록, 확인 글자 `삭제` |
| 미리 보기 | Edge `account-delete` `{action:'check'}` → DB `app_account_delete_check()` | 같은 삭제를 끝까지 해 본 뒤 되돌리고 `{ok}` 또는 거절 이유 이름만 돌려줌. 거절이면 확인 칸·버튼 잠김 |
| 삭제 | Edge `{action:'delete', confirm:'삭제'}` → DB `app_account_delete('삭제')` | 한 트랜잭션: 내 작업공간·내 기록 삭제, 사진 파일 경로 목록 돌려줌 |
| 파일 | Edge(서버 키) | DB가 돌려준 경로 중 받는 버킷·모양만 버킷에서 삭제(`share-page-media`, `team-event-media`) |
| 로그아웃 | Edge `POST /auth/v1/logout?scope=global`(본인 열쇠) → 화면 `KPTUTeamAuth.logout()` | 모든 기기·폰 앱 로그인 끊기 → 로그인 화면 |
| 웹 주소 | `about/delete-account/` (`https://workonplus.com/work/about/delete-account/`) | 로그인 없이 열림. 앱 안 방법(링크 `…/work/app/?view=profile`) + 앱에 못 들어갈 때 방법(처리방침 11절 문의). 메일 주소는 이 페이지에 쓰지 않음 |

## 2. 누가·무엇을 (서버가 정함)

- 로그인한 본인만: `auth.uid()`가 없으면 거절, 위임 열쇠(jwt `client_id`)는 Edge·DB 둘 다 거절.
- 작업공간은 `auth.uid()`의 owner 행 하나에서 서버가 찾는다. 함수는 id 인자가 없다(화면이 보낸 id를 믿지 않음 — 받지도 않음).
- 거절(이유 이름만 돌려줌): 같은 작업공간에 다른 owner(`ACCOUNT_WORKSPACE_SHARED`), 운영자 작업공간(통화·텔레그램 허용, `ACCOUNT_OPERATOR_KEEP`), 내가 관리자인 묶음에 다른 사람(`ACCOUNT_GROUP_ADMIN_MOVE` — 지금 [묶음 나가기]와 같은 규칙), owner 작업공간 없음(`ACCOUNT_WORKSPACE_REQUIRED`).
- 지우는 것: 작업공간 행(딸린 표는 `on delete cascade`) + cascade가 아닌 작업공간 표(직접) + 작업공간 칸이 없는 내 표(user_id: 프로필·구글 캘린더 연결·연결 시도·잠금 PIN·읽은 소식·보낸 의견 등) + 묶음 자리(혼자인 묶음은 묶음째, 남이 있는 묶음은 내 줄만 빼고 '나감' 한 줄).
- 남기는 것: 남의 작업공간·남의 묶음 줄(내가 남의 옛 프로젝트 멤버였던 줄 포함), Auth 로그인 계정, 구글 쪽 원본(드라이브·캘린더·할 일), 백업(보관 기간 뒤 자동 삭제).
- 운영자도 지운 내용을 볼 수 없다: 복구용 사본을 만들지 않는다. 실행 표 `app_account_delete_runs`는 실행 중에만 한 줄(누구·무엇 칸 없음)이 생겼다 바로 지워진다.

## 3. 휴지통 트리거와 '트리거 깊이'

노트·프로젝트·조직·보고·공유 페이지·자료실 폴더의 BEFORE DELETE 트리거는 지우기를 가로채 휴지통으로 보낸다. 단 '다른 삭제에 딸린 삭제(트리거 깊이 2 이상)'는 그대로 지운다.
그래서 모든 삭제를 `app_account_delete_runs`의 BEFORE INSERT 트리거(`private.app_account_delete_run`) 안에서 한다. 그 안의 삭제는 깊이 2에서 돌아 휴지통으로 가지 않고, 폴더 '위로 올리기' 트리거도 건너뛴다. 기존 트리거는 한 줄도 바꾸지 않는다.

## 4. 남는 표를 막는 장치

- 함수 목록 = 확인 SQL 목록(`listed`)이고 시험(`tests/security/account-delete-migration.test.mjs`)이 대조한다.
- precheck·postcheck가 운영 카탈로그에서 계산한다: 작업공간·user_id 칸이 있는데 목록에도 cascade에도 안 걸리는 `app_` 표 수(`tables left behind` = 0), 지우는 표를 가리키는데 cascade가 아닌 연결 수(`links that keep rows` = 0). 0이 아니면 승인형 workflow가 적용 전에 멈춘다. 이름은 SQL Editor에서 precheck를 실행해 본다.
- 앞으로 새 표를 만들 때 작업공간 칸은 `references public.app_workspaces(id) on delete cascade`로 둔다(그러면 이 목록을 고칠 필요가 없다). cascade가 아니면 이 목록에 더한다.
- 삭제 중 하나라도 막히면 트랜잭션 전체가 되돌아가 그 사람 기록은 한 줄도 지워지지 않는다(화면: '삭제하지 못했어요. 기록은 그대로예요').

## 5. 적용 순서 (CC)

1. merge → 승인형 DB workflow `20261124130000_account_delete` dry-run → apply. precheck의 남는 표·연결이 0이 아니면 멈추고 목록 PR.
2. Edge `account-delete` 첫 배포: `first_deploy=true`, `verify_jwt=true`, `expect_unauth_401=true`(OPTIONS 204).
3. 화면은 Pages 배포로 이미 나가 있다. Edge 전에는 창이 '아직 준비 중'만 보인다(아무것도 안 지워짐).
4. 시험 계정으로 한 번: [계정 삭제] → 로그인 화면 → 같은 계정 재로그인 시 '내 작업공간 만들기'.

되돌리기: 화면 이전 판(또는 그대로 둠 — Edge가 없으면 준비 중) → Edge 이전 판 없음(대시보드 삭제 판단) → DB rollback(SQL Editor, 새 함수·표만 삭제). 이미 삭제한 사람의 기록은 되돌릴 수 없다.

## 6. 결정 필요 (선택지)

> **2026-11-25 사용자 결정(21:35 "추천대로", `docs/qa/stalled-audit-20261125.md` 2절) 1번**: 로그인 계정은 지우지 않는다(A). 작업공간 자료만 지우고, 로그인 계정은 읽생기와 같이 쓰므로 남긴다. 지금 구현 그대로이고 B(별도 PR)는 하지 않는다. 구글 연결 해제(revoke)는 이번 결정 범위 밖이라 그대로(안내 페이지 방식).

- **Auth 로그인 계정까지 지울지.** 1차는 'WORK ON+ 데이터 삭제 + 로그아웃'이다. Auth는 다른 서비스와 같이 쓰므로 그 서비스 표에 그 사람 자료가 있으면 지우면 안 된다.
  - A(지금): 지우지 않음. 남는 것은 로그인 메일·가입 시각뿐(구글 계정 연결). 플레이 콘솔에는 '사용자 데이터 삭제'로 답할 수 있다.
  - B: Edge가 DB 삭제 뒤 '그 사람의 다른 서비스 자료 0건'을 서버 함수로 확인한 경우에만 Auth 사용자 삭제(서버 키 admin API). 별도 PR·확인 함수 필요.
- **구글 연결 해제(revoke)까지 할지.** 지금은 저장된 토큰만 지우고, 안내 페이지가 '타사 연결 관리'에서 끊는 법을 알려 준다. Edge가 삭제 전에 토큰을 읽어 Google revoke를 부르게 할 수 있다(서버 키로 토큰을 한 번 더 읽어야 함).
