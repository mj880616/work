// JOURNAL-조직현황AI요약: [주간 정리] '4. 산하 조직 현황 > 1) 요약'의 조직별 요약(주간보고 문체, 몇 줄).
// - 저장소: owner RLS 표 app_weekly_org_summaries(migration 20261022120000) — 주(월요일)·조직마다 1행, 요약 글과 "고친 요약"(edited) 표시만.
// - [요약 만들기]를 누를 때만 서버 ai-assist(kind=org_summary)에 주와 조직 ID만 보낸다. 재료는 서버가 로그인으로 읽고,
//   고친 요약(edited=true)은 서버가 보내지도 덮어쓰지도 않는다. 화면은 응답 뒤 표를 다시 읽는다.
// - 고친 요약은 여기서 edited=true로 저장한다(빈 글이면 행을 지워 다음 [요약 만들기]에서 다시 생김).
// - 표가 아직 없으면(REST 404) 'missing' — 화면은 버튼과 요약을 숨기고 예전처럼 원문만 보인다.
// 브라우저 저장소에 아무것도 두지 않는다.
import {callAiAssist, AI_SUMMARY_TEXT, aiSummaryRetryable} from './basket-ai-summary.js';

const TABLE = '/rest/v1/app_weekly_org_summaries';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const encode = encodeURIComponent;
// The database check (app_weekly_org_summaries_summary_check): 1~8 non-empty lines joined by one "\n", 1~1,000 characters,
// no control character but the line break. The server asks the AI for at most 5 lines; an owner may keep up to 8.
export const ORG_SUMMARY_MAX_LINES = 8;
export const ORG_SUMMARY_MAX_CHARS = 1000;
// The server takes 1~20 organizations a call (ai-assist ORG_SUMMARY_MAX_ORGS).
export const ORG_SUMMARY_MAX_ORGS = 20;

export const ORG_AI_TEXT = Object.freeze({
  ...AI_SUMMARY_TEXT,
  not_ready:'조직 요약은 아직 준비 중이에요.',
  not_found:'요약할 조직을 찾지 못했어요.',
  daily_limit:'오늘 AI를 쓸 수 있는 횟수를 다 썼어요. 요약은 직접 써 주세요.',
});

const workspaceOf = rt => {
  const id = rt.context.read()?.workspace?.id;
  if (!id) throw new Error('업무 공간을 확인할 수 없습니다.');
  return id;
};

// The week's saved summaries: Map(organization id → {id, summary, edited, updated_at}). A missing table is {missing:true}.
export async function readOrgSummaries(start, rt = window.KPTURuntime) {
  if (!DAY.test(String(start))) throw new Error('week');
  let rows;
  try {
    rows = await rt.api(`${TABLE}?workspace_id=eq.${encode(workspaceOf(rt))}&week_start=eq.${start}&select=id,organization_id,summary,edited,updated_at&order=organization_id.asc&limit=200`);
  } catch (error) {
    if (error?.status === 404) return Object.assign(new Map(), {missing:true});
    throw error;
  }
  if (!Array.isArray(rows)) throw new Error('read');
  const out = new Map();
  for (const row of rows) {
    if (!UUID.test(String(row?.organization_id)) || typeof row.summary !== 'string') continue;
    out.set(String(row.organization_id).toLowerCase(), {id:row.id, summary:row.summary, edited:row.edited === true, updated_at:row.updated_at});
  }
  return out;
}

// What an owner typed → the saved form: lines trimmed, empty lines dropped. '' means "remove the summary".
// Throws {code, message} when it does not fit the database's rule.
export function cleanEdited(text) {
  const raw = String(text ?? '').replace(/\r\n?/g, '\n');
  if (/[\u0000-\u0009\u000b-\u001f\u007f]/.test(raw.replace(/\t/g, ' '))) throw Object.assign(new Error('쓸 수 없는 글자가 들어 있어요.'), {code:'control'});
  const lines = raw.replace(/\t/g, ' ').split('\n').map(line => line.trim()).filter(Boolean);
  if (lines.length > ORG_SUMMARY_MAX_LINES) throw Object.assign(new Error(`요약은 ${ORG_SUMMARY_MAX_LINES}줄까지 쓸 수 있어요.`), {code:'too_many'});
  const summary = lines.join('\n');
  if ([...summary].length > ORG_SUMMARY_MAX_CHARS) throw Object.assign(new Error(`요약은 ${ORG_SUMMARY_MAX_CHARS.toLocaleString('ko-KR')}자까지 쓸 수 있어요.`), {code:'too_long'});
  return summary;
}
export const summaryLines = summary => String(summary ?? '').split('\n').map(line => line.trim()).filter(Boolean);

