<!-- merge 안 함: GitHub 연결 실패로 PR을 못 만든 S61-41의 PR 본문 전달용 브랜치. CC가 PR을 연 뒤 이 브랜치는 지운다. -->
# S61-41 마감 보고 — MULTI-처음쓰는사람 구현 (CC V61 지시서)

## [마감 보고] 요약
- 세션: Claude Code 웹(예약 작업). **GitHub 연결 도구가 이번 세션 내내 연결 실패(503)라 PR을 만들지 못했습니다.** 브랜치 4개는 모두 push했고, 아래에 PR 제목·본문 전문을 둡니다. CC가 이 본문 그대로 PR을 열어 주세요(각 PR 본문 끝 '원장 반영' 절 포함).
- 시작 SHA: main `537e1391b`

| 순서 | 브랜치 | PR 제목(제안) | 베이스 | 상태 |
| --- | --- | --- | --- | --- |
| ① | `s61-41-home-connect` (`afcb8fdfd`) | 홈: 구글 연결이 없으면 그날 일정·할 일 칸에 연결 안내 한 줄 + 연결 버튼 (MULTI-처음쓰는사람 ①) | main | 완료, merge 가능(CI 확인 필요) |
| ③ DB | `s61-41-operator-feeds` | DB: 운영자 기능 키 arsenal·outside(운영자 작업공간만) (MULTI-처음쓰는사람 ③) | main | 완료. merge 뒤 승인형 DB workflow dry-run → apply(앞 단계 ai_user_cap 적용 필요) |
| ④-가 | `s61-41-menu` (`97b36fb81`) | 메뉴: 원장 항목 빼기 + 운영자 메뉴는 서버 기능 답으로 목록에서 빼기 (MULTI-처음쓰는사람 ④-가) | main | 완료. **③ DB 적용 뒤 merge** |
| ⑤-가 | `s61-41-profile` (`ceed73feb`) | 프로필: 수집 칸·수집 알림 칩은 수집 계정에만, 다른 계정은 이번 달 AI 사용 한 줄 (MULTI-처음쓰는사람 ⑤-가) | `s61-41-menu` 위(줄 세우기) | 완료. ④-가 뒤 merge |

