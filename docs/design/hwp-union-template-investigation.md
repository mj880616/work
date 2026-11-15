# HWP-노조양식 선행 조사 (HWP-노조양식 · HWP-서식변환)

📱 폰 가능(조사 전용) — 코드·설정·DB·Edge·Drive 권한을 바꾸지 않았다. 권한을 넓히는 일은 `AGENTS.md` §6 정지 지점이며 사용자 승인 전에는 하지 않는다.

- 작성: 2026-10-18, Claude Code. 기준 main `bd7a19d`.
- 원장 행: `docs/roadmap.md`의 `HWP-노조양식`(324행), `HWP-서식변환`(325행).
- 기준 문서: [노조 문서 양식](../hwp-style-map.md), [HWP 편집기 기준](../hwp-editor.md).
- 양식 원본 파일은 이 저장소에 넣지 않았다(공개 저장소). 조사는 반입된 편집기 파일과 공개 npm 패키지만 봤다.

## 1. 결론 먼저 (일상어)

1. **"양식에서 시작"은 지금도 된다.** 편집기는 HWP를 열면 그 파일의 스타일·여백·머리말/꼬리말(쪽 번호)을 그대로 쓴다. 양식 HWP를 열고 고친 뒤 **새 파일로 저장**하면 된다. 지금 당장은 [HWP 편집] → [파일 선택]으로 기기에 있는 양식을 고르면 되고, 버튼 하나로 열려면 **양식을 자료실에 한 번 올려 두는 방식**이 권한을 넓히지 않는 길이다.
2. **스타일 적용도 엔진·편집기에 이미 있다.** 편집기 위쪽 스타일 칸(드롭다운)과 F6 스타일 창이 열린 문서의 스타일 목록을 그대로 보여 주고 적용한다. 다만 **Ctrl+1~0 단축키는 편집기에 없다**(Ctrl+0은 오히려 "100% 보기"). 단축키와 큰 스타일 버튼을 붙이려면 편집기 칸막이 안에 Web2가 만든 작은 보조 스크립트를 하나 더 넣어야 한다(지금의 기기 저장 차단 스크립트와 같은 방식).
3. **Ctrl+숫자를 받는 것은 "전체 화면 + 키보드 잠금"으로 PC 크롬에서 가능성이 높지만 실기 시험이 필요하다.** 키보드 잠금은 Web2 화면(맨 바깥 창)에서만 걸 수 있고, 스크립트로 연 전체 화면일 때만 작동한다. 폰은 해당 없음 → 스타일 버튼.
4. **누름틀 채우기(HWP-서식변환)는 엔진은 되지만 지금 편집기 연결로는 안 된다.** 엔진에 "이름으로 누름틀 값 넣기"가 있으나, Web2가 칸막이 편집기에 보낼 수 있는 명령 목록에 없다. 편집기와 따로 **같은 엔진을 한 번 더 띄워 파일을 채운 뒤 편집기로 여는 방식**이 가장 덜 흔드는 길이다.
5. **Drive 권한은 넓히지 않아도 된다**(자료실 등록 방식). 사용자 Drive "공공운수노조"·"양식" 폴더의 파일을 Web2가 직접 읽으려면 권한 확대가 필요하므로 승인 사항으로만 적는다(5절).

## 2. rhwp 0.8.7 지원 범위

반입본은 세 층이다. ① 엔진(WASM, `@rhwp/core@0.8.7`) ② 편집기 화면(`rhwp-studio` 빌드) ③ Web2가 칸막이 밖에서 부르는 SDK(`@rhwp/editor@0.8.7`). 편집기 안 엔진 파일 `studio/assets/rhwp_bg-BkVWMBaR.wasm`은 npm `@rhwp/core@0.8.7`의 `rhwp_bg.wasm`과 SHA-256이 같다(`54cf9501…`, 이번 조사에서 대조). npm 최신도 0.8.7이다(2026-10-18 확인).

### 2.1 기능별 표

