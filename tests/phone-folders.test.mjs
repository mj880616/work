// PHOTO-폴더스위치 ②·③: 폰 폴더 스위치(끈 폴더 목록 서버 저장)·폰 폴더 바꾸기·원드라이브 사진 든 폴더 지우기(synthetic, 실제 폰·서버 없음).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parsePhoneOff, phoneOffValue, remapPhoneOff, cleanPhoneName, isPhoneTarget, isPhoneMovable, isPhoneTrashable, newPhonePath, renamedPhonePath,
  movedPhonePath, phonePickRows, phoneOpText, PHONE_OFF_MAX} from '../app/phone-folders-model.mjs';
import {createPhonePhotos} from '../app/phone-photos.js';
import {phoneToItem} from '../app/photo-sources-model.mjs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('끈 폰 폴더 목록: 서버 값 읽기·쓰기(80개까지, 제어문자 버림)', () => {
  assert.deepEqual([...parsePhoneOff(['DCIM/Camera/', '', 'a\nb', 3, 'x'.repeat(256)])], ['DCIM/Camera/', '']);
  assert.deepEqual([...parsePhoneOff(null)], []);
  assert.deepEqual(phoneOffValue(new Set(['b/', 'a/'])), ['a/', 'b/']);
  assert.equal(phoneOffValue(new Set(Array.from({length:PHONE_OFF_MAX + 1}, (_, i) => `P/${i}/`))), null);
  // 이름 바꾸기·폴더 옮기기 뒤 그 폴더와 아래 폴더가 따라가고, 지우기 뒤엔 빠진다.
  const off = new Set(['Pictures/A/', 'Pictures/A/B/', 'Pictures/AB/', 'DCIM/Camera/']);
  assert.deepEqual([...remapPhoneOff(off, 'Pictures/A/', 'Pictures/새/')].sort(), ['DCIM/Camera/', 'Pictures/AB/', 'Pictures/새/', 'Pictures/새/B/']);
  assert.deepEqual([...remapPhoneOff(off, 'Pictures/A/', null)].sort(), ['DCIM/Camera/', 'Pictures/AB/']);
});

test('폰 폴더 경로 규칙: 앱(PhoneMediaRules.folderOp)과 같다 — DCIM·Pictures 아래만, 이름 1~60자', () => {
  assert.equal(cleanPhoneName('  가족 '), '가족');
  for (const bad of ['', '.숨김', 'a/b', 'a\\b', 'a\nb', 'x'.repeat(61)]) assert.equal(cleanPhoneName(bad), '', JSON.stringify(bad));
  assert.ok(isPhoneTarget('DCIM/') && isPhoneTarget('Pictures/KakaoTalk/') && !isPhoneTarget('Download/') && !isPhoneTarget('Pictures//') && !isPhoneTarget('../x/'));
  assert.ok(isPhoneMovable('DCIM/Camera/') && !isPhoneMovable('DCIM/') && !isPhoneMovable('Download/KakaoTalk/'));
  assert.ok(isPhoneTrashable('Download/KakaoTalk/') && !isPhoneTrashable('Pictures/') && !isPhoneTrashable(''));
  assert.equal(newPhonePath('DCIM/Camera/', '여행'), 'DCIM/Camera/여행/');
  assert.equal(newPhonePath('Download/', '여행'), 'Pictures/여행/', '옮길 수 없는 곳 아래면 Pictures 아래');
  assert.equal(renamedPhonePath('Pictures/A/', 'B'), 'Pictures/B/');
  assert.equal(movedPhonePath('Pictures/A/', 'DCIM/Camera/'), 'DCIM/Camera/A/');
  const rows = phonePickRows([{id:'Pictures/A/'}, {id:'Pictures/A/B/'}, {id:'DCIM/Camera/'}, {id:'Download/'}], {moving:'Pictures/A/'});
  assert.deepEqual(rows.map(r => [r.id, r.current]), [['DCIM/', false], ['DCIM/Camera/', false], ['Pictures/', true], ['Pictures/A/', true], ['Pictures/A/B/', true]]);
  assert.deepEqual(phonePickRows([{id:'DCIM/Camera/'}], {here:'DCIM/Camera/'}).filter(r => r.current).map(r => r.id), ['DCIM/Camera/']);
  assert.equal(phoneOpText({ok:false, error:'refused'}, 'x'), '폰에서 바꾸지 않았어요(확인 창에서 취소).');
  assert.equal(phoneOpText({ok:true}, '옮겼어요'), '옮겼어요');
});

