import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {keptItem, keptItems, keptFilter, keptInFolder, keptMerge, deletePlan, deleteChoices, keepLogRows, keptIdsFor, folderKey} from '../app/photo-keep-model.mjs';
import {createPhonePhotos, restoreType} from '../app/phone-photos.js';
import {sortCompare} from '../app/photos-model.mjs';

// S48-17 PHOTO-지우기두갈래(요청함 11/01 00:27): 비운 사진 목록 섞기·지우기 두 갈래 계획·되돌리기 다리 말. 모두 지어낸 자료.
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const L = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const od = (id, taken, extra = {}) => ({id, name:id + '.jpg', day:taken.slice(0, 10), taken_at:taken, approx:false, kind:'photo', size_bytes:10, ...extra});
const ph = (n, taken, extra = {}) => ({kind:'phone', source:'phone', id:'ph:' + n, phoneId:String(n), name:`IMG_${n}.jpg`, taken_at:taken, day:taken.slice(0, 10), size_bytes:10, folder:'DCIM/Camera/', ...extra});
const cmp = sortCompare('taken_desc');

test('비운 사진 칸: 원드라이브 칸 + kept 표시, 찍은 시각은 폰에서 쓰던 것으로, 폴더는 끝 / 맞춤', () => {
  const k = keptItem({logId:L(1), phoneId:'9', relPath:'DCIM/Camera', takenAt:'2026-10-20T03:00:00.000Z', photo:od('K1', '2026-10-19T00:00:00.000Z', {kind:'video', duration_ms:3000})});
  assert.equal(k.kind, 'od'); assert.equal(k.source, 'onedrive'); assert.equal(k.id, 'K1');
  assert.equal(k.kept, true); assert.equal(k.keptId, L(1)); assert.equal(k.keptPath, 'DCIM/Camera/'); assert.equal(k.keptPhone, '9');
  assert.equal(k.taken_at, '2026-10-20T03:00:00.000Z'); assert.equal(k.video, true);
  // 찍은 시각이 없으면 원드라이브 것.
  assert.equal(keptItem({logId:L(2), photo:od('K2', '2026-10-19T00:00:00.000Z')}).taken_at, '2026-10-19T00:00:00.000Z');
  assert.equal(keptItem({logId:L(3)}), null);
  assert.equal(keptItems('x').length, 0);
  assert.equal(folderKey('DCIM/x'), 'DCIM/x/'); assert.equal(folderKey(''), ''); assert.equal(folderKey('a/'), 'a/');
});

test('거르기·폴더·섞기: 폰 목록을 다 받기 전에는 마지막 폰 칸보다 앞인 것만', () => {
  const k1 = keptItem({logId:L(1), relPath:'DCIM/Camera/', takenAt:'2026-10-30T00:00:00.000Z', photo:od('K1', '2026-10-30T00:00:00.000Z')});
  const k2 = keptItem({logId:L(2), relPath:'Pictures/Screenshots/', takenAt:'2026-10-10T00:00:00.000Z', photo:od('K2', '2026-10-10T00:00:00.000Z', {kind:'video', screenshot:true})});
  const kept = [k1, k2];
  assert.deepEqual(keptFilter(kept, {filter:'video'}).map(x => x.id), ['K2']);
  assert.deepEqual(keptFilter(kept, {filter:'shot'}).map(x => x.id), ['K2']);
  assert.deepEqual(keptFilter(kept, {filter:'star', isStarred:x => x.id === 'K1'}).map(x => x.id), ['K1']);
  assert.deepEqual(keptFilter(kept, {before:Date.parse('2026-10-20T00:00:00Z')}).map(x => x.id), ['K2']);
  assert.deepEqual(keptInFolder(kept, 'DCIM/Camera').map(x => x.id), ['K1']);
  assert.deepEqual(keptInFolder(kept, ''), []);
  const phones = [ph(1, '2026-10-31T00:00:00.000Z'), ph(2, '2026-10-20T00:00:00.000Z')];
  assert.deepEqual(keptMerge(phones, kept, false, cmp).map(x => x.id), ['ph:1', 'K1', 'ph:2']);
  assert.deepEqual(keptMerge(phones, kept, true, cmp).map(x => x.id), ['ph:1', 'K1', 'ph:2', 'K2']);
  assert.deepEqual(keptMerge([], kept, false, cmp), []);
  // 다시 섞어도 두 번 들어가지 않는다.
  assert.deepEqual(keptMerge(keptMerge(phones, kept, true, cmp), kept, true, cmp).map(x => x.id), ['ph:1', 'K1', 'ph:2', 'K2']);
});

