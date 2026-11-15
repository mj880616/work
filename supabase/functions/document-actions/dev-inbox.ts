// WEEKLY-개발후보연결 (docs/design/weekly-draft-feedback.md 25.2 추천안(가), 명진 결정 11/03 "모두 추천대로", S48-49).
// 주간보고 환류 '개선 제안'에 사람이 [만들기]·[고쳐서 만들기]를 눌러 저장이 성공한 뒤, 화면이 {week_start, id}만 보낸다(글은 보내지 않음).
// 서버 순서(하나라도 아니면 아무것도 쓰지 않음):
//   ① 로그인 → ② 그 사람이 owner인 작업공간이 정확히 하나 → ③ 운영자 기능 dev_inbox(내 기능 목록에 있고, 그 기능이 허용된 작업공간이
//   정확히 하나이며 그것이 ②와 같음 — gdrive-photos·cloud-files와 같은 확인) → ④ 요청함 문서 id(Edge 비밀값 WEB2_DEV_INBOX_DOC_ID)가 있어야 함
//   (없으면 not_ready, 화면은 '전달 준비 중') → ⑤ 그 주 행을 내 로그인 토큰(RLS owner)으로 다시 읽어 그 제안이 answer='yes'인지 확인(화면 글을 믿지 않음)
//   → 이미 보냈으면(sent) already → ⑥ 'Web2 요청함' 문서 끝에 한 덩어리 두 줄만 더한다(접수 줄 없이 — CC 대기 계산이 '미접수'로 잡음):
//        [MM/DD HH:MM] 주간보고 개발 후보 (w:<week_start>/<id>) — <무엇이 좋아지나>
//        - 어떻게: <어떻게>
//   → ⑦ 그 제안에 sent(보낸 시각)를 남긴다(draft_saved_at 조건, 다른 칸 손대지 않음 — 같은 제안은 한 번만).
// 외부 입력을 읽고 외부 행동으로 저절로 잇는 길이 아니다: 사람이 누른 한 건만, 운영자만, 서버가 저장값을 다시 확인한 뒤에만 쓴다.
// 글(제안 내용)은 로그·응답에 쓰지 않는다. 응답은 결과 코드뿐이다.

export type DevInboxDeps = {
  userId: string;
  // 서버 키 PostgREST(작업공간 owner·운영자 기능 작업공간 확인). 실패하면 던진다.
  db: (path: string, opts?: { method?: string; body?: unknown }) => Promise<any>;
  // 내 로그인 토큰 PostgREST(그 주 행 읽기·쓰기, 내 기능 목록). 실패하면 {status}를 단 오류를 던진다.
  userDb: (path: string, opts?: { method?: string; body?: unknown; prefer?: string }) => Promise<any>;
  driveToken: () => Promise<string>;
  fetch: typeof fetch;
  now: () => number;
  docId: string | undefined;
};

export const DEV_INBOX_FEATURE = 'dev_inbox';
const TABLE = 'app_weekly_exec_requests';
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const SUGGESTION_ID = /^s[1-4]$/;
const DOC_ID = /^[A-Za-z0-9_-]{20,200}$/;
const TEXT_MAX = 200, HOW_MAX = 120;
const enc = encodeURIComponent;
const fail = (message: string, code: string, status = 400) => Object.assign(new Error(message), { code, status });
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

export function parseDevInboxRequest(body: any) {
  const keys = Object.keys(body || {}).sort().join(',');
  if (keys !== 'action,id,week_start') throw fail('보낼 제안을 확인할 수 없습니다.', 'INVALID_REQUEST');
  const week = String(body.week_start), id = String(body.id);
  const day = new Date(`${week}T00:00:00Z`);
  if (!DAY.test(week) || Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== week || day.getUTCDay() !== 1 || !SUGGESTION_ID.test(id)) {
    throw fail('보낼 제안을 확인할 수 없습니다.', 'INVALID_REQUEST');
  }
  return { week, id };
}

