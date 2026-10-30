// MTG-노트북녹음 1단계: 노트북 Web2 [녹음]의 구간·조각 규칙(Edge meeting-transcribe의 rec_* 동작). Node 시험·Deno 배포 양쪽에서 읽는다.
// 설계: docs/design/laptop-recording.md. 표: app_meeting_recordings(migration 20261029200000).
// - 브라우저 MediaRecorder가 timeslice(1분, rec_start의 piece_seconds)로 내주는 조각은 순서대로 이으면 한 파일이다. 서버는 순서만 강제하고 소리는 풀지 않는다.
//   조각 길이는 고정으로 가정하지 않는다(옛 5분 조각·1분 조각이 섞여도 같은 길로 잇는다: 크기는 Drive 실제 크기 합, 길이는 x-duration-sec).
// - 한 구간은 기존 전사 한 번 요청 상한(MAX_SECONDS, 1시간) 안이어야 하므로 화면은 59분마다 새 구간으로 넘어간다.
// - 소리·전사 글은 여기서 다루지 않는다(소리는 Drive, 글은 회의 기록에만).
import { Fail, MAX_BYTES, MAX_SECONDS, isDriveId, isUuid } from './model.mjs';

export const REC_PIECE_SECONDS = 60;              // 화면이 조각을 보내는 간격(창이 닫혀도 잃는 것은 최대 1분). rec_start가 화면에 알려 준다.
export const REC_SEGMENT_SECONDS = 59 * 60;       // 화면이 새 구간으로 넘어가는 길이(전사 1시간 상한 안)
export const REC_MAX_PIECES = 64;                 // DB 제약과 같음(migration 20261030120000: 59분 = 59조각 + 멈출 때 1 + 여유)
export const REC_ROLL_PIECES = REC_MAX_PIECES - 4; // 화면은 조각이 이만큼 쌓이면(일시정지가 길어도) 새 구간으로 넘어간다. rec_start가 max_pieces로 알려 준다.
export const REC_MAX_SEGMENTS = 24;               // DB 제약과 같음
export const REC_QUIET_MS = 7 * 60 * 1000;        // 열린 구간이 이만큼 조용하면 끊긴 것으로 본다(1분 조각의 일곱 배, 아직 열려 있는 옛 5분 화면도 넘김)
export const REC_FINISH_BUDGET_MS = 120 * 1000;   // rec_finish 한 번에 새 구간 합치기를 시작하는 시간(넘으면 more로 끊음). 60조각 한 구간이 더 걸려도 화면 기다림(260초) 안.
export const REC_DRIVE_PARALLEL = 6;              // 조각 크기 확인·휴지통 넣기를 한 번에 몇 개씩(60조각을 차례로 하면 느림, Drive 호출 몰림은 막음)
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

// items를 limit개씩 동시에 fn으로 처리하고 결과를 원래 순서로 돌려준다. 하나라도 실패하면 그 오류로 끝(남은 것은 시작하지 않음).
export async function mapLimit(items, limit, fn) {
  const list = Array.isArray(items) ? items : [];
  const out = new Array(list.length);
  let next = 0, failed = null;
  const worker = async () => {
    while (failed === null && next < list.length) {
      const i = next++;
      try { out[i] = await fn(list[i], i); } catch (e) { if (failed === null) failed = { e }; }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, list.length)) }, worker));
  if (failed) throw failed.e;
  return out;
}

// 조각들을 순서대로 이어 한 흐름으로(메모리에 다 담지 않음). openPiece(id) → Response(fetch 답).
// 다음 조각 요청은 지금 조각을 읽는 동안 미리 보낸다(60조각을 기다림 없이). 조각 길이는 보지 않는다(섞여도 같음).
export function joinPieces(openPiece, ids) {
  const list = Array.isArray(ids) ? ids : [];
  let i = 0;
  let reader = null;
  let ahead = null;
  const open = () => { if (i >= list.length) return null; const id = list[i++]; return Promise.resolve().then(() => openPiece(id)); };
  const drop = p => p?.then(r => r?.body?.cancel?.(), () => undefined);
  return new ReadableStream({
    async pull(ctrl) {
      for (;;) {
        if (!reader) {
          const now = ahead ?? open();
          ahead = null;
          if (!now) { ctrl.close(); return; }
          let r;
          try { r = await now; } catch { r = null; }
          if (!r?.ok || !r.body) { await r?.body?.cancel?.(); ctrl.error(new Fail('drive_failed')); return; }
          reader = r.body.getReader();
          ahead = open();
        }
        const { value, done } = await reader.read();
        if (done) { reader = null; continue; }
        if (value?.byteLength) { ctrl.enqueue(value); return; }
      }
    },
    async cancel() { await reader?.cancel(); await drop(ahead); ahead = null; },
  });
}

