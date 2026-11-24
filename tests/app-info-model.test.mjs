// S69-34 APP-업데이트확인: 계정 메뉴 '앱 정보'의 판단(app/app-info-model.mjs).
import assert from 'node:assert/strict';
import test from 'node:test';
import {shellOf, isNewer, buildInfo, stamp, webLine, phoneAnswer, phoneText} from '../app/app-info-model.mjs';

test('어디서 열었나: 폰 앱(직접 설치판·플레이판)·옛 윈도우 앱·브라우저', () => {
  assert.deepEqual(shellOf('Mozilla/5.0 (Linux; Android 14; wv) KPTUAndroid/0.5.27'), {kind: 'android', version: '0.5.27', channel: 'github'});
  assert.deepEqual(shellOf('Mozilla/5.0 (Linux; Android 14; wv) KPTUAndroid/0.5.28 WorkOnPlay'), {kind: 'android', version: '0.5.28', channel: 'play'});
  assert.deepEqual(shellOf('Mozilla/5.0 (Windows NT 10.0) Edg/120 KPTUWindows/0.1.0'), {kind: 'windows', version: '0.1.0'});
  assert.deepEqual(shellOf('Mozilla/5.0 (Windows NT 10.0) Chrome/130'), {kind: 'web'});
  assert.deepEqual(shellOf(''), {kind: 'web'});
});

test('판 비교: 숫자 마디로, 모양이 이상하면 새 판이 아님', () => {
  assert.equal(isNewer('0.5.28', '0.5.27'), true);
  assert.equal(isNewer('0.5.10', '0.5.9'), true);
  assert.equal(isNewer('0.5.27', '0.5.27'), false);
  assert.equal(isNewer('0.5.26', '0.5.27'), false);
  assert.equal(isNewer('1.0', '0.9.9'), true);
  assert.equal(isNewer('x', '0.5.27'), false);
  assert.equal(isNewer('0.5.28', ''), false);
});

test('build-info.json 모양과 화면 판 한 줄(서울 시각)', () => {
  assert.deepEqual(buildInfo({v: 'abc1234567', at: '2026-11-24T05:06:00.000Z'}), {v: 'abc1234567', at: '2026-11-24T05:06:00.000Z'});
  assert.equal(buildInfo({v: '<x>'}), null);
  assert.equal(buildInfo(null), null);
  assert.deepEqual(buildInfo({v: 'abc', at: 'nope'}), {v: 'abc', at: ''});
  assert.equal(stamp('2026-11-24T05:06:00.000Z'), '2026-11-24 14:06');
  assert.equal(stamp('bad'), '');
  assert.equal(webLine('abc1234567', {v: 'abc1234567', at: '2026-11-24T05:06:00.000Z'}), '2026-11-24 14:06 배포 · abc1234');
  // 배포된 판이 지금 판과 다르면 그 시각은 지금 판 것이 아니다: 판 번호만.
  assert.equal(webLine('abc1234567', {v: 'zzz', at: '2026-11-24T05:06:00.000Z'}), 'abc1234');
  assert.equal(webLine(null, null), '시험판');
});

test('폰 앱 다리 답과 한 줄', () => {
  assert.deepEqual(phoneAnswer('update:new:0.5.29'), {state: 'new', version: '0.5.29'});
  assert.deepEqual(phoneAnswer('update:latest:0.5.28'), {state: 'latest', version: '0.5.28'});
  assert.deepEqual(phoneAnswer('update:busy'), {state: 'busy'});
  assert.deepEqual(phoneAnswer('update:fail'), {state: 'fail'});
  assert.deepEqual(phoneAnswer('update:store'), {state: 'store'});
  assert.equal(phoneAnswer('update:new:<script>'), null);
  assert.equal(phoneAnswer('push:on:x'), null);
  assert.equal(phoneAnswer(42), null);
  assert.equal(phoneText({state: 'new', version: '0.5.29'}, '0.5.28'), '새 앱 0.5.29이 있어요');
  assert.equal(phoneText({state: 'latest', version: '0.5.28'}, '0.5.28'), '최신이에요 (0.5.28)');
  assert.match(phoneText(null, '0.5.28'), /확인하지 못했어요/);
});