| 기능 | 엔진(WASM) | 편집기 화면 | Web2→편집기 연결(SDK) |
| --- | --- | --- | --- |
| 스타일 목록 읽기 | `getStyleList()` → `[{id,name,englishName,type,paraShapeId,charShapeId}]`, `getStyleDetail(id)`, `getStyleAt(sec,para)` | 스타일 칸(`#style-name`)을 `getStyleList()`로 채움, F6 스타일 창 | 없음 |
| 스타일 적용 | `applyStyle(sec,para,style_id)` | 명령 `format:apply-style` `{styleId}`(대화상자 없음) | `commands.execute('format:apply-style',{styleId})`로 **가능**(id를 알아야 함) |
| 스타일 만들기·고치기 | `createStyle`, `updateStyle`, `updateStyleShapes`, `deleteStyle` | F6 창에서 추가·편집·삭제 | 대화상자 명령이라 `allowDialog` 필요 |
| 문단·글자 모양 | `applyParaFormat`, `applyCharFormat`, `setParaShapeId`, `getParaPropertiesAt`, `getCharPropertiesAt` | Alt+T 문단 모양, Alt+L 글자 모양, 굵게·정렬 등 | 개별 명령 실행 가능(일부는 대화상자) |
| 쪽 설정(여백·용지) | `getPageDef(sec)`, `setPageDef(sec,json)`, `getSectionDef`/`setSectionDef` | `page:setup` 편집 용지(F7 계열) | 대화상자 명령 |
| 쪽 번호 | (머리말·꼬리말 필드로 저장) | `page:insert-field-pagenum`, `page:insert-field-totalpage`, `page:new-page-num` | 명령 실행 가능 |
| 누름틀 읽기 | `getFieldList()` → `[{fieldId,fieldType,name,guide,command,value,location}]`, `getFieldValueByName(name)` | 누름틀 표시·편집, 양식 모드(`view:form-mode`)에서 누름틀만 편집 | **없음** |
| 누름틀 채우기 | `setFieldValueByName(name,value)`, `setFieldValue(id,value)` | 사용자가 누름틀 칸에 직접 입력 | **없음** |
| 누름틀 넣기 | `insertClickHereField(…, guide, memo, name, editable)` | `insert:field`(Ctrl+K+E) | 대화상자 명령 |
| 글·문단 넣기 | `insertText`, `splitParagraph`, `insertParagraph`, `pasteHtml` | 입력·붙여넣기 | `applyTextCommand`(본문 글자 바꾸기 1건, 검증값 필요) |
| 새 문서 | `createBlankDocument()`(빈 문서), `new HwpDocument(bytes)`(기존 파일) | Alt+N 새 문서 | `loadFile(bytes,name)`로 **기존 HWP에서 시작 가능** |
| HWP 저장 | `exportHwp()` | 저장 | `exportHwp()` |

근거(엔진 형식 정의, npm `@rhwp/core@0.8.7`의 `rhwp.d.ts`): `applyStyle` 116행, `createStyle` 300행, `getFieldList` 915행(반환 형식 913행), `getFieldValueByName` 927행, `getPageDef` 1070행, `getStyleList` 1313행(반환 형식 1311행), `insertClickHereField` 1505행, `insertText` 1625행, `pasteHtml` 1822행, `setFieldValueByName` 2213행, `setPageDef` 2275행, `splitParagraph` 2360행. 같은 이름이 반입 WASM의 내보내기 목록(`hwpdocument_applyStyle`, `hwpdocument_setFieldValueByName` 등)에 있다.

근거(편집기 화면 `app/hwp-lab/rhwp-0.8.7/studio/assets/index-oVYSsgk_.js`, 한 줄로 압축된 파일이라 검색어로 표시):
- 스타일 칸: `initStyleDropdown(){…this.wasm.getStyleList()…}`, `setupStyleDropdown(){…dispatch(\`format:apply-style\`,{styleId:e})}`
- 명령 정의: `{id:\`format:apply-style\`,…execute(e,t){let n=t?.styleId;…applyStyle(n)}}` — `opensDialog` 없음
- F6: `{id:\`format:style-dialog\`,opensDialog:!0,…shortcutLabel:\`F6\`…}`
- 누름틀: `{id:\`insert:field\`,opensDialog:!0,…shortcutLabel:\`Ctrl+K+E\`…insertClickHereField(…)}`, `{id:\`view:form-mode\`…}`
- 단축키 표: `[{key:\`0\`,ctrl:!0},\`view:zoom-100\`]` — Ctrl+1~9 항목 없음, Alt+숫자 항목 없음

### 2.2 Web2가 칸막이 너머로 부를 수 있는 것

`app/hwp-lab/rhwp-0.8.7/sdk/index.js`의 `RhwpEditor`가 보내는 요청만 편집기가 받는다(편집기 쪽 처리 `case\`loadFile\`` … `default:throw Error(\`Unknown method\`)`).

