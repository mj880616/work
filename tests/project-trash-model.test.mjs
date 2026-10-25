import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// TRASH-삭제휴지통 2단계: 휴지통 판정·문구·오류 변환 규칙. 이름은 모두 가짜다.
import {
  TRASH_STATE, TRASH_TEXT, classifyTrashError, classifyTrashList, normalizeTrashRows,
  deleteDialogText, trashErrorText, purgeConfirmText, archiveButtonLabel, firstArchiveTab,
  TRASH_KINDS, NOTE_TRASH_EVENT, noteTrashConfirmText, noteTrashedText, TRASH_KIND_LABEL, mergeTrashStates, otherDeleteText, otherDeleteBlockedText, restoredText, parentFirstText, missingOrganizationLabel,
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

// ---- TRASH-화면2: 담당조직·사업 보고 ----
test('DB 적용 전: 옛 함수가 담당조직·사업 보고 종류를 거절하면(TRASH_KIND_UNKNOWN) 준비 중, 프로젝트에서는 실패', () => {
  const unknown = {status: 400, code: '22023', message: 'TRASH_KIND_UNKNOWN'};
  assert.equal(classifyTrashError(unknown, 'organization'), TRASH_STATE.MISSING);
  assert.equal(classifyTrashError(unknown, 'report'), TRASH_STATE.MISSING);
  assert.equal(classifyTrashError(unknown, 'project'), TRASH_STATE.FAILED);
  assert.equal(classifyTrashError(unknown), TRASH_STATE.FAILED);
  assert.equal(classifyTrashError({status: 500, message: 'boom'}, 'report'), TRASH_STATE.FAILED);
  assert.equal(classifyTrashError({status: 404, message: 'x'}, 'organization'), TRASH_STATE.MISSING);
});

test('종류별 줄 정리: 담당조직·사업 보고 이름, 종류 걸러내기', () => {
  const data = [
    {kind: 'project', id: 'p1', name: '합성 사업', deleted_at: '2026-10-20T01:00:00Z'},
    {kind: 'organization', id: 'o1', name: ' 합성 조직 ', deleted_at: '2026-10-25T01:00:00Z'},
    {kind: 'report', id: 'r1', title: '합성 보고', series_name: '합성 회의', round_no: 3, deleted_at: '2026-10-24T01:00:00Z'},
    {kind: 'report', id: 'r2', title: '제목만', series_name: null, round_no: null, deleted_at: '2026-10-23T01:00:00Z'},
    {kind: 'report', id: 'r3', title: '', deleted_at: '2026-10-22T01:00:00Z'},
    {kind: 'library_folder', id: 'f1', name: ' 합성 폴더 ', project_name: '합성 사업', child_count: 2, file_count: 3, deleted_at: '2026-10-25T05:00:00Z'},
    {kind: 'other', id: 'x1', name: '모르는 종류'},
  ];
  assert.deepEqual(TRASH_KINDS, ['project', 'organization', 'report', 'library_folder', 'note']);
  assert.deepEqual(normalizeTrashRows(data, 'library_folder').map((r) => [r.id, r.name, r.kind, r.project_name, r.child_count, r.file_count]), [['f1', '합성 폴더', 'library_folder', '합성 사업', 2, 3]]);
  assert.deepEqual(normalizeTrashRows(data, 'organization').map((r) => [r.id, r.name, r.kind]), [['o1', '합성 조직', 'organization']]);
  const reports = normalizeTrashRows(data, 'report');
  assert.deepEqual(reports.map((r) => r.name), ['합성 회의 3회', '제목만', '이름 없는 사업 보고']);
  assert.deepEqual(normalizeTrashRows(data, null).map((r) => r.id), ['f1', 'o1', 'r1', 'r2', 'r3', 'p1']);
  assert.deepEqual(normalizeTrashRows(data).map((r) => r.id), ['p1'], '종류를 안 주면 예전처럼 프로젝트만');
});

test('종류별 상태 합치기: 하나라도 ready면 휴지통을 열고, 모두 준비 중이면 준비 중', () => {
  const S = TRASH_STATE;
  assert.equal(mergeTrashStates({project: S.READY, organization: S.MISSING, report: S.MISSING}), S.READY);
  assert.equal(mergeTrashStates({project: S.MISSING, organization: S.MISSING, report: S.MISSING}), S.MISSING);
  assert.equal(mergeTrashStates({project: S.FAILED, organization: S.MISSING, report: S.MISSING}), S.FAILED);
  assert.equal(mergeTrashStates({project: S.READY, organization: S.UNKNOWN}), S.UNKNOWN);
  assert.equal(mergeTrashStates({}), S.UNKNOWN);
});

test('담당조직·사업 보고 삭제 글: 휴지통으로, 준비 중이면 삭제할 수 없다고 알림', () => {
  const org = otherDeleteText('organization', '합성 조직');
  assert.match(org.confirm, /“합성 조직” 담당조직을 휴지통으로 옮길까요\?/);
  assert.match(org.confirm, /휴지통에서 되돌릴 수 있습니다/);
  assert.doesNotMatch(org.confirm, /삭제할까요/);
  const report = otherDeleteText('report', '합성 보고');
  assert.match(report.confirm, /사업 보고를 휴지통으로 옮길까요/);
  assert.match(report.confirm, /Google 할 일에 남고 자료 파일은 삭제하지 않습니다/);
  assert.match(otherDeleteBlockedText('organization', TRASH_STATE.MISSING), /담당조직 휴지통은 준비 중입니다.*삭제할 수 없습니다/);
  assert.match(otherDeleteBlockedText('report', TRASH_STATE.MISSING), /사업 보고 휴지통은 준비 중/);
  assert.match(otherDeleteBlockedText('report', TRASH_STATE.FAILED), /확인하지 못해 삭제하지 않았습니다/);
});

test('자료실 폴더 삭제 글: 휴지통으로, 아래 폴더·자료 수를 알리고, 준비 중이면 삭제할 수 없다고 알림', () => {
  const plain = otherDeleteText('library_folder', '합성 폴더');
  assert.match(plain.confirm, /“합성 폴더” 폴더를 휴지통으로 옮길까요\?/);
  assert.doesNotMatch(plain.confirm, /함께 들어가고/);
  const withInside = otherDeleteText('library_folder', '합성 폴더', {folders: 2, files: 5});
  assert.match(withInside.confirm, /아래 폴더 2개·자료 5개도 함께 들어가고, 자료는 자료실 목록에서 함께 숨습니다/);
  assert.match(withInside.confirm, /자료와 Drive 파일은 지워지지 않고, 휴지통에서 되돌리면 원래대로/);
  assert.doesNotMatch(withInside.confirm, /삭제할까요|한 단 위/);
  assert.equal(withInside.moved, '폴더를 휴지통으로 옮겼습니다.');
  assert.match(otherDeleteText('library_folder', '합성', {folders: 0, files: 1}).confirm, /자료 1개도 함께/);
  assert.match(otherDeleteBlockedText('library_folder', TRASH_STATE.MISSING), /자료실 폴더 휴지통은 준비 중입니다.*삭제할 수 없습니다/);
  assert.match(purgeConfirmText({kind: 'library_folder', name: '합성 폴더', child_count: 1, file_count: 4}), /“합성 폴더” 폴더를 영구 삭제할까요.*안의 아래 폴더 1개·자료 4개는 한 단 위로 올라갑니다.*Drive 파일은 지우지 않으며/s);
  assert.match(purgeConfirmText({kind: 'library_folder', name: '합성', child_count: 0, file_count: 0}), /안의 것은 한 단 위로/);
  assert.equal(restoredText('library_folder'), '폴더를 되돌렸습니다.');
  assert.equal(parentFirstText('library_folder'), '상위 폴더를 먼저 되돌려 주세요.');
  assert.equal(parentFirstText('project'), TRASH_TEXT.PARENT_FIRST);
  assert.equal(trashErrorText({message: 'LIB_FOLDER_DEPTH: folders are limited to 3 levels'}), TRASH_TEXT.FOLDER_DEPTH);
  assert.equal(trashErrorText({message: 'TRASH_PARENT_IN_TRASH'}), TRASH_TEXT.PARENT_FIRST);
  assert.equal(mergeTrashStates({project: TRASH_STATE.READY, organization: TRASH_STATE.READY, report: TRASH_STATE.READY, library_folder: TRASH_STATE.MISSING}), TRASH_STATE.READY);
});

test('영구 삭제 확인·되돌림 글은 종류마다 맞고, 같은 이름 충돌은 일상어', () => {
  assert.match(purgeConfirmText({kind: 'organization', name: '합성 조직'}), /“합성 조직” 담당조직을 영구 삭제할까요.*되돌릴 수 없습니다/s);
  assert.match(purgeConfirmText({kind: 'report', name: '합성 보고'}), /“합성 보고” 사업 보고를 영구 삭제할까요.*Google 할 일/s);
  assert.match(purgeConfirmText({kind: 'project', name: '합성', child_count: 1}), /프로젝트를 영구 삭제할까요/);
  assert.equal(restoredText('organization'), '담당조직을 되돌렸습니다.');
  assert.equal(restoredText('report'), '사업 보고를 되돌렸습니다.');
  assert.equal(restoredText('project'), TRASH_TEXT.RESTORED);
  assert.equal(trashErrorText({code: '23505', message: 'duplicate key value violates unique constraint'}), TRASH_TEXT.NAME_TAKEN);
  assert.match(TRASH_TEXT.NAME_TAKEN, /같은 이름이 이미 있어/);
  assert.equal(missingOrganizationLabel(true), '휴지통의 담당조직');
  assert.equal(missingOrganizationLabel(false), '담당조직');
});

test('화면 코드: 조직·보고 삭제는 공용 동작 한 곳, 준비 중이면 DELETE를 보내지 않는 순서, 브라우저 저장소 없음', () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const actions = read('../app/trash-actions.js');
  const deviceStore = new RegExp(['local', 'session'].map((w) => w + 'Storage').concat(['indexed' + 'DB']).join('|'));
  assert.doesNotMatch(actions, deviceStore);
  // 목록 확인(READY) -> 확인창 -> 삭제 요청 -> 목록으로 다시 확인 순서.
  const iList = actions.indexOf('readTrashKind(kind, rt)'), iAsk = actions.indexOf('ask(text.confirm)'), iRemove = actions.indexOf('await remove()');
  assert.ok(iList > 0 && iList < iAsk && iAsk < iRemove, '확인 순서');
  assert.match(actions, /first\.state !== TRASH_STATE\.READY/);
  for (const [file, kind] of [['../app/suborganizations.js', 'organization'], ['../app/meeting-round-detail.js', 'report'], ['../app/library-folders.js', 'library_folder']]) {
    const js = read(file);
    assert.ok(js.includes(`deleteToTrash({kind:'${kind}'`), file);
    assert.doesNotMatch(js, /담당조직을 삭제할까요|사업 보고를 삭제할까요|폴더를 지울까요/, file);
  }
});

