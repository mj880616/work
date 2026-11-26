// S68-38 노트 '보드'(생각 지도): 연결선 계산(app/note-board-links-model.mjs)과 서버 읽기·쓰기 모음(app/note-board-links-data.js).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseLink, linksOnBoard, hasLink, validateLabel, sidePoint, nearestSide, resolveSides, linkGeometry, dragPath, linkBox, flipPatch, rectOf, LABEL_MAX,
  endId, endFields, parseText, validateText, bendPoint, bendOf, bendPatch, isBent, isStraight, TEXT_MAX, BEND_SNAP} from '../app/note-board-links-model.mjs';
import {createBoardLinks, readBoardLinks} from '../app/note-board-links-data.js';
import {CARD_W, CARD_H} from '../app/note-board-model.mjs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const row = (over = {}) => ({id:'l1', board_id:'all', from_note:'a', to_note:'b', from_text:null, to_text:null, from_x:null, from_y:null, to_x:null, to_y:null, from_side:null, to_side:null, shape:'line', dash:'solid', ends:'end', label:null, bend_x:null, bend_y:null, color:null, width:null, kind:'line', ...over}); // S71-53: 선 종류(옛 줄은 'line')

test('서버 줄 모양 검사: 틀린 보드 id·같은 노트·없는 칸은 버리고, 모르는 값은 기본값', () => {
  assert.deepEqual(parseLink(row()), row());
  for (const bad of [{board_id:'ALL'}, {board_id:'b12'}, {from_note:'a', to_note:'a'}, {id:''}, {to_note:null}]) assert.equal(parseLink(row(bad)), null, JSON.stringify(bad));
  assert.deepEqual(parseLink(row({from_side:'middle', shape:'zigzag', dash:'dotted', ends:'start', label:'  '})), row());
  assert.equal(parseLink(row({label:'가'.repeat(60)})).label.length, LABEL_MAX);
  assert.equal(parseLink(null), null);
});
test('이 보드에서 그릴 선: 보드가 같고 양쪽 카드가 판에 있을 때만', () => {
  const links = [row(), row({id:'l2', board_id:'babc12345'}), row({id:'l3', to_note:'gone'})];
  const on = new Set(['a', 'b']);
  assert.deepEqual(linksOnBoard(links, 'all', id => on.has(id)).map(l => l.id), ['l1']);
  assert.equal(hasLink(links, 'all', 'a', 'b'), true); assert.equal(hasLink(links, 'all', 'b', 'a'), false);
});
test('선 위 글자: 앞뒤 빈칸 지움, 비우면 없음, 한 줄·40자까지', () => {
  assert.equal(validateLabel('  이어짐  '), '이어짐'); assert.equal(validateLabel('   '), null); assert.equal(validateLabel(null), null);
  assert.throws(() => validateLabel('줄\n바꿈'), /한 줄/); assert.throws(() => validateLabel('가'.repeat(41)), /40자/);
  assert.equal(validateLabel('가'.repeat(40)).length, 40);
});
test('변 고르기: 네 변 가운데 점, 가까운 변(넓적한 카드 비율 반영), 정하지 않은 변은 서로 마주 보게', () => {
  const a = rectOf({x:0, y:0}), b = rectOf({x:400, y:0}), below = rectOf({x:0, y:300});
  assert.deepEqual(sidePoint(a, 'top'), {x:CARD_W / 2, y:0}); assert.deepEqual(sidePoint(a, 'right'), {x:CARD_W, y:CARD_H / 2});
  assert.deepEqual(sidePoint(a, 'bottom'), {x:CARD_W / 2, y:CARD_H}); assert.deepEqual(sidePoint(a, 'left'), {x:0, y:CARD_H / 2});
  assert.equal(nearestSide(a, {x:CARD_W + 50, y:CARD_H / 2}), 'right'); assert.equal(nearestSide(a, {x:-50, y:0}), 'left');
  assert.equal(nearestSide(a, {x:CARD_W / 2, y:-40}), 'top'); assert.equal(nearestSide(a, {x:CARD_W / 2 + 30, y:CARD_H + 30}), 'bottom');
  assert.deepEqual(resolveSides(a, b), ['right', 'left']); assert.deepEqual(resolveSides(a, below), ['bottom', 'top']);
  assert.deepEqual(resolveSides(b, a), ['left', 'right']); assert.deepEqual(resolveSides(below, a), ['top', 'bottom']);
  // 상하좌우 어디서나: 사용자가 고른 변은 그대로.
  assert.deepEqual(resolveSides(a, b, 'top', 'bottom'), ['top', 'bottom']);
  assert.deepEqual(resolveSides(a, below, 'left'), ['left', 'top']);
});
test('곡선·직선 경로: 시작·끝은 변 가운데, 곡선 손잡이는 변 바깥쪽, 가운데 점은 글자 자리', () => {
  const a = rectOf({x:0, y:0}), b = rectOf({x:400, y:200});
  assert.deepEqual(linkGeometry(a, b).from.side, 'bottom', '아래 오른쪽 멀리 있으면 넓적한 카드는 아래 변');
  const c = linkGeometry(a, rectOf({x:400, y:60}), {shape:'curve'});
  assert.match(c.d, /^M128 17C\d/); assert.equal(c.from.side, 'right'); assert.equal(c.to.side, 'left');
  const [, , , c1x] = c.d.match(/^M([\d.]+) ([\d.]+)C([\d.]+)/).map(Number); assert.ok(c1x > CARD_W, '시작 변(오른쪽) 바깥으로 휜다');
  assert.ok(c.mid.x > 128 && c.mid.x < 400 && c.mid.y > 17 && c.mid.y < 77);
  const l = linkGeometry(a, b, {shape:'line', from_side:'bottom', to_side:'top'});
  assert.equal(l.d, `M${CARD_W / 2} ${CARD_H}L${400 + CARD_W / 2} 200`);
  assert.deepEqual(l.mid, {x:(CARD_W / 2 + 400 + CARD_W / 2) / 2, y:(CARD_H + 200) / 2});
  // 왼쪽에서 나가 위로 들어가는 곡선(상하좌우 아무 방향).
  const up = linkGeometry(b, a, {from_side:'left', to_side:'top', shape:'curve'});
  assert.match(up.d, /^M400 217C/); assert.match(up.d, /64 0$/);
  assert.match(dragPath(a, 'bottom', {x:300, y:300}), /^M64 34C64 \d+(\.\d)? 300 300 300 300$/);
  // S70-77: 누른 연결점 동그라미 가운데(from)에서 시작한다. 이상한 값이면 변 가운데.
  assert.match(dragPath(a, 'bottom', {x:300, y:300}, {x:64, y:60}), /^M64 60C64 \d+(\.\d)? 300 300 300 300$/);
  assert.match(dragPath(a, 'bottom', {x:300, y:300}, {x:NaN, y:1}), /^M64 34C/);
  const box = linkBox(a, b); assert.ok(box.x < 0 && box.y < 0 && box.x + box.w > 400 + CARD_W && box.y + box.h > 200 + CARD_H);
});
test('뒤집기: 시작·끝과 변을 함께 바꾼다', () => {
  assert.deepEqual(flipPatch(row({from_side:'right', to_side:'top'})), {from_note:'b', to_note:'a', from_text:null, to_text:null, from_side:'top', to_side:'right'});
  // 글 상자 끝·곡선 지나는 점도 함께(점은 같은 자리에 남게 u → 1−u, v → −v).
  assert.deepEqual(flipPatch(row({to_note:null, to_text:'t1', shape:'curve', bend_x:0.3, bend_y:0.2})),
    {from_note:null, to_note:'a', from_text:'t1', to_text:null, from_side:null, to_side:null, bend_x:0.7, bend_y:-0.2});
});

