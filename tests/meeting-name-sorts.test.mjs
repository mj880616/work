// S53-20 MTG-비정기회의접기: 회의명 정리 규칙(app/meeting-name-sorts.mjs). 지어낸 이름만 쓴다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseSorts, toStored, placeOf, orgOf, grouped, setIrregular, setOrg, orgCount, roundBase, bundle, listRows, findRows, shownNames, setPlace, moveName, addParent, renameParent, orderParents, removeParent, parentNameProblem, parentCount, newParentId, nameKey, ETC, DEL, REGULAR,
  orgSections, addPreset, removePreset, presetNameProblem, isPreset, hasMark, orderSpot, stepOrder, toOrgEnd, regularNames, PRESET_MAX, ORDER_MAX} from '../app/meeting-name-sorts.mjs';

const P1 = 'gaaaaaa1', P2 = 'gbbbbbb2';
const base = {parents: [{id: P1, name: '가상협의회'}, {id: P2, name: '샘플 모임'}], names: {}};
const entries = [
  {name: '가상협의회 대표자 회의', at: '2026-11-01T10:00:00Z'},
  {name: '샘플 정기회의', at: '2026-11-03T10:00:00Z'},
  {name: '하반기 공동 기획회의(1차)', at: '2026-10-20T10:00:00Z'},
  {name: '하반기 공동 기획회의(2차)', at: '2026-11-06T10:00:00Z'},
  {name: '가상지부 점검 회의', at: '2026-11-04T10:00:00Z'},
  {name: '한 번 모임', at: '2026-09-01T10:00:00Z'},
  {name: '지난 회의', at: '2026-08-01T10:00:00Z'},
];

test('parseSorts: DB 검사와 같은 모양만 받는다(틀리면 null → 모두 정기로 펼침)', () => {
  assert.deepEqual(parseSorts(null), {parents: [], names: {}, orgs: {}, presets: [], order: []});
  assert.deepEqual(parseSorts({}), {parents: [], names: {}, orgs: {}, presets: [], order: []});
  assert.deepEqual(parseSorts(base), {...base, orgs: {}, presets: [], order: []}, '옛 값(orgs·presets·order 없음)도 그대로 읽힘');
  for (const bad of [[], 'x', {x: 1}, {parents: {}}, {parents: [{id: 'g1', name: 'a'}]}, {parents: [{id: P1, name: ''}]}, {parents: [{id: P1, name: ' '}]},
    {parents: [{id: P1, name: '가'.repeat(31)}]}, {parents: [{id: P1, name: 'a', x: 1}]}, {names: []}, {names: {'a b': ETC}}, {names: {a: 'x'}}, {names: {a: 'gABCDEF'}},
    {names: Object.fromEntries(Array.from({length: 301}, (_, i) => ['k' + i, ETC]))},
    {orgs: []}, {orgs: {a: ETC}}, {orgs: {a: DEL}}, {orgs: {'a b': P1}}, {orgs: {a: 1}}, {orgs: Object.fromEntries(Array.from({length: 301}, (_, i) => ['k' + i, P1]))}]) assert.equal(parseSorts(bad), null, JSON.stringify(bad).slice(0, 60));
  assert.deepEqual(toStored({parents: [], names: {}}), {});
  assert.equal(toStored({parents: [], names: Object.fromEntries(Array.from({length: 300}, (_, i) => ['가'.repeat(96) + i, P1]))}), null, '32 KiB 넘으면 저장 안 함');
});

test('placeOf: 표시 없으면 정기, 없는 상위 id는 기타 비정기', () => {
  const s = {...base, names: {[nameKey('가상지부 점검 회의')]: P1, a: ETC, b: DEL, c: 'gzzzzzz9'}};
  assert.deepEqual(placeOf(s, '가상지부 점검회의'), {kind: 'irregular', parent: P1}, '띄어쓰기 무시');
  assert.deepEqual(placeOf(s, 'A'), {kind: 'irregular', parent: ETC});
  assert.deepEqual(placeOf(s, 'b'), {kind: DEL});
  assert.deepEqual(placeOf(s, 'c'), {kind: 'irregular', parent: ETC});
  assert.deepEqual(placeOf(s, '새 회의'), {kind: REGULAR});
});

