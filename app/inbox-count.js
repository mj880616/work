// BASKET-정리함이름: "정리 안 된 것 n건" = 업데이트 미분류 + 챙길 것 처리 전. The home card (next task, HOME-모바일홈채우기) and the
// 정리함 switch use these functions, so the number is counted in one place.
import {readBasket, visibleNotes} from './basket-data.js';
import {readOpenCandidates, notPlanned} from './todo-radar-data.js';

// 업데이트 미분류: the same rule as the [미분류] chip of the 정리함 (보류한 것은 세지 않는다).
export const unsortedUpdates = (notes, links, docs = []) => visibleNotes(notes || [], links || [], 'unclassified', docs || []).length;
// 챙길 것 처리 전: open candidates, minus what is already a task by title (todo-radar decision 5).
export const openTodos = (candidates, taskTitles = []) => notPlanned((candidates || []).filter(row => row?.status === 'open'), taskTitles).length;
// S52-20: 텔레그램 요청은 따로 세지 않는다 — 홈 '잊지 말기' 한 줄은 처리 전 후보 전부(요청 포함)를 같은 숫자로 센다.
export function inboxCount({notes, links, docs, candidates, taskTitles} = {}) {
  const update = unsortedUpdates(notes, links, docs), todo = openTodos(candidates, taskTitles);
  return {update, todo, total: update + todo};
}
// The two reads behind the count (정리함 업데이트 + 챙길 것 후보). PERF-첫로딩 요청 합치기(S48-59): the home starts them together with the
// journal's own basket read, so the runtime's single flight sends each basket page/link read once (same paths) instead of twice.
export const readInboxParts = (rt = window.KPTURuntime) => Promise.all([readBasket(rt), readOpenCandidates(rt)]);
// One read of both (a candidate table that is not deployed counts as 0). {ok:false} when either read fails.
// parts: reads already started with readInboxParts (the task titles that are subtracted are known only later).
export async function readInboxCount(rt = window.KPTURuntime, {taskTitles = [], parts = null} = {}) {
  try {
    const [basket, open] = await (parts || readInboxParts(rt));
    if (!open.missing && !open.ok) return {ok: false};
    const candidates = open.missing ? [] : open.rows;
    return {ok: true, ...inboxCount({notes: basket.notes, links: basket.links, docs: basket.docs, candidates, taskTitles})};
  } catch { return {ok: false}; }
}
