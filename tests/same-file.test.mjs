// UX-이미있는파일알림: 같은 이름·같은 크기 파일 판정(순수 규칙) + 공용 부품(찾기 → 묻기 → 나누기) 시험.
// 서버 시험(남의 작업공간 자료는 안 찾힘): 부품은 모든 읽기에 내 작업공간 id(workspace_id=eq.)를 붙이고 소유자 RLS 표만 읽는다 —
// 가짜 서버(소유자 RLS 흉내)에 남의 작업공간 줄을 섞어 두고, 그 줄이 찾히지 않는지와 모든 읽기에 내 작업공간 조건이 붙는지 본다.
// 읽는 표(app_documents·app_notes·app_task_attachments·자료실 폴더 표)의 소유자 RLS는 이 PR이 바꾸지 않는다(새 서버 함수·권한 없음).
import test from 'node:test';
import assert from 'node:assert/strict';
import {sameKey, sameTargets, inList, noteContains, placeLine, shortDay, docHit, noteHits, taskHit, matchFiles, askLines, splitByAnswer} from '../app/same-file-model.mjs';
import {findSameFiles, screenSameFiles, takeAfterSameCheck} from '../app/same-file.js';
import {readFileSync} from 'node:fs';
import {jsonbContains} from './security/helpers/postgrest-jsonb.mjs'; // 실제 PostgREST·Postgres jsonb @> 답 흉내

const WS = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const file = (name, size) => ({name, size});

test('열쇠: 이름(NFC)+크기, 크기 0·모름은 열쇠 없음', () => {
  assert.equal(sameKey('보도자료.hwp', 10), '보도자료.hwp\u000010');
  assert.equal(sameKey('보도자료.hwp'.normalize('NFD'), 10), sameKey('보도자료.hwp', 10));
  assert.equal(sameKey('a', 0), '');
  assert.equal(sameKey('', 3), '');
  assert.equal(sameTargets([file('a', 1), file('a', 1), file('a', 2), file('b', 0)]).length, 2);
});

test('서버 읽기 조각: 쉼표·괄호·따옴표가 든 이름도 한 값', () => {
  assert.equal(inList(['a,b', 'c"d', 'e\\f', 'a,b']), '("a,b","c\\"d","e\\\\f")');
  assert.deepEqual(JSON.parse(noteContains({name: 'x.hwp', size: 5})), [{file_name: 'x.hwp', size_bytes: 5}]);
});

test('위치 한 줄', () => {
  assert.equal(shortDay('2026-11-11T09:00:00Z'), '11/11');
  assert.equal(placeLine({area: '자료실', where: '예시 폴더', name: '예시 보도자료.hwp', at: '2026-11-11'}), '자료실 › 예시 폴더 › 예시 보도자료.hwp · 11/11');
  const names = {folders: new Map([['d1', '예시 폴더']]), meetings: new Map([['m1', '정기 회의']]), orgs: new Map([['o1', '예시 지부']])};
  assert.equal(docHit({id: 'd1', file_name: 'a.hwp', file_size: 3, created_at: '2026-11-11'}, names).line, '자료실 › 예시 폴더 › a.hwp · 11/11');
  assert.equal(docHit({id: 'd2', file_name: 'a.hwp', file_size: 3, meeting_id: 'm1'}, names).line, '사업 보고 › 정기 회의 › a.hwp');
  assert.equal(docHit({id: 'd3', file_name: 'a.hwp', file_size: 3, organization_id: 'o1'}, names).line, '담당조직 › 예시 지부 › a.hwp');
  assert.equal(docHit({id: 'd4', file_name: 'a.hwp', file_size: 3}, {}).line, '자료실 › a.hwp');
  assert.equal(noteHits({kind: 'basket', created_at: '2026-11-02'}, {key: 'k', name: 'a.hwp'}).line, '정리함 › a.hwp · 11/2');
  assert.equal(noteHits({kind: 'note', title: '회의 메모'}, {key: 'k', name: 'a.hwp'}).line, '노트 › 회의 메모 › a.hwp');
  assert.equal(taskHit({file_name: 'a.hwp', size_bytes: 3}).line, '할 일 첨부 › a.hwp');
});

