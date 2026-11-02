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
  assert.match(s, /phone\.page\(\{sort:listSort\(\), filter, offset:phNext, limit:PAGE_SIZE, before:[^}]*\.\.\.\(await hideArg\(\)\)\}\)/);
  assert.match(s, /phone\.months\(want, await hideArg\(\)\)/);
  assert.match(s, /phone\.days\(key, \{filter:want, prefer:phoneStarIds\(\), \.\.\.\(await hideArg\(\)\)\}\)/);
  assert.match(s, /phone\.byIds\(phoneStarIds\(\), await hideArg\(\)\)/);
  assert.match(s, /phone\.byIds\(c\.phoneKeys\.map\(phoneIdOfKey\), await hideArg\(\)\)/);
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
  assert.match(gradle, /versionName '0\.4\.(?:[1-9]|[1-9][0-9])'/);
  assert.match(gradle, /versionCode (?:4[1-9]|[5-9][0-9])/);
});

// S48-31 새 폰 폴더는 꺼진 채(요청함 10/31 11:04 [사용자 결정]): 아는 폴더(view_prefs.phone_folders_known, 지문 배열)로 새 폰 폴더를 알아본다.
import {phoneFolderKey, parsePhoneKnown, phoneKnownValue, reconcilePhoneFolders, knownAfterOff, remapPhoneKnown, knownWith, PHONE_KNOWN_MAX} from '../app/phone-folders-model.mjs';
import {createPhoneFoldersSync} from '../app/phone-folders-sync.js';
const F = (...ids) => ids.map(id => ({id, name:id, count:1}));
const K = (...ids) => new Set(ids.map(phoneFolderKey));

test('아는 폴더 지문: 경로마다 16진수 8자, 같은 경로는 같은 값·다른 경로는 다른 값', () => {
  const a = phoneFolderKey('DCIM/Camera/'), b = phoneFolderKey('Pictures/가족/');
  assert.match(a, /^[0-9a-f]{8}$/); assert.match(b, /^[0-9a-f]{8}$/);
  assert.equal(a, phoneFolderKey('DCIM/Camera/')); assert.notEqual(a, b);
  assert.equal(parsePhoneKnown(undefined), null); assert.equal(parsePhoneKnown(['DCIM/']), null);
  assert.deepEqual([...parsePhoneKnown([a])], [a]);
  assert.deepEqual(phoneKnownValue(new Set(['ffffffff', '00000000'])), ['00000000', 'ffffffff']);
  const many = new Set(Array.from({length:PHONE_KNOWN_MAX + 1}, (_, i) => i.toString(16).padStart(8, '0')));
  assert.equal(phoneKnownValue(many), null);
  assert.equal(phoneKnownValue(many, new Set(['00000001'])).length, 1, '넘치면 지금 있는 폴더만 남긴다');
});

test('처음 한 번: 지금 보이는 폰 폴더를 모두 아는 폴더로 — 끈 목록은 그대로(보이는 상태가 바뀌지 않음)', () => {
  const r = reconcilePhoneFolders({folders:F('DCIM/Camera/', 'Pictures/KakaoTalk/', 'Pictures/숨김/'), off:new Set(['Pictures/숨김/']), known:null});
  assert.equal(r.offChanged, false); assert.deepEqual(r.added, []);
  assert.deepEqual([...r.off], ['Pictures/숨김/']);
  assert.equal(r.knownChanged, true);
  assert.deepEqual(r.known, [...K('DCIM/Camera/', 'Pictures/KakaoTalk/')].sort());
});

