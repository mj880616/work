import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// STAB-로그인이동경합: 시험용 로그인 도우미(signInWithSession)는 page.evaluate 안에서 곧바로 location.replace로 이동하면 안 된다.
// 이동이 호출 결과보다 먼저 확정되면 'Execution context was destroyed'로 시험이 간헐 실패한다(144개 시험 파일이 공유). 이동은 다음 틱(setTimeout 0).
test('signInWithSession: 이동은 evaluate가 값을 돌려준 뒤 다음 틱에 한다', () => {
  const src = readFileSync(new URL('./app-e2e/helpers/session-login.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /^\s*location\.replace\(/m, 'evaluate 안에서 바로 location.replace 금지');
  assert.match(src, /setTimeout\(\(\)=>location\.replace\(target\),0\)/);
});
