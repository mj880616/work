import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createPhonePhotos, base64, saveType} from '../app/phone-photos.js';

// PHOTO-갤러리편집(요청함 11/01 19:00, A안): 웹 쪽 다리 말(편집·받기)과 [편집] 단추 자리.
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

function fakeApp({edit = true, ua = 'KPTUAndroid/0.4.6', answer} = {}) {
  const listeners = [], sent = [];
  const say = data => setTimeout(() => listeners.forEach(fn => fn({data})), 0);
  const win = {
    navigator: {userAgent: ua},
    KPTUAppShell: {
      postMessage(m) {
        sent.push(m);
        if (m === 'photos:hello') say(`photos:state:{"access":"full","key":"PhoneKeyForTest_0123456789","trash":true,"hide":true,"ops":true,"manage":false${edit ? ',"edit":true' : ''}}`);
        else answer?.(m, say);
      },
      addEventListener(type, fn) { if (type === 'message') listeners.push(fn); },
    },
  };
  return {win, sent};
}

test('편집 가능 여부: 0.4.6 앱(상태 edit)만, 옛 앱·브라우저는 아니다', async () => {
  const a = fakeApp(); const p = createPhonePhotos(a.win); await p.hello();
  assert.equal(p.canEdit(), true);
  const old = fakeApp({edit: false}); const q = createPhonePhotos(old.win); await q.hello();
  assert.equal(q.canEdit(), false);
  assert.deepEqual(await q.edit({kind: 'phone', phoneId: '1'}), {ok: false, changed: false, error: 'old'});
  const web = createPhonePhotos({navigator: {userAgent: 'Mozilla/5.0'}});
  assert.equal(web.canEdit(), false);
});

test('편집 말: 폰 사진은 번호, 다른 출처는 이름·크기·찍은 시각, 동영상은 보내지 않음', async () => {
  const a = fakeApp({answer: (m, say) => { if (m.startsWith('photos:edit:')) say(m.includes('"id"') ? 'photos:edited:{"ok":true,"changed":true,"error":""}' : 'photos:edited:{"ok":false,"changed":false,"error":"none"}'); }});
  const p = createPhonePhotos(a.win); await p.hello();
  assert.deepEqual(await p.edit({kind: 'phone', phoneId: '12'}), {ok: true, changed: true, error: ''});
  assert.deepEqual(await p.edit({kind: 'od', name: 'a.jpg', size_bytes: 5, taken_at: '2026-10-30T03:00:00.000Z'}), {ok: false, changed: false, error: 'none'});
  assert.deepEqual(await p.edit({kind: 'phone', phoneId: '3', video: true}), {ok: false, changed: false, error: 'old'});
  assert.deepEqual(a.sent.filter(m => m.startsWith('photos:edit:')), ['photos:edit:{"id":"12"}', `photos:edit:{"name":"a.jpg","size":5,"taken":${Date.parse('2026-10-30T03:00:00.000Z')}}`]);
});

test('받기: 384KB씩 조각, 끝에 번호, 실패하면 취소', async () => {
  let got = 0;
  const a = fakeApp({answer: (m, say) => {
    if (m.startsWith('photos:save:begin:')) say('photos:save:{"ok":true,"step":"begin","got":0,"error":""}');
    else if (m.startsWith('photos:save:part:')) { got += Buffer.from(m.slice(17), 'base64').length; say(`photos:save:{"ok":true,"step":"part","got":${got},"error":""}`); }
    else if (m === 'photos:save:end') say(`photos:save:{"ok":true,"step":"end","got":${got},"id":"77","error":""}`);
  }});
  const p = createPhonePhotos(a.win); await p.hello();
  const bytes = new Uint8Array(900 * 1024).map((_, i) => i % 251);
  const res = await p.save(new Blob([bytes], {type: 'image/jpeg'}), 'x.jpg');
  assert.deepEqual(res, {ok: true, id: '77', error: ''});
  assert.equal(got, bytes.length);
  assert.equal(a.sent.filter(m => m.startsWith('photos:save:part:')).length, 3);
  assert.ok(a.sent.every(m => m.length < 700_000 + 40));
  assert.deepEqual(await p.save(new Blob([new Uint8Array(1)], {type: 'video/mp4'}), 'a.mp4'), {ok: false, id: '', error: 'type'});
  const bad = fakeApp({answer: (m, say) => { if (m.startsWith('photos:save:begin:')) say('photos:save:{"ok":true,"step":"begin","got":0,"error":""}'); else if (m.startsWith('photos:save:part:')) say('photos:save:{"ok":false,"step":"part","got":0,"error":"failed"}'); }});
  const q = createPhonePhotos(bad.win); await q.hello();
  assert.equal((await q.save(new Blob([new Uint8Array(10)], {type: 'image/png'}), 'a.png')).ok, false);
  assert.equal(bad.sent.at(-1), 'photos:save:cancel');
});

test('그림 종류·base64', () => {
  assert.equal(saveType('application/octet-stream', 'IMG_1.HEIC'), 'image/heic');
  assert.equal(saveType('image/jpeg; charset=x', ''), 'image/jpeg');
  assert.equal(saveType('', 'a.txt'), '');
  assert.equal(base64(new Uint8Array([65, 66, 67])), 'QUJD');
});

test('[편집] 단추: 크게 보기 공용 부품에 숨겨 두고 사진 메뉴만 켠다(일기는 그대로), 웹2 자체 편집기 없음', () => {
  const strip = read('app/photo-strip.js'), photos = read('app/photos.js'), diary = read('app/diary.js');
  assert.match(strip, /data-strip-edit hidden/);
  assert.match(photos, /editable, edit:item => editOne\(item\)/);
  assert.doesNotMatch(diary, /editable/);
  assert.doesNotMatch(photos, /<canvas|getContext\(/, '편집은 갤러리 앱에 맡긴다');
});
