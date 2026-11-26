# 멈춘 일 전수 점검 (2026-11-25, S70-47 QA-멈춘일전수)

기준: main `2822e24`(#3093). 조사만 했다(코드·DB·Edge 변경 없음). 업무 내용·사람 이름은 쓰지 않고 원장 행 이름·파일 이름·PR 번호만 적는다.

## 요약

확인한 멈춘 일은 모두 **58건**이다. 종류별로 나누면 다음과 같다.

| 종류 | 건수 |
| --- | --- |
| 운영 반영이 실제로 안 된 것(DB·Edge·설정) | 9 |
| 단계가 중간에 멈춘 큰 작업 | 12 |
| 사용자 손·답을 기다리며 멈춘 것 | 21 |
| 원장 '대기'로 오래 남은 옛 행(대부분 정리 대상) | 1묶음(행 20여 개) |
| 이미 끝났는데 원장·기록 문서만 안 고친 것 | 15 |

가장 큰 문제는 기록 문서 두 개가 실제 운영 상태를 따라가지 못한다는 점이다. `docs/migration-history.md`에는 '미적용'으로 적힌 migration이 약 90개 있다. 그러나 실행 기록(승인형 DB workflow 로그의 `DB_VERSION`)으로 대조해 보니 10/20 이후 파일 266개 가운데 247개가 apply 성공으로 이미 운영에 들어가 있다. Edge도 같다. `docs/web2-env6b-edge-source.md` 5절에 '배포 대기'로 적힌 함수 5개(`mcp-read`·`note-import`·`release-notes-sync`·`phone-push`·`account-delete`)는 모두 배포가 끝났다. 그래서 무엇이 정말 멈췄는지 문서만 보고는 알 수 없고, 이번처럼 잊힌 일이 생긴다.

### 확인 방법

- **DB**: `db-migration-apply.yml` 실행 481개 중 10/20 이후 실행 450개의 로그에서 `DB_MODE`·`DB_VERSION`을 읽었다. 그 결과를 `supabase/migrations/` 파일과 대조했다(apply·success만 '적용'으로 셈).
- **Edge**: `edge-function-deploy.yml` 실행 497개의 로그에서 `FUNCTION_NAME`·`ref`를 읽었다. 함수 폴더마다 마지막으로 바뀐 main 커밋, 그리고 그 함수가 불러오는 `_shared` 파일까지 따라가 마지막 성공 배포 ref에 들어 있는지(`git merge-base --is-ancestor`, `git diff`)를 보았다.
- **나머지**: 원장 `docs/roadmap.md` 작업 표 1,251행 중 '완료·종료·취소·폐기·대체됨'이 아닌 218행, merge된 PR 686개 본문의 'CC 할 일·사용자 결정·다음 단계·남은 일' 절, `docs/design/*.md`의 단계 표, `app/release-notes/` 1,076개의 약속 문구, 열린 PR 48개를 보았다.
- 사실은 '사실'로, 추론은 '추정'으로 적었다. 운영 DB를 직접 조회하지는 않았다(웹 세션, AGENTS 1절).

## 1. 멈춘 일 표

### 1-1. 운영 반영이 실제로 안 된 것

| 번호 | 이름(원장 행·파일) | 멈춘 곳(어디까지 됐나) | 왜 멈췄나 | 다음 할 일(누가) | 크기 |
| --- | --- | --- | --- | --- | --- |
| A1 | Edge `collector-feed` (#3052, 할 일 텔레그램 자동 끝냄) | DB `20261125120000_todo_tg_auto_done`은 11/25 05:34 UTC에 적용됐다(사실). 함수의 마지막 성공 배포는 ref `87805d3e`(11/24)이고, 그 뒤 `handler.ts`·`replied.ts`가 바뀌었다(사실) | 세션 결과 뒤 배포를 안 함(추정). 07:40 UTC에 대기 중인 Edge run #644가 이 함수일 수 있다(미확인) | CC: run #644 결과 확인 → 아니면 `fb2f5a84` 이후 main으로 배포. 되돌리기 ref는 `87805d3e` | 작음 |
| A2 | 공용 부품 `_shared/app-folders.mjs`(#3070·be7a8064)·`_shared/ed-schema.mjs`(be7a8064) | #3070 때 `library-files`·`meeting-files`·`meeting-transcribe`·`workspace-drive`만 다시 배포했다. 같은 부품을 불러오는 `basket-files`·`document-actions`·`google-calendar`·`google-tasks`·`news-feed`·`record-backup`, 그리고 `ed-schema.mjs`를 불러오는 `phone-push`는 옛 판이다(사실) | 바뀐 부분이 대부분 새 함수 추가라 동작에는 영향이 없을 가능성이 크다(추정) | CC: 다음 배포 때 7개를 차례로 맞추기. 급하지 않음 | 작음 |
| A3 | `20261029234500_web1_upcoming_events_readonly.sql` (SEC-옛표쓰기정리) | 파일과 짝 파일·시험은 main에 있다. 적용한 실행 기록이 없고, 문서도 '준비중·운영 미적용'이다(사실) | 잊힘(추정). Web1 삭제(11/10) 뒤로 넘어감 | CC: 지금도 필요한지 확인 → 필요하면 시험 적용 → 적용. 필요 없으면 파일 정리 PR | 작음 |
| A4 | `20261115140000_news_for_all_refs.sql` (NEWS-모두에게열기) | dry-run은 성공, apply는 실패(사실) | 11/16 사용자 결정으로 행 자체가 '보류'(사실) | 사용자 결정을 받을 때까지 그대로 둔다. 원장 행에 'apply 실패로 멈춤'을 적기 | 작음 |
| A5 | `20261025030000_tg_personal_days.sql` (TG-개인대화) | 적용 기록이 없다. 문서는 '승인 대기'(사실) | 행이 '보류(단순안 #1166으로 대체)'라 적용할 계획이 없다(사실) | CC: 파일을 남길지 지울지 정해 migration-history에 '적용 안 함'으로 적기 | 작음 |
| A6 | `20261030120000_meeting_recording_pieces_64.sql` | dry-run 성공 뒤 apply run #144가 실패했다(사실). CC 기록에는 사후 확인 기대값이 거꾸로 적혀서 그렇고 운영 상태는 맞다고 남아 있다 | 기록이 '확인 필요'인 채로 멈춤 | CC: 읽기 전용 확인 SQL 한 번으로 '적용됨'을 확정하고 기록 정리 | 작음 |
| A7 | 적용 실행 기록이 없는 migration 5개: `20261021082000_ledger_schema`·`20261021150000_ledger_import`·`20261021075034_todo_radar_candidates`·`20261102030000_todo_feature_guard`·`20261104201500_org_status_rows_end_day` | 승인형 실행 기록이 없다. `todo_feature_guard`·`org_status_rows_end_day`는 migration-history에 줄조차 없다(사실). 다만 뒤에 적용된 migration(`20261120090000_mcp_claude_read`·`20261024140000_call_tg_feed`·`20261109120000_record_one_org_move`)의 사전 확인이 이것들을 요구한다. 그래서 SQL Editor 등으로 적용됐을 가능성이 크다(추정) | 적용 기록을 남기지 않음 | CC: `schema_migrations` 존재 여부만 select로 확인하고 기록 문서에 적기 | 작음 |
| A8 | LIB-이전파일정리 (`library-prev-prune.yml`) | 코드는 merge됐다. 저장소 변수 `LIBRARY_PREV_PRUNE_ENABLED`가 없어서 매일 실행이 건너뛰어진다(사실, 11/25에도 skipped) | 10/28부터 잊힘(추정) | CC: 변수 켜기. Drive 휴지통으로 옮기는 일이라 대상 개수를 한 줄 보고한 뒤 켠다 | 작음 |
| A9 | `push-notifications` (옛 알림 함수) | 저장소에 폴더가 있다. 5절 표에는 없고 10/20 이후 배포도 없다(사실). 예전 조사에서 '제거된 알림'으로 분류됐다 | 정리 단계에서 빠짐(추정) | CC: 운영에 남아 있는지 확인. 삭제는 사용자 대시보드(AGENTS 1절) | 작음 |

### 1-2. 단계가 중간에 멈춘 큰 작업

| 번호 | 이름 | 멈춘 곳 | 왜 멈췄나 | 다음 할 일 | 크기 |
| --- | --- | --- | --- | --- | --- |
| B1 | MCP-Claude읽기 (`docs/design/mcp-claude-read.md` 9절) | 끝난 것: M-3 DB `20261120090000_mcp_claude_read` 적용(11/20 00:17 UTC, run 44644659669), M-4 `mcp-read` 첫 배포(11/20)·재배포(11/21), M-5 설정 화면(`app/profile-settings.js`), M-2 공용 검사(모든 함수가 그 뒤 ref로 다시 배포됨)(모두 사실). 남은 것: M-1 읽기 전용 사전 확인 기록, M-6 Auth OAuth 서버 켜기·클라이언트 등록, M-7 켜기 전 거절 시험, M-8 사용자 커넥터 추가 | M-6은 읽생기와 같이 쓰는 Auth 설정을 바꾸는 정지 지점이라 아무도 나서지 않았다(추정). 원장 행은 'M-1·M-3 남음'으로 낡았다 | CC: M-1 확인 → M-6 직전 한 줄 보고 → M-7 시험 → 사용자에게 M-8 한 단계씩 안내 | 큼 |
| B2 | COLLAB-묶인사람끼리공유 | 1단계(무리)는 끝났다. 2단계 공유 표 migration이 없다(사실) | 순서 대기 또는 잊힘(추정) | CC: 2단계 세션 띄우기. 화면 시안은 사용자가 고름 | 큼 |
| B3 | AI-비용보기 → CTX-맥락기억 | 2·3단계 merge·배포. 통화 스크립트 붙이기와 4~7단계(`app_ai_usage_events` 없음)는 안 함(사실). CTX는 설계만 | 통화 전사 열쇠가 무료인지 유료인지 답 대기(사실) | 사용자 답(아래 결정 2) → CC | 중간 |
| B4 | SEC-Web2CSP (`docs/design/web2-security-headers.md` 4절) | 1단계 보고 전용 CSP에서 멈춤 | 2단계 결정 대기(사실) | 사용자 결정(아래 결정 3) | 중간 |
| B5 | RTW-닫기준비·RTW-노트일원화 ⑤ | 11/10 사용자 결정 '닫음'이 있고, 계획 #2267도 merge됐다. 실행은 0단계(백업 확인)부터 안 함(사실) | 잊힘(추정). 💻·다른 저장소 일이 섞여 있다 | CC: 0단계부터 실행. 되돌리기 어려운 단계 앞에서 한 줄 보고 | 중간 |
| B6 | PRESS-자료실편입·PRESS-Web1삭제 | Web1 `press/`는 #2266으로 이미 지워졌다. 그 전에 할 '옛 성명 가져오기 → 대조'는 기록이 없다(사실) | 순서가 꼬임 | CC: 자료실의 성명·보도자료 개수만 확인. 모자라면 가져오기. 두 행 정리 | 중간 |
| B7 | DOMAIN-주소이전 30일 뒤 정리 (`docs/design/domain-move.md` 1.2) | 이전은 끝났다. 옛 포털 폴더·옛 Redirect 정리는 안 함(사실, `personal/portal/`이 남아 있음) | 잊힘(추정). 블로그 주소 설계와도 겹침 | CC: 블로그 주소 단계와 묶어 정리(Cloudflare는 정지 지점) | 작음 |
| B8 | WEB1-페이지삭제 → WEB1-Edge정리 | D1·C1-b 끝. C1-c Edge 삭제, C1-d Auth Redirect 정리 남음 | 12/10 이후로 날짜를 정해 둠(사실) | 12/10 뒤 사용자 대시보드 | 작음 |
| B9 | TG-방날짜묶기·TG-발언자이름·TG-1시간수집 | DB·서버·화면은 운영에 반영됐다. 앱 스크립트 3단계, 수집기 방 정보, 뺄 방 목록이 남았다 | 사용자 답과 회사 PC 작업 대기. OPS-텔레그램클라우드이전과 겹침 | CC: 수집기를 클라우드로 옮길 때 한 번에 처리 | 중간 |
| B10 | OUTSIDE-바깥성명 ⑥⑦ | ①~⑤ 끝(⑤는 `app/outside-search.js`). 저녁 알림·초안 연결은 없음(추정) | 잊힘(추정) | 필요한지 사용자 확인 | 중간 |
| B11 | 폰 플레이 판 새 앱 (#2930, `docs/design/play-store-workonplus.md`) | 남은 일: 새 앱을 Firebase에 등록, 변수 `WEB2_FCM_PLAY_APP_ID` 넣기, 플레이 콘솔에 새 앱, `play-bundle.yml` 실행(흔적 없음) | 로그인이 필요해서 멈춤(추정) | CC가 하고, 로그인만 사용자 | 중간 |
| B12 | MULTI-노조사용자 ③④·MULTI-처음쓰는사람·MULTI-내드라이브백업·MULTI-스스로탈퇴 | ①② 가입 열기와 계정 삭제(DB 11/24 적용, Edge 11/24 배포, 사실)까지 됐다. AI 상한·시험 사용자 단계는 확인 못 함 | 원장에 '★맨 뒤 순서★'로 둠 | CC: 원장 갱신 뒤 남은 단계 줄 세우기 | 큼 |

### 1-3. 사용자 손·답을 기다리며 멈춘 것

| 번호 | 이름 | 멈춘 곳 | 왜 멈췄나 | 다음 할 일 | 크기 |
| --- | --- | --- | --- | --- | --- |
| C1 | SEC-PUBLIC정책표 | 점검 SQL은 준비됐다(10/28~) | 사용자의 SQL Editor 실행을 기다림 | 지금은 CC가 읽기 전용으로 돌릴 수 있다(select만) → CC | 작음 |
| C2 | LEDGER-반영기준점검 | 확인 SQL 결과를 사용자에게 보이는 단계 | 사용자 확인 대기 | CC가 숫자만 확인하고 보고 | 작음 |
| C3 | CALL-개인통화함 | 10/24 이후 개인 통화 다시 보내기 | 사용자 실행 대기 | 사용자(앱 스크립트 실행 한 번), 또는 클라우드 이전 때 CC | 작음 |
| C4 | OPS-점검스크립트원본 | Apps Script 새 판 붙여 넣기 | 사용자 손 대기 | B9와 묶기 | 작음 |
| C5 | TG-1시간수집 | 앱 스크립트 교체·회사 PC 순서 | 사용자 손 대기 | B9와 묶기 | 작음 |
| C6 | JOURNAL-일기원드라이브 | 실기기 연결·사진 확인 | 사용자 실기기 확인 | 사용자 | 작음 |
| C7 | MTG-노트북녹음 | 노트북 실기기 확인·59분 간격 확인 | 사용자 실기기 | 사용자 | 작음 |
| C8 | STORE-계정삭제 (#2957, `docs/design/account-delete.md` 6절) | DB·Edge·화면 모두 반영(사실). 로그인 계정까지 지울지 결정 남음 | 결정 대기 | 사용자 결정(아래 결정 1) | 중간 |
| C9 | 드라이브 휴지통 '영구 삭제' (#2992) | 결정 질문만 남음 | 결정 대기 | 사용자 결정 | 중간 |
| C10 | 클라우드 파일 [공유 링크] (#2084 FILES-관리자마무리) | 결정 질문만 남음 | 결정 대기 | 사용자 결정 | 중간 |
| C11 | STD-기본동작 4가지 (#2963) | 폰 목록만 #2991로 정리. 기준표 '결정' 칸은 그대로 | 결정 대기 | 사용자 결정 | 중간 |
| C12 | NOTE-보드선택지우기 (#3044) | 왼쪽 막대 [삭제]를 둘지 | 결정 대기 | 사용자 결정 | 작음 |
| C13 | NOTE-노션편집 '/' 목록 (#3025) | 블록 모드와 같이 끌지 | 결정 대기(자리는 #3089가 옮기는 중) | 사용자 결정 | 작음 |
| C14 | BRIEF-자료실에서고르기 (#2728) | 다른 폴더 자료를 옮길지 | 결정 대기 | 사용자 결정 | 작음 |
| C15 | OPS-DB용량정리 (#3007) | `20261124220000_cron_history_trim`은 11/25 01:07 UTC에 적용됐다(사실). 백업 표 정리(`docs/ops/retention-daily.apply.sql`)는 흔적 없음 | 지우는 일이라 허락 대기(원장 '사용자 허락 대기') | 사용자 허락 한 줄 → CC가 개수를 보고하고 적용 | 중간 |
| C16 | 미뤄 둔 작은 결정 4개 (#1481 UI-색고르기통일, #1246 MTG-3칸폭끌기, #1184 HOME-모바일홈간격통일, #1790 UI-화면정리ABC) | 결정 질문만 남음(10월부터) | 결정 대기 | 사용자 결정('추천대로' 한마디) | 작음 |
| C17 | 사회운동 Now 막힌 단체 3곳 (#1678·#1684) | 1곳은 #2071로 해결 | 결정 대기 | 사용자 결정 | 작음 |
| C18 | NEWS-비마이너프레시안 (#1854) | 채널 구독 뒤 채널 이름 알려 주기 | 사용자 손 대기 | 사용자 | 작음 |
| C19 | PHOTO-사진메뉴 ③ 지도·휴지통 보기 | 정리 도우미만 있음(`app/photo-tidy.js`) | 필요한지 미확인 | 사용자 결정 | 중간 |
| C20 | MTG-프로젝트합치기 4단계 | '몇 주 써 본 뒤' 정하기로 함 | 날짜 대기 | 12월에 사용자 결정 | 작음 |
| C21 | WORDS-노조단어남은곳·READ-오늘읽을글·FAMILY-잊지말기-빠진남은일 | 원장에 '사용자 결정 대기' | 결정 대기 | 사용자 결정 | 작음 |

### 1-4. 원장 '대기'로 오래 남은 옛 행 (한 묶음)

10월 초 이전에 만들어지고 비고에 다음 할 일이 없는 '대기'·'진행 예정' 행이다. SEC-정리, ENV-3, ENV-5-나머지, ENV-9, 이름-2, Web1-3, RTW-3, DB-2, 24, 32, 31-1 후속, 후보-1~6, CAL-웹2일정삭제(#394), TASK-팀AI삭제(#357), library-files _shared 전환, BASKET-2b, UI-1c나머지저장안내, 그리고 협업 구조 정리 20·22·23·26·27·28·29·30·31-2(10/27 '진행 예정' 뒤로 착수 기록 없음)가 여기에 든다. 이 중 상당수는 그 뒤 작업(Web1 삭제, DB-협업잔재차단, EDGE-서버함수정리 등)으로 대상이 없어졌을 수 있다(추정).

- 다음 할 일: CC가 행마다 '종료(대상 없음)'인지 '진행'인지 가르는 문서 PR. 협업 구조 정리 묶음은 COLLAB 2단계(B2) 전에 정리한다.
- 크기: 중간

## 2. 사용자 결정이 필요한 것 (일상어 한 줄 + 추천안)

> **2026-11-25 21:35 사용자 결정 "추천대로"**: 1~14번을 모두 아래 추천안으로 확정했다(15번은 결정이 이미 있음). 설계 문서·원장 행에 '2026-11-25 사용자 결정: …'으로 적었고(S70-55), 구현이 필요한 것은 맨 끝 '5. 결정 뒤 구현 줄' 절에 지시서 초안으로 두었다.

1. **계정 삭제 때 로그인 계정까지 지울까요?** 추천: 지금처럼 작업공간 자료만 지우고, 로그인 계정은 남겨 둡니다. 로그인 계정은 읽생기와 같이 쓰기 때문입니다.
2. **통화 글로 옮기기 AI는 돈 드는 열쇠로 볼까요?** 추천: 유료로 보고 비용 화면에 넣습니다. 그래야 AI 비용 4~6단계가 시작됩니다.
3. **화면 보안 규칙(CSP)을 '막기'로 올릴까요?** 추천: 먼저 '보고만' 받는 곳을 만들어 2주 지켜본 뒤 정합니다.
4. **드라이브 휴지통에 '영구 삭제' 단추를 넣을까요?** 추천: 넣지 않습니다. 되돌릴 수 없는 일이기 때문입니다.
5. **클라우드 파일에 [공유 링크]를 넣을까요?** 추천: 넣지 않고, 밖으로 보낼 때는 지금 쓰는 공유 페이지를 씁니다.
6. **기본 동작 4가지(#2963)는 어떻게 할까요?** 추천:
   - 폴더 누르기는 #2991 방식으로 합니다.
   - 탭 사이 밀기는 되살리지 않습니다.
   - Delete는 [되돌리기]가 있을 때만 바로 지웁니다.
   - 보드 카드는 크기 고정을 유지합니다.
7. **보드 왼쪽 막대 [삭제]는 어떻게 할까요?** 추천: 그대로 둡니다.
8. **'/' 목록도 블록 모드처럼 끄고 켤까요?** 추천: '/'는 늘 켜 둡니다.
9. **브리핑에서 고른 자료를 그 폴더로 옮길까요?** 추천: 옮기지 않고 화면에만 둡니다.
10. **DB 적용 때마다 쌓이는 백업 표를 지울까요?** 추천: 적용하고 14일 지난 것만 지웁니다. 지우기 전에 개수를 한 줄로 보고합니다.
11. **10월부터 미뤄 둔 작은 결정 4개는?** 추천:
    - 캘린더 색은 색 줄로 바꿉니다.
    - 칸 폭 저장은 같이 씁니다.
    - 'n일째' 글자는 톤다운합니다.
    - PC 오른쪽 칸은 안 A로 합니다.
12. **글을 못 읽어 오는 단체 3곳은?** 추천: 소식 통로가 있는 곳만 읽고 나머지는 목록에서 뺍니다.
13. **사진 메뉴의 지도·휴지통 보기를 아직 원하세요?** 추천: 안 쓰면 행을 닫습니다.
14. **바깥 성명 저녁 알림·초안 연결을 아직 원하세요?** 추천: 저녁 알림만 하고, 초안 연결은 닫습니다.
15. **Claude 읽기 연결의 마지막 단계(로그인 설정 켜기)를 진행할까요?** 결정은 이미 있습니다. 추천: CC가 켜기 직전에 한 줄 보고한 뒤 진행하고, 사용자는 마지막에 커넥터만 추가합니다.

## 3. 이미 끝났는데 원장·기록만 안 고친 것

| 이름 | 원장·문서 표기 | 실제(근거) |
| --- | --- | --- |
| MCP-Claude읽기 | 'M-2 코드 merge, 배포·M-1·M-3 남음' | M-3 DB 적용(11/20), `mcp-read` 배포(11/20·11/21), 설정 화면 있음. 남은 것은 M-1·M-6~M-8(B1) |
| PHOTO-위쪽두줄앨범보기 | 'apply 대기' | `20261031235000_profile_view_prefs_album_view` 적용(run #174) |
| OUTSIDE-③Edge | '첫 배포 직전 정지' | `outside-feed` 운영 배포(11/04~, 마지막 11/23) |
| APP-폰알림 | 'Firebase 준비 대기' | `20261101010000_phone_push` 적용, `phone-push` 배포(마지막 11/23), 예약 실행 성공 |
| WEEKLY-자료날짜 | '운영 적용 확인 필요' | `20261101011500_doc_date_year_fix` 적용(run #178) |
| DB-협업잔재차단 | '진행중(S47-50)' | `20261102013000_collab_lockdown` 적용(run #192) |
| ED-③ | '백업 표 삭제 SQL 사용자 실행 대기' | `20261025191000_ed3_backup_drop` 적용 완료(사용자 보고, migration-history) |
| STORE-계정삭제 | 원장 행 없음, 5절 '배포 대기' | `20261124130000_account_delete` 적용(11/24), `account-delete` 배포(11/24) |
| `note-import`·`release-notes-sync`·`phone-push`·`mcp-read`·`account-delete` | 5절 '배포 대기' | 모두 배포됨(실행 로그 `FUNCTION_NAME`) |
| CI-버전자동화-정리 | '대기' | 검사 job·주석 정리가 이미 반영됨(`docs/design/ci-version-automation.md`와 현재 workflow 대조) |
| `docs/design/domain-move.md` 1.2·4.5절 | 전부 ⏸ | DOMAIN-주소이전·Web1 D1·C1-b 완료 |
| `docs/migration-history.md` | '미적용' 약 90줄(11/06~11/25 PR이 쓴 표기 그대로) | 10/20 이후 파일 266개 중 247개가 apply 성공. 실제로 실행 기록이 없는 것은 1-1의 A3~A7뿐 |
| 원장에 없는 11/24~25 작업 | STD-기본동작·STORE-계정삭제·FORGET-이미한일빼기·NOTE-보드선택지우기·BLOG·READ 등 S69 후반~S70 행 | merge·배포는 됐는데 원장 행이 없음 |
| OPS-DB용량정리 일부 | '사용자 허락 대기' | `cron_history_trim`은 11/25 적용됨. 남은 것은 백업 표 정리(C15)뿐 |
| MTG-비정기회의접기 후속 (#2125) | 상위 목록 처음 값 넣기 | #2271 조직 묶기로 대체된 것으로 보임(추정) |

- 다음 할 일: CC가 문서 전용 PR 하나로 정리한다. 원장 행 상태, migration-history의 '미적용' 일괄 대조(11/06에 한 것과 같은 방식), 5절 '배포 대기' 문구를 고친다.
- 이번 점검의 대조 스크립트(실행 로그에서 `DB_VERSION`·`FUNCTION_NAME` 읽기)를 CC 점검 예약에 넣으면, 같은 종류의 멈춤을 매일 자동으로 찾을 수 있다(제안).

## 4. 해당 없음으로 확인한 곳

- **열린 PR**: 48개 모두 11/25에 만들어졌다. 7일 넘게 멈춘 PR과 초안 PR은 없다. 충돌 여부는 GitHub가 다시 계산하는 중(`unknown`)이라 판정하지 못했고, `blocked`는 #3076 하나다(시험 대기).
- **업데이트 기록의 약속 문구**: '나중에·곧·다음에·준비 중·예정'이 든 기록 19개를 보았다. 모두 동작 설명('다음에 열어도 그대로' 등)이고, 지키지 않은 약속은 없었다.

## 5. 결정 뒤 구현 줄 (2026-11-25 사용자 결정 뒤, S70-55)

2절 결정 1~14 가운데 코드·운영 일이 남은 것만 지시서 초안으로 적는다. CC가 이 표로 세션을 띄운다. 공통: 최신 main에서 시작, `AGENTS.md`·`app/ARCHITECTURE.md`를 따른다. 화면이 바뀌면 업데이트 기록 1개. 겹치는 열린 PR은 11/25 저녁 기준이고, '뒤'라고 적은 PR이 아직 열려 있으면 줄 세우기(그 PR head에서 시작)로 한다.

### 5-1. 결정별 처리 요약

| 결정 | 처리 | 근거 |
| --- | --- | --- |
| 1 계정 삭제는 작업공간 자료만 | 구현 없음(지금 그대로). 원장 STORE-계정삭제 종료 | `docs/design/account-delete.md` 6절 |
| 2 통화 전사 AI 유료 → 비용 4~6단계 | I-1~I-4 | `docs/design/ai-cost-view.md` 5절 |
| 3 CSP 2주 '보고만' | I-5 | `docs/design/web2-security-headers.md` 4절 |
| 4 휴지통 영구 삭제 안 넣음 | 구현 없음. 원장 S69-62 종료 | `docs/design/files-explorer.md` 끝 |
| 5 [공유 링크] 안 넣음 | 구현 없음. 원장 FILES-관리자마무리 종료 | 같은 곳 |
| 6 기본 동작 4가지 | 폴더 누르기(#2991 방식, 11/24 main 반영)·P1(안 되살림)·Z1(고정 유지)은 구현 없음. **K1 Delete만** I-6·I-7 | `docs/design/standard-interactions.md` |
| 7 보드 막대 [삭제] 그대로 | 구현 없음. 원장 NOTE-보드선택지우기 종료 | `docs/design/note-board-mindmap.md` 끝 |
| 8 '/' 목록 늘 켬 | 구현 없음. 원장 S69-96 종료 | `docs/design/note-notion-edit.md` 끝 |
| 9 브리핑 자료 안 옮김 | 구현 없음. 원장 BRIEF-자료실에서고르기 종료 | `docs/design/brief-room.md` 끝 |
| 10 백업 표 14일 지난 것만 삭제 | I-8 | `docs/design/db-retention.md` 3절 |
| 11 작은 결정 4개 | 캘린더 색 줄: 이미 반영(사실, `app/calendar-persistence.js`가 `app/color-swatch.mjs` 사용, `type="color"` 없음). 칸 폭 저장 같이 씀: 지금 그대로. 'n일째' 톤다운: 지금 `app/`에 'n일째' 표시가 없음(사실, 글자 검색) → I-9에서 확인만. **PC 오른쪽 칸 안 A**: I-9 | `docs/design/ui-abc-c-status.md` 끝 |
| 12 못 읽는 단체 | I-10 | `docs/design/outside-statements.md` 끝 |
| 13 사진 지도·휴지통 닫음 | 구현 없음. 원장 PHOTO-사진메뉴 종료 | `docs/design/photo-menu.md` 끝 |
| 14 바깥 성명 저녁 알림만 | I-11(초안 연결 ⑦은 닫음) | `docs/design/outside-statements.md` 7절 |

### 5-2. 지시서 초안 표

| 이름 | 할 일 | 바꿀 파일(조사로 찾음) | 완료 기준 시험 | 겹치는 열린 PR | DB/Edge 정지 지점 | 크기 |
| --- | --- | --- | --- | --- | --- | --- |
| I-1 AI-비용보기 2단계 붙이기 (📱 폰 경로 B·CC 브라우저) | 통화 전사·분석 앱 스크립트에 이미 있는 보고 함수를 붙여 넣는다(ref `call-`·`calla-`). PR 없음 | `docs/ops/ai-usage-report.gs`(붙일 원본, 고치지 않음). 앱 스크립트 편집기(브라우저) | `tests/security/ai-usage-report-gas.test.mjs`(이미 있음, 원본 그대로인지). 붙인 뒤 다음 통화 처리에서 `app_ai_external_usage`에 `call-`·`calla-` 줄이 생기는지 **개수만** CC 확인 | 없음 | 없음(DB·Edge 그대로). 브라우저가 없으면 사용자에게 붙여 넣기 한 단계씩 안내 | 작음 |
| I-2 AI-비용보기 4단계 DB | 기능별 표 `app_ai_usage_events`(넣기만)·`app_ai_cost_entries.kind`에 `cap`·`reload` 더하기 | `supabase/migrations/<새 판>_ai_usage_events.sql` + 짝 파일 5개(`docs/<판>_ai_usage_events.{precheck,snapshot,postcheck,rollback}.sql`·`.summary.md`), `docs/migration-history.md` | 실제 PostgreSQL 권한 시험(소유자 읽기만·service_role 넣기만·anon·PUBLIC 없음·RLS 켬, `tests/auth-handoff/` 방식) + `tests/security/<판>-migration.test.mjs`(확장 규칙). 고치기 전 실패·고친 뒤 통과 | 없음 | ★DB 적용 정지★: 승인형 workflow dry-run → apply(CC) | 중간 |
| I-3 AI-비용보기 5단계 기능 이름 기록 | 함수마다 기능 키를 넘겨 기능별 표에 1행씩 넣기(한도 판정은 지금 표 그대로) | `supabase/functions/_shared/ai-features.mjs`(새, 기능 키 한 곳), `_shared/ai-daily-usage.mjs`, `recordAiDailyUsage`를 부르는 `library-files`·`meeting-ai-ingest`·`document-ai-index`, `ai-assist` 등(설계 5절 '9개 함수' — 세션이 grep으로 확정) | `tests/security/drive-summary-ai-usage.test.mjs` 방식의 단위 시험 + 함수별 '기능 키 빠짐 없음' 전수 시험 | 없음 | ★Edge 배포 여러 개★: 한 번에 하나, 함수마다 되돌리기 ref 기록. I-2 적용 뒤 | 큼 |
| I-4 AI-비용보기 6단계 화면 | 프로필 'AI 비용' 칸: 공급자별 이번 달·월말 예상·기능별 표·한도/자동 충전 금액 한 줄 입력(서버 저장) | `app/ai-usage-line.js`, `app/ai-usage-model.mjs`(같은 상태 주인·렌더러 하나), `app/release-notes/…json` | `tests/ai-usage-model.test.mjs` 확장 + E2E(폰 412·폴드 880·PC 1440, 가로 넘침 없음). 시안 A/B는 세션이 다시 보여 주고 사용자가 고름 | 없음 | 없음(화면만). I-3 뒤 | 중간 |
| I-5 SEC-Web2CSP 보고 받는 곳 | Report-Only CSP에 `report-to`를 붙이고, 받은 위반의 **지시어·막힌 주소 출처·날짜·개수만** 모은다(쿼리·토큰·개인정보 저장 금지). 2주 뒤 CC가 숫자로 보고 → 막는 단계는 사용자가 따로 정함 | `cloudflare/web2-csp.mjs`, `cloudflare/bokdoong-router.mjs`(받는 경로, 설계 예 `/work/app/__csp`), `docs/design/web2-security-headers.md` 4절. 모으는 곳은 설계 4절 1번 두 안(Supabase 표 / 세지 않고 E2E만) 중 세션이 비교해 제안 — 표로 하면 migration·짝 파일 5개, 넣기는 서버만 | `tests/web2-csp.test.mjs` 확장(헤더에 `report-to` 있음, 받는 경로가 크기·횟수 제한·POST만), `tests/app-e2e/web2-csp-report-only.spec.mjs`(16개 메뉴 위반 0개 유지) | 없음 | ★Cloudflare Worker 배포 정지★(되돌리기 = 이전 커밋 Worker 재배포). 표로 하면 ★DB 정지★, Edge를 새로 두면 ★첫 배포 정지★ | 중간 |
| I-6 STD-기본동작 K1 Delete 맞추기 ① (#3047 뒤) | 공용 키 부품에서 "되돌리기가 있으면 확인 없이 바로, 없으면 확인" 한 규칙으로. 노트 보드의 '아래 가지가 있는 상자' 확인 창은 [되돌리기]가 생겼으므로(#3044) 없앤다 — 예전 결정·시험을 바꾸는 것이라 PR 본문에 밝힌다. 노트 목록 커서 줄 Delete(지금 확인 창)는 되돌리기 유무를 보고 맞춘다 | `app/select-keys.js`, `app/note-board.js`(`removeNode`), `app/basket-notes.js`, `app/files.js`(`trashRows`), `app/library-upload.js`(`luSelDelete`), `docs/design/standard-interactions.md` K1 칸 | `tests/app-e2e/standard-interactions.spec.mjs` K1 줄(자료실·파일·노트 목록·노트 보드: 되돌리기 있으면 확인 창 없음·[되돌리기]로 돌아옴, 없으면 확인 창), `tests/select-keys.test.mjs` | #3047(같은 부품, 앞), #3073(`note-board.js`), #3030(`files.js`·`library-upload.js`·`basket-notes.js`), #3075·#3037(`library-upload.js`) | 없음(화면만) | 중간 |
| I-7 STD-기본동작 K1 Delete 나머지 화면 (I-6 뒤) | 기준표 K1이 × 인 화면(할 일·사진·회의·조직·사업 영역)에 같은 Delete를 건다. 고르기 자체가 없는 화면은 STD-고르기키 제안(#2963 후속)과 묶어 먼저 고르기부터 — 세션이 화면별로 나눠 PR을 줄 세운다 | `app/select-keys.js`(부품은 그대로 씀), 할 일 `app/task-*.js`, 사진 `app/photo*.js`, 조직·사업 영역 `app/project-system-v3.js` 등(세션이 화면별 진입 파일 확정) | 같은 E2E K1 줄을 화면 표(`HEAD_SCREENS` 등)에 더해 화면마다 통과 | #3063·#3068(`project-system-v3.js`) | 없음(화면만) | 큼 |
| I-8 OPS-DB용량정리 백업 표 14일 | ① 읽기 전용으로 `ops_backup` 표 이름 목록만 뽑는다(내용 안 봄). ② 이름의 `run_id`로 실행 날짜를 `gh api …/actions/runs/<id>`에서 얻고, 14일 지났고 그 version이 `schema_migrations`에 기록된 것만 고른다(나이 기록 표를 새로 만들지 않음). ③ **지우기 전 개수 한 줄 보고**(CC) ④ 지움 ⑤ 남은 개수·DB 크기 숫자 보고 | 길 고르기(세션이 PR 본문에 비교 후 CC 결정): (가) 승인형 workflow 차단 목록에 좁은 예외 — `ops_backup` 안·글자 그대로 쓴 표 이름의 `drop table if exists`만, 동적 EXECUTE·다른 스키마 그대로 거절 → `scripts/ops/db-workflow.mjs`·`scripts/ops/db-migration-expanded.mjs`·`docs/ops-db-workflow.md` / (나) 지금 규칙대로 SQL Editor(CC 브라우저, 폰 경로 C)에서 이름을 적은 정적 SQL. 사용자는 "승인형 workflow로"라고 했으므로 (가)가 기본, 보안 검토에서 막히면 (나) | (가)면 `tests/security/db-migration-apply.test.mjs`·`db-migration-phase2.test.mjs`에 '예외는 ops_backup 글자 이름 drop만, 다른 drop·동적 EXECUTE·public 표 drop은 여전히 거절' 시험(고치기 전 실패·고친 뒤 통과) | 없음 | ★production 데이터 삭제(되돌릴 수 없음)★: 개수 한 줄 보고 뒤 진행. (가)는 workflow 규칙 변경이라 CC 보안 검토 | 중간 |
| I-9 UI-화면정리ABC C1 안 A + 'n일째' 확인 | PC(1024px 이상)에서 할 일·사업영역 관리를 처음 열 때 맨 위 항목(할 일 = 맨 위 미완료, 사업영역 = 맨 위)을 오른쪽 칸에 바로 연다(통화·담당조직과 같은 규칙). 'n일째' 빨간 굵은 표시가 남은 곳이 있으면 흐린 12px로(없으면 '해당 없음' 보고) | 할 일 PC 칸 `app/task-layout.js`·`app/task-workflow.js`, 사업영역 관리 `app/project-system-v3.js`, 시안 `docs/design/mockups/ui-c1-pc-right-pane.html` | 새 E2E(PC 1440: 처음 열면 오른쪽 칸 제목이 맨 위 항목, 폰 412는 그대로 목록). '처음엔 빈 칸'을 전제로 한 기존 시험(약 60개 파일, #1790)을 고치되 지우거나 건너뛰지 않음 | #3063·#3068(`project-system-v3.js`) — 그 뒤 | 없음(화면만) | 큼 |
| I-10 OUTSIDE-다른읽기길 소식 통로 있는 곳만 | ① CC가 단체별 수집 상태(`last_error` 종류·마지막 성공 날짜만, 글 내용 안 봄)를 숫자로 확인 → 계속 막힌 단체 목록을 세션에 넘김 ② 세션: 그 단체가 RSS·공개 채널이 있으면 `mode` 바꿔 그 통로로, 없으면 카탈로그에서 뺌. robots 예외 목록(`ROBOTS_EXEMPT_KEYS`)은 늘리지 않음. 이미 모인 글은 지우지 않음 | `supabase/functions/_shared/outside-catalog.ts`, (필요하면) `supabase/functions/outside-feed/handler.ts` | `tests/security/outside-feed.test.mjs`(카탈로그 키·호스트·예외 고정 시험 갱신), 바꾼 단체 읽기 단위 시험 | 없음 | ★Edge `outside-feed` 배포★(되돌리기 ref 기록) | 작음 |
| I-11 OUTSIDE-바깥성명 ⑥ 저녁 폰 알림 | 저녁 예약(18:22 KST)에서 지금은 줄 수만 세는 'Now' 한 줄('새 성명 n · 새 기사 n')을 실제로 보낸다. 종류별 끄기(`notify_prefs.kinds`)·조용한 시간·하루 한 번 기록을 지키고, 알림에는 숫자만(제목·내용 없음). 홈·위젯 줄은 만들지 않음 | `supabase/functions/phone-push/handler.ts`(evening 갈래), `now-line.ts`, `done-items.ts`(종류 목록), 내 프로필 종류 칩 `app/phone-push-settings.js`(새 종류를 칩으로 둘 때만) | `tests/security/phone-push.test.mjs`·`phone-push-cron.test.mjs`에 '저녁: 줄 있으면 1통·0건이면 안 보냄·끈 사람·조용한 시간 제외·알림 글에 숫자만' (고치기 전 실패·고친 뒤 통과) | 없음 | ★Edge `phone-push` 배포★(되돌리기 ref 기록). 종류 키를 새로 두면 DB 검사 제약 확인 — 바꿔야 하면 ★DB 정지★ | 중간 |

### 5-3. 줄 세우기 제안

- 바로 띄울 수 있음(서로 다른 파일): I-1, I-2, I-5, I-8, I-10, I-11.
- 앞 일 뒤: I-3(I-2 적용 뒤) → I-4(I-3 뒤). I-6(#3047 merge 뒤) → I-7. I-9(#3063·#3068 뒤).
- 정지 지점이 있는 것(I-2·I-3·I-5·I-8·I-10·I-11)은 세션이 정지 지점 앞에서 멈추고 CC가 적용·배포한다(AGENTS.md 6절).