test('⑤ 차수만 다른 같은 회의는 한 줄, 최근 차수가 위', () => {
  assert.equal(roundBase('하반기 공동 기획회의(2차)'), roundBase('하반기 공동 기획회의 (1차)'));
  assert.equal(roundBase('제3차 샘플회의'), roundBase('제12차 샘플회의'));
  assert.equal(roundBase('샘플회의 2차'), roundBase('샘플회의'));
  assert.notEqual(roundBase('샘플회의'), roundBase('다른회의'));
  const b = bundle(entries).find(x => x.names.length === 2);
  assert.deepEqual(b.names, ['하반기 공동 기획회의(2차)', '하반기 공동 기획회의(1차)']);
  assert.equal(b.name, '하반기 공동 기획회의(2차)');
  assert.equal(bundle(entries)[0].name, '하반기 공동 기획회의(2차)', '최근 먼저');
});

test('② 평소 목록: 정기만 + 상위 아래 접힌 비정기 묶음, 상위 이름과 같은 정기 회의 바로 아래, 기타는 맨 뒤, 지운 이름 없음', () => {
  let s = setPlace(base, ['하반기 공동 기획회의(1차)', '하반기 공동 기획회의(2차)'], P1);
  s = setPlace(s, '가상지부 점검 회의', P1);
  s = setPlace(s, '한 번 모임', ETC);
  s = setPlace(s, '지난 회의', DEL);
  const rows = listRows(entries, s);
  assert.deepEqual(rows.map(r => r.type === 'name' ? r.name : `└${r.label} ${r.items.length}`), ['샘플 정기회의', '가상협의회 대표자 회의', '└가상협의회 비정기 회의 2', '└기타 비정기 회의 1']);
  const group = rows.find(r => r.id === P1);
  assert.deepEqual(group.items.map(b => b.name), ['하반기 공동 기획회의(2차)', '가상지부 점검 회의']);
  // 상위 이름과 같은 정기 회의가 없으면 상위 목록 순서대로 정기 줄 뒤.
  const s2 = setPlace(s, '샘플 정기회의', P2);
  const r2 = listRows(entries, s2).map(r => r.type === 'group' ? r.id : r.name);
  assert.deepEqual(r2, ['가상협의회 대표자 회의', P1, P2, ETC]);
  // 정리를 못 읽으면(null) 모두 정기.
  assert.equal(listRows(entries, null).filter(r => r.type === 'name').length, bundle(entries).length);
  // 지금 고른 이름은 비정기여도 정기 줄처럼 보인다.
  assert.ok(listRows(entries, s, {keep: '한 번 모임'}).some(r => r.type === 'name' && r.name === '한 번 모임'));
  assert.ok(!shownNames(entries, s).has(nameKey('지난 회의')));
  assert.ok(shownNames(entries, s).has(nameKey('샘플 정기회의')));
});

test('③ 찾기: 비정기 포함(꼬리표), 지운 이름은 빠짐, 띄어쓰기 무시', () => {
  let s = setPlace(base, '가상지부 점검 회의', P1);
  s = setPlace(s, '지난 회의', DEL);
  const hits = findRows(entries, s, '점검');
  assert.deepEqual(hits.map(h => [h.name, h.tag]), [['가상지부 점검 회의', '비정기 · 가상협의회']]);
  assert.deepEqual(findRows(entries, s, '회의').map(h => h.name).includes('지난 회의'), false);
  assert.equal(findRows(entries, s, '샘플정기').length, 1);
  assert.deepEqual(findRows(entries, s, ''), []);
});

