// WEEKLY-내양식자유변형 ②: 한글 양식 읽기(app/hwpx-form-read.mjs)·내 양식 모델(app/weekly-own-form-model.mjs)·저장(app/weekly-own-form-store.js).
// 지어낸 양식만 쓴다(실제 조직·사람 이름 없음). 운영 접속 없음.
import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateRawSync, inflateRawSync} from 'node:zlib';
import {writeZip} from '../app/weekly-hwpx/zip.mjs';
import {openHwpx} from '../app/weekly-hwpx/hwpx.mjs';
import {readHwpxForm} from '../app/hwpx-form-read.mjs';
import {readFileSync} from 'node:fs';
import {makeFakeReport} from '../scripts/weekly-hwpx/fixture.mjs';
import {cleanForm, guessFill, formName, readSummary, formBytes, FILLS, FILL_LABEL, MAX_SECTIONS, FORM_MAX_BYTES} from '../app/weekly-own-form-model.mjs';
import {readOwnForm, saveOwnForm, deleteOwnForm, OWN_FORM_TEXT} from '../app/weekly-own-form-store.js';

const zlib = {deflateRaw: b => deflateRawSync(b), inflateRaw: b => inflateRawSync(b)};
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const P = (text, style = '0') => `<hp:p styleIDRef="${style}"><hp:run><hp:t>${esc(text)}</hp:t></hp:run></hp:p>`;
const cell = t => `<hp:tc><hp:subList><hp:p><hp:run><hp:t>${esc(t)}</hp:t></hp:run></hp:p></hp:subList></hp:tc>`;
const TBL = rows => `<hp:p><hp:run><hp:tbl>${rows.map(r => `<hp:tr>${r.map(cell).join('')}</hp:tr>`).join('')}</hp:tbl></hp:run></hp:p>`;
const SEC = body => `<?xml version="1.0" encoding="UTF-8"?><hs:sec xmlns:hs="s" xmlns:hp="p">${body}</hs:sec>`;
const HEADER = `<?xml version="1.0" encoding="UTF-8"?><hh:head xmlns:hh="h"><hh:refList><hh:styles><hh:style id="0" name="바탕글"/><hh:style id="3" name="큰 제목"/><hh:style id="4" name="표내부"/></hh:styles></hh:refList></hh:head>`;
function pkgOf(...sections) {
  const entries = [{name: 'mimetype', data: 'application/hwp+zip', store: true}, {name: 'Contents/header.xml', data: HEADER}];
  sections.forEach((s, i) => entries.push({name: `Contents/section${i}.xml`, data: SEC(s)}));
  return openHwpx(writeZip(entries, zlib), zlib);
}

test('읽기: 제목·번호 항목·표 머리 칸, 본문 글은 남기지 않음', () => {
  const pkg = pkgOf(
    P('가나노조 조직국 주간 보고') + P('2026. 11. 16.(월)')
    + P('1. 금주 주요 활동') + P('- 임금교섭 3차 실무교섭이 있었고 조합원 교육을 했습니다(본문 글).')
    + P('2. 지회 동향') + TBL([['지회명', '동향', '비고'], ['가 지회', '단체협약 갱신 요구안 확정', '']]),
    P('3. 다음 주 일정') + TBL([['날짜', '내용', '장소'], ['11/24', '운영위원회', '사무실']]) + P('4. 기타'));
  const {title, form, tables} = readHwpxForm(pkg);
  assert.equal(title, '가나노조 조직국 주간 보고');
  assert.equal(tables, 2);
  assert.deepEqual(form.sections.map(s => [s.title, s.level, s.columns, s.fill]), [
    ['1. 금주 주요 활동', 1, [], 'biz'],
    ['2. 지회 동향', 1, ['지회명', '동향', '비고'], 'org'],
    ['3. 다음 주 일정', 1, ['날짜', '내용', '장소'], 'schedule'],
    ['4. 기타', 1, [], 'blank'],
  ]);
  const saved = JSON.stringify(form);
  for (const body of ['임금교섭', '가 지회', '단체협약', '운영위원회', '사무실', '11/24']) assert.ok(!saved.includes(body), body);
  assert.equal(readSummary(form), '항목 4개와 표 2개를 읽었어요.');
});

