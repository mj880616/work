import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// ORG-기록첨부이름반영(S60-14): 첨부 이름을 고치면 조직·사업 기록 줄 글·띠도 새 이름, 띠에서 바로 고치기, ✎ 간격.
const events = [];
globalThis.window = {addEventListener() {}, dispatchEvent: e => events.push(e)};
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
const line = await import('../app/record-file-line.mjs');
const files = await import('../app/record-files.js');
const sync = await import('../app/record-name-sync.js');
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const pic = (id, name) => ({drive_file_id: id, file_name: name, mime_type: 'image/jpeg'});
const pdf = (id, name) => ({drive_file_id: id, file_name: name, mime_type: 'application/pdf'});
const renamed = (id, oldName, name) => ({drive_file_id: id, old_name: oldName, name});

test('an automatic line takes the new name; an AI line or a written summary stays', () => {
  const after = [pic('d1', '합성노조 2026 임협 찬반투표 결과.jpg')];
  assert.equal(line.renamedRecordLine('그림 1장 · photo_2026-11-11_15-28-09.jpg', after, renamed('d1', 'photo_2026-11-11_15-28-09.jpg', '합성노조 2026 임협 찬반투표 결과.jpg')), '그림 1장 · 합성노조 2026 임협 찬반투표 결과.jpg');
  assert.equal(line.renamedRecordLine('합성 공문 사진 · 교섭 일정 안내임.', after, renamed('d1', 'photo.jpg', 'x.jpg')), null);
  assert.equal(line.renamedRecordLine('내가 쓴 요약', after, renamed('d1', 'photo.jpg', 'x.jpg')), null);
  // 사람이 자동 줄과 다른 이름을 적었으면(옛 이름과 다름) 그대로.
  assert.equal(line.renamedRecordLine('그림 1장 · 다른 이름.jpg', after, renamed('d1', 'photo.jpg', 'x.jpg')), null);
});

test('several files: only the first file is named in the line, the count part stays as written', () => {
  const after = [pic('d1', '새 이름.jpg'), pdf('d2', '안내.pdf')];
  assert.equal(line.renamedRecordLine('그림 1장 · 파일 1개 · 옛 이름.jpg 외 1', after, renamed('d1', '옛 이름.jpg', '새 이름.jpg')), '그림 1장 · 파일 1개 · 새 이름.jpg 외 1');
  assert.equal(line.renamedRecordLine('그림 1장 · 파일 1개 · 옛 이름.jpg 외 1', after, renamed('d2', '옛.pdf', '안내.pdf')), null);
  assert.equal(line.renamedRecordLine('그림 1장 · 같은.jpg', [pic('d1', '같은.jpg')], renamed('d1', '같은.jpg', '같은.jpg')), null);
});

test('the sync reads only my links of the renamed notes and writes through the one compare-and-set summary path', async () => {
  events.length = 0;
  const calls = [];
  const rt = {
    context: {read: () => ({user: {id: 'u1'}, workspace: {id: 'w1'}})},
    async api(path, init) {
      calls.push({path, body: init?.body});
      if (path.startsWith('/rest/v1/app_record_links')) return [
        {id: 'l1', workspace_id: 'w1', note_id: '11111111-1111-1111-1111-111111111111', summary: '그림 1장 · photo.jpg', note: {id: '11111111-1111-1111-1111-111111111111', workspace_id: 'w1', attachments: [pic('d1', '결과.jpg')]}},
        {id: 'l2', workspace_id: 'w1', note_id: '11111111-1111-1111-1111-111111111111', summary: '직접 쓴 글', note: {id: '11111111-1111-1111-1111-111111111111', workspace_id: 'w1', attachments: [pic('d1', '결과.jpg')]}},
        {id: 'l3', workspace_id: 'w2', note_id: '11111111-1111-1111-1111-111111111111', summary: '그림 1장 · photo.jpg', note: {id: '11111111-1111-1111-1111-111111111111', workspace_id: 'w2', attachments: [pic('d1', '결과.jpg')]}},
      ];
      if (path === '/rest/v1/rpc/app_basket_update_link_summary') return {ok: true};
      throw new Error('unexpected ' + path);
    },
  };
  const out = await sync.syncRecordLines({...renamed('d1', 'photo.jpg', '결과.jpg'), notes: [{id: '11111111-1111-1111-1111-111111111111', updated_at: 'x'}]}, rt);
  assert.deepEqual(out, [{id: 'l1', before: '그림 1장 · photo.jpg', summary: '그림 1장 · 결과.jpg'}]);
  assert.match(calls[0].path, /workspace_id=eq\.w1&note_id=in\.\(11111111-1111-1111-1111-111111111111\)&status=eq\.confirmed/);
  const rpc = calls.filter(c => c.path.includes('/rpc/'));
  assert.equal(rpc.length, 1);
  assert.deepEqual(rpc[0].body, {p_link_id: 'l1', p_expected_summary: '그림 1장 · photo.jpg', p_summary: '그림 1장 · 결과.jpg'});
  assert.equal(events.at(-1).type, 'kptu:record-lines-renamed');
  // 이름이 그대로거나 바뀐 노트가 없으면 아무것도 읽지 않는다.
  calls.length = 0;
  assert.deepEqual(await sync.syncRecordLines({...renamed('d1', 'a.jpg', 'a.jpg'), notes: [{id: '11111111-1111-1111-1111-111111111111'}]}, rt), []);
  assert.deepEqual(await sync.syncRecordLines({...renamed('d1', 'a.jpg', 'b.jpg'), notes: []}, rt), []);
  assert.equal(calls.length, 0);
});

