// S71-02 MTG-회의자료폴더없애기: 회의 자료 드라이브 자리 = 자료실 드라이브 폴더 바로 아래(_shared/meeting-drive-place.mjs).
// 가짜 드라이브·가짜 설정만(네트워크·운영 값 없음). 폴더 id는 지어낸 값.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FOLDER_MIME, LIBRARY_FOLDER_NAME, MEETING_MARK, PlaceFail, RECORDING_FOLDER,
  meetingLibraryFolder, meetingRecordingFolder, meetingRoundFolder,
} from '../../supabase/functions/_shared/meeting-drive-place.mjs';
import { MIRROR_MARK } from '../../supabase/functions/_shared/library-mirror.mjs';
import { ROOT_FOLDER_NAME } from '../../supabase/functions/_shared/brand-folders.mjs';

const ID = s => (s + '_0000000000').slice(0, 16);
const ROOT = ID('root'), LIB = ID('library'), MEET = ID('meetings'), ROUND = ID('round');

// 가짜 드라이브: folders = id → {name, parent, trashed, appProperties}. 부른 요청을 모두 남긴다.
function fakeDrive(folders = {}, { failGet = null } = {}) {
  const calls = [];
  let n = 0;
  const childTrashed = id => { for (let cur = folders[id]; cur; cur = folders[cur.parent]) if (cur.trashed) return true; return false; };
  const drive = async (url, init = {}) => {
    const u = new URL(url), method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method, path: u.pathname, q: u.searchParams.get('q'), body });
    const ok = d => new Response(JSON.stringify(d), { status: 200 });
    if (method === 'POST') {
      const id = ID('made' + (++n));
      folders[id] = { name: body.name, parent: body.parents?.[0] ?? null, trashed: false, appProperties: body.appProperties || null };
      return ok({ id });
    }
    const m = u.pathname.match(/\/files\/([^/]+)$/);
    if (method === 'PATCH' && m) { const f = folders[m[1]]; if (f) f.appProperties = { ...(f.appProperties || {}), ...(body.appProperties || {}) }; return ok({ id: m[1] }); }
    if (method === 'GET' && m) {
      if (failGet) return new Response('{}', { status: failGet });
      const f = folders[m[1]];
      if (!f) return new Response(JSON.stringify({ error: { errors: [{ reason: 'notFound' }] } }), { status: 404 });
      return ok({ id: m[1], trashed: childTrashed(m[1]), mimeType: FOLDER_MIME });
    }
    if (method === 'GET') {
      const q = u.searchParams.get('q');
      const parent = q.match(/^'([^']+)' in parents/)[1], name = q.match(/name = '([^']+)'/)[1];
      const hit = Object.entries(folders).find(([id, f]) => f.parent === parent && f.name === name && !childTrashed(id));
      return ok({ files: hit ? [{ id: hit[0], ...(hit[1].appProperties ? { appProperties: hit[1].appProperties } : {}) }] : [] });
    }
    throw new Error('unexpected ' + method + ' ' + url);
  };
  return { drive, calls, folders, posts: () => calls.filter(c => c.method === 'POST') };
}
function fakeDb(row) {
  const saved = [];
  const state = { ...row };
  return { db: { settings: async () => ({ ...state }), save: async patch => { saved.push(patch); Object.assign(state, patch); } }, saved, state };
}
const roundStore = (id = null) => { const s = { id, saved: [] }; return { s, round: { get: async () => s.id, save: async v => { s.saved.push(v); s.id = v; } } }; };

test('① 새 회차 폴더의 부모 = 자료실 드라이브 폴더 (회의자료 폴더를 만들지 않음)', async () => {
  const d = fakeDrive({ [ROOT]: { name: '웹2' }, [LIB]: { name: '자료실', parent: ROOT }, [MEET]: { name: '회의자료', parent: ROOT } });
  const { db } = fakeDb({ root_folder_id: ROOT, library_folder_id: LIB, meetings_folder_id: MEET });
  const { s, round } = roundStore(null);
  const id = await meetingRoundFolder({ drive: d.drive, db }, { round, label: '정기회의 3차' });
  assert.equal(d.folders[id].parent, LIB);
  assert.equal(d.folders[id].name, '정기회의 3차');
  assert.deepEqual(s.saved, [id]);
  assert.equal(d.posts().length, 1);
  assert.ok(!d.posts().some(c => c.body.name === '회의자료'));
});