test('읽기: 2단계 항목·제목 스타일·항목 없는 표·한 항목 아래 두 번째 표', () => {
  const pkg = pkgOf(
    TBL([['구분', '내용']])
    + P('사업 현황', '3')
    + P('가. 교육 사업') + P('나) 홍보 사업')
    + P('□ 회의 결과') + TBL([['회의', '결과']]) + P('참석자 현황') + TBL([['이름', '직책']]));
  const {form} = readHwpxForm(pkg);
  assert.deepEqual(form.sections.map(s => [s.title, s.level, s.columns]), [
    ['표 1', 1, ['구분', '내용']],
    ['사업 현황', 1, []],
    ['가. 교육 사업', 2, []],
    ['나) 홍보 사업', 2, []],
    ['□ 회의 결과', 1, ['회의', '결과']],
    ['참석자 현황', 2, ['이름', '직책']],
  ]);
});

test('읽기(⑤-3): 회의 결과 상자는 왼쪽 칸 이름만 칸 이름으로 — 첫 줄 오른쪽 본문 글을 칸 이름으로 읽지 않고, 이어진 상자는 칸 이름을 합친다', () => {
  const zlib = {deflateRaw: b => deflateRawSync(b), inflateRaw: b => inflateRawSync(b)};
  const sample = openHwpx(new Uint8Array(readFileSync(new URL('./fixtures/hwp-lab/sample.hwpx', import.meta.url))), zlib);
  const {form} = readHwpxForm(makeFakeReport(sample));
  const all = JSON.stringify(form);
  for (const body of ['가짜 회의 갑', '가짜 회의 을', '1.4.(화) 10시', '가짜 미정', '가짜 참석자 갑']) assert.ok(!all.includes(`"${body}"`), body);
  const box = form.sections.find(s => s.columns.includes('회의제목'));
  assert.deepEqual(box.columns, ['회의제목', '일시/장소', '참석자', '내용', '차기일정']);
  // 보통 표(머리 줄이 위에 있는 2열 표)는 그대로 머리 줄을 읽는다.
  assert.ok(form.sections.some(s => s.columns.join('|') === '조직명|현황'));
});

test('읽기: 표 없이 긴 글만 있으면 항목 0개(손 편집으로), 본문 없는 묶음은 거절', () => {
  const {form} = readHwpxForm(pkgOf(P('이번 주에는 여러 일이 있었습니다. 다음 주에도 이어서 하겠습니다. 자세한 내용은 아래와 같습니다.')));
  assert.equal(form.sections.length, 0);
  assert.equal(readSummary(form), '');
  const empty = openHwpx(writeZip([{name: 'mimetype', data: 'application/hwp+zip', store: true}], zlib), zlib);
  assert.throws(() => readHwpxForm(empty), /form_unreadable/);
});

test('모델: 모르는 값 버림·길이 자르기·id 겹침·상한', () => {
  const form = cleanForm({sections: [
    {id: 'a', title: '  1.  금주\n활동 ', columns: ['날짜', '', ' 내용 '], fill: 'robot', level: 7, extra: 'x'},
    {id: 'a', title: '둘째', fill: 'todo', ai: true},
    {title: ''}, null, 'x',
  ]});
  assert.deepEqual(form, {v: 1, sections: [
    {id: 'a', title: '1. 금주 활동', level: 1, columns: ['날짜', '내용'], fill: 'blank'},
    {id: 's2', title: '둘째', level: 1, columns: [], fill: 'todo', ai: true},
  ]});
  const many = cleanForm({sections: Array.from({length: 60}, (_, i) => ({title: `항목 ${i}`, columns: Array.from({length: 20}, () => '가'.repeat(50))}))});
  assert.equal(many.sections.length, MAX_SECTIONS);
  assert.equal(many.sections[0].columns.length, 12);
  assert.equal(many.sections[0].columns[0].length, 30);
  assert.ok(formBytes(many) > FORM_MAX_BYTES, '항목·칸 상한을 다 채우면 크기 상한을 넘을 수 있음 — 저장이 거절(아래 시험)');
  assert.deepEqual(FILLS.map(f => FILL_LABEL[f]), ['사업 보고', '조직 보고', '일정', '할 일', '회의', '지난주 글 그대로', '빈칸']);
  assert.equal(guessFill('5. 주요 회의'), 'meeting');
  assert.equal(guessFill('기타'), 'blank');
  assert.equal(formName('가나노조 주간보고.hwpx'), '가나노조 주간보고');
  assert.equal(formName('  '), '내 주간 보고 양식');
});

