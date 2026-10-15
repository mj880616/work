# 마크다운 표시(MD-표시) 기준

원장 행: `MD-표시`, `MD-표시보완`. 공용 표시 모듈을 먼저 바구니 메모 읽기 화면에 적용했고, 이후 일지·노트(JOURNAL·MEMO)에서 그대로 재사용한다.

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
- [원문 그대로 보기]를 누르면 저장된 글을 한 글자도 바꾸지 않고 보이며, [정리해서 보기]로 돌아간다. 선택은 기억하지 않는다(메모를 열 때마다 정리된 보기).
- 수정 화면은 그대로 일반 글 입력이다. 원문 데이터·저장 방식은 바뀌지 않는다.

## 5. 올리는 순서

1. `scripts/markdown/md-pin.json`의 `version`·`integrity`(`npm view <패키지>@<버전> dist.integrity`)를 고친다.
2. `node scripts/markdown/vendor-markdown.mjs` → `app/markdown-lib/`가 다시 만들어진다. 한 번 더 실행해 `SHA256SUMS`가 같은지(재현) 본다.
3. `app/markdown-view.js`의 `MARKDOWN_LIBS` 경로를 새 버전으로 바꾸고, `markdown-view.js?v=`부터 캐시 버전 연쇄를 올린다(`AGENTS.md` 4절).
4. `node --test tests/markdown-view.test.mjs`, `npx playwright test tests/app-e2e/markdown-view.spec.mjs tests/app-e2e/basket-view-mode.spec.mjs`(390·1280 표시, Mermaid, 외부 요청 0, 원문 전환).
5. 원장 `MD-표시` 행과 이 문서 1절을 같은 PR에서 고친다.

## 6. 재사용(일지·노트)

```js
import { renderMarkdownInto, showPlainText, preloadMarkdown } from './markdown-view.js?v=2';
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