// Saves an owner's summary as "고친 요약" (edited=true) — the AI never writes over it. '' removes the row.
// row: the saved row when there is one (from readOrgSummaries). Returns the saved row, or null when removed.
export async function saveEditedSummary({start, organizationId, row = null, text}, rt = window.KPTURuntime) {
  if (!DAY.test(String(start)) || !UUID.test(String(organizationId))) throw new Error('요청 내용을 확인해 주세요.');
  const summary = cleanEdited(text), workspace = workspaceOf(rt), now = new Date().toISOString();
  const key = `workspace_id=eq.${encode(workspace)}&week_start=eq.${start}&organization_id=eq.${encode(organizationId)}`;
  const one = rows => (Array.isArray(rows) && rows.length === 1 ? rows[0] : null);
  if (!summary) {
    await rt.api(`${TABLE}?${key}`, {method:'DELETE', prefer:'return=representation'});
    return null;
  }
  const patch = async () => one(await rt.api(`${TABLE}?${key}&select=id,organization_id,summary,edited,updated_at`, {method:'PATCH', prefer:'return=representation', body:{summary, edited:true, updated_at:now}}));
  if (row) {
    const saved = await patch();
    if (saved) return saved;
  }
  try {
    const saved = one(await rt.api(`${TABLE}?select=id,organization_id,summary,edited,updated_at`, {method:'POST', prefer:'return=representation',
      body:{workspace_id:workspace, week_start:start, organization_id:organizationId, summary, edited:true, updated_at:now}}));
    if (saved) return saved;
  } catch (error) {
    // Another window (or the AI) made the row in the meantime: write over it as the owner's own.
    if (error?.status !== 409) throw error;
  }
  const saved = await patch();
  if (!saved) throw new Error('저장 결과를 확인할 수 없습니다.');
  return saved;
}

// [요약 만들기]: one call for the week and the organizations (ids only). Never throws.
// Returns {ok:true, written, kept, empty, partial, more} or {ok:false, code, message, retry}.
export async function requestOrgSummaries({start, organizationIds}, options = {}) {
  const ids = [...new Set((organizationIds || []).map(id => String(id).toLowerCase()))].filter(id => UUID.test(id));
  const fail = code => ({ok:false, code, message:ORG_AI_TEXT[code] || ORG_AI_TEXT.internal_error, retry:aiSummaryRetryable(code)});
  if (!DAY.test(String(start)) || !ids.length) return fail('invalid_request');
  const sent = ids.slice(0, ORG_SUMMARY_MAX_ORGS);
  const r = await callAiAssist({kind:'org_summary', week_start:start, organization_ids:sent}, options, ORG_AI_TEXT);
  if (!r.ok) return fail(r.code);
  const d = r.data, list = value => (Array.isArray(value) ? value.filter(id => typeof id === 'string') : []);
  if (d.week_start !== start || !Array.isArray(d.items)) return fail('ai_invalid_response');
  return {ok:true, written:d.items.length, kept:list(d.kept).length, empty:list(d.empty).length, partial:d.partial === true, more:ids.length - sent.length};
}

// The status line after [요약 만들기] (plain words, numbers only).
export function resultMessage(r) {
  if (!r.ok) return r.message;
  const parts = [r.written ? `조직 ${r.written}곳 요약을 만들었어요.` : '새로 만든 요약이 없어요.'];
  if (r.kept) parts.push(`고친 요약 ${r.kept}곳은 그대로 두었어요.`);
  if (r.empty) parts.push(`기록이 없거나 AI가 요약하지 못한 ${r.empty}곳은 비워 두었어요.`);
  if (r.partial) parts.push('기록이 많아 일부만 보고 만들었어요.');
  if (r.more) parts.push(`한 번에 ${ORG_SUMMARY_MAX_ORGS}곳까지라 ${r.more}곳은 빠졌어요.`);
  return parts.join(' ');
}