test('① 저장한 회차 폴더가 살아 있으면 드라이브에 한 번만 묻고 그대로 쓴다', async () => {
  const d = fakeDrive({ [LIB]: { name: '자료실' }, [ROUND]: { name: '정기회의 2차', parent: LIB } });
  const { db } = fakeDb({ library_folder_id: LIB });
  const { s, round } = roundStore(ROUND);
  assert.equal(await meetingRoundFolder({ drive: d.drive, db }, { round, label: 'x' }), ROUND);
  assert.equal(d.calls.length, 1);
  assert.deepEqual(s.saved, []);
});

test('② 회의 녹음 폴더의 부모 = 자료실 드라이브 폴더 + 앱 표식', async () => {
  const d = fakeDrive({ [ROOT]: { name: '웹2' }, [LIB]: { name: '자료실', parent: ROOT } });
  const { db, saved } = fakeDb({ root_folder_id: ROOT, library_folder_id: LIB, meetings_folder_id: null });
  const id = await meetingRecordingFolder({ drive: d.drive, db }, { create: true });
  assert.equal(d.folders[id].parent, LIB);
  assert.equal(d.folders[id].name, RECORDING_FOLDER);
  assert.equal(d.folders[id].appProperties[MEETING_MARK], 'recordings');
  assert.deepEqual(saved, []);
  // 다음 부름은 만든 폴더를 찾기만(새로 만들지 않음)
  assert.equal(await meetingRecordingFolder({ drive: d.drive, db }, { create: true }), id);
  assert.equal(d.posts().length, 1);
});

test('② 자료실 아래 회의 녹음이 있으면 그것(표식 없는 옛 폴더는 표식 한 번) · create=false면 없을 때 null', async () => {
  const OLD = ID('oldrec');
  const d = fakeDrive({ [LIB]: { name: '자료실' }, [OLD]: { name: RECORDING_FOLDER, parent: LIB } });
  const { db } = fakeDb({ library_folder_id: LIB });
  assert.equal(await meetingRecordingFolder({ drive: d.drive, db }, { create: false }), OLD);
  assert.equal(d.folders[OLD].appProperties[MEETING_MARK], 'recordings');
  const e = fakeDrive({ [LIB]: { name: '자료실' } });
  assert.equal(await meetingRecordingFolder({ drive: e.drive, db: fakeDb({ library_folder_id: LIB }).db }, { create: false }), null);
  assert.equal(e.posts().length, 0);
});

test('② 예전 자리(회의자료/회의 녹음)만 있으면 그 폴더를 계속 쓴다(진행 중 녹음 조각 보호, 새로 만들지 않음)', async () => {
  const OLD = ID('oldrec');
  const d = fakeDrive({ [LIB]: { name: '자료실' }, [MEET]: { name: '회의자료' }, [OLD]: { name: RECORDING_FOLDER, parent: MEET } });
  const { db, saved } = fakeDb({ library_folder_id: LIB, meetings_folder_id: MEET });
  assert.equal(await meetingRecordingFolder({ drive: d.drive, db }, { create: true }), OLD);
  assert.equal(d.posts().length, 0);
  assert.deepEqual(saved, []);
  // 예전 회의자료 폴더가 휴지통이면 자료실 아래 새로
  d.folders[MEET].trashed = true;
  const made = await meetingRecordingFolder({ drive: d.drive, db }, { create: true });
  assert.equal(d.folders[made].parent, LIB);
});

test('③ 저장한 회차 폴더가 휴지통이면 자료실 아래 새로 만들고 저장을 고친다', async () => {
  const d = fakeDrive({ [LIB]: { name: '자료실' }, [ROUND]: { name: '정기회의 2차', parent: LIB, trashed: true } });
  const { db } = fakeDb({ library_folder_id: LIB });
  const { s, round } = roundStore(ROUND);
  const id = await meetingRoundFolder({ drive: d.drive, db }, { round, label: '정기회의 2차' });
  assert.notEqual(id, ROUND);
  assert.equal(d.folders[id].parent, LIB);
  assert.deepEqual(s.saved, [id]);
});