test('바꾸기: 정기로 돌리기·이름 옮기기·상위 추가·이름·순서·지우기(비정기는 기타로)', () => {
  let s = setPlace(base, '가상지부 점검 회의', P1);
  assert.equal(setPlace(base, 'x', 'gnotthere'), null, '없는 상위');
  assert.equal(setPlace(base, '', ETC), null);
  assert.deepEqual(setPlace(s, '가상지부 점검 회의', REGULAR).names, {});
  assert.deepEqual(moveName(s, '가상지부 점검 회의', '가상지부 점검회의 새이름').names, {[nameKey('가상지부 점검회의 새이름')]: P1});
  assert.equal(parentNameProblem('', base), '조직 이름을 써 주세요.');
  assert.equal(parentNameProblem('가상협의회', base), '같은 이름의 조직이 있어요.');
  assert.equal(parentNameProblem('가상 협의회', base, P1), '', '자기 이름은 괜찮음');
  assert.ok(parentNameProblem('기타', base));
  const added = addParent(base, '새 상위', 'gcccccc3');
  assert.deepEqual(added.parents.map(p => p.name), ['가상협의회', '샘플 모임', '새 상위']);
  assert.equal(addParent(base, '가상협의회', 'gcccccc3'), null);
  assert.equal(renameParent(base, P1, '바뀐 이름').parents[0].name, '바뀐 이름');
  assert.deepEqual(orderParents(base, [P2, P1]).parents.map(p => p.id), [P2, P1]);
  assert.equal(orderParents(base, [P1]), null);
  s = setPlace(s, '한 번 모임', P1);
  assert.equal(parentCount(s, P1), 2);
  const removed = removeParent(s, P1);
  assert.deepEqual(removed.parents.map(p => p.id), [P2]);
  assert.equal(parentCount(removed, ETC), 2, '지우지 않고 기타 비정기로');
  assert.match(newParentId(), /^g[0-9a-z]{8}$/);
});

// ---- S56-1 MTG-회의명조직묶기 ----
test('S56-1 옛 값(정기 회의 조직 없음)은 지금 모양 그대로, 조직을 하나라도 붙이면 조직 머리글로 묶음', () => {
  let s = setPlace(base, '가상지부 점검 회의', P1);
  s = setPlace(s, '한 번 모임', ETC);
  assert.equal(grouped(s), false);
  assert.ok(listRows(entries, s).every(r => r.type !== 'org'), '옛 값은 머리글 없음');
  s = setOrg(s, '가상협의회 대표자 회의', P1);
  s = setOrg(s, '샘플 정기회의', P2);
  assert.equal(grouped(s), true);
  const rows = listRows(entries, s);
  assert.deepEqual(rows.map(r => r.type === 'org' ? `[${r.label}]` : r.type === 'group' ? `└${r.label} ${r.items.length}` : r.name),
    ['[가상협의회]', '가상협의회 대표자 회의', '└비정기 회의 1', '[샘플 모임]', '샘플 정기회의', '[기타]', '하반기 공동 기획회의(2차)', '지난 회의', '└비정기 회의 1']);
  // 조직이 없는 조직(회의 0)은 머리글도 없다.
  assert.ok(!listRows(entries, addParent(s, '빈 조직', 'gcccccc3')).some(r => r.type === 'org' && r.id === 'gcccccc3'));
  // 지금 고른 이름(비정기)은 그 조직 정기 줄처럼 보인다.
  const kept = listRows(entries, s, {keep: '가상지부 점검 회의'});
  const i = kept.findIndex(r => r.type === 'name' && r.name === '가상지부 점검 회의');
  assert.ok(i > 0 && kept.slice(0, i).reverse().find(r => r.type === 'org').id === P1);
  assert.ok(shownNames(entries, s).has(nameKey('샘플 정기회의')));
});

test('S56-1 ③ 조직 바꾸기: 정기는 orgs, 비정기는 names 값, 자리는 그대로·기타로 돌리기·조직 지우면 기타', () => {
  let s = setOrg(base, '샘플 정기회의', P2);
  assert.deepEqual(s.orgs, {[nameKey('샘플 정기회의')]: P2});
  assert.equal(orgOf(s, '샘플정기회의'), P2);
  assert.deepEqual(placeOf(s, '샘플 정기회의'), {kind: REGULAR}, '정기 그대로');
  s = setPlace(s, '가상지부 점검 회의', P1);
  s = setOrg(s, '가상지부 점검 회의', P2);
  assert.deepEqual(placeOf(s, '가상지부 점검 회의'), {kind: 'irregular', parent: P2}, '비정기 그대로, 조직만');
  assert.equal(s.orgs[nameKey('가상지부 점검 회의')], undefined);
  assert.equal(setOrg(s, '샘플 정기회의', 'gnotthere'), null);
  assert.equal(orgOf(setOrg(s, '샘플 정기회의', ETC), '샘플 정기회의'), ETC);
  assert.deepEqual(setOrg(s, '샘플 정기회의', ETC).orgs, {});
  assert.equal(orgCount(s, P2), 2);
  const removed = removeParent(s, P2);
  assert.deepEqual(removed.orgs, {}, '조직을 지우면 정기는 기타');
  assert.equal(removed.names[nameKey('가상지부 점검 회의')], ETC, '비정기는 기타 비정기');
  // 없는 조직 id가 남아 있어도 기타.
  assert.equal(orgOf({...base, names: {}, orgs: {a: 'gzzzzzz9'}}, 'a'), ETC);
});

