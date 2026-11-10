// REC-서버정리 · MTG-첨부녹음전사(S49-2, 설계 docs/design/meeting-transcript-server.md 4·8절): 서버 정리 작업의 순수 규칙.
// 표 app_meeting_server_jobs(migration 20261103170000) 한 행 = 녹음 한 건(kind recording) 또는 회의자료 소리 파일 하나(kind attached).
// 단계: combine(구간 합치기, recording만) → transcribe(구간·파일 하나씩) → summary(요약 한 번씩, 긴 글은 조각 → 합치기) → done.
// 한 번의 서버 호출은 한 단계만 하고 같은 함수의 job_tick을 다시 불러 다음 단계로 간다(index.ts). 여기서는 DB·네트워크를 쓰지 않는다.
import { DRAFT_ONE_CHARS, splitTranscript } from '../_shared/meeting-draft-prompt.mjs';

export const SERVER_JOB_TABLE = 'app_meeting_server_jobs';
export const SERVER_JOB_COLUMNS = 'id,workspace_id,created_by,kind,session_id,document_id,meeting_id,source_file_id,source_md5,status,stage,step_no,step_total,parts,summary_parts,transcript_text,draft,error_code,lease_until,attempts,started_at,finished_at,opened_at,created_at,updated_at';
export const LEASE_MS = 9 * 60 * 1000;          // 한 단계를 잡아 두는 시간(전사 한 번 최대 380초 + 여유)
export const TICK_TTL_MS = 10 * 60 * 1000;      // job_tick 열쇠 기한
export const STALE_MS = 60 * 1000;              // 잡은 사람이 없는 채 이만큼 지나면 화면 확인(job_read)이 다시 깨운다
export const MAX_ATTEMPTS = 300;                // 단계 시도 상한(끝없는 되풀이 막기)
// 서버 정리가 잡은 구간 전사가 이만큼 넘게 '진행 중'이면 죽은 실행이다(REC-정리멈춤반복). Edge 한 번 실행은 이보다 짧고,
// 같은 단계를 다시 잡는 것은 앞 잡기(LEASE_MS 9분)가 지난 뒤뿐이라 그때 남은 '진행 중'은 끊긴 앞 실행의 흔적이다.
export const SEGMENT_DEAD_MS = 8 * 60 * 1000;
// 단계가 서버 실행 시간 안에 끝나지 못하고 끊긴 것을 이만큼 보면 실패(step_cut)로 멈춘다(같은 단계를 끝없이 다시 잡지 않게).
export const MAX_STEP_CUTS = 2;
export const LIST_HOURS = 48;                   // job_list가 보여 주는 기간
export const TICK_HEADER = 'x-meeting-job-tick';
export const KINDS = Object.freeze(['recording', 'attached']);
export const ACTIVE = Object.freeze(['queued', 'running']);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (v) => typeof v === 'string' && UUID.test(v);