// 저장: rt.api 가짜. 작업공간 하나에 양식 하나 — 처음은 POST, 있으면 updated_at 조건 PATCH, 0행이면 충돌.
function fakeRt({rows = [], fail = null} = {}) {
  const calls = [];
  const rt = {context: {read: () => ({workspace: {id: 'ws-1'}})}, calls, async api(path, opts = {}) {
    calls.push({path, method: opts.method ?? 'GET', body: opts.body});
    if (fail) throw fail;
    if ((opts.method ?? 'GET') === 'GET') return rows;
    if (opts.method === 'POST') { rows = [{id: 'f1', name: opts.body.name, source_name: opts.body.source_name, form: opts.body.form, updated_at: 't1'}]; return rows; }
    if (opts.method === 'PATCH') { if (!path.includes(`updated_at=eq.${encodeURIComponent(rows[0]?.updated_at ?? '')}`)) return []; rows = [{...rows[0], ...opts.body, updated_at: 't2'}]; return rows; }
    if (opts.method === 'DELETE') { rows = []; return []; }
    return [];
  }};
  return rt;
}

test('저장: 내 작업공간 것만 읽고, 처음은 넣고, 다음은 읽은 판 조건으로 고침, 지우기', async () => {
  const rt = fakeRt();
  assert.deepEqual(await readOwnForm(rt), {missing: false, row: null});
  assert.match(rt.calls[0].path, /^\/rest\/v1\/app_weekly_forms\?workspace_id=eq\.ws-1&select=/);
  const form = {v: 1, sections: [{title: '1. 활동', fill: 'biz'}]};
  const first = await saveOwnForm({known: null, name: '가나 주간보고.hwpx', sourceName: '가나 주간보고.hwpx', form}, rt);
  assert.equal(first.ok, true);
  assert.deepEqual(rt.calls.at(-1).body, {workspace_id: 'ws-1', name: '가나 주간보고', source_name: '가나 주간보고.hwpx', form: {v: 1, sections: [{id: 's1', title: '1. 활동', level: 1, columns: [], fill: 'biz'}]}});
  const second = await saveOwnForm({known: first.row, name: '고친 이름', sourceName: '가나 주간보고.hwpx', form}, rt);
  assert.equal(second.ok, true);
  assert.match(rt.calls.at(-1).path, /updated_at=eq\.t1/);
  assert.equal(rt.calls.at(-1).body.workspace_id, undefined, '고칠 때 작업공간은 보내지 않음');
  const stale = await saveOwnForm({known: first.row, name: '늦은 기기', form}, rt);
  assert.equal(stale.conflict, true);
  assert.equal(stale.row.updated_at, 't2');
  await deleteOwnForm(rt);
  assert.equal(rt.calls.at(-1).method, 'DELETE');
  assert.match(rt.calls.at(-1).path, /workspace_id=eq\.ws-1/);
});

test('저장: 표 준비 전(404)은 missing, 너무 크면 거절, 화면 글에 다른 팀 양식 글자 없음', async () => {
  assert.deepEqual(await readOwnForm(fakeRt({fail: Object.assign(new Error('x'), {status: 404})})), {missing: true, row: null});
  const big = {v: 1, sections: Array.from({length: 40}, (_, i) => ({title: `항목 ${i} ${'가'.repeat(50)}`, columns: Array.from({length: 12}, () => '나'.repeat(30))}))};
  await assert.rejects(saveOwnForm({known: null, name: 'x', form: big}, fakeRt()), {code: 'too_big'});
  const all = JSON.stringify(OWN_FORM_TEXT);
  for (const word of ['공공기관', '산하조직', '투쟁 사업장', '상집']) assert.ok(!all.includes(word), word);
});

