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
  const calls = { trashed: [], moved: [], shortcuts: [], created: [], batches: [], triggers: [], lists: 0, gets: 0, planWrites: 0 };
  const clock = { now: NOW, perTrash: 0, perList: 0, failIds: new Set(), failOnce: new Set() };
  const triggers = [{ handler: 'transcribeNewRecordings', uid: 'T-transcribe', kind: 'everyMinutes', minutes: 10 }];
  let triggerSeq = 1;
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
      isTrashed: () => !!f.trashed,
      getBlob: () => ({ getDataAsString: () => f.text || '' }),
      setContent: (t) => { f.text = String(t); calls.planWrites++; },
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
    createFile: (name, text) => { calls.created.push({ name, text, parent: id }); return fileObj(add({ id: 'FAKElog' + (seq++) + 'zzzzz', name, parent: id, mimeType: 'text/plain', size: text.length, md5: '', text })); },
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
    ScriptApp: {
      getOAuthToken: () => 'fake-token',
      getProjectTriggers: () => triggers.map(t => ({ getHandlerFunction: () => t.handler, getUniqueId: () => t.uid, _t: t })),
      deleteTrigger: (obj) => { const i = triggers.indexOf(obj._t); if (i >= 0) triggers.splice(i, 1); calls.triggers.push(['delete', obj._t.handler]); },
      newTrigger: (handler) => ({ timeBased: () => ({ after: (ms) => ({ create: () => {
        const t = { handler, uid: 'T-' + (triggerSeq++), kind: 'after', ms }; triggers.push(t); calls.triggers.push(['create', handler, ms]); return t;
      } }) }) }),
    },
    Utilities: { formatDate: () => '20261124_1200' },
    MimeType: { PLAIN_TEXT: 'text/plain' },
    UrlFetchApp: { fetch(url) {
      const q = decodeURIComponent(/[?&]q=([^&]+)/.exec(url)[1]);
      if (!/ in parents/.test(q)) {
        // 분석 결과 이름 찾기(이름만 돌려준다).
        assert.match(q, /name contains '검토__'/);
        const names = [...files.values()].filter(f => !f.trashed && (f.name.startsWith('검토__') || f.name.includes('__SRC_'))).map(f => ({ name: f.name }));
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ files: names }) };
      }
      calls.lists++;
      clock.now += clock.perList;
      const pid = /'([^']+)' in parents/.exec(q)[1];
      const list = children(pid).map(f => ({ id: f.id, name: f.name, size: String(f.size), md5Checksum: f.md5 || undefined, createdTime: f.createdTime,
        modifiedTime: f.modifiedTime, mimeType: f.mimeType, shortcutDetails: f.targetId ? { targetId: f.targetId } : undefined }));
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ files: list }) };
    },
    fetchAll(requests) {
      if (requests.every(r => r.method === 'get')) {
        // 보내기 직전 확인 조회(files.get): 있는지·휴지통인지·md5·크기.
        calls.gets += requests.length;
        return requests.map(r => {
          assert.match(r.url, /fields=id,trashed,md5Checksum,size/);
          const id = decodeURIComponent(/\/drive\/v3\/files\/([^?]+)\?/.exec(r.url)[1]);
          const f = files.get(id);
          if (!f) return { getResponseCode: () => 404, getContentText: () => '{}' };
          return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ id, trashed: !!f.trashed, md5Checksum: f.md5 || undefined, size: String(f.size) }) };
        });
      }
      calls.batches.push(requests.length);
      return requests.map(r => {
        assert.equal(r.method, 'patch');
        assert.deepEqual(JSON.parse(r.payload), { trashed: true });
        assert.equal(r.headers.Authorization, 'Bearer fake-token');
        const id = decodeURIComponent(/\/drive\/v3\/files\/([^?]+)\?/.exec(r.url)[1]);
        clock.now += clock.perTrash;
        if (clock.failIds.has(id)) return { getResponseCode: () => 429 };
        if (clock.failOnce.delete(id)) return { getResponseCode: () => 503 };
        const f = files.get(id);
        f.trashed = true;
        calls.trashed.push(id);
        return { getResponseCode: () => 200 };
      });
    } },
    DriveApp: {
      getFolderById: (id) => folderObj(id), getFileById: (id) => fileObj(id), getRootFolder: () => folderObj('root'),
      createShortcut: (target) => { const id = add({ id: 'FAKEshct' + (seq++) + 'zzzz', name: files.get(target).name, parent: 'root',
        mimeType: 'application/vnd.google-apps.shortcut', size: 0, md5: '', targetId: target }); calls.shortcuts.push([id, target]); return fileObj(id); },
      searchFiles: () => iterator([...files.values()].filter(f => !f.trashed && f.name.includes('__SRC_')).map(f => fileObj(f.id))),
    },
    Date: class extends Date { constructor(...a) { super(...(a.length ? a : [clock.now])); } static now() { return clock.now; } },
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
  return { sandbox, G: sandbox.module.exports, files, calls, props, add, folder, folderObj, fileObj, children, clock, triggers };
}

