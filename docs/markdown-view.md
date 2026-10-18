# 마크다운 표시(MD-표시) 기준

원장 행: `MD-표시`, `MD-표시보완`, `MD-편집기`. 공용 표시 모듈을 먼저 바구니 메모 읽기 화면에 적용했고, 이후 일지·노트(JOURNAL·MEMO)에서 그대로 재사용한다.

## 1. 지금 고정한 버전

| 항목 | 값 |
| --- | --- |
| 버전(한 곳에서 관리) | `scripts/markdown/md-pin.json` |
| 마크다운 | npm `markdown-it@15.0.2` (MIT) — `markdown-it.esm.min.mjs` |
| 정화 | npm `dompurify@3.4.16` (MPL-2.0 또는 Apache-2.0) — `purify.es.mjs` |
| 도식 | npm `mermaid@11.17.2` (MIT) — `mermaid.min.js` 한 파일 |
| 수식 | npm `katex@0.18.10` (MIT) — `katex.min.js`·`katex.min.css`·woff2 글꼴 |
| 반입 위치 | `app/markdown-lib/<패키지>-<버전>/`(각 `LICENSE`), 출처·sha512 `SOURCE.md`, 파일 해시 `SHA256SUMS` |
| 총 크기 | 30개 · 4.18 MiB(Mermaid 3.41 MiB, KaTeX 0.53 MiB, markdown-it 0.13 MiB, DOMPurify 0.09 MiB) |

- 고른 기준: 2026-10-15 기준 공개된 지 2주가 지난 최신 안정판. Mermaid는 갓 나온 12.x 대신 11.x 마지막 판을 썼다.
- `tests/markdown-view.test.mjs`가 pin 버전·반입 폴더·`app/markdown-view.js` 경로·`SOURCE.md`가 서로 같은지, 반입 파일이 `SHA256SUMS`와 같은지(직접 고치지 않았는지), 총 크기가 10MB 미만인지 매번 검사한다.

## 2. 불러오는 시점

- 바구니 화면에 들어오거나 메모를 열 때: markdown-it·DOMPurify(약 0.2 MiB).
- 수식이 있는 글을 열 때만: KaTeX. 도식이 있는 글을 열 때만: Mermaid.
- 다른 화면(홈·일정·할 일 등)은 어떤 라이브러리도 받지 않는다. `loadAll`이 바구니 모듈을 미리 불러와도 라이브러리는 받지 않는다.
- 모두 같은 주소(`/app/markdown-lib/`)에서 받는다. CDN·외부 주소는 쓰지 않는다.

## 3. 안전 규칙

- 글 속 HTML·스크립트는 실행하지 않는다: markdown-it `html:false`로 글자로만 보이고, 결과는 DOMPurify(허용 태그·속성 목록)로 한 번 더 걸러 DOM 조각으로 넣는다(문자열 재해석 없음).
- 링크는 `http:`·`https:`·`mailto:`만 링크가 되고, 모두 `target="_blank" rel="noopener noreferrer"`로 연다. `javascript:`·`data:`·상대 주소 등은 글자로 남는다.
- 글 속 이미지는 불러오지 않는다: 안전한 주소면 `이미지: 설명` 링크, 아니면 글자. 그림이 2개 이상 연달아 나오면(사이에 빈칸·줄바꿈·그림만 있는 문단만) "🖼 이미지 N개" 칩 하나로 접고, 칩을 누를 때만 그 그림(http·https만, referrer 없음)을 불러온다(7절).
- 표 칸 정렬(`text-align`) 외의 style 속성은 지운다. 체크박스는 항상 `disabled`(누를 수 없음)다.
- Mermaid: `securityLevel:'strict'`(글 속 HTML은 글자로, 클릭 동작 끔), `htmlLabels:false`. 글 안 `%%{init}%%` 지시문으로 보안 수준·HTML 글자·테마 CSS를 바꾸지 못하게 `secure`에 넣었다. 결과 SVG는 DOMPurify SVG 정화 후 `<a>`·`<image>`·`<foreignObject>`·스크립트를 지우고, `#` 내부 참조가 아닌 주소(href·url()·@import)는 모두 지운다.
  - `sandbox` 수준(iframe 안에 그림)은 쓰지 않았다: 결과가 iframe이라 SVG를 정화할 수 없고, 화면에 iframe을 하나 더 들이게 된다. strict + 결과 SVG 정화가 이 화면에서는 더 엄격하다.
- KaTeX: `trust:false`(`\href`·`\url`·`\includegraphics` 등 외부 연결 명령 끔), `throwOnError:false`. 결과도 DOMPurify로 거른다.
- 그리지 못한 도식은 원문 코드와 "도식을 그리지 못해 원문을 그대로 보여 줍니다."를 보인다.