test('파일마다 찾은 곳 · 답에 따라 나누기(닫으면 그대로 올림)', () => {
  const a = file('a.hwp', 3), b = file('b.pdf', 4), c = file('c.png', 5);
  const found = matchFiles([a, b, c], [docHit({id: 'd', file_name: 'a.hwp', file_size: 3}), taskHit({file_name: 'a.hwp', size_bytes: 3}), taskHit({file_name: 'c.png', size_bytes: 9})]);
  assert.equal(found.size, 1);
  assert.deepEqual(askLines(found), ['자료실 › a.hwp 외 1곳']);
  assert.deepEqual(splitByAnswer([a, b], found, 'skip'), {files: [b], used: [], skipped: [a]});
  assert.deepEqual(splitByAnswer([a, b], found, 'upload').files, [a, b]);
  assert.deepEqual(splitByAnswer([a, b], found, null).files, [a, b]);
  assert.equal(splitByAnswer([a, b], found, 'use').used[0].file, a);
});

function fakeRt(tables, calls = []) {
  return {
    context: {read: () => ({workspace: {id: WS}})},
    async api(path) {
      calls.push(path);
      const u = new URL('http://x' + path);
      const table = u.pathname.split('/').pop();
      const ws = (u.searchParams.get('workspace_id') || '').replace(/^eq\./, '');
      // 서버 흉내: 소유자 RLS — 내 작업공간 줄만 돌려준다.
      const rows = (tables[table] || []).filter(r => r.workspace_id === ws && ws === WS);
      if (table === 'app_notes') {
        const r = jsonbContains(rows, 'attachments', u.searchParams.get('attachments'));
        if (r.error) throw new Error(r.error);
        return r.rows;
      }
      if (table === 'app_documents' || table === 'app_task_attachments') {
        const sizeCol = table === 'app_documents' ? 'file_size' : 'size_bytes';
        const names = u.searchParams.get('file_name'), sizes = u.searchParams.get(sizeCol);
        return rows.filter(r => names.includes(`"${r.file_name}"`) && sizes.replace(/^in\.\(|\)$/g, '').split(',').map(Number).includes(r[sizeCol]));
      }
      if (table === 'app_library_folder_items') return rows;
      if (table === 'app_library_folders') return rows;
      return rows;
    },
  };
}

test('찾기: 자료실·노트·할 일 첨부를 내 작업공간 안에서만, 남의 작업공간 자료는 안 찾힘', async () => {
  const calls = [];
  const rt = fakeRt({
    app_documents: [
      {workspace_id: WS, id: '33333333-3333-4333-8333-333333333333', file_name: '예시 보도자료.hwp', file_size: 1234, created_at: '2026-11-11T01:00:00Z'},
      {workspace_id: OTHER, id: 'dx', file_name: '남의 자료.hwp', file_size: 77, created_at: '2026-11-11T01:00:00Z'},
    ],
    app_library_folder_items: [{workspace_id: WS, document_id: '33333333-3333-4333-8333-333333333333', folder_id: 'f1'}],
    app_library_folders: [{workspace_id: WS, id: 'f1', name: '예시 폴더'}],
    app_notes: [{workspace_id: WS, id: 'n1', kind: 'note', title: '메모', attachments: [{file_name: '예시 보도자료.hwp', size_bytes: 1234}]}],
    app_task_attachments: [{workspace_id: OTHER, file_name: '예시 보도자료.hwp', size_bytes: 1234}],
  }, calls);
  const mine = file('예시 보도자료.hwp', 1234), other = file('남의 자료.hwp', 77), fresh = file('새 파일.pdf', 5);
  const found = await findSameFiles([mine, other, fresh], {rt});
  assert.deepEqual([...found.keys()], [mine]);
  assert.deepEqual(found.get(mine).map(h => h.line), ['자료실 › 예시 폴더 › 예시 보도자료.hwp · 11/11', '노트 › 메모 › 예시 보도자료.hwp']);
  assert.ok(calls.length >= 4);
  for (const c of calls) assert.match(c, new RegExp(`workspace_id=eq\\.${WS}`), '모든 읽기에 내 작업공간 조건');
  for (const c of calls) assert.ok(!/method|rpc/.test(c), '읽기만');
});