/** 녹음 맨 위 폴더 + 원본·수동전사대기·전사. */
function makeRoot(w, prefix, name = '통화녹음') {
  const root = w.folder(prefix + 'root00000', name, 'root');
  return { root, source: w.folder(prefix + 'src000000', '원본', root), manual: w.folder(prefix + 'man000000', '수동전사대기', root), transcript: w.folder(prefix + 'txt000000', '전사', root) };
}

const plain = (o) => JSON.parse(JSON.stringify(o));
/** 실행 기록 파일만(계획 파일 '중복정리계획.json'은 빼고). */
const logFiles = (w) => w.calls.created.filter(c => c.name.startsWith('중복정리기록_'));

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
  assert.equal(logFiles(w).length, 1, '실행 기록 파일 하나');
  assert.match(logFiles(w)[0].name, /^중복정리기록_\d{8}_\d{4}\.txt$/);
  assert.equal(logFiles(w)[0].text.split('\n').filter(l => l.startsWith('휴지통\t')).length, 28);
  // 다시 돌려도 더 지울 것이 없다(바로가기 대상은 기록이 가리키는 파일로 본다).
  assert.equal(w.G.recordingCleanup_(false), '묶음 0개 · 휴지통 0개 · 줄인 용량 0KB');
});

/** 음성 녹음 백업 맨 위 폴더에 '원본' 하나 + '수동전사대기' 사본 n개짜리 묶음을 groups개 만든다. */
function makeManyDuplicates(w, groups, copies) {
  const voice = makeRoot(w, 'FAKEvoic', '음성 녹음 백업');
  let n = 1000;
  for (let g = 0; g < groups; g++) {
    w.add({ id: fid(n++), name: '가상 ' + g + '.m4a', size: 10 * MB, md5: 'm' + g, parent: voice.source, createdTime: iso(900) });
    for (let c = 0; c < copies; c++) w.add({ id: fid(n++), name: '가상 ' + g + '.m4a', size: 10 * MB, md5: 'm' + g, parent: voice.manual, createdTime: iso(800 - c) });
  }
  return voice;
}

const cleanupTriggers = (w) => w.triggers.filter(t => t.handler === 'cleanupDuplicateRecordings');

