// TRASH-화면2: 담당조직·사업 보고 [삭제]를 휴지통으로 보내는 공용 동작(두 화면이 함께 쓴다). TRASH-다른삭제 3단계: 자료실 폴더 [폴더 지우기]도 같은 흐름이다.
// 상태 판단은 app_trash_list(종류) 한 번의 결과뿐이다. 함수가 그 종류를 모르면(DB 적용 전) '준비 중'을 알리고 삭제 요청을 보내지 않는다.
// 서버 쪽 삭제 가로채기 트리거가 DELETE를 휴지통 표시로 바꾼다. 화면은 그 결과를 app_trash_list로 확인한 뒤에만 안내한다. 브라우저 저장소는 쓰지 않는다.
import {TRASH_STATE, TRASH_TEXT, otherDeleteText, otherDeleteBlockedText} from './project-trash-model.mjs';
import {offerUndoNotice} from './basket-record-delete.js';

// 휴지통 목록·되돌리기 호출은 trash-rpc.js 한 곳에 있다(basket-record-delete.js도 쓰는데, 이 파일이 그쪽을 불러오므로 서로 불러오지 않게 따로 뒀다).
import {readTrashKind, restoreFromTrashKind} from './trash-rpc.js';
export {readTrashKind, restoreFromTrashKind};

// kind: 'organization' | 'report' | 'library_folder'.  id: 지울 행.  name: 확인창에 보일 이름.  detail: 확인창 글에 쓸 덧붙임(폴더: {folders, files}).
// remove(): 기존 [삭제] 요청(DELETE) 그대로. afterChange(): 목록 다시 읽기. 화면이 이미 바뀌었으면 isCurrent()가 false.
// 반환 status: 'moved'(목록으로 확인) | 'cancelled' | 'blocked'(준비 중·확인 실패, 삭제 요청 없음) | 'unconfirmed' | 'failed'
export async function deleteToTrash({kind, id, name, detail = null, remove, afterChange = async () => {}, notify = () => {}, closeBefore = () => {}, rt = window.KPTURuntime, ask = (text) => window.confirm(text)}) {
  const first = await readTrashKind(kind, rt);
  if (first.state !== TRASH_STATE.READY) {
    notify(otherDeleteBlockedText(kind, first.state));
    return {status: 'blocked', state: first.state};
  }
  const text = otherDeleteText(kind, name, detail);
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

