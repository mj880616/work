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
  assert.match(rule, /max-height:var\(--follow-max,calc\(100dvh - var\(--follow-top,12px\) - 12px\)\)/);
  assert.match(rule, /overflow-y:auto/);
});
test('follow-pane.js는 칸 이름·위 자리·최대 높이 값만 정한다(칸 위치를 옮기는 계산 없음)', () => {
  assert.doesNotMatch(js, /scrollBy\(.*top: *over[^)]*\)[\s\S]*scrollTo/);
  assert.match(js, /--follow-max/);
  assert.match(js, /classList\.add\('kptu-follow-pane'\)/);
  assert.match(js, /--follow-top/);
});

import {followMax} from '../app/follow-pane.js';
test('followMax: 붙기 전에는 칸이 있는 자리 아래로, 붙은 뒤에는 위 자리 기준', () => {
  assert.equal(followMax({view: 800, top: 12, rectTop: 140}), 648);
  assert.equal(followMax({view: 800, top: 12, rectTop: 12}), 776);
  assert.equal(followMax({view: 800, top: 12, rectTop: -300}), 776);
  assert.equal(followMax({view: 300, top: 12, rectTop: 280}), 160);
});
