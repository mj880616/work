// OPS-새가입알림 ③(S62-25): '새 가입' 칩(운영자만, 기본 켬, 끌 때만 kinds.signup=false)·알림 줄 말·가입자 화면 경계.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parsePrefs, serializePrefs, toggleKind, SIGNUP_KIND, SIGNUP_FEATURE, noticeText, noticeItems, noticeParam, recentItems, RECENT_LABEL} from '../app/phone-push-model.mjs';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('새 가입 칩: 기본 켬이라 저장 값에 넣지 않고, 끌 때만 kinds.signup=false — 잊지 말기와 함께 써도 서로 안 섞임', () => {
  assert.deepEqual([...SIGNUP_KIND], ['signup', '새 가입']);
  assert.equal(SIGNUP_FEATURE, 'dev_inbox');
  const base = parsePrefs(null);
  assert.equal(base.signup, true);
  assert.equal('signup' in serializePrefs(base).kinds, false);
  const off = toggleKind(base, 'signup');
  assert.equal(off.signup, false);
  assert.equal(serializePrefs(off).kinds.signup, false);
  assert.equal('family' in serializePrefs(off).kinds, false);
  const both = toggleKind(off, 'family');
  assert.deepEqual([serializePrefs(both).kinds.signup, serializePrefs(both).kinds.family], [false, false]);
  assert.equal(parsePrefs(serializePrefs(off)).signup, false);
  assert.equal(toggleKind(off, 'signup').signup, true);
});

test('알림 줄: signup만 서버 글(text)을 쓰고(한 줄·100자), 다른 종류는 종류로 정한 말', () => {
  const item = {kind: 'signup', ref_key: 'su:1794700000', open: '/work/app/?view=signups&notice=signup.su%3A1794700000', text: '새 가입 2명 — 가상 사람B,\n가상 사람A'};
  assert.equal(noticeItems({items: [item]}).length, 1);
  assert.equal(noticeText(item), '새 가입 2명 — 가상 사람B, 가상 사람A');
  assert.equal(noticeText({...item, text: 'x'.repeat(300)}).length, 100);
  assert.equal(noticeText({...item, text: ''}), '새 가입');
  assert.equal(noticeText({kind: 'meeting_done', text: '서버가 보낸 다른 말'}), '회의 요약이 준비됐어요');
  assert.deepEqual(noticeParam('?view=signups&notice=signup.su%3A1794700000'), {kind: 'signup', ref_key: 'su:1794700000'});
  assert.equal(RECENT_LABEL.signup, '새 가입');
  assert.equal(recentItems({items: [{kind: 'signup', ref_key: 'su:1', at: '2026-11-15T03:00:00Z', open: '/work/app/?view=signups'}]})[0].line, '11/15 12:00 · 새 가입');
});

test('가입자 화면: 서버 함수 하나(app_signup_list)만 읽고, 기기 저장·HTML 끼워 넣기 없음. 입구 줄은 처음엔 숨김(운영자 확인 뒤 보임)', () => {
  const view = read('app/signups-view.js');
  assert.deepEqual([...view.matchAll(/\/rest\/v1\/[^'"`]+/g)].map(m => m[0]), ['/rest/v1/rpc/app_signup_list']);
  // OPS-가입자현황(S62-29, 사용자 11/15 23:17 확정): 이메일은 운영자에게 보이는 칸이 됐다(칸 목록은 tests/signup-status-model.test.mjs가 본다). 기기 저장 금지는 CI audit가 본다
  for (const m of view.matchAll(/root\.innerHTML=([^;]+)/g)) assert.match(m[1], /^(waitHtml|failHtml|emptyHtml|\/42501)/, '화면 글은 정해진 부품으로만');
  const top = read('app/topbar-actions.js');
  assert.match(top, /signups\.dataset\.signupsOpen='';signups\.hidden=true;signups\.textContent='가입자 현황'/);
  assert.match(top, /account\.inbox\.hidden=false;account\.signups\.hidden=false/);
  assert.match(read('app/view-loader.js'), /signups:\['\.\/signups\.css'/);
  assert.match(read('about/privacy/index.html'), /내가 기록한 내용은 운영자가 볼 수 없습니다\.[\s\S]*운영자에게 제공되는 정보<\/b>: 이메일주소, 가입일, 마지막 사용 시각<\/li>/); // S68-58: 사용자 확정 문장(11/23 15:53)
  assert.match(read('app/phone-push-settings.js'), /signup: Array\.isArray\(got\) && got\.includes\(SIGNUP_FEATURE\)/);
});
