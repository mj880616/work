// ORG-기록첨부이름반영(S60-14): 첨부 이름을 고친 뒤(file-rename.js) 그 파일이 붙은 조직·사업·참고 기록 줄 글을 새 이름으로 맞춘다.
// - 서버(document-actions rename-file)는 Drive 원본·노트 첨부·할 일 첨부·자료 이름만 바꾸고, 기록 줄 글(app_record_links.summary)은 그대로 둔다.
//   줄 글이 첨부만 넣을 때 자동으로 만든 '그림 n장 · 이름'이면(record-file-line.mjs renamedRecordLine) 같은 모양에 새 이름으로 바꾼다.
//   AI가 쓴 줄, [요약 수정]으로 사람이 쓴 줄은 건드리지 않는다.
// - 쓰는 길은 요약 쓰기 하나(app_basket_update_link_summary — 읽은 옛 글과 같을 때만 씀, basket-link-records.js updateLinkSummary).
//   그사이 누가 요약을 바꿨으면 SUMMARY_CHANGED로 아무것도 바꾸지 않는다. 새 표·정책·함수 없음, 내 로그인으로만 읽고 쓴다.
// - 바꾼 줄은 'kptu:record-lines-renamed' {links:[{id, before, summary}]}로 알린다. 열려 있는 기록 목록은 자기 줄을 그 자리에서 다시 그린다(한 그리기 주인).
// - 실패는 조용히 지나간다(이름 바꾸기 결과는 이미 끝났고, 줄 글은 [요약 수정]으로 고칠 수 있다). 기기 저장 없음.
import { renamedRecordLine } from './record-file-line.mjs';
import { updateLinkSummary } from './basket-link-records.js';

const UUID = /^[0-9a-f-]{36}$/i;
const contextOf = rt => (typeof rt?.context?.read === 'function' ? rt.context.read() || {} : globalThis.window?.__KPTU_BOOT_CONTEXT__ || {});
const scopeOf = rt => { const c = contextOf(rt); return `${c?.user?.id || ''}:${c?.workspace?.id || ''}`; };

export async function syncRecordLines(detail, rt = globalThis.window?.KPTURuntime) {
  const ids = [...new Set((Array.isArray(detail?.notes) ? detail.notes : []).map(n => String(n?.id || '')).filter(id => UUID.test(id)))];
  if (!ids.length || !detail?.old_name || !detail?.name || detail.old_name === detail.name || !rt?.api) return [];
  const workspaceId = contextOf(rt)?.workspace?.id, owner = scopeOf(rt);
  if (!workspaceId) return [];
  const enc = encodeURIComponent;
  let rows;
  try {
    rows = await rt.api(`/rest/v1/app_record_links?workspace_id=eq.${enc(workspaceId)}&note_id=in.(${ids.map(enc).join(',')})&status=eq.confirmed&summary=not.is.null&select=id,workspace_id,summary,note_id,note:app_notes!inner(id,workspace_id,attachments)&note.workspace_id=eq.${enc(workspaceId)}&order=id.asc&limit=200`);
  } catch { return []; }
  if (owner !== scopeOf(rt) || !Array.isArray(rows)) return [];
  const changed = [];
  for (const row of rows) {
    if (row?.workspace_id !== workspaceId || row.note?.workspace_id !== workspaceId || row.note?.id !== row.note_id || !ids.includes(row.note_id)) continue;
    const next = renamedRecordLine(row.summary, row.note.attachments, detail);
    if (!next) continue;
    const result = await updateLinkSummary(row.id, row.summary, next, rt).catch(() => null);
    if (owner !== scopeOf(rt)) return changed;
    if (result?.ok === true) changed.push({id: row.id, before: row.summary, summary: next});
  }
  if (changed.length && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('kptu:record-lines-renamed', {detail: {links: changed}}));
  return changed;
}