test('휴지통 요청: Drive API files.update(trashed=true)를 50개씩 묶어 한꺼번에 보낸다(한 개씩 setTrashed 아님)', () => {
  const w = makeWorld();
  makeManyDuplicates(w, 6, 20); // 휴지통 120개
  const reqs = w.G.recordingTrashRequests_([fid(1), fid(2)], 'tok');
  assert.equal(reqs.length, 2);
  assert.equal(reqs[0].method, 'patch');
  assert.match(reqs[0].url, /^https:\/\/www\.googleapis\.com\/drive\/v3\/files\/FAKEfile000001xx\?/);
  assert.equal(reqs[0].payload, JSON.stringify({ trashed: true }));
  assert.equal(reqs[0].muteHttpExceptions, true);
  assert.deepEqual(plain(w.G.recordingChunks_([1, 2, 3, 4, 5], 2)), [[1, 2], [3, 4], [5]]);
  assert.equal(w.G.RECORDING_TRASH_BATCH, 50);
  assert.ok(w.G.RECORDING_CLEANUP_LIMIT >= 400);

  const line = w.G.cleanupDuplicateRecordings();
  assert.equal(line, '묶음 6개 · 휴지통 120개 · 줄인 용량 1.2GB');
  assert.deepEqual(w.calls.batches, [50, 50, 20]);
  assert.equal(w.calls.trashed.length, 120);
  assert.equal(cleanupTriggers(w).length, 0, '다 끝나면 이어 하기 트리거가 없다');
  const last = JSON.parse(w.props.get('RECORDING_CLEANUP_LAST'));
  assert.equal(last.done, true);
  assert.equal(last.remaining, 0);
});

test('시간 지키기: 4분 30초가 지나면 새로 보내지 않고 결과 한 줄·실행 기록 파일을 남기고, 5분 뒤 트리거를 하나만 건다', () => {
  const w = makeWorld();
  makeManyDuplicates(w, 10, 50); // 휴지통 500개(한 번 한도 400보다 많음)
  w.clock.perTrash = 2500; // 한 개에 2.5초 → 50개 묶음 하나에 125초
  const line = w.G.cleanupDuplicateRecordings();
  // 0초·125초에 묶음을 보내고, 250초 뒤 묶음 중간에서 270초를 넘기면 멈춘다(끊기지 않음).
  assert.equal(w.calls.trashed.length, 150, '세 번째 묶음까지 보낸 뒤 멈춘다');
  assert.match(line, /^묶음 10개 · 휴지통 500개 · 줄인 용량 4\.9GB · 이번에 휴지통 150개 · 남음 350개 · 한 번 더 실행\(5분 뒤 자동\) · 시간 한도\(4분 30초\)에서 멈춤$/);
  assert.equal(logFiles(w).length, 1, '끊기지 않고 실행 기록 파일을 남긴다');
  assert.equal(logFiles(w)[0].text.split('\n').filter(l => l.startsWith('휴지통\t')).length, 150);
  const last = JSON.parse(w.props.get('RECORDING_CLEANUP_LAST'));
  assert.equal(last.remaining, 350);
  assert.equal(last.done, false);
  assert.equal(cleanupTriggers(w).length, 1);
  assert.equal(cleanupTriggers(w)[0].ms, 5 * 60 * 1000);
  assert.ok(w.triggers.some(t => t.handler === 'transcribeNewRecordings'), '10분 전사 트리거는 그대로');

  // 사람이 한 번 더 눌러도 트리거는 하나뿐(이미 있으면 새로 안 건다).
  w.clock.now += 60 * 1000;
  w.G.cleanupDuplicateRecordings();
  assert.equal(cleanupTriggers(w).length, 1);

  // 트리거가 부른 실행: 자기 트리거는 지우고, 남았으면 새로 하나. 끝까지 이어 가면 트리거가 사라진다.
  w.clock.perTrash = 0;
  for (let i = 0; i < 5 && cleanupTriggers(w).length; i++) {
    w.clock.now += 5 * 60 * 1000;
    w.G.cleanupDuplicateRecordings({ triggerUid: cleanupTriggers(w)[0].uid });
    assert.ok(cleanupTriggers(w).length <= 1, '이어 하기 트리거는 언제나 하나 이하');
  }
  assert.equal(w.calls.trashed.length, 500);
  assert.equal(cleanupTriggers(w).length, 0, '다 끝나면 트리거를 지운다');
  assert.equal(w.triggers.filter(t => t.handler === 'transcribeNewRecordings').length, 1);
  assert.equal(JSON.parse(w.props.get('RECORDING_CLEANUP_LAST')).done, true);
  const voiceSource = [...w.files.values()].filter(f => f.parent === 'FAKEvoicsrc000000');
  assert.ok(voiceSource.every(f => !f.trashed), '원본 녹음은 하나도 휴지통에 가지 않는다');
});

