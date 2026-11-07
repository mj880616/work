import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SOURCES, SHELVES, SYNC_EVERY_MS, MOVE_ACROSS_MAX_BYTES, MOVE_SAME_MAX, kindOf, previewKind, sizeText, dayText,
  syncText, syncLabel, applySyncReply, syncSettled, sortRows, applyChanges, touchesCounts, moveCheck, trailNames, trailIds, pathText, treeRows, folderKey, placeOf, whereOf,
  cleanQuery, findSummary, errorText, failReason, OD_PDF_EXT, GD_EXPORT_MIME} from '../app/files-model.mjs';
import {ITEMS, defaultLayout} from '../app/menu-model.mjs';
// FILES-클라우드탐색기 ④ 화면 모델(docs/design/files-explorer.md, 명진 결정 F1~F9 11/02). 이름은 모두 가짜.
const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const row = (o = {}) => ({source: 'od', item_id: 'A!1', parent_id: null, name: '가짜.txt', is_folder: false, mime: null, size_bytes: 10, modified_at: '2026-11-02T00:00:00Z', ...o});

test('F2·F8 상수: 2분마다, 묶음은 별표·큰 파일(S50-33 최근 뺌), 클라우드 사이 1개·200MB, 같은 클라우드 200개', () => {
  assert.equal(SYNC_EVERY_MS, 120000);
  assert.deepEqual(SHELVES, ['starred', 'big']);
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

test('위치 줄·나무 줄: 맨 위부터, 펼친 폴더만, 묶음 2개 먼저(별표·큰 파일)', () => {
  const trail = [{item_id: 'C!1', name: '2026', depth: 0}, {item_id: 'B!1', name: '문서', depth: 1}];
  assert.deepEqual(trailNames('od', trail), ['원드라이브', '문서', '2026']);
  assert.deepEqual(trailIds(trail), ['B!1', 'C!1']);
  assert.equal(pathText('gd', '업무 › 자료실'), '구글 드라이브 › 업무 › 자료실');
  const children = new Map([[folderKey('od', null), [{item_id: 'B!1', name: '문서', child_count: 3}]], [folderKey('od', 'B!1'), []]]);
  const closed = treeRows({sources: ['od', 'gd'], children, open: new Set()});
  assert.deepEqual(closed.map(r => r.type), ['shelf', 'shelf', 'root', 'root']);
  const opened = treeRows({sources: ['od'], children, open: new Set([folderKey('od', null)])});
  assert.deepEqual(opened.slice(2).map(r => [r.type, r.name || r.source, r.depth, r.hasKids]), [['root', 'od', 0, true], ['folder', '문서', 1, false]]);
});

test('주소 자리(새로고침 제자리): 원드라이브 id의 !는 :로 적고 되읽는다, 라우터 값 규칙 안', () => {
  const at = placeOf({source: 'od', parent: 'D4648F06!5492'});
  assert.deepEqual(at, {at: 'od:D4648F06:5492'});
  assert.match(at.at, /^[A-Za-z0-9_.:-]{1,80}$/);
  assert.deepEqual(whereOf(at), {source: 'od', parent: 'D4648F06!5492'});
  assert.deepEqual(whereOf(placeOf({source: 'gd', parent: '1aB_c-D'})), {source: 'gd', parent: '1aB_c-D'});
  assert.deepEqual(whereOf(placeOf({source: 'gd', parent: null})), {source: 'gd', parent: null});
  assert.deepEqual(whereOf(placeOf({shelf: 'starred'})), {shelf: 'starred'});
  assert.equal(whereOf({shelf: 'recent'}), null, 'S50-33: 옛 주소 ?shelf=recent는 첫 화면으로');
  assert.equal(whereOf({at: 'xx:1'}), null);
  assert.equal(whereOf({shelf: 'nope'}), null);
});

test('찾기 글·오류 한 줄', () => {
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
  assert.match(read('app/view-loader.js'), /files:\['\.\/od-link\.css','\.\/folder-tree\.css','\.\/source-chips\.css','\.\/files\.css'/);
  assert.match(read('app/view-loader.js'), /async function files\(\)\{ await module\('\.\/files\.js'\)/);
  assert.match(read('app/app-router.js'), /files:\['at','shelf'\]/);
  const js = read('app/files.js'), model = read('app/files-model.mjs');
  const deviceStores = new RegExp([['local', 'Storage'], ['session', 'Storage'], ['indexed', 'DB'], ['caches', '\\.open']].map(p => p.join('')).join('|'));
  for (const [name, src] of [['files.js', js], ['files-model.mjs', model]]) assert.doesNotMatch(src, deviceStores, name);
  // 읽기: 색인 읽기 함수 3개 + Edge 읽기 동작. 쓰기(S48-45): Edge write()로 다섯 가지만(confirm:true를 붙임). 표에 직접 쓰지 않는다.
  assert.deepEqual([...new Set([...js.matchAll(/rpc\('(\w+)'/g)].map(m => m[1]))].sort(), ['app_cloud_find_in', 'app_cloud_list', 'app_cloud_trail']);
  // S51-20 ③: 같은 저장소 옮기기 알림의 [되돌리기]는 사람이 누른 것만 같은 move(confirm:true)로 원래 폴더에 보낸다.
  assert.deepEqual([...new Set([...js.matchAll(/(?:edge\('|action: (?:kind === 'office' \? )?')([\w-]+)'/g)].map(m => m[1]))].sort(), ['folder', 'job_add', 'job_list', 'job_pause', 'media', 'mkdir', 'move', 'open-url', 'preview', 'rename', 'status', 'sync', 'thumb',
    'upload_done', 'upload_open', 'upload_progress', 'upload_resume']);
  // S52-43 ②: 이름 바꾸기 [되돌리기](원래 이름으로 rename)·폴더째 다른 저장소로(받을 곳에 같은 폴더 모양 mkdir)도 사람이 누른 것만 confirm:true.
  assert.match(js, /body: \{action: 'rename', source: r\.source, id: r\.item_id, name: r\.name, confirm: true\}/);
  assert.match(js, /body: \{action: 'mkdir', source: at\.source, parent: at\.parent, name, confirm: true\}/);
  assert.match(js, /body: \{action: 'move', source: dest\.source, ids: rows\.map\(r => r\.item_id\), to: parent \|\| null, confirm: true\}/);
  // 올리기(2-④): 네 동작 모두 confirm:true, 화면을 숨기거나 닫을 때 멈춤(job_pause)은 keepalive 한 번.
  for (const a of ['upload_open', 'upload_resume', 'upload_progress', 'upload_done']) assert.match(js, new RegExp(`action: '${a}', confirm: true`), a);
  assert.match(js, /keepalive: true[^]*action: 'job_pause', confirm: true, ids:/);
  // FILES-통합 2-②: 복사·다른 저장소로 옮기기는 서버 작업표(job_add, confirm:true)로, 화면이 직접 보내는 것은 같은 저장소 안 move만.
  //   멈춤·이어 하기(job_pause·job_resume)도 confirm:true. 작업표는 Edge로만(표 직접 읽기·쓰기 없음).
  assert.match(js, /action: 'job_add', confirm: true, kind: mode/);
  assert.match(js, /body: \{action, confirm: true, \.\.\.\(ids \? \{ids\} : \{all: true\}\)\}/);
  assert.deepEqual([...new Set([...js.matchAll(/jobsDo\((b\.dataset[^,)]+)/g)].map(m => m[1]))].sort(), ["b.dataset.fxJobAct === 'pause' ? 'job_pause' : 'job_resume'", "b.dataset.fxJobsAll === 'pause' ? 'job_pause' : 'job_resume'"]);
  assert.deepEqual([...new Set([...js.matchAll(/await write\('(\w+)'/g)].map(m => m[1]))].sort(), ['mkdir', 'rename', 'star', 'trash']);
  assert.deepEqual([...new Set([...js.matchAll(/await call\('(\w+)'/g), ...js.matchAll(/await call\(mode === 'move' \? '(\w+)' : '(\w+)'/g)].flatMap(m => m.slice(1)))].sort(), ['move']);
  assert.equal([...js.matchAll(/body: \{action, \.\.\.body, confirm: true\}/g)].length, 2);
  // S49-51: 미리보기 바이트는 rowBlob 한 곳(클라우드는 Edge thumb·preview·media, 이 폰은 앱 다리).
  assert.match(js, /rowBlob\(r, kind === 'office' \? 'preview' : 'media'\)/);
  // 표 직접 읽기는 같은 파일 보기(app_cloud_items GET) 하나뿐, 직접 쓰기 없음.
  assert.deepEqual([...js.matchAll(/\/rest\/v1\/(app_cloud_\w+)/g)].map(m => m[1]), ['app_cloud_items']);
  assert.doesNotMatch(js, /method: '(PATCH|DELETE)'/);
  // PUT은 올리기 조각 하나뿐: 서버가 열어 준 이어 올리기 자리(slot.url)로, 토큰·쿠키 없이(Authorization 없음).
  // UI-올리기진행표시 ②: 조각은 공용 보내기(upload-send.mjs sendUpload = XMLHttpRequest, 실제 보낸 양)로 보낸다 — 쿠키를 싣지 않는다(withCredentials를 켜지 않음).
  assert.deepEqual([...js.matchAll(/(?:fetch|sendUpload)\(([\w.]+), \{method: 'PUT'[^}]*headers: \{([^}]*)\}/g)].map(m => [m[1], m[2]]), [['slot.url', "'Content-Range': `bytes ${piece.start"]]);
  assert.doesNotMatch(js, /withCredentials/);
  assert.doesNotMatch(read('app/upload-send.mjs'), /withCredentials\s*=\s*true/);
  // 조각 PUT 머리는 Content-Range 하나(Authorization·apikey 없음).
  assert.match(js, /sendUpload\(slot\.url, \{method: 'PUT', headers: \{'Content-Range': `bytes \$\{piece\.start\}-\$\{piece\.end - 1\}\/\$\{size\}`\},\s*body: file\.slice/);
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

test('S49-17 폴더 개수: 읽은 값이 있을 때만 글, 모르면 빈 글 · 잠긴 보관소(종류 없는 0B)만 걸러 낸다', async () => {
  const {folderCountText, isLockedItem} = await import('../app/files-model.mjs');
  assert.equal(folderCountText(undefined), '');
  assert.equal(folderCountText({folders: 0, files: 0}), '0개');
  assert.equal(folderCountText({folders: 0, files: 3}), '3개');
  assert.equal(folderCountText({folders: 1, files: 3}), '폴더 1 · 파일 3');
  assert.equal(folderCountText({folders: 2, files: 0}), '폴더 2');
  assert.equal(isLockedItem(row({mime: null, size_bytes: 0})), true);
  assert.equal(isLockedItem(row({mime: 'text/plain', size_bytes: 0})), false);
  assert.equal(isLockedItem(row({mime: null, size_bytes: 12})), false);
  assert.equal(isLockedItem(row({is_folder: true, mime: null, size_bytes: 0})), false);
  assert.equal(isLockedItem(row({source: 'gd', mime: null, size_bytes: 0})), false);
});

// ---------- FILES-통합 2-① 복사(S49-27, 명진 결정 H-3·H-4·H-5) ----------
test('복사·옮기기 거르기: 다른 저장소로 폴더·구글 문서·크기 모름은 막고 안내, 같은 저장소 폴더째 복사는 됨', async () => {
  const m = await import('../app/files-model.mjs');
  const f = {source: 'od', item_id: 'F1', parent_id: null, name: '폴더', is_folder: true, size_bytes: null};
  const a = {source: 'od', item_id: 'A', parent_id: 'F1', name: 'a.pdf', is_folder: false, size_bytes: 10};
  const g = {source: 'gd', item_id: 'G', parent_id: null, name: '문서', is_folder: false, mime: 'application/vnd.google-apps.document', size_bytes: null};
  const across = m.xferPlan([f, a, g], {source: 'gd', parent: null}, 'copy');
  assert.deepEqual(across.ok.map(r => r.item_id), ['F1', 'A', 'G'], 'S52-43 ②: folder across between the two clouds goes too (expanded by the screen), Google doc stays in Google');
  const toPc = m.xferPlan([f], {source: 'pc', parent: 'C:\\'}, 'copy');
  assert.equal(toPc.ok.length, 0);
  assert.match(toPc.reason, /내 PC·이 폰과는 폴더째 복사하지 않아요/);
  assert.match(m.xferPlan([f], {source: 'ph', parent: 'Download'}, 'move').reason, /폴더째 옮기지 않아요/);
  assert.equal(m.treeAcrossBig(500, 100), false);
  assert.equal(m.treeAcrossBig(501, 1), true);
  assert.equal(m.treeAcrossBig(1, 101), true);
  assert.match(m.treeDoneText('move', {folders: 2, files: 5, skipped: 1}), /^폴더 2개 · 파일 5개 옮기기 시작 .* 1개 건너뜀$/);
  const toOd = m.xferPlan([g], {source: 'od', parent: null}, 'copy');
  assert.equal(toOd.ok.length, 0); assert.match(toOd.reason, /구글 문서/);
  const same = m.xferPlan([f, a], {source: 'od', parent: null}, 'copy');
  assert.deepEqual(same.ok.map(r => r.item_id), ['F1', 'A'], 'same cloud: folder and file both go');
  assert.match(m.xferPlan([f], {source: 'od', parent: 'F1'}, 'copy').reason, /자기 안으로 복사할 수 없습니다/);
  assert.match(m.xferPlan([a], {source: 'od', parent: 'F1'}, 'move').reason, /이미 이 폴더에 있습니다/);
  assert.deepEqual(m.xferPlan([a], {source: 'od', parent: 'F1'}, 'copy').ok, [a], 'copy into the same folder is allowed (gets a number)');
  assert.deepEqual(m.xferPlan([f], {source: 'gd', parent: null}, 'move').ok, [f], 'S52-43 ②: folder move between the two clouds');
  assert.equal(m.xferPlan([a], null).reason, '받을 곳을 고르세요');
});
test('같은 이름·큰 파일 묻는 글(H-3·H-4), 전송 줄·끝 한 줄', async () => {
  const m = await import('../app/files-model.mjs');
  assert.equal(m.sameNameAsk('move'), '같은 이름이 있어요. 그래도 옮길까요?');
  assert.equal(m.sameNameAsk('copy'), '같은 이름이 있어요. 그래도 복사할까요?');
  assert.equal(m.sameNameAsk('down'), '같은 이름이 있어요. 그래도 받을까요?');
  const big = {source: 'od', item_id: 'B', size_bytes: Math.round(1.2 * 1024 ** 3)};
  assert.equal(m.bigAsk(big), '200MB가 넘어요(1.2GB). 그래도 보낼까요?');
  assert.equal(m.XFER_BIG_HOW, '서버가 10MB씩 나눠 이어 보내요. 화면을 닫아도 계속되고, 끊기면 끊긴 곳부터 다시. 폰 데이터는 쓰지 않아요.');
  assert.equal(m.XFER_BIG_LATER, undefined, '2-②: 다음 판 안내는 없어짐');
  assert.equal(m.xferBig(big, {source: 'gd'}), true); assert.equal(m.xferBig(big, {source: 'od'}), false, 'same cloud is not limited');
  assert.equal(m.xferBig({...big, size_bytes: 200 * 1024 * 1024}, {source: 'gd'}), false, '200MB exactly is fine');
  const rows = [{source: 'od', item_id: 'A', name: '가짜.PDF'}, {source: 'od', item_id: 'B', name: 'b.txt'}];
  assert.deepEqual(m.sameNameRows(rows, [{source: 'gd', item_id: 'X', name: '가짜.pdf'}, {source: 'gd', item_id: 'Y', name: 'c', trashed: true}]).map(r => r.item_id), ['A'], 'case-insensitive');
  assert.deepEqual(m.sameNameRows(rows, [{source: 'od', item_id: 'A', name: '가짜.PDF'}]).map(r => r.item_id), ['A'], 'copy into its own folder: same name too');
  assert.equal(m.xferLine(2, 5), '2/5 보내는 중'); assert.equal(m.xferPercent(1, 4), 25);
  assert.equal(m.xferDoneText('copy', {done: 4, failed: 1}), '4개 복사함 · 1개 못 함');
  assert.equal(m.xferDoneText('move', {done: 2, skipped: 1}), '2개 옮김 · 1개 건너뜀');
  assert.equal(m.destTitle(2, 'copy'), '2개 복사할 곳'); assert.equal(m.destButton('copy'), '여기에 복사'); assert.equal(m.destButton('move'), '여기에 옮기기');
});
test('최근 보낸 곳: 맨 앞에, 같은 곳은 하나만, 3개까지, 이름 40자, 서버 화면 기억 모양과 같음', async () => {
  const m = await import('../app/files-model.mjs');
  const {validValue} = await import('../app/view-prefs.js');
  let l = m.pushRecentDest([], {source: 'gd', parent: 'g1'}, '연습 자료');
  l = m.pushRecentDest(l, {source: 'od', parent: null});
  l = m.pushRecentDest(l, {source: 'od', parent: 'O!2'}, '가'.repeat(50));
  l = m.pushRecentDest(l, {source: 'gd', parent: 'g1'}, '연습 자료');
  assert.deepEqual(l.map(d => d.id), ['g1', 'O!2', '']);
  assert.equal(l[1].name.length, 40); assert.equal(l[2].name, '원드라이브');
  assert.equal(m.pushRecentDest(l, {source: 'gd', parent: 'g2'}, 'x').length, 3);
  assert.equal(validValue('files_dest_recent', l), true);
  assert.deepEqual(m.recentDestOf(l[2]), {source: 'od', parent: null});
  for (const bad of [[{source: 'ph', id: '', name: 'x'}], [{source: 'od', id: '', name: ''}], [{source: 'od', name: 'x'}], [{source: 'od', id: 'a/b', name: 'x'}],
    [{source: 'od', id: '', name: 'x', extra: 1}], [1, 2], 'od', Array(4).fill({source: 'od', id: '', name: 'x'})]) assert.equal(validValue('files_dest_recent', bad), false, JSON.stringify(bad));
});
test('번호 붙이기 규칙은 공용 함수 하나(화면·Edge 같은 numberedName)', async () => {
  const {numberedName} = await import('../app/file-rename-name.mjs');
  assert.equal(numberedName('보고서.hwp', ['보고서.hwp']), '보고서 (2).hwp');
  assert.equal(numberedName('보고서.hwp', ['보고서.HWP', '보고서 (2).hwp']), '보고서 (3).hwp');
  assert.equal(numberedName('보고서 (2).hwp', ['보고서 (2).hwp']), '보고서 (3).hwp');
  assert.equal(numberedName('폴더', ['폴더']), '폴더 (2)');
  assert.equal(numberedName('새.pdf', []), '새.pdf');
  const edge = read('supabase/functions/cloud-files/handler.ts');
  assert.match(edge, /return numberedName\(name, taken\);/);
  assert.match(read('app/files.js'), /sameNameAsk\(mode\)/);
});
test('실패 까닭 한 줄(S49-26): 정해 둔 말만, 서버 글자는 그대로 보이지 않음', () => {
  assert.equal(failReason({code: 'timeout', message: '요청 시간이 초과되었습니다.'}), '시간 초과');
  assert.equal(failReason({status: 500, code: 'http_500', message: 'canceling statement due to statement timeout'}), '서버 시간 초과');
  assert.equal(failReason({status: 504, code: 'http_504'}), '서버 시간 초과');
  assert.equal(failReason({code: 'network_error'}), '연결 끊김');
  assert.equal(failReason({status: 503, code: 'http_503', message: 'internal detail x'}), '서버 오류 503');
  assert.equal(failReason({status: 404, code: 'http_404', message: 'Could not find the function'}), '요청 오류 404');
  assert.equal(failReason(null), '');
  assert.equal(failReason({message: 'something'}), '');
  const js = read('app/files.js');
  // S49-30 두 칸: 목록·찾기 까닭은 칸마다(p.failedWhy·p.findWhy), 연결 상태 까닭은 화면 하나(state.statusWhy).
  for (const k of ['p.failedWhy', 'p.findWhy', 'state.statusWhy']) assert.match(js, new RegExp(`reason: ${k.replace('.', '\\.')}`), k);
});

test('전송 목록(2-②): 상태 글·까닭·줄 아래 글·전송 줄 묶음·단추·기기 줄 다시 열기·합치기', async () => {
  const m = await import('../app/files-model.mjs');
  const MB = 1024 * 1024;
  const j = o => ({id: 'x', kind: 'copy', origin: 'cloud', src_source: 'od', dest_source: 'gd', name: '가짜.mp4', size_bytes: 400 * MB, sent_bytes: 0, status: 'queued', big: false, created_at: '2026-11-04T01:00:00Z', ...o});
  assert.equal(m.jobStatusText(j({status: 'running', big: true, sent_bytes: 100 * MB})), '25%');
  assert.equal(m.jobStatusText(j({status: 'running'})), '보내는 중');
  assert.deepEqual(['queued', 'paused', 'done', 'failed', 'skipped'].map(s => m.jobStatusText(j({status: s}))), ['기다림', '멈춤', '끝', '실패', '건너뜀']);
  assert.equal(m.jobLine(j({status: 'failed', error_code: 'no_space'})), '원드라이브 → 구글 드라이브 · 400MB · 받을 곳 공간이 부족해요');
  assert.equal(m.jobLine(j({status: 'failed', error_code: 'weird_thing'})), '원드라이브 → 구글 드라이브 · 400MB · 연결이 끊겼어요', 'unknown code → fixed word');
  assert.equal(m.jobLine(j({kind: 'move', status: 'done', result_name: '가짜 (2).mp4', size_bytes: null})), "원드라이브 → 구글 드라이브 옮기기 · '가짜 (2).mp4'로");
  assert.equal(m.jobLine(j({status: 'skipped'})), '원드라이브 → 구글 드라이브 · 400MB · 같은 이름이라 건너뜀');
  assert.equal(m.jobLine(j({origin: 'device', src_source: 'dev'})), '이 기기 → 구글 드라이브 · 400MB');
  // 전송 줄: 지금 묶음(가장 오래된 열린 줄 이후) 기준, 바이트로 몫.
  const list = [j({id: 'a', status: 'done', created_at: '2026-11-04T00:00:00Z'}), j({id: 'b', status: 'done', created_at: '2026-11-04T01:00:01Z', size_bytes: 100}),
    j({id: 'c', status: 'running', big: true, created_at: '2026-11-04T01:00:01Z', size_bytes: 300, sent_bytes: 100}), j({id: 'd', status: 'queued', created_at: '2026-11-04T01:00:02Z', size_bytes: 100})];
  assert.deepEqual(m.jobStrip(list), {text: '2/3 보내는 중', percent: 40, failed: 0, name: '가짜.mp4'});
  assert.equal(m.jobsTitle(list), '전송 · 2/3');
  assert.deepEqual(m.jobStrip([j({status: 'paused'})]), {text: '1개 멈춤', percent: 0, failed: 0, name: '', paused: true});
  assert.deepEqual(m.jobStrip([j({status: 'failed'}), j({id: 'y', status: 'done'})]), {text: '1개 못 보냄', percent: 0, failed: 1, name: ''});
  assert.equal(m.jobStrip([j({status: 'done'})]), null, 'all done: strip hidden');
  assert.equal(m.jobsTitle([]), '전송');
  assert.deepEqual(['queued', 'running', 'paused', 'failed', 'done', 'skipped'].map(s => m.jobAction(j({status: s}))), ['pause', 'pause', 'resume', 'retry', '', '']);
  assert.equal(m.jobAction(j({origin: 'device', status: 'paused'})), 'reup', 'device rows are resumed by that device with the same file (2-④)');
  // 노트북(H-6): 기기가 낀 줄은 다시 열면 멈춤으로, 클라우드끼리는 그대로(서버가 계속).
  assert.equal(m.deviceJobOnReopen(j({origin: 'device', status: 'running'})).status, 'paused');
  assert.equal(m.deviceJobOnReopen(j({status: 'running'})).status, 'running');
  const merged = m.mergeJobs([j({id: 'a', status: 'running'}), j({id: 'b', created_at: '2026-11-04T02:00:00Z'})], [j({id: 'a', status: 'done'})]);
  assert.deepEqual(merged.map(x => x.id + ':' + x.status), ['b:queued', 'a:done']);
  assert.deepEqual(m.newlyDone([j({id: 'a', status: 'running'}), j({id: 'b', status: 'done'})], [j({id: 'a', status: 'done'}), j({id: 'b', status: 'done'}), j({id: 'n', status: 'done'})]).map(x => x.id), ['a']);
  assert.equal(m.jobsActive([j({status: 'paused'})]), false); assert.equal(m.jobsActive([j({status: 'running'})]), true);
  assert.equal(m.jobPercent(j({status: 'done', sent_bytes: 0})), 100);
});

// S49-33 FILES-통합 2-④ 올리기·별표
test('upload plan: name rule, 2GB cap, count cap; same name; big; resume match; pieces', async () => {
  const m = await import('../app/files-model.mjs');
  const ok = n => !/[\/\\:*?"<>|]/.test(n) && n.length > 0;
  const p = m.uploadPlan([{name: 'a.txt', size: 3}, {name: 'b/c.txt', size: 1}, {name: 'big.iso', size: m.UPLOAD_MAX_BYTES + 1}, {name: 'x', size: NaN}], ok);
  assert.deepEqual(p.ok.map(f => f.name), ['a.txt']);
  assert.equal(p.blocked.length, 3);
  assert.match(p.blocked.find(b => b.file.name === 'big.iso').reason, /2GB까지/);
  assert.equal(m.uploadPlan(Array.from({length: 201}, (_, i) => ({name: `f${i}`, size: 1})), ok).ok.length, 200);
  assert.equal(m.uploadPlan([], ok).reason, '고른 파일이 없어요');
  assert.deepEqual(m.upSameName([{name: 'A.TXT', size: 1}, {name: 'b', size: 1}], [{name: 'a.txt'}, {name: 'b', trashed: true}]).map(f => f.name), ['A.TXT']);
  assert.equal(m.upBig({size: m.XFER_BIG_BYTES}), false);
  assert.equal(m.upBig({size: m.XFER_BIG_BYTES + 1}), true);
  assert.equal(m.bigAsk({size_bytes: m.XFER_BIG_BYTES + 1}, 'up').endsWith('그래도 올릴까요?'), true);
  assert.equal(m.sameNameAsk('up'), '같은 이름이 있어요. 그래도 올릴까요?');
  assert.equal(m.sameUpFile({name: 'a.txt', size_bytes: 3}, {name: 'a.txt', size: 3}), true);
  assert.equal(m.sameUpFile({name: 'a.txt', size_bytes: 3}, {name: 'a.txt', size: 4}), false);
  assert.deepEqual(m.upPiece(0, 10, 4), {start: 0, end: 4});
  assert.deepEqual(m.upPiece(8, 10, 4), {start: 8, end: 10});
  assert.equal(m.upPiece(10, 10, 4), null);
  assert.equal(m.upResultId({id: 'OD!7'}), 'OD!7');
  assert.equal(m.upResultId({id: '../x'}), null);
  assert.equal(m.upDropText('가짜 문서함'), '여기 놓으면 가짜 문서함에 올리기');
});
test('upload rows in the transfer list: device rows show %, [이어 올리기], re-pick hint only without the file', async () => {
  const m = await import('../app/files-model.mjs');
  const j = {origin: 'device', status: 'running', size_bytes: 10, sent_bytes: 4, src_source: 'dev', dest_source: 'od', name: 'a.txt'};
  assert.equal(m.jobStatusText(j), '40%');
  assert.equal(m.jobAction(j), 'pause');
  assert.equal(m.jobAction({...j, status: 'paused'}), 'reup');
  assert.equal(m.jobAction({...j, status: 'failed'}), 'reup');
  assert.equal(m.jobAction({...j, status: 'done'}), '');
  assert.equal(m.deviceHint({...j, status: 'paused'}, false), '이어 올리려면 같은 파일을 다시 골라 주세요');
  assert.equal(m.deviceHint({...j, status: 'paused'}, true), '');
  assert.equal(m.deviceHint({...j, origin: 'cloud', status: 'paused'}, false), '');
  assert.match(m.jobLine(j), /^이 기기 → 원드라이브/);
  assert.equal(m.deviceJobOnReopen(j).status, 'paused');
});
test('stars: want/label and apply', async () => {
  const m = await import('../app/files-model.mjs');
  assert.equal(m.starWant([{starred: true}, {starred: false}]), true);
  assert.equal(m.starLabel([{starred: true}]), '★ 별표 빼기');
  assert.equal(m.starLabel([{starred: false}]), '☆ 별표');
  const rows = [{source: 'od', item_id: 'A', starred: false}, {source: 'gd', item_id: 'A', starred: false}];
  const next = m.applyStars(rows, 'od', ['A'], true);
  assert.deepEqual(next.map(r => r.starred), [true, false]);
  assert.equal(m.applyStars(next, 'od', ['A'], true), next, 'no change keeps the same array');
});

test('S50-14: 처음 목록 받기가 안 끝났거나 실패하면 \'방금 맞춤\'을 띄우지 않는다', () => {
  const now = Date.parse('2026-11-05T03:00:00Z'), recent = now - 5000;
  const st = {od: {connected: true, scanning: false, error: null}, gd: {connected: true, scanning: false, error: null}};
  assert.equal(syncLabel(st, recent, now).text, '방금 맞춤');
  assert.equal(syncLabel({...st, od: {...st.od, scanning: true}}, recent, now).text, '맞추기…');
  // S50-20: 받는 중이면 받은 개수도(두 출처 합). 세지 못한 출처는 빼고, 하나도 못 세면 개수 없이.
  assert.equal(syncLabel({...st, od: {...st.od, scanning: true, received: 1200}}, recent, now).text, '맞추기… 1,200개');
  assert.equal(syncLabel({...st, od: {...st.od, scanning: true, received: 5}, gd: {...st.gd, scanning: true, received: null}}, recent, now).text, '맞추기… 5개');
  assert.equal(applySyncReply(st, {od: {more: true, received: 30}}).od.received, 30);
  assert.equal(applySyncReply({...st, od: {...st.od, received: 30}}, {od: {done: true}}).od.received, null);
  assert.equal(syncLabel({...st, gd: {...st.gd, error: 'GD_STORE_UNAVAILABLE'}}, recent, now).text, '맞추기 안 됨');
  // 연결 안 된 출처의 옛 오류는 보지 않는다.
  assert.equal(syncLabel({...st, gd: {connected: false, error: 'x'}}, recent, now).text, '방금 맞춤');
  assert.equal(syncLabel(null, NaN, now).text, '맞추기');
  // 응답을 상태에 입힘: 이어 받기 남음 → 받는 중, 끝·이미 맞음 → 끝, 실패 → 오류. busy는 그대로.
  let s2 = applySyncReply(st, {od: {more: true, done: false}, gd: {error: 'store_unavailable', more: false, done: false}});
  assert.equal(s2.od.scanning, true); assert.equal(s2.gd.error, 'store_unavailable');
  s2 = applySyncReply(s2, {od: {more: false, done: true}, gd: {fresh: true}});
  assert.equal(s2.od.scanning, false); assert.equal(s2.gd.error, null);
  assert.deepEqual(applySyncReply(s2, {od: {busy: true}}).od, s2.od);
  assert.equal(syncSettled({od: {more: true}, gd: {fresh: true}}), false);
  assert.equal(syncSettled({od: {done: true}, gd: {error: 'x'}}), false);
  assert.equal(syncSettled({od: {busy: true}}), false);
  assert.equal(syncSettled({od: {done: true, more: false}, gd: {fresh: true}}), true);
  // 화면은 응답마다 상태를 입히고, 다 끝났을 때만 맞춘 때를 옮긴다(실패해도 '방금 맞춤'이던 옛 코드 금지).
  const src = read('app/files.js');
  assert.match(src, /state\.status = applySyncReply\(state\.status, d, SOURCES\);\n\s*if \(syncSettled\(d, SOURCES\)\) state\.syncedAt = Date\.now\(\);/);
  assert.doesNotMatch(src, /\n\s*state\.syncedAt = Date\.now\(\);\n\s*if \(SOURCES\.some/);
});