test('③ 고치기: 순서·이름·채울 기록·항목 추가·빼기·칸 추가·이름·빈 이름이면 빼기, 원래 양식은 그대로', async () => {
  const m = await import('../app/weekly-own-form-model.mjs');
  const base = m.cleanForm({sections: [{id: 's1', title: '1. 활동', fill: 'biz', ai: true}, {id: 's2', title: '2. 동향', columns: ['지회명', '동향'], fill: 'org'}, {id: 's3', title: '3. 기타'}]});
  const ids = f => f.sections.map(s => s.id);
  assert.deepEqual(ids(m.moveSection(base, 's3', 0)), ['s3', 's1', 's2']);
  assert.deepEqual(ids(m.moveSection(base, 's1', 9)), ['s2', 's3', 's1']);
  assert.equal(m.moveSection(base, 'nope', 0), base);
  const renamed = m.renameSection(base, 's1', ' 이번 주 활동 ');
  assert.deepEqual(renamed.sections[0], {id: 's1', title: '이번 주 활동', level: 1, columns: [], fill: 'biz'}, '사람이 고치면 AI 표시는 빠짐');
  assert.equal(m.renameSection(base, 's1', '  '), base, '빈 이름은 무시');
  assert.equal(m.setFill(base, 's3', 'meeting').sections[2].fill, 'meeting');
  assert.equal(m.setFill(base, 's3', 'robot'), base);
  assert.deepEqual(ids(m.removeSection(base, 's2')), ['s1', 's3']);
  const added = m.addSection(m.removeSection(base, 's2'));
  assert.deepEqual(added.sections.at(-1), {id: 's4', title: '새 항목', level: 1, columns: [], fill: 'blank'});
  assert.deepEqual(m.addColumn(base, 's2', '').sections[1].columns, ['지회명', '동향', '칸 3']);
  assert.deepEqual(m.renameColumn(base, 's2', 1, '이번 주 동향').sections[1].columns, ['지회명', '이번 주 동향']);
  assert.deepEqual(m.renameColumn(base, 's2', 0, ' ').sections[1].columns, ['동향']);
  assert.deepEqual(m.removeColumn(base, 's2', 1).sections[1].columns, ['지회명']);
  assert.ok(m.sameForm(base, m.cleanForm(JSON.parse(JSON.stringify(base)))));
  assert.ok(!m.sameForm(base, renamed));
  assert.equal(base.sections[0].title, '1. 활동', '원래 양식은 바뀌지 않음');
});

test('④-1 초안 모양: 채울 기록대로 줄·표 행, 칸 이름 규칙, 지난주 글 그대로, 빈칸', async () => {
  const {ownDraft, columnKinds, dayText} = await import('../app/weekly-own-draft-model.mjs');
  const form = cleanForm({sections: [
    {id: 's1', title: '1. 금주 주요 활동', fill: 'biz'},
    {id: 's2', title: '2. 지회 동향', columns: ['지회명', '동향', '비고'], fill: 'org'},
    {id: 's3', title: '3. 다음 주 일정', columns: ['날짜', '내용', '장소'], fill: 'schedule'},
    {id: 's4', title: '4. 기타', fill: 'last_week'},
    {id: 's5', title: '5. 회의', fill: 'meeting'},
    {id: 's6', title: '6. 빈 항목', columns: ['가', '나'], fill: 'blank'},
  ]});
  const model = {
    summary: {areas: [{name: '교육', rows: [{items: [{day: '2026-11-18', text: '조합원 교육 1회'}, {day: '2026-11-19', label: '실무', text: '3차 실무교섭'}]}]}], others: []},
    orgs: {sections: [{name: '가 지회', items: [{day: '2026-11-17', text: '요구안 확정'}]}, {name: '나 지회', items: [{day: '2026-11-20', text: '대의원대회'}]}]},
    calendarView: {rows: [{day: '2026-11-24', items: [{time: '10:00', title: '운영위원회', place: '사무실'}]}]},
    meetings: {items: [{day: '2026-11-18', text: '가상 회의 결과'}]},
  };
  const last = {sections: [{id: 's4', lines: [{text: '- 지난주에 쓴 줄'}]}]};
  const d = ownDraft(form, model, last);
  assert.deepEqual(d.sections[0].lines, [{text: '- 11/18 조합원 교육 1회', filled: true}, {text: '- 11/19 실무: 3차 실무교섭', filled: true}]);
  assert.deepEqual(d.sections[1].rows.map(r => r.map(c => c.text)), [['가 지회', '요구안 확정', ''], ['나 지회', '대의원대회', '']]);
  assert.deepEqual(d.sections[1].rows[0].map(c => c.filled), [true, true, false]);
  assert.deepEqual(d.sections[2].rows.map(r => r.map(c => c.text)), [['11/24 10:00', '운영위원회', '사무실']]);
  assert.deepEqual(d.sections[3].lines, [{text: '- 지난주에 쓴 줄', filled: false}]);
  assert.deepEqual(d.sections[4].lines, [{text: '- 11/18 가상 회의 결과', filled: true}]);
  assert.deepEqual(d.sections[5].rows, []);
  assert.deepEqual(ownDraft(form, model, null).sections[3].lines, [], '지난주 초안이 없으면 비움');
  assert.deepEqual(ownDraft(form, {summary: {loading: true}}).sections[0].lines, [], '불러오는 중이면 비움');
  assert.deepEqual(columnKinds(['구분', '내용']), ['name', 'text']);
  assert.deepEqual(columnKinds(['일시', '회의', '결과', '비고']), ['day', 'name', 'text', '']);
  assert.equal(dayText('2026-01-05'), '1/5');
});