test('S56-1 비정기로 두기·정기로 돌리기·지우기·이름 바꾸기에서 조직이 따라감', () => {
  let s = setOrg(base, '샘플 정기회의', P2);
  s = setIrregular(s, '샘플 정기회의');
  assert.deepEqual(placeOf(s, '샘플 정기회의'), {kind: 'irregular', parent: P2}, '지금 조직 아래 비정기');
  assert.deepEqual(s.orgs, {});
  s = setPlace(s, '샘플 정기회의', REGULAR);
  assert.deepEqual(placeOf(s, '샘플 정기회의'), {kind: REGULAR});
  assert.equal(orgOf(s, '샘플 정기회의'), P2, '정기로 돌려도 조직은 그대로');
  assert.equal(orgOf(setIrregular(base, '한 번 모임'), '한 번 모임'), ETC, '조직 없는 회의는 기타 비정기');
  s = setPlace(s, '샘플 정기회의', DEL);
  assert.equal(orgOf(setPlace(s, '샘플 정기회의', REGULAR), '샘플 정기회의'), P2, '지웠다 돌아와도 조직 그대로');
  const moved = moveName(setOrg(base, '샘플 정기회의', P2), '샘플 정기회의', '샘플 새 정기회의');
  assert.deepEqual(moved.orgs, {[nameKey('샘플 새 정기회의')]: P2});
  assert.deepEqual(toStored(setOrg(base, '샘플 정기회의', P2)).orgs, {[nameKey('샘플 정기회의')]: P2});
  assert.equal('orgs' in toStored(base), false, '빈 orgs는 저장하지 않음(적용 전 서버와도 맞음)');
});

test('S56-1 ⑤ 찾기 꼬리표: 조직에 넣은 정기는 조직 이름, 비정기는 비정기 · 조직, 기타 정기는 없음', () => {
  let s = setOrg(base, '샘플 정기회의', P2);
  s = setPlace(s, '가상지부 점검 회의', P1);
  const tags = Object.fromEntries(findRows(entries, s, '회의').map(h => [h.name, h.tag]));
  assert.equal(tags['샘플 정기회의'], '샘플 모임');
  assert.equal(tags['가상지부 점검 회의'], '비정기 · 가상협의회');
  assert.equal(tags['가상협의회 대표자 회의'], '');
});

test('상위 목록 처음 값은 비어 있고 코드에 실제 단체 이름을 넣지 않는다', () => {
  const src = ['app/meeting-name-sorts.mjs', 'app/meeting-name-panel.js', 'app/meeting-name-parents.js', 'supabase/migrations/20261108090000_profile_meeting_name_sorts.sql', 'supabase/migrations/20261110090000_profile_meeting_name_orgs.sql']
    .map(f => readFileSync(new URL('../' + f, import.meta.url), 'utf8')).join('\n');
  assert.doesNotMatch(src, /궤도|철도|노조|지부\s*투쟁|협의회 대표자/);
  assert.match(src, /default '\{\}'::jsonb/);
});

