import test from 'node:test';
import assert from 'node:assert/strict';
// [텔레그램용 복사] 변환(md-telegram.mjs)의 순수 함수 검사. 옛 글자 노트·바구니 복사(basket.js·note-preview.mjs)가 아직 쓴다.
const {toTelegram, telegramInline, TELEGRAM_RULE, TELEGRAM_DIAGRAM} = await import('../app/md-telegram.mjs');

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

test('Telegram copy is unchanged by the shared bold marks', () => {
  assert.equal(toTelegram('**굵게** __굵게__ ***둘 다***'), '굵게 굵게 둘 다');
  assert.doesNotMatch(toTelegram('| **a** | b |\n| - | - |\n| **c** | d |'), /[-]/);
});
