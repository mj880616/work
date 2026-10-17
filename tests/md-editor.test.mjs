import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// MD-편집기: 도구 막대 동작(md-editor-ops.mjs)과 [텔레그램용 복사] 변환(md-telegram.mjs)의 순수 함수 검사.
// 편집기 모듈이 바구니에 묶이지 않았는지(글·콜백만 받음), 새 외부 주소를 부르지 않는지도 본다.
const {applyAction, MERMAID_TEMPLATES, CALLOUT_KINDS} = await import('../app/md-editor-ops.mjs');
const {toTelegram, telegramInline, TELEGRAM_RULE, TELEGRAM_DIAGRAM} = await import('../app/md-telegram.mjs');
const {CALLOUTS} = await import('../app/markdown-render.mjs');

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
  for (const file of ['app/md-editor.js', 'app/md-editor-ops.mjs', 'app/md-telegram.mjs', 'app/md-editor.css']) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /https?:\/\/|\/\/cdn|@import/, file);
  }
  assert.doesNotMatch(src, /innerHTML|insertAdjacentHTML/);
});
