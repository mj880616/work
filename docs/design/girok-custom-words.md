# 기록+ 사람별 이름 바꾸기 (APP-기록+이름바꾸기, S67-44)

2026-11-20 사용자 결정(21:21~21:23): 지금 운영 앱이 기록+다. 기록+ 기본 단어는 노조 색이 없고, 처음 쓰는 사람은 메뉴 이름을 직접 바꿔 쓴다. '노조 실무자' 같은 미리 만든 묶음은 두지 않는다. 사용자의 지금 이름은 사용자 한 사람이 바꾼 결과로 넣는다. 방향 전체는 `docs/design/allinone-diary-plan.md` '방향 전환'.

## 1. 단어 값의 출처

위가 이긴다.

1. **내가 바꾼 이름**: 내 프로필 행 `app_profiles.custom_words`(서버, 기존 owner RLS로 내 행만 읽고 씀). 기기 저장소에는 두지 않는다.
2. **바탕 낱말 묶음**(S67-62, 8절): 서버 운영자 허용 표에 `nojo_words`가 있는 사람만, 빌드 얼굴 단어표 대신 노동조합+ 낱말(단어표 비어 있음 = 글자 그대로) 전체.
3. **빌드 얼굴의 기본값**: `app/brand/faces.mjs`(기록+는 `girok-words.mjs`, 노동조합+는 글자 그대로). S67-43이 화면 글자를 모두 `word()`로 모았다.

`brand.mjs`의 `word()`만 1을 얹은 단어표를 쓴다. `FACE`(얼굴 그 자체, 기본 이름)·`APP_NAME`은 바꾸지 않는다. 얼굴은 여전히 빌드만 정한다.

## 2. 바꿀 수 있는 칸 (문장 전체 고치기 아님)

`app/brand/custom-words-model.mjs` `SLOTS` 한 곳. DB 검사와 칸 id가 같다(시험으로 맞춤).

