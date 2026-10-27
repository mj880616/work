// 휴지통 목록·되돌리기 호출 두 가지(TRASH-화면2). 상태 판단은 app_trash_list(종류) 한 번의 결과뿐이다.
// trash-actions.js(deleteToTrash)와 basket-record-delete.js(노트·업데이트 [지우기])가 함께 쓴다. 브라우저 저장소는 쓰지 않는다.
import {TRASH_TEXT, classifyTrashError, classifyTrashList, normalizeTrashRows, trashErrorText} from './project-trash-model.mjs';

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