test('지우기 두 갈래 계획: 공간만 비우기 = 원본 짝 있는 폰 사진만, 완전히 지우기 = 고른 것 모두 + 짝 사본', () => {
  const p1 = ph(1, '2026-10-31T00:00:00.000Z'), p2 = ph(2, '2026-10-30T00:00:00.000Z');
  const k = keptItem({logId:L(1), photo:od('K1', '2026-10-01T00:00:00.000Z')}), o = {kind:'od', id:'O9'}, g = {kind:'gdrive', id:'gd:1'};
  const plan = deletePlan([p1, p2, k, o, g], {pairs:[{item:p1, copy:{id:'C1'}}], noCopy:[p2]});
  assert.deepEqual(plan.space.map(x => [x.item.id, x.copyId]), [['ph:1', 'C1']]);
  assert.equal(plan.noCopy, 1); assert.equal(plan.full, 5); assert.deepEqual(plan.copies, ['C1']);
  assert.deepEqual(plan.phone.map(x => x.id), ['ph:1', 'ph:2']); assert.deepEqual(plan.od.map(x => x.id), ['K1', 'O9']); assert.deepEqual(plan.gd.map(x => x.id), ['gd:1']);
  assert.equal(plan.twoWay, true);
  // 원드라이브를 못 읽었으면 공간만 비우기 0장.
  assert.equal(deletePlan([p1], null).space.length, 0);
  // 원드라이브 사진만(비운 사진 아님)이면 두 갈래 창이 아니다(예전 지우기).
  assert.equal(deletePlan([o, g], null).twoWay, false);
  assert.equal(deletePlan([k], null).twoWay, true);
  const t = deleteChoices(plan);
  assert.equal(t.space.label, '폰 공간만 비우기 · 1장'); assert.equal(t.full.label, '완전히 지우기 · 5장');
  assert.equal(t.foot, '원드라이브에 원본이 없는 1장은 공간만 비우기에서 빠져요');
  assert.equal(deleteChoices(deletePlan([p1], {pairs:[{item:p1, copy:{id:'C1'}}]})).foot, '');
});

test('비운 기록 줄: 폰 번호·사본 id·원래 폴더·찍은 시각만(이름·크기 없음), keep=false면 폴더·시각도 없음', () => {
  const p1 = ph(1, '2026-10-31T00:00:00.000Z'), p2 = ph(2, '2026-10-30T00:00:00.000Z', {folder:null}), p3 = ph(3, '2026-10-29T00:00:00.000Z');
  const copyOf = new Map([['ph:1', 'C1'], ['ph:2', 'C2']]);
  assert.deepEqual(keepLogRows([p1, p2, p3], copyOf), [
    {phone_id:'1', copy_id:'C1', keep:true, rel_path:'DCIM/Camera/', taken_at:'2026-10-31T00:00:00.000Z'},
    {phone_id:'2', copy_id:'C2', keep:true, taken_at:'2026-10-30T00:00:00.000Z'}]);
  assert.deepEqual(keepLogRows([p1], copyOf, {keep:false}), [{phone_id:'1', copy_id:'C1', keep:false}]);
  const kept = [keptItem({logId:L(1), photo:od('C1', '2026-10-01T00:00:00.000Z')}), keptItem({logId:L(2), photo:od('C2', '2026-10-01T00:00:00.000Z')})];
  assert.deepEqual(keptIdsFor(kept, ['C2', 'X']), [L(2)]);
  assert.deepEqual(keptIdsFor(null, ['C2']), []);
});

