# HWP 편집기(rhwp) 반입·업데이트 기준

원장 행: `HWP-편집기`·`HWP-편집기메뉴`. 1단계 시험판 [#553](https://github.com/mj880616/work/pull/553), 2단계 열기·Drive 저장 [#554](https://github.com/mj880616/work/pull/554), 메뉴 입구(이 문서 6절).

## 1. 지금 고정한 버전

| 항목 | 값 |
| --- | --- |
| 버전(한 곳에서 관리) | `scripts/hwp-lab/rhwp-pin.json` — rhwp `0.8.7` |
| 편집기 본체 | github.com/edwardkim/rhwp 태그 `v0.8.7`(커밋 `1a76570e`)의 `rhwp-studio`를 외부 웹폰트 끄고 빌드 |
| WASM 엔진 | npm `@rhwp/core@0.8.7`(sha512 확인) |
| 임베드 SDK | npm `@rhwp/editor@0.8.7`(sha512 확인). 이 패키지는 iframe SDK뿐이라 본체는 위처럼 따로 빌드한다 |
| 반입 위치 | `app/hwp-lab/rhwp-0.8.7/`(출처 `SOURCE.md`, 파일 해시 `SHA256SUMS`, 라이선스 `LICENSE`·`THIRD_PARTY_LICENSES.md`) |
| 저장 형식 | HWP만. HWPX 원본도 HWP로 내보낸다(2026-10-15 사용자 결정) |

`tests/hwp-lab-pin.test.mjs`가 pin 버전·`app/hwp-lab.js` 경로·반입 폴더·`SOURCE.md`가 서로 같은지, 반입 파일이 `SHA256SUMS`와 같은지(직접 고치지 않았는지), 편집기 HTML의 외부 차단 CSP와 저장소 guard가 그대로인지 매번 검사한다.

## 2. 새 버전이 있는지 확인하는 방법

- `npm view @rhwp/editor version` 과 `npm view @rhwp/core version`(두 값이 같은 버전일 때만 올린다)
- 저장소 태그: `git ls-remote --tags https://github.com/edwardkim/rhwp.git`
- 변경 내역: rhwp 저장소 `CHANGELOG.md`에서 HWP 저장·표·글꼴·보안 관련 항목을 본다.

정기 확인은 HWP-편집기 단계를 시작할 때마다 한 번씩 한다. 올리는 것은 필요할 때만(깨짐 수정, 보안 수정 등) 한다.

## 3. 올리는 순서

1. 작업 브랜치에서 `scripts/hwp-lab/rhwp-pin.json`의 `version`·`tag`·`commit`(태그가 가리키는 커밋), `editorIntegrity`·`coreIntegrity`(`npm view <패키지>@<버전> dist.integrity`)를 고친다.
2. `bash scripts/hwp-lab/build-rhwp-studio.sh` → `app/hwp-lab/rhwp-<새 버전>/`이 생긴다. 한 번 더 실행해 `SHA256SUMS`가 같은지(재현) 본다.
3. 옛 `app/hwp-lab/rhwp-<옛 버전>/` 폴더를 지우고, `app/hwp-lab.js`의 `RHWP` 경로를 새 버전으로 바꾼다. 캐시 버전(`?v=`)은 손으로 올리지 않는다. Pages 배포 빌드가 내용 해시로 붙인다(`AGENTS.md` 4절). 판 번호가 든 폴더 안쪽은 빌드가 건드리지 않으므로 폴더 이름을 새 판으로 바꾸는 것이 곧 캐시 갱신이다.
4. 시험 HWP 검사 재실행: `node --test tests/hwp-lab-pin.test.mjs`, `npx playwright test tests/app-e2e/hwp-lab.spec.mjs tests/app-e2e/hwp-menu.spec.mjs tests/app-e2e/hwp-drive-edit.spec.mjs`(390·1280 열기·입력·HWP 다운로드, HWPX→HWP, 자료실 올리기, 외부 요청 0, 저장소 흔적 0). 시험 파일은 `tests/fixtures/hwp-lab/`(직접 만든 빈 문서, `scripts/hwp-lab/make-samples.mjs`).
5. 빌드 결과에 `https://` 외부 주소를 부르는 새 경로가 생겼는지, 편집기 HTML에서 CSP·guard가 지워지지 않았는지 `finalize-rhwp-studio.mjs` 결과와 검사로 확인한다. browser-storage-audit도 통과해야 한다.
6. 배포 뒤 폰에서 실제 주간보고 HWP를 열어 깨짐을 보고, 내보낸 HWP를 한컴오피스(또는 한컴 뷰어)에서 연다(PR 댓글의 폰 시험 순서).
7. 원장 `HWP-편집기` 행과 이 문서 1절을 같은 PR에서 고친다.

## 4. 알려진 한계

- 반입본은 약 43MiB이며 저장소 이력에 남는다. 버전을 올릴 때마다 비슷한 크기가 더해진다.
- 한컴 전용 글꼴은 내장 오픈소스 글꼴로 대체되어 글자 모양·폭이 조금 다를 수 있다.
- 2단계부터 편집기는 sandbox iframe(allow-same-origin 없음)에서 돈다(5절). 외부 연결은 CSP로, 기기 저장은 `app/hwp-lab/studio-guard.js`로 막는다. 노조 양식 스타일 단축키(Ctrl+1~0, 예비 Alt+1~0)·스타일 버튼은 `app/hwp-lab/studio-styles.js`가 편집기 스타일 칸을 이름으로 찾아 적용한다(HWP-노조양식). 좁은 편집기(폭 1024px 미만)의 칸막이 폭이 바뀌면(폰 돌리기·폴드 펼침) `app/hwp-lab/studio-fit.js`가 편집기 [쪽 폭 맞춤] 항목을 눌러 다시 맞춘다(HWP-화면가득).
- 편집기 안 복사·붙여넣기 중 시스템 클립보드 연동은 sandbox에서 막힐 수 있다.

## 5. 2단계: 칸막이와 Drive 저장(#554)

- 칸막이: `app/hwp-frame.js`가 `sandbox="allow-scripts"` iframe을 만든다. 편집기 문서는 고유 origin(`null`)이라 Web2 창(parent·top)·로그인 정보·저장소·쿠키에 닿지 못하고, CSP가 Supabase를 포함한 다른 주소 호출을 막는다. 연결 메시지 1회(문서 없음, 전용 MessagePort 전달)만 `*`로 보내고 파일은 그 port로만 오간다. 연결이 확인되지 않으면 열지 않는다. 검사: `tests/app-e2e/hwp-lab.spec.mjs`.
- 편집기 파일(모듈 JS·CSS·WASM·글꼴)은 다른 origin에서 읽는 셈이라 응답에 `Access-Control-Allow-Origin`이 필요하다. GitHub Pages는 모든 파일에 `*`를 붙이고 Cloudflare Worker(`cloudflare/bokdoong-router.mjs`)는 원본 헤더를 그대로 넘긴다. 이 헤더가 없어지면 편집기가 열리지 않을 뿐 데이터는 바뀌지 않는다. 그때 대안은 편집기 전용 주소(예: 별도 하위 도메인)와 Worker 헤더 추가이며 운영 변경이 필요하다.
- 열기: 자료실 ⋯ 메뉴·바구니 첨부의 [편집] → `document-actions` `hwp-open`(파일·업무공간은 서버가 DB에서 정함, 30MB까지, Drive `headRevisionId`·`md5Checksum`을 함께 받음).
- 저장(2026-10-15 결정): [새 파일로 저장]이 기본. 자료실은 `library-files`로 새 자료(제목 "… (수정)"), 바구니는 `basket-files`로 같은 메모 첨부. [원본에 덮어쓰기]는 HWP 원본만: `hwp-overwrite`가 열 때 본 버전과 같은지 확인 → 내 드라이브 루트 "Web2 편집 백업" 폴더에 `<이름> 편집 전 백업 YYYY-MM-DD HHmm.hwp` 사본 → 사본 md5 확인 → 버전 재확인 → 덮어쓰기. 같은 원본을 바구니·자료실이 함께 쓰면 확인 1회(`confirm_shared`). 백업은 지우지 않는다.
- 덮어쓰기 뒤 자료실 `file_size`·메모 첨부 `size_bytes`는 갱신하지 않는다(DB 쓰기 없음). Drive 파일이 기준이다.
- 결과 불명(시간 초과·5xx·응답 이상)은 다시 보내지 않고 해당 저장 버튼을 잠근 뒤 확인을 안내한다.

## 6. 메뉴 입구(HWP-편집기메뉴)

- 목적: 한글이 깔리지 않은 PC나 폰에서 내 기기의 HWP를 열어 고친다.
- 입구: ☰ 메뉴(폰)·사이드바(PC) [HWP 편집] → `?view=hwp`. 하단 탭은 그대로다. 옛 시험판 주소 `?view=hwp-lab`과 `go('hwp-lab')`은 이 화면으로 이어진다(`app-router.js`·`view-loader.js`의 `VIEW_ALIAS`). 자료실·바구니 [편집](5절)도 같은 화면을 쓴다.
- 할 수 있는 일: [파일 선택](HWP·HWPX, 칸막이 편집기 그대로) · [내 기기에 저장](HWP로만 다운로드, HWPX도 HWP) · [자료실에 올리기].
- [자료실에 올리기]: 고친 HWP(`<이름>-수정.hwp`)를 메모리 1회용 요청(`app/library-upload-request.js`, 로그인 사용자·업무공간에 묶임, 60초 만료)으로 자료실에 넘겨 기존 [+ 자료 등록] 창에 파일을 채워 연다. 프로젝트·분류와 [등록]은 사용자가 한다. 업로드는 기존 `library-files` 흐름 그대로이며 새 업로드 경로·서버 변경은 없다.
- 저장하지 않은 고친 내용이 있으면 다른 화면으로 가거나 다른 파일을 열거나 창을 닫을 때 확인한다(편집기 변경 번호를 2초마다 읽음). 다운로드·자료실 넘김 뒤에는 묻지 않는다.
- Drive 파일을 연 뒤 화면을 떠났다가 메뉴로 다시 들어오면 새 편집기로 내 기기 파일 편집을 시작한다(Drive 문서는 이 화면에서 더 저장하지 않음).
- 편집기 파일(약 20MB)은 이 화면을 열 때만 받는다(`loadAll`에 넣지 않음). 다른 화면 시작 속도는 그대로다.
- 검사: `tests/app-e2e/hwp-menu.spec.mjs`(390·1280 메뉴 진입, 다른 화면에서 편집기 요청 0, 버튼 배치, 파일 열기, 자료실 등록 창으로 이어짐과 [등록] 시 `library-files`로 HWP 전송, 나갈 때 확인창, 외부 요청 0, 칸막이 sandbox 유지).

## 7. 노조 서식으로 만들기(HWP-서식변환)

[HWP 편집] > [노조 서식으로 만들기]: 붙여 넣은 글(마크다운·일반 글, 20000자까지, 글 파일 .md·.txt 끌어 놓기 가능)을 노조 문서 규칙(`docs/hwp-style-map.md`)에 맞게 다시 짜서 노조 양식 한글 파일에 넣고 편집기에서 바로 연다. 위 줄의 [내려받기](한글 파일)·[자료실에 저장]으로 마친다.

- **빈 양식**: 자료실 분류 "양식"에 문서 종류별로 등록한다(Drive 권한 확대 없음). 자료명이나 파일 이름에 종류 낱말이 있어야 고른다: "보고"(보고서), "공문"(공문), "회의"(회의자료). 그 종류의 양식이 없으면 종류 낱말이 없는 일반 노조 양식을 쓰고(안내 문구가 뜬다), 다른 종류의 양식은 쓰지 않는다. 양식이 아예 없으면 AI를 부르지 않고 등록 방법만 안내한다.
- **빈 양식 만드는 법**: 노조 문서 스타일(바탕글·안건제목·큰 제목·중간 제목·작은 제목·최하위 제목[강조]·세부 참고사항)이 들어 있는 한글 파일에서 본문을 지우고 머리말·꼬리말(쪽 번호)·여백만 남긴다. 제목·날짜 누름틀 이름이 "제목"·"날짜"(또는 문서제목·표제, 작성일·일자)면 거기에 채우고 본문 제목 문단은 넣지 않는다. 양식에 본문이 남아 있으면 그 뒤에 이어 붙인다.
- **채우는 방식(F1)**: 편집기 칸막이 안 `studio-convert.js`가 편집 중인 문서와 따로 같은 엔진으로 양식을 열어 문단을 넣고(`insertText`·`splitParagraph`·`applyStyle`) 다시 읽어 확인한 뒤 HWP 바이트를 돌려준다. 엔진 클래스는 반입 번들에 `scripts/hwp-lab/expose-engine.mjs`의 한 줄을 더해 얻는다(편집기를 다시 빌드하면 `finalize-rhwp-studio.mjs`가 같은 줄을 넣는다).
- **번호**: AI는 단계(l1~l7·참고·일반)만 정하고 기호(1. 1) (1) ① 가. 가) (가))는 화면이 붙인다. 양식의 스타일이 자동 번호를 쓰면 기호가 겹칠 수 있으니 실물 확인이 필요하다(겹치면 `app/hwp-convert-model.mjs`의 `numberBlocks`에서 기호를 끄는 한 곳만 고친다).
- **서버**: `ai-assist` `kind=hwp_convert`(하루 20회, 월 AI 한도·하루 합계 안). 글 원문·AI 답은 저장하지 않고 기록에는 숫자만 남긴다.

