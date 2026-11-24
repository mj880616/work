// S69 보드잠금가림 전수: 조직·사업·참고 묶음의 '노트 연결' 줄은 그 노트가 잠근 노트 폴더(아직 안 풀림)에 있으면 요약·제목·원문·첨부 대신 '잠김'.
// 판정은 feature-lock.js 한 곳(window.KPTUFeatureLock.noteHidden) — 여기서는 그 판정을 흉내 낸다. 값은 합성.
import test from 'node:test';
import assert from 'node:assert/strict';

const LOCKED = 'f-locked';
let hidden = true;
globalThis.window = globalThis.window || {};
window.KPTUFeatureLock = { noteHidden: note => hidden && note?.metadata?.folder_id === LOCKED };
const rtFor = api => ({ context: { read: () => ({ user: { id: 'owner' }, workspace: { id: 'workspace' } }) }, api });

test('연결 기록 읽기는 노트의 폴더 자리만 남기고, 잠긴 동안 그 줄은 잠김', async () => {
  const mod = await import('../app/basket-link-records.js');
  const calls = [];
  const note = (id, folder) => ({ id, workspace_id: 'workspace', occurred_at: '2026-10-12T00:00:00Z', raw_text: id + ' 원문', kind: 'note', title: id + ' 제목', attachments: [{ drive_file_id: 'abc', file_name: '사진.jpg' }], metadata: { folder_id: folder, boards: { x: 1 }, ai_title: '비밀 제목' } });
  const link = (id, folder) => ({ id, workspace_id: 'workspace', summary: id + ' 요약', origin: null, note_id: 'n' + id, organization_id: 'org', project_id: null, status: 'confirmed', note: note('n' + id, folder) });
  const rt = rtFor(async path => { calls.push(path); return [link('a', LOCKED), link('b', 'f-open')]; });
  const rows = await mod.readLinkRecords({ kind: 'organization', targetIds: ['org'], noteKinds: ['basket', 'note'], withFiles: true }, rt);
  assert.match(new URL(calls[0], 'http://x').searchParams.get('select'), /raw_text,kind,title,metadata/);
  assert.deepEqual(rows.map(r => r.note_folder), [{ folder_id: LOCKED }, { folder_id: 'f-open' }]);
  const [a, b] = rows;
  assert.equal(mod.recordLocked(a), true);
  assert.equal(mod.recordText(a), '잠김');
  assert.equal(mod.recordShownText(a), '잠김');
  assert.equal(mod.recordMarkdownSource(a), '');
  const html = mod.linkRecordHtml(a);
  for (const word of ['na 제목', 'na 원문', 'a 요약']) assert.equal(html.includes(word), false, word);
  const shown = mod.shownRecord(a);
  assert.deepEqual([shown.summary, shown.title, shown.raw_text, shown.attachments, shown.locked], ['잠김', '잠김', '', [], true]);
  assert.equal(mod.recordLocked(b), false);
  assert.equal(mod.recordText(b), 'b 요약');
  assert.equal(mod.shownRecord(b), b);
  // 풀리면 그대로 보인다.
  hidden = false;
  assert.equal(mod.recordText(a), 'a 요약');
  hidden = true;
  // 업데이트(basket) 줄은 폴더가 없어 잠기지 않는다.
  assert.equal(mod.recordLocked({ ...a, note_kind: 'basket' }), false);
});
