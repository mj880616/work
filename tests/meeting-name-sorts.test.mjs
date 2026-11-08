// S53-20 MTG-비정기회의접기: 회의명 정리 규칙(app/meeting-name-sorts.mjs). 지어낸 이름만 쓴다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseSorts, toStored, placeOf, roundBase, bundle, listRows, findRows, shownNames, setPlace, moveName, addParent, renameParent, orderParents, removeParent, parentNameProblem, parentCount, newParentId, nameKey, ETC, DEL, REGULAR} from '../app/meeting-name-sorts.mjs';

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
  assert.deepEqual(parseSorts(null), {parents: [], names: {}});
  assert.deepEqual(parseSorts({}), {parents: [], names: {}});
  assert.deepEqual(parseSorts(base), base);
  for (const bad of [[], 'x', {x: 1}, {parents: {}}, {parents: [{id: 'g1', name: 'a'}]}, {parents: [{id: P1, name: ''}]}, {parents: [{id: P1, name: ' '}]},
    {parents: [{id: P1, name: '가'.repeat(31)}]}, {parents: [{id: P1, name: 'a', x: 1}]}, {names: []}, {names: {'a b': ETC}}, {names: {a: 'x'}}, {names: {a: 'gABCDEF'}},
    {names: Object.fromEntries(Array.from({length: 301}, (_, i) => ['k' + i, ETC]))}]) assert.equal(parseSorts(bad), null, JSON.stringify(bad).slice(0, 60));
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
  assert.equal(parentNameProblem('', base), '상위 이름을 써 주세요.');
  assert.equal(parentNameProblem('가상협의회', base), '같은 이름의 상위가 있어요.');
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

test('상위 목록 처음 값은 비어 있고 코드에 실제 단체 이름을 넣지 않는다', () => {
  const src = ['app/meeting-name-sorts.mjs', 'app/meeting-name-panel.js', 'app/meeting-name-parents.js', 'supabase/migrations/20261108090000_profile_meeting_name_sorts.sql']
    .map(f => readFileSync(new URL('../' + f, import.meta.url), 'utf8')).join('\n');
  assert.doesNotMatch(src, /궤도|철도|노조|지부\s*투쟁|협의회 대표자/);
  assert.match(src, /default '\{\}'::jsonb/);
});
