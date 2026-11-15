// REC-한회의로잇기 PR-2(설계 docs/design/rec-join.md 3-1·3-5·3-7절): 두 번 녹음한 회의를 한 보고로 잇기 · 저장한 두 보고 합치기.
// 표 app_meeting_join_jobs(migration 20261111142100) 한 행 = 잇기·합치기 한 번. 단계: summary(합친 전문으로 처음부터 다시 요약) → apply → done.
// 보고 글을 바꾸는 곳은 DB 함수 app_meeting_join_apply 한 번뿐이다(한 트랜잭션). 이 파일은 규칙과 사용자 입구의 순서만 갖고,
// DB·네트워크는 부른 쪽(index.ts의 joinIo)이 준다(단위 시험 tests/meeting-join-job.test.mjs가 가짜 io로 순서를 본다).
// 순서(3-1절): 로그인 확인(index.ts userOf) → 고른 보고를 부른 사람 로그인으로 읽기 → 그 행의 작업공간으로 owner 확인 → 그 뒤에만 서비스 권한.
// 화면이 보낸 작업공간·소유 값은 받지 않는다. 글 내용(보고·전사)은 오류·로그에 싣지 않는다(고정 코드만).
import { Fail, isUuid } from './model.mjs';
import { ACTIVE, LIST_HOURS, SPLIT_CODES, cleanText, hasWords, needsKick, splitJobSummary, summaryPlan } from './server-job.mjs';
import { normalizeDraft } from '../_shared/meeting-draft-prompt.mjs';

export const JOIN_JOB_TABLE = 'app_meeting_join_jobs';
// 화면에 줄 때·목록에서 읽는 칸(글은 읽지 않는다).
export const JOIN_VIEW_COLUMNS = 'id,workspace_id,created_by,mode,target_meeting_id,source_job_id,source_meeting_id,status,stage,step_no,step_total,error_code,lease_until,attempts,started_at,finished_at,applied_at,undone_at,seen_at,candidates_closed_at,created_at,updated_at';
// 단계를 돌릴 때 읽는 칸(요약할 합친 전문·끝난 조각 요약). 합치기 전 글·재료 글은 읽지 않는다.
export const JOIN_STEP_COLUMNS = `${JOIN_VIEW_COLUMNS},summary_parts,transcript_text`;
// [다시]: 멈춘 단계부터(조각 요약) 또는 처음부터(재료).
export const JOIN_RETRY_COLUMNS = `${JOIN_STEP_COLUMNS},source_text,source_record_jobs`;
// 고른 보고·합칠 보고를 부른 사람 로그인으로 읽을 때의 칸. transcript_text = '회의 결과', notes = '회의록 전문'.
export const JOIN_MEETING_COLUMNS = 'id,workspace_id,activity_kind,meeting_at,transcript_text,notes,deleted_at';
export const JOIN_DAY_COLUMNS = 'id,workspace_id,activity_kind,meeting_at,deleted_at';
// 서비스 권한이 넣고 고칠 수 있는 칸(migration의 grant insert/update 목록과 같아야 한다 — 시험이 맞춰 본다).
export const JOIN_INSERT_COLUMNS = Object.freeze(['workspace_id', 'created_by', 'mode', 'target_meeting_id', 'source_job_id', 'source_meeting_id', 'source_text',
  'source_record_jobs', 'source_result_sha', 'source_notes_sha', 'before_result', 'before_notes', 'status', 'stage', 'step_no', 'step_total', 'summary_parts', 'transcript_text']);
export const JOIN_UPDATE_COLUMNS = Object.freeze(['status', 'stage', 'step_no', 'step_total', 'summary_parts', 'transcript_text', 'draft', 'result_text', 'error_code',
  'lease_until', 'attempts', 'started_at', 'finished_at', 'seen_at', 'candidates_closed_at', 'updated_at']);
export const JOIN_TEXT_MAX_CHARS = 1000000;            // 작업 표의 전문 한도와 같음
export const JOIN_TEXT_MAX_BYTES = 4 * 1024 * 1024;    // join_text 몸통(100만 자 UTF-8)
export const JOIN_RECORD_MAX = 20;                     // 붙일 녹음 작업 수(표 제약과 같음)
export const JOIN_TICK_ACTION = 'join_tick';
export const UNDO_SCOPES = Object.freeze(['before', 'joined', 'all']);
// 처음부터 다시 해야 하는 실패(그 사이 보고 글이 바뀜): 같은 보고·같은 재료로 새 작업 행을 만든다.
export const RESTART_CODES = Object.freeze(['report_changed', 'source_changed']);
const LIST_STATUS = Object.freeze(['queued', 'running', 'failed', 'done']);
const KST = 9 * 3600000;