// 한 줄로, 요청함 덩어리·접수 표시를 흉내 낼 수 있는 글자(줄바꿈·제어 글자·'→'·'★')는 뺀다. 맨 앞 '['도 뺀다.
export function inboxLine(v: unknown, max: number) {
  const s = String(v ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/[\u2192\u2605]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\[+\s*/, '');
  return [...s].slice(0, max).join('');
}

// 서울 시각 [MM/DD HH:MM]
export function inboxStamp(ms: number) {
  const d = new Date(ms + 9 * 3600 * 1000), p = (n: number) => String(n).padStart(2, '0');
  return `[${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}]`;
}

export function inboxBlock({ week, id, text, how, at }: { week: string; id: string; text: string; how: string; at: number }) {
  const head = `${inboxStamp(at)} 주간보고 개발 후보 (w:${week}/${id}) — ${text}`;
  return how ? `${head}\n- 어떻게: ${how}` : head;
}

async function ownerWorkspace(deps: DevInboxDeps) {
  const rows = await deps.db(`app_workspace_members?user_id=eq.${enc(deps.userId)}&role=eq.owner&select=workspace_id&limit=2`);
  if (!Array.isArray(rows) || rows.length !== 1 || typeof rows[0]?.workspace_id !== 'string') throw fail('워크스페이스 소유자 권한이 필요합니다.', 'FORBIDDEN', 403);
  return rows[0].workspace_id as string;
}

async function assertFeature(deps: DevInboxDeps, workspaceId: string) {
  let mine: unknown;
  try { mine = await deps.userDb('rpc/app_my_features', { method: 'POST', body: {} }); } catch { mine = null; }
  if (!Array.isArray(mine) || !mine.includes(DEV_INBOX_FEATURE)) throw fail('이 작업공간에서는 쓸 수 없는 기능입니다.', 'FEATURE_REQUIRED', 403);
  let only: unknown;
  try { only = await deps.db('rpc/app_operator_feature_workspace', { method: 'POST', body: { p_feature: DEV_INBOX_FEATURE } }); } catch { only = null; }
  if (only !== workspaceId) throw fail('이 작업공간에서는 쓸 수 없는 기능입니다.', 'FEATURE_REQUIRED', 403);
}

type WeekRow = { draft: Record<string, any>; savedAt: string | null };
async function readWeek(deps: DevInboxDeps, workspaceId: string, week: string): Promise<WeekRow> {
  let rows: unknown;
  try { rows = await deps.userDb(`${TABLE}?workspace_id=eq.${enc(workspaceId)}&week_start=eq.${week}&select=workspace_id,week_start,draft,draft_saved_at&limit=2`); }
  catch { throw fail('그 주 기록을 읽지 못했습니다.', 'READ_FAILED', 503); }
  if (!Array.isArray(rows) || rows.length !== 1) throw fail('보낼 제안을 찾을 수 없습니다.', 'NOT_FOUND');
  const row = rows[0];
  if (row?.workspace_id !== workspaceId || row?.week_start !== week || !isObj(row.draft)) throw fail('보낼 제안을 찾을 수 없습니다.', 'NOT_FOUND');
  return { draft: row.draft, savedAt: typeof row.draft_saved_at === 'string' ? row.draft_saved_at : null };
}
const suggestionsOf = (draft: Record<string, any>) => {
  const list = draft?.feedback?.review?.suggestions;
  return Array.isArray(list) ? list : [];
};

// 그 제안에 sent만 단 draft를 draft_saved_at 조건으로 쓴다(판 번호는 앞 판보다 뒤). 그사이 바뀌면 한 번 다시 읽어 다시 단다.
async function markSent(deps: DevInboxDeps, workspaceId: string, week: string, id: string, at: string) {
  for (let i = 0; i < 2; i++) {
    const row = await readWeek(deps, workspaceId, week);
    const list = suggestionsOf(row.draft), at_ = list.findIndex(s => isObj(s) && s.id === id);
    if (at_ < 0 || list[at_].answer !== 'yes') return false;
    if (typeof list[at_].sent === 'string') return true;
    const next = list.map((s, k) => (k === at_ ? { ...s, sent: at } : s));
    const draft = { ...row.draft, feedback: { ...row.draft.feedback, review: { ...row.draft.feedback.review, suggestions: next } } };
    const prev = Date.parse(row.savedAt ?? ''), nowMs = deps.now();
    const savedAt = Number.isFinite(prev) && !(nowMs > prev) ? new Date(prev + 1).toISOString() : new Date(nowMs).toISOString();
    const cond = row.savedAt ? `draft_saved_at=eq.${enc(row.savedAt)}` : 'draft_saved_at=is.null';
    let out: unknown;
    try { out = await deps.userDb(`${TABLE}?workspace_id=eq.${enc(workspaceId)}&week_start=eq.${week}&${cond}&select=week_start`, { method: 'PATCH', body: { draft, draft_saved_at: savedAt }, prefer: 'return=representation' }); }
    catch { return false; }
    if (Array.isArray(out) && out.length === 1) return true;
  }
  return false;
}

export async function sendDevInbox(body: any, deps: DevInboxDeps) {
  const { week, id } = parseDevInboxRequest(body);
  const workspaceId = await ownerWorkspace(deps);
  await assertFeature(deps, workspaceId);
  const docId = String(deps.docId ?? '').trim();
  if (!DOC_ID.test(docId)) return { ok: true, result: 'not_ready' };
  const row = await readWeek(deps, workspaceId, week);
  const s = suggestionsOf(row.draft).find(x => isObj(x) && x.id === id);
  if (!s || s.answer !== 'yes') throw fail('만들기로 보낸 제안이 아닙니다.', 'NOT_ANSWERED');
  if (typeof s.sent === 'string') return { ok: true, result: 'already' };
  const text = inboxLine(s.text, TEXT_MAX), how = inboxLine(s.how, HOW_MAX);
  if (!text) throw fail('보낼 제안을 찾을 수 없습니다.', 'NOT_FOUND');
  const now = deps.now();
  const block = inboxBlock({ week, id, text, how, at: now });
  const token = await deps.driveToken();
  let r: Response;
  try {
    r = await deps.fetch(`https://docs.googleapis.com/v1/documents/${enc(docId)}:batchUpdate`, {
      method: 'POST', redirect: 'error',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ insertText: { endOfSegmentLocation: { segmentId: '' }, text: `\n${block}` } }] }),
    });
  } catch {
    throw fail('요청함에 더했는지 확인하지 못했습니다.', 'RESULT_UNKNOWN', 503);
  }
  try { await r.body?.cancel(); } catch { /* 본문은 읽지 않는다 */ }
  if (r.status >= 500) throw fail('요청함에 더했는지 확인하지 못했습니다.', 'RESULT_UNKNOWN', 503);
  if (!r.ok) throw fail('요청함 문서에 쓰지 못했습니다.', 'DOC_UNAVAILABLE', 503);
  const marked = await markSent(deps, workspaceId, week, id, new Date(now).toISOString());
  return { ok: true, result: 'sent', ...(marked ? {} : { marked: false }) };
}

