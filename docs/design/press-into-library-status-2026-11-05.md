# PRESS-자료실편입 남은 일 대조 (2026-11-05, S50-30)

📱 폰 가능 · 문서 전용. 앱 코드·DB·Edge·`press/` 파일 변경 없음.

- 기준: main `7301f44`(#1915). Claude Code 웹 세션(운영 DB·Edge 조회 없음).
- 요청: 2026-10-23 11:03 "성명·보도자료를 자료실에 편입 + 자료 종류에 '공문' 추가"와 11:05 결정(요청함 원문은 옮기지 않음).
- 설계: [press-into-library.md](press-into-library.md).

## 1. 요청 항목별 대조

| 요청 항목 | 상태 | 근거(저장소) |
| --- | --- | --- |
| ① '성명·보도자료' 메뉴를 자료실로 합침 | 됨 | #1230: 메뉴 칸·화면(`web1-press.*`) 삭제. 메뉴 시험(`ui-polish-1`·`mid-width-menu`·`home-mobile-navigation`)이 '성명·보도자료' 칸 없음을 검사 |
| ①-1 기존 글을 그 종류로 자료실에 넣기 | 됨 | #1099 가져오기 단추 → 자료실 48줄(글 44 + 첨부 4). #1229 대조 SQL(`docs/ops/press-import-check.sql`) 확인 뒤 #1230 merge(그 PR의 merge 조건). 가져오기 임시 코드는 #1230에서 삭제 |
| ② 자료 종류 '공문' | 됨 | 10/24 결정: 명진 목록(프로필)에 '성명·보도자료'·'공문' 추가. `app/document-categories.js` 주석, `ledger-*-model.mjs` `official_letter` = 공문 |
| ③ 두 종류 AI 자동 분류 | 됨 | `supabase/functions/ai-assist/library-fill.ts` 분류 기준 줄: 성명서·보도자료·논평·취재요청서·기자회견문 = 성명·보도자료, 기관과 주고받은 공식 문서 = 공문, 소식지·웹자보 = 선전(#1098, 이후 보완) |
| ④ 담당조직·프로젝트 자료 종류도 같은 목록 | 됨 | `document-categories.js` 한 곳이 자료실·담당조직(`workplace-detail.js`)·프로젝트(`project-system-v3.js`) 꼬리표 목록을 모두 줌 |
| 옛 주소는 자료실 모아보기로 | 됨 | #1230: `?view=media` → 자료실, 종류 '성명·보도자료'만 켬(`app-router.js` `ALIAS_ENTRY`, `library-upload.js`) |
| 기존 글은 페이지 모양 그대로 보기 | 됨 | #1098 서버 `.html` 보기 허용 + #1099 `library-html-view.js` |
| 새 글은 한글·PDF 올리기만, HTML 새로 만드는 경로 없앰 | 됨 | #1230: `/게시반영`의 press 새 글 절 삭제. PRESS-Web2자리·PRESS-자동올리기 폐기(10/24) |
| 데이터는 지우지 않고 옮기기만 | 지켜짐 | #1230 본문: 자료실 48줄·Drive·DB 무변경 |
| Web1 `press/` 정리 | 남음 → 별도 행 | 저장소 `press/`에 글 폴더·`archive.json`(42건)이 그대로 있음. 원장 PRESS-Web1삭제 행(게시 관문 `publication-gate`·허용 목록 `docs/sec-publication-auto-merge.md` 정리, 필요하면 GitHub 규칙 변경 = 정지 지점) |

## 2. 결론

- 이 요청 안의 Web2 쪽 일(①~④, 옛 주소, 보기, 새 글 경로)은 모두 merge되어 있다. 이 세션에서 고칠 코드는 없다.
- 남은 것은 Web1 공개 쪽 `press/` 정리 하나이며, 원장의 별도 행 PRESS-Web1삭제가 맡는다(선행 = 이 행의 가져오기·대조, 끝남). 공개 경로·게시 관문·규칙 변경이 섞여 있어 이 문서 PR에서 하지 않는다.
- 원장 PRESS-자료실편입 행 상태 문구("남음: 자료실 [옛 성명 가져오기] 1번(명진)")는 #1230 본문(48줄 가져옴, 단추 삭제)과 맞지 않는다. 커맨드센터가 원장 갱신 때 "완료(남은 Web1 정리는 PRESS-Web1삭제)"로 고치는 것을 제안한다.

## 3. 확인하지 못한 것

- 운영 DB의 자료실 48줄 실제 존재는 이 웹 세션에서 볼 수 없다. #1230이 "대조 SQL 이상 없음 뒤 merge"를 조건으로 두었고 merge되었으므로 확인된 것으로 추정한다. 다시 보려면 `docs/ops/press-import-check.sql`(읽기 전용)을 실행한다.
- 새 사용자(MULTI 단계 ②)의 기본 종류 목록(`DEFAULT_DOCUMENT_CATEGORIES`, DB 칸 기본값과 같음)에는 '성명·보도자료'·'공문'이 없다. 명진 목록에는 있다. 기본값에 넣을지는 DB 기본값 변경이라 범위 밖(발견사항).