// ---- 순수 규칙 ----
// [회의] 칸인가. DB 함수와 같은 기준(activity_kind가 없거나 'meeting'). 다른 칸의 notes는 '특이사항'이라 전문으로 덮으면 안 된다.
export const isMeetingReport = (m) => !!m && (m.activity_kind == null || m.activity_kind === 'meeting');

// 보고 일시 등 → ms. 시간대 표시가 없으면 서울 시각으로 본다. 읽지 못하면 null.
export function atMs(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s)) return null;
  const zoned = /(?:[zZ]|[+-]\d{2}(?::?\d{2})?)$/.test(s.slice(16));
  const t = Date.parse(zoned ? s : `${s}+09:00`);
  return Number.isFinite(t) ? t : null;
}
const two = (n) => String(n).padStart(2, '0');
export function seoulHm(ms) { const d = new Date(ms + KST); return `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`; }
// 그 시각이 든 서울 하루의 [시작, 끝) ISO.
export function seoulDayRange(ms) {
  const start = Math.floor((ms + KST) / 86400000) * 86400000 - KST;
  return [new Date(start).toISOString(), new Date(start + 86400000).toISOString()];
}
// 두 전문 사이 한 줄. 구간 구분 줄(server-job.mjs joinParts '― 60분부터 ―')과 같은 긴 줄표라 말소리로 세지 않는다(hasWords).
export const joinMark = (ms) => (Number.isFinite(ms) ? `― 이어서 · ${seoulHm(ms)} 녹음 ―` : '― 이어서 ―');
// 합친 전문: 고른 보고의 전문이 앞, 잇는 재료가 뒤. 재료의 시작 시각을 알고 그것이 보고 일시보다 앞이면 재료를 앞에 둔다(시간순).
// 사이 줄의 시각은 뒤에 오는 쪽의 시작 시각(서울). 이미 쓴 전문은 지우지 않고 붙인다.
export function joinTranscripts({ targetText, targetAt, sourceText, sourceAt }) {
  const target = String(targetText || '').trim(), source = String(sourceText || '').trim();
  const sourceFirst = Number.isFinite(sourceAt) && Number.isFinite(targetAt) && sourceAt < targetAt;
  const [first, second, at] = sourceFirst ? [source, target, targetAt] : [target, source, sourceAt];
  return `${first}\n\n${joinMark(at)}\n${second}`;
}
const partSeconds = (parts) => (Array.isArray(parts) ? parts : []).reduce((s, p) => s + (Number(p?.seconds) || 0), 0);
// 녹음 결과의 시작 시각 = 정리를 맡긴 때 − 녹음 길이(화면 meeting-recorder.js openServerResult와 같은 계산). 회의자료 파일(attached)은 모른다.
export function recordingStartMs(job) {
  if (!job || job.kind !== 'recording') return null;
  const created = Date.parse(job.created_at || '');
  return Number.isFinite(created) ? created - partSeconds(job.parts) * 1000 : null;
}
// 서버 정리 작업이 전사한 녹음 구간 작업 id(붙일 녹음). 겹침 없이 JOIN_RECORD_MAX개까지.
export function recordJobIds(job) {
  const ids = (Array.isArray(job?.parts) ? job.parts : []).map((p) => p?.job).filter(isUuid);
  return [...new Set(ids)].slice(0, JOIN_RECORD_MAX);
}

