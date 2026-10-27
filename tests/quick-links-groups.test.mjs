import {test} from 'node:test';
import assert from 'node:assert/strict';
// UI-자주가는링크편집: 분류 목록 읽기·검사, 링크/분류 옮기기·지우기 계산, 분류 칸이 없을 때(적용 전)의 읽기, 한 번의 PATCH 저장. 화면 없이 모델만.
const mod = import('../app/quick-links.js');
const L = (group, name = group + '링크', url = 'https://a.org/' + name) => ({group, name, url});
const G = (id, name = id) => ({id, name});

test('분류 목록: 비어 있으면 기본 두 분류, 모양·id·이름·개수·겹침이 틀리면 null', async () => {
  const {parseGroups} = await mod;
  assert.deepEqual(parseGroups(null), [G('work', '업무'), G('org', '담당조직 홈페이지')]);
  const ok = [G('work', '업무'), G('g1ab2c', '새 분류'), G('etc', '기타')];
  assert.deepEqual(parseGroups(ok), ok);
  for (const bad of [[], {}, 'x', [null], [{id: 'a'}], [{name: '가'}], [{id: 'a', name: '가', extra: 1}], [{id: 'A', name: '가'}], [{id: 'a-b', name: '가'}], [{id: '', name: '가'}],
    [{id: 'a'.repeat(13), name: '가'}], [{id: 5, name: '가'}], [{id: 'a', name: 5}], [{id: 'a', name: ' 가'}], [{id: 'a', name: '가'.repeat(21)}], [{id: 'a', name: '두\n줄'}],
    [G('a', '가'), G('a', '나')], Array.from({length: 13}, (_, i) => G('g' + i, 'n' + i))]) assert.equal(parseGroups(bad), null, JSON.stringify(bad).slice(0, 60));
});

test('링크는 분류 목록에 있는 분류만 가리킨다(기본은 work·org)', async () => {
  const {parseLinks, DEFAULT_LINKS} = await mod;
  const groups = [G('work', '업무'), G('x1', '새')];
  assert.deepEqual(parseLinks([L('x1')], groups), [L('x1')]);
  assert.equal(parseLinks([L('org')], groups), null);
  assert.equal(parseLinks([L('x1')]), null);
  assert.equal(parseLinks([{...L('work'), group: 5}]), null);
  assert.equal(parseLinks(null).length, DEFAULT_LINKS.length);
});

test('편집 검사: 분류 이름·겹침·개수와 링크 분류', async () => {
  const {validateDraft} = await mod;
  const groups = [G('work', '업무'), G('g1', ' 새 ')];
  const ok = validateDraft([L('g1', 'A', 'b.org')], groups);
  assert.deepEqual(ok.errors, []); assert.deepEqual(ok.groups, [G('work', '업무'), G('g1', '새')]); assert.deepEqual(ok.links, [L('g1', 'A', 'https://b.org')]);
  assert.deepEqual(validateDraft([], [G('a', ''), G('b', '가'), G('c', '가')]).errors, [[0, 'gname'], [2, 'gdup']]);
  assert.deepEqual(validateDraft([], []).errors, [[-1, 'gcount']]);
  assert.deepEqual(validateDraft([], Array.from({length: 13}, (_, i) => G('g' + i, 'n' + i))).errors, [[-1, 'gcount']]);
  assert.deepEqual(validateDraft([L('zz')], groups).errors, [[0, 'group']]);
});

