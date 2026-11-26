import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createDriveAuto, planAuto, planFolders, parseAutoRequest, registeredIds, appFolderIdsFrom, skipFolder, AUTO_NOTE, EVENT_FOLDER_NAME, RECENT_MS, ADD_MAX, FOLDER_MAKE_MAX,
} from '../../supabase/functions/library-files/drive-auto.mjs';
import { skipReason } from '../../supabase/functions/library-files/drive-skip.mjs';
import { EVENT_ATTACH_FOLDER } from '../../supabase/functions/_shared/event-attach-file.ts';

// S70-73 LIB-드라이브자동등록: 드라이브 'WORK ON+ › 자료실' 나무 안 새 파일 → 자료 등록. 네트워크·DB 없음(가짜 드라이브·가짜 표).
const id = s => (s + '____________').slice(0, 12);
const F = 'application/vnd.google-apps.folder';
const NOW = Date.parse('2026-11-26T09:00:00Z');
const OLD = '2026-11-20T00:00:00Z';
const M1 = 'a'.repeat(32), M2 = 'b'.repeat(32), M3 = 'c'.repeat(32);
const file = (key, name, parent, over = {}) => ({ id: id(key), name, mimeType: 'application/pdf', size: '100', md5Checksum: M1, createdTime: OLD, parents: [parent], ownedByMe: true, ...over });
const folder = (key, name, parent, over = {}) => ({ id: id(key), name, mimeType: F, parents: [parent], ownedByMe: true, ...over });
const LIB = id('lib'), ROOT = id('root'), OUT = id('outside');

// 가짜 supabase(표 이름 → 행 배열). select·eq·order·range·maybeSingle·not·in·insert·update·delete + rpc(app_library_folder_set_drive)만.
function fakeClient(tables, { failInsert = false } = {}) {
  const calls = [];
  // DB 함수 app_library_folder_set_drive 흉내: 휴지통 아닌 내 폴더, 지금 값 = p_expect, 같은 작업공간 다른 폴더(휴지통 포함)가 짝이면 taken.
  async function rpc(fn, a) {
    calls.push({ name: fn, op: 'rpc' });
    if (fn !== 'app_library_folder_set_drive') throw new Error('unexpected rpc ' + fn);
    const f = (tables.app_library_folders || []).find(r => r.id === a.p_id && !r.deleted_at);
    if (!f) return { data: null, error: { code: '42501' } };
    if ((f.drive_folder_id ?? null) !== a.p_expect) return { data: { ok: false }, error: null };
    if (tables.app_library_folders.some(o => o.workspace_id === f.workspace_id && o.drive_folder_id === a.p_drive && o.id !== f.id)) return { data: { ok: false, taken: true }, error: null };
    f.drive_folder_id = a.p_drive;
    return { data: { ok: true, id: f.id, drive_folder_id: a.p_drive }, error: null };
  }
  function from(name) {
    const t = (tables[name] ||= []);
    let filters = [], op = 'select', payload = null, wantRows = false;
    const rows = () => t.filter(r => filters.every(f => f(r)));
    const b = {
      select() { if (op !== 'select') wantRows = true; return b; },
      eq(k, v) { filters.push(r => r[k] === v); return b; },
      in(k, vs) { filters.push(r => vs.includes(r[k])); return b; },
      not(k, _is, _v) { filters.push(r => r[k] != null); return b; },
      order() { return b; },
      async range(a, z) { return { data: rows().slice(a, z + 1), error: null }; },
      async maybeSingle() { return { data: rows()[0] || null, error: null }; },
      insert(v) { op = 'insert'; payload = Array.isArray(v) ? v : [v]; return b; },
      update(v) { op = 'update'; payload = v; return b; },
      delete() { op = 'delete'; return b; },
      then(res, rej) {
        try {
          if (op === 'insert') {
            calls.push({ name, op, n: payload.length });
            if (failInsert && name === 'app_documents') return Promise.resolve({ data: null, error: { code: 'x' } }).then(res, rej);
            const made = payload.map((r, i) => ({ id: r.id || `${name}-${t.length + i + 1}`, ...r }));
            t.push(...made);
            if (name === 'app_documents' && tables.__receive) for (const d of made) (tables.app_library_folder_items ||= []).push({ document_id: d.id, folder_id: tables.__receive, workspace_id: d.workspace_id });
            return Promise.resolve({ data: wantRows ? made : null, error: null }).then(res, rej);
          }
          if (op === 'delete') {
            const hit = rows();
            for (const r of hit) r.deleted_at = 'now'; // 자료실 폴더 지우기 = 휴지통(트리거)
            calls.push({ name, op, n: hit.length });
            return Promise.resolve({ data: null, error: null }).then(res, rej);
          }
          if (op === 'update') {
            const hit = rows();
            for (const r of hit) Object.assign(r, payload);
            calls.push({ name, op, n: hit.length });
            return Promise.resolve({ data: wantRows ? hit : null, error: null }).then(res, rej);
          }
          return Promise.resolve({ data: rows(), error: null }).then(res, rej);
        } catch (e) { return Promise.reject(e).then(res, rej); }
      },
    };
    return b;
  }
  return { from, rpc, calls };
}
// 가짜 드라이브: 목록(q의 'x' in parents)·파일 하나·tokeninfo.
function fakeDrive(driveFiles, { scope = 'https://www.googleapis.com/auth/drive', extra = {} } = {}) {
  const seen = [];
  const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s });
  const fetch = async (url, init = {}) => {
    const s = String(url);
    seen.push(s);
    assert.equal(init.method === 'PATCH' || init.method === 'DELETE' || (init.method === 'POST' && !s.includes('tokeninfo')), false, '드라이브에 쓰지 않는다');
    if (s.startsWith('https://oauth2.googleapis.com/tokeninfo')) return json({ scope });
    if (s.startsWith('https://www.googleapis.com/drive/v3/files?')) {
      const q = new URL(s).searchParams.get('q');
      return json({ files: driveFiles.filter(f => f.trashed !== true && (f.parents || []).some(p => q.includes(`'${p}' in parents`))) });
    }
    const m = s.match(/\/files\/([^?]+)\?fields=/);
    if (m) { const fid = decodeURIComponent(m[1]); const f = driveFiles.find(x => x.id === fid) || extra[fid]; return f ? json(f) : json({}, 404); }
    throw new Error('unexpected ' + s);
  };
  return { fetch, seen };
}