// 요약 → '회의 결과' 칸에 넣을 글. 화면 app/meeting-transcript-model.mjs draftText와 같은 글이어야 한다(Edge 묶음은 app/을 불러올 수 없어
// 사본을 두고, 시험이 같은 입력에 같은 글을 내는지 맞춰 본다). 참석 · 결정 · 공유 순, 비어 있는 부분은 쓰지 않는다.
const LIST = /^\s*(?:[-*•·○●□■▶▷※◇◆]|\d+[.)]|[가-하][.)]|\(\d+\)|\[\d+\])\s*/;
const bullets = (text) => String(text || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => (LIST.test(l) ? '- ' + l.replace(LIST, '') : '- ' + l));
export function draftText(draft) {
  if (!draft) return '';
  const parts = [];
  if (draft.attendees?.length) parts.push('참석: ' + draft.attendees.join(', '));
  const d = bullets(draft.decisions); if (d.length) parts.push(['결정', ...d].join('\n'));
  const i = bullets(draft.information); if (i.length) parts.push(['공유', ...i].join('\n'));
  return parts.join('\n\n');
}
// 서버 요약 답(raw) → 회의 결과 글. 비면 ''(부른 쪽이 draft_failed로 멈춘다 — 빈 글로 보고를 덮지 않는다).
export const joinResultText = (raw) => draftText(normalizeDraft(raw));
// 요약 단계 한 번의 결과(index.ts stepOnce — 서버 정리 작업과 같은 코드) → 잇기 작업에 저장할 모양.
// 요약이 다 끝났으면(서버 정리 작업의 done 자리) 끝내지 않고 apply 단계로 넘기며 회의 결과 글을 함께 둔다.
// needsReview: 요약 답을 그대로 읽지 못해 원문을 보존했거나 칸이 어긋난 초안(meeting-ai-draft/parse.mjs warnings). 서버 정리 작업은 사람이
// 초안 창에서 보고 저장하지만 잇기는 검수 없이 보고에 저장하므로, 이런 초안과 빈 글은 저장하지 않고 멈춘다(draft_failed — 보고는 그대로).
export function joinAfterSummary(next, needsReview = false) {
  if (!next || next.status !== 'done') return next;
  if (needsReview) throw new Fail('draft_failed');
  const result = joinResultText(next.draft);
  if (!result) throw new Fail('draft_failed');
  const { finished_at: _finished, ...rest } = next;
  return { ...rest, status: 'queued', stage: 'apply', result_text: result };
}

// 없어질 보고의 글 지문: 그 글(없으면 빈 글)의 UTF-8 SHA-256, 소문자 16진수 64자(DB 함수 app_meeting_join_apply와 같은 방법).
export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text ?? '')));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// join_start 몸통: {target_meeting_id, source:{job_id}} | {target_meeting_id, source:{meeting_id}}.
// 작업공간·소유 값은 받지 않는다(몸통에 있어도 읽지 않는다 — 서버가 고른 보고 행에서 정한다).
export function parseJoinStart(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b) || !isUuid(b.target_meeting_id)) return null;
  const s = b.source;
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  const keys = Object.keys(s);
  if (keys.length !== 1) return null;
  if (keys[0] === 'job_id' && isUuid(s.job_id)) return { targetId: b.target_meeting_id, mode: 'job', sourceJobId: s.job_id };
  if (keys[0] === 'meeting_id' && isUuid(s.meeting_id) && s.meeting_id !== b.target_meeting_id) return { targetId: b.target_meeting_id, mode: 'report', sourceMeetingId: s.meeting_id };
  return null;
}
// join_text 머리글: x-target-meeting-id, x-record-jobs(붙일 녹음 작업 id, 쉼표, 20개까지), Content-Length 필수.
export function parseJoinText({ target, records, length }) {
  if (!isUuid(target)) return null;
  const size = Number(length);
  if (!Number.isSafeInteger(size) || size <= 0) return null;
  if (size > JOIN_TEXT_MAX_BYTES) throw new Fail('text_too_long');
  const raw = String(records ?? '').trim();
  const ids = raw ? raw.split(',').map((x) => x.trim()) : [];
  if (ids.length > JOIN_RECORD_MAX || ids.some((x) => !isUuid(x)) || new Set(ids).size !== ids.length) return null;
  return { targetId: target, mode: 'text', recordJobIds: ids };
}
// 몸통(전사 글)을 한도까지만 읽는다. 넘치면 text_too_long, UTF-8이 아니면 bad_request.
// (길이 초과를 bad_request로 답하지 않는다 — 화면은 400 bad_request를 '옛 서버가 이 action을 모름'으로도 읽는다, app/meeting-server-job.mjs unavailable.)
export async function boundedText(body, max = JOIN_TEXT_MAX_BYTES) {
  if (!body) throw new Fail('bad_request');
  const reader = body.getReader(), chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel().catch(() => undefined); throw new Fail('text_too_long'); }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(all); } catch { throw new Fail('bad_request'); }
}

// 진행 중인 잇기 작업들과 겹치는가(3-1절 6·3-5절). 고른 보고·없어질 보고가 어떤 역할로든 걸려 있거나 같은 녹음 결과를 쓰는 중이면 busy,
// 같은 보고에 같은 재료로 이미 잇는 중이면 그 작업(same). 글(mode text)이 같은지는 부른 쪽이 그 행의 글로 한 번 더 본다.
export function joinConflict(active, want) {
  const ids = [want.targetId, want.sourceMeetingId].filter(Boolean);
  let same = null, busy = false;
  for (const r of Array.isArray(active) ? active : []) {
    if (!r || !ACTIVE.includes(r.status)) continue;
    const touches = ids.includes(r.target_meeting_id) || (!!r.source_meeting_id && ids.includes(r.source_meeting_id))
      || (!!want.sourceJobId && r.source_job_id === want.sourceJobId);
    if (!touches) continue;
    const alike = r.target_meeting_id === want.targetId && r.mode === want.mode
      && (want.mode === 'job' ? r.source_job_id === want.sourceJobId : want.mode === 'report' ? r.source_meeting_id === want.sourceMeetingId : true);
    if (alike && !same) same = r; else busy = true;
  }
  return busy ? { busy: true } : same ? { same } : null;
}

