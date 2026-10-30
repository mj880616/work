import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {noticeMs,noticeText,noticeHost,NOTICE_MS,NOTICE_UNDO_MS,NOTICE_ERROR_MS} from '../app/small-notice.js';

test('작은 알림 시간: 기본·되돌리기·오류·직접 지정', () => {
  assert.equal(noticeMs(), NOTICE_MS);
  assert.equal(noticeMs({undo: true}), NOTICE_UNDO_MS);
  assert.equal(noticeMs({error: true, undo: true}), NOTICE_ERROR_MS);
  assert.equal(noticeMs({ms: 1200}), 1200);
  assert.ok(NOTICE_UNDO_MS >= NOTICE_MS);
});

test('작은 알림 글자는 한 줄로 줄인다', () => {
  assert.equal(noticeText('  지웠어요\n\n다시  확인 '), '지웠어요 다시 확인');
  assert.equal(noticeText(null), '');
});

test('공용 부품은 브라우저 기본 알림창을 쓰지 않고, 작은 알림은 화면 위쪽에 뜬다(확인창은 하단바 위)', () => {
  const js = readFileSync(new URL('../app/small-notice.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../app/base-ui.css', import.meta.url), 'utf8');
  assert.doesNotMatch(js, /\b(alert|confirm)\(/);
  for (const sel of ['\\.kptu-notice', '\\.kptu-undo-notice', '\\.toast']) {
    const rule = css.match(new RegExp('(?:^|\\n)' + sel + '\\{([^}]*)\\}'));
    assert.ok(rule, sel);
    assert.match(rule[1], /top:var\(--kptu-notice-top\)/, sel);
    assert.match(rule[1], /bottom:auto/, sel);
  }
  assert.match(js, /\.mobile-tabs/);
});

// UI-칸안스크롤하나로: 작은 알림을 넣을 곳. PC 칸에 붙인 창(role=region)은 열린 창 안에 있을 때만 받는다.
test('작은 알림 자리: 열린 창 안, 밑의 화면에 붙인 칸은 건너뜀', () => {
  const el = (id, role, inside = []) => ({id, getAttribute: k => (k === 'role' ? role : null), contains: x => x === el.self?.[id] || inside.includes(x)});
  const ps3 = el('ps3', 'region'), area = el('area', 'dialog', [ps3]), mrd = el('mrd', 'region'), wd = el('wd', 'region');
  const doc = list => ({body: 'body', querySelectorAll: () => list});
  // 사업영역 관리 창(안에 사업영역 칸) 위, 밑의 사업 보고 칸이 문서 뒤쪽: 창 안 칸.
  assert.equal(noticeHost(doc([area, ps3, mrd])).id, 'ps3');
  // 창 안에 붙인 칸이 없으면 창 자체.
  assert.equal(noticeHost(doc([el('x', 'dialog'), mrd])).id, 'x');
  // 열린 창이 없으면 맨 뒤의 붙인 칸, 아무것도 없으면 body.
  assert.equal(noticeHost(doc([wd, mrd])).id, 'mrd');
  assert.equal(noticeHost(doc([])), 'body');
});
