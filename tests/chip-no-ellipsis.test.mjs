import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// UI-표잘림전수: 작은 표·칩 안 글자는 '…'로 자르지 않는다(줄여야 하면 옆 본문 제목을 자른다, 폰은 줄바꿈).
// 아래 표는 그 규칙을 지키는 칩이다. 일부러 자르는 곳(제목·본문·고정 폭 표)은 docs가 아니라 PR 본문 예외 표에 있다.
const CHIPS = [
  ['app/feed.css', '.feed-view .feed-org'],
  ['app/google-tasks.css', '#appView #tasksView #gtTaskSection.gt-pc .gt-card .gt-tag'],
  ['app/meeting-ui.css', '#meetingList .meeting-list-title .badge'],
  ['app/suborganizations.css', '.so-stage-tag'],
  ['app/basket.css', '#appView #basketView button.inbox-todo-source'],
  ['app/base-ui.css', '.user-badge'],
];
const rulesOf = (css, selector) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(m => m[1].split(',').some(s => s.trim() === selector)).map(m => m[2]);

for (const [file, selector] of CHIPS) {
  test(`${selector}: '…'로 자르지 않는다`, () => {
    const rules = rulesOf(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), selector);
    assert.ok(rules.length > 0, `${file}에서 ${selector} 규칙을 찾지 못함`);
    for (const body of rules) {
      assert.doesNotMatch(body, /text-overflow\s*:\s*ellipsis/, `${selector} 에 text-overflow:ellipsis`);
      assert.doesNotMatch(body, /overflow\s*:\s*hidden/, `${selector} 에 overflow:hidden`);
    }
  });
}
