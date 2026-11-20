// S67-53 ORG-여러개삭제: 조직 관리 목록에서 선택한 담당조직 여러 곳을 한 번에 휴지통으로 옮기는 흐름(화면 그리기는 suborganizations.js가 한다).
// 새 삭제 길·권한을 만들지 않는다: 한 개 [삭제](trash-actions.js deleteToTrash)와 같은 owner RLS REST DELETE를 한 곳씩 차례로 보내고,
// 서버의 삭제 가로채기 트리거가 휴지통 표시로 바꾼다. 결과는 app_trash_list(organization) 한 번으로 확인하고, 되돌리기는 app_trash_restore로 한 곳씩.
// 확인 창에는 조직 수와 연결된 조직 보고 수(app_suborganization_updates, 같은 owner RLS 읽기)를 보인다. 브라우저 저장소는 쓰지 않는다.
import {TRASH_STATE, TRASH_TEXT, otherDeleteBlockedText} from './project-trash-model.mjs';
import {readTrashKind, restoreFromTrashKind} from './trash-rpc.js';
import {offerUndoNotice} from './basket-record-delete.js';
import {askConfirm} from './small-notice.js';
import {readRecordPages} from './basket-link-records.js';
import {deleteSequentially} from './library-select.js';
import {chunks, orgRecordCountPath, orgBulkConfirmText, orgBulkMovedText, orgBulkUndoText, ORG_PICK_TEXT} from './org-bulk-delete-model.mjs';

export async function countOrgRecords(ids, rt = window.KPTURuntime) {
  let total = 0;
  for (const part of chunks(ids)) total += (await readRecordPages(orgRecordCountPath(part), rt)).length;
  return total;
}

// ids: 선택한 담당조직 id들. afterChange(): 목록 다시 읽기. 반환 status: 'blocked' | 'cancelled' | 'unconfirmed' | 'moved'
// moved일 때 left = 옮기지 못한 id들(부르는 화면이 선택해 둔다).
export async function deleteOrgsToTrash({ids, rt = window.KPTURuntime, anchor = globalThis.document?.activeElement, notify = () => {}, afterChange = async () => {},
  ask = text => askConfirm(anchor, {text, ok: ORG_PICK_TEXT.DELETE, danger: true}), isCurrent = () => true}) {
  ids = [...new Set(ids)].filter(Boolean);
  if (!ids.length) return {status: 'cancelled'};
  const first = await readTrashKind('organization', rt);
  if (first.state !== TRASH_STATE.READY) { notify(otherDeleteBlockedText('organization', first.state)); return {status: 'blocked', state: first.state}; }
  let records;
  try { records = await countOrgRecords(ids, rt); } catch { notify(ORG_PICK_TEXT.COUNT_FAILED); return {status: 'blocked', state: 'count'}; }
  if (!(await ask(orgBulkConfirmText(ids.length, records)))) return {status: 'cancelled'};
  const sent = await deleteSequentially(ids, async id => {
    try { await rt.api(`/rest/v1/app_suborganizations?id=eq.${encodeURIComponent(id)}`, {method: 'DELETE'}); return {ok: true}; }
    catch (error) { return {ok: false, stop: error?.status === 401 || error?.status === 403}; }
  }, {isCurrent});
  const after = await readTrashKind('organization', rt);
  const inTrash = new Set(after.state === TRASH_STATE.READY ? after.rows.map(row => row.id) : []);
  const moved = sent.done.filter(id => inTrash.has(id)), left = ids.filter(id => !moved.includes(id));
  try { await afterChange(); } catch { /* 목록 다시 읽기 실패는 다음 읽기 때 맞춰진다 */ }
  if (!moved.length) { notify(TRASH_TEXT.NOT_CONFIRMED); return {status: 'unconfirmed', moved, left}; }
  offerUndoNotice({
    text: orgBulkMovedText(moved.length, left.length),
    onUndo: async () => {
      let back = 0, failed = 0;
      for (const id of moved) { const r = await restoreFromTrashKind('organization', id, rt); if (r.ok) back++; else failed++; }
      try { await afterChange(); } catch { /* 위와 같음 */ }
      return {status: back ? 'restored' : 'failed', message: orgBulkUndoText(back, failed)};
    },
  });
  return {status: 'moved', moved, left, records};
}
