// APP-폰알림 N4: 내 프로필 '폰 알림' 칸 규칙(app/phone-push-model.mjs)과 폰 기기 등록 다리(app/phone-push-settings.js startDeviceSync).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {KINDS, KIND_KEYS, parsePrefs, serializePrefs, toggleKind, onCount, bridgeState, appVersion, isPhoneApp, errorText, testResultText, shortWhen, deviceLabel} from '../app/phone-push-model.mjs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const TOKEN = 'fcm_token-abcdefghijklmnop:1234567890';

test('종류는 DB 검사 제약의 일곱 가지와 같다', () => {
  assert.deepEqual(KIND_KEYS, ['task_due', 'commitment', 'meeting_done', 'collect_stall', 'morning', 'evening', 'next_week']);
  const sql = read('supabase/migrations/20261101010000_phone_push.sql');
  for (const k of KIND_KEYS) assert.match(sql, new RegExp(`@\\.key == "${k}"`));
  assert.equal(KINDS.length, 7);
});

test('비어 있으면 기본(전부 켬, 22:00~07:00), 모르는 칸은 버린다', () => {
  const p = parsePrefs(null);
  assert.equal(onCount(p), 7);
  assert.deepEqual(p.quiet, {from: '22:00', to: '07:00'});
  const q = parsePrefs({kinds: {morning: false, nope: true, evening: 'x'}, quiet: {from: '23:30', to: '06:00'}, other: 1});
  assert.equal(q.kinds.morning, false);
  assert.equal(q.kinds.evening, true);
  assert.equal('nope' in q.kinds, false);
  assert.deepEqual(q.quiet, {from: '23:30', to: '06:00'});
  assert.deepEqual(parsePrefs({quiet: {from: '25:00', to: '06:00'}}).quiet, {from: '22:00', to: '07:00'});
});

test('저장 값은 검사 제약 모양(kinds 일곱 개 + quiet from·to)만, 시간이 틀리면 저장하지 않는다', () => {
  const saved = serializePrefs(toggleKind(parsePrefs(null), 'collect_stall'));
  assert.deepEqual(Object.keys(saved), ['kinds', 'quiet']);
  assert.deepEqual(Object.keys(saved.kinds), KIND_KEYS);
  assert.equal(saved.kinds.collect_stall, false);
  assert.ok(Object.values(saved.kinds).every(v => typeof v === 'boolean'));
  assert.ok(JSON.stringify(saved).length <= 1000);
  assert.equal(serializePrefs({kinds: {}, quiet: {from: '7:00', to: '08:00'}}), null);
  const same = parsePrefs(null);
  assert.equal(toggleKind(same, 'nope'), same);
});

test('앱 다리 글: none·off·denied·fail·on:<토큰>만 읽고, 토큰 모양이 틀리면 fail', () => {
  assert.deepEqual(bridgeState('push:none'), {state: 'none'});
  assert.deepEqual(bridgeState('push:off'), {state: 'off'});
  assert.deepEqual(bridgeState('push:denied'), {state: 'denied'});
  assert.deepEqual(bridgeState('push:fail'), {state: 'fail'});
  assert.deepEqual(bridgeState('push:on:' + TOKEN), {state: 'on', token: TOKEN});
  assert.deepEqual(bridgeState('push:on:short'), {state: 'fail'});
  assert.deepEqual(bridgeState('push:on:' + TOKEN + '<x>'), {state: 'fail'});
  assert.equal(bridgeState('widget:status:on'), null);
  assert.equal(bridgeState(null), null);
});

test('판 번호·앱 판별·오류·결과 글', () => {
  assert.equal(appVersion('Mozilla/5.0 (Linux) KPTUAndroid/0.4.4'), '0.4.4');
  assert.equal(appVersion('Mozilla/5.0 Chrome'), undefined);
  assert.equal(isPhoneApp('x KPTUAndroid/0.4.4'), true);
  assert.equal(isPhoneApp('Chrome'), false);
  assert.equal(errorText('NO_DEVICE'), '등록된 폰이 없어요');
  assert.equal(errorText('PUSH_NOT_CONFIGURED'), '알림 서버 설정 전이에요');
  assert.equal(errorText('whatever'), '잠시 뒤 다시 해 주세요');
  assert.equal(testResultText({sent: 2, failed: 0, revoked: 0}), '시험 알림을 2대에 보냈어요');
  assert.equal(testResultText({sent: 1, failed: 1, revoked: 0}), '시험 알림을 1대에 보냈어요 · 못 보냄 1');
  assert.equal(testResultText({sent: 0, failed: 1}), '보내지 못했어요');
  assert.equal(shortWhen('2026-11-01T01:20:00Z'), '11/01 10:20');
  assert.equal(deviceLabel({app_version: '0.4.4', last_seen_at: '2026-11-01T01:20:00Z'}), '폰 앱 0.4.4 · 11/01 10:20');
  assert.equal(deviceLabel({app_version: '<b>'}), '폰 앱');
});

