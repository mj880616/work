// S53-20 MTG-비정기회의접기: 회의명 정리 규칙(app/meeting-name-sorts.mjs). 지어낸 이름만 쓴다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseSorts, toStored, placeOf, orgOf, grouped, setIrregular, setOrg, orgCount, roundBase, bundle, listRows, findRows, shownNames, setPlace, moveName, addParent, renameParent, orderParents, removeParent, parentNameProblem, parentCount, newParentId, nameKey, ETC, DEL, REGULAR} from '../app/meeting-name-sorts.mjs';

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
  assert.deepEqual(parseSorts(null), {parents: [], names: {}, orgs: {}});
  assert.deepEqual(parseSorts({}), {parents: [], names: {}, orgs: {}});
  assert.deepEqual(parseSorts(base), {...base, orgs: {}}, '옛 값(orgs 없음)도 그대로 읽힘');
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