// 가짜 앱 다리. state = 앱이 알리는 상태 글.
function fakeWin(state) {
  const sent = [], urls = [];
  let onMessage = null;
  const bridge = {postMessage: t => {
    sent.push(t);
    if (t === 'photos:hello') queueMicrotask(() => onMessage?.({data:'photos:state:' + state}));
    if (t.startsWith('photos:op:')) queueMicrotask(() => onMessage?.({data:'photos:done:{"ok":true,"count":3,"error":"","path":"Pictures/B/"}'}));
  }, addEventListener: (_, fn) => { onMessage = fn; }};
  const ok = body => ({ok:true, status:200, text: async () => JSON.stringify(body), json: async () => body});
  return {sent, urls, win:{navigator:{userAgent:'KPTUAndroid'}, KPTUAppShell:bridge, document:{baseURI:'https://bokdoong.com/work/app/'}, location:{href:'https://bokdoong.com/work/app/'},
    fetch: async u => { urls.push(u); return ok(u.includes('/months?') ? {months:{}} : u.includes('/days?') ? {days:{}} : {items:[], next:null}); }}};
}
const KEY = 'abcdefghijklmnopqrstuvwxyzABCDEF';

test('앱 다리(0.4.1): 목록·달·날·번호 읽기에 끈 폴더(hide)를 붙이고, 폴더 바꾸기는 photos:op → photos:done', async () => {
  const {win, sent, urls} = fakeWin(`{"access":"full","key":"${KEY}","trash":true,"hide":true,"ops":true,"manage":false}`);
  const api = createPhonePhotos(win);
  await api.hello();
  assert.deepEqual([api.state().hide, api.state().ops, api.state().manage], [true, true, false]);
  const hide = ['DCIM/Camera/'];
  await api.page({hide}); await api.months('all', {hide}); await api.days('2026-10', {hide}); await api.byIds(['1'], {hide});
  for (const u of urls) assert.equal(new URL(u).searchParams.get('hide'), '["DCIM/Camera/"]', u);
  await api.page({hide:[]});
  assert.equal(new URL(urls.at(-1)).searchParams.has('hide'), false, '빈 목록이면 붙이지 않음');
  const done = await api.folderOp({op:'rename', from:'Pictures/A/', name:'B'});
  assert.deepEqual(done, {ok:true, count:3, error:'', path:'Pictures/B/'});
  assert.equal(sent.at(-1), 'photos:op:{"op":"rename","from":"Pictures/A/","name":"B"}');
  assert.equal(api.manage(), true); assert.equal(sent.at(-1), 'photos:manage');
});

test('옛 앱(0.4.0 이하): hide를 붙이지 않고(400 방지) 폴더 바꾸기·스위치는 없음', async () => {
  const {win, sent, urls} = fakeWin(`{"access":"full","key":"${KEY}","trash":true}`);
  const api = createPhonePhotos(win);
  await api.hello();
  assert.deepEqual([api.state().hide, api.state().ops], [false, false]);
  await api.page({hide:['DCIM/Camera/']}); await api.months('all', {hide:['DCIM/Camera/']});
  for (const u of urls) assert.equal(new URL(u).searchParams.has('hide'), false, u);
  assert.deepEqual(await api.folderOp({op:'trashfolder', from:'Pictures/A/'}), {ok:false, count:0, error:'old', path:null});
  assert.ok(!sent.some(t => t.startsWith('photos:op:')));
  assert.equal(api.manage(), false);
});

test('사진마다 폰 폴더(앱 0.4.1): 화면 메모리에만, 옛 앱은 null', () => {
  const base = {id:'5', taken_at:'2026-10-30T01:00:00.000Z', day:'2026-10-30', kind:'photo'};
  assert.equal(phoneToItem({...base, folder:'DCIM/Camera/'}).folder, 'DCIM/Camera/');
  assert.equal(phoneToItem(base).folder, null);
});