## HWP-화면가득 (2026-10-28 명진 시안 승인)

- 폰·폴드(1023px 이하): HWP 편집에 들어가면 카드가 화면 가득(`.hwp-lab[data-focus]`). 위 얇은 한 줄(`#hwpLabBar`) — 왼쪽 [✕]·파일 이름, 오른쪽 [파일 ▾](파일 선택·노조 양식으로 새 문서·노조 서식으로 만들기)·[저장 ▾](내 기기에 저장·자료실에 올리기, Drive 편집은 새 파일로 저장·원본에 덮어쓰기·자료실에서 보기, 만든 문서는 내려받기·자료실에 저장) — 과 편집기만 보인다. 폰 머리줄·아래 메뉴 줄·버튼 줄·[전체 화면]은 그리지 않는다.
- 두 메뉴는 공용 `anchored-menu.js`로 열고, 항목은 기존 버튼을 그대로 누른다(켜짐·꺼짐·숨김은 `sync()` 하나가 정함).
- [✕]·폰 뒤로가기: 이전 화면(Drive 편집은 [돌아가기]와 같음). 저장 안 한 내용이 있으면 화면을 떠날 때 한 번 묻는다(기존 `kptu:before-view-change`).
- PC: 화면 구성은 그대로 두고 겹친 제목·안내문을 없앴다. 편집기는 창 높이를 채운다. [전체 화면]은 카드(위 한 줄 + 편집기)를 브라우저 전체 화면으로 열고 숫자 키 잠금(Ctrl+1~0)을 그대로 건다. 브라우저 전체 화면을 쓸 수 없으면 창 안에서 같은 모양으로 꽉 채운다. Esc·[✕]로 원래 화면.
- 문서는 좁은 편집기에서 처음부터 쪽 폭에 맞춘 배율로 열리고(편집기 기본 규칙), 칸막이 폭이 바뀌면 `studio-fit.js`가 다시 맞춘다.
