// S71-53 NOTE-관계선(사용자 결정 2026-11-26 19:58 "서로의 관계성을 잇고", 21:10~21:11 "관계망 형성이 되어야해"):
// 관계선 계산(note-board-relation-model.mjs)과 저장(note-board-links-data.js의 kind 칸 — 적용 전에는 관계선을 막고 일반 선으로 저장하지 않음).
import test from 'node:test';
import assert from 'node:assert/strict';
import { isRelation, relationSpec, linkedEither, relationNames, relationsOf, gatherEnd, findCells, followSide, RELATION_LOOK } from '../app/note-board-relation-model.mjs';
import { parseLink } from '../app/note-board-links-model.mjs';
import { createBoardLinks } from '../app/note-board-links-data.js';

const line = (over = {}) => ({id:'l1', board_id:'bmap0001', from_note:null, to_note:null, from_text:null, to_text:null, ends:'end', label:null, kind:'line', ...over});

test('관계선 칸: 종류 relation만 관계선, 옛 줄(칸 없음)은 지금 선 · 새 관계선 = 점선·곡선·방향 없음, 노트·상자 섞어 잇기', () => {
  const base = {id:'x', board_id:'bmap0001', from_note:'n1', to_note:null, from_text:null, to_text:'t1', shape:'line', dash:'solid', ends:'end'};
  assert.equal(parseLink(base).kind, 'line', '칸이 없는 옛 줄 = 지금 선');
  assert.equal(parseLink({...base, kind:'relation'}).kind, 'relation');
  assert.equal(parseLink({...base, kind:'other'}).kind, 'line', '모르는 값 = 지금 선');
  assert.equal(isRelation(parseLink({...base, kind:'relation'})), true);
  const spec = relationSpec('bmap0001', {kind:'note', id:'photo1'}, {kind:'text', id:'label1'});
  assert.deepEqual(spec, {board_id:'bmap0001', from_note:'photo1', from_text:null, to_note:null, to_text:'label1', from_side:null, to_side:null, ...RELATION_LOOK});
  assert.deepEqual(RELATION_LOOK, {kind:'relation', shape:'curve', dash:'dashed', ends:'none'});
});

test('같은 두 칸은 한 줄: 어느 방향·어느 종류든 이미 있으면 막기', () => {
  const links = [line({from_note:'a', to_text:'b'})];
  assert.equal(linkedEither(links, 'bmap0001', 'a', 'b'), true);
  assert.equal(linkedEither(links, 'bmap0001', 'b', 'a'), true, '반대 방향도');
  assert.equal(linkedEither(links, 'bother01', 'a', 'b'), false, '다른 보드는 따로');
  assert.equal(linkedEither(links, 'bmap0001', 'a', 'c'), false);
});

test('자주 쓴 이름: 관계선 이름만, 많이 쓴 것부터(같으면 최근 것), 6개까지', () => {
  const r = (label, kind = 'relation') => line({kind, label});
  const links = [r('원인'), r('반대'), r('원인'), r('같은 사람'), r('반대'), r('원인'), r('그냥 선 글자', 'line'), r(null)];
  assert.deepEqual(relationNames(links), ['원인', '반대', '같은 사람']);
  assert.deepEqual(relationNames([...Array(9)].map((_, i) => r(`이름${i}`))).length, 6);
});

test('칸의 관계 목록: 그 보드 관계선만, 상대 칸과 방향', () => {
  const links = [line({id:'r1', kind:'relation', from_note:'p', to_text:'t', ends:'end'}), line({id:'r2', kind:'relation', from_text:'s', to_note:'p', ends:'none', label:'원인'}),
    line({id:'r3', kind:'relation', from_note:'p', to_text:'u', ends:'both'}), line({id:'l9', from_note:'p', to_text:'z'}), line({id:'r4', board_id:'bother01', kind:'relation', from_note:'p', to_text:'q'})];
  assert.deepEqual(relationsOf(links, 'bmap0001', 'p').map(r => [r.link.id, r.other, r.dir]), [['r1', 't', 'out'], ['r2', 's', 'none'], ['r3', 'u', 'both']]);
  assert.deepEqual(relationsOf(links, 'bmap0001', 's').map(r => [r.other, r.dir]), [['p', 'none']]);
});

test('접힌 가지 끝으로 모으기: 보이면 그대로, 접혀 안 보이면 가장 가까운 보이는 윗칸', () => {
  const parentOf = new Map([['c', 'b'], ['b', 'a'], ['d', 'c']]), hidden = new Set(['c', 'd']);
  assert.equal(gatherEnd('a', parentOf, hidden), 'a');
  assert.equal(gatherEnd('d', parentOf, hidden), 'b');
  assert.equal(gatherEnd('c', parentOf, hidden), 'b');
  assert.equal(gatherEnd('x', new Map(), new Set(['x'])), null);
});

test('보드 안 칸 찾기: 띄어쓰기·대소문자 무시, 앞에서 맞는 것 먼저, 자기 칸 빼기', () => {
  const cells = [{id:'1', text:'회의 원인 분석'}, {id:'2', text:'원인'}, {id:'3', text:'Report 원 인'}, {id:'4', text:'다른 것'}];
  assert.deepEqual(findCells(cells, '원인').map(c => c.id), ['2', '1', '3']);
  assert.deepEqual(findCells(cells, 'REPORT').map(c => c.id), ['3']);
  assert.deepEqual(findCells(cells, '원인', {skip:'2'}).map(c => c.id), ['1', '3']);
  assert.deepEqual(findCells(cells, '  '), []);
});