// ---- S57-14 MTG-회의명처음배치: 미리 넣은 회의(presets)·정기 줄 순서(order). 지어낸 이름만 쓴다. ----
const S0 = () => parseSorts({parents: [{id: P1, name: '예시 조직 A'}, {id: P2, name: '예시 조직 B'}]});
const E = [
  {name: '예시 회의 1', at: '2026-11-01T10:00:00Z'},
  {name: '예시 회의 2', at: '2026-11-05T10:00:00Z'},
  {name: '예시 회의 3', at: '2026-11-03T10:00:00Z'},
  {name: '예시 회의 4', at: '2026-10-01T10:00:00Z'},
];
const shape = rows => rows.map(r => r.type === 'org' ? `[${r.label}]` : r.type === 'group' ? `└${r.items.length}` : r.name + (r.preset ? '*' : ''));
const KNOWN = E.map(e => e.name);
// 고르기 창이 하는 대로: 조직 바꾸기 → 그 조직 맨 아래 / 미리 넣기 → 그 조직 맨 아래
const put = (s, name, org) => toOrgEnd(E, setOrg(s, name, org), name);
const pre = (s, name, org) => toOrgEnd(E, addPreset(s, name, org, KNOWN), name);

test('S57-14 parseSorts·toStored: presets·order 칸(DB 검사와 같은 모양), 같은 열쇠는 한 번만', () => {
  const v = {presets: ['예시 회의 9', '예시 회의 10'], order: ['예시회의9', '예시회의1']};
  assert.deepEqual(parseSorts(v), {parents: [], names: {}, orgs: {}, ...v});
  assert.deepEqual(toStored(parseSorts(v)), v);
  assert.deepEqual(toStored(parseSorts({presets: [], order: []})), {}, '빈 칸은 저장하지 않음');
  assert.deepEqual(parseSorts({presets: ['예시 회의 9', '예시회의9'], order: ['a', 'b', 'a']}), {parents: [], names: {}, orgs: {}, presets: ['예시 회의 9'], order: ['a', 'b']});
  for (const bad of [{presets: {}}, {presets: 'x'}, {presets: [1]}, {presets: ['']}, {presets: ['  ']}, {presets: ['가,나']}, {presets: ['가\n나']}, {presets: ['가'.repeat(101)]},
    {presets: Array.from({length: PRESET_MAX + 1}, (_, i) => '예시 ' + i)}, {order: {}}, {order: [1]}, {order: ['a b']}, {order: ['']}, {order: ['a,b']},
    {order: Array.from({length: ORDER_MAX + 1}, (_, i) => 'k' + i)}]) assert.equal(parseSorts(bad), null, JSON.stringify(bad).slice(0, 60));
  assert.ok(parseSorts({presets: Array.from({length: PRESET_MAX}, (_, i) => '예시 ' + i), order: Array.from({length: ORDER_MAX}, (_, i) => 'k' + i)}));
});

