// FILE-첨부삭제(2026-11-10 사용자 결정): 첨부 줄 ⋯ [삭제] — 한 번 묻고, 그 기록에서 떼고 Drive 원본을 휴지통으로(완전 삭제 아님).
// 서버 한 곳: document-actions action=trash-file / restore-file(supabase/functions/document-actions/file-trash.ts).
//   서버가 내 로그인으로 그 기록을 다시 읽어 그 파일이 붙어 있는지 확인하고, 다른 줄이 같은 파일을 쓰면 Drive는 그대로 둔다.
// 지운 뒤에는 공용 '되돌리기' 알림(basket-record-delete.js offerUndoNotice — 다른 지우기와 같은 모양, PC Ctrl+Z도 같음).
//   [되돌리기] = Drive 휴지통에서 꺼내고 그 기록에 다시 붙인다(restore-file).
// [빼기](기록에서만 떼기)는 화면마다 원래 길 그대로 둔다. 기기 저장 없음.
import { askConfirm } from './small-notice.js';
import { offerUndoNotice } from './basket-record-delete.js';

export const FILE_TRASH_TEXT = Object.freeze({
  ASK_NOTE: 'Drive 휴지통으로 가요. 30일 안에 되살릴 수 있어요.',
  TRASHED: '삭제했어요',
  KEPT: '빼기만 했어요. 다른 곳에서도 쓰는 파일이라 Drive에 남겨 뒀어요.',
  NOT_OURS: '빼기만 했어요. 이 앱이 만든 파일이 아니라 Drive에는 그대로 있어요.',
  MISSING: '삭제했어요. Drive 원본은 이미 없었어요.',
  FAILED: '빼기만 했어요. Drive 휴지통으로 옮기지 못했어요.',
  RESTORED: '되돌렸어요',
  RESTORE_FAILED: '되돌리지 못했어요. 다시 열어 확인해 주세요.',
  FAILED_ALL: '삭제하지 못했어요. 다시 시도해 주세요.',
});

// 서버 답의 drive 값 → 알림 글. 'trashed' 말고는 Drive 원본이 휴지통에 가지 않았다는 뜻이다.
export function trashResultText(drive) {
  return {trashed:FILE_TRASH_TEXT.TRASHED, kept:FILE_TRASH_TEXT.KEPT, not_ours:FILE_TRASH_TEXT.NOT_OURS, missing:FILE_TRASH_TEXT.MISSING}[drive] || FILE_TRASH_TEXT.FAILED;
}
export const confirmDeleteText = name => `'${String(name || '파일')}' 파일을 삭제할까요?`;

const call = (rt, action, spec) => rt.api('/functions/v1/document-actions', {method:'POST', body:{action, target:spec.target, id:spec.id, drive_file_id:spec.driveId}, refreshSession:false, singleFlight:false});
// 서버가 이유를 말하면(400·409) 그 글, 아니면 기본 글. rt.api는 서버 답의 error 글을 오류 글로 준다(runtime-client.js).
const errorText = (e, fallback) => Number(e?.status) >= 400 && Number(e?.status) < 500 && typeof e?.message === 'string' && e.message ? e.message : fallback;

// spec = {target:'note', id, driveId, name}. onChanged({note:{id,updated_at}}|null) — 화면이 그 기록을 다시 읽어 그린다(한 그리기 주인).
// 돌려줌: {status:'cancel'} | {status:'deleted', drive} | {status:'failed', message}
export async function deleteAttachment(spec, {rt = globalThis.window?.KPTURuntime, anchor = globalThis.document?.activeElement, onChanged = () => {}, ask = askConfirm, undo = offerUndoNotice, toast = () => {}} = {}) {
  if (!spec?.id || !spec?.driveId || spec.target !== 'note') return {status:'failed', message:FILE_TRASH_TEXT.FAILED_ALL};
  const yes = await ask(anchor, {text:confirmDeleteText(spec.name), note:FILE_TRASH_TEXT.ASK_NOTE, ok:'삭제', danger:true});
  if (!yes) return {status:'cancel'};
  let data;
  try {
    data = await call(rt, 'trash-file', spec);
    if (!data || data.ok !== true || data.detached !== true || data.drive_file_id !== spec.driveId) throw Object.assign(new Error(''), {status:0});
  } catch (e) {
    await Promise.resolve(onChanged(null)).catch(() => {});
    return {status:'failed', message:errorText(e, FILE_TRASH_TEXT.FAILED_ALL)};
  }
  await Promise.resolve(onChanged({note:data.note || null})).catch(() => {});
  const text = trashResultText(data.drive);
  // 휴지통에 간 경우만 [되돌리기]를 단다(꺼내고 다시 붙이기). 그 밖에는 Drive가 그대로이므로 알림 한 줄만.
  if (data.drive === 'trashed') {
    undo({text, onUndo:async () => {
      try {
        const back = await call(rt, 'restore-file', spec);
        if (!back || back.ok !== true) throw Object.assign(new Error(''), {status:0});
        await Promise.resolve(onChanged({note:back.note || null})).catch(() => {});
        return {status:'restored', message:FILE_TRASH_TEXT.RESTORED};
      } catch (e) {
        await Promise.resolve(onChanged(null)).catch(() => {});
        return {status:'failed', message:errorText(e, FILE_TRASH_TEXT.RESTORE_FAILED)};
      }
    }});
  } else toast(text);
  return {status:'deleted', drive:data.drive};
}
