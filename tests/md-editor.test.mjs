import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// MD-편집기: 도구 막대 동작(md-editor-ops.mjs)과 [텔레그램용 복사] 변환(md-telegram.mjs)의 순수 함수 검사.
// 편집기 모듈이 바구니에 묶이지 않았는지(글·콜백만 받음), 새 외부 주소를 부르지 않는지도 본다.
const {applyAction, MERMAID_TEMPLATES, CALLOUT_KINDS} = await import('../app/md-editor-ops.mjs');
const {toTelegram, telegramInline, TELEGRAM_RULE, TELEGRAM_DIAGRAM} = await import('../app/md-telegram.mjs');
const {CALLOUTS} = await import('../app/markdown-render.mjs');
const {toHangul, levelMark, HANGUL_DIAGRAM} = await import('../app/md-hangul.mjs');

// Applies one toolbar action; returns the new text and the selected part.
function act(text, s, e, action, option) {
  const r = applyAction(text, s, e, action, option);
  const next = text.slice(0, r.from) + r.insert + text.slice(r.to);
  return {text: next, selected: next.slice(r.selStart, r.selEnd), caret: r.selStart};
}

test('inline marks wrap the selection, toggle off, and keep spaces outside', () => {
  assert.deepEqual(act('hello world', 0, 5, 'bold'), {text: '**hello** world', selected: 'hello', caret: 2});
  assert.deepEqual(act('**hello** world', 2, 7, 'bold'), {text: 'hello world', selected: 'hello', caret: 0});
  assert.deepEqual(act('**hello** world', 0, 9, 'bold'), {text: 'hello world', selected: 'hello', caret: 0});
  assert.equal(act('a word b', 1, 7, 'italic').text, 'a *word* b');
  assert.deepEqual(act('', 0, 0, 'bold'), {text: '**굵은 글**', selected: '굵은 글', caret: 2});
  // Italic inside bold is a new mark, not an unwrap of the bold.
  assert.equal(act('**x**', 2, 3, 'italic').text, '***x***');
});

test('line marks apply to every touched line and toggle off when all have them', () => {
  assert.equal(act('a\nb\nc', 0, 5, 'bullet').text, '- a\n- b\n- c');
  assert.equal(act('- a\n- b', 0, 7, 'bullet').text, 'a\nb');
  assert.equal(act('a\n\nb', 0, 4, 'number').text, '1. a\n\n2. b');
  assert.equal(act('- a\n- b', 0, 7, 'number').text, '1. a\n2. b');
  assert.equal(act('- [ ] a', 0, 0, 'task').text, 'a');
  assert.equal(act('a', 1, 1, 'task').text, '- [ ] a');
  assert.equal(act('인용', 0, 0, 'quote').text, '> 인용');
  // A selection ending at the start of the next line leaves that line alone.
  assert.equal(act('a\nb', 0, 2, 'bullet').text, '- a\nb');
  // Indentation stays in front of the mark.
  assert.equal(act('  하위', 0, 0, 'bullet').text, '  - 하위');
});

test('headings switch level on the caret line and keep the caret on its word', () => {
  assert.deepEqual(act('# 제목', 3, 3, 'heading', '2'), {text: '## 제목', selected: '', caret: 4});
  assert.equal(act('## 제목', 0, 0, 'heading', '2').text, '제목');
  assert.equal(act('제목', 0, 0, 'heading', '3').text, '### 제목');
  assert.deepEqual(act('', 0, 0, 'heading', '1'), {text: '# ', selected: '', caret: 2});
});

test('blocks go on their own lines after the caret line, never splitting a sentence', () => {
  const table = act('글 중간', 1, 1, 'table');
  assert.equal(table.text, '글 중간\n\n| 항목 | 내용 | 비고 |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |\n');
  assert.equal(table.selected, '항목');
  assert.equal(act('a\n\nb', 0, 0, 'rule').text, 'a\n\n---\n\nb');
  assert.equal(act('', 0, 0, 'rule').text, '---\n');
  const tip = act('', 0, 0, 'callout', 'TIP');
  assert.equal(tip.text, '> [!TIP]\n> 내용\n'); assert.equal(tip.selected, '내용');
  assert.equal(act('첫 줄\n둘째', 0, 6, 'callout', 'WARNING').text, '> [!WARNING]\n> 첫 줄\n> 둘째');
});

test('code is inline for part of a line and fenced otherwise', () => {
  assert.equal(act('run npm test now', 4, 12, 'code').text, 'run `npm test` now');
  assert.equal(act('a\nb', 0, 3, 'code').text, '```\na\nb\n```');
  const empty = act('', 0, 0, 'code');
  assert.equal(empty.text, '```\n코드\n```\n'); assert.equal(empty.selected, '코드');
});