test('startDeviceSync: 웹 브라우저에서는 아무것도 하지 않고, 앱에서는 묻고, 켜짐이면 웹 세션으로 등록한다', async () => {
  const {startDeviceSync} = await import('../app/phone-push-settings.js');
  const plain = {navigator: {userAgent: 'Chrome'}};
  assert.equal(startDeviceSync(plain), false);
  const sent = [], calls = [];
  let onMessage = null;
  const win = {
    navigator: {userAgent: 'Mozilla/5.0 KPTUAndroid/0.4.4'},
    KPTUAppShell: {postMessage: m => sent.push(m), addEventListener: (t, fn) => { onMessage = fn; }},
    KPTURuntime: {api: async (path, opts) => { calls.push({path, opts}); return {ok: true, device: {id: 'd1', tail: 'ab'}}; }},
  };
  assert.equal(startDeviceSync(win), true);
  assert.equal(startDeviceSync(win), false);
  assert.deepEqual(sent, ['push:hello']);
  onMessage({data: 'push:off'});
  assert.equal(calls.length, 0);
  onMessage({data: 'push:on:' + TOKEN});
  await new Promise(r => setTimeout(r, 0));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/functions/v1/phone-push?action=register');
  assert.equal(calls[0].opts.method, 'POST');
  assert.deepEqual(calls[0].opts.body, {token: TOKEN, app_version: '0.4.4'});
});

test('서버 함수 phone-push는 phone-push-settings.js 한 곳에서만, 토큰을 출력하지 않는다', () => {
  const src = read('app/phone-push-settings.js');
  assert.match(src, /'\/functions\/v1\/phone-push'/);
  assert.doesNotMatch(src, /console\.[a-z]+\([^)]*token/i);
  assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB/);
  assert.doesNotMatch(read('app/phone-push-model.mjs'), /functions\/v1/);
  assert.match(read('app/profile-settings.js'), /import\('\.\/phone-push-settings\.js'\)\.then\(m=>m\.mountPhonePushSettings/);
  assert.match(read('app/loader-v2.js'), /KPTUAndroid[^\n]*import\('\.\/phone-push-settings\.js'\)\.then\(m=>m\.startDeviceSync\(window\)\)/);
});

test('앱: 빌드 변수로만 Firebase를 켜고, 알림을 누르면 웹2 안쪽 주소만 연다', () => {
  const gradle = read('android-app/app/build.gradle');
  for (const name of ['WEB2_FCM_PROJECT_ID', 'WEB2_FCM_APP_ID', 'WEB2_FCM_SENDER_ID', 'WEB2_FCM_API_KEY']) assert.match(gradle, new RegExp(`fcmField\\('${name}'\\)`));
  assert.match(gradle, /implementation 'com\.google\.firebase:firebase-messaging:/);
  assert.doesNotMatch(gradle, /com\.google\.gms/);
  const manifest = read('android-app/app/src/main/AndroidManifest.xml');
  assert.match(manifest, /android:name="\.PushService"\s+android:exported="false">\s*<intent-filter>\s*<action android:name="com\.google\.firebase\.MESSAGING_EVENT" \/>/);
  const main = read('android-app/app/src/main/java/kr/or/kptu/work/MainActivity.kt');
  assert.match(main, /webView\.loadUrl\(PushRules\.openUrl\(intent\.getStringExtra\(PushRules\.EXTRA_OPEN\)\)\)/);
  const setup = read('android-app/app/src/main/java/kr/or/kptu/work/PushSetup.kt');
  assert.match(setup, /setVisibility\(NotificationCompat\.VISIBILITY_PRIVATE\)/);
  assert.match(setup, /setPublicVersion\(hidden\)/);
});