// 넣을 행. 넣기 권한이 있는 칸만 쓴다(id·시각·적용 기록 칸은 DB가 채운다). 합치기 전 두 글은 시작할 때 읽은 그대로.
export function joinRow({ workspaceId, userId, want, target, material, merged }) {
  return {
    workspace_id: workspaceId, created_by: userId, mode: want.mode, target_meeting_id: target.id,
    source_job_id: want.mode === 'job' ? material.sourceJobId : null,
    source_meeting_id: want.mode === 'report' ? material.sourceMeetingId : null,
    source_text: want.mode === 'text' ? material.text : null,
    source_record_jobs: material.recordJobs || [],
    source_result_sha: material.resultSha ?? null, source_notes_sha: material.notesSha ?? null,
    before_result: target.transcript_text ?? null, before_notes: target.notes ?? null,
    status: 'queued', stage: 'summary', step_no: 0, step_total: summaryPlan(merged, []).total, summary_parts: [], transcript_text: merged,
  };
}
// 고칠 몸통. 고치기 권한이 있는 칸만 받는다(합치기 전 글·재료·적용/되돌리기 기록 칸은 DB 함수만 쓴다). 다른 칸이 섞이면 코드 잘못이라 던진다.
export function joinPatch(patch, nowIso) {
  for (const k of Object.keys(patch)) if (!JOIN_UPDATE_COLUMNS.includes(k)) throw new Error('join_patch_column');
  return { ...patch, updated_at: nowIso };
}

// 화면에 줄 모양. 글(전문·회의 결과·합치기 전 글·할 일 후보)은 싣지 않는다 — 화면이 자기 로그인(owner 읽기)으로 그 행을 직접 읽는다.
export function joinView(row) {
  if (!row) return null;
  return {
    id: row.id, mode: row.mode, status: row.status, stage: row.stage, step_no: row.step_no ?? 0, step_total: row.step_total ?? 0,
    error_code: row.error_code ?? null, target_meeting_id: row.target_meeting_id, source_job_id: row.source_job_id ?? null,
    source_meeting_id: row.source_meeting_id ?? null, applied_at: row.applied_at ?? null, undone_at: row.undone_at ?? null,
    seen_at: row.seen_at ?? null, candidates_closed_at: row.candidates_closed_at ?? null, created_at: row.created_at, finished_at: row.finished_at ?? null,
  };
}

// DB 함수(apply·undo)의 오류 → 실패 코드. 함수는 고정 글자 예외 6개만 던진다. 글자가 정확히 그것일 때만 바꾸고 그 밖은 failed.
// 함수·표가 없으면(적용 전) jobs_unavailable('모름'). 오류 글은 로그·응답에 싣지 않는다.
const RPC_CODES = Object.freeze({
  JOIN_REPORT_CHANGED: 'report_changed', JOIN_REPORT_GONE: 'report_gone', JOIN_SOURCE_CHANGED: 'source_changed',
  JOIN_SOURCE_GONE: 'source_gone', JOIN_ALREADY_JOINED: 'already_joined', JOIN_NOT_APPLIED: 'not_applied',
});
export function joinRpcCode(error) {
  if (!error) return '';
  const code = String(error.code || '');
  if (['PGRST202', '42883', '42P01', 'PGRST205'].includes(code)) return 'jobs_unavailable';
  const text = String(error.message || '').trim();
  return Object.hasOwn(RPC_CODES, text) ? RPC_CODES[text] : 'failed';
}
// apply 함수의 답 → done(이번에 적용했거나 앞 실행이 이미 적용함) · not_found · failed(적용할 차례가 아님).
export function applyOutcome(data) {
  const d = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  if (d.applied === true) return 'done';
  if (d.found === true && d.status === 'done' && d.applied_at) return 'done';
  return d.found === false ? 'not_found' : 'failed';
}