- 쓸 만한 것: `loadFile`(149행), `exportHwp`(223행), `getDocumentState`, `getSelectionContext`, `applyTextCommand`, `focusTarget`, `commands.list/menuModel/isEnabled/execute/context`(389–402행).
- `commands.execute`는 대화상자를 여는 명령을 기본 거절한다(`needs-dialog`). `format:apply-style`은 대화상자가 없어 바로 된다.
- `hwpctrl`(한컴 웹기안기 호환 API, `PutFieldText` 등)은 SDK에 있으나(421행) **반입 빌드에서 뺐다**: `scripts/hwp-lab/build-rhwp-studio.sh:44` `RHWP_WITHOUT_HWPCTRL=1`. 편집기의 플러그인 허용 함수도 모든 플러그인을 거절한다(`async function BN(e){throw Error(\`허용되지 않은 플러그인: ${e}\`)}`).
- **스타일 목록·누름틀 목록·누름틀 값 넣기를 직접 묻는 요청은 없다.** 그래서 Web2 화면 쪽 버튼은 스타일 id를 스스로 알아낼 수 없다.

### 2.3 판단

- 스타일·문단·쪽 설정: 엔진과 편집기 화면 모두 충분하다. 양식 파일을 열면 그 파일의 스타일 10종·여백·쪽 번호가 그대로 쓰인다.
- 확인 필요(실물 시험): 노조 양식을 rhwp로 열어 저장한 HWP를 한컴오피스에서 열었을 때 스타일 이름·번호 문단·쪽 번호가 유지되는지. 저장 정확도는 `hwp-editor.md` 4절의 알려진 한계(글꼴 대체)와 같이 실물로만 판단할 수 있다.

## 3. 편집기에서 Ctrl+숫자 받기

| 항목 | 조사 결과 | 근거 |
| --- | --- | --- |
| 편집기 칸막이 | `sandbox="allow-scripts"` iframe(allow-same-origin 없음). 편집기에 초점이 있으면 키 입력은 iframe 안에서 처리되고 Web2 창은 그 키를 듣지 못한다 | `app/hwp-frame.js:22` |
| 편집기 기본 단축키 | Ctrl+1~9 없음, **Ctrl+0 = 100% 보기**(노조 양식의 Ctrl+0 중간대제목과 충돌) | 2.1절 단축키 표 |
| 일반 크롬 탭 | Ctrl+1~8·9는 크롬이 탭 전환으로 먼저 가져가 페이지가 막을 수 없다(원장 기록과 같음) | 원장 324행 |
| 키보드 잠금(Keyboard Lock) | `navigator.keyboard.lock([...])`. **맨 바깥 창(top-level)에서만** 호출 가능(아니면 `InvalidStateError`), **스크립트로 연 전체 화면일 때만** 작동, 사용자 클릭 직후 호출, HTTPS 필요. Esc 2초 길게 누르면 풀림. 크롬 계열 데스크톱 기능(실험 단계, Firefox·Safari 미지원) | MDN `Keyboard.lock()`, Chrome 개발자 문서 |
| 권한 창 | Chrome 130/131에 권한 창을 넣는다고 했다가 **출시하지 않기로 했다고** Chrome 블로그가 적고 있다. 버전에 따라 권한 창이 뜰 수 있다고 보고 시험한다 | Chrome 블로그 "Keyboard Lock and Pointer Lock permission" |
| 칸막이와의 관계 | 잠금은 Web2 창에서 건다(편집기 iframe은 top-level이 아님). 잠긴 키가 초점이 있는 iframe으로 전달되는지는 **실기 시험 필요** | — |
| 설치 앱 창 | Web2는 `display: standalone` 설치 정보가 있다(`app/windows-manifest.json`). 설치 창에는 탭이 없지만 Ctrl+숫자를 크롬이 계속 가로채는지는 문서로 확인되지 않아 **실기 시험 필요** | `app/index.html:14` |
| 폰 | 키보드 잠금 해당 없음. 스타일 버튼으로 대신 | — |

**받은 키를 스타일로 바꾸는 곳**: Web2 창은 iframe 안 키를 못 들으므로, 편집기 iframe 안에 Web2가 만든 보조 스크립트를 넣어야 한다. 지금도 `app/hwp-lab/studio-guard.js`를 빌드 마무리 단계에서 편집기 HTML 맨 앞에 넣고 있다(`scripts/hwp-lab/finalize-rhwp-studio.mjs:52`). 같은 방식으로:

