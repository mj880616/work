import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// S46-24 ④ 사진 화면 구글 드라이브 칸: 화면 쪽 길(app/gdrive-photos.js)과 사진 화면 연결(app/photos.js)의 규칙. 네트워크 없음(지어낸 fetch).
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const code = src => src.split('\n').filter(line => !/^\s*\/\//.test(line)).join('\n');

test('쓰기 동작은 모두 confirm:true를 붙여 gdrive-photos 함수에만 보낸다(영구 삭제 없음)', () => {
  const s = code(read('app/gdrive-photos.js'));
  for (const action of ['rename', 'move', 'trash', 'folder-create', 'folder-rename', 'folder-trash']) {
    const line = s.split('\n').find(l => l.includes(`action:'${action}'`));
    assert.ok(line, action);
    assert.match(line, /confirm:true/, `${action}는 confirm:true`);
  }
  for (const action of ['status', 'folders', 'folder-toggle', 'sync', 'list', 'thumb', 'media']) assert.match(s, new RegExp(`action:'${action}'`));
  assert.doesNotMatch(s, /files\.delete|emptyTrash|action:'delete'|permanent/i);
  // 부르는 곳: gdrive-photos·자료실과 같은 Drive 다시 연결(public-policy-drive drive-start)·app_my_features 뿐.
  const urls = [...s.matchAll(/'(\/(?:functions|rest)\/v1\/[^']+)'/g)].map(m => m[1]).sort();
  assert.deepEqual(urls, ['/functions/v1/gdrive-photos', '/functions/v1/public-policy-drive', '/rest/v1/rpc/app_my_features']);
  assert.match(s, /action:'drive-start'/);
});

test('기기 저장 없음: 그림은 이 탭 메모리(blob: 주소, 상한)만', () => {
  for (const file of ['app/gdrive-photos.js']) {
    const s = code(read(file));
    // 낱말을 나눠 쓴다(저장소 점검 workflow가 이 시험 파일을 잡지 않게).
    const banned = new RegExp(['local' + 'Storage', 'session' + 'Storage', 'indexed' + 'DB', 'cach' + 'es\\.', 'ODThumbCache', 'keepStore'].join('|'));
    assert.doesNotMatch(s, banned, file);
  }
  assert.match(read('app/gdrive-photos.js'), /const PARALLEL = 4, KEEP = 300;/);
});

test('썸네일 대기열: 한 번에 4장까지, 차례 전 거두기, 같은 그림은 다시 받지 않음', async () => {
  const calls = [], waits = [];
  globalThis.fetch = (url, init) => { calls.push(JSON.parse(init.body)); return new Promise(ok => waits.push(() => ok(new Response(new Blob([new Uint8Array([1])], {type:'image/jpeg'}), {status:200, headers:{'content-type':'image/jpeg'}})))); };
  let n = 0;
  URL.createObjectURL = () => `blob:test/${++n}`;
  URL.revokeObjectURL = () => {};
  const {gdThumbUrl} = await import('../app/gdrive-photos.js');
  const rt = {config:{url:'https://sb.test', key:'anon'}, session:{ensure:async () => true, read:() => ({access_token:'t'})}};
  const jobs = Array.from({length:6}, (_, i) => gdThumbUrl(rt, `id${i}`, 'small', 'owner-a'));
  await new Promise(r => setTimeout(r, 0));
  assert.equal(calls.length, 4, '처음엔 4장만');
  jobs[5].cancel();
  await assert.rejects(jobs[5].promise, e => e.dropped === true);
  waits.shift()();
  await jobs[0].promise;
  await new Promise(r => setTimeout(r, 0));
  assert.equal(calls.length, 5, '하나 끝나면 다음 하나(거둔 것은 안 받음)');
  assert.deepEqual(calls.map(c => c.id), ['id0', 'id1', 'id2', 'id3', 'id4']);
  assert.ok(calls.every(c => c.action === 'thumb' && c.size === 'small'));
  const again = gdThumbUrl(rt, 'id0', 'small', 'owner-a');
  assert.equal(await again.promise, await jobs[0].promise, '받은 그림은 메모리에서');
  assert.equal(calls.length, 5);
  while (waits.length) waits.shift()();
});

test('사진 화면: 칩은 운영자 기능이 있을 때만, 지우기는 확인 창 한 번 + 30일 안내, 권한 없음 안내·다시 연결', () => {
  const s = read('app/photos.js');
  assert.match(s, /const allowed = gdriveAllowed\(await myFeatures\(rt\)\);/);
  assert.match(s, /data-photos-src="gdrive" aria-pressed="false" aria-label="구글 드라이브" title="구글 드라이브" hidden>/);
  assert.match(s, /sourceButtons\(sources, \{phone:phone\.available\(\), gdrive:gd\.allowed, gdriveProblem:gd\.problem\}\)/);
  const trash = s.slice(s.indexOf('async function gdTrashPicked'), s.indexOf('const gdName'));
  assert.ok(trash.indexOf('askConfirm') >= 0 && trash.indexOf('askConfirm') < trash.indexOf('gdTrash(rt'), '사진 지우기는 확인 뒤에만');
  assert.match(s, /const TRASH_NOTE_GD = '드라이브 휴지통에서 30일 안에 되살릴 수 있어요';/);
  const ftrash = s.slice(s.indexOf('async function gdTrashFolder'), s.indexOf('function gdFolderClick'));
  assert.ok(ftrash.indexOf('askConfirm') >= 0 && ftrash.indexOf('askConfirm') < ftrash.indexOf('gdFolderTrash(rt'), '폴더 지우기는 확인 뒤에만');
  assert.match(s, /data-photos-gd-reconnect>Drive 다시 연결<\/button>/);
  assert.match(s, /menuBtn\('data-gdm-reconnect', 'Drive 다시 연결'\)/);
  // 크게 보기에서 묻지 않고 지우는 길은 구글 드라이브에 쓰지 않는다.
  assert.match(s, /item\?\.kind === 'gdrive' \? \{ok:false,/);
  // 구글 드라이브 사진은 별표·앨범에 넣지 않는다(표가 원드라이브·폰만 안다).
  assert.match(s, /구글 드라이브 사진은 아직 앨범에 못 넣어요/);
  assert.match(s, /if \(item\.kind === 'gdrive'\) \{ photoStripNote\('구글 드라이브 사진은 아직 별표를 못 해요\.'\); return; \}/);
});

test('자료실: 연결 뒤 photos=scope_missing이면 사진 권한만 빠졌다고 알리고 주소에서 지운다', () => {
  const s = read('app/library-upload.js');
  assert.match(s, /photos==='scope_missing'/);
  assert.match(s, /u\.searchParams\.delete\('photos'\)/);
});
