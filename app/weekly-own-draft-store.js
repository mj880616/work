// WEEKLY-내양식자유변형 ④-2: '내 양식' 그 주 초안에서 고친 항목 서버 저장(app_weekly_own_drafts, 20261116013000 — owner RLS, 작업공간·주마다 한 행).
// 읽기(이번 주 + 지난주 — '지난주 글 그대로')·처음 넣기·읽은 판(updated_at) 조건 고치기. 0행이면 그사이 다른 기기가 고친 것 → {conflict, row}.
// 표가 아직 없으면(404·42P01·PGRST205) {missing:true}. 브라우저 저장소에 아무것도 두지 않는다. 로그·오류에 보고 글을 쓰지 않는다.
import {cleanSaved, prevWeek} from './weekly-own-draft-model.mjs';

const TABLE = '/rest/v1/app_weekly_own_drafts';
const SELECT = 'select=id,week_start,sections,updated_at';
const encode = encodeURIComponent;

export const OWN_DRAFT_TEXT = Object.freeze({
  help: '노란 칸 = 이번 주 기록에서 채운 곳 · 칸을 눌러 수정',
  saved: '저장했어요.',
  conflict: '다른 기기에서 먼저 수정했어요. 새로 불러온 글을 확인해 주세요.',
  failed: '저장하지 못했어요. 잠시 뒤 다시 해 주세요.',
  readFailed: '수정한 글을 불러오지 못했어요. 지금은 수정할 수 없어요.',
  notReady: '초안 수정 저장은 준비 중이에요.',
});

const workspaceOf = rt => {
  const id = rt.context.read()?.workspace?.id;
  if (!id) throw new Error('업무 공간을 확인할 수 없어요.');
  return id;
};
export const missingTable = e => e?.status === 404 || /42P01|PGRST205|app_weekly_own_drafts/.test(String(e?.code ?? '') + String(e?.message ?? ''));
const rowOf = row => (row && typeof row === 'object'
  ? {id: row.id, week_start: String(row.week_start ?? ''), sections: cleanSaved(row.sections), updated_at: row.updated_at ?? null}
  : null);

// → {missing:false, row|null, last|null} | {missing:true}
export async function readOwnDrafts(start, rt = window.KPTURuntime) {
  const prev = prevWeek(start);
  let rows;
  try { rows = await rt.api(`${TABLE}?workspace_id=eq.${encode(workspaceOf(rt))}&week_start=in.(${encode(prev)},${encode(start)})&${SELECT}`, {singleFlight: false}); }
  catch (error) { if (missingTable(error)) return {missing: true, row: null, last: null}; throw error; }
  if (!Array.isArray(rows)) throw new Error('read');
  const of = day => rowOf(rows.find(r => String(r?.week_start ?? '').slice(0, 10) === day));
  return {missing: false, row: of(start), last: of(prev)};
}

// known: 마지막으로 읽은/쓴 이번 주 행(없으면 처음 넣기). → {ok, row} | {conflict, row} | {missing:true}
export async function saveOwnDraft({known, start, sections}, rt = window.KPTURuntime) {
  const workspace = workspaceOf(rt), body = {sections: cleanSaved(sections)};
  try {
    if (!known?.id) {
      const rows = await rt.api(`${TABLE}?${SELECT}`, {method: 'POST', prefer: 'return=representation', body: {workspace_id: workspace, week_start: start, ...body}});
      if (Array.isArray(rows) && rows.length === 1) return {ok: true, row: rowOf(rows[0])};
    } else {
      const guard = known.updated_at ? `updated_at=eq.${encode(known.updated_at)}` : 'updated_at=is.null';
      const rows = await rt.api(`${TABLE}?workspace_id=eq.${encode(workspace)}&id=eq.${encode(known.id)}&${guard}&${SELECT}`, {method: 'PATCH', prefer: 'return=representation', body});
      if (Array.isArray(rows) && rows.length === 1) return {ok: true, row: rowOf(rows[0])};
    }
  } catch (error) {
    if (missingTable(error)) return {missing: true};
    if (known?.id || error?.status !== 409) throw error;
  }
  const again = await readOwnDrafts(start, rt);
  return {conflict: true, row: again.row ?? null};
}