// 가짜 서버(rt.api): 표 하나를 흉내 낸다.
function fakeRt({missing = false, fail = false} = {}) {
  const calls = [], rows = [];
  const api = async (url, opts = {}) => {
    calls.push({url, method:opts.method || 'GET', body:opts.body});
    if (missing) throw Object.assign(new Error('relation does not exist'), {status:404, code:'PGRST205'});
    if (fail && opts.method) throw new Error('nope');
    const q = new URL('https://x' + url).searchParams;
    if (!opts.method) return rows.map(r => ({...r}));
    if (opts.method === 'POST') { const r = {id:`s${rows.length + 1}`, ...opts.body}; delete r.workspace_id; rows.push(r); return [{...r}]; }
    if (opts.method === 'PATCH') { const r = rows.find(x => 'eq.' + x.id === q.get('id')); Object.assign(r, opts.body); return [{...r}]; }
    if (opts.method === 'DELETE') return [];
    return [];
  };
  return {calls, rows, api, context:{read:() => ({workspace:{id:'w1'}})}};
}
test('모음: 읽기·긋기·바꾸기·지우기, 보드 삭제·노트 빼기 정리(작업공간 칸을 늘 붙임)', async () => {
  const rt = fakeRt(); let changes = 0; const toasts = [];
  const store = createBoardLinks({rt, scope:() => 'w1', onChange:() => changes++, toast:t => toasts.push(t)});
  await store.load();
  assert.equal(store.ready(), true); assert.match(rt.calls[0].url, /^\/rest\/v1\/app_note_board_links\?workspace_id=eq\.w1&select=/);
  await store.load(); assert.equal(rt.calls.length, 2, '한 작업공간에 한 번만 읽는다(선·글 상자)');
  assert.match(rt.calls[1].url, /^\/rest\/v1\/app_note_board_texts\?workspace_id=eq\.w1&select=id,board_id,body,x,y/);
  const saved = await store.add({board_id:'all', from_note:'a', to_note:'b', from_side:'right', to_side:'left'});
  assert.equal(saved.id, 's1'); assert.deepEqual(rt.calls[2].body, {workspace_id:'w1', board_id:'all', from_note:'a', to_note:'b', from_text:null, to_text:null, from_side:'right', to_side:'left', shape:'line', dash:'solid', ends:'end', label:null, bend_x:null, bend_y:null});
  assert.deepEqual(store.forBoard('all').map(l => l.id), ['s1']);
  await store.update('s1', {shape:'curve', dash:'dashed', ends:'both', label:'관련', workspace_id:'other', board_id:'bzzz99999'});
  assert.deepEqual(rt.calls[3].body, {shape:'curve', dash:'dashed', ends:'both', label:'관련'}, '작업공간·보드는 보내지 않는다');
  assert.match(rt.calls[3].url, /id=eq\.s1&workspace_id=eq\.w1/);
  assert.equal(store.forBoard('all')[0].shape, 'curve');
  await store.add({board_id:'babc12345', from_note:'a', to_note:'c'});
  await store.add({board_id:'babc12345', from_note:'c', to_note:'d'});
  await store.removeBoard('babc12345', 'a');
  assert.match(rt.calls.at(-1).url, /workspace_id=eq\.w1&board_id=eq\.babc12345&or=\(from_note\.eq\.a,to_note\.eq\.a\)/);
  assert.deepEqual(store.forBoard('babc12345').map(l => l.to_note), ['d']);
  await store.removeBoard('babc12345');
  assert.match(rt.calls.at(-1).url, /workspace_id=eq\.w1&board_id=eq\.babc12345&select=id$/); assert.equal(store.forBoard('babc12345').length, 0);
  await store.remove('s1'); assert.match(rt.calls.at(-1).url, /id=eq\.s1/); assert.equal(store.all().length, 0);
  const before = rt.calls.length; await store.removeBoard('bnone0000'); assert.equal(rt.calls.length, before, '선이 없으면 묻지 않는다');
  assert.ok(changes > 5); assert.deepEqual(toasts, []);
});
test('모음: 표가 없으면(DB 적용 전) 카드만 — 긋기는 서버에 보내지 않고 준비 중 알림', async () => {
  const rt = fakeRt({missing:true}), toasts = [];
  assert.deepEqual(await readBoardLinks(rt), {ready:false, links:[], materials:[], missing:true, texts:[], textsReady:false});
  const store = createBoardLinks({rt, scope:() => 'w1', toast:t => toasts.push(t)});
  await store.load();
  assert.equal(await store.add({board_id:'all', from_note:'a', to_note:'b'}), null);
  assert.match(toasts[0], /준비 중/);
  assert.equal(rt.calls.filter(c => c.method !== 'GET').length, 0);
});
test('모음: 저장 실패는 알리고 서버 값으로 다시 읽는다', async () => {
  const rt = fakeRt({fail:true}), toasts = [];
  const store = createBoardLinks({rt, scope:() => 'w1', toast:t => toasts.push(t)});
  await store.load();
  assert.equal(await store.add({board_id:'all', from_note:'a', to_note:'b'}), null);
  assert.match(toasts[0], /저장하지 못했어요/); assert.equal(store.all().length, 0);
  assert.equal(rt.calls.filter(c => c.method === 'GET').length, 4);
});
test('화면 연결: 탭 이름 보드, 저장 길은 서버 표 한 곳, 기기 저장 없음, 판 위 손짓은 판이 먼저', () => {
  const notes = read('app/basket-notes.js'), board = read('app/note-board.js'), data = read('app/note-board-links-data.js'), css = read('app/basket.css');
  assert.match(notes, /data-note-view="board" aria-pressed="false">보드<\/button>/);
  assert.doesNotMatch(notes, />포스트잇</);
  assert.match(notes, /boardKey:key, links:boardLinks\.forBoard\(key\)/);
  assert.match(data, /\/rest\/v1\/app_note_board_links/);
  for (const f of ['app/note-board.js', 'app/note-board-links-data.js', 'app/note-board-links-model.mjs', 'app/note-boards.js'])
    assert.doesNotMatch(read(f), new RegExp(['local' + 'Storage', 'session' + 'Storage', 'indexed' + 'DB'].join('|')), f);
  assert.match(board, /class="nb-scroll" data-nb-scroll/, '탭 넘김은 data-nb-scroll 안에서 보지 않는다(basket-notes.js)');
  assert.match(notes, /e\.target\.closest\('\[data-nb-scroll\]/);
  assert.match(css, /\.nb-scroll \{[^}]*touch-action:none/);
  assert.match(css, /\.nb-card \{[^}]*width:128px; height:34px/);
});

test('끝: 노트 또는 글 상자 정확히 하나, 옛 표 모양(새 칸 없음)도 받는다', () => {
  const t = row({to_note:null, to_text:'t1'});
  assert.deepEqual(parseLink(t), t); assert.equal(endId(t, 'to'), 't1'); assert.equal(endId(t, 'from'), 'a');
  for (const bad of [{to_note:'b', to_text:'t1'}, {from_note:null}, {from_note:null, from_text:'b'}]) assert.equal(parseLink(row(bad)), null, JSON.stringify(bad));
  const old = {id:'o', board_id:'all', from_note:'a', to_note:'b', from_side:null, to_side:null, shape:'curve', dash:'solid', ends:'end', label:null};
  assert.deepEqual(parseLink(old), row({id:'o', shape:'curve'}));
  assert.deepEqual(endFields('from', 'text', 'x'), {from_note:null, from_text:'x'}); assert.deepEqual(endFields('to', 'note', 'y'), {to_note:'y', to_text:null});
  const links = [t, row({id:'l2', from_note:null, from_text:'t2', to_note:'a'})];
  assert.equal(hasLink(links, 'all', 'a', 't1'), true); assert.equal(hasLink(links, 'all', 't2', 'a'), true); assert.equal(hasLink(links, 'all', 't1', 'a'), false);
  assert.deepEqual(linksOnBoard(links, 'all', id => id !== 't2').map(l => l.id), ['l1']);
});
test('곡선 지나는 점: 상대 위치 ↔ 좌표, 직선 가까우면 직선 복귀, 범위·짝 검사', () => {
  const p = {x:100, y:100}, q = {x:300, y:100};
  assert.deepEqual(bendPoint(p, q, 0.5, 0.25), {x:200, y:150});
  assert.deepEqual(bendOf(p, q, {x:200, y:150}), {bend_x:0.5, bend_y:0.25});
  assert.equal(bendOf(p, q, {x:220, y:100 + BEND_SNAP - 1}), null, '거의 일직선 = 직선');
  assert.equal(bendOf(p, {x:101, y:101}, {x:150, y:150}), null, '두 끝이 붙어 있으면 직선');
  assert.deepEqual(bendOf(p, q, {x:200, y:100 + 400 * 10}), {bend_x:0.5, bend_y:5}, '범위 안으로');
  // 카드를 옮겨도 같은 상대 자리: 끝점을 옮기면 점도 따라온다.
  const moved = bendPoint({x:0, y:0}, {x:0, y:200}, 0.5, 0.25);
  assert.deepEqual(moved, {x:-50, y:100});
  assert.deepEqual(bendPatch({bend_x:0.5, bend_y:0.2}), {shape:'curve', bend_x:0.5, bend_y:0.2});
  assert.deepEqual(bendPatch(null), {shape:'line', bend_x:null, bend_y:null});
  assert.deepEqual(parseLink(row({bend_x:0.5, bend_y:0.2})), row({shape:'curve', bend_x:0.5, bend_y:0.2}), '점이 있으면 곡선');
  assert.deepEqual(parseLink(row({bend_x:0.5})), row(), '짝이 없으면 버림');
  assert.deepEqual(parseLink(row({bend_x:9, bend_y:0})), row(), '범위 밖은 버림');
  assert.equal(isBent(row({bend_x:0, bend_y:0.1})), true); assert.equal(isStraight(row()), true); assert.equal(isStraight(row({shape:'curve'})), false);
  // 경로: 지나는 점을 t=0.5에서 지나는 2차 곡선, 글자 자리는 그 점.
  const a = rectOf({x:0, y:0}), b = rectOf({x:400, y:0});
  const g = linkGeometry(a, b, {bend_x:0.5, bend_y:0.5});
  assert.match(g.d, /^M128 17Q/); const [cx, cy] = g.d.match(/Q([-\d.]+) ([-\d.]+)/).slice(1).map(Number);
  const m = {x:(128 + 400) / 2, y:17 + (400 - 128) * 0.5};
  assert.deepEqual(g.mid, m); assert.equal(cx, 2 * m.x - (128 + 400) / 2); assert.equal(cy, 2 * m.y - 17);
  assert.equal(linkGeometry(a, b).d, 'M128 17L400 17', '기본은 직선');
  const box = linkBox(a, b, {x:200, y:900}); assert.ok(box.y + box.h > 900);
});
test('글 상자: 서버 줄 검사, 글 다듬기(줄바꿈 허용·앞뒤 빈 줄 지움·300자)', () => {
  assert.deepEqual(parseText({id:'t', board_id:'all', body:'가', x:1.4, y:-3}), {id:'t', board_id:'all', body:'가', x:1, y:-3}); // S71-52: 음수 좌표도
  assert.equal(parseText({id:'t', board_id:'all', body:'가', x:5e6, y:-5e6}).x, 1000000, 'S71-52: 저장 범위 ±1,000,000 안으로');
  for (const bad of [{body:''}, {body:'  '}, {board_id:'X'}, {id:''}]) assert.equal(parseText({id:'t', board_id:'all', body:'가', x:0, y:0, ...bad}), null, JSON.stringify(bad));
  assert.equal(validateText('\n  첫 줄\r\n둘째  \n'), '첫 줄\n둘째'); assert.equal(validateText(' \n '), null); assert.equal(validateText(null), null);
  assert.throws(() => validateText('탭\t글'), /쓸 수 없는/); assert.throws(() => validateText('가'.repeat(TEXT_MAX + 1)), /300자/);
});
test('모음: 글 상자 만들기·고치기·지우기(붙은 선도 화면에서 정리), 보드 삭제 때 글 상자도', async () => {
  const rt = fakeRt(); const toasts = [];
  const store = createBoardLinks({rt, scope:() => 'w1', toast:t => toasts.push(t)});
  await store.load();
  assert.equal(store.textsReady(), true); assert.equal(store.checkTexts(), true);
  const t = await store.addText({board_id:'all', body:'글', x:10.6, y:20});
  const post = rt.calls.at(-1); assert.match(post.url, /app_note_board_texts\?select=/); assert.deepEqual(post.body, {workspace_id:'w1', board_id:'all', body:'글', x:11, y:20});
  assert.deepEqual(store.textsFor('all').map(x => x.id), [t.id]);
  await store.add({board_id:'all', from_note:'a', to_note:null, to_text:t.id});
  await store.updateText(t.id, {body:'고친 글', x:30, workspace_id:'other'});
  assert.deepEqual(rt.calls.at(-1).body, {body:'고친 글', x:30}); assert.match(rt.calls.at(-1).url, /workspace_id=eq\.w1/);
  assert.equal(store.forBoard('all').length, 1);
  await store.removeText(t.id);
  assert.match(rt.calls.at(-1).url, /app_note_board_texts\?workspace_id=eq\.w1&id=eq\./); assert.equal(store.forBoard('all').length, 0, '붙은 선도 화면에서 뺀다');
  await store.addText({board_id:'babc12345', body:'다른 보드', x:0, y:0});
  await store.removeBoard('babc12345');
  assert.ok(rt.calls.some(c => c.method === 'DELETE' && /app_note_board_texts\?workspace_id=eq\.w1&board_id=eq\.babc12345/.test(c.url)));
  assert.equal(store.textsFor('babc12345').length, 0); assert.deepEqual(toasts, []);
});
test('모음: 새 칸이 아직 없으면(글 상자 DB 적용 전) 옛 칸으로 읽어 선은 그대로, 글 상자·곡선은 준비 중', async () => {
  const calls = [], rows = [{id:'o1', board_id:'all', from_note:'a', to_note:'b', from_side:null, to_side:null, shape:'curve', dash:'solid', ends:'end', label:null}];
  const rt = {calls, context:{read:() => ({workspace:{id:'w1'}})}, api:async (url, opts = {}) => {
    calls.push({url, method:opts.method || 'GET', body:opts.body});
    if (/from_text/.test(url) || /app_note_board_texts/.test(url)) throw Object.assign(new Error('column app_note_board_links.from_text does not exist'), {status:400, code:'42703'});
    if (!opts.method) return rows.map(r => ({...r}));
    if (opts.method === 'PATCH') { Object.assign(rows[0], opts.body); return [{...rows[0]}]; }
    return [];
  }};
  const toasts = [], store = createBoardLinks({rt, scope:() => 'w1', toast:t => toasts.push(t)});
  await store.load();
  assert.equal(store.ready(), true); assert.equal(store.canBend(), false); assert.equal(store.textsReady(), false);
  assert.deepEqual(store.forBoard('all').map(l => l.id), ['o1']);
  assert.equal(store.checkTexts(), false); assert.match(toasts.at(-1), /^상자는 아직/);
  await store.update('o1', {shape:'curve', bend_x:0.5, bend_y:0.2}); assert.match(toasts.at(-1), /준비 중/);
  await store.update('o1', {shape:'line', bend_x:null, bend_y:null});
  assert.deepEqual(calls.at(-1).body, {shape:'line'}, '옛 표에는 새 칸을 보내지 않는다'); assert.doesNotMatch(calls.at(-1).url, /from_text/);
  assert.equal(store.forBoard('all')[0].shape, 'line');
});