## 4. 바구니 메모 적용

- 읽기 화면의 원문 칸(`[data-basket-read-text]`)을 마크다운으로 그린다. 그리는 곳은 `basket.js`의 `paintReadText` 하나다.
- 메모의 [⋯] 메뉴에서 [원문 그대로 보기]를 누르면 저장된 글을 한 글자도 바꾸지 않고 보이며, [정리해서 보기]로 돌아간다. 선택은 기억하지 않는다(메모를 열 때마다 정리된 보기).
- 수정 화면은 그대로 일반 글 입력이다. 원문 데이터·저장 방식은 바뀌지 않는다. [큰 창에서 수정](옛 [크게 쓰기])은 같은 글을 전체 화면 편집기로 연다(8절).

## 5. 올리는 순서

1. `scripts/markdown/md-pin.json`의 `version`·`integrity`(`npm view <패키지>@<버전> dist.integrity`)를 고친다.
2. `node scripts/markdown/vendor-markdown.mjs` → `app/markdown-lib/`가 다시 만들어진다. 한 번 더 실행해 `SHA256SUMS`가 같은지(재현) 본다.
3. `app/markdown-view.js`의 `MARKDOWN_LIBS` 경로를 새 버전으로 바꾸고, 캐시 버전(`?v=`)은 손으로 올리지 않는다. Pages 배포 빌드가 내용 해시로 붙인다(`AGENTS.md` 4절).
4. `node --test tests/markdown-view.test.mjs`, `npx playwright test tests/app-e2e/markdown-view.spec.mjs tests/app-e2e/basket-view-mode.spec.mjs`(390·1280 표시, Mermaid, 외부 요청 0, 원문 전환).
5. 원장 `MD-표시` 행과 이 문서 1절을 같은 PR에서 고친다.

## 6. 재사용(일지·노트)

```js
import { renderMarkdownInto, showPlainText, preloadMarkdown } from './markdown-view.js';
// 칸 하나의 표시 담당 모듈이 직접 부른다. isCurrent는 계정·대상이 바뀐 뒤 도착한 결과를 버린다.
await renderMarkdownInto(el, text, { isCurrent: () => owner === scope() });
showPlainText(el, text); // 원문 그대로
```

모양은 `app/markdown-view.css`(`.md-body`)다. 그 화면의 css 목록(`view-loader.js`)에 함께 넣는다. 순수 변환은 `app/markdown-render.mjs`(DOM 없음, Node 검사 가능)다.

## 7. ChatGPT 화면 보완(MD-표시보완)

ChatGPT 화면의 카드·그림 상자·도식은 복사·붙여넣기로 모양이 넘어오지 않는다. 그래서 두 경로를 둔다. 순수 판별은 `app/chatgpt-html.mjs`(Node 검사 가능), 칸막이는 `app/html-frame.js`다.