test('그 뒤 새로 생긴 폰 폴더는 끈 목록에 더해 꺼진 채, 아는 폴더·끈 폴더는 그대로', () => {
  const known = K('DCIM/Camera/', 'Pictures/KakaoTalk/');
  const r = reconcilePhoneFolders({folders:F('DCIM/Camera/', 'Pictures/KakaoTalk/', 'Pictures/숨김/', 'Pictures/Telegram/'), off:new Set(['Pictures/숨김/']), known});
  assert.deepEqual(r.added, ['Pictures/Telegram/']);
  assert.equal(r.offChanged, true); assert.equal(r.knownChanged, false);
  assert.deepEqual([...r.off].sort(), ['Pictures/Telegram/', 'Pictures/숨김/']);
  // 새 폴더가 없으면 아무것도 바꾸지 않는다.
  const same = reconcilePhoneFolders({folders:F('DCIM/Camera/'), off:new Set(), known});
  assert.equal(same.offChanged, false); assert.equal(same.knownChanged, false);
  // 끈 목록이 80개면 더하지 않는다(다음에 다시 본다).
  const full = new Set(Array.from({length:PHONE_OFF_MAX}, (_, i) => `P/${i}/`));
  assert.deepEqual(reconcilePhoneFolders({folders:F('X/'), off:full, known}).added, []);
});

test('스위치를 켜면 아는 폴더에 더하고(다시 꺼지지 않게) 끄면 뺀다, 이름 바꾸기·옮기기·지우기를 따라간다', () => {
  const known = K('DCIM/Camera/');
  const on = knownAfterOff(known, new Set(['Pictures/Telegram/']), new Set());
  assert.ok(on.includes(phoneFolderKey('Pictures/Telegram/')));
  assert.equal(reconcilePhoneFolders({folders:F('DCIM/Camera/', 'Pictures/Telegram/'), off:new Set(), known:new Set(on)}).offChanged, false, '켠 폴더는 새 폴더가 아니다');
  const off = knownAfterOff(new Set(on), new Set(), new Set(['DCIM/Camera/']));
  assert.ok(!off.includes(phoneFolderKey('DCIM/Camera/')));
  assert.equal(knownAfterOff(null, new Set(['a/']), new Set()), null, '아직 모르면 만들지 않는다');
  const folders = F('Pictures/A/', 'Pictures/A/B/', 'Pictures/AB/');
  const renamed = new Set(remapPhoneKnown(K('Pictures/A/', 'Pictures/A/B/', 'Pictures/AB/'), folders, 'Pictures/A/', 'Pictures/새/'));
  assert.deepEqual(renamed, K('Pictures/새/', 'Pictures/새/B/', 'Pictures/AB/'));
  assert.equal(reconcilePhoneFolders({folders:F('Pictures/새/', 'Pictures/새/B/', 'Pictures/AB/'), off:new Set(), known:renamed}).offChanged, false, '스스로 바꾼 폴더는 꺼지지 않는다');
  assert.deepEqual(new Set(remapPhoneKnown(K('Pictures/A/', 'Pictures/AB/'), folders, 'Pictures/A/', null)), K('Pictures/AB/'));
  assert.ok(knownWith(known, 'Pictures/새 폴더/', new Set()).includes(phoneFolderKey('Pictures/새 폴더/')), '사진을 옮겨 넣은 새 폴더는 아는 폴더');
  assert.deepEqual(knownWith(known, 'Pictures/끔/', new Set(['Pictures/끔/'])), [...known]);
});

function fakePrefs(initial = {}, status = 'ok') {
  const v = {...initial}, sets = [];
  return {v, sets, get:k => v[k], set:(k, value, o) => { sets.push([k, value, o]); v[k] = value; return true; }, status:() => status};
}
function fakePhone(folders, state = {}) {
  let reads = 0;
  return {usable:true, state:() => ({hide:true, access:'full', key:'k'.repeat(22), ...state}), folders:async () => { reads++; return folders.slice(); }, get reads() { return reads; }};
}

