// S67-30 WEEKLY-칸빼기합치기: 주간보고 칸 빼기(hide)·다른 칸 안으로(into) 모양 한 곳(app/weekly-area-layout.mjs)과 저장 모양(draft.places, weekly-feedback.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import {areaLayout, layoutAreas, outOfReport} from '../app/weekly-area-layout.mjs';
import {readPlaces, withAreaChange, withPlace} from '../app/weekly-feedback.mjs';

const areas = () => [
  {id: 'a', name: '가람지하철협의회', rows: [{task: null, items: []}]},
  {id: 'b', name: '궤도 공동투쟁', rows: [{task: null, items: [{text: '가상'}]}]},
  {id: 'c', name: '민자철도 사업', rows: [{task: {id: 'c1', name: '가상 세부'}, items: []}]},
  {id: 'd', name: '산별운동', rows: [{task: null, items: []}]},
];

test('저장 모양: hide·into 표시는 고른 자리(area·task)를 지우지 않고 더하고, 다시 넣기는 표시만 지운다', () => {
  let p = withPlace(null, '궤도 공동투쟁', {area: '가상 묶음', task: '가상 자리'}, 't1');
  p = withAreaChange(p, '궤도 공동투쟁', {into: '가람지하철협의회'}, 't2');
  assert.deepEqual(p.map['궤도 공동투쟁'], {area: '가상 묶음', task: '가상 자리', into: '가람지하철협의회'});
  p = withAreaChange(p, '민자철도 사업', {hide: true}, 't3');
  assert.deepEqual(p.map['민자철도 사업'], {area: '', task: '', hide: true});
  p = withAreaChange(p, '민자철도 사업', {}, 't4');
  assert.deepEqual(p.map['민자철도 사업'], {area: '', task: ''}, '다시 넣기 = 표시만 지움(지난주 값이 다시 이어지지 않게 칸은 남김)');
  assert.equal(readPlaces({map: {x: {area: '', task: '', into: 'x'}}}).map.x.into, undefined, '자기 자신 안으로는 버림');
  assert.equal(readPlaces({map: {x: {area: '', task: '', into: 'y'.repeat(61)}}}), null, '이름 60자 넘으면 버림');
});

test('layoutAreas: 뺀 칸은 빠지고, 넣은 칸은 받는 칸 끝에 자기 칸·세부 과제 줄로(칸 id 그대로)', () => {
  const lay = areaLayout({map: {'궤도 공동투쟁': {area: '', task: '', into: '가람지하철협의회'}, '민자철도 사업': {area: '', task: '', into: '가람지하철협의회'}, '산별운동': {area: '', task: '', hide: true}}});
  const r = layoutAreas(areas(), lay);
  assert.deepEqual(r.areas.map(a => a.name), ['가람지하철협의회']);
  assert.deepEqual(r.areas[0].rows.map(x => [x.task?.id ?? null, x.task?.name ?? '']), [[null, ''], ['b', '궤도 공동투쟁'], ['c', '민자철도 사업'], ['c1', '민자철도 사업 · 가상 세부']]);
  assert.deepEqual(r.hidden, [{id: 'd', name: '산별운동'}]);
  assert.deepEqual(r.moved.map(m => [m.name, m.into]), [['궤도 공동투쟁', '가람지하철협의회'], ['민자철도 사업', '가람지하철협의회']]);
  assert.equal(outOfReport(lay, '궤도  공동투쟁'), true, '띄어쓰기는 무시');
  assert.equal(outOfReport(lay, '가람지하철협의회'), false);
});

test('layoutAreas: 받는 칸이 없거나 빠졌거나 그 자신도 넣은 칸이면 제자리(한 단계만)', () => {
  const lay = areaLayout({map: {'궤도 공동투쟁': {area: '', task: '', into: '없는 칸'}, '민자철도 사업': {area: '', task: '', into: '산별운동'}, '산별운동': {area: '', task: '', hide: true}}});
  assert.deepEqual(layoutAreas(areas(), lay).areas.map(a => a.name), ['가람지하철협의회', '궤도 공동투쟁', '민자철도 사업']);
  const chain = areaLayout({map: {'궤도 공동투쟁': {area: '', task: '', into: '민자철도 사업'}, '민자철도 사업': {area: '', task: '', into: '가람지하철협의회'}}});
  assert.deepEqual(layoutAreas(areas(), chain).areas.map(a => a.name), ['가람지하철협의회', '궤도 공동투쟁', '산별운동']);
  assert.equal(layoutAreas(areas(), areaLayout(null)).areas.length, 4, '표시 없으면 그대로');
});
