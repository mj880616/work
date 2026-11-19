// ORG-기록첨부 옛줄바꾸기(S67-13): 기록 첨부(Drive 파일 id) → 그 파일로 들어간 자료 → 자료별 AI 요약 표의 'b1:' 설명 읽기.
// 내 로그인(owner RLS)·내 작업공간 것만 읽는다(작업공간 id를 함께 걸고, 돌아온 줄도 다시 확인). 글은 로그에 쓰지 않는다. 기기 저장 없음.
// - readFileBriefs(fileIds) → {briefs: Map 파일 id → 'b1:' 설명, docs: Map 파일 id → {id, mime_type, file_name, indexed(요약 행이 이미 있음)}}
// - markLineRevert(rows): 기록 목록 읽기(readLinkRecords withFiles)가 부른다. 사진 설명으로 바꾼 줄에만 row.line_revert = true
//   (⋯ [이전 줄로 되돌리기]). 읽기가 실패하면 표시 없이 그대로(목록은 깨지지 않음).
import { DRIVE_ID, canRevertLine, fileNameLine, isFileNameLine } from './record-line-backfill.mjs';
import { recordBody } from './business-now-model.mjs';

const UUID = /^[0-9a-f-]{36}$/i;
const BRIEF_HASH = /^b1:[0-9a-f]{32}$/;
const PART = 50;
const enc = encodeURIComponent;
const scopeOf = rt => { const c = ctxOf(rt); return `${c?.user?.id || ''}:${c?.workspace?.id || ''}`; };
const ctxOf = rt => (typeof rt?.context?.read === 'function' ? rt.context.read() || {} : globalThis.window?.__KPTU_BOOT_CONTEXT__ || {});
const parts = list => Array.from({ length: Math.ceil(list.length / PART) }, (_, i) => list.slice(i * PART, (i + 1) * PART));

export async function readFileBriefs(fileIds, rt = globalThis.window?.KPTURuntime) {
  const briefs = new Map(), docs = new Map();
  const ids = [...new Set((fileIds || []).map(String).filter(id => DRIVE_ID.test(id)))];
  const ws = ctxOf(rt)?.workspace?.id;
  if (!ids.length || !ws || !rt?.api) return { briefs, docs };
  const byDoc = new Map();
  for (const part of parts(ids)) {
    const rows = await rt.api(`/rest/v1/app_documents?workspace_id=eq.${enc(ws)}&file_id=in.(${part.map(enc).join(',')})&select=id,workspace_id,file_id,mime_type,file_name,created_at&order=created_at.asc,id.asc&limit=${part.length * 4}`);
    if (!Array.isArray(rows)) throw new Error('read');
    for (const d of rows) {
      if (d?.workspace_id !== ws || !UUID.test(String(d.id || '')) || !part.includes(String(d.file_id || ''))) continue;
      if (!byDoc.has(d.id)) byDoc.set(d.id, String(d.file_id));
      if (!docs.has(d.file_id)) docs.set(String(d.file_id), { id: d.id, mime_type: d.mime_type || '', file_name: d.file_name || '' });
    }
  }
  const docIds = [...byDoc.keys()];
  for (const part of parts(docIds)) {
    const rows = await rt.api(`/rest/v1/app_document_ai_index?workspace_id=eq.${enc(ws)}&document_id=in.(${part.map(enc).join(',')})&select=document_id,workspace_id,content_hash,summary&limit=${part.length + 1}`);
    if (!Array.isArray(rows)) throw new Error('read');
    for (const r of rows) {
      const fileId = byDoc.get(String(r?.document_id || ''));
      if (!fileId || r.workspace_id !== ws) continue;
      const doc = docs.get(fileId);
      if (doc && doc.id === r.document_id) doc.indexed = true; // 요약 행이 이미 있는 자료 — 서버 photo-brief가 건드리지 않음
      if (!BRIEF_HASH.test(String(r.content_hash || '')) || typeof r.summary !== 'string' || !r.summary.trim()) continue;
      if (!briefs.has(fileId)) briefs.set(fileId, r.summary);
    }
  }
  return { briefs, docs };
}

// 바꾼 줄 후보: 첨부가 있고, 줄 글이 대신 줄이 아닌 것만 묻는다(그 밖은 읽지 않음).
export async function markLineRevert(rows, rt = globalThis.window?.KPTURuntime) {
  const list = (Array.isArray(rows) ? rows : []).filter(r => typeof r?.summary === 'string' && Array.isArray(r.attachments) && r.attachments.length && !isFileNameLine(r.summary, r.attachments));
  if (!list.length) return rows;
  try {
    const { briefs } = await readFileBriefs(list.flatMap(r => r.attachments.map(f => f?.drive_file_id)), rt);
    if (!briefs.size) return rows;
    for (const r of list) if (canRevertLine(r.summary, r.attachments, briefs)) r.line_revert = true;
  } catch { /* 표시만 빠짐 */ }
  return rows;
}

// [이전 줄로 되돌리기] — 연결 줄 하나(row: readLinkRecords 줄, attachments 포함). 같은 업데이트의 사업 기록 줄도 같이 되돌린다.
// update = basket-link-records.js updateLinkSummary(읽은 옛 줄과 같을 때만 씀 — 부르는 쪽이 넘김, 순환 참조 없게).
export async function revertRecordLine(row, rt = globalThis.window?.KPTURuntime, { update, read = readFileBriefs } = {}) {
  const atts = Array.isArray(row?.attachments) ? row.attachments : [];
  if (typeof update !== 'function' || !row?.id || typeof row.summary !== 'string' || !atts.length) return { ok: false, message: '이 기록 줄을 확인하지 못했어요.' };
  const owner = scopeOf(rt);
  let briefs;
  try { ({ briefs } = await read(atts.map(f => f?.drive_file_id), rt)); } catch { return { ok: false, message: '결과를 확인하지 못했어요. 다시 시도해 주세요.' }; }
  if (owner !== scopeOf(rt)) return { ok: false, stale: true, message: '' };
  if (!canRevertLine(row.summary, atts, briefs)) return { ok: false, message: '사진 설명으로 바꾼 줄이 아니라 되돌릴 이전 줄이 없어요.' };
  const old = fileNameLine(atts);
  const r = await update(row.id, row.summary, old, rt).catch(() => null);
  if (r?.ok !== true) return { ok: false, message: r?.error === 'SUMMARY_CHANGED' ? '다른 곳에서 줄이 바뀌었어요. 목록을 다시 확인해 주세요.' : '되돌리지 못했어요. 다시 시도해 주세요.' };
  const ws = ctxOf(rt)?.workspace?.id;
  if (ws && UUID.test(String(row.note_id || '')) && owner === scopeOf(rt)) {
    try {
      await rt.api(`/rest/v1/app_business_records?workspace_id=eq.${enc(ws)}&source_kind=eq.update&source_id=eq.${enc(row.note_id)}&body=eq.${enc(recordBody(row.summary))}&select=id`, { method: 'PATCH', prefer: 'return=representation', singleFlight: false, body: { body: recordBody(old) } });
    } catch { /* 사업 기록 줄은 덤 — 연결 줄은 이미 되돌림 */ }
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('kptu:basket-links-changed'));
    window.dispatchEvent(new CustomEvent('kptu:business-now-changed', { detail: { records: true } }));
  }
  return { ok: true, message: '이전 줄로 되돌렸어요.' };
}