// job_list에서 뺄 녹음 결과: 지금 잇는 중인 것(잇기가 끝나기 전에 다른 기기에서 [초안 열기] → 새 보고 저장으로 같은 녹음이 두 보고에 들어가지 않게).
// 잇기가 실패하면 다시 보인다.
export const joiningSources = (rows) => new Set((Array.isArray(rows) ? rows : []).filter((r) => r && ACTIVE.includes(r.status) && isUuid(r.source_job_id)).map((r) => r.source_job_id));

// 같은 날 녹음으로 쓴 보고(3-3절): ① 서버 정리 작업이 연결된 보고 ② 녹음 자료 행(태그 '회의녹음')이 붙은 보고. 돌려주는 것은 보고 id와 녹음 길이(초)뿐.
export function pickCandidates(meetings, { docs = [], serverJobs = [], records = [] } = {}) {
  const has = new Set(), recorded = new Map(), summed = new Map();
  const add = (map, id, n) => map.set(id, (map.get(id) || 0) + (Number(n) || 0));
  for (const d of docs) if (d?.meeting_id) has.add(d.meeting_id);
  for (const j of serverJobs) if (j?.meeting_id && j.status === 'done') { has.add(j.meeting_id); add(summed, j.meeting_id, partSeconds(j.parts)); }
  for (const r of records) if (r?.meeting_id && !r.trashed_at) add(recorded, r.meeting_id, r.duration_sec);
  return (Array.isArray(meetings) ? meetings : []).filter((m) => m && has.has(m.id))
    .sort((a, b) => (atMs(a.meeting_at) ?? 0) - (atMs(b.meeting_at) ?? 0))
    .map((m) => ({ meeting_id: m.id, seconds: Math.round(recorded.get(m.id) || summed.get(m.id) || 0) }));
}

// ---- 사용자 입구 흐름(io = index.ts joinIo). 부르기 전에 index.ts가 로그인(userOf)을 확인한다. ----
// io.user*: 부른 사람 로그인(owner RLS·휴지통 숨김)으로 읽기. 그 밖: owner 확인 뒤에만 부르는 서비스 권한.
const notFound = () => new Fail('not_found');

// 잇기 작업 한 행을 부른 사람 것으로 읽는다. 없는 것·남의 것·다른 작업공간 것은 구분 없이 not_found.
async function ownJoin(io, userId, id, columns = JOIN_VIEW_COLUMNS) {
  if (!isUuid(id)) throw new Fail('bad_request');
  const job = await io.userJoinJob(id, columns);
  if (!job || job.created_by !== userId) throw notFound();
  if (!(await io.isOwner(userId, job.workspace_id))) throw notFound();
  return job;
}

// 붙일 녹음 작업 확인: 같은 작업공간·내가 만든 것·끝남·휴지통 아님·아직 다른 회의에 안 붙음(지금 attach가 하는 확인과 같게).
// strict(화면이 보낸 id, join_text)면 하나라도 어긋나면 거절. 서버 정리 작업에서 꺼낸 id면 붙일 수 없는 것(없음·휴지통)은 빼고 잇는다.
// 다른 회의에 붙은 녹음은 어느 쪽이든 already_joined(같은 녹음이 두 보고에 들어가지 않게).
async function attachable(io, ids, { workspaceId, userId, targetId, strict }) {
  if (!ids.length) return [];
  const byId = new Map((await io.recordJobs(workspaceId, ids)).map((r) => [r.id, r]));
  const out = [];
  for (const id of ids) {
    const r = byId.get(id);
    if (!r || r.workspace_id !== workspaceId || r.created_by !== userId) { if (strict) throw notFound(); continue; }
    if (r.meeting_id && r.meeting_id !== targetId) throw new Fail('already_joined');
    if (r.status !== 'done' || r.trashed_at) { if (strict) throw new Fail('not_done'); continue; }
    out.push(id);
  }
  return out;
}
// 그 보고에 연결된 서버 정리 작업의 전문(회의록 전문 칸이 빈 보고의 앞 글). 시간순으로 잇는다.
async function linkedText(io, workspaceId, meetingId, exceptJobId = '') {
  const rows = (await io.linkedTranscripts(workspaceId, meetingId)).filter((r) => r && r.id !== exceptJobId && hasWords(r.transcript_text));
  return rows.map((r) => String(r.transcript_text).trim()).join(`\n\n${joinMark(null)}\n`);
}