// rec_finish 한 번: 닫힌 구간을 번호 순으로 합치되, 쓴 시간이 budget을 넘으면 새 구간은 시작하지 않고 more로 끊는다.
// 화면은 more면 rec_finish를 다시 부른다(합친 구간은 combined라 다음 번엔 남은 것만). 한 번에 적어도 한 구간은 한다.
export async function combineWithin(pending, combineOne, started, { now = Date.now, budget = REC_FINISH_BUDGET_MS } = {}) {
  let done = 0;
  for (const seg of Array.isArray(pending) ? pending : []) {
    if (done > 0 && now() - started > budget) return { more: true, done };
    await combineOne(seg);
    done++;
  }
  return { more: false, done };
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

// ---- 버리기·되돌리기(rec_discard·rec_restore, 요청함 10/30 10:01) ----
// 버린 구간은 표에서 지우지 않는다(지우기 권한 없음, 칸 추가 없음): status 'failed' + error_code 'discarded_closed'|'discarded_combined'.
// 'discarded_…'의 뒷말이 되돌릴 때 돌아갈 상태다. 조각(또는 합친 파일)은 Drive 휴지통으로만 옮긴다(영구 삭제 아님).
// 30일 정리(sweepRecordings)와 겹치지 않음: 버리며 조각을 모두 휴지통에 넣으면 pieces_trashed_at이 차서 30일 정리 대상(…is null)이 아니고,
// 일부 실패로 비어 있으면 정리 쪽이 휴지통 넣기만 다시 하며 status는 'failed' 그대로 둔다(되돌릴 상태 표시를 지우지 않음).
export const DISCARD_PREFIX = 'discarded_';
export const isDiscarded = r => r?.status === 'failed' && typeof r?.error_code === 'string' && r.error_code.startsWith(DISCARD_PREFIX);

// 한 녹음(session)의 행이 모두 이 사람 것인지. 하나라도 남의 것이거나 다른 작업공간이면 없는 것으로 본다(남의 녹음을 있다고도 알리지 않음).
export function ownRows(rows, userId) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length || !userId) throw new Fail('not_found');
  const ws = list[0].workspace_id;
  if (!ws || list.some(r => r?.workspace_id !== ws || r?.created_by !== userId)) throw new Fail('not_found');
  return ws;
}

// 버릴 구간. rows: 그 녹음의 구간들, jobs: 합친 구간의 전사 작업({id,status,meeting_id,trashed_at}).
// - recording·closed: 조각을 휴지통으로(조각 없는 열린 구간은 그냥 닫음 = empty).
// - combined: 전사가 끝나지 않았고 회의에 붙이지 않은 것만 합친 파일을 휴지통으로. 전사 중이면 busy.
// - 끝난 전사·회의에 붙인 녹음·empty·이미 실패/버린 구간은 건드리지 않는다.
export function discardPlan(rows, jobs) {
  const byId = new Map((Array.isArray(jobs) ? jobs : []).map(j => [j.id, j]));
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (r?.status === 'recording' || r?.status === 'closed') {
      const empty = !(Array.isArray(r.piece_ids) && r.piece_ids.length);
      out.push({ row: r, kind: empty ? 'close' : 'pieces' });
    } else if (r?.status === 'combined' && r.job_id) {
      const job = byId.get(r.job_id);
      if (!job || job.trashed_at || job.meeting_id || job.status === 'done') continue;
      if (job.status === 'running') throw new Fail('busy');
      out.push({ row: r, kind: 'combined', job });
    }
  }
  if (!out.some(p => p.kind !== 'close')) throw new Fail('not_found');
  return out;
}
export function discardPatch(row, kind, now) {
  if (kind === 'close') return closePatch(row, now);
  return {
    status: 'failed', error_code: `${DISCARD_PREFIX}${kind === 'combined' ? 'combined' : 'closed'}`,
    closed_at: row?.closed_at ?? now.toISOString(), updated_at: now.toISOString(),
  };
}

// 되돌릴 구간: 버린 표시가 있는 것만. 돌아갈 상태(closed|combined)를 붙여 준다.
export function restorePlan(rows) {
  const out = (Array.isArray(rows) ? rows : []).filter(isDiscarded).map(r => {
    const to = r.error_code.slice(DISCARD_PREFIX.length);
    return { row: r, to: to === 'combined' && r.job_id ? 'combined' : 'closed' };
  });
  if (!out.length) throw new Fail('not_found');
  return out;
}