| id | 화면 이름표 | 맡는 단어표 열쇠(노조 글자) | 기록+ 기본 |
| --- | --- | --- | --- |
| menu_biz | 메뉴 | 사업 관리(·#title) | 활동 기록 |
| report | 기록 한 건 | 사업 보고, 사업보고 | 활동 기록 |
| area | 큰 묶음 | 사업영역, 사업 영역 | 프로젝트 |
| menu_org | 메뉴 | 조직 관리(·#title) | 거래처·직원 / 거래처·부서·직원 |
| org_one | 대상 한 곳 | 담당조직, 담당 조직 | 관리 대상 |
| org_report | 대상 기록 | 조직 보고, 조직보고 | 기록 |
| workplace | 중요 대상 | 투쟁사업장, 투쟁 사업장 | 주요 거래처 |
| kind_* 8칸 | 분류 | 회의·정책·교섭·언론·국회·투쟁·교육·기타(`#kind` 자리만) | 회의·기획·협의·홍보·외근·행사·교육·기타 |

- 이름 규칙: 글자 1~20자, 앞뒤 공백·제어문자 없음, `< > & " ' \` \\` 없음(화면 HTML에 그대로 들어가므로). 전체 2000바이트.
- 바꾼 칸의 열쇠는 내 이름이 된다. 그 열쇠를 품은 얼굴의 문장 열쇠는 빼서, 그 문장은 낱말 바꾸기로 다시 맞춰진다(문장 안에서도 내 이름, 조사는 `faces.mjs`가 새 말에 맞춤).
- 분류 8칸은 `word(글자,'kind')` 자리에만 쓴다. 문장 안 '회의'·'교육' 같은 낱말은 건드리지 않는다.
- S67-57(내 프로필·묶음·주간 캘린더 칸): 소속(`노조#group`)·주간(`주간 보고#weekly`)·예시(`#example` 3개)는 이름 바꾸기 칸이 아니라 단어표 자리다(칸 추가·DB 변경 없음). 운영자는 S67-62 바탕 낱말 묶음(`nojo_words`)으로 지금 글자 그대로, 그 밖의 사람은 WORK ON+ 기본(소속명·주간 정리·○○회사·○○단체). 글자는 `app/profile-words.mjs` 한 곳에서 만든다(`UNION_WORD`·`UNION_LABEL`·`WEEKLY_WORD`·`REPORT_CALENDAR_TITLE`). 서버 값(묶음 종류 `union`, `app_profiles.union_name`)은 바꾸지 않는다. 다른 사람이 이 두 이름을 직접 고쳐 쓰는 칸은 요청이 오면 따로 더한다(그때 DB 칸 검사 변경).
- 대표 글자(첫 열쇠)의 기본 이름과 같은 값은 바꾸지 않은 것으로 본다. 그래서 노동조합+ 얼굴에서 사용자 값은 화면 한 글자도 바꾸지 않는다.

## 3. 시작 순서 (설정 읽기 → 첫 그리기, 덮어 그리기 없음)

1. 세션 확인 → 소속 확인(`__KPTU_BOOT_MEMBERSHIP_PROMISE__`) 시작.
2. 그 약속에 묶어 **소유자일 때만** `app_profiles?select=custom_words` 한 번(`window.__KPTU_CUSTOM_WORDS__`). 비구성원은 데이터 요청 없음. 3.5초·실패·칸 없음(DB 적용 전 400)이면 바꾼 이름 없이 연다.
3. `brand/custom-words.mjs`가 그 약속을 기다린다. 그래서 `brand.mjs`를 부르는 모듈은 첫 그리기 전에 이름을 안다. 약속보다 먼저 실행되는 모듈은 `brand.mjs`를 부르지 않는다(`action-labels.js`는 두 번째 묶음으로 옮김. 시험이 import 사슬을 따라가 본다).
4. 바꾼 이름이 있을 때만 `custom-words-boot.js`가 화면 모듈을 부르기 전에 앱 바탕(index.html 글자, 자료·사용자 글이 그려지기 전) 한 번 입힌다. 다시 입히지 않는다.
5. 이름을 저장하면 다음 열기부터 모든 화면에 보인다. 저장 뒤 [지금 다시 열기]를 보인다(캐시 삭제가 아니라 다시 열기).

## 4. 화면

내 프로필 '기본 정보' 칸 바로 뒤에 '이름 바꾸기' 칸 하나(`app/custom-words-panel.js`가 유일한 주인). 접힌 한 줄(제목 · n개 바꿈) → 펼치면 칸마다 [이름표 · 기본 이름 · 내 이름 입력 · 기본으로], 아래 [저장]. 빈칸 = 기본 이름.

## 5. 사용자 계정 값
> S71-32(2026-11-26 사용자 "이 이름 바꾸기도 없애고 차라리 메뉴 수정 여기에 기능을 넣든지"): 내 프로필 '이름 바꾸기' 칸은 없앴다. 고치는 곳은 메뉴 수정 창 하나(`app/menu-edit.js`) — 메뉴 이름(사업 관리·조직 관리)은 그 메뉴 줄에서 바로, 나머지 5칸과 활동 분류 8칸은 창 맨 아래 접힌 '다른 이름' 묶음. 저장은 [완료] 한 번에 함께(서버 칸·값 모양 그대로, `custom-words-store.js` `saveCustomWords`).


코드에 계정·이름을 넣지 않는다(공개 저장소). `docs/ops/custom-words-operator.{precheck,apply,rollback}.sql`(SQL Editor, 실행은 CC)이 운영자 허용 표에 `calls`·`telegram`이 둘 다 켜진 작업공간 정확히 하나의 owner 한 명을 골라, 지금 노동조합+ 화면 이름 그대로(15칸)를 넣는다. 이미 값이 있으면 멈추고(덮어쓰지 않음), 되돌리기는 넣은 값과 같을 때만 비운다.

## 6. 적용 순서

1. 이 PR merge(화면은 칸이 없으면 기본 이름으로 열고 칸만 '저장 준비 중').
2. 승인형 DB workflow: `20261120210000_profile_custom_words` dry-run → apply.
3. SQL Editor: `custom-words-operator.precheck.sql`(모두 예) → `custom-words-operator.apply.sql`.
4. 빌드 얼굴을 기록+로 바꾸는 일은 따로(아래 7).

## 7. 남은 일 (기록+ 빌드로 바꾸기 전)

- (S67-56에서 해결) 기록+ 빌드는 HTML 글자를 빌드 때 기록+ 단어로 굽는다(`scripts/brand-face.mjs`). 앱 바탕(`app/index.html`)에서 칸 열쇠가 든 글자는 바꾼 자리마다 원래 글자를 남기고(글자 앞 주석 `<!--word:원래 글자-->`, 속성은 `data-word-속성 이름`, `<html data-word-faced>`), 고친 이름이 있는 사람은 3-4단계 앱 바탕 입히기(`app/brand/custom-words-shell.mjs`, 화면 공개 전 한 번)가 그 원래 글자에서 다시 맞춘다. 고친 이름이 없는 사람은 구운 글자 그대로(실행 중 바꾸기 없음). 시험: `scripts/brand-face.test.mjs`, `tests/build-pages/girok-face-boot.spec.mjs`.
- (S67-56) 운영 배포가 기록+(WORK ON 기본 단어) 얼굴이다: `pages-deploy.yml`·`cloudflare-worker-deploy.yml`이 `--face=girok`으로 만든다(`scripts/production-face.test.mjs`).
- 칸 밖 낱말(조직→대상, 사업장→거래처, 조합원→구성원 등)은 칸으로 바꿀 수 없다. 사용자 화면은 칸을 늘리지 않고 '바탕 낱말 묶음'(8절, S67-62)으로 노동조합+ 낱말 전체를 바탕으로 써서 지금과 같게 한다.

## 8. 바탕 낱말 묶음 (S67-62)

2026-11-21 07:55 사용자 결정: 운영 빌드를 WORK ON 얼굴(girok)로 내보내되, 사용자 화면은 바뀌기 전과 한 글자도 다르지 않아야 한다. 15칸 밖 낱말(조직→대상, 사업장→거래처, 쟁의 단계→진행 단계, 운영자 기능 안 글자 등 약 250개)까지 지키려고 칸을 늘리는 대신, 사람마다 **바탕 낱말 묶음** 하나를 고른다.

- 고르는 길: 서버 운영자 허용 표 `public.app_operator_features`의 키 `nojo_words`(migration `20261121090000_nojo_words_feature`, 값은 `docs/ops/nojo-words-operator.*.sql`로만). 화면에서 고르는 메뉴는 없다(미리 만든 묶음을 다른 사람에게 보이지 않는다, 11/20 결정). 표는 RLS 켬·정책 없음·API 역할 권한 없음이라 본인도 못 바꾼다.
  - 다른 길을 고르지 않은 이유: `app_profiles` 칸이나 `custom_words` 안 예약 키는 owner RLS로 본인이 API로 바꿀 수 있어 'SQL로만'이 깨지고, 둘 다 DB 검사 변경이 따로 필요하다. 허용 표는 이미 '서버만 정하는 사람별 켜기'의 자리이고 화면이 읽는 길(`app_my_features`)도 있다. 키 목록이 검사(`app_operator_features_feature_check`)라 그 한 줄만 바꾼다.
- 뜻: `app/brand/custom-words-model.mjs` `WORD_BASE_FEATURES`·`wordBaseOf`·`withWordBase`. 단어표만 바꾸고 이름·아이콘·메뉴 목록은 빌드 얼굴 그대로.
- 시작 순서: `loader-v2.js`가 소유자 확인 뒤 `custom_words`와 함께 `app_my_features`를 한 번 읽는다(같은 약속, 실패면 그쪽만 없음. S71-32부터 기다림은 소속 확인과 같은 15초 — 3.5초에 끊겨 그 접속 내내 기본 이름으로 보이던 원인). 그 답은 `my-features.js`의 첫 물음이 그대로 쓴다(`window.__KPTU_BOOT_FEATURES__`, 두 번 묻지 않음). `brand.mjs` `BASE_FACE` = 빌드 얼굴 + 바탕 묶음, 그 위에 고친 이름. 이름 바꾸기 칸의 '기본 이름'도 `BASE_FACE`.
- 앱 바탕: 빌드가 `app/index.html`에서 바꾼 글자는 **모두** 원래 글자를 남긴다(S67-56은 칸 열쇠가 든 글자만이었다). 바탕이 nojo면 `custom-words-shell.mjs`가 화면 공개 전 한 번 원래 글자로 되돌린다 → 앱 바탕이 nojo 빌드와 같다(`scripts/brand-face.test.mjs`가 되돌린 HTML = nojo 빌드 HTML을 본다).
- 시험: `tests/custom-words.test.mjs`(app/의 `word()` 고정 글자 전부 = nojo), `tests/build-pages/girok-face-boot.spec.mjs`(두 빌드를 같은 흉내 서버로 띄워 화면 12개 글자·`word()` 고정 글자 전부가 같음, 바탕 없는 사람은 노조 색 글자 0), `tests/auth-handoff/nojo-words-feature-db.test.mjs`(PostgreSQL).
- 적용 순서: 이 PR merge → 승인형 DB workflow `20261121090000` dry-run → apply → SQL Editor `nojo-words-operator.precheck.sql`(모두 예) → `nojo-words-operator.apply.sql`. 적용 전에는 사용자 화면도 WORK ON 낱말 + 15칸(#2828 그대로)이다.
