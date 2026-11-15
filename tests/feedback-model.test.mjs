// FEEDBACK-의견보내기 PR5: 의견 보내기 계산(app/feedback-model.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import {deviceOf, contextOf, contextLine, feedbackProblem, feedbackError} from '../app/feedback-model.mjs';

test('자동 정보: 폭으로 폰·폴드·PC, 앱·브라우저, 네 칸만', () => {
  assert.equal(deviceOf(412), 'phone'); assert.equal(deviceOf(880), 'fold'); assert.equal(deviceOf(1280), 'pc');
  const ctx = contextOf({screen: '사진', width: 880, app: true, version: 'abc'});
  assert.deepEqual(ctx, {screen: '사진', device: 'fold', client: 'app', version: 'abc'});
  assert.equal(contextLine(ctx), '사진 · 폴드 · 앱 · 판 abc');
});

test('보내기 전 검사·서버 오류 문구', () => {
  assert.equal(feedbackProblem({body: '  '}), '보낼 글을 써 주세요');
  assert.equal(feedbackProblem({body: '가'.repeat(2001)}), '글은 2000자까지예요');
  assert.equal(feedbackProblem({body: 'a', photos: [{}, {}, {}, {}]}), '사진은 3장까지예요');
  assert.equal(feedbackProblem({body: 'a', photos: [{bytes: 2e6}]}), '사진이 너무 커요');
  assert.equal(feedbackProblem({body: 'a'}), '');
  assert.match(feedbackError(new Error('FEEDBACK_DAILY_LIMIT')), /내일/);
  assert.match(feedbackError(new Error('x')), /잠시 뒤/);
});
