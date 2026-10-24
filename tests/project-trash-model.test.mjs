import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// TRASH-삭제휴지통 2단계: 휴지통 판정·문구·오류 변환 규칙. 이름은 모두 가짜다.
import {
  TRASH_STATE, TRASH_TEXT, classifyTrashError, classifyTrashList, normalizeTrashRows,
  deleteDialogText, trashErrorText, purgeConfirmText, archiveButtonLabel, firstArchiveTab,
} from '../app/project-trash-model.mjs';

test('함수가 없을 때(404·PGRST202)는 missing, 그 밖의 실패는 failed', () => {
  assert.equal(classifyTrashError({status: 404, message: 'x'}), TRASH_STATE.MISSING);
  assert.equal(classifyTrashError({status: 400, message: 'Could not find the function public.app_trash_list(p_kind) in the schema cache'}), TRASH_STATE.MISSING);
  assert.equal(classifyTrashError({message: 'PGRST202'}), TRASH_STATE.MISSING);
  assert.equal(classifyTrashError({status: 500, message: 'boom'}), TRASH_STATE.FAILED);
  assert.equal(classifyTrashError({status: 0, message: '네트워크'}), TRASH_STATE.FAILED);
  assert.equal(classifyTrashError(null), TRASH_STATE.FAILED);
});

test('목록 응답이 배열일 때만 ready', () => {
  assert.equal(classifyTrashList([]), TRASH_STATE.READY);
  assert.equal(classifyTrashList([{id: 'a'}]), TRASH_STATE.READY);
  assert.equal(classifyTrashList(null), TRASH_STATE.MISSING);
  assert.equal(classifyTrashList({ok: true}), TRASH_STATE.MISSING);
});

test('휴지통 줄은 넣은 시각 최신순으로 정리하고 이상한 줄은 버린다', () => {
  const rows = normalizeTrashRows([
    {kind: 'project', id: 'p1', name: ' 합성 사업 ', deleted_at: '2026-10-20T01:00:00Z', child_count: 2, parent_in_trash: false},
    {kind: 'project', id: 'p2', name: '', deleted_at: '2026-10-24T01:00:00Z', child_count: '3', parent_in_trash: true},
    {kind: 'other', id: 'p3', name: '다른 종류'},
    {name: '번호 없음'},
    null,
  ]);
  assert.deepEqual(rows.map((r) => r.id), ['p2', 'p1']);
  assert.equal(rows[0].name, '이름 없음');
  assert.equal(rows[0].child_count, 3);
  assert.equal(rows[0].parent_in_trash, true);
  assert.equal(rows[1].name, '합성 사업');
  assert.deepEqual(normalizeTrashRows(null), []);
});

test('삭제 창: 휴지통을 쓸 수 있을 때만 휴지통 문구, 아니면 지금 문구', () => {
  const ready = deleteDialogText({trash: TRASH_STATE.READY, name: '합성', isChild: false, childCount: 2});
  assert.match(ready.message, /휴지통으로 옮깁니다/);
  assert.match(ready.message, /하위 프로젝트 2개도 함께 옮겨지고/);
  assert.match(ready.message, /연결된 기록은 그대로 남습니다/);
  assert.match(ready.message, /휴지통에서 되돌릴 수 있습니다/);
  assert.equal(ready.note, '');
  for (const state of [TRASH_STATE.MISSING, TRASH_STATE.FAILED, TRASH_STATE.UNKNOWN]) {
    const old = deleteDialogText({trash: state, name: '합성', isChild: true, childCount: 1});
    assert.doesNotMatch(old.message + old.note + old.button, /휴지통/, state);
    assert.match(old.message, /하위 프로젝트를 삭제합니다/);
    assert.match(old.message, /하위 프로젝트 1개도 함께 삭제됩니다/);
    assert.match(old.note, /연결만 해제/);
    assert.equal(old.button, '삭제');
  }
  assert.doesNotMatch(deleteDialogText({trash: TRASH_STATE.READY, name: 'a', isChild: false, childCount: 0}).message, /하위 프로젝트 0개/);
});

test('서버 오류 코드를 화면 글로 바꾼다', () => {
  assert.equal(trashErrorText({message: 'TRASH_PARENT_IN_TRASH'}), TRASH_TEXT.PARENT_FIRST);
  assert.equal(trashErrorText({message: 'TRASH_NOT_FOUND'}), TRASH_TEXT.NOT_FOUND);
  assert.equal(trashErrorText({message: 'TRASH_KIND_UNKNOWN'}, '기본'), '기본');
  assert.equal(trashErrorText({message: '이상한 오류'}, '기본'), '기본');
  assert.equal(TRASH_TEXT.PARENT_FIRST, '상위 프로젝트를 먼저 되돌려 주세요.');
});

test('영구 삭제 확인에 연결 풀림·진행기록 삭제 안내와 하위 수가 들어간다', () => {
  const text = purgeConfirmText({name: '합성 사업', child_count: 2});
  assert.match(text, /“합성 사업” 프로젝트를 영구 삭제할까요\?/);
  assert.match(text, /하위 프로젝트 2개도 지워집니다/);
  assert.match(text, /프로젝트 연결만 풀립니다/);
  assert.match(text, /되돌릴 수 없습니다/);
  assert.doesNotMatch(purgeConfirmText({name: 'a', child_count: 0}), /하위 프로젝트 0개/);
});

test('보관 단추 이름과 처음 탭', () => {
  assert.equal(archiveButtonLabel({archived: 1, trashCount: 0, trash: TRASH_STATE.MISSING}), '보관 1');
  assert.equal(archiveButtonLabel({archived: 0, trashCount: 0, trash: TRASH_STATE.READY}), '');
  assert.equal(archiveButtonLabel({archived: 0, trashCount: 2, trash: TRASH_STATE.READY}), '휴지통 2');
  assert.equal(archiveButtonLabel({archived: 3, trashCount: 2, trash: TRASH_STATE.READY}), '보관 3 · 휴지통 2');
  assert.equal(archiveButtonLabel({archived: 0, trashCount: 2, trash: TRASH_STATE.FAILED}), '');
  assert.equal(firstArchiveTab({archived: 2}), 'archive');
  assert.equal(firstArchiveTab({archived: 0}), 'trash');
});

test('화면 코드: 판정은 한 곳, 브라우저 저장소·땜질 없음, 바로 지우던 연결 끊기 요청 없음', () => {
  const js = readFileSync(new URL('../app/project-system-v3.js', import.meta.url), 'utf8');
  const start = js.indexOf('async function openDelete');
  const end = js.indexOf('async function archiveProject');
  const del = js.slice(start, end);
  assert.match(del, /deleteDialogText/);
  // 브라우저 저장소 낱말은 저장소 감사(browser-storage-audit)에 걸리지 않게 조각으로 만든다.
  const deviceStore = new RegExp(['local', 'session'].map(w => w + 'Storage').concat(['indexed' + 'DB']).join('|'));
  assert.doesNotMatch(del, deviceStore);
  const trashPart = js.slice(js.indexOf('function trashSig'), js.indexOf('async function restoreArchive'));
  assert.doesNotMatch(trashPart, deviceStore);
  assert.doesNotMatch(trashPart, /MutationObserver|setTimeout|display\s*[:=]\s*['"]?none/);
  assert.equal((js.match(/rpc\/app_trash_list/g) || []).length, 1, '목록 호출은 refreshTrash 한 곳');
  assert.doesNotMatch(js, /async function unlink\(/);
  for (const name of ['app_trash_restore', 'app_trash_purge']) assert.ok(js.includes(name), name);
});
