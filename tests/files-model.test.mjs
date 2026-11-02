import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SOURCES, SHELVES, PHONE_TABS, SYNC_EVERY_MS, MOVE_ACROSS_MAX_BYTES, MOVE_SAME_MAX, kindOf, previewKind, sizeText, dayText, recentGroups,
  syncText, sortRows, applyChanges, touchesCounts, moveCheck, trailNames, trailIds, pathText, treeRows, folderKey, placeOf, whereOf, tabAt,
  cleanQuery, findSummary, errorText, OD_PDF_EXT, GD_EXPORT_MIME} from '../app/files-model.mjs';
import {ITEMS, defaultLayout} from '../app/menu-model.mjs';
// FILES-클라우드탐색기 ④ 화면 모델(docs/design/files-explorer.md, 명진 결정 F1~F9 11/02). 이름은 모두 가짜.
const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const row = (o = {}) => ({source: 'od', item_id: 'A!1', parent_id: null, name: '가짜.txt', is_folder: false, mime: null, size_bytes: 10, modified_at: '2026-11-02T00:00:00Z', ...o});

test('F2·F9·F8 상수: 2분마다, 폰 첫 탭 최근, 클라우드 사이 1개·200MB, 같은 클라우드 200개', () => {
  assert.equal(SYNC_EVERY_MS, 120000);
  assert.deepEqual(PHONE_TABS, ['recent', 'folders', 'starred']);
  assert.deepEqual(SHELVES, ['recent', 'starred', 'big']);
  assert.deepEqual(SOURCES, ['od', 'gd']);
  assert.equal(MOVE_ACROSS_MAX_BYTES, 200 * 1024 * 1024);
  assert.equal(MOVE_SAME_MAX, 200);
});

test('옮기기 상한(F8): 다른 클라우드로는 한 번에 1개·폴더 아님·200MB까지, 같은 클라우드는 200개까지·한 클라우드만', () => {
  assert.equal(moveCheck([]).ok, false);
  assert.equal(moveCheck([row()], {across: true}).ok, true);
  assert.equal(moveCheck([row({size_bytes: MOVE_ACROSS_MAX_BYTES})], {across: true}).ok, true, '딱 200MB는 된다');
  const big = moveCheck([row({size_bytes: MOVE_ACROSS_MAX_BYTES + 1})], {across: true});
  assert.deepEqual(big, {ok: false, reason: '다른 클라우드로는 200MB까지 옮깁니다'});
  assert.equal(moveCheck([row(), row({item_id: 'A!2'})], {across: true}).reason, '다른 클라우드로는 한 번에 1개만 옮깁니다');
  assert.equal(moveCheck([row({is_folder: true, size_bytes: null})], {across: true}).ok, false);
  assert.equal(moveCheck([row({size_bytes: null})], {across: true}).ok, false, '크기 모르면 안 옮김');
  const many = Array.from({length: MOVE_SAME_MAX}, (_, i) => row({item_id: 'A!' + i}));
  assert.equal(moveCheck(many).ok, true);
  assert.equal(moveCheck([...many, row({item_id: 'A!x'})]).reason, '한 번에 200개까지 옮깁니다');
  assert.equal(moveCheck([row(), row({source: 'gd', item_id: 'g1'})]).ok, false, '두 클라우드를 섞어 같은 클라우드 옮기기 안 함');
});