test('휴지통 실패는 기록하고 다음 실행에서 다시, 하나도 못 보내면 자동 이어 하기를 걸지 않는다', () => {
  const w = makeWorld();
  makeManyDuplicates(w, 2, 3); // 휴지통 6개
  const bad = fid(1002);
  w.clock.failIds.add(bad);
  const line = w.G.cleanupDuplicateRecordings();
  assert.match(line, /이번에 휴지통 5개 · 남음 1개 · 한 번 더 실행\(5분 뒤 자동\) · 실패 1개\(다음 실행에서 다시\)/);
  assert.ok(logFiles(w)[0].text.includes('실패(HTTP 429, 다음 실행에서 다시)\t' + bad));
  assert.equal(cleanupTriggers(w).length, 1);
  // 계속 실패하면 같은 일을 되풀이하지 않는다.
  w.G.cleanupDuplicateRecordings({ triggerUid: cleanupTriggers(w)[0].uid });
  assert.equal(cleanupTriggers(w).length, 0);
  assert.match(w.G.cleanupDuplicateRecordings(), /자동 이어 하기 안 함\(확인 필요\)/);
  w.clock.failIds.clear();
  assert.equal(w.G.cleanupDuplicateRecordings(), '묶음 1개 · 휴지통 1개 · 줄인 용량 10MB');
});

test('다른 실행이 잠금을 쥐고 있으면 실제 정리는 멈추지 않고 5분 뒤 다시(트리거 하나), 미리 보기는 알려만 준다', () => {
  const w = makeWorld();
  makeManyDuplicates(w, 1, 2);
  w.sandbox.LockService.getScriptLock = () => ({ tryLock: () => false, releaseLock() {} });
  assert.throws(() => w.G.recordingCleanup_(true), /다른 실행이 진행 중/);
  assert.match(w.G.cleanupDuplicateRecordings(), /5분 뒤 자동으로 다시/);
  w.G.cleanupDuplicateRecordings();
  assert.equal(cleanupTriggers(w).length, 1);
  assert.equal(w.calls.trashed.length, 0);
});

const planOf = (w) => {
  const id = w.props.get('RECORDING_CLEANUP_PLAN_FILE');
  return id ? JSON.parse(w.files.get(id).text) : null;
};