test('③ 저장한 회차 폴더가 없음(404)이어도 새로 만든다', async () => {
  const d = fakeDrive({ [LIB]: { name: '자료실' } });
  const { round, s } = roundStore(ID('gone'));
  const id = await meetingRoundFolder({ drive: d.drive, db: fakeDb({ library_folder_id: LIB }).db }, { round, label: 'r' });
  assert.equal(d.folders[id].parent, LIB);
  assert.deepEqual(s.saved, [id]);
});

test('③ 자료실 폴더가 휴지통이면 자료실을 다시 만들어 설정을 고치고 그 아래에 둔다', async () => {
  const d = fakeDrive({ [ROOT]: { name: '웹2' }, [LIB]: { name: '자료실', parent: ROOT, trashed: true } });
  const { db, saved } = fakeDb({ root_folder_id: ROOT, library_folder_id: LIB });
  const id = await meetingRecordingFolder({ drive: d.drive, db }, { create: true });
  const lib = saved.find(p => p.library_folder_id)?.library_folder_id;
  assert.ok(lib && lib !== LIB);
  assert.equal(d.folders[lib].parent, ROOT);
  assert.equal(d.folders[lib].name, LIBRARY_FOLDER_NAME);
  assert.equal(d.folders[lib].appProperties[MIRROR_MARK], '1');
  assert.equal(d.folders[id].parent, lib);
  // 회차 폴더도 같은 규칙
  const { round } = roundStore(null);
  const r = await meetingRoundFolder({ drive: d.drive, db }, { round, label: 'r' });
  assert.equal(d.folders[r].parent, lib);
});

test('잠깐 실패(5xx)면 다시 만들지 않고 실패로 멈춘다', async () => {
  const d = fakeDrive({ [LIB]: { name: '자료실' }, [ROUND]: { name: 'r', parent: LIB } }, { failGet: 503 });
  const { round, s } = roundStore(ROUND);
  await assert.rejects(meetingRoundFolder({ drive: d.drive, db: fakeDb({ library_folder_id: LIB }).db }, { round, label: 'r' }), PlaceFail);
  assert.equal(d.posts().length, 0);
  assert.deepEqual(s.saved, []);
});

test('새 사용자: 맨 위 앱 폴더 → 자료실(맞춤 표시) → 회의 폴더, 모으기 한 번 (기존 자료실 만드는 길과 같은 모양)', async () => {
  const d = fakeDrive({});
  const { db, state } = fakeDb({});
  const gathered = [];
  const { round } = roundStore(null);
  const id = await meetingRoundFolder({ drive: d.drive, db, gather: async r => gathered.push(r) }, { round, label: '첫 회의' });
  assert.equal(d.folders[state.root_folder_id].name, ROOT_FOLDER_NAME);
  assert.equal(d.folders[state.root_folder_id].parent, null);
  assert.equal(d.folders[state.library_folder_id].parent, state.root_folder_id);
  assert.equal(d.folders[state.library_folder_id].appProperties[MIRROR_MARK], '1');
  assert.equal(d.folders[id].parent, state.library_folder_id);
  assert.deepEqual(gathered, [state.root_folder_id]);
  assert.ok(!('meetings_folder_id' in state));
  assert.equal(await meetingLibraryFolder({ drive: d.drive, db }, { verify: false }), state.library_folder_id);
});

test('④ 회의 서버 코드에 회의자료 폴더를 만드는 요청·meetings_folder_id 쓰기가 없다', () => {
  for (const path of ['supabase/functions/meeting-files/index.ts', 'supabase/functions/meeting-transcribe/index.ts', 'supabase/functions/_shared/meeting-drive-place.mjs']) {
    const src = readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /name\s*:\s*['"]회의자료['"]/, path);
    assert.doesNotMatch(src, /createFolder\([^)]*['"]회의자료['"]/, path);
    assert.doesNotMatch(src, /meetings_folder_id\s*:/, path + ' (meetings_folder_id를 쓰지 않음)');
    assert.doesNotMatch(src, /ensureMeetingsRoot/, path);
  }
  const files = readFileSync(new URL('../../supabase/functions/meeting-files/index.ts', import.meta.url), 'utf8');
  assert.match(files, /meetingRoundFolder/);
  const rec = readFileSync(new URL('../../supabase/functions/meeting-transcribe/index.ts', import.meta.url), 'utf8');
  assert.match(rec, /meetingRecordingFolder/);
});