test('노트·업데이트 줄: 이름은 노트 제목·업데이트 본문 앞부분, 종류·첨부·연결 수를 함께 준다', () => {
  const rows = normalizeTrashRows([
    {kind: 'note', id: 'n1', note_kind: 'note', title: ' 합성 노트 ', preview: '본문', file_count: 1, link_count: 2, deleted_at: '2026-10-26T02:00:00Z'},
    {kind: 'note', id: 'n2', note_kind: 'basket', title: null, preview: '합성 업데이트 본문', file_count: 0, link_count: 0, deleted_at: '2026-10-26T03:00:00Z'},
    {kind: 'note', id: 'n3', note_kind: 'basket', title: null, preview: '', file_count: 2, deleted_at: '2026-10-26T01:00:00Z'},
    {kind: 'note', id: 'n4', note_kind: 'basket', preview: '', file_count: 0, deleted_at: '2026-10-25T01:00:00Z'},
    {kind: 'project', id: 'p1', name: '합성 프로젝트'},
  ], 'note');
  assert.deepEqual(rows.map((r) => [r.id, r.name, r.note_kind, r.file_count, r.link_count]), [
    ['n2', '합성 업데이트 본문', 'basket', 0, 0], ['n1', '합성 노트', 'note', 1, 2], ['n3', '첨부만 있는 업데이트', 'basket', 2, 0], ['n4', '내용 없음', 'basket', 0, 0]]);
  assert.equal(NOTE_TRASH_EVENT, 'kptu:note-trash-changed');
  assert.equal(TRASH_KIND_LABEL.note, '노트·업데이트');
  assert.equal(restoredText('note'), TRASH_TEXT.UNDO_DONE);
});

