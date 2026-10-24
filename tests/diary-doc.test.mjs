import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {toPlain} from '../app/ed-text.mjs';
import {diaryHasDoc, diaryStartDoc, joinDiaryDocs, diaryDocToStore, diaryDocError, DIARY_DOC_BYTES_MAX} from '../app/diary-doc.mjs';
// ED③ 일기 (설계 11.4 순서 4): how a diary opens in the new editor (in memory only) and what is stored. 합성 글.
const para = text => ({type:'paragraph', attrs:{style:'body2'}, content:[{type:'text', text}]});
const doc = text => ({v:'ed1', doc:{type:'doc', content:[para(text)]}});
const mod = import('../app/diary-data.js');
function runtime(reply = () => []) {
  const calls = [];
  return {calls, context:{read:() => ({user:{id:'u'}, workspace:{id:'w'}})}, api:async (path, options = {}) => { calls.push({path, ...options}); return reply(path, options); }};
}
const row = (extra = {}) => ({id:'d1', journal_day:'2026-10-03', raw_text:'글', attachments:[], updated_at:'2026-10-03T01:00:00Z', ...extra});

test('a diary with doc opens its own saved form; an old one opens its letters with every line and break kept', () => {
  assert.equal(diaryHasDoc({doc: doc('저장된')}), true);
  assert.equal(toPlain(diaryStartDoc({doc: doc('저장된'), raw_text: '다른 글'})), '저장된');
  assert.equal(diaryHasDoc({raw_text: '글'}), false);
  const raw = '1. 첫째 할 일\n- 둘째 줄\n2026. 10. 21. 산책\n\n끝 줄';
  assert.equal(toPlain(diaryStartDoc({raw_text: raw})), raw);
  assert.equal(toPlain(diaryStartDoc({raw_text: ' '})), '');
  assert.equal(toPlain(diaryStartDoc(null)), '');
});
test('a text typed before the day turned out to have a diary goes below the saved one', () => {
  assert.equal(toPlain(joinDiaryDocs(doc('앞'), doc('뒤'))), '앞\n\n뒤');
  assert.equal(toPlain(joinDiaryDocs(doc('앞'), null)), '앞');
  assert.equal(toPlain(joinDiaryDocs(doc(''), doc('뒤'))), '뒤');
});
test('a form is stored only with letters; too big a form is refused before it is sent', () => {
  assert.equal(diaryDocToStore(doc('가'), '  '), null);
  assert.equal(toPlain(diaryDocToStore(doc('가'), '가')), '가');
  assert.equal(diaryDocError(doc('가')), '');
  assert.match(diaryDocError(doc('가'.repeat(DIARY_DOC_BYTES_MAX))), /너무 커서/);
});
test('create and save send doc with the letters; a letters-only save drops the form it would no longer match', async () => {
  const m = await mod;
  let rt = runtime((p, o) => [{id:'d1', ...o.body}]);
  await m.createDiary({day:'2026-10-06', text:'오늘', doc: doc('오늘')}, rt);
  assert.deepEqual(rt.calls[0].body.doc, doc('오늘'));
  await m.createDiary({day:'2026-10-07', text:'', doc: doc('')}, rt);
  assert.equal('doc' in rt.calls[1].body, false);
  rt = runtime((p, o) => [{...row(), ...o.body}]);
  await m.saveDiaryText(row(), '새 글', rt, {doc: doc('새 글')});
  assert.deepEqual(rt.calls[0].body.doc, doc('새 글')); assert.equal(rt.calls[0].body.raw_text, '새 글');
  await m.saveDiaryText(row({doc: doc('옛')}), '새 글', rt);
  assert.equal(rt.calls[1].body.doc, null);
  await m.saveDiaryText(row(), '새 글', rt);
  assert.equal('doc' in rt.calls[2].body, false);
  await m.saveDiaryText(row({attachments:[{drive_file_id:'a'}], doc: doc('옛')}), '  ', rt, {doc: doc('')});
  assert.equal(rt.calls[3].body.doc, null); assert.equal(rt.calls[3].body.raw_text, '');
});
test('a strict save applies only to the version given; a changed diary is refused (note_changed)', async () => {
  const m = await mod;
  let rt = runtime((p, o) => [{...row(), ...o.body}]);
  await m.saveDiaryText(row(), '글2', rt, {doc: doc('글2'), strict: true});
  assert.match(rt.calls[0].path, /&updated_at=eq\.2026-10-03T01%3A00%3A00Z$/);
  rt = runtime(() => []);
  await assert.rejects(m.saveDiaryText(row(), '글2', rt, {doc: doc('글2'), strict: true}), error => error.code === 'note_changed');
});
test('the diary screen opens the new editor in its panel and reads the saved form; its day read carries doc and never ai_export_allowed', () => {
  const screen = readFileSync('app/diary.js', 'utf8'), data = readFileSync('app/diary-data.js', 'utf8');
  assert.match(screen, /import\('\.\/ed-editor\.js'\)/);
  assert.match(screen, /renderDoc\(row\.doc\)/);
  assert.ok(!/<textarea data-diary-text/.test(screen));
  assert.match(data, /const FIELDS = 'id,journal_day,raw_text,doc,/);
  assert.ok(!/ai_export_allowed:true/.test(data));
});
