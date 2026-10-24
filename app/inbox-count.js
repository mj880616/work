// BASKET-정리함이름: "정리 안 된 것 n건" = 업데이트 미분류 + 챙길 것 처리 전. The home card (next task, HOME-모바일홈채우기) and the
// 정리함 switch use these functions, so the number is counted in one place.
import {readBasket, visibleNotes} from './basket-data.js';
import {readOpenCandidates, notPlanned} from './todo-radar-data.js';

// 업데이트 미분류: the same rule as the [미분류] chip of the 정리함 (보류한 것은 세지 않는다).
export const unsortedUpdates = (notes, links, docs = []) => visibleNotes(notes || [], links || [], 'unclassified', docs || []).length;
// 챙길 것 처리 전: open candidates, minus what is already a task by title (todo-radar decision 5).
export const openTodos = (candidates, taskTitles = []) => notPlanned((candidates || []).filter(row => row?.status === 'open'), taskTitles).length;
export function inboxCount({notes, links, docs, candidates, taskTitles} = {}) {
  const update = unsortedUpdates(notes, links, docs), todo = openTodos(candidates, taskTitles);
  return {update, todo, total: update + todo};
}
// One read of both (a candidate table that is not deployed counts as 0). {ok:false} when either read fails.
export async function readInboxCount(rt = window.KPTURuntime, {taskTitles = []} = {}) {
  try {
    const [basket, open] = await Promise.all([readBasket(rt), readOpenCandidates(rt)]);
    if (!open.missing && !open.ok) return {ok: false};
    return {ok: true, ...inboxCount({notes: basket.notes, links: basket.links, docs: basket.docs, candidates: open.missing ? [] : open.rows, taskTitles})};
  } catch { return {ok: false}; }
}