test('종류·미리보기 길(F4): 사진·PDF·오피스(원드라이브 확장자, 구글 문서류)·글, 구글에 올린 오피스는 [열기]만', () => {
  assert.equal(kindOf(row({is_folder: true})), 'folder');
  assert.equal(kindOf(row({name: '사진.JPG'})), 'image');
  assert.equal(kindOf(row({name: '계획.hwpx'})), 'hwp');
  assert.equal(kindOf(row({name: '이름없음', mime: 'application/pdf'})), 'pdf');
  assert.equal(kindOf(row({source: 'gd', name: '문서', mime: 'application/vnd.google-apps.document'})), 'gdoc');
  assert.equal(previewKind(row({name: '사진.png'})), 'image');
  assert.equal(previewKind(row({name: '안내.pdf'})), 'pdf');
  assert.equal(previewKind(row({name: '예산.xlsx'})), 'office');
  assert.equal(previewKind(row({name: '발표.pptx'})), 'office');
  assert.equal(previewKind(row({source: 'gd', name: '예산.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})), 'none');
  assert.equal(previewKind(row({source: 'gd', name: '문서', mime: 'application/vnd.google-apps.document'})), 'office');
  assert.equal(previewKind(row({name: '메모.txt'})), 'text');
  assert.equal(previewKind(row({name: '계획.hwp'})), 'none');
  assert.equal(previewKind(row({name: '페이지.html', mime: 'text/html'})), 'none', 'HTML은 글로도 그리지 않음(서버도 받기로만)');
  assert.equal(previewKind(row({is_folder: true})), 'none');
  // 서버(Edge cloud-files) 규칙과 같은 글자.
  const edge = read('supabase/functions/cloud-files/handler.ts');
  assert.ok(edge.includes(`export const OD_PDF_EXT = ${OD_PDF_EXT.toString()};`));
  assert.ok(edge.includes(`export const GD_EXPORT_MIME = ${GD_EXPORT_MIME.toString()};`));
});

test('크기·날짜·맞춘 때 글', () => {
  assert.equal(sizeText(null), '—');
  assert.equal(sizeText(512), '512B');
  assert.equal(sizeText(184 * 1024), '184KB');
  assert.equal(sizeText(1.2 * 1024 * 1024), '1.2MB');
  assert.equal(sizeText(18 * 1024 * 1024), '18MB');
  const now = new Date(2026, 10, 2, 15, 0).getTime();
  assert.equal(dayText(new Date(2026, 10, 2, 9, 12).toISOString(), now), '오늘 09:12');
  assert.equal(dayText(new Date(2026, 10, 1, 9, 12).toISOString(), now), '어제');
  assert.equal(dayText(new Date(2026, 9, 30, 9).toISOString(), now), '10/30');
  assert.equal(dayText(new Date(2025, 9, 30, 9).toISOString(), now), '2025-10-30');
  assert.equal(dayText(null, now), '—');
  assert.equal(syncText(now - 20000, now), '방금 맞춤');
  assert.equal(syncText(now - 3 * 60000, now), '3분 전 맞춤');
  assert.equal(syncText(null, now), '');
  const groups = recentGroups([row({modified_at: new Date(2026, 10, 2, 9).toISOString()}), row({modified_at: new Date(2026, 10, 2, 8).toISOString()}), row({modified_at: new Date(2026, 9, 30).toISOString()})], now);
  assert.deepEqual(groups.map(g => [g.label, g.rows.length]), [['오늘', 2], ['10/30', 1]]);
});

test('정렬: 폴더 먼저, 이름은 숫자 순, 크기·바뀐 날은 고른 방향', () => {
  const rows = [row({item_id: '1', name: '파일10.txt', size_bytes: 5}), row({item_id: '2', name: '파일2.txt', size_bytes: 50}), row({item_id: 'f', name: '폴더', is_folder: true, size_bytes: null})];
  assert.deepEqual(sortRows(rows, 'name').map(r => r.item_id), ['f', '2', '1']);
  assert.deepEqual(sortRows(rows, 'size', 'desc').map(r => r.item_id), ['f', '2', '1']);
  assert.deepEqual(sortRows(rows, 'size', 'asc').map(r => r.item_id), ['f', '1', '2']);
});

test('갱신(F2): 바뀐 줄만 지금 폴더에 입히고, 나간 줄·휴지통·지운 줄은 빼며, 없던 칸 값은 그대로', () => {
  const where = {source: 'od', parent: 'P!1'};
  const rows = [row({item_id: 'A!1', parent_id: 'P!1', starred: true, library_doc_id: null}), row({item_id: 'A!2', parent_id: 'P!1'})];
  assert.equal(applyChanges(rows, where, [], []), rows, '바뀐 것 없으면 같은 배열');
  assert.equal(applyChanges(rows, where, [row({source: 'gd', item_id: 'g', parent_id: 'P!1'})], []), rows, '다른 클라우드 줄은 무시');
  const renamed = applyChanges(rows, where, [row({item_id: 'A!1', parent_id: 'P!1', name: '새 이름.txt'})], []);
  assert.equal(renamed.find(r => r.item_id === 'A!1').name, '새 이름.txt');
  assert.equal(renamed.find(r => r.item_id === 'A!1').starred, true, '별표 같은 칸은 그대로');
  const moved = applyChanges(rows, where, [row({item_id: 'A!2', parent_id: 'P!9'})], []);
  assert.deepEqual(moved.map(r => r.item_id), ['A!1']);
  const trashed = applyChanges(rows, where, [row({item_id: 'A!1', parent_id: 'P!1', trashed: true})], []);
  assert.deepEqual(trashed.map(r => r.item_id), ['A!2']);
  const removed = applyChanges(rows, where, [], [{source: 'od', id: 'A!2'}]);
  assert.deepEqual(removed.map(r => r.item_id), ['A!1']);
  const added = applyChanges(rows, where, [row({item_id: 'A!3', parent_id: 'P!1'})], []);
  assert.equal(added.length, 3);
  assert.deepEqual({starred: added[2].starred, library_doc_id: added[2].library_doc_id}, {starred: false, library_doc_id: null});
  const top = applyChanges([], {source: 'gd', parent: null}, [row({source: 'gd', item_id: 'g1', parent_id: null})], []);
  assert.equal(top.length, 1, '맨 위(parent null)도 맞춤');
  assert.equal(touchesCounts(rows, where, [row()], []), false, '보이는 폴더가 없으면 장수 다시 읽기 없음');
  const withFolder = [...rows, row({item_id: 'F!1', is_folder: true})];
  assert.equal(touchesCounts(withFolder, where, [row({item_id: 'X!1', parent_id: 'F!1'})], []), true, '보이는 폴더 안으로 들어온 파일');
  assert.equal(touchesCounts(withFolder, where, [row({item_id: 'A!1', parent_id: 'P!1', name: '새'})], []), false, '지금 폴더 파일 이름만 바뀜');
  assert.equal(touchesCounts(withFolder, where, [], [{source: 'od', id: 'A!2'}]), false, '보이는 파일을 지움');
  assert.equal(touchesCounts(withFolder, where, [], [{source: 'od', id: 'Z!9'}]), true, '안 보이는 것(하위 폴더 안일 수 있음)을 지움');
});

test('위치 줄·나무 줄: 맨 위부터, 펼친 폴더만, 묶음 3개 먼저(최근·별표·큰 파일)', () => {
  const trail = [{item_id: 'C!1', name: '2026', depth: 0}, {item_id: 'B!1', name: '문서', depth: 1}];
  assert.deepEqual(trailNames('od', trail), ['원드라이브', '문서', '2026']);
  assert.deepEqual(trailIds(trail), ['B!1', 'C!1']);
  assert.equal(pathText('gd', '업무 › 자료실'), '구글 드라이브 › 업무 › 자료실');
  const children = new Map([[folderKey('od', null), [{item_id: 'B!1', name: '문서', child_count: 3}]], [folderKey('od', 'B!1'), []]]);
  const closed = treeRows({sources: ['od', 'gd'], children, open: new Set()});
  assert.deepEqual(closed.map(r => r.type), ['shelf', 'shelf', 'shelf', 'root', 'root']);
  const opened = treeRows({sources: ['od'], children, open: new Set([folderKey('od', null)])});
  assert.deepEqual(opened.slice(3).map(r => [r.type, r.name || r.source, r.depth, r.hasKids]), [['root', 'od', 0, true], ['folder', '문서', 1, false]]);
});

test('주소 자리(새로고침 제자리): 원드라이브 id의 !는 :로 적고 되읽는다, 라우터 값 규칙 안', () => {
  const at = placeOf({source: 'od', parent: 'D4648F06!5492'});
  assert.deepEqual(at, {at: 'od:D4648F06:5492'});
  assert.match(at.at, /^[A-Za-z0-9_.:-]{1,80}$/);
  assert.deepEqual(whereOf(at), {source: 'od', parent: 'D4648F06!5492'});
  assert.deepEqual(whereOf(placeOf({source: 'gd', parent: '1aB_c-D'})), {source: 'gd', parent: '1aB_c-D'});
  assert.deepEqual(whereOf(placeOf({source: 'gd', parent: null})), {source: 'gd', parent: null});
  assert.deepEqual(whereOf(placeOf({shelf: 'recent'})), {shelf: 'recent'});
  assert.equal(whereOf({at: 'xx:1'}), null);
  assert.equal(whereOf({shelf: 'nope'}), null);
});

test('탭 밀기·찾기 글·오류 한 줄', () => {
  assert.equal(tabAt('recent', 1), 'folders');
  assert.equal(tabAt('recent', -1), null);
  assert.equal(tabAt('starred', 1), null);
  assert.equal(cleanQuery('  계획\u0000안  '), '계획 안');
  assert.equal(cleanQuery('가'.repeat(300)).length, 200);
  assert.equal(findSummary([{match_in: 'name'}, {match_in: 'name'}, {match_in: 'text'}]), '찾은 것 3 · 이름 2 · 자료실 글자 1');
  assert.equal(findSummary([{match_in: 'name'}]), '찾은 것 1');
  assert.equal(errorText('feature_required'), '이 작업공간에서는 쓰지 않는 기능입니다');
  assert.equal(errorText('od_reconnect_needed'), '클라우드 연결을 다시 해야 합니다');
  assert.equal(errorText('preview_unsupported'), '미리보기가 없는 파일입니다');
});

test('메뉴·화면 연결: [파일]은 자료실 바로 아래(F5), 화면은 열 때만 불러오고, 기기 저장 없음, 쓰기는 Edge 다섯 가지만', () => {
  assert.ok(ITEMS.some(i => i.id === 'files' && i.view === 'files' && i.label === '파일'));
  const rest = defaultLayout().rest;
  assert.equal(rest[rest.indexOf('library') + 1], 'files');
  assert.match(read('app/index.html'), /data-view="library" type="button">자료실<\/button>\n\s*<button class="nav-btn" data-view="files" type="button">파일<\/button>/);
  assert.match(read('app/view-loader.js'), /files:\['\.\/folder-tree\.css','\.\/files\.css'/);
  assert.match(read('app/view-loader.js'), /async function files\(\)\{ await module\('\.\/files\.js'\)/);
  assert.match(read('app/app-router.js'), /files:\['at','shelf'\]/);
  const js = read('app/files.js'), model = read('app/files-model.mjs');
  const deviceStores = new RegExp([['local', 'Storage'], ['session', 'Storage'], ['indexed', 'DB'], ['caches', '\\.open']].map(p => p.join('')).join('|'));
  for (const [name, src] of [['files.js', js], ['files-model.mjs', model]]) assert.doesNotMatch(src, deviceStores, name);
  // 읽기: 색인 읽기 함수 3개 + Edge 읽기 동작. 쓰기(S48-45): Edge write()로 다섯 가지만(confirm:true를 붙임). 표에 직접 쓰지 않는다.
  assert.deepEqual([...new Set([...js.matchAll(/rpc\('(\w+)'/g)].map(m => m[1]))].sort(), ['app_cloud_find', 'app_cloud_list', 'app_cloud_trail']);
  assert.deepEqual([...new Set([...js.matchAll(/(?:edge\('|action: (?:kind === 'office' \? )?')([\w-]+)'/g)].map(m => m[1]))].sort(), ['media', 'open-url', 'preview', 'status', 'sync', 'thumb']);
  assert.deepEqual([...new Set([...js.matchAll(/await write\('(\w+)'/g)].map(m => m[1]))].sort(), ['across', 'mkdir', 'move', 'rename', 'trash']);
  assert.match(js, /body: \{action, \.\.\.body, confirm: true\}/);
  assert.match(js, /action: kind === 'office' \? 'preview' : 'media'/);
  // 표 직접 읽기는 같은 파일 보기(app_cloud_items GET) 하나뿐, 직접 쓰기 없음.
  assert.deepEqual([...js.matchAll(/\/rest\/v1\/(app_cloud_\w+)/g)].map(m => m[1]), ['app_cloud_items']);
  assert.doesNotMatch(js, /method: '(PATCH|DELETE|PUT)'/);
});

// ---------- S48-45 쓰기 ----------
test('write helpers: range pick, group by source, touched folders, move targets', async () => {
  const m = await import('../app/files-model.mjs');
  assert.deepEqual(m.pickRange(['a', 'b', 'c', 'd'], 'd', 'b'), ['b', 'c', 'd']);
  assert.deepEqual(m.pickRange(['a', 'b'], '', 'b'), ['b']);
  assert.deepEqual(m.pickRange(['a'], 'a', 'zz'), []);
  const rows = [{source: 'gd', item_id: 'G1', parent_id: 'P'}, {source: 'od', item_id: 'O1', parent_id: null}, {source: 'gd', item_id: 'G2', parent_id: null}];
  assert.deepEqual(m.groupBySource(rows).map(g => [g.source, g.rows.length]), [['od', 1], ['gd', 2]]);
  const many = Array.from({length: 450}, (_, i) => ({source: 'od', item_id: 'X' + i}));
  assert.deepEqual(m.groupBySource(many).map(g => g.rows.length), [200, 200, 50], 'server takes 200 at a time');
  assert.deepEqual(m.touchedFolders(rows, {source: 'od', parent: 'F'}).sort(), ['gd:', 'gd:P', 'od:', 'od:F']);
  const f = {source: 'od', item_id: 'F!1', parent_id: null, is_folder: true};
  assert.equal(m.moveTargetOk([f], {source: 'od', parent: 'F!1'}), false, 'not into itself');
  assert.equal(m.moveTargetOk([f], {source: 'od', parent: null}), false, 'already there');
  assert.equal(m.moveTargetOk([f], {source: 'od', parent: 'Z!2'}), true);
  assert.equal(m.moveTargetOk([rows[0]], {source: 'od', parent: null}), true, 'across clouds');
  assert.equal(m.moveTargetOk([], {source: 'od', parent: null}), false);
});

test('write texts: trash confirm names the cloud trash (F1), across limits (F8), error lines', async () => {
  const m = await import('../app/files-model.mjs');
  const one = m.trashAsk([{name: '회의.docx', source: 'od'}]);
  assert.match(one.text, /회의\.docx/);assert.equal(one.note, '되돌리기는 원드라이브 휴지통에서 합니다');
  assert.equal(m.trashAsk([{name: 'a', source: 'od'}, {name: 'b', source: 'gd'}]).note, '되돌리기는 원드라이브·구글 드라이브 휴지통에서 합니다');
  assert.equal(m.moveCheck([{size_bytes: 1}, {size_bytes: 1}], {across: true}).ok, false);
  assert.equal(m.moveCheck([{size_bytes: m.MOVE_ACROSS_MAX_BYTES + 1}], {across: true}).ok, false);
  assert.equal(m.moveCheck([{size_bytes: m.MOVE_ACROSS_MAX_BYTES}], {across: true}).ok, true);
  assert.equal(m.writeDoneText('move', {done: 3}), '3개 옮겼습니다');
  assert.equal(m.writeDoneText('trash', {done: 2, failed: 1}), '2개 휴지통으로 보냈습니다 · 1개 못 함');
  assert.equal(m.writeDoneText('across', {kept: true}), '복사는 끝났지만 원본은 그대로 남았습니다');
  assert.equal(m.writeErrorText('name_taken'), '같은 이름이 이미 있습니다');
  assert.equal(m.writeErrorText('verify_failed'), '옮긴 파일이 원본과 달라 원본을 그대로 두었습니다');
  assert.equal(m.writeErrorText('feature_required'), '이 작업공간에서는 쓰지 않는 기능입니다', 'falls back to read errors');
});

test('server and screen share the same across limit and batch size', async () => {
  const m = await import('../app/files-model.mjs');
  const h = await import('../supabase/functions/cloud-files/handler.ts');
  assert.equal(m.MOVE_ACROSS_MAX_BYTES, h.ACROSS_MAX_BYTES);
  assert.equal(m.MOVE_SAME_MAX, h.WRITE_MAX);
});

test('twins: same hash only, not itself, not trashed', async () => {
  const m = await import('../app/files-model.mjs');
  const me = {source: 'od', item_id: 'A', hash: 'sha1:x', name: 'a'};
  const rows = [me, {source: 'od', item_id: 'B', hash: 'sha1:x', name: '나'}, {source: 'od', item_id: 'C', hash: 'sha1:x', name: '가', trashed: true}, {source: 'od', item_id: 'D', hash: 'sha1:y', name: '다'}];
  assert.deepEqual(m.twinRows(rows, me).map(r => r.item_id), ['B']);
  assert.deepEqual(m.twinRows(rows, {...me, hash: null}), []);
});
