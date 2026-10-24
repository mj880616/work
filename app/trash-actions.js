// TRASH-화면2: 담당조직·사업 보고 [삭제]를 휴지통으로 보내는 공용 동작(두 화면이 함께 쓴다).
// 상태 판단은 app_trash_list(종류) 한 번의 결과뿐이다. 함수가 그 종류를 모르면(DB 적용 전) '준비 중'을 알리고 삭제 요청을 보내지 않는다.
// 서버 쪽 삭제 가로채기 트리거가 DELETE를 휴지통 표시로 바꾼다. 화면은 그 결과를 app_trash_list로 확인한 뒤에만 안내한다. 브라우저 저장소는 쓰지 않는다.
import {TRASH_STATE, TRASH_TEXT, classifyTrashError, classifyTrashList, normalizeTrashRows, otherDeleteText, otherDeleteBlockedText, trashErrorText} from './project-trash-model.mjs';
import {offerUndoNotice} from './basket-record-delete.js';

const rpc = (rt, fn, body) => rt.api(`/rest/v1/rpc/${fn}`, {method: 'POST', body, singleFlight: false});

export async function readTrashKind(kind, rt = window.KPTURuntime) {
  try {
    const data = await rpc(rt, 'app_trash_list', {p_kind: kind});
    return {state: classifyTrashList(data), rows: normalizeTrashRows(data, kind)};
  } catch (error) {
    return {state: classifyTrashError(error, kind), rows: []};
  }
}

export async function restoreFromTrashKind(kind, id, rt = window.KPTURuntime) {
  try {
    await rpc(rt, 'app_trash_restore', {p_kind: kind, p_id: id});
    return {ok: true};
  } catch (error) {
    return {ok: false, message: trashErrorText(error, TRASH_TEXT.UNDO_FAILED)};
  }
}

// kind: 'organization' | 'report'.  id: 지울 행.  name: 확인창에 보일 이름.
// remove(): 기존 [삭제] 요청(DELETE) 그대로. afterChange(): 목록 다시 읽기. 화면이 이미 바뀌었으면 isCurrent()가 false.
// 반환 status: 'moved'(목록으로 확인) | 'cancelled' | 'blocked'(준비 중·확인 실패, 삭제 요청 없음) | 'unconfirmed' | 'failed'
export async function deleteToTrash({kind, id, name, remove, afterChange = async () => {}, notify = () => {}, closeBefore = () => {}, rt = window.KPTURuntime, ask = (text) => window.confirm(text)}) {
  const first = await readTrashKind(kind, rt);
  if (first.state !== TRASH_STATE.READY) {
    notify(otherDeleteBlockedText(kind, first.state));
    return {status: 'blocked', state: first.state};
  }
  const text = otherDeleteText(kind, name);
  if (!ask(text.confirm)) return {status: 'cancelled'};
  try {
    await remove();
  } catch (error) {
    return {status: 'failed', error};
  }
  const after = await readTrashKind(kind, rt);
  const landed = after.state === TRASH_STATE.READY && !!id && after.rows.some((row) => row.id === id);
  closeBefore();
  try { await afterChange(); } catch { /* 목록 다시 읽기 실패는 다음 읽기 때 맞춰진다 */ }
  if (!landed) {
    notify(TRASH_TEXT.NOT_CONFIRMED);
    return {status: 'unconfirmed'};
  }
  offerUndoNotice({
    text: text.moved,
    onUndo: async () => {
      const result = await restoreFromTrashKind(kind, id, rt);
      if (!result.ok) return {status: 'failed', message: result.message};
      try { await afterChange(); } catch { /* 위와 같음 */ }
      return {status: 'restored', message: TRASH_TEXT.UNDO_DONE};
    },
  });
  return {status: 'moved', id};
}