- 보조 스크립트가 iframe 안에서 Ctrl+숫자(예비 Alt+숫자)를 먼저(capture 단계) 받아,
- 스타일 칸(`#style-name`)의 항목에서 **이름**(예: "큰 제목")으로 id를 찾고,
- 편집기 명령(`window.rhwpStudio.automation.execute('format:apply-style',{styleId})`)으로 적용한다. Ctrl+0은 100% 보기보다 먼저 가로챈다.
- 이름으로 찾기 때문에 양식에서 시작하지 않은 문서(그 스타일이 없는 문서)에서는 아무 일도 하지 않는다.
- 같은 스크립트가 폰용 스타일 버튼 줄(10개)도 iframe 안에 그릴 수 있다. Web2 화면 쪽에 버튼을 두려면 SDK에 스타일 목록 요청이 없어 id를 못 알아내므로 iframe 안이 맞다.
- 바뀌는 것: 빌드 마무리 스크립트·반입 해시(`SHA256SUMS`)·`tests/hwp-lab-pin.test.mjs`. 외부 연결 차단 CSP와 sandbox는 그대로다.

키보드 잠금은 Web2 창 쪽 코드(`app/hwp-lab.js`)에 [전체 화면] 버튼을 두고, 누르면 편집기 칸을 `requestFullscreen()` → `navigator.keyboard.lock(['Digit1',…,'Digit0'])`처럼 **숫자 키만** 잠근다. 모든 키를 잠그면 Ctrl+W 등도 막히므로 숫자만 잠근다.

## 4. 양식 파일 읽기 경로

### 4.1 지금 편집기가 Drive 파일을 여는 길

| 단계 | 내용 | 근거 |
| --- | --- | --- |
| 입구 | 자료실 ⋯ [편집] 또는 바구니 첨부 [편집] → 1회용 요청 → `?view=hwp` | `app/library-upload.js:178`, `app/hwp-drive.js:24-33` |
| 요청 | `document-actions` `hwp-open`에 `document_id`(자료실) 또는 `note_id`+`drive_file_id`(바구니) | `app/hwp-drive.js:55-73`, `supabase/functions/document-actions/index.ts:254-259` |
| 서버 확인 | DB의 `app_documents`(owner 확인) 또는 `app_notes` 첨부 목록에 있는 Drive 파일만 연다. 임의 Drive 파일 id는 받지 않는다 | `supabase/functions/_shared/hwp-edit.ts:115-160` |
| 열기 | 30MB까지, `headRevisionId`·`md5Checksum`과 함께 받아 `loadFile` | `hwp-edit.ts:37`, `app/hwp-lab.js:194-204` |
| 기기 파일 | [파일 선택]은 서버를 거치지 않고 바로 `loadFile` | `app/hwp-lab.js:127-139` |

### 4.2 Drive 권한

- Web2의 Drive 권한은 `drive.file` 하나다(`supabase/functions/public-policy-drive/index.ts:128`). **앱이 만든(올린) 파일만** 읽을 수 있다. 자세한 표는 [drive-tree-permission-check.md](drive-tree-permission-check.md) 1·3절.
- 그래서 사용자가 Drive 앱·PC에서 직접 넣은 "공공운수노조" 폴더의 양식 파일은 지금 권한으로 읽을 수 없다고 봐야 한다(`docs/basket-design.md:148`과 같은 판단).

### 4.3 방법안

| 안 | 방법 | 권한 변경 | 서버·DB 변경 | 판단 |
| --- | --- | --- | --- | --- |
| A0 | [HWP 편집] → [파일 선택]으로 기기에 저장한 양식을 연다 | 없음 | 없음 | **오늘 바로 가능.** 폰은 파일 앱에 양식이 있어야 함 |
| **A** | 양식을 **자료실에 한 번 등록**(분류 "양식" 또는 태그 "노조양식"). [HWP 편집]에 [노조 양식으로 새 문서] 버튼 → 그 자료를 `hwp-open`으로 열되 **[원본에 덮어쓰기]를 숨기고** [새 파일로 저장]만 둠 | 없음 | 없음(기존 `hwp-open`·`library-files` 그대로, 화면 코드만) | **추천.** 자료실 분류는 자유 입력 칸이라(`app/index.html:160`) DB 변경 없이 표시 가능 |
| B | Google Picker로 Drive의 양식 파일을 골라 앱에 열어 줌(`drive.file` 안에서 파일별 허락) | Google Cloud 설정·API 키 추가 | 외부 스크립트(apis.google.com) 반입 필요 | 비추천. 외부 스크립트·설정이 늘고 파일마다 다시 골라야 함 |
| C | 권한을 `drive.readonly`(또는 `drive`)로 넓혀 지정 폴더를 직접 읽음 | **확대(제한 권한, 경고 화면)** | Edge 배포 | 승인 사항. 양식 몇 개를 위해 넓히기엔 큼 |
| D | 양식을 저장소에 넣음 | — | — | **불가**(공개 저장소, `hwp-style-map.md` 1절) |

