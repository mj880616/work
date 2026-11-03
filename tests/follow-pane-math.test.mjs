import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// UI-상세칸고정(2026-11-03, S49-8): 붙은 옆 칸(.kptu-follow-pane)은 화면 위쪽에 제자리(sticky)이고, 길면 그 칸만 스크롤한다.
// 모양은 desktop-ui.css 한 곳이 정하고 follow-pane.js는 이름과 --follow-top만 정한다(스크롤에 따라 움직이는 계산 없음).
const css = readFileSync(new URL('../app/desktop-ui.css', import.meta.url), 'utf8');
const js = readFileSync(new URL('../app/follow-pane.js', import.meta.url), 'utf8');
const rule = css.match(/\.kptu-follow-pane\{[^}]*\}/)?.[0] ?? '';

test('붙은 칸은 위쪽에 sticky, 화면보다 길면 칸 안에서만 스크롤', () => {
  assert.match(rule, /position:sticky/);
  assert.match(rule, /top:var\(--follow-top,12px\)/);
  assert.match(rule, /max-height:calc\(100dvh - var\(--follow-top,12px\) - 12px\)/);
  assert.match(rule, /overflow-y:auto/);
});
test('follow-pane.js는 스크롤을 듣지 않고 이름과 위 자리만 정한다', () => {
  assert.doesNotMatch(js, /addEventListener\(/);
  assert.match(js, /classList\.add\('kptu-follow-pane'\)/);
  assert.match(js, /--follow-top/);
});
