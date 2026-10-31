import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {phoneFailure, phoneErrorText, PHONE_FAIL_KINDS} from '../app/photo-sources-model.mjs';
import {failHtml, FAIL_TEXT, REASON_MAX} from '../app/wait-state.js';
import {createPhonePhotos} from '../app/phone-photos.js';

// PHOTO-폰사진못읽음(요청함 10/30 23:58): 폰 앱 [사진] 폰 사진 '불러오지 못했습니다' — 실패 이유가 숨던 것을 보이게.
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('공용 실패 표시: 이유가 있으면 같은 빨간 작은 글자 뒤에 붙고, 없으면 예전과 같다', () => {
  assert.equal(failHtml(), `<p class="wait-fail" data-wait-fail role="alert">${FAIL_TEXT}</p>`);
  const html = failHtml({retry: 'data-photos-more', reason: '폰 사진을 읽지 못했어요: 사진첩 조회가 실패했어요 (query·500)'});
  assert.match(html, /^<p class="wait-fail" data-wait-fail role="alert">불러오지 못했습니다<span class="wait-reason" data-wait-reason> · 폰 사진을 읽지 못했어요: 사진첩 조회가 실패했어요 \(query·500\)<\/span> <button type="button" class="wait-retry" data-photos-more>다시<\/button><\/p>$/);
  assert.doesNotMatch(failHtml({reason: '<img src=x onerror=1>'}), /<img/, '이유 글은 글자로만');
  assert.equal(failHtml({reason: '   '}), failHtml(), '빈 이유는 붙이지 않음');
  assert.ok(failHtml({reason: 'x'.repeat(500)}).includes('x'.repeat(REASON_MAX) + '</span>'));
  assert.ok(!failHtml({reason: 'x'.repeat(500)}).includes('x'.repeat(REASON_MAX + 1)));
});

test('앱 실패 답 해석: 종류·예외 클래스 이름만 받고 모르는 값은 버린다', () => {
  assert.deepEqual(phoneFailure(500, '{"error":"query","detail":"IllegalStateException"}'), {status:500, error:'query', detail:'IllegalStateException'});
  assert.deepEqual(phoneFailure(403, '{"error":"permission","detail":"none"}'), {status:403, error:'permission', detail:'none'});
  assert.deepEqual(phoneFailure(404, ''), {status:404, error:'', detail:''}, '옛 앱(0.3.9)은 빈 404');
  assert.deepEqual(phoneFailure(500, '{"error":"evil","detail":"/storage/emulated/0/a.jpg"}'), {status:500, error:'', detail:''});
  assert.deepEqual(phoneFailure(500, 'not json'), {status:500, error:'', detail:''});
  assert.deepEqual(phoneFailure(0, '', {error:'unreached', detail:'TypeError'}), {status:0, error:'unreached', detail:'TypeError'});
  for (const k of ['permission', 'key', 'bad_request', 'query', 'column', 'decode', 'not_found']) assert.ok(PHONE_FAIL_KINDS.includes(k), k);
});

test('화면 글: 무엇이 실패했는지 일상어 + (종류·클래스·상태)', () => {
  const e = info => Object.assign(new Error('phone_read_failed'), {phone:info});
  assert.equal(phoneErrorText(e({status:500, error:'query', detail:'IllegalStateException'})), '폰 사진을 읽지 못했어요: 사진첩 조회가 실패했어요 (query·IllegalStateException·500)');
  assert.equal(phoneErrorText(e({status:500, error:'column', detail:'IllegalArgumentException'})), '폰 사진을 읽지 못했어요: 사진첩 항목 이름이 맞지 않아요 (column·IllegalArgumentException·500)');
  assert.equal(phoneErrorText(e({status:403, error:'permission', detail:'none'})), '폰 사진을 읽지 못했어요: 사진 접근 허용이 없어요 (permission·none·403)');
  assert.equal(phoneErrorText(e({status:403, error:'key', detail:''})), '폰 사진을 읽지 못했어요: 앱 열쇠가 바뀌었어요, [다시]를 눌러 주세요 (key·403)');
  assert.equal(phoneErrorText(e({status:404, error:'', detail:''})), '폰 사진을 읽지 못했어요: 앱이 이유를 주지 않았어요(앱 새 판 필요) (404)');
  assert.equal(phoneErrorText(e({status:0, error:'unreached', detail:'TypeError'})), '폰 사진을 읽지 못했어요: 앱이 요청을 받지 못했어요 (unreached·TypeError)');
  assert.equal(phoneErrorText(new Error('phone_no_access')), '폰 사진을 읽지 못했어요: 사진 접근 허용이 없어요');
  assert.equal(phoneErrorText(new Error('x')), '폰 사진을 읽지 못했어요.');
});