test('찾기 실패·로그인 없음·오래 걸림 → 묻지 않고 그대로', async () => {
  const a = file('a', 1);
  assert.equal((await findSameFiles([a], {rt: null})).size, 0);
  assert.equal((await findSameFiles([a], {rt: {context: {read: () => ({workspace: {id: WS}})}, api: async () => { throw new Error('x'); }}})).size, 0);
  const slow = {context: {read: () => ({workspace: {id: WS}})}, api: () => new Promise(() => {})};
  assert.equal((await findSameFiles([a], {rt: slow, waitMs: 20})).size, 0);
  let asked = 0;
  const r = await screenSameFiles([a], {find: async () => new Map(), ask: async () => { asked++; return 'skip'; }});
  assert.deepEqual(r.files, [a]); assert.equal(asked, 0);
});

test('묻기: 같은 것만 모아 한 번, 나머지는 바로', async () => {
  const a = file('a.hwp', 3), b = file('b.pdf', 4);
  let seen = null;
  const find = async files => new Map([[files[0], [{line: '자료실 › 예시 폴더 › a.hwp · 11/11'}]]]);
  const r = await screenSameFiles([a, b], {find, ask: async (anchor, o) => { seen = o; return 'skip'; }});
  assert.equal(seen.text, '이미 있는 자료예요');
  assert.deepEqual(seen.lines, ['자료실 › 예시 폴더 › a.hwp · 11/11']);
  assert.equal(seen.note, '나머지 1개는 바로 올려요');
  assert.deepEqual(seen.actions.map(x => x.label), ['올리지 않기', '그래도 올리기']);
  assert.deepEqual(r.files, [b]);
  const r2 = await screenSameFiles([a, b], {find, useExisting: true, ask: async (anchor, o) => { seen = o; return 'use'; }});
  assert.deepEqual(seen.actions.map(x => x.label), ['올리지 않기', '그래도 올리기', '있는 것 쓰기']);
  assert.equal(r2.used[0].file, a);
  let took = null;
  await takeAfterSameCheck([a], list => { took = list; }, {find, ask: async () => 'skip'});
  assert.equal(took, null, '올릴 것이 없으면 부르지 않음');
});

test('모든 파일 넣는 곳이 같은 부품을 부른다(전수 표의 붙음 칸)', () => {
  const places = {
    'app/basket-upload.js': 'screenSameFiles', // 노트·정리함·업데이트·빠른 입력·조직 기록 📎 (mountBasketPicker 하나)
    'app/library-upload.js': 'screenSameFiles', // 자료실 [+ 자료 등록]·사업 보고 회의자료 [+]·조직 자료 [+]·자료실 화면 끌어 놓기
    'app/task-files.js': 'takeAfterSameCheck', // 할 일 첨부(새 할 일·고치기·파일 붙이기 창) + 일정 첨부(같은 고르기 부품)
    'app/files.js': 'screenSameFiles', // [파일] 고르기·끌어 놓기·붙여넣기
    'app/meeting-round-detail.js': 'screenSameFiles', // 사업 보고 사진·끌어 놓기
    'app/meeting-from-files.js': 'screenSameFiles', // 파일·글로 만들기
    'app/workplace-detail.js': 'screenSameFiles', // 조직 기록 칸 끌어 놓기
    'app/share-target.js': 'screenSameFiles', // 폰 공유로 넣기
  };
  for (const [p, name] of Object.entries(places)) assert.ok(readFileSync(new URL('../' + p, import.meta.url), 'utf8').includes(name), p);
  const ev = readFileSync(new URL('../app/event-files.js', import.meta.url), 'utf8');
  assert.match(ev, /mountNewTaskFilePick\(/, '일정 첨부는 할 일과 같은 고르기 부품');
});