A안의 주의점:
- 양식 원본 보호: 양식으로 연 문서는 덮어쓰기 버튼을 숨기고, 새 파일 제목을 "노조 양식 (수정)"이 아니라 사용자가 정하는 제목으로 받는 것이 자연스럽다(`saveLibraryCopy`는 이미 `title`을 보낸다, `app/hwp-drive.js:85-97`).
- 양식이 바뀌면 사용자가 자료실의 양식 자료를 새 파일로 바꿔 등록한다.
- HWP-서식변환의 문서 종류별 양식(주간·상집·중집보고·공문)도 같은 방식으로 자료실에 "양식" 분류로 모으면 Drive "양식" 폴더 권한 문제가 사라진다(원장 325행의 "Drive '양식' 폴더에 모음"을 "자료실 '양식' 분류에 등록"으로 바꾸는 결정 필요).

## 5. 누름틀 채우기(HWP-서식변환)

- 엔진: 된다(`getFieldList`, `setFieldValueByName`, 2.1절).
- 편집기 연결: 안 된다(2.2절). `hwpctrl`은 빌드에서 뺐고 플러그인은 모두 거절한다.

방법안:

| 안 | 방법 | 바뀌는 것 | 판단 |
| --- | --- | --- | --- |
| **F1** | 편집기와 별도로 **같은 엔진**(`@rhwp/core` 0.8.7, 편집기와 같은 WASM)을 sandbox 칸막이(또는 전용 worker) 하나에 띄워: 양식 바이트 → `new HwpDocument(bytes)` → `getFieldList()`로 누름틀 이름 확인 → `setFieldValueByName` → 본문은 `insertText`·`splitParagraph`·`applyStyle`(스타일 이름→id는 `getStyleList`) → `exportHwp()` → 그 바이트를 편집기 `loadFile`로 열어 확인 | 엔진 접착 JS(`rhwp.js`, 약 450KB)를 반입본에 더함(지금 마무리 스크립트가 지움, `finalize-rhwp-studio.mjs:13`). 편집기 빌드는 그대로 | **추천.** 편집기 본체를 건드리지 않고, 채운 결과를 사람이 편집기에서 보고 저장 |
| F2 | 편집기를 `hwpctrl` 포함으로 다시 빌드(`RHWP_WITHOUT_HWPCTRL` 해제) → `plugins.load('hwpctrl')` → `PutFieldText` | 빌드 옵션·플러그인 허용 범위·반입 크기 | 보류. 외부 의존·허용 범위를 다시 검토해야 함 |
| F3 | 편집기 안 보조 스크립트(3절)가 누름틀을 채움 | `window.rhwpStudio`가 엔진 객체를 밖에 내놓지 않아 불가 | 불가 |

F1의 확인 필요 사항(착수 첫 단계 시험):
- 누름틀 값에 여러 줄을 넣을 때 문단이 나뉘는지, 그 문단에 누름틀 문단의 스타일이 이어지는지. 안 되면 누름틀은 제목·날짜 같은 한 줄 칸에만 쓰고, 본문은 누름틀 자리 뒤에 문단을 넣고 스타일을 입히는 방식(`insertText`·`splitParagraph`·`applyStyle`)으로 한다.
- 번호 단계(1. 1) (1) ① 가.)는 `hwp-style-map.md` 3절대로 스타일+기호 글자로 넣는다(양식이 번호 문단 자동 번호를 쓰는지 실물 확인).
- 엔진을 Web2 창에서 바로 돌리지 않는다. 지금 편집기처럼 칸막이 안에서 돌려 파일 내용 처리와 로그인 정보를 분리한다.

## 6. 추천 단계안