// 잇는 재료(3-1절 5). 고른 보고의 owner 확인이 끝난 뒤에만 부른다.
async function readMaterial(io, userId, want, target) {
  const workspaceId = target.workspace_id;
  if (want.mode === 'job') {
    // 서버 정리 작업: 작업공간 owner + 만든 사람(ownServerJob) + 보고와 같은 작업공간·끝남·아직 다른 보고에 쓰이지 않음.
    const job = await io.ownServerJob(userId, want.sourceJobId);
    if (!job || job.workspace_id !== workspaceId || job.created_by !== userId) throw notFound();
    if (job.status !== 'done') throw new Fail('not_done');
    if (job.error_code === 'discarded') throw notFound(); // REC-초안버리기: 쓰지 않기로 한 결과는 잇지 않는다(되돌리면 다시 이을 수 있음)
    if (job.meeting_id && job.meeting_id !== target.id) throw new Fail('already_joined');
    // 그 자리 전사(attached)는 그 회의의 자료라 고른 보고가 그 회의여야 한다.
    if (job.kind === 'attached' && job.meeting_id !== target.id) throw notFound();
    if (!hasWords(job.transcript_text)) throw new Fail('empty_transcript');
    const recordJobs = await attachable(io, recordJobIds(job), { workspaceId, userId, targetId: target.id, strict: false });
    return { text: job.transcript_text, at: recordingStartMs(job), sourceJobId: job.id, recordJobs };
  }
  if (want.mode === 'report') {
    // 합칠 보고도 부른 사람 로그인으로 읽는다. 같은 작업공간·고른 보고와 다른 행·[회의] 칸.
    const source = await io.userMeeting(want.sourceMeetingId);
    if (!source || source.deleted_at || source.workspace_id !== workspaceId || source.id === target.id) throw notFound();
    if (!isMeetingReport(source)) throw new Fail('bad_target');
    let text = String(source.notes || '');
    if (!hasWords(text)) text = await linkedText(io, workspaceId, source.id);
    if (!hasWords(text)) throw new Fail('no_first_transcript');
    return {
      text, at: atMs(source.meeting_at), sourceMeetingId: source.id, recordJobs: [],
      resultSha: await sha256Hex(source.transcript_text ?? ''), notesSha: await sha256Hex(source.notes ?? ''),
    };
  }
  const text = cleanText(want.text);
  if (text.length > JOIN_TEXT_MAX_CHARS) throw new Fail('text_too_long');
  if (!hasWords(text)) throw new Fail('empty_transcript');
  const recordJobs = await attachable(io, want.recordJobIds || [], { workspaceId, userId, targetId: target.id, strict: true });
  return { text, at: null, recordJobs };
}

// 잇기·합치기 시작(join_start·join_text, 그리고 [다시]의 '처음부터'). want = parseJoinStart·parseJoinText의 결과(+ text).
// 돌려줌: {job, existing} — 같은 보고에 같은 재료로 이미 잇는 중이면 그 작업을 그대로 돌려준다(existing true).
export async function startJoin(io, userId, want) {
  // 2. 고른 보고를 부른 사람 로그인으로 읽는다. 못 읽으면 없는 것·남의 것·휴지통 구분 없이 not_found.
  const target = await io.userMeeting(want.targetId);
  if (!target || target.deleted_at) throw notFound();
  // 3. 작업공간 = 읽은 보고 행의 값. 그 값으로 owner를 한 번 더 확인한다(다른 action과 같은 기준).
  const workspaceId = target.workspace_id;
  if (!(await io.isOwner(userId, workspaceId))) throw notFound();
  // 4. [회의] 칸만.
  if (!isMeetingReport(target)) throw new Fail('bad_target');
  // 5. 잇는 재료.
  const material = await readMaterial(io, userId, want, target);
  // 6. 고른 보고·없어질 보고·그 녹음 결과가 다른 진행 중 잇기 작업에 걸려 있지 않아야 한다.
  const conflictWant = { targetId: target.id, mode: want.mode, sourceJobId: material.sourceJobId || '', sourceMeetingId: material.sourceMeetingId || '' };
  const existing = async () => {
    const clash = joinConflict(await io.activeJoins(workspaceId), conflictWant);
    if (!clash) return null;
    if (clash.busy) throw new Fail('busy');
    if (want.mode === 'text' && (await io.joinSourceText(workspaceId, clash.same.id)) !== material.text) throw new Fail('busy');
    return clash.same;
  };
  const answer = (job) => { if (needsKick(job, io.now())) io.kick(job.id); return { job, existing: true }; };
  const open = await existing();
  if (open) return answer(open);
  // 7. 앞 글: 고른 보고의 회의록 전문, 없으면 그 보고에 연결된 서버 정리 작업의 전문. 둘 다 없으면 시작하지 않는다(보고는 그대로).
  let first = String(target.notes || '');
  if (!hasWords(first)) first = await linkedText(io, workspaceId, target.id, material.sourceJobId || '');
  if (!hasWords(first)) throw new Fail('no_first_transcript');
  const merged = joinTranscripts({ targetText: first, targetAt: atMs(target.meeting_at), sourceText: material.text, sourceAt: material.at });
  if (merged.length > JOIN_TEXT_MAX_CHARS || String(target.transcript_text || '').length > JOIN_TEXT_MAX_CHARS) throw new Fail('text_too_long');
  // 8. 작업 한 행. 유일 색인에 걸리면(동시에 두 번) 진행 중인 같은 작업을 돌려주고, 이미 이어 붙인 녹음이면 already_joined, 그 밖은 busy.
  const made = await io.insertJoin(joinRow({ workspaceId, userId, want, target, material, merged }));
  if (made.conflict) {
    const again = await existing();
    if (again) return answer(again);
    const joined = want.mode === 'job' && (await io.sourceJoined(workspaceId, material.sourceJobId));
    throw new Fail(joined ? 'already_joined' : 'busy');
  }
  io.kick(made.job.id);
  return { job: made.job, existing: false };
}