test('the strip offers rename on files (✎) and pictures (⋯ [이름 수정]) with the shared part, and keeps [사진 n] open when asked', () => {
  const row = {id: 'l1', note_id: 'n1', attachments: [pic('d1', 'a.jpg'), pdf('d2', 'b.pdf')]};
  const html = files.recordFilesHtml(row, {open: true});
  assert.match(html, /class="record-file" data-fr-row><button[^>]*data-record-file="d2"[^>]*data-fr-host data-fr-target="note" data-fr-id="n1" data-fr-drive="d2" data-fr-name="b\.pdf"/);
  assert.match(html, /class="fr-edit" data-fr-edit[^>]*data-fr-drive="d2"/);
  assert.match(html, /data-photo-tile="d1" data-fr-row>.*<span class="record-photo-name" data-fr-host[^>]*data-fr-drive="d1"/);
  assert.match(html, /data-fr-menu-edit[^>]*data-fr-drive="d1"[^>]*>이름 수정<\/button>/);
  assert.match(html, /data-record-photos="n1" open>/);
  assert.doesNotMatch(files.recordFilesHtml(row), /data-record-photos="n1" open/);
  // 이름 바뀜을 들고 있는 줄에 반영
  const rows = [row, {id: 'l2', note_id: 'n2', attachments: [pic('d9', 'z.jpg')], summary: 's'}];
  assert.deepEqual(files.renameInRecordRows(rows, {drive_file_id: 'd1', name: '새.jpg'}), ['l1']);
  assert.equal(row.attachments[0].file_name, '새.jpg');
  assert.deepEqual(files.applyRenamedLines(rows, [{id: 'l2', before: 's', summary: 't'}, {id: 'l1', before: 'x', summary: 'y'}]), ['l2']);
  assert.equal(rows[1].summary, 't');
});

test('both record screens listen and redraw only their own lines; the rename sends the old name; ✎ sits apart without a border', () => {
  for (const p of ['app/workplace-detail.js', 'app/project-system-v3.js']) {
    const s = read(p);
    assert.match(s, /addEventListener\('kptu:file-renamed'/, p);
    assert.match(s, /addEventListener\('kptu:record-lines-renamed'/, p);
    assert.match(s, /recordPhotosOpen\(el\)/, p);
  }
  const fr = read('app/file-rename.js');
  assert.match(fr, /old_name: spec\.name/);
  assert.match(fr, /import\('\.\/record-name-sync\.js'\)/);
  const css = read('app/file-rename.css');
  assert.match(css, /:is\(#appView,body\) button\.fr-edit\.fr-edit\{[^}]*margin:0 0 0 \.5em;[^}]*border:0;[^}]*opacity:\.6/);
  assert.match(css, /button\.fr-edit\.fr-edit:is\(:hover,:focus-visible\)\{opacity:1/);
  assert.doesNotMatch(css, /margin-left:2px/);
  // 요약 쓰는 길은 하나(같은지 확인 뒤 씀)
  const s = read('app/record-name-sync.js');
  assert.match(s, /updateLinkSummary\(row\.id, row\.summary, next, rt\)/);
  assert.doesNotMatch(s, /PATCH|app_record_links\?[^`]*method/);
});