| 단계 | 내용 | 운영 변경 | 표시 |
| --- | --- | --- | --- |
| 0 | (사용자) 양식 HWP를 기기에서 [HWP 편집] → [파일 선택]으로 열어 고친 뒤 저장해 보고, 내보낸 HWP를 한컴에서 열어 스타일 10종·여백·쪽 번호가 유지되는지 확인 | 없음 | 📱 폰 가능 |
| 1 | **양식에서 시작**: 자료실 "양식" 분류 자료를 [노조 양식으로 새 문서]로 열기, 덮어쓰기 숨김, 새 파일 제목 입력 | 없음(화면 코드만) | 📱 폰 가능 |
| 2 | **스타일 버튼·단축키**: 편집기 iframe 안 보조 스크립트(이름으로 스타일 찾기, Ctrl+숫자·Alt+숫자, 폰용 버튼 줄) + Web2 창 [전체 화면] 버튼과 숫자 키만 키보드 잠금. PC 크롬 일반 창·전체 화면·설치 앱 창에서 실기 시험 | 없음(반입본 해시·검사 갱신) | 📱 폰 가능(PC 실기 시험은 사용자) |
| 3 | **HWP-서식변환 1차**: F1 방식으로 누름틀 채우기 + 본문 문단 넣기·스타일 입히기 → 편집기로 열기. 입력은 붙여 넣은 글부터 | 없음 | 📱 폰 가능 |
| 4 | HWP-서식변환 2차: OpenAI로 글감 정리, PDF·docx 읽기 | OpenAI 키(Edge 비밀값 등, 별도 정지 지점) | 별도 |

단계 1과 2는 서로 다른 파일 영역(1은 `app/hwp-lab.js`·`app/hwp-drive.js`, 2는 `scripts/hwp-lab/`·`app/hwp-lab/` 반입본)이라 나눠 진행할 수 있다.

## 7. 사용자 결정 필요 (일상어)

- **T1. 양식 파일을 어디에 둘까**
  - ① 자료실에 "양식" 분류로 한 번 올려 둔다 — **추천.** 권한을 넓히지 않고 지금 서버 그대로 쓴다. 양식이 바뀌면 다시 올린다.
  - ② Drive "양식" 폴더를 Web2가 직접 읽게 Drive 권한을 넓힌다. 이유: 폴더에 넣기만 하면 되지만 Google 경고 화면·재연결·Edge 배포가 필요하다(§6 정지 지점).
- **T2. 단축키**
  - ① Ctrl+숫자는 전체 화면+키보드 잠금(PC), 예비로 Alt+숫자를 항상 켠다 — **추천**(원장 1안 그대로).
  - ② Alt+숫자만 쓴다. 이유: 시험이 쉽지만 한글 습관(Ctrl+숫자)과 다르다.
- **T3. Ctrl+0**: 편집기의 "100% 보기"를 버리고 중간대제목으로 쓸지(추천: 양식 기준대로 중간대제목).
- **T4. 누름틀 채우기 방식**: F1(엔진을 따로 띄워 채운 뒤 편집기로 열기) — **추천** / F2(편집기 재빌드로 hwpctrl 켜기)는 보류.
- **T5. 단계 0 결과**: 노조 양식을 rhwp로 저장한 HWP가 한컴에서 멀쩡한지 사용자 확인 결과에 따라 단계 1 착수.

## 8. 남은 위험·확인 못 한 것

- 실물 양식으로 열기·저장 시험을 하지 않았다(양식 원본을 공개 저장소·조사 환경에 두지 않음).
- 키보드 잠금의 iframe 전달, 설치 앱 창의 Ctrl+숫자 처리, 권한 창 여부는 브라우저 문서로 확정되지 않아 실기 시험이 필요하다.
- 편집기 단축키 처리 순서(보조 스크립트가 capture 단계에서 먼저 받는지)는 착수 때 E2E로 확인한다.
- `setFieldValueByName`의 여러 줄 값 처리 방식은 공개 문서에 없어 시험이 필요하다.

## 참고(외부)

- Chrome 개발자 문서 "Capture Keys with the Keyboard Lock API": https://developer.chrome.com/docs/capabilities/web-apis/keyboard-lock
- Chrome 블로그 "The Keyboard Lock and the Pointer Lock APIs require permission": https://developer.chrome.com/blog/keyboard-lock-pointer-lock-permission
- MDN `Keyboard.lock()`: https://developer.mozilla.org/en-US/docs/Web/API/Keyboard/lock
- rhwp 공개 저장소 사본(README: hwpctl 호환 API, Field API): https://github.com/TomLeeLive/edwardkim-rhwp
