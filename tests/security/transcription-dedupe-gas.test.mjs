import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// S69 녹음중복: docs/ops/transcription-dedupe.gs(전사 앱 스크립트 교체본)를 가짜 드라이브 위에서 돌린다.
// 네트워크·실제 드라이브 없음. 파일 이름·번호·md5는 모두 지어낸 것이다.
const source = readFileSync(new URL('../../docs/ops/transcription-dedupe.gs', import.meta.url), 'utf8');

const MB = 1024 * 1024;
const NOW = Date.parse('2026-11-24T03:00:00Z');
const iso = (h) => new Date(NOW - h * 3600 * 1000).toISOString();
const fid = (n) => 'FAKEfile' + String(n).padStart(6, '0') + 'xx';

function iterator(list) {
  let i = 0;
  return { hasNext: () => i < list.length, next: () => list[i++] };
}

/** 가짜 드라이브: 폴더·파일·바로가기·휴지통. 내용 없이 메타데이터만. */
function makeWorld() {
  const files = new Map();
  const calls = { trashed: [], moved: [], shortcuts: [], created: [] };
  let seq = 900;
  const add = (o) => { files.set(o.id, { trashed: false, mimeType: 'audio/mp4', createdTime: iso(1), modifiedTime: iso(1), ...o }); return o.id; };
  const folder = (id, name, parent) => add({ id, name, parent, mimeType: 'application/vnd.google-apps.folder', size: 0, md5: '' });
  const children = (pid) => [...files.values()].filter(f => f.parent === pid && !f.trashed);
  const fileObj = (id) => {
    const f = files.get(id);
    if (!f) throw new Error('없는 파일 ' + id);
    return {
      getId: () => f.id, getName: () => f.name, getSize: () => f.size, getMimeType: () => f.mimeType,
      getDateCreated: () => new Date(f.createdTime), getLastUpdated: () => new Date(f.modifiedTime),
      setTrashed: (v) => { f.trashed = !!v; calls.trashed.push(f.id); },
      moveTo: (dest) => { calls.moved.push([f.id, dest.getId()]); f.parent = dest.getId(); },
    };
  };
  const folderObj = (id) => ({
    getId: () => id,
    getName: () => files.get(id).name,
    getFoldersByName: (name) => iterator(children(id).filter(c => c.mimeType === 'application/vnd.google-apps.folder' && c.name === name).map(c => folderObj(c.id))),
    getFilesByName: (name) => iterator(children(id).filter(c => c.name === name).map(c => fileObj(c.id))),
    getFiles: () => iterator(children(id).filter(c => c.mimeType !== 'application/vnd.google-apps.folder').map(c => fileObj(c.id))),
    createFolder: (name) => folderObj(folder('FAKEfold' + (seq++) + 'zzzz', name, id)),
    createFile: (name, text) => { calls.created.push({ name, text, parent: id }); return fileObj(add({ id: 'FAKElog' + (seq++) + 'zzzzz', name, parent: id, mimeType: 'text/plain', size: text.length, md5: '' })); },
  });
  const props = new Map();
  const sandbox = {
    module: { exports: {} }, console: { error() {}, log() {} },
    Logger: { lines: [], log(s) { this.lines.push(String(s)); } },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({
      getProperties: () => Object.fromEntries(props), getProperty: (k) => props.has(k) ? props.get(k) : null,
      setProperty: (k, v) => props.set(k, String(v)), deleteProperty: (k) => props.delete(k),
    }) },
    ScriptApp: { getOAuthToken: () => 'fake-token' },
    Utilities: { formatDate: () => '20261124_1200' },
    MimeType: { PLAIN_TEXT: 'text/plain' },
    UrlFetchApp: { fetch(url) {
      const q = decodeURIComponent(/[?&]q=([^&]+)/.exec(url)[1]);
      const pid = /'([^']+)' in parents/.exec(q)[1];
      const list = children(pid).map(f => ({ id: f.id, name: f.name, size: String(f.size), md5Checksum: f.md5 || undefined, createdTime: f.createdTime,
        modifiedTime: f.modifiedTime, mimeType: f.mimeType, shortcutDetails: f.targetId ? { targetId: f.targetId } : undefined }));
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ files: list }) };
    } },
    DriveApp: {
      getFolderById: (id) => folderObj(id), getFileById: (id) => fileObj(id), getRootFolder: () => folderObj('root'),
      createShortcut: (target) => { const id = add({ id: 'FAKEshct' + (seq++) + 'zzzz', name: files.get(target).name, parent: 'root',
        mimeType: 'application/vnd.google-apps.shortcut', size: 0, md5: '', targetId: target }); calls.shortcuts.push([id, target]); return fileObj(id); },
      searchFiles: () => iterator([...files.values()].filter(f => !f.trashed && f.name.includes('__SRC_')).map(f => fileObj(f.id))),
    },
    Date: class extends Date { constructor(...a) { super(...(a.length ? a : [NOW])); } static now() { return NOW; } },
  };
  folder('root', '내 드라이브', null);
  vm.createContext(sandbox);
  // Code.gs에서 쓰는 이름(교체본 밖에 있는 것)을 옛 값 그대로 둔다.
  vm.runInContext(`
    const MANUAL_TRANSCRIPT_FOLDER_NAME = '수동전사대기';
    const MAX_OVERSIZE_MOVES_PER_RUN = 20;
    const MAX_UPLOAD_BYTES = 45 * 1024 * 1024;
    var PIPELINES = [];
    function transcriptionNeedsManualMove_(file, states) {
      const value = states['TRANSCRIBE_FAILURE_' + file.getId()];
      if (value) return true;
      return file.getSize() > MAX_UPLOAD_BYTES;
    }
  `, sandbox);
  vm.runInContext(source, sandbox, { filename: 'transcription-dedupe.gs' });
  return { sandbox, G: sandbox.module.exports, files, calls, props, add, folder, folderObj, fileObj, children };
}