## 하지 못한 것(다음 세션 몫)
- ④-나 새 사람 하단바 기본값(홈·노트·일정·조직 보고·사업 보고)·잊지 말기 메뉴 판 위로: 명진 계정 `menu_layout` 저장값 확인이 먼저(이 웹 세션은 운영 DB를 못 읽음). 확인·저장 SQL은 ④-가 본문에 있음. 시험 22개 파일 기대값 변경 필요.
- ⑤-나 '보고 설정' → '보고 캘린더' 고르기, 기본 정보 아래 '없음' 칸.
- ⑥ 주간 정리 기본 3칸(요청·일정·사업)·빈 화면 글: 주간 정리 파일을 만지는 열린 PR 4개(#2544·#2548·#2550·#2551)가 있어 그 뒤로 줄 세워야 함.
- ① 연결 안내 외의 빈 화면 글(노트·자료실·공유 페이지·HWP, 설계 ⑦).
- 라우터: 빠진 운영자 메뉴를 주소로 직접 열 때 '없는 화면' 처리(데이터는 서버가 이미 거절).

## 환경 메모(시험)
- 로컬 E2E는 Playwright 1.63(저장소 기준 1.55)이라 주간 정리 한글 파일 받기 시험 3개가 받기 파일 이름 차이로 실패 — clean main에서도 같게 실패(변경과 무관). `home-quick` 82번 시험도 clean main에서 실패.
- `tests/security/*.test.mjs` 6개는 deno가 없어 실패(환경).

---

## PR 본문 — pr1

📱 폰 가능 — S61-41 (CC V61 지시서) · MULTI-처음쓰는사람 ①

## 무엇을 바꿨나
홈 업무일지의 **그날 일정·할 일** 칸이 구글 연결이 없는 새 계정에서 빨간 "불러오지 못했어요… [다시]" 대신 아래처럼 보입니다(설계 `docs/design/new-user-start.md` 2-2, 명진 결정 말투 "~하면 ~가 여기 보여요").

| 상태 | 화면 |
| --- | --- |
| 구글 캘린더 연결 없음 | 구글 캘린더를 연결하면 그날 일정이 여기 보여요. [구글 캘린더 연결] |
| 구글 할 일 연결 없음 | 구글 할 일을 연결하면 할 일이 여기 보여요. [구글 할 일 연결] |
| 할 일 권한만 빠짐 | 구글 할 일 권한을 다시 연결하면 할 일이 여기 보여요. [다시 연결] |
| 진짜 고장(서버 오류) | 지금 그대로: 빨간 한 줄 + [다시] |

- 판정은 서버 답으로: 읽기가 **실패한 뒤에만** 같은 Edge의 `?action=status`(읽기 전용, 소유자 JWT)를 한 번 묻습니다. `google-calendar` status는 연결 행이 없으면 `{connected:false}`, `google-tasks` status는 `{connected:false}` 또는 `{needs_reconnect:true}`를 이미 돌려줍니다 → **Edge 변경 없음**(정지 지점 없음).
- 연결된 계정(명진)은 읽기가 성공하므로 status를 묻지도 않고 화면도 그대로입니다.
- 버튼은 일정 화면·할 일 화면과 같은 흐름: 같은 Edge `action=start`가 준 주소로 이동(할 일은 할 일 화면처럼 `platform` 함께). 캘린더와 할 일은 구글 권한 범위가 달라 버튼 하나로 합치지 않았습니다(캘린더 연결 scope에 Tasks 권한 없음).
- 캘린더 연결 버튼은 일정 화면(`team.js` `connectGoogle`)처럼 `platform`을 붙이지 않습니다(같은 흐름 유지).

## 쓴 기존 부품
| 부품 | 클래스 | 쓴 곳 |
| --- | --- | --- |
| 작은 버튼 | `button.secondary` | 연결 버튼 |
| 흐린 안내 줄 | `.journal-muted` | 안내 한 줄 |

## 변경 파일
- `app/google-link.js`(새): status 답 → 'none'/'reconnect'/''(고장), 연결 시작, 화면 글
- `app/journal.js`: 읽기 실패 뒤 status 한 번, 안내 줄·버튼 그리기, 버튼 처리
- `app/journal-data.js`: 실패한 읽기의 link 값을 칸(part)에 넘김
- `tests/google-link.test.mjs`(새, `app-smoke-check.yml` 등록), `tests/app-e2e/journal.spec.mjs`(시험 3개 + 고정 경로 status·start)
- `app/release-notes/20261113-2310-home-google-link.json`
- 사진 `docs/design/screens/s61-41/home-link-{new,mj}-{412,760,1280}.png` (new = 새 계정, mj = 연결된 계정·지금 그대로)

## 시험
- `node --test tests/google-link.test.mjs tests/journal-data.test.mjs` 33 통과
- E2E(Playwright 1.63 로컬): 새 계정(연결 없음) · 할 일 권한만 빠짐 · 캘린더만 없음(PC 1280) 3개 통과, 기존 "재료 일부를 못 읽어도…(고장 글·[다시])" 그대로 통과
- `node --test tests/security/*.test.mjs`: 2125 통과, 6 실패는 이 환경에 deno가 없어서(`google-calendar-location-deno`, 변경과 무관)
- `scripts/check-test-registration.mjs`·`check-personal-data.mjs`·`check-loader-cache.mjs` 통과

## DB·production 영향
없음(Edge·DB 변경 없음). 인증·RLS·권한 변경 없음. 서버 저장만(기기 저장 없음).

## 남은 위험
- 할 일 읽기가 200 + `needs_reconnect`일 때도 status를 한 번 더 묻습니다(그 계정만, 읽기 1번).

## 원장 반영
- 행: MULTI-처음쓰는사람 — 상태: 진행 중(① 홈 연결 안내 PR) — 한 줄: 홈 그날 일정·할 일이 구글 연결 없음이면 고장 글 대신 연결 안내 한 줄 + 버튼. 사용자 결정: 말투 "~하면 ~가 여기 보여요"(11/13 16:25).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01QdB5NMJeT3vCEcANBAiCLk

---

## PR 본문 — pr2

📱 폰 경로 C — S61-41 (CC V61 지시서) · MULTI-처음쓰는사람 ③ DB(설계 4절 ③)

## 일상어 3줄
- 무엇이 바뀌나: 운영자 기능 목록에 '아스날(arsenal)'·'News(outside)' 키가 생기고, 운영자(명진) 작업공간에만 허용 2줄이 더해집니다. 새 표·함수·권한·정책은 없고 뉴스·아스날 자료도 그대로입니다.
- 잘못되면: 사전·시험 적용·사후 확인 중 하나라도 어긋나면 멈추고 아무것도 바뀌지 않습니다. 앞 단계(AI 사람별 한도 DB `20261113160000_ai_user_cap`)가 아직 적용되지 않았으면 멈춥니다. 적용만으로는 화면이 바뀌지 않습니다.
- 되돌리는 법: 메뉴 화면 PR이 운영에 있으면 그것을 먼저 되돌린 뒤, 짝 rollback을 SQL Editor 새 창에서 실행해 허용 2줄·검사 원래 모양(키 일곱)·기록 1행만 되돌립니다.

## 순서(정지 지점 — 적용은 CC)
1. `20261113160000_ai_user_cap` 적용 확인(이 migration의 사전 확인이 요구).
2. 이 PR merge → 승인형 DB workflow dry-run → apply → 사후 확인(`docs/20261113230000_arsenal_outside_features.postcheck.sql` 모두 '예').
3. 그 뒤 메뉴 화면 PR(④) merge. **거꾸로 하면 명진 메뉴에서도 아스날·News가 빠집니다**(메뉴 PR은 서버 답에 키가 없으면 뺌).

## 무엇을 했나
- `supabase/migrations/20261113230000_arsenal_outside_features.sql`: dev_inbox·family·ai_no_cap과 같은 방식. 검사(`app_operator_features_feature_check`)를 같은 이름으로 다시 만들어 키 2개 추가, `calls` 허용 작업공간이 정확히 하나일 때만 그 작업공간에 키마다 1행. 고정 id·이름·메일 없음. `commit;` 직전 `schema_migrations` 1행.
- 짝 파일 5개: `docs/20261113230000_arsenal_outside_features.{precheck,snapshot,postcheck,rollback}.sql`, `.summary.md`
- `tests/auth-handoff/arsenal-outside-features-db.test.mjs`(새, `tests/auth-handoff/package.json` 등록): 실제 PostgreSQL에서 앞 단계 없으면 멈춤 / 사전 확인(읽기 전용 역할) / dry-run은 아무것도 안 바꿈 / apply 뒤 사후 확인 / 두 번째 apply 거절 / 운영자 owner만 `app_my_features`에 두 키, 다른 owner는 빈 목록 / API 역할(authenticated·service_role·anon)은 허용 표를 못 읽고 못 씀 / 되돌리기 뒤 원래대로·다시 적용 / calls가 둘이면 멈춤.
- `docs/migration-history.md`에 미적용 행 추가.

## 권한·보안
권한·정책·RLS·함수 변경 없음. 허용 표는 RLS 켬·정책 없음·API 역할 권한 없음 그대로(사후 확인이 막음). 서버 데이터 경로(뉴스·아스날 표·Edge)는 이번에 바꾸지 않습니다 — 그 자료는 원래 작업공간 owner만 읽는 자기 자료이고, 새 계정의 아스날·News 화면 '주소로 직접 열기'를 서버에서도 거절할지는 별도 결정(아래).

## 시험
- `tests/auth-handoff`: `arsenal-outside-features-db`·`dev-inbox-feature-db`·`ai-user-cap-db`·`operator-features` 31개 통과(로컬 embedded-postgres)
- `scripts/check-test-registration.mjs` 통과

## 범위 밖 발견사항
- 아스날·News의 데이터·Edge(번역 등 AI 호출 포함)는 지금 기능 키 판정이 없습니다. 메뉴에서 빠져도 주소로 열면 그 사람 자기 작업공간 자료로 동작합니다(남의 자료는 못 봄). AI 비용은 사람별 한도(ai_user_cap)가 막습니다. 서버에서도 막을지는 명진 결정 필요.

## 원장 반영
- 행: MULTI-처음쓰는사람 — 상태: 진행 중(③ DB PR, 적용 대기) — 한 줄: 운영자 기능 키 arsenal·outside를 운영자 작업공간에만. 사용자 결정: 아스날·News는 "내 계정에만"(11/13 15:26).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01QdB5NMJeT3vCEcANBAiCLk

---

## PR 본문 — pr3

📱 폰 가능 — S61-41 (CC V61 지시서) · MULTI-처음쓰는사람 ④-가: 메뉴 정리(원장 빼기 + 운영자 메뉴 서버 판정)

**merge 순서: ③ DB PR(arsenal·outside 기능 키) 적용 → 이 PR.** 거꾸로면 명진 메뉴에서 아스날·News가 잠깐 빠집니다(서버 답에 키가 없어서).

## 무엇을 바꿨나(설계 `docs/design/new-user-start.md` 2-1)
1. **원장: 모든 계정(명진 포함) 메뉴 목록에서 뺐습니다**(명진 11/13 16:25). 메뉴 항목만 뺐고 원장 화면(라우터 `ledger`)·자동 기록·데이터·다른 화면에서 여는 길(홈 업무일지의 원장 줄, 전체 검색, 잊지 말기의 '원장으로')은 그대로입니다. 저장된 메뉴 순서의 `ledger`는 메뉴 모델이 모르는 이름이라 버립니다(지금 규칙).
2. **운영자 메뉴는 서버 답으로 목록에서 뺍니다(숨김 아님).** `menu-model.mjs` 항목에 기능 키(`calls`·`telegram`·`files`·`arsenal`·`outside`)를 달고, `withFeatures(layout, features)`가 서버 `app_my_features()` 답에 없는 메뉴를 하단바·[메뉴] 창·PC 왼쪽 메뉴·메뉴 편집에서 뺍니다. 저장값(`view_prefs.menu_layout`)은 손대지 않습니다.
   - 답을 받기 전(또는 못 받으면)은 아무것도 빼지 않습니다 → 운영자 화면이 '빠졌다 생기는' 일 없음. 운영자 계정은 뺄 것이 없으면 다시 그리지도 않습니다.
   - `my-features.js`에 `myFeaturesOrNull`(못 읽거나 목록이 아니면 null) 추가. 기존 `myFeatures`는 그대로(빈 목록).
   - 사진의 구글 드라이브(`gdrive_photos`)는 지금처럼 칩 단위 판정(메뉴는 그대로).
3. 데이터는 지금처럼 서버가 같은 허용 표로 거절합니다(통화·텔레그램·파일). 아스날·News는 ③ PR 본문의 '범위 밖' 참고.

## 이번 PR에서 하지 않은 것(다음 PR ④-나로 분리)
- **새 사람 하단바 기본값 = 홈·노트·일정·조직 보고·사업 보고**(15:24), 잊지 말기를 메뉴 판 위쪽으로. `DEFAULT_BAR`를 바꾸면 index.html 처음 모양·잊지 말기 탭 표시·시험 22개 파일이 함께 바뀌어 따로 나눕니다.
- 그 전에 CC가 명진 계정 저장값을 확인해야 합니다(이 세션은 웹이라 운영 DB를 못 읽음):
  - 읽기(SQL Editor, select만): `select (view_prefs ? 'menu_layout') as has_layout from public.app_profiles where user_id = '<명진 user_id>';`
  - `has_layout`이 false면 ④-나 merge **전에** 명진 지금 순서를 저장: `update public.app_profiles set view_prefs = jsonb_set(coalesce(view_prefs,'{}'::jsonb), '{menu_layout}', '{"bar":["home","basket","calendar","meetings","team"],"rest":["note","library","files","hwp","pages","photos","outside","bottom","calls","telegram","arsenal"]}'::jsonb) where user_id = '<명진 user_id>';` (운영 데이터 변경 = 정지 지점, CC가 상시 허락으로 진행)
- 라우터: 빠진 운영자 메뉴를 주소로 직접 열 때 '없는 화면' 처리 — 데이터는 서버가 이미 거절하므로 이번엔 하지 않음(필요하면 다음 PR).

## 쓴 기존 부품
| 부품 | 클래스 | 쓴 곳 |
| --- | --- | --- |
| 메뉴 숨김 경로 | `layout.hidden` 빼기(`topbar-actions.js` `placeSidebar`) | 운영자 메뉴 빼기(off)도 같은 길 |
| 메뉴 다시 그리기 | `menu-layout.js` `paintPhone` | 폰 하단바·[메뉴] 창 |

## 변경 파일
- `app/menu-model.mjs`: 원장 항목·기본 자리 삭제, 기능 키, `withFeatures`
- `app/menu-layout.js`: 저장 순서(base)와 화면 순서(layout) 분리, 기능 답 받으면 한 번 다시 그림, 옮기기는 base에
- `app/menu-edit.js`: 뺀 메뉴는 편집 칸·미리보기에 없음
- `app/topbar-actions.js`: PC 왼쪽 메뉴에서 뺀 메뉴 제거, `ALL_KEYS`에서 원장
- `app/my-features.js`: `myFeaturesOrNull`
- `app/index.html`: 처음 모양에서 원장 줄 2개(PC·폰 [메뉴] 창)
- 시험: `tests/menu-model.test.mjs`(원장·withFeatures 2개 추가, 원장을 예로 쓰던 숨김 시험은 HWP 편집으로), `tests/menu-home-prefs.test.mjs`, E2E `menu-features.spec.mjs`(새: 새 계정 412·1280 / 운영자 412·1280 / 원장 화면 열림 / 답 실패 시 그대로), 메뉴 목록을 보는 기존 E2E에서 원장 빼기(`menu-drag-nav`·`menu-hide`·`menu-three-columns`·`fold-pc-frame`·`navigation-p8a`·`pc-sidebar`·`pc-polish-bundle`·`ui-polish-1`·`ui-standard-3b`·`ledger-home`)
- 시험 도우미 `helpers/home-entry.mjs`: `app_my_features` 기본 답 = 운영자 메뉴 기능(`OPERATOR_MENU_FEATURES`, 지금 화면 그대로), 새 계정은 `features: []`
- `app/release-notes/20261113-2330-menu-tidy.json`
- 사진 `docs/design/screens/s61-41/menu-{new,operator}-{412,1280}.png`

## 시험
- `node --test tests/menu-model.test.mjs tests/menu-home-prefs.test.mjs` 45 통과(원장·withFeatures 2개 추가)
- E2E(Playwright 1.63 로컬, 2코어): 메뉴·내비·뉴스·통화·파일·프로필 관련 시험 두 번 실행 합계 336개 통과(첫 실행에서 실패한 menu-three-columns 3개는 원장 기대값을 고친 뒤 둘째 실행에서 통과)(`menu-features`·`menu-drag-nav`·`menu-hide`·`menu-three-columns`·`fold-pc-frame`·`navigation-p8a`·`fold-top-one-line`·`menu-follow-*`·`ledger-home`·`arsenal-view`·`call-*`·`news-*`·`now-detail`·`outside-*`·`pc-keyboard`·`pc-sidebar`·`pc-polish-bundle`·`ui-polish-1`·`ui-standard-3b`·`tg-*`·`quick-links`·`collection-status`·`files-explorer`·`basket-ai-summary`·`basket-library-send`·`inbox-promise`·`summary-part-unify`·`ask-web2`). `ledger-home` 폴드 700 한 번은 로그인 단계 페이지 이동 간헐(같은 시험 다음 실행 통과).
- 전체 E2E는 이 환경(2코어)에서 못 돌림 → PR CI로 확인 필요. 시험 도우미 `openHome`의 `app_my_features` 기본 답을 운영자 메뉴 기능으로 바꿨으므로, 그 답을 빈 목록으로 기대하던 시험이 있으면 CI에서 드러남(자기 경로를 따로 가로채는 시험 19개는 영향 없음).
- `scripts/build-pages.mjs` 빌드 통과, `check-loader-cache --base origin/main`·`check-personal-data`·`check-test-registration` 통과

## 원장 반영
- 행: MULTI-처음쓰는사람 — 상태: 진행 중(④-가 메뉴 PR) — 한 줄: 원장 메뉴 항목을 모든 계정에서 빼고, 운영자 메뉴(통화·텔레그램·파일·아스날·News)는 서버 기능 답으로 목록에서 뺌. 사용자 결정: 원장 메뉴 빼기(11/13 16:25), 아스날·News 내 계정만(15:26).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01QdB5NMJeT3vCEcANBAiCLk

---

## PR 본문 — pr4

📱 폰 가능 — S61-41 (CC V61 지시서) · MULTI-처음쓰는사람 ⑤-가: 프로필 정리(수집 칸·수집 알림 칩은 수집 계정만)

**줄 세우기: ④-가 메뉴 PR(`s61-41-menu`) 브랜치 위에서 시작했습니다**(공용 `my-features.js`의 `myFeaturesOrNull`과 시험 도우미 기본값을 같이 씀). ④-가 → 이 PR 순서로 merge.

## 무엇을 바꿨나(설계 `docs/design/new-user-start.md` 2-5)
- 내 프로필 '수집·사용량' 칸: 서버 운영자 기능 답(`app_my_features`)에 `calls`·`telegram`이 둘 다 없는 계정은 수집 상태·AI 전체 사용량·'연락 없는 조직' 기준 줄을 **그리지 않고**, 칸 이름 'AI 사용' + '이번 달 AI 사용 ○원 / 한도 ○원' 한 줄만(AI-사람별한도 줄 그대로 재사용). 그 줄을 못 읽으면 칸째 그리지 않음.
- 폰 알림 고르기: '수집 멈춤·아침 묶음·저녁 묶음' 칩은 수집 계정에만. 저장 모양(`notify_prefs.kinds` 일곱 칸)과 서버 검사는 그대로(숨긴 종류 값은 건드리지 않음).
- 답을 못 받으면(null) 지금처럼 모두 그림 → 운영자(명진) 화면 그대로.
- 판정 함수 하나: `my-features.js` `collectsFeeds`(프로필 칸·알림 칩이 같이 씀).

## 이번 PR에서 하지 않은 것
- '보고 설정' → '보고 캘린더' 이름·내 구글 캘린더 목록에서 고르기(⑤-나): 이번 세션 시간 안에 못 함. 다음 세션 몫(#2546은 프로필을 만지지 않음 — 겹침 없음).
- 기본 정보 아래 뜻 없는 '없음' 칸(사진 `profile-new-412.png`): 무엇을 그리는 칸인지 확인하지 못해 손대지 않음(⑤-나에서 확인).

## 쓴 기존 부품
| 부품 | 클래스 | 쓴 곳 |
| --- | --- | --- |
| 칸 | `.panel.ps-panel` + 공용 `.hidden` | AI 사용 칸 |
| 한도 한 줄 | `ai-cap-line.js` (`.ps-ai-cap`) | AI 사용 칸 |
| 알림 칩 | `.ps-push-kind` | 그대로 |

## 변경 파일
- `app/profile-status.js`, `app/phone-push-settings.js`, `app/phone-push-model.mjs`(`COLLECT_KINDS`), `app/my-features.js`(`collectsFeeds`)
- 시험: `tests/my-features.test.mjs`(새, 등록), `tests/phone-push-settings.test.mjs`(1개 추가), E2E `phone-push-settings.spec.mjs`(새 계정 1280·760·412 / 한도 못 읽음 / 운영자 그대로; 고정 서버에 `app_my_features`·`ai-assist` 경로)
- `app/release-notes/20261113-2350-profile-tidy.json`
- 사진 `docs/design/screens/s61-41/profile-new-{412,760,1280}.png`, `profile-operator-1280.png`

## DB·production 영향
없음. 인증·RLS·권한 변경 없음(화면 판정만, 데이터는 서버가 그대로 거절).

## 원장 반영
- 행: MULTI-처음쓰는사람 — 상태: 진행 중(⑤-가 프로필 PR) — 한 줄: 수집 상태·수집 알림 칩은 통화·텔레그램 수집 계정에만, 다른 계정은 이번 달 AI 사용 한 줄.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01QdB5NMJeT3vCEcANBAiCLk

---