| 기능 | 동작 | 안전 |
| --- | --- | --- |
| 이미지 칩 | 연달아 나오는 그림 2개 이상 → "🖼 이미지 N개" 칩. 누르면 그림, 다시 누르면 접힘 | 누르기 전 외부 요청 0건. 하나라도 안전하지 않은 주소면 접지 않고 기존 규칙(링크·글자) |
| 강조 상자 | `> [!NOTE]`·`[!TIP]`·`[!IMPORTANT]`·`[!WARNING]`·`[!CAUTION]`(첫 줄이 표시만일 때) → 참고·팁·중요·경고·주의 색 상자 | 테마 토큰 색만, 표시 글자는 고정 문구 |
| 공유 링크 카드 | 원문에 `https://chatgpt.com/share/<id>`가 있으면 읽기 화면 위에 "ChatGPT 원본 보기" 카드(최대 5개), 새 창 | 정확한 형식만(https, 호스트 `chatgpt.com`, 포트·계정 없음, `/share/<id>`만). 서버가 그 페이지를 가져오지 않음(제목 미리보기 없음) |
| [ChatGPT용 요청 복사] | 바구니 목록 입력칸 아래. 고정 문구를 복사 | 복사 실패 시 문구를 안내 |
| HTML 붙여넣기 | 홈 빠른 입력·바구니 입력(바구니 모드)에 완전한 HTML 문서(`<!doctype html>`로 시작, `<html>…</html>`, 또는 그런 문서 하나를 담은 ```html 블록)를 붙여 넣으면 `chatgpt-YYYYMMDD-HHmm.html` 첨부로 바꾸고 글에는 "📄 ChatGPT HTML"만 남김. [추가]를 눌러야 저장 | 기존 첨부 업로드(`basket-files`) 그대로. 2MB 초과는 붙여 넣지 않고 안내 |
| HTML 첨부 보기 | 메모 읽기 화면 원문 아래에 .html 첨부를 칸막이로 표시, 높이 자동, [크게 보기](화면 전체, Esc·[작게 보기]로 복귀) | 아래 표 |

칸막이 규칙:

- `<iframe sandbox="allow-scripts" referrerpolicy="no-referrer" srcdoc>`. allow-same-origin·forms·popups·top-navigation은 넣지 않는다 → 문서 origin은 `null`, Web2의 parent·top·localStorage·sessionStorage·쿠키·로그인 정보에 닿지 못함. 폼 제출·새 창·최상위 이동 불가.
- 문서 맨 앞(doctype 바로 뒤)에 CSP를 붙인다: `default-src 'none'`, 인라인 스타일·스크립트, `data:` 이미지·글꼴만. `connect-src`·`frame-src`·`object-src`·`form-action`·`base-uri` 모두 `'none'`. 외부 글꼴·스크립트·그림을 부르는 HTML은 그 부분만 빠진 채 보이고 Web2에는 영향이 없다.
- 높이는 칸막이 안 스크립트가 보낸 숫자만, 보낸 창이 그 iframe일 때만 받는다(120~20000px).
- 칸막이 문서가 스스로 다른 주소로 이동하면(두 번째 load) 즉시 닫고 [다시 보기]를 보인다. 브라우저는 자기 칸 안의 이동 요청 자체를 막는 수단이 없어, 이동 요청이 한 번 나갈 수는 있다(남은 위험). 이때도 Web2 정보는 칸 안에 없다.
- 내용은 `document-actions` `html-view`로 받는다: 로그인 사용자 JWT, 업무 공간 소유자 확인, 메모·첨부는 서버가 DB에서 찾음(클라이언트가 준 파일 ID는 그 메모의 첨부일 때만), 이름이 `.html`·`.htm`, Drive 원본 2MB 이하·내 소유·휴지통 아님. 읽기만 하며 Drive·DB에 쓰지 않는다. 서버가 아직 이 동작을 모르면 "HTML 보기 서버가 아직 준비되지 않았어요"를 보인다.

## 8. 전체 화면 편집기(MD-편집기 1단계)

바구니 메모 수정 화면의 [큰 창에서 수정](옛 [크게 쓰기])과 메뉴 [쓰기](UI-디자인손질 8)가 전체 화면 마크다운 편집기를 연다. 화면은 `app/md-editor.js` 하나가 그리고(모양 `app/md-editor.css`), 도구 막대 동작은 `app/md-editor-ops.mjs`, [텔레그램용 복사] 변환은 `app/md-telegram.mjs`(둘 다 DOM 없음, `tests/md-editor.test.mjs`)다.

- 여는 쪽은 글과 콜백만 넘긴다. 편집기는 스스로 저장하지 않는다. 메뉴 [쓰기]는 `save: {label, aria, run}`을 넘겨 머리줄에 채운 [저장]을 더하고, `run(text)`은 바구니 빠른 입력과 같은 `createNote`(새 메모 1개)를 부른 뒤 `{ok:true}`면 편집기가 닫힌다. 실패하면 편집기 아래 상태 줄에 이유를 보이고 글은 그대로 둔다. 저장하지 않고 닫으면 글은 그 탭 메모리에만 남아 다음 [쓰기]에서 이어진다. 바구니는 고칠 때마다 수정 칸에 같은 글을 넣고(`onInput`), 닫으면 수정 칸으로 돌아가 기존 [수정 저장]·[취소] 흐름을 그대로 쓴다. 새 저장 경로·DB 변경 없음.
- 닫기: [닫기]·Esc·뒤로 가기(폰·PC, `mobile-modal-history.js`). 어느 쪽이든 글은 수정 칸에 남는다. 메모 화면이 닫히면(계정 바뀜·다른 화면) 편집기도 글을 돌려주지 않고 닫힌다.
- 도구 막대: 제목(1~3단계)·굵게·기울임·글머리·번호·체크·표 틀·인용·코드·강조 상자(5종)·구분선·Mermaid 틀(흐름도·순서도·타임라인)·되돌리기·다시하기. 선택한 글을 감싸거나 줄 앞에 기호를 넣는다(보이는 그대로 편집기 아님). 같은 버튼을 다시 누르면 기호를 뺀다. 표·구분선 등 덩어리는 커서가 있는 줄 다음에 빈 줄을 두고 넣는다.
- 바꾸기는 `execCommand('insertText')`로 해서 브라우저 기본 되돌리기(Ctrl+Z, [되돌리기])에 함께 남는다. Ctrl+B·Ctrl+I도 된다.
- 배치(UI-키보드하단바, 폰·PC 같음): 위에서부터 머리줄 한 줄 [× 닫기] [메모|노트](메뉴 [쓰기]의 새 글만) [쓰기 | 미리보기](1023px 이하) … [내보내기 아이콘] [저장](메뉴 [쓰기]만) → 서식 도구줄(폰은 한 줄 가로 스크롤, 버튼 44px) → 본문. 닫기·내보내기는 아이콘이고 이름(aria-label)은 그대로이며, 머리줄 버튼은 보이는 높이 32px·누르는 범위 44px. 폰(760px 이하)은 앱 공용 하단 탭 6칸 위에서 끝나고, 자판이 열리면 탭이 숨어 본문이 자판 바로 위까지 쓴다(`interactive-widget=resizes-content`, 미지원 브라우저는 `--kptu-keyboard-inset`). 1024px 이상은 글·미리보기 나란히(입력 0.3초 뒤 갱신).
- 하단 탭(폰): 탭을 누르면 편집기를 먼저 닫고 그 탭으로 간다. 메뉴 [쓰기]에 글이 있으면 공용 고르기 시트로 "저장 안 하고 닫을까요?" [계속 쓰기]·[저장 안 하고 이동]을 묻고(빈 글은 바로 이동, [저장 안 하고 이동]한 글은 기존 [닫기]처럼 이 탭 메모리에 남음), 고치기로 연 편집기는 글을 수정 칸에 돌려준 뒤 그 화면의 기존 나가기 확인을 따른다.
- 미리보기는 `renderMarkdownInto`(3절 안전 규칙·외부 요청 0 그대로)다. 새 외부 라이브러리·CDN 없음.

[텔레그램용 복사] 변환 규칙(저장된 글은 바꾸지 않고 복사본만 바꾼다):

| 마크다운 | 텔레그램용 글 |
| --- | --- |
| `# 제목`(1~6단계) | `제목` (기호만 빼고 한 줄, 굵게 없음) |
| `**굵게**`·`__굵게__`·`*기울임*`·`_기울임_`·`~~취소~~` | 기호 없이 글자만 |
| `` `코드` `` | 글자만 |
| `- 항목`·`* 항목`·`+ 항목` | `• 항목` (들여쓰기 유지) |
| `1. 항목`·`1) 항목` | `1. 항목` |
| `- [ ] 할 일` / `- [x] 끝난 일` | `☐ 할 일` / `☑ 끝난 일` |
| `> 인용` | `▎ 인용` |
| `> [!NOTE]` 등 강조 상자 | 첫 줄 `[참고]`·`[팁]`·`[중요]`·`[경고]`·`[주의]`, 내용 줄은 `>` 없이 |
| `---`·`***`·`___` | `──────────` |
| 표 | 줄마다 한 문장: `머리말: 값, 머리말: 값` (빈 칸은 뺌, 구분 줄 없음) |
| 코드 블록(```` ``` ````) | 울타리 줄만 빼고 내용은 그대로 |
| Mermaid 블록 | `(도식은 텔레그램에서 보이지 않아 뺐습니다)` |
| `[글](주소)` / `<주소>` / 글과 주소가 같은 링크 | `글 (주소)` / `주소` / `주소` |
| `![설명](주소)` | `설명 (주소)` (설명이 없으면 `이미지 (주소)`) |
| `\*` 같은 escape, 줄 끝 두 칸·`\` 줄바꿈 | 기호만 남김 / 지움 |
| 빈 줄 여러 개 | 빈 줄 하나 |
| 수식 `$…$`, 낱말 속 `snake_case`·`2*3*4` | 그대로 |

재사용(일지·노트):

```js
import { openMarkdownEditor } from './md-editor.js';
const editor = openMarkdownEditor({ text: field.value, title: '노트 크게 쓰기',
  onInput: value => { field.value = value; },      // 선택
  onClose: value => { field.value = value; field.focus(); } });
editor.close({ silent: true }); // 여는 쪽 화면이 사라질 때(글을 돌려주지 않음)
// 새 글 저장(메뉴 [쓰기]): save.run은 여는 쪽의 기존 저장을 부르고 {ok:true} 또는 {ok:false,message}를 돌려준다.
// openMarkdownEditor({ title: '쓰기', save: { label: '저장', aria: '바구니에 새 메모로 저장', run: async text => { await createNote({ raw_text: text }); return { ok: true }; } } });
```

모양 `md-editor.css`와 미리보기 모양 `markdown-view.css`를 그 화면의 css 목록(`view-loader.js`)에 함께 넣는다.