test('계획 저장: 첫 실행이 계획 파일을 남기고, 이어 하기 실행은 폴더 목록을 다시 읽지 않고 남은 것만 보낸다(단계별 시간 기록)', () => {
  const w = makeWorld();
  makeManyDuplicates(w, 10, 50); // 휴지통 500개
  w.clock.perTrash = 2500;
  const first = w.G.cleanupDuplicateRecordings();
  assert.match(first, /이번에 휴지통 150개 · 남음 350개/);
  const planFile = w.calls.created.find(c => c.name === '중복정리계획.json');
  assert.ok(planFile, '계획 파일을 만든다');
  assert.equal(planFile.parent, 'FAKEvoicroot00000', '녹음 맨 위 폴더에');
  const plan = planOf(w);
  assert.equal(plan.groups.length, 10);
  assert.equal(plan.groups.reduce((n, g) => n + g.items.length, 0), 500);
  assert.equal(plan.groups.reduce((n, g) => n + g.items.filter(it => it.s === 't').length, 0), 150);
  assert.ok(!w.files.get(w.props.get('RECORDING_CLEANUP_PLAN_FILE')).text.includes('가상'), '계획 파일에 녹음 이름을 적지 않는다');
  const first_ = JSON.parse(w.props.get('RECORDING_CLEANUP_LAST'));
  assert.equal(first_.timing.mode, 'full');
  for (const k of ['list', 'protect', 'plan', 'verify', 'send', 'save', 'total', 'batches']) assert.equal(typeof first_.timing[k], 'number', k);
  assert.ok(first_.timing.send >= 375000, '보내기 시간이 잡힌다');
  assert.match(logFiles(w)[0].text.split('\n')[1], /^시간\(ms\) 전체 실행 · 목록 읽기 \d+ · 보호 확인 \d+ · 계획 \d+ · 확인 조회 \d+ · 보내기 \d+\(묶음 3개, 묶음당 125000\) · 저장 \d+ · 전체 \d+$/);

  // 트리거가 부른 이어 하기: 목록 읽기 0번, 남은 350개를 한 번에.
  w.clock.perTrash = 0;
  const listsBefore = w.calls.lists;
  w.clock.now += 5 * 60 * 1000;
  const second = w.G.cleanupDuplicateRecordings({ triggerUid: cleanupTriggers(w)[0].uid });
  assert.equal(w.calls.lists, listsBefore, '이어 하기는 폴더 목록을 다시 읽지 않는다');
  assert.equal(second, '묶음 10개 · 휴지통 500개 · 줄인 용량 4.9GB · 계획 이어 하기 · 이번에 휴지통 350개');
  assert.equal(w.calls.trashed.length, 500);
  assert.deepEqual(w.calls.batches.slice(3), [50, 50, 50, 50, 50, 50, 50], '50개씩 묶어 보낸다');
  assert.ok(w.calls.gets >= 500, '보내기 직전 하나하나 확인 조회');
  const last = JSON.parse(w.props.get('RECORDING_CLEANUP_LAST'));
  assert.equal(last.timing.mode, 'resume');
  assert.equal(last.timing.list, 0);
  assert.equal(last.done, true);
  assert.equal(cleanupTriggers(w).length, 0);
  assert.equal(planOf(w).done, true, '다 끝난 계획은 끝 표시');
  assert.equal(w.calls.created.filter(c => c.name === '중복정리계획.json').length, 1, '계획 파일은 하나를 고쳐 쓴다');
  // 다음 실행은 다시 전체 실행(목록 읽음), 더 지울 것 없음.
  assert.equal(w.G.cleanupDuplicateRecordings(), '묶음 0개 · 휴지통 0개 · 줄인 용량 0KB');
  assert.ok(w.calls.lists > listsBefore);
});