test('맞춰 보기: 처음엔 아는 폴더만 저장, 새 폴더는 끈 목록에 저장(서버 칸, rejectable), 5분에 한 번만 폴더를 읽는다', async () => {
  let now = 1000;
  const prefs = fakePrefs({phone_folders_off:['Pictures/숨김/']});
  const folders = F('DCIM/Camera/', 'Pictures/숨김/');
  const phone = fakePhone(folders);
  const s = createPhoneFoldersSync({prefs, clock:() => now, win:null});
  const first = await s.sync(phone);
  assert.deepEqual(first.added, []);
  assert.deepEqual(prefs.sets.map(x => x[0]), ['phone_folders_known']);
  assert.deepEqual(prefs.sets[0][2], {rejectable:true});
  assert.deepEqual(prefs.v.phone_folders_off, ['Pictures/숨김/'], '처음엔 끈 목록 그대로');
  folders.push(...F('Pictures/Telegram/'));
  assert.deepEqual((await s.sync(phone)).added, [], '5분 안에는 다시 읽지 않음');
  assert.equal(phone.reads, 1);
  now += 5 * 60 * 1000;
  const next = await s.hideList(phone);
  assert.deepEqual(next.sort(), ['Pictures/Telegram/', 'Pictures/숨김/']);
  assert.deepEqual(prefs.v.phone_folders_off, ['Pictures/Telegram/', 'Pictures/숨김/']);
  // 폴더 목록을 넘기면(사진 [폴더] 탭) 기다리지 않고 그 목록으로 본다.
  assert.deepEqual((await s.sync(phone, {folders:[...folders, ...F('Pictures/또/')]})).added, ['Pictures/또/']);
});

test('맞춰 보지 않는 때: 고른 사진만 허용·옛 앱·화면 기억을 아직 못 읽음·폰 앱 밖 — 끈 목록 그대로', async () => {
  for (const [phone, status] of [[fakePhone(F('a/'), {access:'partial'}), 'ok'], [fakePhone(F('a/'), {hide:false}), 'ok'], [fakePhone(F('a/')), 'pending'], [{usable:false}, 'ok']]) {
    const prefs = fakePrefs({phone_folders_known:['00000000']}, status);
    const s = createPhoneFoldersSync({prefs, win:null});
    assert.deepEqual((await s.sync(phone)).added, []);
    assert.deepEqual(prefs.sets, []);
  }
});

test('DB 적용 전(아는 폴더 거절)에는 이 접속에서 다시 보내지 않고 새 폴더를 끄지 않는다', async () => {
  let now = 0;
  const handlers = [];
  const win = {addEventListener:(name, fn) => handlers.push([name, fn])};
  const prefs = fakePrefs({});
  const phone = fakePhone(F('DCIM/Camera/'));
  const s = createPhoneFoldersSync({prefs, clock:() => now, win});
  await s.sync(phone);
  // 서버 거절 → view-prefs가 값을 되돌리고 알린다.
  delete prefs.v.phone_folders_known;
  for (const [name, fn] of handlers) if (name === 'kptu:view-prefs-rejected') fn({detail:{paths:['phone_folders_known']}});
  now += 10 * 60 * 1000;
  const r = await s.sync(phone, {folders:F('DCIM/Camera/', 'Pictures/새/')});
  assert.deepEqual(r.added, []);
  assert.deepEqual(prefs.sets.map(x => x[0]), ['phone_folders_known'], '한 번만 보냈다');
});

test('사진·일기·시각 사진 줄이 폰 사진을 읽기 전에 맞춰 본다(새 폰 폴더 꺼진 채), 스위치가 아는 폴더도 고친다', () => {
  const photos = read('app/photos.js');
  assert.match(photos, /async function hideArg\(\) \{\n  const s = await syncPhoneFolders\(phone\);/);
  assert.doesNotMatch(photos, /(?<!await |function )hideArg\(\)/, '모든 읽기가 await hideArg()');
  assert.match(photos, /syncPhoneFolders\(phone, \{folders:list\}\)/);
  assert.match(photos, /function savePhoneOff\(next, known\) \{[\s\S]*?knownAfterOff\(currentPhoneKnown\(\), phoneOff, next[\s\S]*?if \(k\) savePhoneKnown\(k\);/);
  assert.match(photos, /remapPhoneKnown\(currentPhoneKnown\(\)/);
  assert.match(photos, /knownWith\(currentPhoneKnown\(\), to, phoneOff\)/);
  assert.match(read('app/diary.js'), /hide:await phoneHideList\(phone\)/);
  assert.match(read('app/time-photos.js'), /const hide = await phoneHideList\(phone\);/);
});