test('S57-14 조직에 넣은 순서가 곧 보이는 순서: 조직 바꾸기·미리 넣기는 그 조직 맨 아래에 붙는다', () => {
  let s = S0();
  // 처음 배치: 회의 3 → A, 미리 넣기 9 → A, 회의 1 → A, 회의 2 → B, 미리 넣기 10 → B (최근 순서와 다르게)
  s = put(s, '예시 회의 3', P1);
  s = pre(s, '예시 회의 9', P1);
  s = put(s, '예시 회의 1', P1);
  s = put(s, '예시 회의 2', P2);
  s = pre(s, ' 예시 회의 10 ', P2);
  assert.deepEqual(s.presets, ['예시 회의 9', '예시 회의 10'], '앞뒤 공백은 뗀다');
  assert.deepEqual(s.order, ['예시회의3', '예시회의9', '예시회의1', '예시회의2', '예시회의10']);
  assert.ok(grouped(s));
  const want = ['[예시 조직 A]', '예시 회의 3', '예시 회의 9*', '예시 회의 1', '[예시 조직 B]', '예시 회의 2', '예시 회의 10*', '[기타]', '예시 회의 4'];
  assert.deepEqual(shape(listRows(E, s)), want);
  // 저장했다 다시 읽어도(새로 고침·다른 기기) 같은 목록
  assert.deepEqual(shape(listRows(E, parseSorts(JSON.parse(JSON.stringify(toStored(s)))))), want);
  // 머리글 없는 추천 목록(파일로 만들기 '종류' 칸)도 같은 이름·같은 순서
  assert.deepEqual(regularNames(E, s), ['예시 회의 3', '예시 회의 9', '예시 회의 1', '예시 회의 2', '예시 회의 10', '예시 회의 4']);
  // 순서 표시가 없는 회의는 순서 있는 회의 뒤에 최근 먼저(옛 값은 지금 모양 그대로)
  assert.deepEqual(shape(listRows(E, {...s, order: ['예시회의1']})).slice(0, 4), ['[예시 조직 A]', '예시 회의 1', '예시 회의 3', '예시 회의 9*']);
  assert.deepEqual(shape(listRows(E, {...s, order: []})).slice(0, 4), ['[예시 조직 A]', '예시 회의 3', '예시 회의 1', '예시 회의 9*'], '순서 없음: 최근 먼저, 보고 없는 회의는 맨 뒤');
  // 순서 표시가 없던 조직에 하나를 넣어도 맨 아래: 그 조직의 지금 순서(최근 먼저)가 굳고 새로 넣은 회의가 그 뒤
  const old = {...S0(), orgs: {'예시회의1': P1, '예시회의2': P1}};
  const added = put(old, '예시 회의 4', P1);
  assert.deepEqual(shape(listRows(E, added)).slice(0, 4), ['[예시 조직 A]', '예시 회의 2', '예시 회의 1', '예시 회의 4']);
  assert.deepEqual(added.order, ['예시회의2', '예시회의1', '예시회의4']);
  // 같은 조직을 다시 고르면 맨 아래로, 다른 조직으로 옮기면 그 조직 맨 아래, 기타로 빼면 순서 표시를 지움
  assert.deepEqual(put(s, '예시 회의 3', P1).order, ['예시회의2', '예시회의10', '예시회의9', '예시회의1', '예시회의3']);
  assert.deepEqual(shape(listRows(E, put(s, '예시 회의 3', P2))).slice(0, 7), ['[예시 조직 A]', '예시 회의 9*', '예시 회의 1', '[예시 조직 B]', '예시 회의 2', '예시 회의 10*', '예시 회의 3']);
  assert.deepEqual(setOrg(s, '예시 회의 3', ETC).order, ['예시회의9', '예시회의1', '예시회의2', '예시회의10']);
  assert.deepEqual(setOrg(s, '예시 회의 3', P1).order, s.order, '조직이 그대로면 순서 표시도 그대로');
  // 비정기로 접힌 회의는 순서 대상이 아니다(조직만 바뀜)
  const irr = setPlace(s, '예시 회의 4', ETC);
  assert.deepEqual(toOrgEnd(E, setOrg(irr, '예시 회의 4', P1), '예시 회의 4').order, s.order);
  // 조직을 지우면 그 조직 회의는 기타로, 순서 표시도 지움(미리 넣은 회의는 남는다)
  const gone = removeParent(s, P1);
  assert.deepEqual(gone.order, ['예시회의2', '예시회의10']);
  assert.deepEqual(shape(listRows(E, gone)), ['[예시 조직 B]', '예시 회의 2', '예시 회의 10*', '[기타]', '예시 회의 3', '예시 회의 1', '예시 회의 4', '예시 회의 9*']);
});

