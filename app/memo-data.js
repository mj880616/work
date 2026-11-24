// S69-94 NOTE-메모통일: 메모 표(public.app_memos, migration 20261125030000) 읽기·쓰기. 기존 owner-RLS REST 길(rt.api)만 쓴다. 기기 저장 없음.
// 새 표가 아직 없으면(DB 적용 전, PostgREST 404/PGRST205) 옛 노트 댓글 표(app_note_comments)를 메모 모양으로 읽는다 — legacy:true.
// 그때는 노트 메모만 남기기·지우기가 되고(옛 표 그대로), 고치기와 노트 밖 메모는 '준비 중'(화면이 legacy를 보고 정한다). 적용하면 옛 댓글은 새 표로 옮겨져 있다.
import {fromNoteComment, MEMO_OPEN} from './memo-model.mjs';

const ws = rt => { const id = rt.context.read()?.workspace?.id; if (!id) throw new Error('작업공간을 확인하지 못했어요.'); return id; };
const FIELDS = 'id,target_type,target_id,target_title,body,quote,kind,created_at,updated_at';
const OLD_FIELDS = 'id,note_id,kind,quote,body,created_at';
const enc = encodeURIComponent;
const missing = error => /404|PGRST205|42P01|app_memos|app_note_comments/.test(`${error?.status || ''} ${error?.code || ''} ${error?.message || ''}`);

export async function readMemos(rt = window.KPTURuntime) {
  const w = ws(rt);
  try {
    const rows = await rt.api(`/rest/v1/app_memos?workspace_id=eq.${enc(w)}&select=${FIELDS}&order=created_at.desc,id.desc&limit=10000`, {singleFlight: false});
    return {ready: true, legacy: false, memos: Array.isArray(rows) ? rows : []};
  } catch (error) {
    if (!missing(error)) return {ready: false, legacy: false, memos: [], missing: false};
  }
  try {
    const rows = await rt.api(`/rest/v1/app_note_comments?workspace_id=eq.${enc(w)}&select=${OLD_FIELDS}&order=created_at.desc,id.desc&limit=5000`, {singleFlight: false});
    return {ready: true, legacy: true, memos: (Array.isArray(rows) ? rows : []).map(fromNoteComment)};
  } catch (error) {
    return {ready: false, legacy: false, memos: [], missing: missing(error)};
  }
}

// 남기기. legacy면 노트 메모만(옛 표 — 종류는 표 기본값 생각).
export async function addMemo({target_type, target_id, target_title = null, body, quote = null, kind = null}, {legacy = false} = {}, rt = window.KPTURuntime) {
  const w = ws(rt);
  if (legacy) {
    if (target_type !== 'note') throw new Error('메모는 준비 중이에요.');
    const rows = await rt.api('/rest/v1/app_note_comments?select=' + OLD_FIELDS, {method: 'POST', prefer: 'return=representation', body: {workspace_id: w, note_id: target_id, kind: kind || 'thought', quote, body}});
    if (!Array.isArray(rows) || rows.length !== 1) throw new Error('메모를 저장하지 못했어요.');
    return fromNoteComment(rows[0]);
  }
  const rows = await rt.api('/rest/v1/app_memos?select=' + FIELDS, {method: 'POST', prefer: 'return=representation',
    body: {workspace_id: w, target_type, target_id, target_title, body, ...(quote ? {quote} : {}), ...(kind ? {kind} : {})}});
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error('메모를 저장하지 못했어요.');
  return rows[0];
}

// 고치기: 글만(대상·시각은 그대로, 고친 시각만 새로).
export async function updateMemo(id, body, rt = window.KPTURuntime) {
  const rows = await rt.api(`/rest/v1/app_memos?id=eq.${enc(id)}&workspace_id=eq.${enc(ws(rt))}&select=${FIELDS}`, {method: 'PATCH', prefer: 'return=representation', body: {body, updated_at: new Date().toISOString()}});
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error('메모를 수정하지 못했어요.');
  return rows[0];
}

export async function deleteMemo(id, {legacy = false} = {}, rt = window.KPTURuntime) {
  const table = legacy ? 'app_note_comments' : 'app_memos';
  const rows = await rt.api(`/rest/v1/${table}?id=eq.${enc(id)}&workspace_id=eq.${enc(ws(rt))}&select=id`, {method: 'DELETE', prefer: 'return=representation'});
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error('메모를 삭제하지 못했어요.');
}

// 원문이 아직 있나(MEMO_OPEN 표의 check 표, id만 읽음 — 기존 RLS 그대로). 돌려줌 Set(있는 id). 읽지 못하면 null(모름 — 링크는 켜 둔다).
// S69-95: 작업공간 칸이 있는 표(own)는 내 작업공간 것만, 휴지통 조건(live)이 있는 표는 휴지통에 든 원문을 없는 것으로 본다(MEMO_OPEN 표).
export async function existingTargets(type, ids, rt = window.KPTURuntime) {
  const how = MEMO_OPEN[type], table = how?.check, want = [...new Set(ids || [])];
  if (!table || !want.length) return null;
  const out = new Set();
  try {
    for (let i = 0; i < want.length; i += 100) {
      const part = want.slice(i, i + 100).map(enc).join(',');
      const scope = `${how.own ? `&workspace_id=eq.${enc(ws(rt))}` : ''}${how.live ? `&${how.live}` : ''}`;
      const rows = await rt.api(`/rest/v1/${table}?id=in.(${part})${scope}&select=id&limit=100`, {singleFlight: false});
      for (const r of Array.isArray(rows) ? rows : []) if (r?.id) out.add(r.id);
    }
  } catch { return null; }
  return out;
}