test('④-2 고친 항목: 저장 모양 맞춤·고친 글 우선(노란 칸 아님)·칸 고침·새 줄·빈 줄 빼기·지난주 월요일', async () => {
  const {shownDraft, editSaved, cleanSaved, fillLoading, sectionKey, prevWeek} = await import('../app/weekly-own-draft-model.mjs');
  const form = cleanForm({sections: [
    {id: 's1', title: '1. 금주 주요 활동', fill: 'biz'},
    {id: 's2', title: '2. 지회 동향', columns: ['지회명', '동향', '비고'], fill: 'org'},
  ]});
  const model = {
    summary: {areas: [{name: '교육', rows: [{items: [{day: '2026-11-18', text: '조합원 교육 1회'}]}]}], others: []},
    orgs: {sections: [{name: '가 지회', items: [{day: '2026-11-17', text: '요구안 확정'}]}]},
  };
  const first = shownDraft(form, model, null, []).sections;
  assert.equal(first[0].edited, false);
  assert.deepEqual(first[0].lines, [{text: '- 11/18 조합원 교육 1회', filled: true}]);
  // 줄 목록 항목 통째 고침 → 저장 모양은 글만, 빈 줄 뺌
  const a = editSaved([], first[0], {lines: '- 고친 첫 줄\n\n  - 둘째   줄 '});
  assert.deepEqual(a, [{id: 's1', lines: ['- 고친 첫 줄', '- 둘째 줄'], rows: null}]);
  // 표 칸 하나 고침 → 그 항목 전체 행을 글로 저장
  const b = editSaved(a, first[1], {row: 0, col: 2, text: '가상 비고'});
  assert.deepEqual(b.find(s => s.id === 's2'), {id: 's2', lines: null, rows: [['가 지회', '요구안 확정', '가상 비고']]});
  // 새 줄(끝 다음)
  const shownB = shownDraft(form, model, null, b).sections;
  const c = editSaved(b, shownB[1], {row: 1, col: 0, text: '나 지회'});
  assert.deepEqual(c.find(s => s.id === 's2').rows, [['가 지회', '요구안 확정', '가상 비고'], ['나 지회', '', '']]);
  // 칸을 모두 비우면 그 줄이 빠진다
  const shownC = shownDraft(form, model, null, c).sections;
  assert.deepEqual(editSaved(c, shownC[1], {row: 1, col: 0, text: ' '}).find(s => s.id === 's2').rows, [['가 지회', '요구안 확정', '가상 비고']]);
  // 고친 항목은 늦게 온 기록이 덮지 않는다(노란 칸 아님), 안 고친 항목만 새 기록으로
  const later = {...model, summary: {areas: [{name: '교육', rows: [{items: [{day: '2026-11-19', text: '늦게 온 기록'}]}]}], others: []}};
  const shown = shownDraft(form, later, null, c).sections;
  assert.deepEqual(shown[1].rows.map(r => r.map(x => x.text)), [['가 지회', '요구안 확정', '가상 비고'], ['나 지회', '', '']]);
  assert.ok(shown[1].edited && shown[1].rows.flat().every(x => !x.filled));
  assert.deepEqual(shown[0].lines, [{text: '- 고친 첫 줄', filled: false}, {text: '- 둘째 줄', filled: false}]);
  const onlyTable = c.filter(x => x.id === 's2');
  const fresh = shownDraft(form, later, null, onlyTable).sections;
  assert.deepEqual(fresh[0].lines, [{text: '- 11/19 늦게 온 기록', filled: true}]);
  assert.notEqual(sectionKey(first[0]), sectionKey(fresh[0]), '바뀐 항목만 다시 그림');
  assert.equal(sectionKey(shownDraft(form, later, null, c).sections[1]), sectionKey(shown[1]));
  // 불러오는 중
  assert.equal(fillLoading('biz', {summary: {loading: true}}), true);
  assert.equal(shownDraft(form, {summary: {loading: true}, orgs: {loading: true}}, null, []).sections[0].loading, true);
  assert.equal(fillLoading('blank', {}), false);
  // 저장 모양 맞춤: 모르는 값·중복 id 버림
  assert.deepEqual(cleanSaved([{id: 'x', lines: ['a', 3, ''], extra: 1}, {id: 'x', lines: ['b']}, {lines: ['c']}, null]), [{id: 'x', lines: ['a', '3'], rows: null}]);
  // 지난주 고친 글 → 이번 주 '지난주 글 그대로'
  const lastForm = cleanForm({sections: [{id: 's1', title: '기타', fill: 'last_week'}]});
  assert.deepEqual(shownDraft(lastForm, model, {sections: [{id: 's1', lines: ['- 지난주 고친 줄'], rows: null}]}, []).sections[0].lines, [{text: '- 지난주 고친 줄', filled: false}]);
  assert.equal(prevWeek('2026-11-16'), '2026-11-09');
  assert.equal(prevWeek('2026-03-02'), '2026-02-23');
  assert.equal(prevWeek('x'), '');
});