test('끝 근처 누르기 = 반대쪽 끝으로(그 끝이 화면에 다 보이면 메뉴)', () => {
  const p = {x:0, y:0}, q = {x:1000, y:0}, away = () => false;
  assert.equal(followSide(p, q, {x:30, y:5}, 48, away), 'to');
  assert.equal(followSide(p, q, {x:980, y:0}, 48, away), 'from');
  assert.equal(followSide(p, q, {x:500, y:0}, 48, away), null, '가운데 = 메뉴');
  assert.equal(followSide(p, q, {x:30, y:5}, 48, side => side === 'to'), null, '상대 끝이 보이면 메뉴');
  assert.equal(followSide(p, {x:60, y:0}, {x:2, y:0}, 48, away), null, '아주 짧은 선 = 메뉴');
});

// 서버 흉내: kind 칸이 없으면(적용 전) kind를 물을 때 42703.
function fakeRt({hasKind = true} = {}) {
  const calls = [], rows = [];
  const api = async (url, opts = {}) => {
    calls.push({url, method:opts.method || 'GET', body:opts.body});
    const q = new URL('https://x' + url).searchParams, sel = q.get('select') || '';
    if (/app_note_board_texts/.test(url)) return [];
    if (!hasKind && (/(^|,)kind(,|$)/.test(sel) || (opts.body && 'kind' in opts.body))) throw Object.assign(new Error('column app_note_board_links.kind does not exist'), {status:400, code:'42703'});
    if (!opts.method) return rows.map(r => ({...r}));
    if (opts.method === 'POST') { const r = {id:`s${rows.length + 1}`, kind:'line', ...opts.body}; delete r.workspace_id; if (!hasKind) delete r.kind; rows.push(r); return [{...r}]; }
    if (opts.method === 'DELETE') { const id = q.get('id')?.slice(3); const i = rows.findIndex(r => r.id === id); if (i >= 0) rows.splice(i, 1); return []; }
    return [];
  };
  return {calls, rows, api, context:{read:() => ({workspace:{id:'w1'}})}};
}

test('저장: kind 칸이 있으면 관계선을 kind relation으로 넣고 다시 읽어도 관계선 · 지우고 되돌리면 관계선 그대로', async () => {
  const rt = fakeRt(), toasts = [];
  const store = createBoardLinks({rt, scope:() => 'w1', toast:t => toasts.push(t)});
  await store.load();
  assert.equal(store.relationReady(), true); assert.match(rt.calls[0].url, /select=[^&]*,kind(&|$)/);
  const saved = await store.add(relationSpec('bmap0001', {kind:'note', id:'photo1'}, {kind:'note', id:'file1'})); // 사진 카드 ↔ 파일 카드
  assert.equal(saved.kind, 'relation');
  const post = rt.calls.find(c => c.method === 'POST');
  assert.equal(post.body.kind, 'relation'); assert.equal(post.body.dash, 'dashed'); assert.equal(post.body.shape, 'curve'); assert.equal(post.body.ends, 'none');
  await store.add({board_id:'bmap0001', from_note:'a', to_note:'b'});
  assert.equal('kind' in rt.calls.filter(c => c.method === 'POST')[1].body, false, '지금 선은 kind를 보내지 않는다(서버 기본값)');
  const again = createBoardLinks({rt, scope:() => 'w1'}); await again.load();
  assert.deepEqual(again.forBoard('bmap0001').map(l => l.kind), ['relation', 'line']);
  const snap = await store.removeMany({linkIds:[saved.id]});
  assert.equal(store.forBoard('bmap0001').length, 1);
  assert.equal(await store.restore(snap), true);
  assert.equal(store.forBoard('bmap0001').filter(isRelation).length, 1, '되돌리면 관계선으로 돌아온다');
  assert.equal(rt.calls.filter(c => c.method === 'POST').at(-1).body.kind, 'relation');
  assert.deepEqual(toasts, []);
});

test('저장: kind 칸이 없는 서버(적용 전)는 점 끝 칸으로 읽어 선은 그대로, 관계선은 막고 일반 선으로 보내지 않음', async () => {
  const rt = fakeRt({hasKind:false}), toasts = [];
  rt.rows.push({id:'o1', board_id:'bmap0001', from_note:'a', to_note:'b', from_text:null, to_text:null, from_side:null, to_side:null, shape:'line', dash:'solid', ends:'end', label:null, bend_x:null, bend_y:null, from_x:null, from_y:null, to_x:null, to_y:null, color:null, width:null});
  const store = createBoardLinks({rt, scope:() => 'w1', toast:t => toasts.push(t)});
  await store.load();
  assert.equal(store.ready(), true); assert.equal(store.linesReady(), true); assert.equal(store.relationReady(), false);
  assert.deepEqual(store.forBoard('bmap0001').map(l => [l.id, l.kind]), [['o1', 'line']]);
  assert.equal(store.checkRelation(), false); assert.match(toasts.at(-1), /관계선은 아직 서버에 저장할 수 없어요\(준비 중\)/);
  const n = rt.calls.length;
  assert.equal(await store.add(relationSpec('bmap0001', {kind:'note', id:'a'}, {kind:'text', id:'t'})), null);
  assert.equal(rt.calls.length, n, '서버에 보내지 않는다');
  assert.equal(store.forBoard('bmap0001').length, 1);
  const plain = await store.add({board_id:'bmap0001', from_note:'a', to_note:'c'});
  assert.equal(plain?.kind, 'line', '지금 선은 그대로 저장');
  assert.doesNotMatch(rt.calls.at(-1).url, /kind/);
});