test('노트·업데이트 글: 확인창은 연결·첨부가 지워지지 않는다고 알리고, 영구 삭제는 연결이 함께 지워진다고 알린다', () => {
  assert.equal(noteTrashConfirmText({places: 2, otherLinks: 1, attachments: 3}, '업데이트'),
    '업데이트를 휴지통으로 옮깁니다. 연결된 조직·프로젝트 2곳과 사업 보고·자료실 연결 1곳은 지워지지 않고, 휴지통에 있는 동안 보이지 않습니다. 첨부 파일 3개는 Drive에 그대로 남습니다. 휴지통에서 되돌릴 수 있습니다.');
  assert.equal(noteTrashConfirmText({places: 0, otherLinks: 0, attachments: 0}, '노트'), '노트를 휴지통으로 옮깁니다. 휴지통에서 되돌릴 수 있습니다.');
  assert.equal(noteTrashedText('노트'), '노트를 휴지통으로 옮겼습니다.');
  const purge = purgeConfirmText({kind: 'note', name: '합성', note_kind: 'basket', link_count: 2});
  assert.match(purge, /“합성” 업데이트를 영구 삭제할까요/);
  assert.match(purge, /연결 2곳도 함께 지워집니다/);
  assert.match(purge, /첨부 파일은 Drive에 그대로 남습니다/);
  assert.match(purgeConfirmText({kind: 'note', name: '합성', note_kind: 'note', link_count: 0}), /노트를 영구 삭제/);
  // DB 적용 전(옛 함수)에는 노트·업데이트도 '준비 중'이라 삭제를 보내지 않는다.
  assert.equal(classifyTrashError(Object.assign(new Error('TRASH_KIND_UNKNOWN'), {status: 400}), 'note'), TRASH_STATE.MISSING);
  assert.match(otherDeleteBlockedText('note', TRASH_STATE.MISSING), /노트·업데이트 휴지통은 준비 중입니다/);
});
