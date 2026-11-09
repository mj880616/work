// ORG-기록하나로 O-5: 조직 상세 기록 줄 ⋯ [원래 글 보기] — 그 기록이 나온 원래 줄(통화·텔레그램 줄, 잊지 말기 소식, 업데이트)의 글을 읽는다.
// 읽기만 한다. 같은 작업공간의 행만(workspace_id 조건 + 각 표의 owner RLS). 원래 줄이 지워졌으면 {gone:true}.
// 화면 세션 안 메모리에만 잠깐 둔다(브라우저 저장소 아님).
import {hasSource} from './org-record-rows.mjs';

const enc = encodeURIComponent;
const cache = new Map(); // 'kind:id' → {label, text} | {gone:true}

const PATHS = {
  feed: (id, ws) => `/rest/v1/app_feed_items?id=eq.${enc(id)}&workspace_id=eq.${enc(ws)}&select=source,day,title,summary&limit=1`,
  memorable: (id, ws) => `/rest/v1/app_journal_memorable?id=eq.${enc(id)}&workspace_id=eq.${enc(ws)}&select=day,line,final_line&limit=1`,
  update: (id, ws) => `/rest/v1/app_notes?id=eq.${enc(id)}&workspace_id=eq.${enc(ws)}&select=raw_text,occurred_at&limit=1`,
};

function shape(kind, row) {
  if (kind === 'feed') return {label: row.source === 'call' ? '통화' : '텔레그램', text: [row.title, row.summary].map(v => String(v ?? '').trim()).filter(Boolean).join('\n')};
  if (kind === 'memorable') return {label: '소식', text: String(row.final_line || row.line || '').trim()};
  return {label: '업데이트', text: String(row.raw_text ?? '').trim()};
}

export async function readRecordSource(record, {rt = window.KPTURuntime, workspaceId} = {}) {
  if (!hasSource(record) || !workspaceId) return {gone: true};
  const key = `${record.source_kind}:${record.source_id}`;
  if (cache.has(key)) return cache.get(key);
  const rows = await rt.api(PATHS[record.source_kind](record.source_id, workspaceId));
  const out = Array.isArray(rows) && rows[0] ? shape(record.source_kind, rows[0]) : {gone: true};
  if (out.gone || !out.text) { const gone = {gone: true}; cache.set(key, gone); return gone; }
  cache.set(key, out);
  return out;
}
