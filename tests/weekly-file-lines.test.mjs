import { test } from 'node:test';
import assert from 'node:assert/strict';
// WEEKLY-자료요약 화면 ① (docs/design/weekly-file-summary.md 4·5절, Q3·Q5·Q6 ①): 자료 → [주간 정리] 줄. 가상 이름만.
const m = await import('../app/weekly-file-lines.mjs');
const H = c => 'b1:' + c.repeat(32);
const doc = (id, over = {}) => ({id, title:`자료 ${id}`, file_name:`${id}.hwp`, created_at:'2026-10-06T01:00:00Z', ...over});

test('compareOne: contained or 80% words with the same numbers is same; a different status word is never same', () => {
  const brief = 'A 지부 임금교섭 요구안. 기본급 5% 인상, 10.28.(화) 1차 교섭 예정';
  assert.equal(m.compareOne(brief, 'A 지부 임금교섭 요구안. 기본급 5% 인상, 10.28.(화) 1차 교섭 예정'), 'same');
  assert.equal(m.compareOne('1차 교섭 예정', 'A 지부 10.28.(화) 1차 교섭 예정 — 요구안 전달'), 'same'); // record holds the whole summary (10자 이상)
  assert.equal(m.compareOne(brief, 'A 지부 임금교섭 요구안 기본급 5% 인상 10.28.(화) 2차 교섭 예정'), 'similar'); // number differs
  assert.equal(m.compareOne(brief, 'A 지부 임금교섭 요구안. 기본급 5% 인상, 10.28.(화) 1차 교섭 확정'), 'similar'); // status differs
  assert.equal(m.compareOne('가상 결의대회 10.30. 개최 예정 안내', '10.30. 가상 결의대회 준비 회의'), 'similar'); // same date + 2 words
  assert.equal(m.compareOne(brief, '다른 조직 간담회 일정'), 'new');
  assert.equal(m.compareOne('', '아무 기록'), 'new');
  assert.equal(m.compareOne('짧은 글', '짧은'), 'similar'); // a short text is never folded (contained needs 10자, overlap needs 3 words)
  assert.equal(m.SAME_OVERLAP, 0.8); assert.equal(m.SIMILAR_OVERLAP, 0.4); assert.equal(m.CONTAIN_MIN, 10); assert.equal(m.SAME_MIN_WORDS, 3);
});

test('fileText: "제목 — 요약" with a b1 summary only; title only otherwise', () => {
  assert.equal(m.fileText(doc('d1', {brief:{summary:'한 줄 요약', hash:H('a')}})), '자료 d1 — 한 줄 요약');
  assert.equal(m.fileText(doc('d1', {brief:{summary:'옛 요약', hash:'old'}})), '자료 d1');
  assert.equal(m.fileText(doc('d1', {brief:{summary:'', hash:H('a')}})), '자료 d1');
  assert.equal(m.fileText({id:'x', file_name:'f.pdf'}), 'f.pdf');
});

test('mergeSameFiles: the same fingerprint twice in a week → the first upload once, "same" counts; no fingerprint is never merged', () => {
  const out = m.mergeSameFiles([doc('d2', {created_at:'2026-10-07T00:00:00Z', brief:{summary:'s', hash:H('a')}}), doc('d1', {brief:{summary:'s', hash:H('a')}}), doc('d3'), doc('d4')]);
  assert.deepEqual(out.map(d => [d.id, d.same || 1]), [['d1', 2], ['d3', 1], ['d4', 1]]);
});

test('placeFiles: organization first (even with a project, Q3 ①), project only, meeting files and unknown places stay in 참고', () => {
  const orgs = {names:new Map([['o1', '가 조직'], ['o9', '다른 조직']]), mine:new Set(['o1'])}, projects = new Map([['p1', '세부 과제']]);
  const r = m.placeFiles([doc('d1', {organization_id:'O1', project_id:'p1'}), doc('d2', {project_id:'p1'}), doc('d3', {organization_id:'o1', meeting_id:'m'}),
    doc('d4'), doc('d5', {project_id:'gone'}), doc('d6', {organization_id:'o9'}), doc('d7', {organization_id:'unknown', project_id:'p1'})], {orgs, projects});
  assert.deepEqual(r.orgs.map(o => [o.doc.id, o.id, o.name, o.others]), [['d1', 'o1', '가 조직', false], ['d6', 'o9', '다른 조직', true]]);
  assert.deepEqual(r.projects.map(p => [p.doc.id, p.id]), [['d2', 'p1']]);
  assert.deepEqual(r.notes.map(d => d.id), ['d3', 'd4', 'd5', 'd7']);
});

test('fileVerdict: repeat upload folds, record match folds or marks, an attachment of a shown update is marked', () => {
  const d = doc('d1', {file_id:'F1', brief:{summary:'가상 결의대회 10.30. 개최 예정', hash:H('a')}});
  assert.deepEqual(m.fileVerdict({...d, repeat:true}), {verdict:'same', reason:'repeat'});
  assert.deepEqual(m.fileVerdict(d, {records:['가상 결의대회 10.30. 개최 예정']}), {verdict:'same', reason:'record'});
  assert.deepEqual(m.fileVerdict(d, {records:['다른 이야기'], attached:new Set(['F1'])}), {verdict:'similar', reason:'attached'});
  assert.deepEqual(m.fileVerdict(d, {records:['다른 이야기']}), {verdict:'new', reason:''});
  const item = m.fileItem(d, '2026-10-06', {verdict:'same', reason:'record'});
  assert.equal(m.isFolded(item), true); assert.deepEqual(m.shownItems([item]), []);
});

// 화면 ②: 그 주 고침(draft.docs) — 고친 줄은 그 주 글만, 뺀 자료는 '뺀 자료', 접힌 자료 [넣기]는 보이는 줄로.
test('자료 줄 고침 적용: 고치기·빼기·넣기와 칸 안 자리', async () => {
  const f = await import('../app/weekly-file-lines.mjs');
  const item = {day:'2026-10-06', text:'제목 — 요약', requests:[], file:{id:'d1', verdict:'new', reason:'', same:1}};
  const folded = {...item, file:{...item.file, verdict:'same', reason:'record'}};
  assert.equal(f.applyDocEdit(item, undefined), item);
  const edited = f.applyDocEdit(item, {text:'고친 줄'});
  assert.deepEqual([edited.text, edited.file.original, edited.file.edited, f.fileBucket(edited)], ['고친 줄', '제목 — 요약', true, 'items']);
  assert.equal(f.fileBucket(f.applyDocEdit(item, {drop:true})), 'dropped');
  assert.equal(f.fileBucket(folded), 'folded');
  const kept = f.applyDocEdit(folded, {keep:true});
  assert.deepEqual([f.fileBucket(kept), kept.file.kept], ['items', true]);
  // 넣은 뒤 빼면 '뺀 자료'. 새 자료에 keep은 아무 일 없음.
  assert.equal(f.fileBucket(f.applyDocEdit(folded, {keep:true, drop:true})), 'dropped');
  assert.equal(f.applyDocEdit(item, {keep:true}).file.kept, undefined);
  assert.deepEqual(f.shownItems([item, folded, kept, f.applyDocEdit(item, {drop:true})]).map(i => i.file.verdict), ['new', 'same']);
});