// WEEKLY-처음시작고르기(시안 #2732 ★A안, 사용자 11/17): 번호 4개 — 이름·순서 시안 그대로, 양식은 cleanForm을 거쳐도 같고, 지금 초안 엔진이 표의 대로 채운다.
test('처음 고르기 번호 4개: 이름·순서, 양식 모양, 초안 엔진이 채우는 칸', async () => {
  const {START_CHOICES, START_DEFAULT, startForm} = await import('../app/weekly-own-form-model.mjs');
  const {ownDraft} = await import('../app/weekly-own-draft-model.mjs');
  assert.deepEqual(START_CHOICES.map(c => `${c.no}. ${c.name}`), ['1. 간단형', '2. 사업별 표', '3. 조직별', '4. 직접 만들기']);
  assert.equal(START_DEFAULT, 'simple');
  for (const c of START_CHOICES) assert.deepEqual(startForm(c.key).form, cleanForm(c.form), c.key);
  assert.deepEqual(startForm('own'), {form: {v: 1, sections: []}, name: '내 주간 보고 양식'});
  assert.equal(startForm('없는 번호').name, '간단형');
  const simple = startForm('simple').form.sections;
  assert.deepEqual(simple.map(s => [s.title, s.fill]), [['지난주 한 일', 'biz'], ['이번 주 할 일', 'blank'], ['주요 일정', 'schedule']]);
  // 지어낸 그 주 기록 모델(weeklySummary 모양)로 초안을 만들어 칸마다 자동 채움/직접을 본다.
  const model = {
    summary: {areas: [{name: '가상 교육', rows: [{items: [{day: '2026-11-10', text: '가상 1차 교육'}]}]}], others: []},
    orgs: {sections: [{name: '가상 지회', items: [{day: '2026-11-11', text: '가상 상황'}]}]},
    calendar: {rows: [{day: '2026-11-18', items: [{title: '가상 회의'}]}]},
  };
  const one = ownDraft(startForm('simple').form, model).sections;
  assert.deepEqual(one.map(s => s.lines.map(l => l.text)), [['- 11/10 가상 1차 교육'], [], ['- 11/18 가상 회의']]);
  const biz = ownDraft(startForm('biz').form, model).sections[0].rows;
  assert.deepEqual(biz, [[{text: '가상 교육', filled: true}, {text: '가상 1차 교육', filled: true}, {text: '', filled: false}]]); // 계획 = 직접
  const org = ownDraft(startForm('org').form, model).sections[0].rows;
  assert.deepEqual(org.map(r => r.map(c => c.text)), [['가상 지회', '11/11', '가상 상황']]);
  // 미리보기 글은 화면 예시뿐 — 저장하는 양식에는 들어가지 않는다.
  for (const c of START_CHOICES) assert.ok(!JSON.stringify(startForm(c.key)).includes('preview'));
});