test('링크 옮기기: 같은 분류 안 순서, 다른 분류 줄 앞·뒤, 분류 끝으로', async () => {
  const {moveLink} = await mod;
  const rows = [L('a', '1'), L('a', '2'), L('b', '3'), L('b', '4')];
  const names = r => r.rows.map(x => x.group + x.name);
  assert.deepEqual(names(moveLink(rows, 0, {after: 1})), ['a2', 'a1', 'b3', 'b4']);
  assert.deepEqual(names(moveLink(rows, 1, {before: 0})), ['a2', 'a1', 'b3', 'b4']);
  assert.deepEqual(names(moveLink(rows, 0, {before: 3})), ['a2', 'b3', 'b1', 'b4']);
  assert.deepEqual(names(moveLink(rows, 0, {into: 'b'})), ['a2', 'b3', 'b4', 'b1']);
  assert.equal(moveLink(rows, 0, {into: 'b'}).to, 3);
  assert.deepEqual(names(moveLink(rows, 2, {into: 'c'})), ['a1', 'a2', 'b4', 'c3']);
  assert.equal(moveLink(rows, 1, {before: 1}).rows, rows);
  assert.equal(moveLink(rows, 1, {before: 9}).rows, rows);
});

test('키보드 한 칸: 분류 안 자리 바꿈, 맨 위/아래에서는 이웃 분류로', async () => {
  const {moveLinkStep} = await mod;
  const groups = [G('a'), G('b'), G('c')];
  const rows = [L('a', '1'), L('a', '2'), L('b', '3')];
  const names = r => r.rows.map(x => x.group + x.name);
  assert.deepEqual(names(moveLinkStep(rows, groups, 0, 1)), ['a2', 'a1', 'b3']);
  assert.deepEqual(names(moveLinkStep(rows, groups, 1, 1)), ['a1', 'b2', 'b3']);
  assert.deepEqual(names(moveLinkStep(rows, groups, 2, -1)), ['a1', 'a2', 'a3']);
  assert.equal(moveLinkStep(rows, groups, 0, -1).rows, rows, 'first group, first row');
  assert.deepEqual(names(moveLinkStep([L('a', '1'), L('b', '2')], groups, 0, 1)), ['b1', 'b2']);
});

test('분류 순서 바꾸기와 새 분류 id·이름', async () => {
  const {moveGroup, newGroupId, newGroupName} = await mod;
  const groups = [G('a'), G('b'), G('c')];
  assert.deepEqual(moveGroup(groups, 0, 2).map(g => g.id), ['b', 'c', 'a']);
  assert.deepEqual(moveGroup(groups, 2, -5).map(g => g.id), ['c', 'a', 'b']);
  assert.equal(moveGroup(groups, 1, 1), groups);
  const id = newGroupId(groups, () => 0.5);
  assert.match(id, /^g[a-z0-9]{6}$/);
  assert.notEqual(newGroupId([G(id)], (() => { let n = 0; return () => (n++ < 6 ? 0.5 : 0.1); })()), id);
  assert.equal(newGroupName([]), '새 분류');
  assert.equal(newGroupName([G('a', '새 분류'), G('b', '새 분류 2')]), '새 분류 3');
});

test('분류 지우기: 기본은 기타로 옮기기, 같이 지우기, 하나뿐이면 못 지움', async () => {
  const {removeGroup, moveTarget, parseGroups, parseLinks} = await mod;
  const groups = [G('work', '업무'), G('org', '담당조직 홈페이지')];
  const rows = [L('work', 'A'), L('org', 'B'), L('work', 'C')];
  const moved = removeGroup(groups, rows, 'work', 'move');
  assert.deepEqual(moved.groups, [G('org', '담당조직 홈페이지'), G('etc', '기타')]);
  assert.deepEqual(moved.rows.map(r => r.group + r.name), ['orgB', 'etcA', 'etcC']);
  assert.equal(moved.moved, 2); assert.equal(moved.target.created, true);
  assert.ok(parseGroups(moved.groups) && parseLinks(moved.rows, moved.groups), 'the result is a valid stored shape');
  const withEtc = [G('work', '업무'), G('k1', '기타')];
  const again = removeGroup(withEtc, [L('work', 'A'), L('k1', 'B')], 'work', 'move');
  assert.deepEqual(again.groups, [G('k1', '기타')]); assert.deepEqual(again.rows.map(r => r.group + r.name), ['k1B', 'k1A']);
  const del = removeGroup(groups, rows, 'work', 'delete');
  assert.deepEqual(del.groups, [G('org', '담당조직 홈페이지')]); assert.deepEqual(del.rows.map(r => r.name), ['B']); assert.equal(del.deleted, 2);
  assert.equal(removeGroup([G('a')], [], 'a', 'move'), null);
  assert.equal(moveTarget(withEtc, 'k1').id, 'work', 'deleting 기타 itself moves to the first other group');
  const taken = [G('etc', '다른'), G('x', '업무')];
  const t = moveTarget(taken, 'x');
  assert.equal(t.created, true); assert.match(t.id, /^g[a-z0-9]{6}$/);
});

