import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createDriveAuto, planAuto, parseAutoRequest, registeredIds, appFolderIdsFrom, skipFolder, AUTO_NOTE, EVENT_FOLDER_NAME, RECENT_MS, ADD_MAX,
} from '../../supabase/functions/library-files/drive-auto.mjs';
import { skipReason, isSecretName, isOpsName } from '../../supabase/functions/library-files/drive-skip.mjs';
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

// 가짜 supabase(표 이름 → 행 배열). select·eq·order·range·maybeSingle·not·in·insert·update만.
function fakeClient(tables, { failInsert = false } = {}) {
  const calls = [];
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
  return { from, calls };
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
    folder('outside', '바깥 폴더', ROOT),
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
  for (const n of ['server.pem', '비밀번호 모음.xlsx', 'Web2 글자 읽기 임시', 'Web2 요청함', '바로가기', '빈 파일.txt', '대기.pdf', '첨부.pdf', '일정 사진.jpg', '백업.json', '남이 올림.pdf', '방금 올리는 중.pdf']) assert.equal(names.has(n), false, n);
  assert.deepEqual({ secret: r.skipped.secret, temp: r.skipped.temp, ops: r.skipped.ops, not_file: r.skipped.not_file, empty: r.skipped.empty, others: r.skipped.others, recent: r.skipped.recent },
    { secret: 2, temp: 1, ops: 1, not_file: 1, empty: 1, others: 1, recent: 1 });
});

test('자료실 밖 폴더 파일은 안 들어옴(나무 밖은 목록도 묻지 않음)', async () => {
  const { auto, tables, dr } = world();
  await auto.run();
  assert.equal(docsOf(tables).some(d => d.file_name === '바깥 파일.pdf'), false);
  for (const u of dr.seen.filter(s => s.includes('/files?'))) {
    const q = new URL(u).searchParams.get('q');
    assert.equal(q.includes(`'${OUT}' in parents`) || q.includes(`'${ROOT}' in parents`), false, '자료실 나무만 훑는다');
    for (const skip of ['wait', 'task', 'event', 'mark']) assert.equal(q.includes(`'${id(skip)}' in parents`), false, '앱 폴더 안으로 들어가지 않음: ' + skip);
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

test('공용 거름: 열쇠·비밀번호·운영 문서 이름', () => {
  for (const n of ['server.pem', 'id_rsa', 'id_ed25519.pub', '.env', 'client_secret_123.json', 'credentials.json', 'service-account.json', 'signPri.key', '비밀번호.txt', '계정 정보.xlsx', 'backup.kdbx', 'vpn.ovpn']) assert.equal(isSecretName(n), true, n);
  for (const n of ['2026 교섭 요구안.hwp', '회의록.docx', '환경 개선 계획.pdf', '사진.jpg', 'environment report.pdf']) assert.equal(isSecretName(n), false, n);
  for (const n of ['Web2 요청함', '인계서 V70', '원장', '원장 백업 2026-11']) assert.equal(isOpsName(n), true, n);
  for (const n of ['원장님 면담.hwp', '요청서.pdf']) assert.equal(isOpsName(n), false, n);
  assert.equal(skipReason({ mimeType: F }), 'folder');
  assert.equal(skipReason({ name: 'Thumbs.db', mimeType: 'application/octet-stream', size: '5' }), 'temp');
  assert.equal(skipReason({ name: 'x.pdf', mimeType: 'application/pdf', size: '5', appProperties: { web2_ocr: '1' } }), 'temp');
  assert.equal(skipReason({ name: 'x.pdf', mimeType: 'application/pdf', size: '5', appProperties: { kptu_summary: '1' } }), 'app');
  assert.equal(skipReason({ name: 'x.pdf', mimeType: 'application/pdf', size: '5' }), null);
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