test('목록 읽기에 시간을 다 써도 계획은 저장하고 이어 간다 + 이어 하기에서 바뀐 파일·남길 파일이 사라진 묶음·이미 없는 파일은 건너뛰고 다음 전체 실행에서 다시 계획', () => {
  const w = makeWorld();
  makeManyDuplicates(w, 3, 3); // 묶음 3개 × 휴지통 3개. 번호: 묶음0 1000(원본),1001~1003 / 묶음1 1004,1005~1007 / 묶음2 1008,1009~1011
  w.clock.perList = 100 * 1000; // 폴더 하나 읽는 데 100초 → 세 폴더면 4분 30초를 넘는다
  const first = w.G.cleanupDuplicateRecordings();
  assert.equal(w.calls.trashed.length, 0);
  assert.match(first, /이번에 휴지통 0개 · 남음 9개 · 한 번 더 실행\(5분 뒤 자동\) · 시간 한도\(4분 30초\)에서 멈춤$/);
  assert.doesNotMatch(first, /자동 이어 하기 안 함/, '하나도 못 보냈어도 계획이 있으니 이어 한다');
  assert.equal(cleanupTriggers(w).length, 1);
  assert.equal(planOf(w).groups.length, 3);

  // 그사이: 묶음0 사본 하나 내용이 바뀜, 묶음1 남길 원본이 사라짐(휴지통), 묶음2 사본 하나는 이미 휴지통.
  w.files.get(fid(1001)).md5 = 'changed';
  w.files.get(fid(1004)).trashed = true;
  w.files.get(fid(1009)).trashed = true;
  w.clock.perList = 0;
  const listsBefore = w.calls.lists;
  w.clock.now += 5 * 60 * 1000;
  const second = w.G.cleanupDuplicateRecordings({ triggerUid: cleanupTriggers(w)[0].uid });
  assert.equal(w.calls.lists, listsBefore, '목록을 다시 읽지 않는다');
  assert.match(second, /계획 이어 하기 · 이번에 휴지통 4개 · 남음 4개 · 한 번 더 실행\(5분 뒤 자동\) · 이미 없음 1개 · 건너뜀 4개\(다음 전체 실행에서 다시 계획\)/);
  assert.equal(w.files.get(fid(1001)).trashed, false, '내용이 바뀐 파일은 보내지 않는다');
  for (const n of [1005, 1006, 1007]) assert.equal(w.files.get(fid(n)).trashed, false, '남길 파일이 사라진 묶음은 건너뛴다');
  for (const n of [1002, 1003, 1010, 1011]) assert.equal(w.files.get(fid(n)).trashed, true);
  assert.equal(planOf(w).done, true, '남은 게 건너뛴 것뿐이면 계획을 끝내 다음은 전체 실행');

  // 다음(전체 실행): 다시 읽어 새로 계획. 바뀐 파일은 이제 짝이 없고, 원본이 사라진 묶음은 가장 오래된 사본 하나를 남긴다.
  w.clock.now += 5 * 60 * 1000;
  const third = w.G.cleanupDuplicateRecordings({ triggerUid: cleanupTriggers(w)[0].uid });
  assert.ok(w.calls.lists > listsBefore, '전체 실행은 목록을 읽는다');
  assert.equal(third, '묶음 1개 · 휴지통 2개 · 줄인 용량 20MB · 이름만 같고 내용이 다른 녹음 1묶음(그대로 둠)');
  assert.equal(w.files.get(fid(1005)).trashed, false, '가장 오래된 사본은 남는다');
  assert.equal(w.files.get(fid(1006)).trashed, true);
  assert.equal(w.files.get(fid(1007)).trashed, true);
  assert.equal(cleanupTriggers(w).length, 0);
});

test('하루 넘은 계획은 버리고 목록을 다시 읽는다, 이어 하기 중 새로 보호된 파일은 보내지 않는다', () => {
  const w = makeWorld();
  makeManyDuplicates(w, 2, 2); // 묶음0 1000,1001,1002 / 묶음1 1003,1004,1005
  w.clock.perList = 100 * 1000;
  w.G.cleanupDuplicateRecordings();
  assert.equal(planOf(w).groups.length, 2);
  w.clock.perList = 0;
  // 하루 넘게 지남 → 전체 실행.
  w.clock.now += w.G.RECORDING_PLAN_MAX_AGE_MS + 1000;
  const lists = w.calls.lists;
  w.props.set('RECORDING_KEEP_IDS', fid(1001));
  w.add({ id: fid(1900), name: '검토__가상__SRC_' + fid(1004) + '.md', size: 10, md5: 'mm', parent: 'root', mimeType: 'text/markdown' });
  const line = w.G.cleanupDuplicateRecordings({ triggerUid: cleanupTriggers(w)[0].uid });
  assert.ok(w.calls.lists > lists, '오래된 계획은 쓰지 않는다');
  assert.equal(line, '묶음 2개 · 휴지통 2개 · 줄인 용량 20MB');
  assert.equal(w.files.get(fid(1001)).trashed, false);
  assert.equal(w.files.get(fid(1004)).trashed, false);

  // 이어 하기 중 보호: 계획을 만든 뒤 새 분석 결과가 사본을 가리키면 건너뛴다.
  const w2 = makeWorld();
  makeManyDuplicates(w2, 1, 3); // 1000 원본, 1001~1003
  w2.clock.perList = 100 * 1000;
  w2.G.cleanupDuplicateRecordings();
  w2.clock.perList = 0;
  w2.add({ id: fid(1901), name: '검토__가상__SRC_' + fid(1002) + '.md', size: 10, md5: 'mm', parent: 'root', mimeType: 'text/markdown' });
  w2.props.set('RECORDING_KEEP_IDS', fid(1003));
  w2.clock.now += 5 * 60 * 1000;
  const l2 = w2.G.cleanupDuplicateRecordings({ triggerUid: cleanupTriggers(w2)[0].uid });
  assert.match(l2, /계획 이어 하기 · 이번에 휴지통 1개 · 남음 2개.* · 건너뜀 2개/);
  assert.equal(w2.files.get(fid(1002)).trashed, false);
  assert.equal(w2.files.get(fid(1003)).trashed, false);
  assert.equal(w2.files.get(fid(1001)).trashed, true);
  // 다음 전체 실행은 보호된 두 개를 남기고 끝(되풀이하지 않음).
  w2.clock.now += 5 * 60 * 1000;
  assert.equal(w2.G.cleanupDuplicateRecordings({ triggerUid: cleanupTriggers(w2)[0].uid }), '묶음 0개 · 휴지통 0개 · 줄인 용량 0KB');
  assert.equal(cleanupTriggers(w2).length, 0);
});

