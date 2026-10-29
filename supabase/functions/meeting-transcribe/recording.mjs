// MTG-노트북녹음 1단계: 노트북 Web2 [녹음]의 구간·조각 규칙(Edge meeting-transcribe의 rec_* 동작). Node 시험·Deno 배포 양쪽에서 읽는다.
// 설계: docs/design/laptop-recording.md. 표: app_meeting_recordings(migration 20261029200000).
// - 브라우저 MediaRecorder가 timeslice(5분)로 내주는 조각은 순서대로 이으면 한 파일이다. 서버는 순서만 강제하고 소리는 풀지 않는다.
// - 한 구간은 기존 전사 한 번 요청 상한(MAX_SECONDS, 1시간) 안이어야 하므로 화면은 59분마다 새 구간으로 넘어간다.
// - 소리·전사 글은 여기서 다루지 않는다(소리는 Drive, 글은 회의 기록에만).
import { Fail, MAX_BYTES, MAX_SECONDS, isDriveId, isUuid } from './model.mjs';

export const REC_PIECE_SECONDS = 5 * 60;          // 화면이 조각을 보내는 간격
export const REC_SEGMENT_SECONDS = 59 * 60;       // 화면이 새 구간으로 넘어가는 길이(전사 1시간 상한 안)
export const REC_MAX_PIECES = 16;                 // DB 제약과 같음(59분 = 12조각 + 멈출 때 1 + 여유)
export const REC_MAX_SEGMENTS = 24;               // DB 제약과 같음
export const REC_QUIET_MS = 12 * 60 * 1000;       // 열린 구간이 이만큼 조용하면 끊긴 것으로 본다(조각 간격 5분의 두 배 넘게)
export const REC_FINISH_BUDGET_MS = 200 * 1000;   // rec_finish 한 번에 쓰는 시간(넘으면 more로 끊음)
export const REC_PENDING_DAYS = 30;               // '이어서 정리'로 보여 주는 기간 = 합치지 못한 조각을 남기는 기간
export const PIECE_FOLDER = '녹음 조각';
const KST = 9 * 3600000;