test('링크 줄 더하기: 분류 맨 끝(비어 있으면 배열 끝)', async () => {
  const {addLinkRow} = await mod;
  const rows = [L('a', '1'), L('b', '2'), L('a', '3')];
  const r = addLinkRow(rows, 'a');
  assert.equal(r.at, 3); assert.deepEqual(r.rows[3], {group: 'a', name: '', url: ''});
  assert.equal(addLinkRow(rows, 'z').at, 3);
});

test('읽기: 분류 칸이 있으면 둘 다, 링크 칸이 비어도 분류를 고쳤다면 빈 목록, 분류 칸이 없으면(400) 링크 칸만 읽어 pending', async () => {
  const {readLinks} = await mod;
  const calls = [];
  const rt = reply => ({context: {read: () => ({user: {id: 'u-1'}})}, api: async path => { calls.push(path); return reply(path); }});
  const groups = [G('work', '업무'), G('g1', '새')];
  const ok = await readLinks(rt(() => [{quick_links: [L('g1')], quick_link_groups: groups}]));
  assert.deepEqual([ok.status, ok.groups, ok.links], ['ok', groups, [L('g1')]]);
  const custom = await readLinks(rt(() => [{quick_links: null, quick_link_groups: groups}]));
  assert.deepEqual([custom.status, custom.links], ['ok', []]);
  const fresh = await readLinks(rt(() => [{quick_links: null, quick_link_groups: null}]));
  assert.equal(fresh.links.length, 11); assert.equal(fresh.groups.length, 2);
  assert.equal((await readLinks(rt(() => [{quick_links: [L('zz')], quick_link_groups: groups}]))).status, 'error');
  assert.equal((await readLinks(rt(() => [{quick_links: null, quick_link_groups: [{id: 'A', name: 'x'}]}]))).status, 'error');
  const e400 = () => { const e = new Error('x'); e.status = 400; throw e; };
  calls.length = 0;
  const legacy = await readLinks(rt(path => path.includes('quick_link_groups') ? e400() : [{quick_links: [L('work', 'A')]}]));
  assert.deepEqual([legacy.status, legacy.links, legacy.groups.map(g => g.id)], ['pending', [L('work', 'A')], ['work', 'org']]);
  assert.equal(calls.length, 2);
  const none = await readLinks(rt(e400));
  assert.deepEqual([none.status, none.links.length], ['pending', 11]);
  const down = await readLinks(rt(() => { const e = new Error('x'); e.status = 500; throw e; }));
  assert.equal(down.status, 'error');
});

test('저장: 링크와 분류를 한 번의 PATCH로, 어긋난 값은 보내지 않는다', async () => {
  const {saveLinks} = await mod;
  const sent = [];
  const rt = {context: {read: () => ({user: {id: 'u-1'}})}, api: async (path, options) => { sent.push([path, options]); return [options.body]; }};
  const groups = [G('work', '업무'), G('g1', '새')], links = [L('g1', 'A'), L('work', 'B')];
  assert.deepEqual(await saveLinks(links, groups, rt), {ok: true, links, groups});
  assert.equal(sent.length, 1); assert.deepEqual(sent[0][1].body, {quick_links: links, quick_link_groups: groups}); assert.equal(sent[0][1].method, 'PATCH');
  assert.deepEqual(await saveLinks([L('zz')], groups, rt), {ok: false});
  assert.deepEqual(await saveLinks(links, [], rt), {ok: false});
  assert.equal(sent.length, 1);
});