test('S57-14 미리 넣은 회의: 조직 없이도 보이고, 보고가 생기면 보통 줄, ⋯ 빼기로 사라진다', () => {
  const known = E.map(e => e.name);
  let s = addPreset(S0(), '예시 회의 9', ETC, known);
  assert.equal(grouped(s), false, '조직에 넣은 정기 회의가 없으면 묶지 않는다');
  assert.deepEqual(shape(listRows(E, s)), ['예시 회의 2', '예시 회의 3', '예시 회의 1', '예시 회의 4', '예시 회의 9*']);
  assert.ok(shownNames(E, s).has('예시회의9'));
  assert.deepEqual(findRows(E, s, '회의9').map(r => [r.name, r.preset, r.tag]), [['예시 회의 9', true, '']]);
  assert.deepEqual(findRows(E, addPreset(S0(), '예시 회의 9', P1, known), '회의 9').map(r => r.tag), ['예시 조직 A']);
  assert.equal(isPreset(s, '예시회의 9'), true); assert.equal(hasMark(s, '예시 회의 9'), true); assert.equal(hasMark(s, '예시 회의 1'), false);
  // 같은 이름의 보고가 생기면 한 줄(보고 있는 줄)만
  const withReport = [...E, {name: '예시 회의 9', at: '2026-11-08T10:00:00Z'}];
  assert.deepEqual(shape(listRows(withReport, s))[0], '예시 회의 9');
  // 이름 문제
  assert.equal(presetNameProblem('', s, known), '회의명을 써 주세요.');
  assert.equal(presetNameProblem('가,나', s, known), '쉼표(,)는 쓸 수 없어요.');
  assert.equal(presetNameProblem('가'.repeat(101), s, known), '회의명은 100자까지예요.');
  assert.equal(presetNameProblem('예시회의9', s, known), '이미 목록에 있는 회의예요.');
  assert.equal(presetNameProblem('예시 회의 1', s, known), '이미 목록에 있는 회의예요.');
  assert.equal(addPreset(s, '예시 회의 1', ETC, known), null);
  assert.equal(addPreset(s, '예시 회의 11', 'gzzzzzz9', known), null, '없는 조직');
  const full = {...S0(), presets: Array.from({length: PRESET_MAX}, (_, i) => '예시 ' + i)};
  assert.equal(presetNameProblem('하나 더', full, known), `미리 넣는 회의는 ${PRESET_MAX}개까지예요.`);
  // 삭제(목록에서 지움)했던 회의명은 다시 넣으면 돌아온다(보고가 있는 이름이면 미리 넣은 표시는 더하지 않음)
  const del = setPlace(S0(), '예시 회의 4', DEL);
  const back = addPreset(del, '예시 회의 4', P1, known);
  assert.deepEqual([back.names, back.presets, back.orgs, back.order], [{}, [], {'예시회의4': P1}, []]);
  // 빼기: 미리 넣은 표시·조직·순서 표시를 지운다
  const two = pre(pre(S0(), '예시 회의 9', P1), '예시 회의 10', P1);
  const out = removePreset(two, '예시 회의 9');
  assert.deepEqual(two.order, ['예시회의9', '예시회의10']);
  assert.deepEqual([out.presets, out.orgs, out.order], [['예시 회의 10'], {'예시회의10': P1}, ['예시회의10']]);
  assert.equal(removePreset(two, '예시 회의 1'), null, '미리 넣은 회의가 아니면 못 뺀다');
  assert.deepEqual(toStored(removePreset(out, '예시 회의 10')), {parents: S0().parents});
});

test('S57-14 ⋯ [위로]·[아래로]: 같은 조직 정기 줄 안에서만 한 칸씩, 끝에서는 못 움직인다', () => {
  const known = E.map(e => e.name);
  let s = put(put(S0(), '예시 회의 3', P1), '예시 회의 1', P1);
  s = pre(s, '예시 회의 9', P1);
  const spot = orderSpot(E, s, '예시 회의 1');
  assert.deepEqual([spot.index, spot.count, spot.keys], [1, 3, ['예시회의3', '예시회의1', '예시회의9']]);
  const up = stepOrder(E, s, '예시 회의 9', -1);
  assert.deepEqual(shape(listRows(E, up)).slice(0, 4), ['[예시 조직 A]', '예시 회의 3', '예시 회의 9*', '예시 회의 1']);
  assert.equal(stepOrder(E, s, '예시 회의 3', -1), null); assert.equal(stepOrder(E, s, '예시 회의 9', 1), null);
  assert.equal(orderSpot(E, s, '없는 회의'), null);
  // 순서 표시가 없던 줄(기타: 최근 먼저)도 지금 자리에서 한 칸 — 움직이면 그 묶음 순서가 통째로 굳는다
  assert.deepEqual(shape(listRows(E, s)).slice(4), ['[기타]', '예시 회의 2', '예시 회의 4']);
  const down = stepOrder(E, s, '예시 회의 2', 1);
  assert.deepEqual(shape(listRows(E, down)).slice(4), ['[기타]', '예시 회의 4', '예시 회의 2']);
  assert.deepEqual(down.order, ['예시회의3', '예시회의1', '예시회의9', '예시회의4', '예시회의2']);
  // 조직으로 묶지 않은 목록(옛 값)도 정기 줄 전부를 한 묶음으로 움직인다
  const plain = stepOrder(E, S0(), '예시 회의 4', -1);
  assert.deepEqual(shape(listRows(E, plain)), ['예시 회의 2', '예시 회의 3', '예시 회의 4', '예시 회의 1']);
  // 비정기로 접힌 회의는 순서 대상이 아니다
  assert.equal(orderSpot(E, setPlace(s, '예시 회의 4', ETC), '예시 회의 4'), null);
});