// ---- WEEKLY-개발후보CC 2단계 '만듦 #PR'(docs/design/weekly-draft-feedback.md 25.3 3.·25.5, S48-57) ----
// CC가 요청함 그 덩어리 아래에 '→ 접수: … 완료 #NNN'(또는 '→ 대조: 완료 #NNN')을 적으면, [주간 정리]를 열 때 화면이 {week_start}만 보낸다.
// 서버 순서(하나라도 아니면 아무것도 쓰지 않음): ① 로그인 → ② owner 작업공간 하나 → ③ 운영자 기능 dev_inbox(보내기와 같은 확인)
//   → ④ 요청함 문서 id(없으면 not_ready) → ⑤ 그 주 행을 내 로그인 토큰으로 다시 읽어 '보냈고(sent) 아직 번호 없는' 만들기 제안이 있을 때만
//   → ⑥ 요청함 문서를 읽어 그 주 열쇠 (w:<주>/<id>) 덩어리마다 '→'로 시작하고 '완료'가 든 줄의 마지막 #번호만 뽑는다
//   → ⑦ 그 제안이 지금도 answer='yes'이고 sent가 있고 made가 없을 때만 made=번호(draft_saved_at 조건, 다른 칸 손대지 않음).
// 화면이 보낸 번호·글은 받지 않는다(번호는 서버가 문서에서만 읽음). 응답은 {updated:n} 숫자뿐이고, 문서 글은 로그·응답에 쓰지 않는다.
const STAMP_HEAD = /^\[(?:\d{4}-\d{2}-\d{2} \d{2}:\d{2}|\d{2}\/\d{2} \d{2}:\d{2})\]/;
const DEV_HEAD = /^\[\d{2}\/\d{2} \d{2}:\d{2}\] 주간보고 개발 후보 \(w:(\d{4}-\d{2}-\d{2})\/(s[1-4])\) — /;
const DOC_TEXT_MAX = 20_000_000;

export function parseDevMadeRequest(body: any) {
  const keys = Object.keys(body || {}).sort().join(',');
  if (keys !== 'action,week_start') throw fail('읽을 주를 확인할 수 없습니다.', 'INVALID_REQUEST');
  const week = String(body.week_start), day = new Date(`${week}T00:00:00Z`);
  if (!DAY.test(week) || Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== week || day.getUTCDay() !== 1) throw fail('읽을 주를 확인할 수 없습니다.', 'INVALID_REQUEST');
  return { week };
}

