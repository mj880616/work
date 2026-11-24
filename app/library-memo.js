// S69-95 NOTE-메모넓히기: 자료실 자료 한 건의 '자료 창'(이름 · 자료실 · 종류 · 날짜, 설명, 아래 [파일 열기]) + 그 아래 메모 칸.
// 창은 잊지 말기 기록 창(record-sheet.js — ✕·바깥 누름·Esc·뒤로가기로 닫힘)을 그대로 쓰고, 메모 칸은 노트·저장한 글과 같은 부품(memo-thread.js)이다.
// 여는 곳: 자료실 자료 ⋯ [메모](library-upload.js) · 노트 › 메모 모아 보기에서 자료실 메모 줄(memo-open.js — 자료실로 옮겨 그 줄을 보인 뒤 이 창).
// 읽기만: 자료 한 줄(내 작업공간, 소유자 RLS 그대로). 원문(자료)이 없으면 false — 메모는 그대로, 모아 보기 링크만 꺼진다.
import {openRecordSheet} from './record-sheet.js';
import {pressFile} from './file-actions.js';
import {notify} from './small-notice.js';

const rt = () => window.KPTURuntime;
const enc = encodeURIComponent;
export const documentTitle = d => String(d?.title || d?.file_name || '').trim() || '자료';
const fileOf = d => ({name: d.file_name || d.title || '', mime: d.mime_type || '', documentId: d.file_id ? d.id : '', driveId: d.file_id || '', driveUrl: d.drive_url || '', size: d.file_size || 0});
const dayOf = v => (/^\d{4}-\d{2}-\d{2}/.test(String(v || '')) ? String(v).slice(0, 10).replace(/^(\d{4})-(\d{2})-(\d{2})$/, (_, y, m, d) => `${y}. ${Number(m)}. ${Number(d)}.`) : '');

async function readDocument(id) {
  const ws = rt()?.context?.read?.()?.workspace?.id;
  if (!id || !ws) return null;
  const rows = await rt().api(`/rest/v1/app_documents?id=eq.${enc(id)}&workspace_id=eq.${enc(ws)}&select=*&limit=1`, {singleFlight: false});
  return Array.isArray(rows) && rows[0]?.id === id ? rows[0] : null;
}

// doc = 이미 읽은 자료 줄(자료실 목록), 없으면 읽는다. trigger = 누른 단추(닫으면 초점이 돌아감). 열었으면 true.
export async function openDocumentMemo(id, {doc = null, trigger = null} = {}) {
  let d = doc?.id === id ? doc : null;
  if (!d) { try { d = await readDocument(id); } catch { d = null; } }
  if (!d) return false;
  const title = documentTitle(d), meta = ['자료실', d.category || '', dayOf(d.document_date || d.created_at)].filter(Boolean).join(' · ');
  return openRecordSheet({
    row: {raw_text: String(d.description || ''), occurred_at: null},
    title, meta, trigger,
    memo: {type: 'document', id: d.id, title},
    fullLabel: '파일 열기',
    onOpenFull: () => void pressFile(fileOf(d), {api: (...a) => rt().api(...a), onError: m => notify(m, {error: true}),
      viewHtml: file => void import('./library-html-view.js').then(v => v.openLibraryHtmlView(file, {title})).catch(() => {})}),
  });
}