test('S57-14 이름 바꾸기: 순서·미리 넣은 표시도 새 이름으로', () => {
  let s = pre(put(S0(), '예시 회의 3', P1), '예시 회의 9', P1);
  const a = moveName(s, '예시 회의 9', '예시 회의 구');
  assert.deepEqual([a.presets, a.orgs['예시회의구'], a.order], [['예시 회의 구'], P1, ['예시회의3', '예시회의구']]);
  const b = moveName(s, '예시 회의 3', '예시 회의 삼');
  assert.deepEqual([b.presets, b.orgs, b.order], [['예시 회의 9'], {'예시회의삼': P1, '예시회의9': P1}, ['예시회의삼', '예시회의9']]);
  // 새 이름의 순서 표시가 이미 있으면 옛 표시만 뺀다(두 줄이 되지 않게). 같은 이름의 보고가 있으면 목록에는 보고 있는 줄 하나만 보인다.
  const c = moveName(s, '예시 회의 9', '예시 회의 3');
  assert.deepEqual([c.presets, c.order], [['예시 회의 3'], ['예시회의3']]);
  assert.deepEqual(shape(listRows(E, c)).slice(0, 2), ['[예시 조직 A]', '예시 회의 3']);
  const d = moveName(pre(s, '예시 회의 10', P1), '예시 회의 9', '예시 회의 10');
  assert.deepEqual([d.presets, d.order], [['예시 회의 10'], ['예시회의3', '예시회의10']]);
  // 띄어쓰기만 바꿔도(열쇠는 같음) 미리 넣은 회의의 보이는 이름은 바뀐다
  assert.deepEqual(moveName(s, '예시 회의 9', '예시회의 9').presets, ['예시회의 9']);
});

test('S57-14 orgSections: 회의 [목록]·[회의 ▾] 상자도 고르기 창과 같은 묶음·같은 순서(보고가 있는 회의만)', () => {
  const known = E.map(e => e.name);
  let s = put(S0(), '예시 회의 3', P1); s = pre(s, '예시 회의 9', P1); s = put(s, '예시 회의 1', P1); s = put(s, '예시 회의 2', P2);
  const items = ['예시 회의 1', '예시 회의 2', '예시 회의 3', '예시 회의 4'].map(name => ({name}));
  const names = sec => sec.map(g => [g.label, ...g.items.map(x => x.name + (x.preset ? '*' : ''))]);
  assert.deepEqual(names(orgSections(items, s)), [['예시 조직 A', '예시 회의 3', '예시 회의 1'], ['예시 조직 B', '예시 회의 2'], ['기타', '예시 회의 4']]);
  // 고르기 창 목록과 같은 순서
  assert.deepEqual(shape(listRows(E, s)), ['[예시 조직 A]', '예시 회의 3', '예시 회의 9*', '예시 회의 1', '[예시 조직 B]', '예시 회의 2', '[기타]', '예시 회의 4']);
  // 미리 넣은 회의만 조직에 있어도 묶는다. 조직으로 묶지 않으면 지금처럼 null
  assert.ok(grouped(addPreset(S0(), '예시 회의 9', P1, known)));
  assert.equal(orgSections(items, addPreset(S0(), '예시 회의 9', ETC, known)), null);
  // 순서 표시가 없는 회의는 받은 순서 그대로(옛 값은 지금 모양 그대로)
  assert.deepEqual(names(orgSections(items, {...s, order: []})), [['예시 조직 A', '예시 회의 1', '예시 회의 3'], ['예시 조직 B', '예시 회의 2'], ['기타', '예시 회의 4']]);
});