/** 녹음 맨 위 폴더 + 원본·수동전사대기·전사. */
function makeRoot(w, prefix, name = '통화녹음') {
  const root = w.folder(prefix + 'root00000', name, 'root');
  return { root, source: w.folder(prefix + 'src000000', '원본', root), manual: w.folder(prefix + 'man000000', '수동전사대기', root), transcript: w.folder(prefix + 'txt000000', '전사', root) };
}

const plain = (o) => JSON.parse(JSON.stringify(o));

test('교체본 파일: 폴더 ID·드라이브 번호처럼 긴 글자·전화번호가 없다', () => {
  assert.ok(!/1[A-Za-z0-9_-]{30,}/.test(source), '드라이브 번호처럼 긴 글자가 없어야 한다');
  assert.ok(!/01[016789][\s-]?\d{3,4}[\s-]?\d{4}/.test(source), '전화번호가 없어야 한다');
  assert.ok(!/moveTo\(destination\)/.test(source), '녹음을 원본에서 옮기는 줄이 없어야 한다');
  assert.ok(!/setTrashed\(false\)|Drive\.Files\.remove|\.remove\(|files\/[^'"]*\?.*DELETE/i.test(source), '영구 삭제가 없어야 한다');
});

test('묶음 판단: 원본에 남은 것을 남기고 수동전사대기 사본은 휴지통, 대기 목록에는 바로가기', () => {
  const { G } = makeWorld();
  const files = [
    { id: fid(1), md5: 'aaa', size: 66 * MB, folder: 'manual', createdTime: iso(900) },
    ...Array.from({ length: 15 }, (_, i) => ({ id: fid(10 + i), md5: 'aaa', size: 66 * MB, folder: 'manual', createdTime: iso(800 - i) })),
    { id: fid(2), md5: 'aaa', size: 66 * MB, folder: 'source', createdTime: iso(700) },
    { id: fid(3), md5: 'bbb', size: 1 * MB, folder: 'source', createdTime: iso(5) },
  ];
  const groups = G.recordingGroupDuplicates_(files);
  assert.equal(groups.length, 1);
  const plan = G.recordingPlanGroup_(groups[0], new Set(), new Set());
  assert.deepEqual(plain(plan.keep), [fid(2)]);
  assert.equal(plan.trash.length, 16);
  assert.equal(plan.needShortcut, true);
  assert.equal(G.recordingSummaryLine_([plan]), '묶음 1개 · 휴지통 16개 · 줄인 용량 1.0GB');
});

test('묶음 판단: 기록이 가리키는 파일은 지우지 않고, 아무도 안 가리키면 가장 오래된 것 하나를 남긴다', () => {
  const { G } = makeWorld();
  const g = { key: 'x', files: [
    { id: fid(1), md5: 'x', size: 10, folder: 'manual', createdTime: iso(30) },
    { id: fid(2), md5: 'x', size: 10, folder: 'manual', createdTime: iso(20) },
    { id: fid(3), md5: 'x', size: 10, folder: 'manual', createdTime: iso(10) },
  ] };
  let plan = G.recordingPlanGroup_(g, new Set(), new Set());
  assert.deepEqual(plain(plan.keep), [fid(1)]);
  assert.deepEqual(plain(plan.trash), [fid(2), fid(3)]);
  assert.equal(plan.needShortcut, false);
  plan = G.recordingPlanGroup_(g, new Set([fid(3)]), new Set());
  assert.deepEqual(plain(plan.keep), [fid(3)]);
  assert.ok(!plan.trash.includes(fid(3)));
  // 기록이 가리키는 것 + 원본 사본은 둘 다 남긴다.
  const g2 = { key: 'y', files: [...g.files, { id: fid(4), md5: 'x', size: 10, folder: 'source', createdTime: iso(1) }] };
  plan = G.recordingPlanGroup_(g2, new Set([fid(3)]), new Set());
  assert.deepEqual(plain(plan.keep).sort(), [fid(3), fid(4)].sort());
  // 전사 중인 파일이 든 묶음은 손대지 않는다.
  plan = G.recordingPlanGroup_(g2, new Set(), new Set([fid(2)]));
  assert.equal(plan.skip, 'active');
  assert.equal(plan.trash.length, 0);
});

test('묶음 판단: 바로가기·md5 없는 것·크기 0은 묶지 않는다', () => {
  const { G } = makeWorld();
  const groups = G.recordingGroupDuplicates_([
    { id: fid(1), md5: '', size: 5, folder: 'source' }, { id: fid(2), md5: '', size: 5, folder: 'source' },
    { id: fid(3), md5: 'z', size: 0, folder: 'source' }, { id: fid(4), md5: 'z', size: 0, folder: 'source' },
    { id: fid(5), md5: 'q', size: 5, folder: 'manual', shortcut: true }, { id: fid(6), md5: 'q', size: 5, folder: 'manual' },
  ]);
  assert.equal(groups.length, 0);
});

test('작은 판단들: 막 올라온 녹음·분석 이름의 전사 번호·크기 바뀐 실패 기록', () => {
  const { G } = makeWorld();
  assert.equal(G.recordingIsSettled_(NOW - 5 * 60 * 1000, NOW - 5 * 60 * 1000, NOW), false);
  assert.equal(G.recordingIsSettled_(NOW - 60 * 60 * 1000, NOW - 11 * 60 * 1000, NOW), true);
  assert.deepEqual([...G.recordingSrcIdsFromNames_(['검토__통화 가상_261124_093000__SRC_' + fid(7) + '.md', '다른 파일.md'])], [fid(7)]);
  assert.equal(G.recordingFailureOutdated_({ size: 100 }, 200), true);
  assert.equal(G.recordingFailureOutdated_({ size: 100 }, 100), false);
  assert.equal(G.recordingFailureOutdated_({ count: 1 }, 200), false, '크기를 안 적은 옛 기록은 그대로');
  assert.deepEqual(plain(G.recordingIdList_(' ' + fid(1) + ', 이상한값,' + fid(2))), [fid(1), fid(2)]);
});

test('큰 녹음: 원본에서 옮기지 않고 바로가기 하나만, 다음 실행에서 또 만들지 않는다(백업 앱이 다시 올릴 일 없음)', () => {
  const w = makeWorld();
  const r = makeRoot(w, 'FAKEcall');
  w.sandbox.PIPELINES.push({ key: 'CALL', label: '통화녹음', rootFolderId: r.root });
  const big = w.add({ id: fid(1), name: '가상 녹음.m4a', size: 66 * MB, md5: 'aaa', parent: r.source, createdTime: iso(3), modifiedTime: iso(3) });
  const item = () => ({ pipeline: w.sandbox.PIPELINES[0], file: w.fileObj(big), transcriptFolder: w.folderObj(r.transcript), txtName: '가상 녹음.txt' });
  const one = w.G.transcriptionMoveManualCandidates_([item()]);
  assert.equal(one.moved, 1);
  assert.deepEqual(plain(one.movedIds), [big]);
  assert.equal(w.calls.moved.filter(([id]) => id === big).length, 0, '녹음 자체는 옮기지 않는다');
  assert.equal(w.files.get(big).parent, r.source);
  assert.equal(w.calls.shortcuts.length, 1);
  assert.equal(w.files.get(w.calls.shortcuts[0][0]).parent, r.manual, '바로가기는 수동전사대기에');
  const state = JSON.parse(w.props.get('TRANSCRIBE_FAILURE_' + big));
  assert.equal(state.status, 'manual');
  assert.equal(state.size, 66 * MB);
  assert.equal(state.errorCode, 'OVERSIZE');
  const two = w.G.transcriptionMoveManualCandidates_([item()]);
  assert.equal(w.calls.shortcuts.length, 1, '두 번째 실행에서 바로가기를 또 만들지 않는다');
  assert.deepEqual(plain(two.movedIds), [big], '그래도 이번 전사 후보에서는 뺀다');
});

test('원본 정돈: 같은 내용 녹음은 하나만 남기고 휴지통, 실패 기록은 남긴 쪽으로, 크기가 바뀌면 다시 전사 후보', () => {
  const w = makeWorld();
  const r = makeRoot(w, 'FAKEcall');
  const p = { key: 'CALL', label: '통화녹음', rootFolderId: r.root };
  const a = w.add({ id: fid(1), name: '가상.m4a', size: 5 * MB, md5: 'aaa', parent: r.source, createdTime: iso(10) });
  const b = w.add({ id: fid(2), name: '가상.m4a', size: 5 * MB, md5: 'aaa', parent: r.source, createdTime: iso(2) });
  const c = w.add({ id: fid(3), name: '다른.m4a', size: 7 * MB, md5: 'ccc', parent: r.source, createdTime: iso(5) });
  w.props.set('TRANSCRIBE_FAILURE_' + b, JSON.stringify({ count: 1, status: 'manual_pending' }));
  w.props.set('TRANSCRIBE_FAILURE_' + c, JSON.stringify({ count: 1, status: 'manual', size: 3 * MB, shortcutId: 'FAKEshortold01' }));
  w.add({ id: 'FAKEshortold01', name: '다른.m4a', size: 0, md5: '', parent: r.manual, mimeType: 'application/vnd.google-apps.shortcut', targetId: c });
  const trashed = w.G.recordingTidySource_(p, w.folderObj(r.source));
  assert.deepEqual([...trashed], [b]);
  assert.equal(w.files.get(a).trashed, false, '가장 오래된 것은 남는다');
  assert.equal(w.files.get(b).trashed, true);
  assert.ok(!w.props.has('TRANSCRIBE_FAILURE_' + b));
  assert.equal(JSON.parse(w.props.get('TRANSCRIBE_FAILURE_' + a)).size, 5 * MB, '실패 기록은 남긴 녹음으로');
  assert.ok(!w.props.has('TRANSCRIBE_FAILURE_' + c), '더 커진 녹음은 실패 기록을 풀어 다시 전사');
  assert.equal(w.files.get('FAKEshortold01').trashed, true, '풀린 녹음의 바로가기도 치운다');
});

test('이미 쌓인 중복 정리: 미리 보기는 아무것도 바꾸지 않고, 실제 정리는 휴지통만 + 기록 파일 + 결과 한 줄', () => {
  const w = makeWorld();
  const voice = makeRoot(w, 'FAKEvoic', '음성 녹음 백업');
  const keepSrc = w.add({ id: fid(100), name: '가상 강의.m4a', size: 66 * MB, md5: 'big1', parent: voice.source, createdTime: iso(700) });
  for (let i = 0; i < 16; i++) w.add({ id: fid(200 + i), name: '가상 강의.m4a', size: 66 * MB, md5: 'big1', parent: voice.manual, createdTime: iso(900 - i) });
  const keepSrc2 = w.add({ id: fid(300), name: '가상 지부.m4a', size: 48 * MB, md5: 'big2', parent: voice.source, createdTime: iso(700) });
  for (let i = 0; i < 12; i++) w.add({ id: fid(400 + i), name: '가상 지부.m4a', size: 48 * MB, md5: 'big2', parent: voice.manual, createdTime: iso(900 - i) });
  // 기록이 가리키는 파일(웹2 확인 뒤 넣은 번호)은 수동전사대기에 있어도 지우지 않는다.
  w.props.set('RECORDING_KEEP_IDS', fid(405));
  // 전사 TXT 두 벌 중 분석이 가리키는 쪽만 남는다.
  const call = makeRoot(w, 'FAKEcall');
  w.sandbox.PIPELINES.push({ key: 'CALL', label: '통화녹음', rootFolderId: call.root });
  const txtOld = w.add({ id: fid(500), name: '통화 가상.txt', size: 900, md5: 't1', parent: call.transcript, createdTime: iso(50), mimeType: 'text/plain' });
  const txtRef = w.add({ id: fid(501), name: '통화 가상.txt', size: 900, md5: 't1', parent: call.transcript, createdTime: iso(40), mimeType: 'text/plain' });
  w.add({ id: fid(502), name: '검토__통화 가상__SRC_' + txtRef + '.md', size: 100, md5: 'm1', parent: 'root', mimeType: 'text/markdown' });
  // 같은 md5라도 다른 맨 위 폴더끼리는 묶지 않는다.
  w.add({ id: fid(600), name: '복사본.m4a', size: 66 * MB, md5: 'big1', parent: call.source, createdTime: iso(1) });

  const preview = w.G.recordingCleanup_(true);
  assert.equal(preview, '묶음 3개 · 휴지통 28개 · 줄인 용량 1.5GB (미리 보기)');
  assert.equal(w.calls.trashed.length, 0, '미리 보기는 휴지통에 보내지 않는다');
  assert.equal(w.calls.shortcuts.length, 0);
  assert.equal(w.calls.created.length, 0);

  const line = w.G.recordingCleanup_(false);
  assert.equal(line, '묶음 3개 · 휴지통 28개 · 줄인 용량 1.5GB');
  assert.equal(w.files.get(keepSrc).trashed, false);
  assert.equal(w.files.get(keepSrc2).trashed, false);
  assert.equal(w.files.get(fid(405)).trashed, false, '기록이 가리키는 파일은 남는다');
  assert.equal(w.files.get(txtRef).trashed, false, '분석이 가리키는 전사 TXT는 남는다');
  assert.equal(w.files.get(txtOld).trashed, true);
  assert.equal(w.files.get(fid(600)).trashed, false);
  assert.equal(w.calls.moved.filter(([id]) => !id.startsWith('FAKEshct')).length, 0, '녹음을 옮기지 않는다');
  // 대기 목록이 비지 않게: 강의 녹음은 바로가기 하나(지부 녹음은 남긴 사본이 대기 폴더에 있어 바로가기 불필요).
  const shortcutTargets = w.calls.shortcuts.map(([, t]) => t);
  assert.deepEqual(shortcutTargets, [keepSrc]);
  assert.equal(JSON.parse(w.props.get('TRANSCRIBE_FAILURE_' + keepSrc)).status, 'manual');
  assert.equal(w.calls.created.length, 1, '실행 기록 파일 하나');
  assert.match(w.calls.created[0].name, /^중복정리기록_\d{8}_\d{4}\.txt$/);
  assert.equal(w.calls.created[0].text.split('\n').filter(l => l.startsWith('휴지통\t')).length, 28);
  // 다시 돌려도 더 지울 것이 없다(바로가기 대상은 기록이 가리키는 파일로 본다).
  assert.equal(w.G.recordingCleanup_(false), '묶음 0개 · 휴지통 0개 · 줄인 용량 0KB');
});