function world(over = {}) {
  const driveFiles = [
    folder('lib', 'WORK ON+ 자료실', ROOT),
    folder('edu', '교육', LIB), folder('sub', '강의', id('edu')), folder('free', '드라이브에서 만든 폴더', LIB),
    folder('wait', '정리 대기', LIB), folder('task', '할 일 첨부', LIB), folder('event', EVENT_FOLDER_NAME, LIB), folder('mark', '아무 이름', LIB, { appProperties: { kptu_backup: '1' } }),
    folder('outside', '바깥 폴더', ROOT), folder('keyb', '폰 키 백업', LIB),
    file('keybf', '메모.txt', id('keyb'), { mimeType: 'text/plain', md5Checksum: '0'.repeat(32), size: '10' }),
    file('new1', '강의안.pdf', id('sub'), { md5Checksum: M2, size: '200' }),
    file('top1', '맨 위 파일.hwp', LIB, { md5Checksum: M3, size: '300' }),
    file('free1', '새 폴더 파일.pdf', id('free'), { md5Checksum: 'd'.repeat(32), size: '400' }),
    file('reg', '이미 있음.pdf', id('edu'), { md5Checksum: M1, size: '100' }),
    file('copy', '이미 있음 사본.pdf', id('edu'), { md5Checksum: M1, size: '100' }),
    file('waitf', '대기.pdf', id('wait'), { md5Checksum: 'e'.repeat(32), size: '1' }),
    file('taskf', '첨부.pdf', id('task'), { md5Checksum: 'f'.repeat(32), size: '2' }),
    file('evf', '일정 사진.jpg', id('event'), { mimeType: 'image/jpeg', md5Checksum: '1'.repeat(32), size: '3' }),
    file('markf', '백업.json', id('mark'), { mimeType: 'application/json', md5Checksum: '2'.repeat(32), size: '4' }),
    file('key', 'server.pem', LIB, { md5Checksum: '3'.repeat(32), size: '5' }),
    file('pw', '비밀번호 모음.xlsx', LIB, { md5Checksum: '4'.repeat(32), size: '6' }),
    file('tmp', 'Web2 글자 읽기 임시', LIB, { mimeType: 'application/vnd.google-apps.document', size: undefined, md5Checksum: undefined, appProperties: { web2_text_tmp: '1' } }),
    file('ops', 'Web2 요청함', LIB, { mimeType: 'application/vnd.google-apps.spreadsheet', size: undefined, md5Checksum: undefined }),
    file('short', '바로가기', LIB, { mimeType: 'application/vnd.google-apps.shortcut', size: undefined, md5Checksum: undefined }),
    file('zero', '빈 파일.txt', LIB, { mimeType: 'text/plain', size: '0', md5Checksum: undefined }),
    file('gdoc', '회의 메모', id('edu'), { mimeType: 'application/vnd.google-apps.document', size: undefined, md5Checksum: undefined }),
    file('others', '남이 올림.pdf', LIB, { ownedByMe: false, md5Checksum: '5'.repeat(32), size: '7' }),
    file('recent', '방금 올리는 중.pdf', LIB, { createdTime: new Date(NOW - 60000).toISOString(), md5Checksum: '6'.repeat(32), size: '8' }),
    file('outf', '바깥 파일.pdf', OUT, { md5Checksum: '7'.repeat(32), size: '9' }),
    ...(over.driveFiles || []),
  ];
  const tables = {
    app_drive_settings: [{ workspace_id: 'w1', library_folder_id: LIB, root_folder_id: ROOT, basket_folder_id: id('basket'), meetings_folder_id: null }],
    app_documents: [{ id: 'd-reg', workspace_id: 'w1', file_id: id('reg'), file_size: 100, mime_type: 'application/pdf', previous_files: [] }, ...(over.docs || [])],
    app_library_folders: [
      { id: 'af-edu', workspace_id: 'w1', drive_folder_id: id('edu'), deleted_at: null },
      { id: 'af-sub', workspace_id: 'w1', drive_folder_id: id('sub'), deleted_at: null },
      { id: 'af-recv', workspace_id: 'w1', drive_folder_id: null, deleted_at: null },
    ],
    app_library_folder_items: [{ document_id: 'd-reg', folder_id: 'af-edu', workspace_id: 'w1' }],
    app_task_attachments: [{ workspace_id: 'w1', drive_file_id: id('taskf') }],
    app_notes: [{ id: 'n1', workspace_id: 'w1', attachments: [{ drive_file_id: id('noteatt') }] }],
    __receive: 'af-recv',
    ...(over.tables || {}),
  };
  const admin = fakeClient(tables, over.adminOpts), db = fakeClient(tables);
  const dr = fakeDrive(driveFiles, over.driveOpts);
  const auto = createDriveAuto({ admin, db, fetch: dr.fetch, token: 't', workspaceId: 'w1', userId: 'u1', titleFor: n => n.replace(/\.[^.]+$/, ''), classify: () => ({ category: '기타', tags: [] }), now: () => NOW, log: () => {} });
  return { auto, tables, admin, db, dr, driveFiles };
}
const docsOf = (tables, ws = 'w1') => tables.app_documents.filter(d => d.workspace_id === ws);

