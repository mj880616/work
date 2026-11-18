import test from 'node:test';
import assert from 'node:assert/strict';
import {nowText} from '../app/ed-now-text.mjs';

test('날짜·요일·시간 형식', () => {
  assert.equal(nowText(new Date('2026-11-16T10:05:00Z')), '2026. 11. 16.(월) 19:05');
});
test('자정은 00:00(24시)이고 UTC 날짜가 달라도 한국 날짜로', () => {
  assert.equal(nowText(new Date('2026-11-16T15:00:00Z')), '2026. 11. 17.(화) 00:00');
  assert.equal(nowText(new Date('2026-12-31T14:59:00Z')), '2026. 12. 31.(목) 23:59');
});
test('한 자리 월·일은 0을 붙이지 않고 시간은 두 자리', () => {
  assert.equal(nowText(new Date('2026-03-04T00:07:00Z')), '2026. 3. 4.(수) 09:07');
});
test('일요일·토요일 요일', () => {
  assert.equal(nowText(new Date('2026-11-15T03:00:00Z')), '2026. 11. 15.(일) 12:00');
  assert.equal(nowText(new Date('2026-11-14T03:00:00Z')), '2026. 11. 14.(토) 12:00');
});
