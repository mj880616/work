import { test } from 'node:test';
import assert from 'node:assert/strict';
// PRJ-순서바꾸기: one project order (app/project-order.mjs) and the journal groups that follow it. Names are synthetic.
import { compareOrder, ordered, siblings, reorderPlan } from '../app/project-order.mjs';
const journal = import('../app/journal-data.js'), weekly = import('../app/journal-weekly.js');
const at = n => `2026-09-0${n}T00:00:00Z`;
const spaces = [
  {id:'pb', name:'합성 조직 사업', status:'active', sort_order:30, created_at:at(3)},
  {id:'pa', name:'합성 정책 사업', status:'active', sort_order:10, created_at:at(1)},
  {id:'pc', name:'합성 하위 토론회', parent_id:'pa', status:'active', sort_order:20, created_at:at(2)},
  {id:'pg', name:'합성 하위 설명회', parent_id:'pa', status:'active', sort_order:60, created_at:at(6)},
  {id:'pd', name:'합성 세부 사안', parent_id:'pc', status:'active', sort_order:25, created_at:at(2)},
  {id:'pe', name:'합성 교섭 사업', status:'active', sort_order:40, created_at:at(4)},
];
const ids = rows => rows.map(x => x.id);

test('order: sort_order (empty last), then created_at, then the read order', () => {
  assert.deepEqual(ids(ordered([{id:'x', sort_order:null}, {id:'y', sort_order:20}, {id:'z', sort_order:10, created_at:at(2)}, {id:'w', sort_order:10, created_at:at(1)}])), ['w', 'z', 'y', 'x']);
  assert.deepEqual(ids(ordered([{id:'b'}, {id:'a'}])), ['b', 'a']);
  assert.equal(compareOrder({sort_order:'5'}, {sort_order:7}), -1);
  assert.deepEqual(ordered(null), []);
});

test('siblings: same parent only; a project with an unlisted parent stands with the top level; archived is out', () => {
  const rows = [...spaces, {id:'orphan', parent_id:'gone', status:'active', sort_order:5}, {id:'old', status:'archived', sort_order:1}];
  assert.deepEqual(ids(siblings(rows, rows.find(x => x.id === 'pb'))), ['orphan', 'pa', 'pb', 'pe']);
  assert.deepEqual(ids(siblings(rows, rows.find(x => x.id === 'pg'))), ['pc', 'pg']);
  assert.deepEqual(ids(siblings(rows, rows.find(x => x.id === 'pd'))), ['pd']);
  assert.deepEqual(siblings(rows, null), []);
});

test('reorderPlan: siblings renumbered 10, 20, …; unchanged rows and parent_id are never written', () => {
  assert.deepEqual(reorderPlan(spaces, 'pe', 0), [{id:'pe', sort_order:10}, {id:'pa', sort_order:20}]);
  assert.deepEqual(reorderPlan(spaces, 'pg', 0), [{id:'pg', sort_order:10}]);
  assert.deepEqual(reorderPlan(spaces, 'pa', 99), [{id:'pb', sort_order:10}, {id:'pe', sort_order:20}, {id:'pa', sort_order:30}]);
  assert.deepEqual(reorderPlan(spaces, 'pa', 0), []);
  assert.deepEqual(reorderPlan(spaces, 'pd', 1), []);
  assert.deepEqual(reorderPlan(spaces, 'nope', 0), []);
  for (const write of reorderPlan(spaces, 'pe', 0)) assert.deepEqual(Object.keys(write), ['id', 'sort_order']);
  // Legacy ties (all 0) become distinct numbers in the shown order.
  const tied = [{id:'a', status:'active', sort_order:0}, {id:'b', status:'active', sort_order:0}, {id:'c', status:'active', sort_order:0}];
  assert.deepEqual(reorderPlan(tied, 'c', 1), [{id:'a', sort_order:10}, {id:'c', sort_order:20}, {id:'b', sort_order:30}]);
});

test('업무일지 프로젝트 소식 and 주간 정리 follow the project tree; without the tree the day card stays 가나다순', async () => {
  const {projectNewsOn, dayMaterials} = await journal, {placeRecords} = await weekly;
  const day = '2026-10-06';
  const rows = [['pe', '합성 교섭 사업'], ['pa', '합성 정책 사업'], ['pb', '합성 조직 사업']].map(([project_id, name], i) =>
    ({project_id, project:{name}, effective_on:day, summary:'기록 ' + i, created_at:`${day}T0${i}:00:00+09:00`}));
  const tree = list => list.map(id => ({project:{id, name:spaces.find(x => x.id === id).name}, depth:0}));
  const names = sections => sections.map(x => x.name);
  assert.deepEqual(names(projectNewsOn({projectUpdates:rows}, day)), ['합성 교섭 사업', '합성 정책 사업', '합성 조직 사업']);
  assert.deepEqual(names(projectNewsOn({projectUpdates:rows}, day, tree(['pb', 'pe', 'pa']))), ['합성 조직 사업', '합성 교섭 사업', '합성 정책 사업']);
  // A project the tree does not have comes after the ordered ones.
  assert.deepEqual(names(projectNewsOn({projectUpdates:rows}, day, tree(['pa']))), ['합성 정책 사업', '합성 교섭 사업', '합성 조직 사업']);
  // The day card uses the catalog read when it is there.
  const ok = items => ({status:'ok', items});
  const materials = {basket:ok({notes:[], links:[], docs:[]}), orgUpdates:ok([]), projectUpdates:ok(rows), catalog:ok(tree(['pb', 'pe', 'pa']))};
  const group = dayMaterials(materials, day).find(g => g.key === 'projects');
  assert.deepEqual(names(group.sections), ['합성 조직 사업', '합성 교섭 사업', '합성 정책 사업']);
  const failed = dayMaterials({...materials, catalog:{status:'failed'}}, day).find(g => g.key === 'projects');
  assert.deepEqual(names(failed.sections), ['합성 교섭 사업', '합성 정책 사업', '합성 조직 사업']);
  // [주간 정리] (and its 한글 file) places the 사업영역 in the same tree order.
  const records = rows.map(r => ({id:r.project_id, name:r.project.name, day, at:r.created_at, text:r.summary}));
  assert.deepEqual(placeRecords(records, tree(['pb', 'pe', 'pa'])).areas.map(a => a.id), ['pb', 'pe', 'pa']);
});
