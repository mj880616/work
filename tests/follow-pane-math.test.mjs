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

// BIZ-결과칸작음(11/10): 칸 자리가 스크롤 없이 바뀔 때(위쪽 주간보고 접기·펼치기, 목록 다시 그림)도 최대 높이를 다시 잰다.
import {watchTargets} from '../app/follow-pane.js';
test('watchTargets: 화면 묶음(.view-panel, 없으면 body)과 칸 바로 위 틀을 한 번씩 본다', () => {
  const body = {name: 'body'}, view = {name: 'view'}, parent = {name: 'layout'};
  const pane = {parentElement: parent, ownerDocument: {body}, closest: sel => (sel === '.view-panel' ? view : null)};
  assert.deepEqual(watchTargets(pane), [view, parent]);
  const loose = {parentElement: body, ownerDocument: {body}, closest: () => null};
  assert.deepEqual(watchTargets(loose), [body]);
  assert.deepEqual(watchTargets(null), []);
});
test('크기 변화는 ResizeObserver 한 곳에서 스크롤·창 크기와 같은 queue로 다시 잰다(기다림 시간 없음)', () => {
  assert.match(js, /new ResizeObserver\(queue\)/);
  assert.match(js, /listen\(\); watch\(el\); paint\(el, at\)/);
  assert.match(js, /sizes\?\.unobserve\(node\)/);
  assert.doesNotMatch(js, /setTimeout/);
});
