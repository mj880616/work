// S71-68 ② READ-원문고치기: 글 보기 '원문 전체' 직접 수정본 서버 읽기·쓰기 한 곳(화면 now-detail.js가 쓴다). 모양 규칙은 body-edit-model.mjs.
// - 표 public.app_feed_body_edits: 작업공간 주인만(RLS — 주소에 내 작업공간을 걸고 서버 정책이 한 번 더 막는다. 남의 작업공간 줄은 읽을 길이 없다).
// - 넣기는 작업공간·글·블록·시각, 고치기는 블록·시각만(칸 권한). 처음 가져온 원문으로 돌아가기 = 내 줄 삭제.
// - 밑줄 삭제는 기존 밑줄 길(text-highlights.js — 자기 작업공간만)을 쓴다. 기기 저장 없음. 로그에 글자를 남기지 않는다.
import {workspaceOf} from './feed-shared.js';
import {sourceMarks, removeHighlight} from './text-highlights.js';
import {EDIT_TABLE, editCol, editRow} from './body-edit-model.mjs';

const T = `/rest/v1/${EDIT_TABLE}`;
const q = encodeURIComponent;
const rt = () => window.KPTURuntime;
const first = r => (Array.isArray(r) ? r[0] || null : null);
const where = item => { const col = editCol(item?.type), w = workspaceOf(); return col && w && item?.id ? `workspace_id=eq.${q(w)}&${col}=eq.${q(item.id)}` : ''; };

// 내 직접 수정본 한 줄(없으면 null). 표가 아직 없거나(적용 전) 잠깐 못 읽으면 null — 공용 원문을 그린다.
export async function readEdit(item) {
  const w = where(item);
  if (!w) return null;
  try { return first(await rt().api(`${T}?${w}&select=blocks,edited_at&limit=1`, {singleFlight: false})); } catch { return null; }
}
// 저장: 줄이 있으면 블록·시각만 고치고, 없으면 넣는다(같은 때 먼저 들어갔으면 다시 고치기).
export async function saveEdit(item, blocks) {
  const w = where(item), body = editRow(workspaceOf(), item, blocks);
  if (!w || !body) throw Object.assign(new Error('shape'), {status: 0});
  const patch = () => rt().api(`${T}?${w}&select=blocks,edited_at`, {method: 'PATCH', body: {blocks: body.blocks, edited_at: body.edited_at}, prefer: 'return=representation', singleFlight: false}).then(first);
  let row = await patch();
  if (!row) {
    try { row = first(await rt().api(`${T}?select=blocks,edited_at`, {method: 'POST', body, prefer: 'return=representation', singleFlight: false})); }
    catch (e) { if (e?.status !== 409) throw e; row = await patch(); }
  }
  if (!row) throw Object.assign(new Error('save'), {status: 0});
  return row;
}
// 처음 가져온 원문으로(내 줄 삭제).
export async function dropEdit(item) {
  const w = where(item);
  if (w) await rt().api(`${T}?${w}`, {method: 'DELETE', singleFlight: false});
}
export const marksOf = (type, id) => sourceMarks(type, id);
// 밑줄 여러 개 삭제. 답: 못 지운 수.
export async function dropMarks(list) {
  let failed = 0;
  for (const h of list || []) { try { await removeHighlight(h.id); } catch { failed++; } }
  return failed;
}
