import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {noticeMs,noticeText,NOTICE_MS,NOTICE_UNDO_MS,NOTICE_ERROR_MS} from '../app/small-notice.js';

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

test('공용 부품은 브라우저 기본 알림창을 쓰지 않고 하단바 위에 뜬다', () => {
  const js = readFileSync(new URL('../app/small-notice.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../app/base-ui.css', import.meta.url), 'utf8');
  assert.doesNotMatch(js, /\b(alert|confirm)\(/);
  assert.match(css, /\.kptu-notice\{[^}]*--kptu-mobile-tab-height/);
  assert.match(js, /\.mobile-tabs/);
});
