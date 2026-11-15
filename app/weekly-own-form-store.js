// WEEKLY-내양식자유변형 ②: '내 양식' 서버 저장(app_weekly_forms, 20261116003000 — owner RLS, 작업공간마다 하나).
// 읽기·처음 넣기·읽은 판(updated_at) 조건 고치기·지우기. 0행이면 그사이 다른 기기가 고친 것 → {conflict, row}(다시 읽은 서버 판).
// 표가 아직 없으면(404·42P01·PGRST205) {missing:true} — 화면은 지금처럼(백지 + 올리기 한 줄) 동작한다.
// 브라우저 저장소에 아무것도 두지 않는다. 로그·오류에 양식 글자를 쓰지 않는다.
import {cleanForm, formBytes, formName, FORM_MAX_BYTES} from './weekly-own-form-model.mjs';

const TABLE = '/rest/v1/app_weekly_forms';
const SELECT = 'select=id,name,source_name,source_file_id,form,updated_at';
const encode = encodeURIComponent;

// 화면 글(docs/design/ui-words.md). 다른 팀 양식 글자를 쓰지 않는다.
export const OWN_FORM_TEXT = Object.freeze({
  reading: '파일에서 양식을 읽는 중…',
  saved: '내 양식으로 저장했어요.',
  none: '파일에서 항목이나 표를 찾지 못했어요. 빈 양식에서 직접 만들 수 있어요.',
  unreadable: '파일을 열지 못했어요. 다시 선택해 주세요.',
  conflict: '다른 기기에서 양식을 먼저 고쳤어요. 다시 열어 주세요.',
  failed: '저장하지 못했어요. 잠시 뒤 다시 해 주세요.',
  tooBig: '양식이 너무 커요. 항목이나 칸을 줄여 주세요.',
  notReady: '양식 저장은 준비 중이에요.',
});

const workspaceOf = rt => {
  const id = rt.context.read()?.workspace?.id;
  if (!id) throw new Error('업무 공간을 확인할 수 없어요.');
  return id;
};
export const missingTable = e => e?.status === 404 || /42P01|PGRST205|app_weekly_forms/.test(String(e?.code ?? '') + String(e?.message ?? ''));
const rowOf = row => (row && typeof row === 'object'
  ? {id: row.id, name: String(row.name ?? ''), source_name: row.source_name ?? null, source_file_id: row.source_file_id ?? null, form: cleanForm(row.form), updated_at: row.updated_at ?? null}
  : null);

// → {missing:false, row|null} | {missing:true, row:null}
export async function readOwnForm(rt = window.KPTURuntime) {
  let rows;
  try { rows = await rt.api(`${TABLE}?workspace_id=eq.${encode(workspaceOf(rt))}&${SELECT}&limit=1`, {singleFlight: false}); }
  catch (error) { if (missingTable(error)) return {missing: true, row: null}; throw error; }
  if (!Array.isArray(rows)) throw new Error('read');
  return {missing: false, row: rowOf(rows[0])};
}

// known: 마지막으로 읽은/쓴 행(없으면 처음 넣기). → {ok, row} | {conflict, row} | {missing:true}. 크기 초과는 code 'too_big' 오류.
export async function saveOwnForm({known, name, sourceName = null, form}, rt = window.KPTURuntime) {
  const clean = cleanForm(form);
  if (formBytes(clean) > FORM_MAX_BYTES) throw Object.assign(new Error(OWN_FORM_TEXT.tooBig), {code: 'too_big'});
  const workspace = workspaceOf(rt);
  const body = {name: formName(name), source_name: sourceName ? String(sourceName).slice(0, 200) : null, form: clean};
  try {
    if (!known?.id) {
      const rows = await rt.api(`${TABLE}?${SELECT}`, {method: 'POST', prefer: 'return=representation', body: {workspace_id: workspace, ...body}});
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
  const again = await readOwnForm(rt);
  return {conflict: true, row: again.row};
}

// 내 양식 지우기(다시 백지).
export async function deleteOwnForm(rt = window.KPTURuntime) {
  await rt.api(`${TABLE}?workspace_id=eq.${encode(workspaceOf(rt))}`, {method: 'DELETE'});
}