test('three Mermaid templates and the same five callouts as the reader', () => {
  assert.deepEqual(Object.values(MERMAID_TEMPLATES).map(t => t.label), ['흐름도', '순서도', '타임라인']);
  assert.deepEqual(Object.values(MERMAID_TEMPLATES).map(t => t.body.split('\n')[0]), ['flowchart TD', 'sequenceDiagram', 'timeline']);
  for (const kind of Object.keys(MERMAID_TEMPLATES)) {
    const r = act('', 0, 0, 'mermaid', kind);
    assert.equal(r.text, '```mermaid\n' + MERMAID_TEMPLATES[kind].body + '\n```\n');
    assert.equal(r.selected, MERMAID_TEMPLATES[kind].body);
  }
  assert.deepEqual(CALLOUT_KINDS.map(([kind, label]) => [kind.toLowerCase(), label]), Object.entries(CALLOUTS));
});

test('Telegram copy: headings, emphasis, lists, checks, quotes, callouts, rules', () => {
  const md = ['# 주간 정리', '## **굵은** 제목 ##', '**굵게** 와 *기울임*, ~~취소~~, __밑줄식 굵게__, _기울임_', '- 첫째', '  - 하위', '* 별표', '1. 하나', '2) 둘', '- [ ] 할 일', '- [x] 끝난 일', '> 인용', '> 둘째 줄', '', '> [!CAUTION]', '> 조심', '> - 목록', '', '***', ''].join('\n');
  assert.equal(toTelegram(md), ['주간 정리', '굵은 제목', '굵게 와 기울임, 취소, 밑줄식 굵게, 기울임', '• 첫째', '  • 하위', '• 별표', '1. 하나', '2. 둘', '☐ 할 일', '☑ 끝난 일', '▎ 인용', '▎ 둘째 줄', '', '[주의]', '조심', '• 목록', '', TELEGRAM_RULE].join('\n'));
});

test('Telegram copy: tables become one line per row, code keeps its text, diagrams are left out', () => {
  const md = ['| 항목 | 담당 | 기한 |', '| :-- | :-: | --: |', '| 성명 | 홍보 | 10/20 |', '| 집회 |  | 10/25 |', '| a \\| b | **굵게** | |', '', '```js', 'const a = 1; // **그대로**', '```', '', '```mermaid', 'flowchart TD', 'A-->B', '```', '끝'].join('\n');
  assert.equal(toTelegram(md), ['항목: 성명, 담당: 홍보, 기한: 10/20', '항목: 집회, 기한: 10/25', '항목: a | b, 담당: 굵게', '', 'const a = 1; // **그대로**', '', TELEGRAM_DIAGRAM, '끝'].join('\n'));
});

test('Telegram copy: links, images, code spans, escapes and words with marks inside stay readable', () => {
  assert.equal(telegramInline('[기사](https://example.com/a "제목") <https://a.b/c>'), '기사 (https://example.com/a) https://a.b/c');
  assert.equal(telegramInline('[https://x.y/](https://x.y/)'), 'https://x.y/');
  assert.equal(telegramInline('![현장](https://img.example/p.png)'), '현장 (https://img.example/p.png)');
  assert.equal(telegramInline('`a*b*c` 와 `` `틱` ``'), 'a*b*c 와 `틱`');
  assert.equal(telegramInline('snake_case_name, 2*3*4, \\*별\\*, *a*'), 'snake_case_name, 2*3*4, *별*, a');
  assert.equal(telegramInline('가격 $5와 $10'), '가격 $5와 $10');
  // Blank-line runs shrink to one, trailing hard-break marks go.
  assert.equal(toTelegram('a  \nb\\\n\n\n\nc'), 'a\nb\n\nc');
  assert.equal(toTelegram(''), '');
});