export const REC_MIME = Object.freeze({ 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a' });
export const REC_MESSAGES = Object.freeze({
  rec_closed: '이 녹음 구간은 이미 닫혔어요.',
  piece_gap: '녹음 조각 순서가 맞지 않아요.',
  rec_full: '이 녹음 구간이 가득 찼어요. 새 구간으로 이어 주세요.',
  rec_too_many: '녹음 구간이 너무 많아요.',
});
export const REC_STATUS = Object.freeze({ rec_closed: 409, piece_gap: 409, rec_full: 413, rec_too_many: 413 });

// 녹음 동작 실패(공용 Fail 밖의 코드). 화면은 code로 갈래를 탄다.
export class RecFail extends Error {
  constructor(code, extra = {}) { super(code); this.code = REC_MESSAGES[code] ? code : 'rec_closed'; this.extra = extra; }
}
export const recFailBody = (code, extra = {}) => ({ ok: false, code, error: REC_MESSAGES[code], ...extra });

// 'audio/webm;codecs=opus' → 'audio/webm'. 받는 것은 세 가지뿐.
export function recMime(type) {
  const base = String(type || '').toLowerCase().split(';')[0].trim();
  if (!Object.hasOwn(REC_MIME, base)) throw new Fail('bad_type');
  return base;
}

// 조각 올리기 머리글 검사. seq는 1부터, seconds는 구간 시작부터 잰 초(없을 수 있음).
export function parsePiece({ recordingId, seq, length, seconds }) {
  if (!isUuid(recordingId)) throw new Fail('bad_request');
  const n = Number(seq);
  if (!Number.isSafeInteger(n) || n < 1 || n > REC_MAX_PIECES) throw new Fail('bad_request');
  const size = Number(length);
  if (!Number.isSafeInteger(size) || size <= 0) throw new Fail('bad_request');
  if (size > MAX_BYTES) throw new Fail('too_large');
  let duration = null;
  if (seconds !== null && seconds !== undefined && String(seconds).trim() !== '') {
    const s = Math.ceil(Number(seconds));
    if (!Number.isFinite(s) || s <= 0) throw new Fail('bad_request');
    if (s > MAX_SECONDS) throw new Fail('too_long');
    duration = s;
  }
  return { recordingId, seq: n, size, duration };
}

// 받은 조각을 어떻게 할지. rec: 표 한 행. 'append'만 Drive에 올린다.
export function pieceDecision(rec, seq, size) {
  const have = Array.isArray(rec?.piece_ids) ? rec.piece_ids.length : 0;
  if (seq <= have) return { action: 'already' };
  if (rec?.status !== 'recording') throw new RecFail('rec_closed');
  if (seq !== have + 1) throw new RecFail('piece_gap', { expected_seq: have + 1 });
  if (have >= REC_MAX_PIECES) throw new RecFail('rec_full');
  if (Number(rec.size_bytes || 0) + size > MAX_BYTES) throw new Fail('too_large');
  return { action: 'append' };
}

// 조각을 더한 뒤의 고칠 칸. 길이는 줄지 않는다.
export function appendPatch(rec, driveId, size, duration, now) {
  if (!isDriveId(driveId)) throw new Fail('drive_failed');
  const prev = Number.isFinite(rec?.duration_sec) ? rec.duration_sec : null;
  const next = duration === null ? prev : Math.max(prev ?? 0, duration);
  return {
    piece_ids: [...(rec.piece_ids || []), driveId],
    size_bytes: Number(rec.size_bytes || 0) + size,
    duration_sec: next,
    updated_at: now.toISOString(),
  };
}

// 열린 구간을 닫을 때의 상태(조각 없으면 empty).
export function closePatch(rec, now) {
  const empty = !(Array.isArray(rec?.piece_ids) && rec.piece_ids.length);
  return { status: empty ? 'empty' : 'closed', closed_at: now.toISOString(), updated_at: now.toISOString() };
}

// 같은 녹음의 다음 구간 번호. rows: 그 session의 행들.
export function nextSegment(rows) {
  const max = (Array.isArray(rows) ? rows : []).reduce((m, r) => Math.max(m, Number(r?.segment_no) || 0), 0);
  if (max >= REC_MAX_SEGMENTS) throw new RecFail('rec_too_many');
  return max + 1;
}

// 열린 구간이 끊긴 것(창 닫힘·노트북 꺼짐)인지.
export function isQuiet(rec, now) {
  if (rec?.status !== 'recording') return false;
  const t = Date.parse(rec.updated_at || rec.created_at || '');
  return !Number.isFinite(t) || now.getTime() - t > REC_QUIET_MS;
}

function kstStamp(at) {
  const d = new Date(at.getTime() + KST).toISOString();
  return `${d.slice(0, 10)} ${d.slice(11, 13)}${d.slice(14, 16)}`;
}
// 합친 구간 파일 이름(기존 전사 길의 parseUpload 규칙과 같은 확장자). 예: '녹음 2026-10-29 1430 구간1.webm'
export function segmentFileName(startedAt, segmentNo, mime) {
  const at = new Date(startedAt);
  const stamp = Number.isFinite(at.getTime()) ? kstStamp(at) : kstStamp(new Date());
  return `녹음 ${stamp} 구간${segmentNo}.${REC_MIME[mime] || 'webm'}`;
}
export function pieceFileName(recordingId, seq, mime) {
  return `rec-${recordingId}-${String(seq).padStart(2, '0')}.${REC_MIME[mime] || 'webm'}`;
}

// rec_finish에서 합칠 구간(닫힌 것, 번호 순).
export const toCombine = rows => (Array.isArray(rows) ? rows : []).filter(r => r?.status === 'closed').sort((a, b) => a.segment_no - b.segment_no);

// '이어서 정리' 목록. rows: 이 사람의 최근 구간들, jobs: 그 구간들의 전사 작업({id,status}).
// 끝나지 않은 녹음 = 열린 구간이 조용함 · 닫힘(합치기 전) · 합쳤지만 전사 작업이 아직 끝나지 않음.
export function pendingSessions(rows, jobs, now) {
  const jobStatus = new Map((Array.isArray(jobs) ? jobs : []).map(j => [j.id, j.status]));
  const by = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r?.session_id) continue;
    if (!by.has(r.session_id)) by.set(r.session_id, []);
    by.get(r.session_id).push(r);
  }
  const out = [];
  for (const [session, list] of by) {
    list.sort((a, b) => a.segment_no - b.segment_no);
    if (list.some(r => r.status === 'recording' && !isQuiet(r, now))) continue; // 지금 녹음 중인 것은 제외
    const open = list.some(r => r.status === 'recording' || r.status === 'closed'
      || (r.status === 'combined' && r.job_id && jobStatus.get(r.job_id) !== 'done'));
    if (!open) continue;
    out.push({
      session_id: session,
      started_at: list[0].created_at,
      duration_sec: list.reduce((s, r) => s + (Number(r.duration_sec) || 0), 0),
      segments: list.filter(r => r.status !== 'empty').map(r => ({
        segment_no: r.segment_no, status: r.status, job_id: r.job_id ?? null,
        job_status: r.job_id ? (jobStatus.get(r.job_id) ?? null) : null, duration_sec: r.duration_sec ?? null,
      })),
    });
  }
  return out.sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)));
}

export function pendingSince(now) { return new Date(now.getTime() - REC_PENDING_DAYS * 86400000).toISOString(); }