function fakeApp({restore = true, answer} = {}) {
  const listeners = [], sent = [];
  const say = data => setTimeout(() => listeners.forEach(fn => fn({data})), 0);
  let got = 0;
  const win = {
    navigator: {userAgent: 'KPTUAndroid/0.4.11'},
    KPTUAppShell: {
      postMessage(m) {
        sent.push(m.startsWith('photos:save:part:') ? 'photos:save:part' : m);
        if (m === 'photos:hello') say(`photos:state:{"access":"full","key":"PhoneKeyForTest_0123456789","trash":true,"hide":true,"ops":true,"manage":false,"edit":true${restore ? ',"restore":true' : ''}}`);
        else if (answer) answer(m, say);
        else if (m.startsWith('photos:save:begin:')) { got = 0; say('photos:save:{"ok":true,"step":"begin","got":0,"error":""}'); }
        else if (m.startsWith('photos:save:part:')) { got += 1; say(`photos:save:{"ok":true,"step":"part","got":${got},"error":""}`); }
        else if (m === 'photos:save:end') say('photos:save:{"ok":true,"step":"end","got":1,"id":"88","error":""}');
      },
      addEventListener(type, fn) { if (type === 'message') listeners.push(fn); },
    },
  };
  return {win, sent};
}
test('[폰으로 되돌리기] 다리 말: 0.4.11(restore)만, 원래 폴더·찍은 시각, 동영상 받음, 크기 한도', async () => {
  const a = fakeApp(); const p = createPhonePhotos(a.win); await p.hello();
  assert.equal(p.canRestore(), true);
  const blob = new Blob([new Uint8Array(5)], {type:'video/mp4'});
  assert.deepEqual(await p.restore(blob, {name:'VID_1.mp4', dir:'DCIM/Camera/', taken:'2026-10-20T03:00:00.000Z'}), {ok:true, id:'88', error:''});
  assert.deepEqual(a.sent.filter(m => m.startsWith('photos:save')), [
    `photos:save:begin:{"name":"VID_1.mp4","mime":"video/mp4","size":5,"dir":"DCIM/Camera/","taken":${Date.parse('2026-10-20T03:00:00Z')}}`, 'photos:save:part', 'photos:save:end']);
  // 시각을 모르면 taken 없이.
  await p.restore(new Blob([new Uint8Array(3)], {type:'image/jpeg'}), {name:'a.jpg', dir:'DCIM/'});
  assert.ok(a.sent.includes('photos:save:begin:{"name":"a.jpg","mime":"image/jpeg","size":3,"dir":"DCIM/"}'));
  assert.deepEqual(await p.restore(new Blob([new Uint8Array(3)], {type:'application/pdf'}), {name:'a.pdf'}), {ok:false, id:'', error:'type'});
  // 옛 앱(restore 없음)·브라우저는 못 한다.
  const old = fakeApp({restore:false}); const q = createPhonePhotos(old.win); await q.hello();
  assert.equal(q.canRestore(), false);
  assert.deepEqual(await q.restore(blob, {dir:'DCIM/'}), {ok:false, id:'', error:'type'});
  assert.equal(createPhonePhotos({navigator:{userAgent:'Mozilla/5.0'}}).canRestore(), false);
  assert.equal(restoreType('application/octet-stream', 'clip.MOV'), 'video/quicktime');
  assert.equal(restoreType('image/png', 'x.mp4'), 'image/png');
});

test('화면 연결: [지우기] 두 갈래 창·[폰으로 되돌리기] 단추·비운 사진 섞기·비운 기록 지우기', () => {
  const src = read('app/photos.js'), notice = read('app/small-notice.js'), css = read('app/base-ui.css');
  assert.match(src, /if \(phone\.usable && deletePlan\(all, null\)\.twoWay\) \{ chooseDelete\(anchor, all\); return; \}/);
  assert.match(src, /data-photos-act-restore hidden>/);
  assert.match(src, /if \(u\.phone && !u\.onedrive && kept\?\.length\)/);
  assert.match(src, /void dropKept\(keptIdsFor\(kept, b\.taken/);
  assert.match(src, /if \(marks\(\) \|\| item\.kept\)/);
  assert.match(notice, /export function askChoice\(/);
  assert.match(css, /\.kptu-ask-pick\.is-danger/);
  // 기기 저장 금지(비운 사진 목록은 서버만).
  assert.doesNotMatch(read('app/photo-keep-model.mjs'), /localStorage|sessionStorage|indexedDB/);
});