test('the editor module is reusable: no basket imports, text and callbacks only, no outside address', () => {
  const src = readFileSync('app/md-editor.js', 'utf8');
  assert.doesNotMatch(src, /from '\.\/basket/);
  // UI-디자인손질 8: the optional save is the opener's own callback; the module itself still never saves or fetches.
  assert.match(src, /export function openMarkdownEditor\(\{text = '', title = '크게 쓰기', onInput = null, onClose = \(\) => \{\}, save = null, kinds = null\} = \{\}\)/);
  assert.doesNotMatch(src, /KPTURuntime|\.api\(|fetch\(/);
  for (const file of ['app/md-editor.js', 'app/md-editor-ops.mjs', 'app/md-telegram.mjs', 'app/md-hangul.mjs', 'app/md-editor.css']) {
    // The SVG namespace name (UI-키보드하단바 share icon) is not a request.
    assert.doesNotMatch(readFileSync(file, 'utf8').replaceAll("'http://www.w3.org/2000/svg'", ''), /https?:\/\/|\/\/cdn|@import/, file);
  }
  assert.doesNotMatch(src, /innerHTML|insertAdjacentHTML/);
});

// UI-키보드하단바: 폰 자판 감지는 accessibility-dialog.js 한 곳이 소유한다(하단 탭·팝업 아래 버튼·하단 입력·쓰기 창 공용).
test('one phone keyboard detector: accessibility-dialog owns the state, no other module measures the viewport for it', () => {
  const owner = readFileSync('app/accessibility-dialog.js', 'utf8');
  assert.match(owner, /classList\.toggle\('kptu-mobile-keyboard'/);
  assert.match(owner, /setProperty\('--kptu-keyboard-inset'/);
  assert.match(owner, /toggleAttribute\('data-keyboard-open'/);
  assert.match(owner, /keyboard:\{sync:syncKeyboard/);
  for (const file of ['app/topbar-actions.js', 'app/md-editor.js', 'app/home-quick.js', 'app/basket.js']) {
    const src = readFileSync(file, 'utf8');
    assert.doesNotMatch(src, /classList\.toggle\('kptu-mobile-keyboard'|setProperty\('--kptu-keyboard-inset'|data-keyboard-open/, file);
  }
});

test('editor head order and the bottom-tab leave question', () => {
  const src = readFileSync('app/md-editor.js', 'utf8');
  // × 닫기 → [메모|노트] → [쓰기|미리보기] → 내보내기 → 저장; the format row before the text.
  assert.match(src, /head\.append\(name, done, \.\.\.\(kindGroup \? \[kindGroup\] : \[\]\), modes, copy, \.\.\.\(saveButton \? \[saveButton\] : \[\]\)\)/);
  assert.match(src, /shell\.append\(head, bar, panes, status\)/);
  assert.match(src, /'저장 안 하고 닫을까요\?'/);
  assert.match(src, /\['stay', '계속 쓰기'\], \['leave', '저장 안 하고 이동'\]/);
  // Icon buttons keep their accessible names.
  assert.match(src, /button\('', \{mdExport: ''\}, '내보내기'\)/);
});

// MD-내보내기 8-11a [한글용 복사]: docs/hwp-style-map.md 3절 번호 체계(1. 1) (1) ① 가. 가) (가))·들여쓰기·굵게·표.
test('한글 copy: list levels follow the union numbering 1. 1) (1) ① 가. 가) (가), and (가) again past 7', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9].map(level => levelMark(level, 1)), ['1.', '1)', '(1)', '①', '가.', '가)', '(가)', '(가)', '(가)']);
  assert.deepEqual([2, 14, 15, 28, 29].map(n => levelMark(5, n)), ['나.', '하.', '거.', '허.', '29.']);
  assert.deepEqual([1, 20, 21, 35, 36, 50, 51].map(n => levelMark(4, n)), ['①', '⑳', '㉑', '㉟', '㊱', '㊿', '(51)']);
  const md = ['- 1단계', '  - 2단계', '    - 3단계', '      - 4단계', '        - 5단계', '          - 6단계', '            - 7단계', '              - 8단계', '- 다음 1단계', '  1. 번호도 같은 기호', '  2. 둘째'].join('\n');
  assert.equal(toHangul(md).text, ['1. 1단계', '  1) 2단계', '    (1) 3단계', '      ① 4단계', '        가. 5단계', '          가) 6단계', '            (가) 7단계', '              (가) 8단계', '2. 다음 1단계', '  1) 번호도 같은 기호', '  2) 둘째'].join('\n'));
});

test('한글 copy: numbering continues, restarts and keeps item bodies like the markdown list', () => {
  // An ordered list keeps its first number; going back up closes the deeper level; a blank line inside a list keeps it.
  assert.equal(toHangul(['3. 셋', '   - 가', '   - 나', '4. 넷', '', '   본문 줄', '- 다섯'].join('\n')).text,
    ['3. 셋', '  1) 가', '  2) 나', '4. 넷', '', '  본문 줄', '1. 다섯'].join('\n'));
  // A line right under an item is its body; a paragraph after a blank line ends the list, and the next list restarts.
  assert.equal(toHangul(['- 현황', '설명', '', '새 문단', '- 다시'].join('\n')).text, ['1. 현황', '  설명', '', '새 문단', '1. 다시'].join('\n'));
  // A heading ends the list. Check items sit at their level without a number. "* " is the 참고 줄 and keeps no number.
  assert.equal(toHangul(['- 하나', '## 둘째 절', '- 다시 하나', '  - [ ] 할 일', '  - [x] 끝난 일', '  - 하위', '* 참고 줄', '- 이어서'].join('\n')).text,
    ['1. 하나', '둘째 절', '1. 다시 하나', '  ☐ 할 일', '  ☑ 끝난 일', '  1) 하위', '* 참고 줄', '2. 이어서'].join('\n'));
});

test('한글 copy: title and headings are bold lines without numbers, bold stays only in the HTML', () => {
  const {text, html} = toHangul(['# 문서 제목', '## **소제목**', '본문 **굵게** 와 *기울임*, ~~취소~~, `코드`, __밑줄식__', '1. 항목 **강조**'].join('\n'));
  assert.equal(text, ['문서 제목', '소제목', '본문 굵게 와 기울임, 취소, 코드, 밑줄식', '1. 항목 강조'].join('\n'));
  assert.equal(html, ['<b>문서 제목</b>', '<b>소제목</b>', '본문 <b>굵게</b> 와 기울임, 취소, 코드, <b>밑줄식</b>', '1. 항목 <b>강조</b>'].map(l => `<p style="margin:0">${l}</p>`).join(''));
  // Indentation survives HTML paste as non-breaking spaces.
  assert.equal(toHangul('- a\n  - b').html, '<p style="margin:0">1. a</p><p style="margin:0">&nbsp;&nbsp;1) b</p>');
});

test('한글 copy: tables are real tables in HTML and tab rows in plain text', () => {
  const md = ['| 항목 | 담당 | 기한 |', '| :-- | :-: | --: |', '| **성명** | 홍보 | 10/20 |', '| a \\| b |  | 10/25 |'].join('\n');
  const {text, html} = toHangul(md);
  assert.equal(text, ['항목\t담당\t기한', '성명\t홍보\t10/20', 'a | b\t\t10/25'].join('\n'));
  const cell = 'border:1px solid #000;padding:2pt 4pt';
  assert.equal(html, `<table style="border-collapse:collapse"><tr><th style="${cell}">항목</th><th style="${cell}">담당</th><th style="${cell}">기한</th></tr>`
    + `<tr><td style="${cell}"><b>성명</b></td><td style="${cell}">홍보</td><td style="${cell}">10/20</td></tr>`
    + `<tr><td style="${cell}">a | b</td><td style="${cell}"><br></td><td style="${cell}">10/25</td></tr></table>`);
});

test('한글 copy: blank lines, quotes, callouts, rules, code and diagrams', () => {
  const F = '```';
  const md = ['', '첫 줄  ', '', '', '', '> 인용', '', '> [!WARNING]', '', '> [!TIP]', '> 팁 내용', '> 둘째', '', '***', '', F + 'js', '  const a = 1; // **그대로**', F, F + 'mermaid', 'flowchart TD', F, '끝', '', ''].join('\n');
  const {text, html} = toHangul(md);
  assert.equal(text, ['첫 줄', '', '* 인용', '', '* [경고]', '', '* [팁] 팁 내용', '* 둘째', '', '  const a = 1; // **그대로**', HANGUL_DIAGRAM, '끝'].join('\n'));
  assert.match(html, /<p style="margin:0">&nbsp;&nbsp;const a = 1; \/\/ \*\*그대로\*\*<\/p>/);
  // One blank paragraph per blank run, none at the ends.
  assert.equal(html.split('<br></p>').length - 1, 4);
  assert.ok(html.startsWith('<p style="margin:0">첫 줄</p>'));
  assert.deepEqual(toHangul(''), {text: '', html: ''});
  assert.deepEqual(toHangul('\n\n'), {text: '', html: ''});
});

test('한글 copy: special characters stay as written in text and are escaped in HTML; the words are never changed', () => {
  const md = '- <script>alert(1)</script> & "따옴표" \'작은\' \\*별\\* 2*3*4 snake_case $5 ※ ○ · ─ 회의를 진행함.\n- [기사](https://example.com/a?b=1&c=2) ![현장](https://img.example/p.png)';
  const {text, html} = toHangul(md);
  assert.equal(text, '1. <script>alert(1)</script> & "따옴표" \'작은\' *별* 2*3*4 snake_case $5 ※ ○ · ─ 회의를 진행함.\n2. 기사 (https://example.com/a?b=1&c=2) 현장 (https://img.example/p.png)');
  assert.equal(html, '<p style="margin:0">1. &lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;따옴표&quot; &#39;작은&#39; *별* 2*3*4 snake_case $5 ※ ○ · ─ 회의를 진행함.</p>'
    + '<p style="margin:0">2. 기사 (https://example.com/a?b=1&amp;c=2) 현장 (https://img.example/p.png)</p>');
  assert.doesNotMatch(html, /<script|<a |<img/);
  // Mark-like characters typed in the text cannot open a bold tag.
  assert.equal(toHangul('a b').html, '<p style="margin:0">a b</p>');
});

test('Telegram copy is unchanged by the shared bold marks', () => {
  assert.equal(toTelegram('**굵게** __굵게__ ***둘 다***'), '굵게 굵게 둘 다');
  assert.doesNotMatch(toTelegram('| **a** | b |\n| - | - |\n| **c** | d |'), /[-]/);
});