// WEEKLY-처음시작여러개(사용자 11/17 16:04 "복수선택 가능해야할 듯"): 1~3 여러 개를 번호 순서로 이어 붙이고, 같은 이름 항목은 한 번, 4는 혼자만.
test('처음 고르기 여러 개: 합치기·겹침 제거·4 직접 만들기는 혼자만', async () => {
  const {START_CHOICES, startForm, startFormMany, startPicks, togglePick} = await import('../app/weekly-own-form-model.mjs');
  // 하나만 고르면 예전 startForm과 같다.
  for (const c of START_CHOICES) assert.deepEqual(startFormMany([c.key]), startForm(c.key), c.key);
  assert.deepEqual(startFormMany('biz'), startForm('biz'));
  // 0개·없는 열쇠뿐이면 기본(1. 간단형).
  assert.deepEqual(startFormMany([]), startForm('simple'));
  assert.deepEqual(startFormMany(['없는 번호']), startForm('simple'));
  // 고른 순서와 상관없이 번호 순서(1→2→3)로 이어 붙이고 id는 s1부터 다시.
  const all = startFormMany(['org', 'simple', 'biz', 'org']);
  assert.equal(all.name, '간단형 · 사업별 표 · 조직별');
  assert.deepEqual(all.form.sections.map(s => [s.id, s.title, s.fill]), [
    ['s1', '지난주 한 일', 'biz'], ['s2', '이번 주 할 일', 'blank'], ['s3', '주요 일정', 'schedule'],
    ['s4', '사업별 진행', 'biz'], ['s5', '조직별 상황', 'org'],
  ]);
  assert.deepEqual(all.form.sections[3].columns, ['사업명', '진행', '계획']);
  assert.deepEqual(all.form, cleanForm(all.form));
  const two = startFormMany(['org', 'biz']);
  assert.equal(two.name, '사업별 표 · 조직별');
  assert.deepEqual(two.form.sections.map(s => s.title), ['사업별 진행', '조직별 상황']);
  // 4는 다른 것과 섞이면 빠진다(빈 양식은 더할 것이 없음).
  assert.deepEqual(startPicks(['own', 'biz']), ['biz']);
  assert.deepEqual(startPicks(['own']), ['own']);
  assert.deepEqual(startFormMany(['own', 'biz']), startForm('biz'));
  assert.deepEqual(startFormMany(['own']), {form: {v: 1, sections: []}, name: '내 주간 보고 양식'});
  // 체크 켜기·끄기: 4를 켜면 1~3이 풀리고, 1~3 중 하나를 켜면 4가 풀린다. 끄면 0개도 된다.
  assert.deepEqual(togglePick(['simple'], 'org', true), ['simple', 'org']);
  assert.deepEqual(togglePick(['org'], 'simple', true), ['simple', 'org']);
  assert.deepEqual(togglePick(['simple', 'biz'], 'own', true), ['own']);
  assert.deepEqual(togglePick(['own'], 'biz', true), ['biz']);
  assert.deepEqual(togglePick(['simple', 'biz'], 'simple', false), ['biz']);
  assert.deepEqual(togglePick(['biz'], 'biz', false), []);
  assert.deepEqual(togglePick(['biz'], '없는 번호', true), ['biz']);
});

test('처음 고르기 여러 개: 같은 이름 항목은 처음 것 하나만(joinForms)', async () => {
  const {joinForms} = await import('../app/weekly-own-form-model.mjs');
  const a = {v: 1, sections: [{id: 's1', title: '지난주 한 일', columns: [], fill: 'biz'}, {id: 's2', title: '주요 일정', columns: [], fill: 'schedule'}]};
  const b = {v: 1, sections: [{id: 's1', title: '주요 일정 ', columns: ['날짜'], fill: 'blank'}, {id: 's2', title: '건의 사항', columns: [], fill: 'blank'}]};
  const out = joinForms([a, b]);
  assert.deepEqual(out.sections.map(s => [s.id, s.title, s.fill]), [['s1', '지난주 한 일', 'biz'], ['s2', '주요 일정', 'schedule'], ['s3', '건의 사항', 'blank']]);
  assert.deepEqual(out.sections[1].columns, []); // 겹치면 먼저 나온(번호가 앞선) 것을 둔다
  assert.deepEqual(joinForms([]), {v: 1, sections: []});
});