test('사진 화면: 폰 폴더 스위치·⋯ 메뉴·바꾸기·원드라이브 사진 든 폴더 지우기', () => {
  const s = read('app/photos.js');
  // 끈 폴더는 서버 저장(view_prefs.phone_folders_off, rejectable) — 기기 저장 없음.
  assert.match(s, /viewPrefs\.set\('phone_folders_off', value, \{rejectable:true\}\)/);
  // 기기 저장 API 이름은 저장소 검사(browser-storage-audit)에 걸리지 않게 조각으로 만든다.
  assert.doesNotMatch(s, new RegExp(['local', 'session'].map(x => x + 'Storage').concat('indexed' + 'DB').join('|')));
  assert.match(s, /phoneOff = parsePhoneOff\(viewPrefs\.get\('phone_folders_off'\)\);/);
  // [사진]·[달력]·★·앨범 읽기 모두 끈 폴더를 붙인다.
  assert.match(s, /phone\.page\(\{sort:listSort\(\), filter, offset:phNext, limit:PAGE_SIZE, before:[^}]*\.\.\.hideArg\(\)\}\)/);
  assert.match(s, /phone\.months\(want, hideArg\(\)\)/);
  assert.match(s, /phone\.days\(key, \{filter:want, prefer:phoneStarIds\(\), \.\.\.hideArg\(\)\}\)/);
  assert.match(s, /phone\.byIds\(phoneStarIds\(\), hideArg\(\)\)/);
  assert.match(s, /phone\.byIds\(c\.phoneKeys\.map\(phoneIdOfKey\), hideArg\(\)\)/);
  // 폴더 줄: 원드라이브와 같은 스위치·⋯ 모양(앱 0.4.1+만), 꺼지면 흐림.
  const row = s.slice(s.indexOf('function phoneFolderRowHtml'), s.indexOf('// 폰 묶음 줄들'));
  assert.match(row, /sw = phoneSw\(\) && !f\.pending/);
  assert.match(row, /' is-off'/);
  assert.match(s, /const phoneSwHtml = f => switchHtml\(/);
  // 폰 폴더 메뉴는 원드라이브 폴더 메뉴와 같은 모양(od-link-menu)·같은 항목.
  const menu = s.slice(s.indexOf('const phoneFolderMenu'), s.indexOf('const photoMenu'));
  assert.match(menu, /className:'od-link-menu'/);
  for (const t of ['새 하위 폴더', '이름 바꾸기', '옮기기…', '지우기']) assert.ok(menu.includes(`'${t}'`), t);
  // 처음 한 번 '미디어 관리 허용' 안내, 지우기는 확인 뒤 폰 휴지통.
  assert.match(s, /미디어 관리 허용/);
  assert.match(s, /phone\.folderOp\(op\)/);
  assert.match(s, /\{op:'trashfolder', from:id\}/);
  // 원드라이브: 사진 든 폴더도 확인 한 번 뒤 폴더째 휴지통(contents).
  const del = s.slice(s.indexOf('async function deleteFolder'), s.indexOf('// 여러 장 폴더로 옮기기'));
  assert.doesNotMatch(del, /폴더가 비어 있을 때만 지울 수 있어요/);
  assert.match(del, /odFolderDelete\(rt, id, \{contents:full\}\)/);
  assert.match(read('app/diary-onedrive.js'), /\.\.\.\(contents \? \{contents: true\} : \{\}\)/);
});

test('앱(0.4.1): 끈 폴더 거르기·사진마다 폴더·폴더 바꾸기·미디어 관리 허용', () => {
  const rules = read('android-app/app/src/main/java/kr/or/kptu/work/PhoneMediaRules.kt');
  assert.match(rules, /fun hideList\(/);
  assert.match(rules, /fun folderOp\(/);
  assert.match(rules, /append\(",\\"folder\\":"\)/);
  const media = read('android-app/app/src/main/java/kr/or/kptu/work/PhoneMedia.kt');
  assert.match(media, /PhoneMediaRules\.visible\(all\(context\), req\.hide\)/);
  assert.doesNotMatch(media.slice(media.indexOf('fun applyMove')), /Log\.[a-z]\(TAG, "[^"]*\$\{?(m|to)\b/, '사진 이름·경로는 로그에 쓰지 않음');
  const main = read('android-app/app/src/main/java/kr/or/kptu/work/MainActivity.kt');
  assert.match(main, /MediaStore\.createWriteRequest\(contentResolver, uris\)/);
  assert.match(main, /MediaStore\.createTrashRequest\(contentResolver, uris, true\)/);
  assert.match(main, /Settings\.ACTION_REQUEST_MANAGE_MEDIA/);
  assert.match(read('android-app/app/src/main/AndroidManifest.xml'), /android\.permission\.MANAGE_MEDIA/);
  const gradle = read('android-app/app/build.gradle');
  assert.match(gradle, /versionName '0\.4\.1'/);
  assert.match(gradle, /versionCode 41/);
});