// ---- job_tick 열쇠: 서버 키로 만든 HMAC(작업 id·기한에 묶임). 새 비밀값을 두지 않는다. 화면은 받지 않는다. ----
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function hmac(key, text) {
  const k = await crypto.subtle.importKey('raw', enc.encode(`meeting-job-tick:${key}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, enc.encode(text)));
}
export function tickSign(key, jobId, exp) {
  if (!key || !isUuid(jobId) || !Number.isSafeInteger(exp)) throw new Error('tick_sign');
  return hmac(key, `${jobId}.${exp}`);
}
// 맞으면 true. 열쇠 없음·모양 틀림·기한 지남·너무 먼 기한·서명 다름 = false. 비교는 고정 길이.
export async function tickCheck(key, body, sig, nowMs) {
  if (!key || typeof sig !== 'string' || !/^[0-9a-f]{64}$/.test(sig)) return false;
  if (!body || typeof body !== 'object' || Object.keys(body).sort().join(',') !== 'exp,job_id') return false;
  const { job_id: jobId, exp } = body;
  if (!isUuid(jobId) || !Number.isSafeInteger(exp) || exp < nowMs || exp > nowMs + TICK_TTL_MS + 60000) return false;
  const want = await hmac(key, `${jobId}.${exp}`);
  let diff = 0;
  for (let i = 0; i < 64; i++) diff |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

// ---- 시작 몸통 ----
// {workspace_id, kind:'recording', session_id} | {workspace_id, kind:'attached', document_id}
export function parseStart(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return null;
  const keys = Object.keys(b).sort().join(',');
  if (!isUuid(b.workspace_id)) return null;
  if (b.kind === 'recording' && keys === 'kind,session_id,workspace_id' && isUuid(b.session_id)) return { workspaceId: b.workspace_id, kind: 'recording', sessionId: b.session_id };
  if (b.kind === 'attached' && keys === 'document_id,kind,workspace_id' && isUuid(b.document_id)) return { workspaceId: b.workspace_id, kind: 'attached', documentId: b.document_id };
  return null;
}

// 회의자료 소리 파일인가(B). 회의자료 행의 이름·형식·크기·Drive id로 본다.
const AUDIO_EXT = ['m4a', 'mp4', 'aac', 'mp3', 'wav', 'ogg', 'oga', 'opus', 'flac', 'webm', '3gp', 'amr', 'mpga', 'mpeg'];
export function audioDocument(doc, maxBytes) {
  if (!doc || typeof doc !== 'object') return { ok: false, code: 'not_found' };
  const id = String(doc.file_id || '');
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(id)) return { ok: false, code: 'not_found' };
  const name = String(doc.file_name || doc.title || '');
  const ext = (name.toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || '';
  const mime = String(doc.mime_type || '').toLowerCase();
  if (!(/^(audio|video)\//.test(mime) || AUDIO_EXT.includes(ext))) return { ok: false, code: 'bad_type' };
  const size = Number(doc.file_size);
  if (Number.isFinite(size) && size > maxBytes) return { ok: false, code: 'too_large' };
  return { ok: true, fileId: id, name: name.slice(0, 200) || '녹음' };
}

// ---- 단계 ----
// rec_finish와 같은 구간 목록 → 전사할 구간. 합친(combined) 구간만, 번호 순. 빈 구간은 뺀다. 합치기 실패 구간은 글 없이(건너뜀).
export function recordingParts(segments) {
  const list = (Array.isArray(segments) ? segments : []).filter((s) => s && s.status !== 'empty').slice().sort((a, b) => a.segment_no - b.segment_no);
  return list.map((s) => ({
    no: s.segment_no, seconds: Number(s.duration_sec) || 0,
    job: s.status === 'combined' && s.job_id ? s.job_id : null,
    text: s.status === 'combined' && s.job_id ? null : '',
  }));
}
// 다음에 전사할 조각 번호(배열 자리). 없으면 -1.
export const nextPart = (parts) => (Array.isArray(parts) ? parts : []).findIndex((p) => p && p.text === null);
export const doneParts = (parts) => (Array.isArray(parts) ? parts : []).filter((p) => p && p.text !== null && (p.job || p.file)).length;
export const partTotal = (parts) => (Array.isArray(parts) ? parts : []).filter((p) => p && (p.job || p.file)).length;

// 구간 글 합치기(화면 meeting-recorder-model.mjs joinSegmentTexts와 같은 머리 줄).
const minuteText = (m) => { const n = Math.round(m); const h = Math.floor(n / 60), r = n % 60; return h ? (r ? `${h}시간 ${r}분` : `${h}시간`) : `${r}분`; };
export function joinParts(parts) {
  const list = (Array.isArray(parts) ? parts : []).slice().sort((a, b) => a.no - b.no);
  let offset = 0; const out = [];
  for (const p of list) {
    const head = offset > 0 ? `― ${minuteText(offset / 60)}부터 ―` : '';
    const text = String(p.text ?? '').trim();
    if (text) out.push(head ? `${head}\n${text}` : text);
    offset += Math.max(0, Number(p.seconds) || 0);
  }
  return out.join('\n\n');
}
// 전사 글 정리(화면 cleanTranscript와 같은 규칙, 자막 파일 줄 빼기는 없음).
export const cleanText = (text) => String(text || '').replace(/\r\n?/g, '\n').split('\0').join('').split('\n').map((l) => l.replace(/\s+$/, '')).join('\n').replace(/\n{3,}/g, '\n\n').trim();
export const hasWords = (text) => !!String(text || '').replace(/^―.*―$/gm, '').trim();

// ---- 요약 반 나눔 표시(설계 9절): 답이 잘린(draft_cut) 조각 자리에 {halves:[끝난 반 요약…]}를 두고 한 단계에 반 하나씩. ----
export const isHalfMark = (o) => !!o && typeof o === 'object' && !Array.isArray(o) && Array.isArray(o.halves) && Object.keys(o).length === 1 && o.halves.length < 2;
export const halfMark = () => ({ halves: [] });

// 요약이 시간 안에 끝나지 못한 이유(요청 시간 초과 · 실행이 끊김) — 같은 크기로 다시 하면 또 걸리므로 반으로 나눠 잇는다.
export const SPLIT_CODES = Object.freeze(['draft_cut', 'draft_timeout', 'draft_step_cut', 'step_cut']);
// 지금 요약할 조각(한 번 요약 'one' 또는 조각 요약 'part')을 반 나눔 표시로 바꾼 summary_parts. 나눌 수 없으면 null.
export function splitSummary(transcript, summaryParts) {
  const list = Array.isArray(summaryParts) ? summaryParts : [];
  const plan = summaryPlan(transcript, list);
  if (plan.kind === 'one' && halves(plan.pieces[0] || '')) return [halfMark()];
  if (plan.kind === 'part' && halves(plan.pieces[plan.next] || '')) return [...list, halfMark()];
  return null;
}

// 작업 행 그대로(요약할 글·끝난 조각 요약)로 나눔(stepOnce의 끊긴 뒤·jobRetry).
export const splitJobSummary = (job) => splitSummary(job?.transcript_text, job?.summary_parts);

// 요약 단계 계획: 조각이 하나면 한 번, 아니면 조각마다 + 합치기 한 번. count = 합칠 부분 요약 수.
// 조각이 하나인데 답이 길어 잘려(draft_cut) 반으로 나눠 요약해 둔 경우(조각 요약 2개)는 그 둘을 합친다(REC-정리멈춤반복).
// 마지막 항목이 반 나눔 표시면 kind 'half': at = 그 조각 자리, half = 이번에 요약할 반(0·1).
export function summaryPlan(transcript, summaryParts) {
  const pieces = splitTranscript(transcript);
  const list = Array.isArray(summaryParts) ? summaryParts : [];
  const last = list[list.length - 1];
  if (list.length && isHalfMark(last)) {
    const at = list.length - 1, single = pieces.length <= 1;
    const piece = single ? pieces[0] || '' : pieces[at] || '';
    return { kind: 'half', pieces, piece, at, half: last.halves.length, single, total: single ? 3 : pieces.length + 1, next: at, count: single ? 2 : pieces.length };
  }
  const done = list.length;
  if (pieces.length <= 1) {
    if (done >= 2) return { kind: 'merge', pieces, total: done + 1, next: done, count: done };
    return { kind: 'one', pieces, total: 1, next: 0, count: 0 };
  }
  if (done < pieces.length) return { kind: 'part', pieces, total: pieces.length + 1, next: done, count: pieces.length };
  return { kind: 'merge', pieces, total: pieces.length + 1, next: pieces.length, count: pieces.length };
}

// 요약 답이 길어 잘린(draft_cut) 조각을 반으로 나눈다: 가운데에서 가장 가까운 줄바꿈, 없으면 가운데 글자.
// 너무 짧아(MIN_HALF_CHARS × 2 미만) 나눠도 소용없으면 null.
export const MIN_HALF_CHARS = 2000;
export function halves(text) {
  const all = String(text || '').trim();
  if (all.length < MIN_HALF_CHARS * 2) return null;
  const mid = Math.floor(all.length / 2);
  const before = all.lastIndexOf('\n', mid), after = all.indexOf('\n', mid);
  let at = mid;
  const cands = [before, after].filter((i) => i > MIN_HALF_CHARS && i < all.length - MIN_HALF_CHARS);
  if (cands.length) at = cands.reduce((a, b) => (Math.abs(b - mid) < Math.abs(a - mid) ? b : a));
  const a = all.slice(0, at).trim(), b = all.slice(at).trim();
  return a && b ? [a, b] : null;
}
// 반으로 나눠 요약한 두 조각 요약(normalizeDraft 모양) → 한 조각 요약. 합치기 단계(AI)가 겹침을 정리하므로 여기서는 잇기만 한다.
export function combineDrafts(list) {
  const drafts = (Array.isArray(list) ? list : []).filter((d) => d && typeof d === 'object');
  if (!drafts.length) return null;
  const join = (k) => drafts.map((d) => String(d[k] || '').trim()).filter(Boolean).join('\n');
  return {
    decisions: join('decisions'), information: join('information'),
    actions: drafts.flatMap((d) => (Array.isArray(d.actions) ? d.actions : [])),
    attendees: [...new Set(drafts.flatMap((d) => (Array.isArray(d.attendees) ? d.attendees : [])))],
    meetingDate: drafts.map((d) => d.meetingDate).find(Boolean) || '',
  };
}

// 단계를 잡기 직전의 행 → 이번에 잡을 수 있나 · 앞 실행이 끊겼나(cut 0·1·2).
// 정상으로 끝난 단계(성공·실패)는 언제나 lease_until을 비운다. 기한이 지난 lease_until이 남아 있으면 앞 실행이 단계 중간에
// 끝난 것(Edge 실행 시간 한도·플랫폼 재시작)이다. 처음 보면 표시(error_code step_cut)만 하고 한 번 더 하고, 같은 단계에서 또 보면 실패.
export function leaseTake(row, nowMs) {
  if (!row || !ACTIVE.includes(row.status)) return { ok: false, cut: 0 };
  const lease = row.lease_until ? Date.parse(row.lease_until) : 0;
  if (row.lease_until && !(lease < nowMs)) return { ok: false, cut: 0 };
  if (!row.lease_until) return { ok: true, cut: 0 };
  return { ok: true, cut: row.error_code === 'step_cut' ? MAX_STEP_CUTS : 1 };
}
// 서버 정리가 구간 전사를 시작할 때 그 구간 행 상태: free(시작 가능) · busy(다른 실행이 막 시작함) · dead(끊긴 앞 실행, 넘겨받음).
export function segmentRun(seg, nowMs) {
  if (!seg || seg.status !== 'running') return 'free';
  const t = Date.parse(seg.started_at || seg.updated_at || seg.created_at || '');
  return Number.isFinite(t) && nowMs - t <= SEGMENT_DEAD_MS ? 'busy' : 'dead';
}

// OpenAI Responses 답 → 실패 갈래(요약). 답이 잘림(max_output_tokens) = draft_cut, 그 밖 = draft_failed.
// 로그에는 상태·이유 이름만 남긴다(답 글 없음).
export function draftResult(d) {
  if (!d || typeof d !== 'object') return { code: 'draft_failed', why: 'no_body' };
  const status = typeof d.status === 'string' && /^[a-z_]{1,30}$/.test(d.status) ? d.status : '-';
  if (status === 'completed') return { code: '', why: 'completed' };
  const reason = typeof d.incomplete_details?.reason === 'string' && /^[a-z_]{1,40}$/.test(d.incomplete_details.reason) ? d.incomplete_details.reason : '-';
  if (status === 'incomplete' && reason === 'max_output_tokens') return { code: 'draft_cut', why: `incomplete:${reason}` };
  return { code: 'draft_failed', why: `${status}:${reason}` };
}
export const isLongTranscript = (t) => String(t || '').trim().length > DRAFT_ONE_CHARS;

// 화면에 줄 모양. 결과(전문·초안)는 끝난 작업을 하나 읽을 때(withResult)만 싣는다.
export function jobView(row, withResult = false) {
  if (!row) return null;
  const parts = Array.isArray(row.parts) ? row.parts : [];
  const v = {
    id: row.id, kind: row.kind, status: row.status, stage: row.stage, step_no: row.step_no ?? 0, step_total: row.step_total ?? 0,
    error_code: row.error_code ?? null, session_id: row.session_id ?? null, document_id: row.document_id ?? null, meeting_id: row.meeting_id ?? null,
    parts_done: doneParts(parts), parts_total: partTotal(parts),
    seconds: parts.reduce((s, p) => s + (Number(p?.seconds) || 0), 0),
    jobs: parts.map((p) => p?.job).filter(isUuid),
    created_at: row.created_at, finished_at: row.finished_at ?? null, opened_at: row.opened_at ?? null,
  };
  if (withResult && row.status === 'done') { v.transcript_text = row.transcript_text ?? ''; v.draft = row.draft ?? null; }
  return v;
}
// 화면 확인 때 다시 깨울 작업인가: 진행 중인데 잡은 사람이 없거나 기한이 지났고, 마지막 변화가 STALE_MS보다 오래됨.
export function needsKick(row, nowMs) {
  if (!row || !ACTIVE.includes(row.status)) return false;
  const lease = row.lease_until ? Date.parse(row.lease_until) : 0;
  if (lease && lease > nowMs) return false;
  const changed = Date.parse(row.updated_at || row.created_at || '') || 0;
  return nowMs - changed > STALE_MS;
}

// 끝 알림을 보낼지: 내 프로필 '폰 알림'(app_profiles.notify_prefs, 화면 phone-push-model.mjs parsePrefs와 같은 모양)을 따른다.
// '회의 요약'을 끈 사람 = skipped_off, 조용한 시간(기본 22:00~07:00 서울) = held_quiet(폰으로 보내지 않고 알림 줄에만), 그 밖 = send.
const HM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
export function pushDecision(prefs, nowMs) {
  const p = prefs && typeof prefs === 'object' && !Array.isArray(prefs) ? prefs : {};
  if (p.kinds && typeof p.kinds === 'object' && p.kinds.meeting_done === false) return 'skipped_off';
  const q = p.quiet && typeof p.quiet === 'object' && HM.test(p.quiet.from) && HM.test(p.quiet.to) ? p.quiet : { from: '22:00', to: '07:00' };
  const kst = new Date(nowMs + 9 * 3600000), m = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  const toMin = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  const from = toMin(q.from), to = toMin(q.to);
  const quiet = from === to ? false : from < to ? m >= from && m < to : m >= from || m < to;
  return quiet ? 'held_quiet' : 'send';
}