test('일시 오류(503 등)는 같은 실행에서 한 번 다시 보낸다', () => {
  const w = makeWorld();
  makeManyDuplicates(w, 1, 4);
  w.clock.failOnce.add(fid(1002));
  w.clock.failOnce.add(fid(1003));
  const line = w.G.cleanupDuplicateRecordings();
  assert.equal(line, '묶음 1개 · 휴지통 4개 · 줄인 용량 40MB');
  assert.deepEqual(w.calls.batches, [4, 2], '실패한 두 개만 다시');
  assert.equal(w.calls.trashed.length, 4);
  assert.equal(w.G.recordingRetryable_(429), true);
  assert.equal(w.G.recordingRetryable_(404), false);
  assert.equal(w.G.recordingRetryable_(0), true);
});

test('작은 판단들: 계획 쓸 수 있는지·확인 조회 판정·남은 수', () => {
  const { G } = makeWorld();
  const doc = { v: 1, createdAt: NOW, groups: [{ items: [{ s: 't' }, {}, { s: 'c' }, { s: 'g' }] }], done: false };
  assert.equal(G.recordingPlanUsable_(doc, NOW + 1000), true);
  assert.equal(G.recordingPlanUsable_({ ...doc, done: true }, NOW), false);
  assert.equal(G.recordingPlanUsable_(doc, NOW + G.RECORDING_PLAN_MAX_AGE_MS), false);
  assert.equal(G.recordingPlanUsable_({ ...doc, v: 0 }, NOW), false);
  assert.deepEqual(plain(G.recordingPlanCounts_(doc)), { pending: 1, skipped: 1 });
  const item = { md5: 'a', size: 5 };
  assert.equal(G.recordingVerifyItem_(item, { code: 200, md5: 'a', size: 5 }), 'send');
  assert.equal(G.recordingVerifyItem_(item, { code: 200, md5: 'a', size: 5, trashed: true }), 'gone');
  assert.equal(G.recordingVerifyItem_(item, { code: 404 }), 'gone');
  assert.equal(G.recordingVerifyItem_(item, { code: 200, md5: 'b', size: 5 }), 'changed');
  assert.equal(G.recordingVerifyItem_(item, { code: 200, md5: 'a', size: 6 }), 'changed');
  assert.equal(G.recordingVerifyItem_(item, { code: 500 }), 'error');
  assert.equal(G.recordingKeeperOk_(item, { code: 200, md5: 'a', size: 5 }), true);
  assert.equal(G.recordingKeeperOk_(item, { code: 404 }), false);
});
