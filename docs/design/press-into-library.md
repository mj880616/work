# 성명·보도자료 자료실 편입 설계 (PRESS-자료실편입)

📱 폰 경로 C 해당 없음(DB 변경 없음 추천) · Edge 배포 1건(정지 지점). 이 문서는 설계만 한다. 앱 코드·DB·Edge·워크플로·`press/` 파일 변경 없음.

- 작성: 2026-10-23, Claude Code 웹. 기준 main `5110d60`.
- 요청: 2026-10-23 11:03·11:05 명진 요청·결정(요청함).
- 바뀌는 기존 설계: [press-to-web2-design.md](press-to-web2-design.md)(2026-10-16). 무엇이 바뀌는지는 §8 표.
- 관련: [library-ai-fill.md](library-ai-fill.md) §8.5(분류 목록에 '성명·보도자료'·'공문' 추가 = 명진 화면 작업, LIB-AI분류보완 #1032 완료).

## 1. 명진 결정 (요청 원문 요지)

1. 따로 있는 '성명·보도자료' 메뉴를 자료실 안으로 합친다. 자료 종류에 '성명·보도자료'·'공문'을 더하고, 기존 성명·보도자료는 모두 '성명·보도자료' 종류로 둔다.
2. 기존 글은 지금 페이지 모양 그대로 자료실로 옮긴다(누르면 지금처럼 페이지로 보임).
3. 새 성명·보도자료는 한글·PDF 파일 올리기만 한다. HTML 페이지 형식은 더 만들지 않는다 — 새로 만드는 경로는 삭제한다. `press/`에 새로 쓰거나 OpenAI로 자동 게시하는 계획은 접거나 고친다.
4. 메뉴를 없애면 옛 주소는 자료실의 성명·보도자료 모아보기로 열린다. 발표일 등 전용 칸은 보존하고, 데이터는 지우지 않고 옮기기만 한다.
5. Web1 공개 쪽(`press/`)은 깨지 않는다. Web1 공개 경로·인증 완화 금지.

## 2. 현재 구조 (사실)

### 2.1 데이터가 있는 곳

- **Web2 DB에는 성명·보도자료 데이터가 없다.** 원본은 공개 저장소의 `press/` 폴더 하나뿐이다. 2026-10-16 설계의 새 표 `app_press_posts`는 초안(`docs/design/sql/20261020090100_press_posts*.sql`)만 있고 `supabase/migrations/`에 없으며 적용되지 않았다(`docs/migration-history.md`에 없음, 앱·테스트 어디에서도 쓰지 않음).
- `press/` 구성(이 기준 main에서 다시 셈, 10/16 조사와 같음)

| 항목 | 수 | 셈 방법 |
| --- | --- | --- |
| 목록 `press/archive.json` 글 | **42** (취재요청 16 · 보도자료 13 · 성명 13 / 2024년 12 · 2025년 22 · 2026년 8) | `archive.json` `items` 길이·`type`·`year` 집계 |
| 그중 `press/` 밖 글 | 1 (`../workforce/press-conference-0914/press-release/`) | `href`가 `../`로 시작 |
| 글 폴더 | 44 = 목록 41 + 목록 밖 3(`2024-09-04-public-rail-policy-conference`, `2024-09-09-public-rail-policy-conference`, 안내 페이지 `statement-checklist`) | `press/*/` 중 `href`에 없는 것 |
| 첨부 | 4 (HWP 2 · PDF 2) | `press/*/` 안 `index.html` 아닌 파일 |
| 로고·복사 스크립트를 쓰는 글 | 3 (`assets/kptu-logo.svg`·`assets/rich-copy.js`) | 글 HTML에서 grep |
| 개인 휴대전화 번호가 든 글 | 5 | 10/16 결정: 지우지 않고 그대로 |

- 자료실(`app_documents`)에도 **이미 성명류 자료가 있을 수 있다**: 옛 자동 분류(`library-files` `classify`)가 붙인 `보도자료`·`취재요청`·`성명·논평` 값. 화면은 목록에 '성명·보도자료'가 있으면 이 값들을 그 종류로 보여 준다(`app/document-categories.js` `LEGACY`). 행 수는 웹 세션에서 운영 DB를 볼 수 없어 **미확인** — 로컬 세션 또는 SQL Editor 읽기 전용으로 확인한다.

```sql
-- 읽기 전용(select만). 자료실의 성명류 값과 종류 목록 상태
select category, count(*) from public.app_documents
 where category in ('성명·보도자료','보도자료','취재요청','성명·논평','성명','공문')
 group by category order by category;
select document_categories from public.app_profiles where document_categories is not null;
```

### 2.2 Web2 화면이 읽는 방식

- 메뉴 `media`(PC 메뉴 줄·폰 메뉴 판 각 1칸, `app/index.html:58,92`) → `#mediaView`(검색칸·[전체|성명|보도자료|취재요청]) + `#pressDetailModal`(iframe).
- `app/web1-press.js`: 목록은 같은 사이트 `../press/archive.json`, 본문은 **GitHub raw**(`raw.githubusercontent.com/mj880616/work/main/press/…`)에서 받아 iframe `srcdoc`에 넣는다(sandbox `allow-scripts allow-popups allow-forms allow-downloads`). **읽기만 한다. Web2 안에 새 글을 만드는 화면·버튼은 없다.**
- 연결 코드: `app/view-loader.js`(`media` 로더·CSS), `app/app-router.js`(`MENU_SHEET_VIEWS`), `app/topbar-actions.js`(`midItems`·`VIEW_NAMES`·폰 머리줄 이름), `app/ARCHITECTURE.md` §2(폰 메뉴 판 설명). 시험: `tests/app-e2e/web1-press.spec.mjs`, `tests/app-e2e/helpers/shell-navigation.mjs`(media 분기), `startup-performance`·`navigation-p8a`·`mid-width-menu`·`topline`·`button-sizing`·`theme*`·`accessibility-ux`·`ui-polish-1`·`ui-standard-3c`·`modal-typography`·`home-mobile-navigation` spec, `scripts/check-app-smoke-contract.mjs`, `.github/workflows/app-smoke-check.yml:329,515`, `tests/hardcoded-colors-baseline.json`.

### 2.3 새 글이 생기는 경로 (= 접을 대상)

- 새 글은 Web2가 아니라 Claude Code 명령 `/게시반영`(`.claude/commands/게시반영.md` "press/ 새 글")으로 만든다: `press/<날짜-slug>/index.html` + `archive.json` + `press/index.html` → 게시 PR → `publication-auto-merge.yml` 자동 merge → Pages.
- 게시 PR 판정 `scripts/publication-pr-policy.mjs`, 내용 검사 `scripts/publication-content.test.mjs`, `.github/workflows/publication-gate.yml`(**main 필수 검사**, 모든 PR에서 돎).

### 2.4 Web1 공개 쪽 의존 (깨지 않을 것)

- `press/`는 main 루트 Pages로 공개 배포된다: `work.bokdoong.com/work/press/…`, `mj880616.github.io/work/press/…`. Worker는 desk 호스트의 `/press`를 work 호스트로 넘긴다(`tests/domain/bokdoong-router.test.mjs:298-302`).
- Web1 다른 페이지에서 `press/`로 가는 링크는 없다(루트 `index.html`·`p/`·`public-policy/` grep 0건). `press/` 밖에서 이어지는 것은 `workforce/press-conference-0914/`가 자기 하위 보도자료 페이지를 거는 것뿐이고 `press/`와 무관하다.
- 10/16 명진 확인: Web1 성명·보도자료는 개인 아카이브이고 외부에 보낸 링크가 없다. 삭제는 PRESS-Web1삭제에서 따로 한다.
- **이번 작업은 `press/`·Pages·Worker·게시 관문을 건드리지 않는다.** 옮기기는 복사이고, Web1 공개 주소는 지금처럼 열린다. Web2 인증·RLS·Edge 검사도 완화하지 않는다(가져오기는 owner 로그인 권한으로만).

### 2.5 자료실 쪽 이미 있는 것 (재사용)

| 필요한 것 | 이미 있는 것 |
| --- | --- |
| 종류 | `app_documents.category`(자유 글자, 검사 없음) + 내 목록 `app_profiles.document_categories`(추가·이름 바꾸기 함수). '성명·보도자료'·'공문' 추가는 명진 화면 작업(library-ai-fill §8.5) |
| 발표일·발행 | `document_date`(date) · `source`(발행 주체) |
| 세부 구분(성명/보도자료/취재요청) | `tags`(text[]) |
| 파일 보관 | Edge `library-files`(Drive "자료실" 폴더 + `app_documents` 행, 사용자가 제목을 주면 AI 제목 추정 없음) |
| AI가 고치지 않게 잠금 | `field_origin`(칸별 `'user'` = AI가 다시 쓰지 않음, LIB-AI자동분류·LIB-AI분류보완) |
| HTML을 페이지로 보기 | `app/html-frame.js`(sandbox `allow-scripts`만 + 네트워크 전부 막는 CSP) + Edge `document-actions` `html-view`(Drive HTML 읽기, 2 MB까지). **지금은 바구니 첨부만 허용**(`_shared/hwp-edit.ts` `source(…,"html")`이 `kind!=="basket"`이면 거절) |
| 종류로 모아보기 | 자료실 종류 거르기(`luCategoryOff`) · 다른 화면에서 걸러 열기 선례 `luShowOrganization` |
| 여러 개 지우기(되돌리기용) | LIB-여러개삭제(`app/library-select.js` → `document-delete.js`) |

## 3. 옮기는 방식

### 3.1 비교

| | 안 A 복사(추천) | 안 B 연결 | 안 C 따로 표(10/16 안) |
| --- | --- | --- | --- |
| 하는 일 | 글 HTML을 Drive "자료실"에 파일로 올리고 자료실 행 1개씩. 첨부 4개도 자료실 행 | 자료실 행만 만들고 `drive_url`에 Web1 공개 주소 | `app_press_posts` 새 표에 본문 HTML |
| 누르면 | Web2 안 칸막이에 지금 모양 그대로 | Web1 공개 페이지로 나감 | Web2 안 칸막이 |
| 자료실과 하나 | 예 | 예 | **아니오**(저장소가 둘 — 이번 결정과 어긋남) |
| Web1 삭제 뒤 | 그대로 보임 | **깨짐** | 그대로 |
| DB 변경 | 없음 | 없음 | 새 표 1개 |
| Edge 변경 | `document-actions` 1곳(자료실 .html 보기 허용) | 없음 | 없음 |
| 데이터 보존 | `press/` 원본 그대로 + 복사본 | `press/` 원본만 | `press/` 원본 + 표 |

**추천: 안 A.** 자료실 하나에 모이고, Web1을 지워도 남고, DB를 바꾸지 않는다. 안 B는 PRESS-Web1삭제와 정면으로 부딪친다.

### 3.2 안 A 세부

1. **대상**: 목록 42건(`press/` 밖 1건 포함 — 파일만 복사, Web1 페이지는 그대로) + 목록 밖 옛 글 2건(2024-09-04·09-09 정책토론회). 안내 페이지 `statement-checklist`는 성명이 아니라 제외. 첨부 4개. 합계 자료실 행 **48**(글 44 + 첨부 4).
2. **칸 채우기**(전용 칸 보존)

| `press/` 값 | 자료실 칸 |
| --- | --- |
| `title` | `title` |
| `date` | `document_date`(발표일) |
| `publisher` | `source` |
| 종류 | `category='성명·보도자료'` |
| `type_label`(성명·보도자료·취재요청) | `tags`에 1개(세부 구분, 결정 Q2) |
| 폴더 이름 | `file_name='<날짜-slug>.html'` — 겹침 판정 열쇠(같은 파일 이름이 이미 있으면 건너뜀, 두 번 눌러도 안전) |
| 첨부 | 같은 제목·날짜·발행·종류의 HWP/PDF 자료 행(파일 이름은 원본 그대로) |

3. **AI가 옛 글을 고치지 않게**: 올린 뒤 같은 owner 권한으로 `field_origin`을 `{title,category,source,document_date: 'user'}`로 둔다(수정 창 저장과 같은 경로). 프로젝트·담당조직 연결은 열어 둘지 결정 Q4.
4. **원본 양식 보존**: 파일은 원본 글자 그대로 올린다. 바꾸는 것은 셋뿐이고 가져오기 기록(설명 칸 아님, PR 본문·대조 표)에 남긴다.
   - `press-archive.css` 링크 → 같은 내용 `<style>`로(29줄). 칸막이 CSP가 외부 요청을 막기 때문.
   - 로고 `assets/kptu-logo.svg`(3건, 4 KB) → `data:` 이미지로(CSP가 `data:` 이미지는 허용).
   - `rich-copy.js` 복사 단추(2건)는 칸막이에서 돌지 않는다 → 그대로 두고 안 뜸을 받아들임(본문 복사는 브라우저 선택 복사).
   - 칸막이 안 첨부 `download` 링크는 CSP로 막힌다 → 첨부는 같은 종류 자료 행으로 바로 옆에 보인다.
5. **가져오기 주체**: 자료실의 1회용 [옛 성명·보도자료 가져오기] 단추(owner만, 로그인 권한). 목록은 지금처럼 같은 사이트 `archive.json`, 본문·첨부는 지금 화면과 같은 GitHub raw에서 받아 `library-files`로 한 건씩 올린다(제목·날짜·발행·종류를 넘기므로 OpenAI 호출 없음). 새 서버 기능·새 비밀값 없음. 단추는 내 종류 목록에 '성명·보도자료'가 없으면 시작하지 않는다(없으면 저장 값이 '기타'로 보이고 AI 정리 대상이 됨).
6. SQL로 넣지 않는 이유: 파일이 Drive에 있어야 하고(Drive 올리기는 Edge만 가능), 본문 SQL은 폰 붙여넣기에서 잘린다.

## 4. 옛 주소 처리

| 옛 주소 | 처리 |
| --- | --- |
| Web2 `?view=media` | 라우터 옛 주소 표(`VIEW_ALIAS`, 선례 `hwp-lab→hwp`)에 `media→library`. 자료실이 종류를 '성명·보도자료' 하나만 켠 모아보기로 열림(`luShowOrganization`과 같은 "걸러 열기" 함수 하나 추가, 새 저장소 없음). 주소는 `?view=library`로 바뀜 |
| Web2 안에서 media로 가던 버튼 | 메뉴 2칸 삭제(§5). 다른 화면의 media 이동은 grep 0건(라우터·메뉴 외) |
| Web1 `work.bokdoong.com/work/press/…`, `mj880616.github.io/work/press/…` | **이번에는 그대로**(공개 쪽 무변경). 지울 때는 PRESS-Web1삭제가 따로 정함 |
| desk `/press` → work 넘기기(Worker) | 그대로 |

## 5. 화면 삭제 범위 (Contract PR)

- 지운다: 메뉴 `data-view="media"` 2칸, `#mediaView`, `#pressDetailModal`, `app/web1-press.js`, `app/web1-press.css`, `view-loader.js`의 `media` 로더·CSS 항목, `app-router.js` `MENU_SHEET_VIEWS`의 `media`, `topbar-actions.js`의 `media` 이름·순서, 1회용 가져오기 단추와 그 코드(임시 코드 남기지 않음, AGENTS.md §3-6), `app/ARCHITECTURE.md` §2 문구(폰 메뉴 판 칸 목록).
- 시험 정리: `tests/app-e2e/web1-press.spec.mjs` 삭제 → 옛 주소가 자료실 성명·보도자료 모아보기로 열리는 시험으로 대체, §2.2의 다른 spec·helper·smoke 검사에서 media 항목 정리, 색 기준선 갱신.
- "새로 만드는" 경로 접기: `.claude/commands/게시반영.md`의 "press/ 새 글" 절 삭제(기존 Web1 페이지 갱신 경로는 남김). `docs/ai-work-system-source-of-truth.md:18` "성명·보도자료 = GitHub press/" → "Web2 자료실(종류 성명·보도자료)".
- 지우지 않는다(이번 범위 밖): `press/` 파일, `publication-gate`(main 필수 검사 — 먼저 지우면 모든 PR이 막힘), `publication-pr-policy.mjs`·`publication-auto-merge.yml`(PRESS-Web1삭제에서), 자료실 데이터.

## 6. DB 변경 필요 여부와 PR 순서

- **DB 변경 필요 없음.** 쓰는 칸(`category`·`document_date`·`source`·`tags`·`file_name`·`field_origin`)과 권한(owner RLS·`library-files`)이 모두 있다. 종류 2개 추가는 기존 함수로 명진이 화면에서 한다. 그래서 "DB PR 먼저"에 해당하는 단계가 없고, 대신 **서버(Edge) PR을 먼저** 둔다.
- `app_press_posts` 초안 SQL 3개는 폐기(§8). 지울지·"폐기" 표시만 할지는 원장 정리 PR에서.

| 순서 | 무엇 | 누가 | 멈춤 | 되돌리기 |
| --- | --- | --- | --- | --- |
| 0 | 종류 목록에 '성명·보도자료'·'공문' 추가(library-ai-fill §8.5 사용자 할 일, 했는지 확인) | 명진 화면 1분 | — | 이름 삭제(자료 그대로) |
| 1 | **Edge PR**: `document-actions` `html-view`가 자료실 자료(`kind:"library"`)의 `.html`도 열게. owner 확인·2 MB 상한·읽기 전용은 그대로 | AI → PR → merge | **Edge 배포**(승인형 workflow, verify_jwt=**true** 유지, 배포 전 운영 SHA 기록) | 직전 운영 SHA 재배포. 화면이 아직 안 쓰는 동안은 영향 없음 |
| 2 | **화면 PR(Expand)**: 자료실에서 `.html` 자료를 누르면 칸막이로 보기(`html-frame.js` 재사용), 1회용 가져오기 단추. 성명 메뉴는 아직 그대로 | AI → PR → merge(Pages) | — | revert PR |
| 3 | 가져오기 1번 누르기 → 대조: 자료실 성명·보도자료 글 44·첨부 4, 세부 꼬리표 16/13/13(+목록 밖 2), 겹침 0, 무작위 5건 + 가장 큰 글·가장 옛 글·로고 3건 원본과 나란히 | 명진 단추 1번, 캡처 → 커맨드센터 판정 | **production 데이터 추가**(자료실 48행·Drive 48파일) | §7 |
| 4 | **화면 PR(Contract)**: §5 삭제 + `?view=media` → 자료실 모아보기 + `/게시반영` press 새 글 절 삭제 + 원본 기준 문서 | AI → PR → merge | — | revert PR(데이터는 그대로라 메뉴만 돌아옴) |
| 5 | (나중) PRESS-Web1삭제 | 별도 | 별도 | 별도 |

- 1 → 2 순서인 이유: 화면이 먼저 나가면 `.html` 자료를 눌렀을 때 서버가 "바구니 첨부만"으로 거절한다(깨지진 않지만 안 보임). 2의 화면은 서버 거절 문구를 "[Drive에서 열기]" 안내로 처리한다(`HTML_FRAME_TEXT.notReady` 선례).
- 3은 4보다 반드시 먼저(가져오기 단추가 Contract에서 사라짐). 3은 Web1이 살아 있어야 하므로 PRESS-Web1삭제보다 먼저.

## 7. 되돌리기

| 단계 | 방법 | 잃는 것 |
| --- | --- | --- |
| Edge(1) | 배포 전 기록한 운영 SHA로 같은 workflow 재실행 | 없음 |
| 화면(2·4) | 해당 PR revert → Pages | 없음(데이터는 자료실에 그대로) |
| 가져온 자료(3) | 자료실에서 종류 '성명·보도자료' + 파일 이름 `YYYY-MM-DD-*.html`·첨부 4건을 여러 개 지우기로 삭제(Drive 원본도 같이 지워짐). 원본 `press/`가 그대로라 다시 가져올 수 있음 | 가져온 뒤 명진이 붙인 연결·수정 |
| 일부만 틀림 | 그 자료만 수정 창에서 고치거나 지우고 다시 가져오기(겹침 판정이 빠진 것만 올림) | 없음 |

## 8. 기존 계획 정리안 (원장 행 — 커맨드센터가 merge 뒤 문서 PR로)

| 원장 행 | 지금 | 정리안 |
| --- | --- | --- |
| PRESS-Web2자리 | 대기. 저장 위치 = 새 표 `app_press_posts`(안 B) | **폐기(대체)** → PRESS-자료실편입. 10/16 설계 §2 안 B·§4 절차·SQL 초안 폐기. 남는 것: 원본 양식 보존(§3)·대조 방법·전화번호 그대로 결정 |
| PRESS-자동올리기 | 대기. OpenAI가 양식대로 HTML 게시 | **폐기(접음)**. 새 글은 자료실에 한글·PDF 올리기, 종류·제목·날짜는 이미 있는 LIB-AI분류보완이 채움(지침: 성명서·보도자료·논평·취재요청서 = 성명·보도자료). 새로 만들 것 없음. 10/16 설계 §6·결정 P6 폐기 |
| PRESS-Web1삭제 | 대기. 선행 PRESS-Web2자리 | **유지**. 선행을 PRESS-자료실편입(§6의 3단계 대조 완료)으로. `/게시반영` press 새 글 절은 PRESS-자료실편입 Contract로 앞당김. 나머지(필수 검사·게시 경로·`press/` 삭제)는 그대로 |
| PRESS-자료실편입(새 행) | — | 이 설계. 순서 §6. 위 정리와 같은 문서 PR에서 추가 |
| BOARD-이관 | "PRESS-Web2자리와 같은 방식", "순서: PRESS-자동올리기 다음" | 문구만: "같은 방식" 참조를 PRESS-자료실편입(또는 SHARE 쪽 판단)으로, 순서는 "PRESS-자료실편입 다음" |
| 원장 47행 순서 목록 | "… PRESS-Web2자리 → PRESS-Web1삭제 → PRESS-자동올리기 …" | "… PRESS-자료실편입 → PRESS-Web1삭제 …" |
| LIB-AI분류보완 | 완료(확인 대기). 종류 추가는 사용자 화면 작업 | 그대로. 이 작업과 겹치지 않음(종류 목록·AI 지침은 거기서 끝, 여기서는 쓰기만) |
| LIB-종류목록통일 | **원장에 이 이름의 행이 없음**(grep 0건) | 확인 필요: 다른 이름이거나 아직 행 추가 전. 종류 목록 자체는 LIB-AI분류보완 §8.5로 처리됨 |

10/16 설계(`press-to-web2-design.md`) 중 이번 결정으로 바뀌는 부분:

| 10/16 절 | 이번 |
| --- | --- |
| §2 저장 위치(추천 안 B 새 표), 결정 P1 | 자료실(`app_documents`) + Drive 파일. 10/16 안 A의 "자료실과 섞임"은 이번엔 원하는 결과 |
| §2 안 A의 단점 "보려면 Edge 수정" | 그대로 사실 — §6 1단계 |
| §3 양식 보존 | 유지(+로고 `data:` 이미지) |
| §4 이전 절차 | §6으로 대체 |
| §5 Web1 삭제 순서 | 유지(선행만 바뀜) |
| §6 자동올리기, 결정 P6 | 폐기 |
| 결정 P2(목록 밖 글) | 이번 Q3 |
| 결정 P3(모양) | 유지(①) |
| 결정 P4·P5 | 유지(PRESS-Web1삭제 때) |

## 9. '선전'과 '성명·보도자료' 구분 기준 (제안)

| 종류 | 기준 | 예 |
| --- | --- | --- |
| 성명·보도자료 | 언론·대외에 단체 입장·사실을 **글로 발표**하는 문서 | 성명서, 논평, 보도자료, 사후 보도자료, 취재요청서, 기자회견문 |
| 선전 | 조합원·시민에게 **알리고 설득하는 홍보물**(그림·디자인 위주 포함) | 소식지, 웹자보, 카드뉴스, 현수막·피켓 문구, 유인물 |
| 공문 | 기관과 **주고받는 공식 문서** | 공문, 협조 요청, 회신, 교섭 요청 공문 |

- 애매한 경우: 기자회견 **웹자보**는 선전, 기자회견**문**은 성명·보도자료. 성명을 카드뉴스로 만든 것은 선전. 교섭 요구 공문은 공문(합의서·요구안 본문은 교섭·합의).
- AI 지침(`ai-assist/library-fill.ts`)에 이미 같은 기준이 들어 있다(기자회견문·유인물·현수막만 없음 — 넣을지는 Q6).

## 10. 위험

| 위험 | 막는 법 |
| --- | --- |
| 종류 목록에 '성명·보도자료'가 없을 때 가져오면 '기타'로 보이고 AI 정리가 종류를 바꿈 | 가져오기 단추가 목록 확인 후 시작 + `field_origin` 'user' 잠금 |
| AI 자동 정리(LIB-자동정리)가 옛 글 제목·날짜를 고침 | 4칸 `field_origin='user'`. 정리 대상은 '정리 안 된 칸'뿐이라 채워진 칸은 원래도 대상 아님 |
| 글 보기가 Drive 연결에 묶임(끊기면 성명 안 보임) | 다른 자료실 자료와 같은 조건으로 받아들임. 원본 `press/`는 PRESS-Web1삭제 전까지 남음 |
| 본문 검색 안 됨: 글자 읽기(`_shared/document-text.ts`)가 `.html`을 모름(`none`) | 제목·발행·꼬리표로는 검색됨. 본문 검색은 별도 작업(Q5) |
| 자료실 목록이 48행 늘어남 | 종류 거르기로 숨기기 가능(기본 끔 목록에 넣을지는 명진 화면 설정) |
| 칸막이가 지금 Web1 보기보다 좁음(`allow-popups`·`forms`·`downloads`·네트워크 없음) → 글 안 링크·복사 단추 안 뜸 | 보안상 의도(10/16 P3 ①). 첨부는 옆 자료 행으로 |
| `publication-gate`가 남아 있음 | 지우지 않음(먼저 지우면 모든 PR 막힘) — PRESS-Web1삭제 |
| 가져오기 도중 끊김 | 한 건씩 올리고 파일 이름으로 겹침 판정 → 다시 누르면 빠진 것만 |
| 공개 git 이력의 전화번호 5건 | 이번 범위 밖(10/16 P4 유지) |

## 11. 명진 질문 (추천안)

- **Q1. 옛 글을 어떻게 옮길까**
  - ① 파일로 복사해 자료실에 둠, 누르면 Web2 안에서 지금 모양으로 보임 — **추천**. Web1을 나중에 지워도 남는다. 서버 한 곳만 고침(배포 승인 1번).
  - ② 자료실에는 줄만 두고 누르면 Web1 공개 페이지로 감. 빠르지만 Web1을 지우면 다 깨진다.
- **Q2. 성명/보도자료/취재요청 세부 구분을 남길까**
  - ① 종류는 '성명·보도자료' 하나, 세부는 작은 꼬리표로 남김 — **추천**. 정보를 잃지 않고 종류 목록은 단순하다.
  - ② 세부 구분 버림.
- **Q3. 목록에 없던 글**
  - ① 목록 42건 + 목록 밖 옛 정책토론회 글 2건 옮김, 안내 페이지(`statement-checklist`)는 제외 — **추천**. 잃는 글이 없다.
  - ② 목록 42건만.
- **Q4. 옮긴 옛 글에 AI가 프로젝트·담당조직 연결을 붙여도 될까** (제목·날짜·발행·종류는 잠금)
  - ① 붙여도 됨 — **추천**. 프로젝트 화면 [자료]에서도 보인다. 손으로 뺀 연결은 다시 안 붙인다(기존 규칙).
  - ② 연결도 잠금.
- **Q5. 성명 본문 글자 검색**
  - ① 이번엔 제목·발행·꼬리표만, 본문 검색은 나중에 따로 — **추천**. 범위가 작아진다.
  - ② 이번에 HTML 글자 읽기도 같이(서버 배포 1건 더).
- **Q6. AI 분류 기준에 '기자회견문 = 성명·보도자료, 유인물·현수막 = 선전'을 더할까**
  - ① 더함 — **추천**(지침 글 한 줄, `ai-assist` 다음 배포 때 같이).
  - ② 지금 기준 그대로.
- **확인**: 종류 목록에 '성명·보도자료'·'공문'을 이미 추가했는지(library-ai-fill §8.5). 안 했으면 가져오기 전에 1분.