// join_read: 진행 보기. 멈춘 것처럼 보이면 다시 깨운다.
export async function readJoin(io, userId, body) {
  const job = await ownJoin(io, userId, body?.job_id);
  if (needsKick(job, io.now())) io.kick(job.id);
  return { job };
}
// join_list {}: 로그인한 사람이 owner인 작업공간의, 그 사람이 만든 작업만 — 지난 48시간의 진행 중·실패·끝났는데 아직 닫지 않은 것.
// 작업공간을 몸통으로 받지 않는다. 결과 글은 싣지 않는다.
export async function listJoins(io, userId) {
  const workspaces = await io.ownerWorkspaces(userId);
  const since = new Date(io.now() - LIST_HOURS * 3600000).toISOString();
  const rows = (await io.userJoinList(workspaces, userId, since))
    .filter((r) => r && r.created_by === userId && workspaces.includes(r.workspace_id) && !r.seen_at && LIST_STATUS.includes(r.status));
  for (const r of rows) if (needsKick(r, io.now())) io.kick(r.id);
  return { jobs: rows };
}
// join_seen {job_id, candidates?}: 끝 알림을 닫음 / 새 할 일 후보를 닫음. 진행 중인 작업의 알림은 닫지 않는다(진행 줄이 사라지지 않게).
export async function seenJoin(io, userId, body) {
  if (body?.candidates !== undefined && typeof body.candidates !== 'boolean') throw new Fail('bad_request');
  const job = await ownJoin(io, userId, body?.job_id);
  const nowIso = new Date(io.now()).toISOString(), patch = {};
  if (body.candidates === true) { if (!job.candidates_closed_at) patch.candidates_closed_at = nowIso; }
  else if (!ACTIVE.includes(job.status) && !job.seen_at) patch.seen_at = nowIso;
  if (Object.keys(patch).length) await io.patchJoin(job.id, patch);
  return {};
}
// join_retry {job_id}: 실패한 작업 다시. 그 사이 보고 글이 바뀌어 멈춘 것(report_changed·source_changed)은 처음부터 — 같은 보고·같은 재료로
// 시작 확인을 다시 거쳐 새 작업 행을 만든다(앞 행은 실패로 남기고 알림만 닫는다). 그 밖은 멈춘 단계부터.
export async function retryJoin(io, userId, body) {
  const job = await ownJoin(io, userId, body?.job_id, JOIN_RETRY_COLUMNS);
  if (job.status !== 'failed') { if (needsKick(job, io.now())) io.kick(job.id); return { job, restarted: false }; }
  if (RESTART_CODES.includes(job.error_code)) {
    // 이미 [다시]로 새 작업을 만든(알림을 닫은) 실패 행은 또 쓰지 않는다 — 갱신 안 된 다른 기기가 같은 재료를 한 번 더 잇지 않게.
    if (job.seen_at) throw notFound();
    const want = job.mode === 'job' ? { targetId: job.target_meeting_id, mode: 'job', sourceJobId: job.source_job_id }
      : job.mode === 'report' ? { targetId: job.target_meeting_id, mode: 'report', sourceMeetingId: job.source_meeting_id }
      : { targetId: job.target_meeting_id, mode: 'text', text: job.source_text, recordJobIds: Array.isArray(job.source_record_jobs) ? job.source_record_jobs : [] };
    if (!isUuid(want.targetId) || (want.mode === 'job' && !isUuid(want.sourceJobId)) || (want.mode === 'report' && !isUuid(want.sourceMeetingId))
      || (want.mode === 'text' && typeof want.text !== 'string')) throw new Fail('source_gone');
    const out = await startJoin(io, userId, want);
    await io.patchJoin(job.id, { seen_at: new Date(io.now()).toISOString() }).catch(() => undefined);
    return { job: out.job, restarted: true };
  }
  // 그 사이 고른 보고·없어질 보고·그 녹음 결과가 다른 진행 중 잇기 작업에 걸렸으면 다시 돌리지 않는다(시작할 때와 같은 확인, 3-1절 6).
  const clash = joinConflict(await io.activeJoins(job.workspace_id),
    { targetId: job.target_meeting_id, mode: job.mode, sourceJobId: job.source_job_id || '', sourceMeetingId: job.source_meeting_id || '' });
  if (clash) throw new Fail('busy');
  const patch = { status: 'queued', error_code: null, finished_at: null, lease_until: null, attempts: 0 };
  // 요약이 시간 안에 끝나지 못해 멈췄으면 다시 할 때는 반으로 나눠 잇는다(job_retry와 같은 규칙).
  if (job.stage === 'summary' && SPLIT_CODES.includes(job.error_code)) {
    const split = splitJobSummary(job);
    if (split) patch.summary_parts = split;
  }
  const rows = await io.patchJoin(job.id, patch, { status: 'failed' });
  const row = rows[0] || job;
  io.kick(row.id);
  return { job: row, restarted: false };
}
// join_undo {job_id, scope}: 회의 결과를 합치기 전 글로(before) / 이은 글로(joined) / 통째로 되돌리기(all).
// 로그인·소유를 확인한 뒤 DB 함수 app_meeting_join_undo를 부른다(함수가 조건을 SQL로 다시 본다).
export async function undoJoin(io, userId, body) {
  if (!UNDO_SCOPES.includes(body?.scope)) throw new Fail('bad_request');
  const job = await ownJoin(io, userId, body?.job_id);
  const out = await io.undo(job.id, body.scope);
  return { scope: body.scope, undone: out?.undone === true, kept: out?.kept === true };
}
// join_candidates {job_id} | {meeting_id}: 같은 날(서울) 녹음으로 쓴 [회의] 보고의 id·녹음 길이. 이름·시각은 싣지 않는다(화면이 자기 목록에서 붙인다).
// 보고 목록·녹음 자료 행은 부른 사람 로그인으로 읽고(휴지통 숨김), 녹음 길이만 서비스 권한으로 그 작업공간·그 보고 id로 걸러 읽는다.
export async function joinCandidates(io, userId, body) {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const byJob = isUuid(b.job_id) && b.meeting_id === undefined, byMeeting = isUuid(b.meeting_id) && b.job_id === undefined;
  if (!byJob && !byMeeting) throw new Fail('bad_request');
  let workspaceId, dayMs, skipMeeting = '', skipJob = '';
  if (byJob) {
    const job = await io.ownServerJob(userId, b.job_id);
    if (!job || job.created_by !== userId) throw notFound();
    workspaceId = job.workspace_id; skipJob = job.id;
    dayMs = recordingStartMs(job) ?? atMs(job.created_at);
  } else {
    const meeting = await io.userMeeting(b.meeting_id);
    if (!meeting || meeting.deleted_at) throw notFound();
    if (!(await io.isOwner(userId, meeting.workspace_id))) throw notFound();
    workspaceId = meeting.workspace_id; skipMeeting = meeting.id;
    dayMs = atMs(meeting.meeting_at);
  }
  // 표가 아직 없으면(적용 전) '모름'(jobs_unavailable) — 화면은 묻지 않고 지금 길로 간다.
  await io.joinReady();
  if (!Number.isFinite(dayMs)) return { candidates: [] };
  const [from, to] = seoulDayRange(dayMs);
  const meetings = (await io.userMeetingsOfDay(workspaceId, from, to))
    .filter((m) => m && m.workspace_id === workspaceId && !m.deleted_at && isMeetingReport(m) && m.id !== skipMeeting);
  if (!meetings.length) return { candidates: [] };
  const ids = meetings.map((m) => m.id);
  const [docs, serverJobs, records] = await Promise.all([
    io.userRecordingDocs(workspaceId, ids), io.linkedServerJobs(workspaceId, ids), io.linkedRecordJobs(workspaceId, ids),
  ]);
  return { candidates: pickCandidates(meetings, { docs, serverJobs: serverJobs.filter((j) => j && j.id !== skipJob), records }) };
}