// 가짜 앱 다리 + fetch로 phone-photos.js가 실패 답을 error.phone으로 넘기는지.
function fakeWin(respond) {
  const sent = [];
  let onMessage = null;
  const bridge = {postMessage: t => { sent.push(t); if (t === 'photos:hello') queueMicrotask(() => onMessage?.({data:'photos:state:{"access":"full","key":"abcdefghijklmnopqrstuvwxyzABCDEF","trash":true}'})); },
    addEventListener: (_, fn) => { onMessage = fn; }};
  return {sent, win:{navigator:{userAgent:'KPTUAndroid'}, KPTUAppShell:bridge, document:{baseURI:'https://bokdoong.com/work/app/'}, location:{href:'https://bokdoong.com/work/app/'}, fetch: async u => respond(u)}};
}
const res = (status, body) => ({ok:status >= 200 && status < 300, status, text: async () => body, json: async () => JSON.parse(body)});

test('앱 다리: 실패 답(상태 + 종류)을 error.phone으로, 열쇠 실패면 새 열쇠를 다시 묻는다', async () => {
  const {win, sent} = fakeWin(u => (u.includes('/page?') ? res(500, '{"error":"query","detail":"IllegalStateException"}') : res(403, '{"error":"key","detail":""}')));
  const api = createPhonePhotos(win);
  await api.hello();
  assert.equal(api.state().access, 'full');
  await assert.rejects(api.page(), err => err.phone?.error === 'query' && err.phone.status === 500 && err.phone.detail === 'IllegalStateException');
  const before = sent.filter(t => t === 'photos:hello').length;
  await assert.rejects(api.months(), err => err.phone?.error === 'key');
  assert.equal(sent.filter(t => t === 'photos:hello').length, before + 1, '열쇠 실패 뒤 photos:hello');
});

test('앱 다리: 앱에 닿지 않으면 unreached, 답이 JSON이 아니면 answer', async () => {
  const thrown = createPhonePhotos(fakeWin(() => { throw new TypeError('Failed to fetch'); }).win);
  await thrown.hello();
  await assert.rejects(thrown.page(), err => err.phone?.error === 'unreached' && err.phone.detail === 'TypeError');
  const bad = createPhonePhotos(fakeWin(() => ({ok:true, status:200, text: async () => 'x', json: async () => { throw new SyntaxError('x'); }})).win);
  await bad.hello();
  await assert.rejects(bad.page(), err => err.phone?.error === 'answer');
});

test('전수: 이유를 만들어 놓고 공용 글만 보이던 곳이 이유를 넘긴다', () => {
  const photos = read('app/photos.js');
  assert.match(photos, /failHtml\(\{retry: 'data-photos-more', reason: failed\}\)/, '[사진] 아래 실패');
  assert.match(photos, /failHtml\(\{retry:'data-photos-fx-again', reason:fFailed\}\)/, '[폴더] 격자 실패');
  assert.match(photos, /failed = phoneErrorText\(error\)/, '폰 실패는 앱이 준 이유');
  assert.doesNotMatch(photos, /failed = '폰 사진을 읽지 못했어요\.'/);
  assert.match(photos, /사진을 읽지 못했어요: \$\{esc\(readErrorText\(error\)\)\}/, '[달력] 실패도 폰 이유');
  assert.match(photos, /aFailed = readErrorText\(error\)/, '[앨범] 실패도 폰 이유');
  assert.match(read('app/meeting-round-detail.js'), /failHtml\(\{reason:typeof text==='string'&&text!==MRD_LOAD_FAIL\?text:''\}\)/, '사업 보고 실패 이유');
  assert.match(read('app/loader-v2.js'), /reason:\/\^\[A-Za-z\]\{1,40\}\$\/\.test\(err\?\.name/, '화면 프로그램 받기 실패 이유');
});

test('앱(0.4.0): 실패를 빈 404로 뭉개지 않고, 사진·동영상 모음을 따로 읽는다', () => {
  const kt = read('android-app/app/src/main/java/kr/or/kptu/work/PhoneMedia.kt');
  assert.doesNotMatch(kt, /fun notFound\(/, '빈 404 답 없앰');
  assert.doesNotMatch(kt, /catch \(_: Exception\) \{\s*notFound\(\)/);
  assert.doesNotMatch(kt, /MediaStore\.Files\.getContentUri/, 'Files 모음 조회 없앰');
  assert.match(kt, /MediaStore\.Images\.Media\.EXTERNAL_CONTENT_URI/);
  assert.match(kt, /MediaStore\.Video\.Media\.EXTERNAL_CONTENT_URI/);
  assert.match(kt, /PhoneMediaRules\.combine\(read\(false\), read\(true\)\)/);
  // 로그에는 종류·단계·클래스 이름만(예외 글·사진 이름 없음).
  const logs = [...kt.matchAll(/Log\.\w\(([^\n]*)\)/g)].map(m => m[1]);
  assert.ok(logs.length >= 1);
  for (const l of logs) assert.doesNotMatch(l, /message|name\b|\.name|path/i, l);
  assert.match(read('android-app/app/build.gradle'), /versionName '0\.4\.[1-9]'/);
});