test('자료실 드라이브 폴더에 새 파일 → 같은 자리 자료실 폴더의 자료로 등록(복사·이동 없음)', async () => {
  const { auto, tables } = world();
  const r = await auto.run();
  assert.equal(r.ok, true);
  const added = docsOf(tables).filter(d => d.classification_note === AUTO_NOTE);
  assert.deepEqual(added.map(d => d.file_name).sort(), ['강의안.pdf', '맨 위 파일.hwp', '새 폴더 파일.pdf', '회의 메모'].sort());
  assert.equal(r.added, 4);
  const itemOf = id => tables.app_library_folder_items.find(i => i.document_id === id)?.folder_id;
  const by = n => added.find(d => d.file_name === n);
  assert.equal(itemOf(by('강의안.pdf').id), 'af-sub', '짝 자료실 폴더(하위)로');
  assert.equal(itemOf(by('회의 메모').id), 'af-edu', '구글 문서는 링크형으로, 짝 폴더로');
  assert.equal(by('회의 메모').file_size, null);
  assert.equal(itemOf(by('맨 위 파일.hwp').id), 'af-recv', '자료실 맨 위 파일은 받는 폴더(트리거)');
  assert.equal(itemOf(by('새 폴더 파일.pdf').id), 'af-recv', '짝 자료실 폴더가 없는 드라이브 폴더 → 받는 폴더');
  for (const d of added) {
    assert.equal(d.visibility, 'private'); assert.equal(d.workspace_id, 'w1'); assert.equal(d.uploaded_by, 'u1');
    assert.match(d.drive_url, /^https:\/\/drive\.google\.com\//);
  }
});

test('같은 파일 두 번 등록 안 함(두 번째 확인은 0개)', async () => {
  const { auto, tables } = world();
  assert.equal((await auto.run()).added, 4);
  const before = tables.app_documents.length;
  const r2 = await auto.run();
  assert.equal(r2.added, 0);
  assert.equal(tables.app_documents.length, before);
  assert.ok(r2.skipped.registered >= 5);
});

test('같은 내용(md5 + 크기) 자료가 있으면 넣지 않음 — 나무 안 사본, 나무 밖 자료와 같은 것, 같은 번 두 개', async () => {
  const { auto, tables } = world({
    docs: [{ id: 'd-out', workspace_id: 'w1', file_id: id('outdoc'), file_size: 500, mime_type: 'application/pdf', previous_files: [] }],
    driveFiles: [
      file('same-out', '바깥 자료와 같음.pdf', LIB, { md5Checksum: '8'.repeat(32), size: '500' }),
      file('twinA', '쌍둥이 A.pdf', LIB, { md5Checksum: '9'.repeat(32), size: '600', createdTime: '2026-11-19T00:00:00Z' }),
      file('twinB', '쌍둥이 B.pdf', LIB, { md5Checksum: '9'.repeat(32), size: '600' }),
    ],
    driveOpts: { extra: { [id('outdoc')]: { id: id('outdoc'), md5Checksum: '8'.repeat(32), size: '500', trashed: false } } },
  });
  const r = await auto.run();
  const names = docsOf(tables).filter(d => d.classification_note === AUTO_NOTE).map(d => d.file_name);
  assert.equal(names.includes('이미 있음 사본.pdf'), false, '나무 안 자료와 같은 내용');
  assert.equal(names.includes('바깥 자료와 같음.pdf'), false, '나무 밖 자료와 같은 내용(드라이브에 md5만 물음)');
  assert.equal(names.includes('쌍둥이 A.pdf'), true);
  assert.equal(names.includes('쌍둥이 B.pdf'), false, '같은 번에 같은 내용은 먼저 만든 것 하나만');
  assert.equal(r.skipped.same, 3);
});

test('열쇠·비밀번호·앱 임시 문서·운영 문서·바로가기·0바이트·앱 폴더 안·남의 파일·올리는 중인 파일은 안 들어옴', async () => {
  const { auto, tables } = world();
  const r = await auto.run();
  const names = new Set(docsOf(tables).map(d => d.file_name));
  for (const n of ['server.pem', '비밀번호 모음.xlsx', 'Web2 글자 읽기 임시', 'Web2 요청함', '바로가기', '빈 파일.txt', '대기.pdf', '첨부.pdf', '일정 사진.jpg', '백업.json', '남이 올림.pdf', '방금 올리는 중.pdf', '메모.txt']) assert.equal(names.has(n), false, n);
  assert.deepEqual({ secret: r.skipped.secret, temp: r.skipped.temp, not_file: r.skipped.not_file, empty: r.skipped.empty, others: r.skipped.others, recent: r.skipped.recent },
    { secret: 2, temp: 2, not_file: 1, empty: 1, others: 1, recent: 1 });
});

test('자료실 밖 폴더 파일은 안 들어옴(나무 밖은 목록도 묻지 않음)', async () => {
  const { auto, tables, dr } = world();
  await auto.run();
  assert.equal(docsOf(tables).some(d => d.file_name === '바깥 파일.pdf'), false);
  for (const u of dr.seen.filter(s => s.includes('/files?'))) {
    const q = new URL(u).searchParams.get('q');
    assert.equal(q.includes(`'${OUT}' in parents`) || q.includes(`'${ROOT}' in parents`), false, '자료실 나무만 훑는다');
    for (const skip of ['wait', 'task', 'event', 'mark', 'keyb']) assert.equal(q.includes(`'${id(skip)}' in parents`), false, '앱 폴더 안으로 들어가지 않음: ' + skip);
  }
});

test('남의 작업공간에는 영향 없음: 내 작업공간 행만 읽고 넣는다', async () => {
  const other = { id: 'd-w2', workspace_id: 'w2', file_id: id('new1'), file_size: 200, mime_type: 'application/pdf', previous_files: [] };
  const { auto, tables } = world({ docs: [other], tables: { app_drive_settings: [{ workspace_id: 'w2', library_folder_id: id('w2lib') }, { workspace_id: 'w1', library_folder_id: LIB, root_folder_id: ROOT }] } });
  const w2Before = JSON.stringify(docsOf(tables, 'w2'));
  await auto.run();
  assert.equal(JSON.stringify(docsOf(tables, 'w2')), w2Before, '남의 자료는 그대로');
  assert.equal(docsOf(tables).some(d => d.file_name === '강의안.pdf'), true, '남의 작업공간에 같은 드라이브 id가 있어도 내 판정은 내 자료만으로');
  assert.equal(tables.app_documents.filter(d => d.classification_note === AUTO_NOTE).every(d => d.workspace_id === 'w1'), true);
});

test('드라이브 권한이 drive.file뿐이거나 자료실 폴더가 없으면 조용히 쉰다(아무것도 안 넣음)', async () => {
  const a = world({ driveOpts: { scope: 'https://www.googleapis.com/auth/drive.file' } });
  assert.deepEqual(await a.auto.run(), { ok: true, added: 0, code: 'scope_missing' });
  const b = world({ tables: { app_drive_settings: [{ workspace_id: 'w1', library_folder_id: null }] } });
  assert.deepEqual(await b.auto.run(), { ok: true, added: 0, code: 'library_missing' });
  assert.equal(docsOf(a.tables).length + docsOf(b.tables).length, 2);
});

test('파일이 드라이브에서 지워져도 자료는 지우지 않음(데이터 보존)', async () => {
  const { auto, tables, driveFiles } = world();
  await auto.run();
  const n = tables.app_documents.length;
  for (const f of driveFiles) if (f.name === '강의안.pdf') f.trashed = true;
  await auto.run();
  assert.equal(tables.app_documents.length, n);
  assert.equal(tables.app_documents.some(d => d.file_name === '강의안.pdf'), true);
});

test('넣기 실패면 센다(드라이브는 그대로)', async () => {
  const { auto } = world({ adminOpts: { failInsert: true } });
  const r = await auto.run();
  assert.equal(r.added, 0); assert.equal(r.failed, 4);
});

test('planAuto: 한 번에 ADD_MAX까지, 넘으면 more', () => {
  const files = Array.from({ length: ADD_MAX + 3 }, (_, i) => file('m' + i, `f${i}.pdf`, LIB, { md5Checksum: String(i).padStart(32, '0') }));
  const r = planAuto({ files, libraryId: LIB, now: NOW });
  assert.equal(r.add.length, ADD_MAX); assert.equal(r.more, true);
  const recent = planAuto({ files: [file('x', 'x.pdf', LIB, { createdTime: new Date(NOW - RECENT_MS + 1000).toISOString() })], libraryId: LIB, now: NOW });
  assert.equal(recent.add.length, 0); assert.equal(recent.skipped.recent, 1);
  const prev = registeredIds([{ file_id: id('a'), previous_files: [{ file_id: id('b') }] }]);
  assert.deepEqual([...prev].sort(), [id('a'), id('b')].sort(), '교체로 남긴 옛 파일도 이미 있음');
});

test('공용 거름(S70-69 drive-hidden-files.mjs 그대로) + 파일 아님·0바이트·찌꺼기·앱 표식', () => {
  for (const n of ['server.pem', 'id_rsa', 'release.keystore', '.env', 'service-account.json', '비밀번호.txt']) assert.equal(skipReason({ name: n, mimeType: 'application/octet-stream', size: '5' }), 'secret', n);
  assert.equal(skipReason({ name: 'Web2 요청함', mimeType: 'application/vnd.google-apps.spreadsheet' }), 'temp', '운영 문서');
  assert.equal(skipReason({ name: 'x.pdf', mimeType: 'application/pdf', size: '5', appProperties: { web2_ocr: '1' } }), 'temp');
  assert.equal(skipReason({ name: 'Thumbs.db', mimeType: 'application/octet-stream', size: '5' }), 'temp');
  assert.equal(skipReason({ mimeType: F }), 'folder');
  assert.equal(skipReason({ name: 's', mimeType: 'application/vnd.google-apps.shortcut' }), 'not_file');
  assert.equal(skipReason({ name: 'z.txt', mimeType: 'text/plain', size: '0' }), 'empty');
  assert.equal(skipReason({ name: 'x.pdf', mimeType: 'application/pdf', size: '5', appProperties: { kptu_summary: '1' } }), 'app');
  for (const n of ['2026 교섭 요구안.hwp', '회의록.docx', '사진.jpg']) assert.equal(skipReason({ name: n, mimeType: 'application/pdf', size: '5' }), null, n);
  assert.equal(skipFolder(folder('kb', '폰 키 백업', LIB), new Set()), true, '비밀값 보관 폴더 안으로 들어가지 않음');
});

test('앱 폴더: 설정의 다른 앱 폴더 id·이름·표식은 들어가지 않음, 자료실·맨 위는 남김', () => {
  const ids = appFolderIdsFrom({ library_folder_id: LIB, root_folder_id: ROOT, basket_folder_id: id('b'), meetings_folder_id: id('m'), workspace_id: 'w1' });
  assert.deepEqual([...ids].sort(), [id('b'), id('m')].sort());
  assert.equal(skipFolder(folder('q', '정리 대기', LIB), new Set()), true);
  assert.equal(skipFolder(folder('q', '교육', LIB), new Set()), false);
  assert.equal(EVENT_FOLDER_NAME, EVENT_ATTACH_FOLDER, '일정 첨부 폴더 이름이 서버 공용과 같음');
});

test('parseAutoRequest: action 하나만(작업공간·폴더 값 받지 않음)', () => {
  assert.deepEqual(parseAutoRequest({ action: 'drive-auto' }), { action: 'auto' });
  for (const v of [null, [], {}, { action: 'drive-auto', workspace_id: 'w2' }, { action: 'drive-auto', folder_id: LIB }, { action: 'drive-import-list', folder_id: LIB }]) assert.equal(parseAutoRequest(v), null);
});

test('index.ts: 자동 등록 갈래는 로그인 → 내 owner 작업공간 → 내 토큰 DB·내 구글 연결, 옛 가져오기 갈래는 없음', () => {
  const src = readFileSync(new URL('../../supabase/functions/library-files/index.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /drive-import/);
  const at = src.indexOf("input?.action==='drive-auto'");
  assert.ok(at > 0);
  const part = src.slice(at, at + 1100);
  assert.match(part, /parseAutoRequest\(input\)/);
  assert.match(part, /workspaceFor\(user\.id\)/);
  assert.match(part, /userDbFor\(req\)/);
  assert.match(part, /driveToken\(wmAuto\.workspace_id\)/);
  assert.doesNotMatch(part, /input\.workspace_id|input\.user_id|input\.folder_id/);
});

// ── S70-73b: 짝 폴더 아래 새 드라이브 하위 폴더 → 같은 이름 자료실 폴더(만들기·연결) + 그 안 파일은 그 폴더로 ──
const MEET = id('meet'), ORG = id('org');
const folderRows = t => t.app_library_folders.filter(f => !f.deleted_at);
function meetingWorld(over = {}) {
  return world({
    ...over,
    driveFiles: [
      folder('org', '03. 궤도', LIB), folder('meet', '회의', ORG),
      folder('mtA', '궤도협의회 대표자회의', MEET),
      file('mtA1', '회의록.hwp', id('mtA'), { md5Checksum: 'A'.repeat(32), size: '1001' }),
      ...(over.driveFiles || []),
    ],
    tables: {
      app_library_folders: [
        { id: 'af-edu', workspace_id: 'w1', parent_id: null, name: '교육', sort_order: 1, drive_folder_id: id('edu'), deleted_at: null },
        { id: 'af-sub', workspace_id: 'w1', parent_id: 'af-edu', name: '강의', sort_order: 1, drive_folder_id: id('sub'), deleted_at: null },
        { id: 'af-recv', workspace_id: 'w1', parent_id: null, name: '잡동사니', sort_order: 2, drive_folder_id: null, deleted_at: null },
        { id: 'af-org', workspace_id: 'w1', parent_id: null, name: '03. 궤도', sort_order: 3, drive_folder_id: ORG, deleted_at: null },
        { id: 'af-meet', workspace_id: 'w1', parent_id: 'af-org', name: '회의', sort_order: 1, drive_folder_id: MEET, deleted_at: null },
        ...((over.tables || {}).extraFolders || []),
      ],
    },
  });
}
const itemOf = (tables, docId) => tables.app_library_folder_items.find(i => i.document_id === docId)?.folder_id;
const docNamed = (tables, n) => tables.app_documents.find(d => d.file_name === n);

test('S70-73b ① 짝 폴더 아래 새 드라이브 하위 폴더 → 자료실 폴더 1개 생성(짝 연결) + 그 안 파일은 그 폴더로', async () => {
  const { auto, tables } = meetingWorld();
  const before = folderRows(tables).length;
  const r = await auto.run();
  const rows = folderRows(tables);
  assert.equal(rows.length, before + 1);
  const made = rows.find(f => f.drive_folder_id === id('mtA'));
  assert.ok(made, '짝 드라이브 폴더 id가 연결됨');
  assert.equal(made.name, '궤도협의회 대표자회의');
  assert.equal(made.parent_id, 'af-meet', '짝 폴더(회의) 아래');
  assert.equal(made.workspace_id, 'w1');
  assert.equal(r.folders_made, 1);
  assert.equal(itemOf(tables, docNamed(tables, '회의록.hwp').id), made.id, '잡동사니가 아니라 새 폴더로');
  // 두 번째 열기: 폴더도 자료도 더 생기지 않음
  const r2 = await auto.run();
  assert.equal(folderRows(tables).length, before + 1);
  assert.equal(r2.folders_made, 0); assert.equal(r2.added, 0);
});

test('S70-73b ② 두 단계 깊이도 위에서 아래로 같게', async () => {
  const { auto, tables } = meetingWorld({ driveFiles: [
    folder('mtB', '2026-11 정기회의', id('mtA')),
    file('mtB1', '안건.pdf', id('mtB'), { md5Checksum: 'B'.repeat(32), size: '1002' }),
  ] });
  const r = await auto.run();
  const a = folderRows(tables).find(f => f.drive_folder_id === id('mtA'));
  const b = folderRows(tables).find(f => f.drive_folder_id === id('mtB'));
  assert.ok(a && b);
  assert.equal(b.parent_id, a.id, '둘째 단은 첫째 단 아래');
  assert.equal(b.name, '2026-11 정기회의');
  assert.equal(r.folders_made, 2);
  assert.equal(itemOf(tables, docNamed(tables, '안건.pdf').id), b.id);
  assert.equal(itemOf(tables, docNamed(tables, '회의록.hwp').id), a.id);
});

test('S70-73b ③ 같은 부모 아래 같은 이름·짝 없는 자료실 폴더가 있으면 새로 만들지 않고 연결만(행 수 그대로)', async () => {
  const { auto, tables } = meetingWorld({ tables: { extraFolders: [
    { id: 'af-mtA', workspace_id: 'w1', parent_id: 'af-meet', name: '궤도협의회 대표자회의', sort_order: 1, drive_folder_id: null, deleted_at: null },
  ] } });
  const before = folderRows(tables).length;
  const r = await auto.run();
  assert.equal(folderRows(tables).length, before, '중복 폴더 없음');
  assert.equal(tables.app_library_folders.find(f => f.id === 'af-mtA').drive_folder_id, id('mtA'));
  assert.equal(r.folders_made, 0); assert.equal(r.folders_linked, 1);
  assert.equal(itemOf(tables, docNamed(tables, '회의록.hwp').id), 'af-mtA');
});

test('S70-73b ④ 앱 폴더 이름·앱 표식·비밀값 보관 폴더·예전 짝 표식·맨 위 바로 아래·긴 이름은 자료실 폴더를 만들지 않음', async () => {
  const { auto, tables } = meetingWorld({ driveFiles: [
    folder('mWait', '정리 대기', MEET), folder('mTask', '할 일 첨부', MEET), folder('mMark', '아무개', MEET, { appProperties: { kptu_basket: '1' } }),
    folder('mKey', '폰 키 백업', MEET), file('mKey1', '열쇠 메모.txt', id('mKey'), { mimeType: 'text/plain', md5Checksum: 'C'.repeat(32), size: '11' }),
    folder('mOld', '지운 폴더', MEET, { appProperties: { won_n: '12345678', won_p: MEET } }),
    file('mOld1', '지운 폴더 파일.pdf', id('mOld'), { md5Checksum: 'D'.repeat(32), size: '12' }),
    folder('mLong', '가'.repeat(41), MEET),
  ] });
  const r = await auto.run();
  const names = folderRows(tables).map(f => f.name);
  for (const n of ['정리 대기', '할 일 첨부', '아무개', '폰 키 백업', '지운 폴더', '가'.repeat(41), '드라이브에서 만든 폴더']) assert.equal(names.includes(n), false, n);
  assert.equal(names.includes('궤도협의회 대표자회의'), true);
  assert.equal(tables.app_documents.some(d => d.file_name === '열쇠 메모.txt'), false, '비밀값 보관 폴더 안 파일은 안 들어옴');
  assert.equal(itemOf(tables, docNamed(tables, '지운 폴더 파일.pdf').id), 'af-recv', '예전 짝 폴더 안 파일은 지금처럼 잡동사니');
  assert.equal(itemOf(tables, docNamed(tables, '새 폴더 파일.pdf').id), 'af-recv', '자료실 맨 위 바로 아래 새 폴더는 지금처럼');
  assert.equal(r.skipped.folder_stamped, 1); assert.equal(r.skipped.folder_name, 1);
  assert.equal(tables.app_library_folders.some(f => f.deleted_at), false, '만들었다 지운 폴더 없음');
});

test('S70-73b ⑤ 드라이브 쓰기 요청 없음(목록·파일 하나·tokeninfo만) + 짝 칸은 set_drive 함수로만', async () => {
  const { auto, dr, db } = meetingWorld({ driveFiles: [folder('mtB', '하위', id('mtA'))] });
  await auto.run();
  for (const u of dr.seen) assert.ok(u.startsWith('https://www.googleapis.com/drive/v3/files?') || /\/files\/[^?]+\?fields=/.test(u) || u.startsWith('https://oauth2.googleapis.com/tokeninfo'), u);
  const folderInserts = db.calls.filter(c => c.name === 'app_library_folders' && c.op === 'insert').length;
  assert.equal(folderInserts, 2);
  assert.equal(db.calls.filter(c => c.op === 'rpc' && c.name === 'app_library_folder_set_drive').length, 2);
  assert.equal(db.calls.some(c => c.name === 'app_library_folders' && c.op === 'update'), false, '폴더 표 직접 고치기 없음');
});

test('S70-73b 짝 연결이 거절되면(휴지통 폴더가 그 드라이브 폴더와 짝) 만든 폴더는 거두고 그 안 파일은 다음에', async () => {
  const { auto, tables } = meetingWorld({ tables: { extraFolders: [
    { id: 'af-gone', workspace_id: 'w1', parent_id: 'af-meet', name: '옛 이름', sort_order: 9, drive_folder_id: id('mtA'), deleted_at: 'old' },
  ] } });
  const r = await auto.run();
  assert.equal(folderRows(tables).some(f => f.name === '궤도협의회 대표자회의'), false);
  assert.equal(tables.app_documents.some(d => d.file_name === '회의록.hwp'), false, '잡동사니로 잘못 가지 않음');
  assert.equal(r.skipped.hold, 1); assert.equal(r.more, true); assert.equal(r.skipped.folder_failed, 1);
});

test('S70-73b planFolders: 한 번에 FOLDER_MAKE_MAX개까지, 넘친 폴더와 그 아래는 hold + more', () => {
  const kids = Array.from({ length: FOLDER_MAKE_MAX + 2 }, (_, i) => folder('k' + i, `폴더${i}`, MEET));
  const deep = folder('deepX', '아래', id('k' + (FOLDER_MAKE_MAX + 1)));
  const p = planFolders({ driveFolders: [...kids, deep], libraryId: LIB, pairOf: new Map([[MEET, 'af-meet']]) });
  assert.equal(p.steps.length, FOLDER_MAKE_MAX); assert.equal(p.more, true);
  assert.equal(p.hold.has(id('k' + (FOLDER_MAKE_MAX + 1))), true);
  assert.equal(p.hold.has(id('deepX')), true, '못 만든 폴더 아래도 다음에');
  const files = [file('h1', 'h.pdf', id('deepX'))];
  const a = planAuto({ files, libraryId: LIB, hold: p.hold, now: NOW });
  assert.equal(a.add.length, 0); assert.equal(a.skipped.hold, 1); assert.equal(a.more, true);
});