// 요청함 글 → 그 주 제안 id별 PR 번호. 덩어리는 다음 '[날짜 시각]' 머리줄에서 끝난다('[10/30 14:07 사용자 추가]' 같은 덧붙임 줄은 덩어리 안).
// 제안 글은 보낼 때 '→'·줄바꿈을 지웠으므로 '→'로 시작하는 줄은 CC가 적은 줄뿐이다.
export function madeFromInbox(text: string, week: string) {
  const out = new Map<string, number>();
  let cur: string | null = null;
  for (const raw of String(text ?? '').split(/\r\n|[\n\r\v]/)) {
    const line = raw.trim();
    const head = DEV_HEAD.exec(line);
    if (head) { cur = head[1] === week ? head[2] : null; continue; }
    if (STAMP_HEAD.test(line)) { cur = null; continue; }
    if (!cur || !line.startsWith('→') || !line.includes('완료')) continue;
    const nums = [...line.matchAll(/#(\d{1,6})(?!\d)/g)].map(m => Number(m[1])).filter(n => n > 0 && n < 1e6);
    if (nums.length) out.set(cur, nums[nums.length - 1]);
  }
  return out;
}

const pendingMade = (s: any) => isObj(s) && s.answer === 'yes' && typeof s.sent === 'string' && !(Number.isInteger(s.made) && s.made > 0);

async function writeMade(deps: DevInboxDeps, workspaceId: string, week: string, found: Map<string, number>) {
  for (let i = 0; i < 2; i++) {
    const row = await readWeek(deps, workspaceId, week);
    const list = suggestionsOf(row.draft);
    let n = 0;
    const next = list.map(s => (pendingMade(s) && found.has(s.id) ? (n++, { ...s, made: found.get(s.id) }) : s));
    if (!n) return 0;
    const draft = { ...row.draft, feedback: { ...row.draft.feedback, review: { ...row.draft.feedback.review, suggestions: next } } };
    const prev = Date.parse(row.savedAt ?? ''), nowMs = deps.now();
    const savedAt = Number.isFinite(prev) && !(nowMs > prev) ? new Date(prev + 1).toISOString() : new Date(nowMs).toISOString();
    const cond = row.savedAt ? `draft_saved_at=eq.${enc(row.savedAt)}` : 'draft_saved_at=is.null';
    let out: unknown;
    try { out = await deps.userDb(`${TABLE}?workspace_id=eq.${enc(workspaceId)}&week_start=eq.${week}&${cond}&select=week_start`, { method: 'PATCH', body: { draft, draft_saved_at: savedAt }, prefer: 'return=representation' }); }
    catch { throw fail('번호를 남기지 못했습니다.', 'WRITE_FAILED', 503); }
    if (Array.isArray(out) && out.length === 1) return n;
  }
  throw fail('번호를 남기지 못했습니다.', 'WRITE_FAILED', 503);
}

export async function readDevMade(body: any, deps: DevInboxDeps) {
  const { week } = parseDevMadeRequest(body);
  const workspaceId = await ownerWorkspace(deps);
  await assertFeature(deps, workspaceId);
  const docId = String(deps.docId ?? '').trim();
  if (!DOC_ID.test(docId)) return { ok: true, result: 'not_ready', updated: 0 };
  const row = await readWeek(deps, workspaceId, week);
  if (!suggestionsOf(row.draft).some(pendingMade)) return { ok: true, result: 'none', updated: 0 };
  const token = await deps.driveToken();
  let r: Response;
  try {
    r = await deps.fetch(`https://docs.googleapis.com/v1/documents/${enc(docId)}?fields=${enc('body/content/paragraph/elements/textRun/content')}`, {
      method: 'GET', redirect: 'error', headers: { Authorization: `Bearer ${token}` },
    });
  } catch { throw fail('요청함 문서를 읽지 못했습니다.', 'DOC_UNAVAILABLE', 503); }
  if (!r.ok) { try { await r.body?.cancel(); } catch { /* 본문은 읽지 않는다 */ } throw fail('요청함 문서를 읽지 못했습니다.', 'DOC_UNAVAILABLE', 503); }
  const len = Number(r.headers.get('content-length') || 0);
  if (len > DOC_TEXT_MAX) { try { await r.body?.cancel(); } catch { /* 크면 읽지 않음 */ } throw fail('요청함 문서를 읽지 못했습니다.', 'DOC_UNAVAILABLE', 503); }
  let doc: any;
  try { const raw = await r.text(); if (raw.length > DOC_TEXT_MAX) throw new Error('big'); doc = JSON.parse(raw); }
  catch { throw fail('요청함 문서를 읽지 못했습니다.', 'DOC_UNAVAILABLE', 503); }
  const parts: string[] = [];
  for (const c of Array.isArray(doc?.body?.content) ? doc.body.content : []) {
    for (const e of Array.isArray(c?.paragraph?.elements) ? c.paragraph.elements : []) {
      if (typeof e?.textRun?.content === 'string') parts.push(e.textRun.content);
    }
  }
  const found = madeFromInbox(parts.join(''), week);
  if (!found.size) return { ok: true, result: 'ok', updated: 0 };
  const updated = await writeMade(deps, workspaceId, week, found);
  return { ok: true, result: 'ok', updated };
}
