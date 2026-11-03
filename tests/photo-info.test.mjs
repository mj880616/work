// S48-60 PHOTO-정보고치기: 계산(photo-info-model.mjs)과 앱 다리 말(phone-photos.js meta) 시험. 서버·폰 없이.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createPhonePhotos, metaItems} from '../app/phone-photos.js';
import {infoRows, cameraLine, planRows, writeItems, undoItems, recordRows, parsePlace, shiftMs, fromLocalValue, localValue, takenText, doneText, INFO_MAX} from '../app/photo-info-model.mjs';

const H = 3600000;
const T0 = Date.parse('2026-10-20T03:00:00Z'); // 서울 12:00
const item = (n, taken = T0 + n * 60000, extra = {}) => ({kind:'phone', phoneId:String(n), id:`ph:${n}`, name:`DSC0${n}.JPG`, taken_at:new Date(taken).toISOString(), ...extra});
const info = (n, taken = T0 + n * 60000, extra = {}) => ({id:String(n), taken, lat:null, lon:null, make:'SONY', model:'ILCE-7M4', lens:'FE 24-70mm', can:true, ...extra});
const rowsOf = (list, infos) => infoRows(list, new Map(infos.map(x => [x.id, x])));

test("12장 '모두 −8시간': 모두 8시간 앞으로, 순서 그대로, 앱에 시각만 보낸다", () => {
  const list = Array.from({length:12}, (_, i) => item(i + 1));
  const rows = rowsOf(list, list.map((_, i) => info(i + 1)));
  const plan = planRows(rows, {kind:'shift', ms:shiftMs({sign:-1, hours:8, minutes:0})});
  assert.equal(plan.filter(r => r.changed).length, 12);
  plan.forEach(r => assert.equal(r.after.taken, r.taken - 8 * H));
  const w = writeItems(plan);
  assert.equal(w.length, 12);
  assert.deepEqual(w[0], {id:'1', taken:T0 + 60000 - 8 * H});
  assert.ok(w.every(x => !('loc' in x)));
  // 되돌리기 = 기록의 앞 값.
  const rec = recordRows(plan, {workspaceId:'w', batchId:'b'});
  assert.equal(rec.length, 12);
  assert.deepEqual(rec[0], {workspace_id:'w', batch_id:'b', source:'phone', item_key:'ms:1', before_taken:new Date(T0 + 60000).toISOString(),
    after_taken:new Date(T0 + 60000 - 8 * H).toISOString(), loc_changed:false, before_lat:null, before_lon:null, after_lat:null, after_lon:null});
  assert.deepEqual(undoItems(rec)[0], {id:'1', taken:T0 + 60000});
  // 앱이 못 고친 사진은 기록하지 않는다.
  assert.equal(recordRows(plan, {workspaceId:'w', batchId:'b', failed:['3', '4']}).length, 10);
});

test('이 날짜로: 첫 장을 그 시각에, 나머지는 원래 간격 유지 · 범위 밖 시각은 그대로', () => {
  const list = [item(1, T0), item(2, T0 + 5 * 60000), item(3, T0 + 65 * 60000)];
  const rows = rowsOf(list, list.map(it => info(it.phoneId, Date.parse(it.taken_at))));
  const to = fromLocalValue('2025-05-01T09:30');
  assert.equal(to, Date.parse('2025-05-01T00:30:00Z'));
  const plan = planRows(rows, {kind:'date', ms:to});
  assert.deepEqual(plan.map(r => r.after.taken), [to, to + 5 * 60000, to + 65 * 60000]);
  const far = planRows(rows, {kind:'shift', ms:-60 * 365 * 24 * H});
  assert.ok(far.every(r => !r.changed && r.why === '시각이 범위를 벗어남'));
  assert.equal(localValue(to), '2025-05-01T09:30');
  assert.equal(takenText(to), '2025.05.01 09:30');
});

test('이 장소로·위치 지우기: 위치만 보내고, 기록은 앞 위치를 남긴다', () => {
  const list = [item(1), item(2)];
  const rows = rowsOf(list, [info(1, undefined, {lat:37.5, lon:127}), info(2)]);
  const loc = parsePlace('https://www.google.com/maps/@35.1795543,129.0756416,15z');
  assert.deepEqual(loc, {lat:35.179554, lon:129.075642});
  const plan = planRows(rows, {kind:'place', loc});
  assert.deepEqual(writeItems(plan), [{id:'1', loc}, {id:'2', loc}]);
  const rec = recordRows(plan, {workspaceId:'w', batchId:'b'});
  assert.equal(rec[0].loc_changed, true);
  assert.equal(rec[0].before_lat, 37.5);
  assert.equal(rec[0].after_taken, null);
  assert.deepEqual(undoItems(rec), [{id:'1', loc:{lat:37.5, lon:127}}, {id:'2', loc:null}]);
  // 위치가 없던 사진의 '지우기'는 바뀐 것 없음.
  const clear = planRows(rows, {kind:'clear'});
  assert.deepEqual(writeItems(clear), [{id:'1', loc:null}]);
  assert.equal(parsePlace('서울'), null);
  assert.equal(parsePlace('0, 0'), null);
  assert.equal(parsePlace('91, 10'), null);
  assert.deepEqual(parsePlace('37.5665, 126.978'), {lat:37.5665, lon:126.978});
});

