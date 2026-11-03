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

// 요약 단계 계획: 조각이 하나면 한 번, 아니면 조각마다 + 합치기 한 번.
export function summaryPlan(transcript, summaryParts) {
  const pieces = splitTranscript(transcript);
  const done = Array.isArray(summaryParts) ? summaryParts.length : 0;
  if (pieces.length <= 1) return { kind: 'one', pieces, total: 1, next: 0 };
  if (done < pieces.length) return { kind: 'part', pieces, total: pieces.length + 1, next: done };
  return { kind: 'merge', pieces, total: pieces.length + 1, next: pieces.length };
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