test('못 고치는 사진(동영상·HEIC·폰에 없음)은 표에 남고 빠진다 · 카메라 줄은 보기만', () => {
  const list = [item(1), item(2, undefined, {video:true}), item(3), item(4)];
  const rows = rowsOf(list, [info(1), info(2), info(3, undefined, {can:false, model:'SM-F946N', make:'samsung', lens:''})]);
  assert.deepEqual(rows.map(r => [r.can, r.why]), [[true, ''], [false, '동영상'], [false, '이 종류는 못 고침'], [false, '폰에서 못 찾음']]);
  assert.deepEqual(writeItems(planRows(rows, {kind:'shift', ms:H})), [{id:'1', taken:T0 + 60000 + H}]);
  assert.equal(cameraLine(rows.slice(0, 1)), '카메라 SONY ILCE-7M4 · 렌즈 FE 24-70mm');
  assert.equal(cameraLine(rows), '카메라 여러 가지 · 렌즈 FE 24-70mm');
  assert.equal(doneText({count:10, failed:['1', '2']}), '10장 고쳤어요 · 2장은 못 고쳤어요');
  assert.equal(infoRows(Array.from({length:300}, (_, i) => item(i + 1)), new Map()).length, INFO_MAX);
  assert.equal(shiftMs({hours:-1}), null);
  assert.equal(shiftMs({minutes:60}), null);
});

function fakeApp({meta = true, answer} = {}) {
  const listeners = [], sent = [];
  const say = data => setTimeout(() => listeners.forEach(fn => fn({data})), 0);
  const win = {
    navigator:{userAgent:'KPTUAndroid/0.4.15'},
    KPTUAppShell:{
      postMessage(m) {
        sent.push(m);
        if (m === 'photos:hello') say(`photos:state:{"access":"full","key":"PhoneKeyForTest_0123456789","trash":true,"hide":true,"ops":true,"manage":false,"edit":true,"restore":true${meta ? ',"meta":true' : ''}}`);
        else answer?.(m, say);
      },
      addEventListener(type, fn) { if (type === 'message') listeners.push(fn); },
    },
  };
  return {win, sent};
}

test('다리 말: 0.4.15(meta)만, 읽기·고치기 모양, 이상한 답 버림', async () => {
  const a = fakeApp({answer:(m, say) => {
    if (m.startsWith('photos:meta:read:')) say('photos:meta:{"ok":true,"items":[{"id":"5","taken":1760929200000,"lat":37.5,"lon":127.0,"make":"SONY","model":"A\\u0001B","lens":"","can":true},{"id":"x","taken":1}],"error":""}');
    else if (m.startsWith('photos:meta:write:')) say('photos:metadone:{"ok":true,"count":1,"failed":["6","bad"],"error":""}');
  }});
  const p = createPhonePhotos(a.win); await p.hello();
  assert.equal(p.canMeta(), true);
  const r = await p.metaRead(['5', '5', 'nope']);
  assert.ok(a.sent.includes('photos:meta:read:["5"]'));
  assert.deepEqual(r, {ok:true, items:[{id:'5', taken:1760929200000, lat:37.5, lon:127, make:'SONY', model:'AB', lens:'', can:true}], error:''});
  const w = await p.metaWrite([{id:'5', taken:1760900400000}, {id:'6', loc:null}, {id:'7', loc:{lat:1, lon:2}}]);
  assert.ok(a.sent.includes('photos:meta:write:{"items":[{"id":"5","taken":1760900400000},{"id":"6","loc":null},{"id":"7","loc":{"lat":1,"lon":2}}]}'));
  assert.deepEqual(w, {ok:true, count:1, failed:['6'], error:''});
  // 옛 앱·브라우저는 못 한다.
  const old = fakeApp({meta:false}); const q = createPhonePhotos(old.win); await q.hello();
  assert.equal(q.canMeta(), false);
  assert.deepEqual(await q.metaWrite([{id:'5', taken:1}]), {ok:false, count:0, failed:[], error:'old'});
  assert.equal(createPhonePhotos({navigator:{userAgent:'Mozilla/5.0'}}).canMeta(), false);
  assert.deepEqual(metaItems([{id:'1', taken:5, lat:95, lon:1}]), [{id:'1', taken:5, lat:null, lon:null, make:'', model:'', lens:'', can:false}]);
});

test('연결: 사진 ⋯ 메뉴에 [정보 고치기…](폰 사진·앱 meta), 폰 앱 0.4.15, 위치 허락·EXIF 의존, DB 표 owner 전용', () => {
  const photos = readFileSync(new URL('../app/photos.js', import.meta.url), 'utf8');
  assert.match(photos, /phone\.canMeta\(\) && tab !== 'trash' \? menuBtn\('data-pm-info', '정보 고치기…'\)/);
  assert.match(photos, /import\('\.\/photo-info-edit\.js'\)/);
  const gradle = readFileSync(new URL('../android-app/app/build.gradle', import.meta.url), 'utf8');
  assert.match(gradle, /versionCode 55/);
  assert.match(gradle, /versionName '0\.4\.15'/);
  assert.match(gradle, /androidx\.exifinterface:exifinterface:/);
  const manifest = readFileSync(new URL('../android-app/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
  assert.match(manifest, /android\.permission\.ACCESS_MEDIA_LOCATION/);
  const sql = readFileSync(new URL('../supabase/migrations/20261103140000_photo_info_edits.sql', import.meta.url), 'utf8');
  assert.match(sql, /private\.app_is_workspace_owner\(workspace_id\)/);
  assert.doesNotMatch(sql, /\bto\s+(anon|public)\b/i);
  assert.doesNotMatch(sql, /grant delete/i);
  const edit = readFileSync(new URL('../app/photo-info-edit.js', import.meta.url), 'utf8');
  assert.doesNotMatch(edit, /localStorage|sessionStorage/);
});
