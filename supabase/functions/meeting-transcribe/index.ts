// MTG-녹음초안 2단계: 회의 녹음 파일 → 전사 글(Gemini). 사업 보고 › [회의] 입력 창의 [녹음·전사 넣기]만 부른다.
// verify_jwt=true(첫 배포 first_deploy=true). 코드에서도 Auth 서버로 로그인을 다시 확인하고 작업공간 소유자(owner)만 받는다.
//
// action(모두 POST, 쿼리 ?action=):
//   config     {workspace_id}            → 준비 여부(열쇠 있음)·이번 달 금액·상한. 끊긴 작업·30일 지난 녹음 정리도 여기서 한다.
//   upload     몸통 = 녹음 파일 그대로     → 명진 Drive '웹2/회의자료/회의 녹음' 폴더에 올리고 작업 한 행(uploaded). 머리글
//              x-workspace-id, x-file-name(encodeURIComponent), x-duration-sec(화면이 잰 길이, 없을 수 있음), Content-Length 필수.
//   transcribe {job_id}                  → Drive에서 읽어 Gemini Files에 올리고 전사(통화 전사와 같은 설정) → 글을 이 응답으로만 돌려준다.
//              작업 행은 진행 중 → 끝/실패. 이 함수는 전사 글을 저장하지 않는다. 화면이 그 글을 회의 입력 창의 '회의록 전문' 칸
//              (app_meetings.notes)에 넣어 [사업 보고 저장] 때 회의와 함께 남긴다(S48-64, 명진 11/03 지시 '전사 전문 저장 허용').
//              사용량은 기존 app_ai_external_usage에 ref 'mtg-…'로 넣는다(홈 AI 사용량 줄·월 상한이 같은 기록을 셈). 글을 못 받은 시도는 'mtgfail-…'(홈 사용량에만, 월 상한 밖).
//   attach     {job_id, meeting_id}      → 끝난 녹음을 그 회의 자료로 링크(app_documents 한 행, 원본은 Drive 그대로).
// MTG-노트북녹음 1단계(노트북 Web2 [녹음], 설계 docs/design/laptop-recording.md, 표 app_meeting_recordings):
//   rec_start   {workspace_id, mime, session_id?} → 녹음 구간 한 행(열린 구간이 있으면 먼저 닫음). 같은 session_id = 한 회의의 다음 구간.
//   rec_piece   몸통 = 5분 조각 그대로     → Drive '회의 녹음/녹음 조각'에 올리고 구간 행에 순서대로 더함. 머리글 x-recording-id,
//               x-piece-seq(1부터), x-duration-sec(구간 시작부터 잰 초, 없을 수 있음), Content-Length 필수.
//   rec_finish  {session_id}              → 열린 구간 닫기 → 닫힌 구간마다 조각을 이어 한 파일(회의 녹음 폴더)로 → 전사 작업 한 행(uploaded)
//               → 조각 휴지통. 전사·붙이기는 위 transcribe·attach를 구간마다 그대로 부른다. 시간이 모자라면 more=true.
//   rec_pending {workspace_id}            → 끝나지 않은 녹음 목록('이어서 정리').
//   rec_discard {session_id}              → 녹음 버리기: 열린 구간 닫기 → 조각(합쳤으면 합친 파일)을 Drive 휴지통으로, 구간은 '버림' 표시.
//               전사·요약·회의 초안은 하지 않는다. 끝난 전사·회의에 붙인 녹음은 건드리지 않는다.
//   rec_restore {session_id}              → 버린 녹음 되돌리기: 휴지통에서 다시 꺼내 '이어서 정리' 상태로(닫힘·합침). 녹음을 이어 하지는 않는다.
// REC-한회의로잇기 PR-2(설계 docs/design/rec-join.md 3-1절, 표 app_meeting_join_jobs · 규칙 join-job.mjs): 두 번 녹음한 회의를 한 보고로.
//   join_start      {target_meeting_id, source:{job_id}|{meeting_id}} → 녹음 결과를 그 보고에 잇기 / 저장한 다른 보고를 그 보고에 합치기.
//   join_text       몸통 = 전사 글 그대로. 머리글 x-target-meeting-id, x-record-jobs(붙일 녹음 작업 id, 쉼표), Content-Length 필수.
//   join_candidates {job_id}|{meeting_id} → 같은 날 녹음으로 쓴 보고의 id·녹음 길이.
//   join_read {job_id} · join_list {} · join_retry {job_id} · join_seen {job_id, candidates?} · join_undo {job_id, scope:'before'|'joined'|'all'}
//   몸통에 작업공간 값을 받지 않는다: 고른 보고를 부른 사람 로그인으로 읽고, 그 행의 작업공간으로 owner를 확인한 뒤에만 서비스 권한을 쓴다.
//   뒤에서 summary(합친 전문으로 다시 요약) → apply(DB 함수 한 번, 보고 글은 여기서만 바뀜) → done. 다음 단계는 join_tick(서버 키 HMAC, job_tick과 다른 서명).
// S60-9 REC-전사모델바꾸기: 전사 모델 이름은 model.mjs TRANSCRIBE_MODEL 한 곳 generateContent, 생각 끔·출력 65,536토큰,
//   화자 구분은 지시문('화자1: ' 줄). 받은 글에 같은 말이 비정상으로 되풀이되면 gemini_repeat → 잘림과 같이 그 조각만 반으로 다시.
// REC-긴녹음나눠전사(S60-7): 한 번 답의 출력에 상한이 있어 30분(split.mjs CHUNK_SECONDS, S60-9에서 15분 → 30분)보다 긴 소리는 시간 조각으로 잘라
//   따로 전사하고 잇는다(Ogg/Opus·WebM·MP4, 소리는 풀지 않음). 서버 정리는 조각마다 한 단계(parts jsonb 안 range), 화면 transcribe는 한 번 부름 안에서
//   조각을 동시에. 조각 답이 또 잘리면 그 조각만 반으로. 나눌 수 없는 형식(mp3·wav 등)·64MB 넘는 파일은 지금처럼 통째로.
// 열쇠(비밀값 GEMINI_API_KEY)가 없으면 config는 ready=false, 나머지는 503 not_ready('준비 중').
// 실패하면 작업만 failed로 두고, Gemini에 올린 임시 파일은 지운다. 녹음 원본·회의 기록은 그대로다.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { moveDriveFileToTrash } from '../_shared/drive-trash.ts';
import {
  Fail, GEMINI_KEY_NAME, GEMINI_TIME, HALVE_CODES, MAX_BYTES, MAX_SECONDS, MONTHLY_LIMIT_KRW, STATUS, SWEEP_LIMIT, TRANSCRIBE_MODEL, USAGE_REF_PREFIX,
  answerShape, answerWindow, attachDocument, audioMime, canStart, stateTag, failBody, geminiCode, isStale, isThin, isUuid, monthKrw, monthStart, overLimit, parseUpload, readTranscript, readUsage,
  phaseWindow, seoulDay, transcribePath, transcriptionRequest, usageRef, LIBRARY_RECORDING_FOLDER, recordingDocument, savedFileView,
} from './model.mjs';
import {
  PIECE_FOLDER, REC_DRIVE_PARALLEL, REC_MAX_SEGMENTS, REC_PIECE_SECONDS, REC_ROLL_PIECES, REC_SEGMENT_SECONDS, REC_STATUS, RecFail,
  appendPatch, closePatch, combineWithin, discardPatch, discardPlan, joinPieces, mapLimit, nextSegment, ownRows, parsePiece, liveSessions, pendingSessions, pendingSince, pieceDecision,
  pieceFileName, recFailBody, recMime, restorePlan, segmentFileName, toCombine,
} from './recording.mjs';
import { OggFail, normalizeOggOpus, wantsOggFix } from './ogg.mjs';
import { CHUNK_SECONDS, SPLIT_MAX_BYTES, chunkRanges, halveRange, openAudio, readRange } from './split.mjs';
import { withWebCors } from "../_shared/web-cors.ts";
import { WorkspaceDriveError, workspaceDriveToken } from '../_shared/workspace-drive-token.ts';
import { safeErrorLog } from "../_shared/safe-error.ts";
import { AI_REASONING_TOKEN_HEADROOM, AI_TONE_RULE, DEFAULT_AI_MODEL, withReasoning } from '../_shared/ai-model.ts';
import { outputText } from '../_shared/openai-responses.ts';
import { FCM_SECRET_NAME, makeFcmSender, readFcmConfig } from '../_shared/fcm-send.ts';
import { DRAFT_INPUT_CHARS, cut, meetingDraftDeveloper, meetingDraftPrompt, meetingDraftRequest, normalizeDraft, partsText } from '../_shared/meeting-draft-prompt.mjs';
import { parseMeetingDraft } from '../meeting-ai-draft/parse.mjs';
import { addAiRequest, readTodayAiUsage } from '../_shared/ai-daily-usage.mjs';
import {
  ACTIVE, LEASE_MS, LIST_HOURS, MAX_ATTEMPTS, SERVER_JOB_COLUMNS, SERVER_JOB_TABLE, TICK_HEADER, TICK_TTL_MS,
  SPLIT_CODES, audioDocument, carryClosed, cleanText, combineDrafts, doneParts, draftResult, failReason, failedCode, halfMark, halves, hasThinPart, hasWords, isDiscarded, jobDiscardPatch, jobRestorePatch, jobView, joinParts, leaseTake, moreOfSame, nextPart, parseStart, partTotal, pushDecision, recordingParts, segmentRun, splitJobSummary, splitPart, summaryPlan, tickCheck, tickSign,
} from './server-job.mjs';
import {
  JOIN_DAY_COLUMNS, JOIN_JOB_TABLE, JOIN_MEETING_COLUMNS, JOIN_STEP_COLUMNS, JOIN_TICK_ACTION, JOIN_VIEW_COLUMNS,
  applyOutcome, boundedText, joinAfterSummary, joinCandidates, joinPatch, joinRpcCode, joinView, joiningSources, listJoins, parseJoinStart, parseJoinText,
  readJoin, retryJoin, seenJoin, startJoin, undoJoin,
} from './join-job.mjs';

const SB = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const GEMINI = () => (Deno.env.get(GEMINI_KEY_NAME) || '').trim();
const admin = createClient(SB, SERVICE, { auth: { persistSession: false } });
const GEM = 'https://generativelanguage.googleapis.com';
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const FOLDER = 'application/vnd.google-apps.folder';
const RECORDING_FOLDER = '회의 녹음';
const TABLE = 'app_meeting_transcribe_jobs';
const REC_TABLE = 'app_meeting_recordings';
const REC_COLUMNS = 'id,workspace_id,created_by,session_id,segment_no,status,error_code,mime_type,piece_ids,size_bytes,duration_sec,job_id,pieces_trashed_at,closed_at,created_at,updated_at';
const JOB_COLUMNS = 'id,workspace_id,created_by,status,error_code,drive_file_id,file_name,mime_type,size_bytes,duration_sec,model,meeting_id,started_at,finished_at,trashed_at,created_at,updated_at';

// S61-5 REC-전사삭제(명진 11/13): 회의 녹음 전사·요약을 새로 시작하는 입구. 410 transcribe_off로만 답한다(지난 결과 읽기·버리기·잇기는 그대로).
const TRANSCRIBE_OFF_ACTIONS = new Set(['upload', 'transcribe', 'job_start', 'job_retry']);

const cors = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-workspace-id, x-file-name, x-duration-sec, x-target-meeting-id, x-record-jobs, x-recording-id, x-piece-seq',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const fail = (code: string) => json(failBody(code), (STATUS as Record<string, number>)[code] ?? 500);

// deno-lint-ignore no-explicit-any
type Job = Record<string, any>;
class AuthError extends Error { constructor(public status: number) { super(status === 401 ? 'AUTH_REQUIRED' : 'RESOURCE_FORBIDDEN'); } }

function bearer(req: Request) { return (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim(); }
async function userOf(req: Request) {
  const token = bearer(req);
  if (!token) throw new AuthError(401);
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) throw new AuthError(401);
  return data.user;
}
function userClient(req: Request) {
  return createClient(SB, ANON, { auth: { persistSession: false }, global: { headers: { Authorization: req.headers.get('Authorization') || '' } } });
}
// 작업공간 소유자만(meeting-files·meeting-ai-draft와 같은 기준).
async function requireOwner(userId: string, workspaceId: string) {
  if (!isUuid(workspaceId)) throw new Fail('bad_request');
  const { data, error } = await admin.from('app_workspace_members').select('role').eq('workspace_id', workspaceId).eq('user_id', userId).maybeSingle();
  if (error) throw new Fail('failed');
  if (data?.role !== 'owner') throw new AuthError(403);
}
async function ownJob(userId: string, jobId: unknown): Promise<Job> {
  if (!isUuid(jobId)) throw new Fail('bad_request');
  const { data, error } = await admin.from(TABLE).select(JOB_COLUMNS).eq('id', jobId as string).maybeSingle();
  if (error) throw new Fail('failed');
  if (!data) throw new Fail('not_found');
  await requireOwner(userId, data.workspace_id);
  if (data.created_by !== userId) throw new Fail('not_found');
  return data as Job;
}
async function setJob(id: string, patch: Record<string, unknown>) {
  const { error } = await admin.from(TABLE).update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw new Fail('failed');
}

// ---- Drive(MULTI ②-2: 작업공간별 연결, _shared/workspace-drive-token.ts). 넘기는 작업공간은 늘 requireOwner·본인 행으로 확인한 값.
//      연결이 없으면 drive_not_connected(424)로 거절한다. id=1의 갱신 열쇠는 읽지 않는다. ----
async function driveToken(workspaceId: string) {
  try {
    return await workspaceDriveToken(admin, workspaceId, { fetch, log: (code) => console.warn('meeting-transcribe drive token', code) });
  } catch (e) {
    if (e instanceof WorkspaceDriveError && e.code === 'drive_not_connected') throw new Fail('drive_not_connected');
    throw new Fail('drive_failed');
  }
}
async function createFolder(token: string, name: string, parent?: string) {
  const r = await fetch(`${DRIVE}?fields=id`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER, ...(parent ? { parents: [parent] } : {}) }),
  });
  const d = await r.json().catch(() => null);
  if (!r.ok || !d?.id) throw new Fail('drive_failed');
  return d.id as string;
}
// '웹2/회의자료' 폴더(meeting-files의 ensureMeetingsRoot와 같은 규칙·같은 설정 칸) 아래 '회의 녹음' 폴더.
async function recordingFolder(workspaceId: string, token: string, create: boolean): Promise<string | null> {
  const { data: s } = await admin.from('app_drive_settings').select('root_folder_id,meetings_folder_id').eq('workspace_id', workspaceId).maybeSingle();
  let meetings = s?.meetings_folder_id as string | undefined;
  if (!meetings) {
    if (!create) return null;
    let root = s?.root_folder_id as string | undefined;
    if (!root) {
      root = await createFolder(token, '웹2');
      await admin.from('app_drive_settings').upsert({ workspace_id: workspaceId, root_folder_id: root, updated_at: new Date().toISOString() });
    }
    meetings = await createFolder(token, '회의자료', root);
    await admin.from('app_drive_settings').upsert({ workspace_id: workspaceId, meetings_folder_id: meetings, updated_at: new Date().toISOString() });
  }
  return await childFolder(token, meetings, RECORDING_FOLDER, create);
}
// 폴더 바로 아래 같은 이름 폴더(가장 먼저 만든 것). 없으면 create일 때만 만든다. name은 코드의 고정 이름만.
async function childFolder(token: string, parent: string, name: string, create: boolean): Promise<string | null> {
  const q = `'${parent}' in parents and name = '${name}' and mimeType = '${FOLDER}' and trashed = false`;
  const r = await fetch(`${DRIVE}?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1&orderBy=createdTime`, { headers: { Authorization: `Bearer ${token}` } });
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Fail('drive_failed');
  const found = d?.files?.[0]?.id as string | undefined;
  if (found) return found;
  return create ? await createFolder(token, name, parent) : null;
}
// '회의 녹음/녹음 조각': 노트북 녹음의 5분 조각(합친 뒤 휴지통).
async function pieceFolder(workspaceId: string, token: string, create: boolean): Promise<string | null> {
  const recordings = await recordingFolder(workspaceId, token, create);
  return recordings ? await childFolder(token, recordings, PIECE_FOLDER, create) : null;
}
// 녹음을 Drive에 그대로 흘려 올린다(몸통을 메모리에 다 담지 않음).
async function driveUpload(token: string, folder: string, body: ReadableStream<Uint8Array>, name: string, mime: string, size: number) {
  const init = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(size) },
    body: JSON.stringify({ name, parents: [folder] }),
  });
  const loc = init.headers.get('location');
  if (!init.ok || !loc) throw new Fail('drive_failed');
  const r = await fetch(loc, { method: 'PUT', headers: { 'Content-Type': mime, 'Content-Length': String(size) }, body, duplex: 'half' } as RequestInit);
  const d = await r.json().catch(() => null);
  if (!r.ok || typeof d?.id !== 'string') throw new Fail('drive_failed');
  return d.id as string;
}

// ---- Gemini ----
// Gemini 실패 기록: HTTP 상태·오류 종류 이름(INVALID_ARGUMENT 등)만. 오류 글·파일 주소·소리는 쓰지 않는다.
async function geminiWarn(step: string, r: Response) {
  const d = await r.json().catch(() => null);
  const kind = typeof d?.error?.status === 'string' && /^[A-Z_]{1,40}$/.test(d.error.status) ? d.error.status : '-';
  console.warn('meeting-transcribe: gemini', step, r.status, kind);
}
// S60-11 REC-m4a뒤조각멈춤: Gemini에 묻는 모든 요청에 시간 상한(GEMINI_TIME, 남은 예산 deadline 안). 전엔 올리기·상태 묻기에 상한이 없어
// 답이 늦으면 Edge 실행 시간(벽시계 약 400초)이 다해 로그 없이 끊겼다(lease 9분 뒤 step_cut). 넘으면 걸린 초를 한 줄 남기고 실패 코드로 끝낸다.
const isLate = (e: unknown) => e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError');
const secSince = (t0: number) => Math.round((Date.now() - t0) / 1000);
async function geminiUpload(key: string, jobId: string, mime: string, body: ReadableStream<Uint8Array> | Uint8Array, size: number, deadline: number) {
  const t0 = Date.now();
  const signal = AbortSignal.timeout(phaseWindow(GEMINI_TIME.uploadMs, deadline, t0));
  try {
    const start = await fetch(`${GEM}/upload/v1beta/files`, {
      method: 'POST',
      headers: {
        'x-goog-api-key': key, 'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(size), 'X-Goog-Upload-Header-Content-Type': mime, 'Content-Type': 'application/json',
      },
      body: JSON.stringify({ file: { display_name: `meeting-${jobId}` } }), signal,
    });
    const url = start.headers.get('x-goog-upload-url');
    if (!start.ok || !url) { await geminiWarn('upload_start', start); throw new Fail('gemini_upload'); }
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Length': String(size), 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' },
      body, signal, ...(body instanceof Uint8Array ? {} : { duplex: 'half' }),
    } as RequestInit);
    if (!r.ok) { await geminiWarn('upload', r); throw new Fail(r.status === 400 ? 'gemini_rejected' : 'gemini_upload'); }
    const d = await r.json().catch(() => null);
    const file = d?.file;
    if (typeof file?.name !== 'string' || typeof file?.uri !== 'string') throw new Fail('gemini_upload');
    return file as { name: string; uri: string; state?: string; mimeType?: string };
  } catch (e) {
    if (e instanceof Fail) throw e;
    // 크기(MB)·걸린 초만(주소·이름 없음).
    console.warn('meeting-transcribe: gemini upload', isLate(e) ? 'late' : 'error', Math.round(size / 1048576), secSince(t0));
    throw new Fail(isLate(e) ? 'gemini_timeout' : 'gemini_upload');
  }
}
// Gemini가 올린 파일을 다 읽을 때까지. FAILED = 파일을 풀지 못함(형식), GEMINI_TIME.activeMs(60초) 안에 안 되면 늦음 — 상태 이름·걸린 초를 남긴다.
async function geminiActive(key: string, name: string, state: string | undefined, deadline: number) {
  const t0 = Date.now();
  const until = Math.min(t0 + GEMINI_TIME.activeMs, deadline);
  let s = state;
  while (s !== 'ACTIVE' && s !== 'FAILED' && Date.now() + 2000 < until) {
    await new Promise(res => setTimeout(res, 2000));
    let r: Response;
    try { r = await fetch(`${GEM}/v1beta/${name}`, { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(phaseWindow(GEMINI_TIME.pollMs, until, Date.now())) }); }
    catch (e) { console.warn('meeting-transcribe: gemini file_state', isLate(e) ? 'late' : 'error', stateTag(s), secSince(t0)); throw new Fail(isLate(e) ? 'gemini_timeout' : 'gemini_failed'); }
    if (!r.ok) { await geminiWarn('file_state', r); throw new Fail('gemini_failed'); }
    const d = await r.json().catch(() => null);
    s = d?.state;
  }
  if (s === 'FAILED') { console.warn('meeting-transcribe: gemini file FAILED', secSince(t0)); throw new Fail('gemini_file_failed'); }
  if (s !== 'ACTIVE') { console.warn('meeting-transcribe: gemini file stuck', stateTag(s), secSince(t0)); throw new Fail('gemini_timeout'); }
}
async function geminiDelete(key: string, name: string) {
  try { await fetch(`${GEM}/v1beta/${name}`, { method: 'DELETE', headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(GEMINI_TIME.deleteMs) }); } catch { /* 48시간 뒤 Gemini가 지움 */ }
}
// S60-9 REC-전사모델바꾸기: 일반 모델(TRANSCRIBE_MODEL) generateContent 한 번. 화자 구분은 지시문으로 하므로 거절 뒤 다시 보내는 길은 없다.
// S60-11: 기다림은 남은 예산(answerWindow, 최대 380초)만큼, 출력 상한은 조각 길이에 맞춘다(outputCap). 늦으면 걸린 초를 남기고 gemini_timeout.
async function geminiTranscribe(key: string, uri: string, mime: string, seconds: number | null, deadline: number) {
  const t0 = Date.now();
  const wait = answerWindow(deadline, t0);
  if (!wait) { console.warn('meeting-transcribe: gemini answer no time', Math.round((deadline - t0) / 1000)); throw new Fail('gemini_timeout'); }
  let r: Response;
  try {
    r = await fetch(`${GEM}${transcribePath(TRANSCRIBE_MODEL)}`, {
      method: 'POST', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify(transcriptionRequest(uri, mime, seconds)), signal: AbortSignal.timeout(wait),
    });
  } catch (e) {
    console.warn('meeting-transcribe: gemini answer', isLate(e) ? 'late' : 'cut', secSince(t0), Math.round(wait / 1000));
    throw new Fail(isLate(e) ? 'gemini_timeout' : 'gemini_failed');
  }
  if (!r.ok) { await geminiWarn('transcribe', r); throw new Fail(geminiCode(r.status)); }
  // 답 몸통 읽기(REC-글못찾음: 전엔 못 읽어도 로그 없이 gemini_failed). 받는 중에 기다림 상한이 지나면 늦음(gemini_timeout),
  // 연결이 끊겨 못 받았거나 JSON이 아니면 실패 — 어느 쪽인지 HTTP 상태·길이만 한 줄 남긴다(답 내용은 쓰지 않음).
  let raw = '';
  try { raw = await r.text(); } catch (e) {
    const late = isLate(e);
    console.warn('meeting-transcribe: gemini answer unread', r.status, late ? 'timeout' : 'cut', secSince(t0));
    throw new Fail(late ? 'gemini_timeout' : 'gemini_failed');
  }
  try { return JSON.parse(raw); } catch {
    console.warn('meeting-transcribe: gemini answer not json', r.status, raw.length);
    throw new Fail('gemini_failed');
  }
}
// 전사 답 → 글(model.mjs readTranscript). 끝나지 않았거나 글이 없는 답이면 그 모양(키 이름·status·조각 수·글자 수만, 글 내용 없음)을
// 한 줄 남겨 다음에 바로 원인을 가른다(REC-글못찾음: 11/11 41분 구간 실패 때 로그가 없어 원인을 가르지 못했다).
function readAnswer(d: unknown) {
  try { return readTranscript(d); } catch (e) {
    if (e instanceof Fail) console.warn('meeting-transcribe: gemini answer', e.code, answerShape(d));
    throw e;
  }
}

// ---- 이번 달 금액(기존 사용량 기록, 호출한 사람 토큰 + 소유자 RLS로 읽음) ----
async function monthUsed(userDb: ReturnType<typeof userClient>, workspaceId: string) {
  const { data, error } = await userDb.from('app_ai_external_usage').select('ref,model,input_tokens,audio_tokens,output_tokens')
    .eq('workspace_id', workspaceId).like('ref', `${USAGE_REF_PREFIX}%`).gte('day', monthStart(new Date())).limit(1000);
  if (error || !Array.isArray(data) || data.length >= 1000) throw new Fail('usage_unavailable');
  return monthKrw(data);
}

// ---- 서버 쪽 정리(부를 때마다, 이 작업공간만): 끊긴 진행 중 → 실패 ----
// S61-5 REC-전사삭제: '30일 지난 붙이지 않은 녹음 → Drive 휴지통'은 뺐다. 녹음 파일은 이제 자료실 자료(회의 녹음 폴더)로 남는 원본이라
// 회의에 붙이지 않았다는 이유로 저절로 지우지 않는다(데이터 보존).
async function sweep(workspaceId: string) {
  const now = new Date();
  try {
    const { data: running } = await admin.from(TABLE).select('id,status,started_at,updated_at,created_at').eq('workspace_id', workspaceId).eq('status', 'running').limit(5);
    for (const job of running || []) if (isStale(job, now)) await setJob(job.id, { status: 'failed', error_code: 'interrupted', finished_at: now.toISOString() });
  } catch (e) {
    console.warn('meeting-transcribe: sweep skipped', safeErrorLog(e));
  }
}

async function config(user: { id: string }, userDb: ReturnType<typeof userClient>, body: Record<string, unknown>) {
  const workspaceId = String(body.workspace_id || '');
  await requireOwner(user.id, workspaceId);
  await sweep(workspaceId);
  await sweepRecordings(workspaceId);
  const ready = !!GEMINI();
  let used: number | null = null;
  try { used = await monthUsed(userDb, workspaceId); } catch { used = null; }
  return json({ ok: true, ready, month_krw: used, limit_krw: MONTHLY_LIMIT_KRW, max_bytes: MAX_BYTES, max_seconds: MAX_SECONDS });
}

async function upload(req: Request, user: { id: string }, userDb: ReturnType<typeof userClient>) {
  const workspaceId = req.headers.get('x-workspace-id') || '';
  await requireOwner(user.id, workspaceId);
  if (!GEMINI()) throw new Fail('not_ready');
  const file = parseUpload({
    name: req.headers.get('x-file-name'), length: req.headers.get('content-length'),
    type: req.headers.get('content-type'), seconds: req.headers.get('x-duration-sec'),
  });
  if (!req.body) throw new Fail('bad_request');
  if (overLimit(await monthUsed(userDb, workspaceId))) throw new Fail('monthly_limit');
  const token = await driveToken(workspaceId);
  const folder = await recordingFolder(workspaceId, token, true);
  if (!folder) throw new Fail('drive_failed');
  const driveId = await driveUpload(token, folder, req.body, file.fileName, file.mime, file.size);
  const { data, error } = await admin.from(TABLE).insert({
    workspace_id: workspaceId, created_by: user.id, status: 'uploaded', drive_file_id: driveId,
    file_name: file.fileName, mime_type: file.mime, size_bytes: file.size, duration_sec: file.duration,
  }).select('id').single();
  if (error || !data?.id) {
    // 기록을 못 남긴 녹음은 남기지 않는다(휴지통, 이 폴더 것만).
    await moveDriveFileToTrash(fetch, driveId, folder, token).catch(() => 'unknown');
    throw new Fail('failed');
  }
  return json({ ok: true, job_id: data.id });
}

async function transcribe(user: { id: string }, userDb: ReturnType<typeof userClient>, body: Record<string, unknown>) {
  const job = await ownJob(user.id, body.job_id);
  const key = GEMINI();
  if (!key) throw new Fail('not_ready');
  const now = new Date();
  if (!canStart(job, now)) throw new Fail(job.status === 'running' ? 'busy' : 'bad_request');
  if (job.trashed_at) throw new Fail('not_found');
  if (job.duration_sec && job.duration_sec > MAX_SECONDS) throw new Fail('too_long');
  if (overLimit(await monthUsed(userDb, job.workspace_id))) throw new Fail('monthly_limit');
  // 같은 작업공간에서 진행 중은 한 건만(부분 유일 색인이 겹침을 막음). 끊긴 작업이면 먼저 실패로 돌린다.
  if (job.status === 'running') await setJob(job.id, { status: 'failed', error_code: 'interrupted' });
  const { data: started, error: startError } = await admin.from(TABLE).update({ status: 'running', error_code: null, model: TRANSCRIBE_MODEL, started_at: now.toISOString(), finished_at: null, updated_at: now.toISOString() })
    .eq('id', job.id).in('status', ['uploaded', 'failed']).select('id');
  if (startError) throw new Fail(startError.code === '23505' ? 'busy' : 'failed');
  if (!started?.length) throw new Fail('busy');
  try {
    const out = await runTranscription(key, job);
    const model = out.model;
    await setJob(job.id, { status: 'done', error_code: null, model, finished_at: new Date().toISOString() });
    return json({ ok: true, job_id: job.id, text: out.text, speaker_split: out.speakerSplit, model });
  } catch (e) {
    const code = failCode(e);
    await setJob(job.id, { status: 'failed', error_code: code, finished_at: new Date().toISOString() }).catch(() => undefined);
    throw e instanceof Fail ? e : new Fail(code);
  }
}
const failCode = (e: unknown) => e instanceof Fail ? e.code : (e instanceof DOMException && e.name === 'TimeoutError' ? 'gemini_timeout' : 'failed');

// ---- 소리 읽기·전사(화면 transcribe·서버 정리 공용) ----
// REC-긴녹음나눠전사(S60-7): 한 번 답의 출력에 상한이 있어(2.5 Flash 65,536토큰) 긴 소리는 글이 잘린다(gemini_incomplete). 길면 시간 구간으로 나눠
// 따로 전사한다(split.mjs). 나누려면 파일을 메모리에 담아야 해서 SPLIT_MAX_BYTES까지만 담고, 그보다 크면 지금처럼 흘려 보낸다(나누지 않음).
// deadline: 이 실행에서 Gemini 답까지 끝내야 하는 시각(소리 읽기 시작 + GEMINI_TIME.stepMs, S60-11). 화면 길의 동시 조각도 같은 한 번 실행이라 같이 쓴다.
type Loaded = { body: ReadableStream<Uint8Array> | Uint8Array; size: number; mime: string; seconds: number | null; opened: ReturnType<typeof openAudio>; deadline: number };
type Range = { from: number; to: number | null; seconds?: number };
// thin(S60-17): 다시 물어도 글이 적어 그대로 둔 조각의 소리 길이(초). split.thin: 글이 적어 다시 묻는 반 나눔(그 조각들은 더 다시 묻지 않음).
type Piece = { text: string; speakerSplit: boolean; model: string; thin?: number } | { split: Range[]; thin?: boolean };

// Drive의 소리를 읽는다. Ogg 파일(폰 녹음 등)은 쪽 머리를 규격대로 고친다(ogg.mjs: 안드로이드 녹음기의 granule·끝 표시 문제).
// Drive 원본은 그대로 둔다(이미 합친 오늘 녹음도 [다시]로 이 길을 탄다).
async function loadAudio(job: Job): Promise<Loaded> {
  const deadline = Date.now() + GEMINI_TIME.stepMs;
  const token = await driveToken(job.workspace_id);
  const media = await fetch(`${DRIVE}/${encodeURIComponent(job.drive_file_id)}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
  if (!media.ok || !media.body) throw new Fail('drive_failed');
  const size = Number(job.size_bytes) || 0;
  const fix = wantsOggFix(job.mime_type, job.file_name, size);
  if (!fix && !(size > 0 && size <= SPLIT_MAX_BYTES)) {
    console.warn('meeting-transcribe: split skipped', 'size', size);
    return { body: media.body, size, mime: job.mime_type, seconds: null, opened: null, deadline };
  }
  let bytes: Uint8Array;
  try { bytes = new Uint8Array(await media.arrayBuffer()); } catch { throw new Fail('drive_failed'); }
  let seconds: number | null = null;
  if (fix) {
    try {
      const fixed = normalizeOggOpus(bytes);
      const st = fixed.stats;
      // 수만 남긴다(운영 로그에서 원인 확인용): 쪽 수·길이·고친 granule·첫 granule 초·검사합 틀림·뺀 바이트·끝 표시 추가.
      console.warn('meeting-transcribe: ogg', st.kind, st.pages, st.seconds, st.fixed_granule, st.first_granule_sec, st.bad_crc, st.dropped_bytes, st.eos_added);
      bytes = fixed.bytes;
      seconds = st.kind === 'opus' ? st.seconds || null : null;
    } catch (e) {
      if (e instanceof OggFail) { console.warn('meeting-transcribe: ogg unreadable', bytes.byteLength); throw new Fail('bad_format'); }
      throw e;
    }
  }
  const opened = openAudio(bytes, job.mime_type, job.file_name);
  // 나눌 수 있는지·형식·길이(분)만 남긴다(소리·이름 없음).
  console.warn('meeting-transcribe: audio', opened ? opened.kind : 'unsplittable', opened ? Math.round(opened.seconds / 60) : '-');
  return { body: bytes, size: bytes.byteLength, mime: job.mime_type, seconds: opened ? Math.round(opened.seconds) : seconds, opened, deadline };
}
const SLICE_MIME: Record<string, string> = { ogg: 'audio/ogg', webm: 'audio/webm', mp4: 'audio/mp4' };

// 읽은 소리 한 번 전사. range가 없고 소리가 CHUNK_SECONDS보다 길며 나눌 수 있으면 전사하지 않고 {split}(나눌 구간)을 돌려준다.
// 답이 끝까지 오지 않거나(gemini_incomplete) 같은 말을 되풀이하거나(gemini_repeat) 시간 안에 오지 않으면(gemini_timeout, S60-11)
// 나눌 수 있는 한 그 조각을 반으로 나눌 구간을 돌려준다(model.mjs HALVE_CODES, 쓴 비용은 실패 머리로 기록됨).
// halveFirst(S60-11): 앞 실행이 이 조각에서 끊겼으면(서버 정리 step_cut 한 번) 같은 크기로 또 걸리지 않게 묻지 않고 반으로 나눌 구간부터 돌려준다.
// thinTried(S60-17 REC-빈답반복): 글은 왔지만 소리 길이에 비해 아주 적으면(model.mjs isThin) 한 번만 반으로 나눠 다시 묻는다({split, thin:true},
// 이 시도는 글을 쓰지 않으므로 실패 머리로 기록 = 월 상한에서 뺌). 이미 그렇게 나뉜 조각(thinTried)이거나 더 못 나누면 글을 두고 {thin: 길이}를 붙인다.
// 쓴 만큼 사용량 기록. Gemini에 올린 임시 파일은 끝나면 지운다. 작업 행 상태는 부른 쪽이 정한다.
async function transcribeLoaded(key: string, job: Job, audio: Loaded, range: Range | null, piece = 0, halveFirst = false, thinTried = false): Promise<Piece> {
  if (!range && audio.opened && audio.opened.seconds > CHUNK_SECONDS) return { split: chunkRanges(audio.opened.seconds) };
  let body = audio.body, size = audio.size, mime = audio.mime, span = audio.seconds;
  if (range) span = Math.round((range.to ?? audio.opened?.seconds ?? 0) - range.from);
  const halvesOf = (why: string) => {
    const halves = audio.opened ? halveRange(range, audio.opened.seconds) : [];
    if (halves.length) console.warn('meeting-transcribe: split after', why, Math.round((span || 0) / 60));
    return halves;
  };
  if (halveFirst) { const halves = halvesOf('step_cut'); if (halves.length) return { split: halves }; }
  if (range) {
    const cut = audio.opened?.slice(range.from, range.to);
    if (!cut) throw new Fail('bad_format');
    body = cut; size = cut.byteLength; mime = SLICE_MIME[audio.opened!.kind] || mime;
  }
  const duration = range ? span : (job.duration_sec ?? span);
  let geminiFile: string | null = null;
  try {
    const t0 = Date.now();
    const file = await geminiUpload(key, job.id, mime, body, size, audio.deadline);
    geminiFile = file.name;
    const t1 = Date.now();
    await geminiActive(key, file.name, file.state, audio.deadline);
    const t2 = Date.now();
    let response: unknown;
    try { response = await geminiTranscribe(key, file.uri, file.mimeType || mime, duration ?? null, audio.deadline); }
    catch (e) {
      if (e instanceof Fail && e.code === 'gemini_timeout') { const halves = halvesOf(e.code); if (halves.length) return { split: halves }; }
      throw e;
    }
    // 단계별 걸린 초(올리기·파일 준비·답)와 크기(MB)·길이(분)만 — 다음에 멈추면 어느 단계인지 바로 가른다(글·주소 없음).
    console.warn('meeting-transcribe: gemini timing', Math.round((t1 - t0) / 1000), Math.round((t2 - t1) / 1000), secSince(t2), Math.round(size / 1048576), Math.round((span || 0) / 60));
    // Gemini가 답했으면(글이 비었어도) 쓴 만큼 기록한다. 글을 못 받은 시도는 실패 머리로 적어 월 상한에서 뺀다(홈 AI 사용량에는 보임).
    const usage = readUsage(response, duration);
    let result: ReturnType<typeof readAnswer> | null = null;
    let answerError: unknown = null;
    try { result = readAnswer(response); } catch (e) { answerError = e; }
    // 글이 적은가(S60-17): 길이를 아는 소리(duration)만 본다. 다시 물을 수 있으면 이 글은 쓰지 않는다.
    const thin = !!result && isThin(result.text, duration);
    const retryThin = thin && !thinTried ? halvesOf('thin') : [];
    if (thin) console.warn('meeting-transcribe: thin answer', Math.round((duration || 0) / 60), retryThin.length ? 'retry' : 'keep');
    const at = new Date();
    const { error: usageError } = await admin.from('app_ai_external_usage').insert({
      workspace_id: job.workspace_id, ref: usageRef(job.id, at, !result || retryThin.length > 0, piece), provider: 'gemini', source: 'transcript', day: seoulDay(at), ...usage,
    });
    if (usageError) console.warn('meeting-transcribe: usage not recorded', usageError.code);
    if (!result) {
      if (answerError instanceof Fail && HALVE_CODES.includes(answerError.code)) {
        const halves = halvesOf(answerError.code);
        if (halves.length) return { split: halves };
      }
      throw answerError;
    }
    if (retryThin.length) return { split: retryThin, thin: true };
    return { text: result.text as string, speakerSplit: result.speakerSplit, model: usage.model as string, ...(thin ? { thin: Math.round(Number(duration) || 0) } : {}) };
  } finally {
    if (geminiFile) await geminiDelete(key, geminiFile);
  }
}

// 화면 transcribe(한 번 부름에 글을 돌려줌): 소리를 한 번 읽고, 길면 구간 조각을 동시에(최대 PARALLEL_CHUNKS) 전사해 시각 순으로 잇는다.
// 조각이 또 잘리면 그 조각만 반으로 다시(MIN_CHUNK_SECONDS까지). 서버 정리 작업은 조각마다 단계 하나씩(stepOnce)이라 이 함수를 쓰지 않는다.
const PARALLEL_CHUNKS = 3;
async function runTranscription(key: string, job: Job) {
  const audio = await loadAudio(job);
  let piece = 0;
  type Out = { range: Range | null; text: string; speakerSplit: boolean; model: string; thin?: number };
  const run = async (range: Range | null, thinTried = false): Promise<Out[]> => {
    const got = await transcribeLoaded(key, job, audio, range, range ? ++piece : 0, false, thinTried);
    if ('split' in got) { const again = thinTried || !!got.thin; return (await mapLimit(got.split, PARALLEL_CHUNKS, (r: Range) => run(r, again))).flat(); }
    return [{ range, ...got }];
  };
  const out = await run(null);
  if (out.length === 1 && !out[0].thin) return out[0];
  const text = joinParts(out.map((o) => ({ no: 1, seconds: o.range?.seconds ?? 0, range: o.range, text: cleanText(o.text), thin: o.thin })));
  return { text, speakerSplit: out.some((o) => o.speakerSplit), model: out[0].model };
}

async function attach(user: { id: string }, userDb: ReturnType<typeof userClient>, body: Record<string, unknown>) {
  const job = await ownJob(user.id, body.job_id);
  const meetingId = body.meeting_id;
  if (!isUuid(meetingId)) throw new Fail('bad_request');
  if (job.status !== 'done' || job.trashed_at) throw new Fail('not_done');
  if (job.meeting_id === meetingId) return json({ ok: true, already: true });
  if (job.meeting_id) throw new Fail('bad_request');
  // 회의는 호출한 사람의 토큰으로 읽는다(소유자 RLS). 같은 작업공간 회의만.
  const { data: meeting, error } = await userDb.from('app_meetings').select('id,workspace_id,project_id').eq('id', meetingId as string).maybeSingle();
  if (error) throw new Fail('failed');
  if (!meeting || meeting.workspace_id !== job.workspace_id) throw new Fail('not_found');
  const { error: docError } = await userDb.from('app_documents').insert(attachDocument({ job, meeting, userId: user.id }));
  if (docError) throw new Fail('failed');
  await setJob(job.id, { meeting_id: meeting.id });
  return json({ ok: true });
}

// ---- MTG-노트북녹음: 녹음 구간(app_meeting_recordings) ----
// 구간 행 고치기. guard가 있으면 그 칸이 같을 때만(동시에 두 번 와도 한 번만 반영). 고친 행 수를 돌려준다.
async function setRec(id: string, patch: Record<string, unknown>, guard: Record<string, string> = {}) {
  let q = admin.from(REC_TABLE).update({ updated_at: new Date().toISOString(), ...patch }).eq('id', id);
  for (const [k, v] of Object.entries(guard)) q = q.eq(k, v);
  const { data, error } = await q.select('id');
  if (error) throw new Fail('failed');
  return data?.length ?? 0;
}
async function ownRecording(userId: string, id: unknown): Promise<Job> {
  if (!isUuid(id)) throw new Fail('bad_request');
  const { data, error } = await admin.from(REC_TABLE).select(REC_COLUMNS).eq('id', id as string).maybeSingle();
  if (error) throw new Fail('failed');
  if (!data) throw new Fail('not_found');
  await requireOwner(userId, data.workspace_id);
  if (data.created_by !== userId) throw new Fail('not_found');
  return data as Job;
}
// 한 녹음(session)의 구간들. 모두 이 사람·같은 작업공간이어야 한다.
async function ownSession(userId: string, sessionId: unknown): Promise<Job[]> {
  if (!isUuid(sessionId)) throw new Fail('bad_request');
  const { data, error } = await admin.from(REC_TABLE).select(REC_COLUMNS).eq('session_id', sessionId as string)
    .order('segment_no', { ascending: true }).limit(REC_MAX_SEGMENTS + 1);
  if (error) throw new Fail('failed');
  const ws = ownRows(data, userId); // 모두 이 사람·같은 작업공간이 아니면 not_found
  await requireOwner(userId, ws);
  return data as Job[];
}
const segmentView = (r: Job) => ({ segment_no: r.segment_no, status: r.status, error_code: r.error_code ?? null, job_id: r.job_id ?? null, duration_sec: r.duration_sec ?? null });

// 조각 하나 내려받기 요청(이어 붙이기는 recording.mjs joinPieces가 순서대로, 다음 조각은 미리).
const pieceMedia = (token: string) => (id: string) =>
  fetch(`${DRIVE}/${encodeURIComponent(id)}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
// 조각 파일 크기(조각 폴더 바로 아래, 휴지통 아님)의 합.
// 1분 조각이면 한 구간이 60개라 REC_DRIVE_PARALLEL개씩 동시에 묻는다(하나라도 이상하면 drive_failed).
async function piecesSize(token: string, ids: string[], folder: string) {
  const sizes = await mapLimit(ids, REC_DRIVE_PARALLEL, async (id: string) => {
    const r = await fetch(`${DRIVE}/${encodeURIComponent(id)}?fields=size,trashed,parents`, { headers: { Authorization: `Bearer ${token}` } });
    const d = await r.json().catch(() => null);
    if (!r.ok || d?.trashed !== false || !Array.isArray(d?.parents) || !d.parents.includes(folder) || !/^\d{1,12}$/.test(String(d?.size))) throw new Fail('drive_failed');
    return Number(d.size);
  });
  return sizes.reduce((a: number, b: number) => a + b, 0);
}
// 조각을 Drive 휴지통으로(조각 폴더 바로 아래 것만). 모두 끝나면 표시.
async function trashPieces(seg: Job, token: string, folder: string | null, extra: Record<string, unknown> = {}) {
  let all = true;
  if (folder) {
    const results = await mapLimit(seg.piece_ids || [], REC_DRIVE_PARALLEL, (id: string) => moveDriveFileToTrash(fetch, id, folder, token).catch(() => 'unknown'));
    if (results.some((result: string) => !(result === 'trashed' || result === 'already_trashed' || result === 'not_ours'))) all = false;
  } else if ((seg.piece_ids || []).length) all = false;
  if (all) await setRec(seg.id, { ...extra, pieces_trashed_at: new Date().toISOString() });
  return all;
}
// 닫힌 구간 하나 → 한 파일(회의 녹음 폴더) + 전사 작업 한 행 → 조각 휴지통.
async function combineSegment(userId: string, seg: Job, token: string, pieces: string | null, target: string) {
  try {
    if (!pieces) throw new Fail('drive_failed');
    const size = await piecesSize(token, seg.piece_ids, pieces);
    if (size <= 0) throw new Fail('drive_failed');
    if (size > MAX_BYTES) throw new Fail('too_large');
    const name = segmentFileName(seg.created_at, seg.segment_no, seg.mime_type);
    const driveId = await driveUpload(token, target, joinPieces(pieceMedia(token), seg.piece_ids), name, seg.mime_type, size);
    const { data: job, error } = await admin.from(TABLE).insert({
      workspace_id: seg.workspace_id, created_by: userId, status: 'uploaded', drive_file_id: driveId,
      file_name: name, mime_type: seg.mime_type, size_bytes: size, duration_sec: seg.duration_sec ?? null,
    }).select('id').single();
    if (error || !job?.id) {
      await moveDriveFileToTrash(fetch, driveId, target, token).catch(() => 'unknown');
      throw new Fail('failed');
    }
    if (!(await setRec(seg.id, { status: 'combined', error_code: null, job_id: job.id }, { status: 'closed' }))) {
      // 다른 호출이 먼저 합쳤다: 이 사본은 버린다(휴지통 + 작업에 휴지통 표시).
      await moveDriveFileToTrash(fetch, driveId, target, token).catch(() => 'unknown');
      await setJob(job.id, { trashed_at: new Date().toISOString() }).catch(() => undefined);
      return;
    }
    await trashPieces(seg, token, pieces).catch(() => undefined);
  } catch (e) {
    const code = e instanceof Fail ? e.code : 'drive_failed';
    // 조각은 그대로 두고 닫힌 상태로 남긴다(다시 부르면 다시 합침). 너무 크면 실패로 둔다.
    await setRec(seg.id, code === 'too_large' ? { status: 'failed', error_code: code } : { error_code: code }, { status: 'closed' }).catch(() => 0);
    throw e instanceof Fail ? e : new Fail(code);
  }
}

// 서버 쪽 정리(이 작업공간만): 합친 구간의 남은 조각 휴지통 다시 시도, 30일 넘게 합치지 못한 구간은 조각 휴지통 + 실패(expired).
async function sweepRecordings(workspaceId: string) {
  try {
    const since = pendingSince(new Date());
    const { data: done } = await admin.from(REC_TABLE).select(REC_COLUMNS).eq('workspace_id', workspaceId).eq('status', 'combined')
      .is('pieces_trashed_at', null).order('created_at', { ascending: true }).limit(SWEEP_LIMIT);
    const { data: old } = await admin.from(REC_TABLE).select(REC_COLUMNS).eq('workspace_id', workspaceId).in('status', ['recording', 'closed', 'failed'])
      .is('pieces_trashed_at', null).lt('created_at', since).order('created_at', { ascending: true }).limit(SWEEP_LIMIT);
    // 버린 녹음 중 조각 휴지통이 덜 된 것(30일 기다리지 않고 다시 시도). 상태(버림 표시)는 그대로.
    const { data: dropped } = await admin.from(REC_TABLE).select(REC_COLUMNS).eq('workspace_id', workspaceId).eq('status', 'failed')
      .like('error_code', 'discarded%').is('pieces_trashed_at', null).order('created_at', { ascending: true }).limit(SWEEP_LIMIT);
    if (!done?.length && !old?.length && !dropped?.length) return;
    const token = await driveToken(workspaceId);
    const folder = await pieceFolder(workspaceId, token, false);
    for (const seg of done || []) await trashPieces(seg, token, folder);
    for (const seg of dropped || []) await trashPieces(seg, token, folder);
    for (const seg of old || []) {
      if (seg.status === 'failed' && (dropped || []).some(d => d.id === seg.id)) continue; // 위에서 이미 다시 시도함
      await trashPieces(seg, token, folder, seg.status === 'failed' ? {} : { status: 'failed', error_code: 'expired', closed_at: seg.closed_at ?? new Date().toISOString() });
    }
  } catch (e) {
    console.warn('meeting-transcribe: recording sweep skipped', safeErrorLog(e));
  }
}

async function recStart(user: { id: string }, body: Record<string, unknown>) {
  const workspaceId = String(body.workspace_id || '');
  await requireOwner(user.id, workspaceId);
  const mime = recMime(body.mime);
  let sessionId: string;
  let segmentNo = 1;
  if (body.session_id !== undefined && body.session_id !== null && body.session_id !== '') {
    const rows = await ownSession(user.id, body.session_id);
    if (rows[0].workspace_id !== workspaceId) throw new Fail('not_found');
    sessionId = body.session_id as string;
    segmentNo = nextSegment(rows);
  } else {
    sessionId = crypto.randomUUID();
  }
  // 작업공간마다 열린 구간은 하나(부분 유일 색인). 남은 것은 먼저 닫는다(조각이 없으면 empty).
  const now = new Date();
  const { data: open, error: openError } = await admin.from(REC_TABLE).select(REC_COLUMNS).eq('workspace_id', workspaceId).eq('status', 'recording').limit(2);
  if (openError) throw new Fail('failed');
  for (const r of open || []) await setRec(r.id, closePatch(r, now), { status: 'recording' });
  const { data, error } = await admin.from(REC_TABLE).insert({
    workspace_id: workspaceId, created_by: user.id, session_id: sessionId, segment_no: segmentNo, mime_type: mime,
  }).select('id').single();
  if (error || !data?.id) throw new Fail(error?.code === '23505' ? 'busy' : 'failed');
  return json({ ok: true, recording_id: data.id, session_id: sessionId, segment_no: segmentNo, piece_seconds: REC_PIECE_SECONDS, segment_seconds: REC_SEGMENT_SECONDS, max_pieces: REC_ROLL_PIECES });
}

async function recPiece(req: Request, user: { id: string }) {
  const piece = parsePiece({
    recordingId: req.headers.get('x-recording-id'), seq: req.headers.get('x-piece-seq'),
    length: req.headers.get('content-length'), seconds: req.headers.get('x-duration-sec'),
  });
  if (!req.body) throw new Fail('bad_request');
  const rec = await ownRecording(user.id, piece.recordingId);
  const decision = pieceDecision(rec, piece.seq, piece.size);
  if (decision.action === 'already') {
    await req.body.cancel().catch(() => undefined);
    return json({ ok: true, already: true, pieces: (rec.piece_ids || []).length });
  }
  const token = await driveToken(rec.workspace_id);
  const folder = await pieceFolder(rec.workspace_id, token, true);
  if (!folder) throw new Fail('drive_failed');
  const driveId = await driveUpload(token, folder, req.body, pieceFileName(rec.id, piece.seq, rec.mime_type), rec.mime_type, piece.size);
  const patch = appendPatch(rec, driveId, piece.size, piece.duration, new Date());
  // 읽은 뒤 아무도 고치지 않았을 때만 더한다(같은 조각이 동시에 두 번 와도 하나만 남김).
  const { data, error } = await admin.from(REC_TABLE).update(patch).eq('id', rec.id).eq('status', 'recording').eq('updated_at', rec.updated_at).select('id');
  if (error || !data?.length) {
    await moveDriveFileToTrash(fetch, driveId, folder, token).catch(() => 'unknown');
    if (error) throw new Fail('failed');
    const now = await ownRecording(user.id, rec.id);
    if (piece.seq <= (now.piece_ids || []).length) return json({ ok: true, already: true, pieces: now.piece_ids.length });
    pieceDecision(now, piece.seq, piece.size); // 닫혔으면 rec_closed, 순서가 바뀌었으면 piece_gap
    throw new Fail('busy');
  }
  return json({ ok: true, pieces: patch.piece_ids.length, size_bytes: patch.size_bytes });
}

// 열린 구간 닫기 → 닫힌 구간 합치기(시간이 모자라면 more). 화면 rec_finish와 서버 정리 combine 단계 공용.
async function finishSegments(userId: string, sessionId: unknown) {
  const started = Date.now();
  let rows = await ownSession(userId, sessionId);
  const ws = rows[0].workspace_id as string;
  const now = new Date();
  for (const r of rows) if (r.status === 'recording') await setRec(r.id, closePatch(r, now), { status: 'recording' });
  rows = await ownSession(userId, sessionId);
  let more = false;
  const pending = toCombine(rows);
  if (pending.length) {
    const token = await driveToken(ws);
    const pieces = await pieceFolder(ws, token, false);
    const target = await recordingFolder(ws, token, true);
    if (!target) throw new Fail('drive_failed');
    ({ more } = await combineWithin(pending, (seg: Job) => combineSegment(userId, seg, token, pieces, target), started));
    rows = await ownSession(userId, sessionId);
  }
  return { more, rows };
}

async function recFinish(user: { id: string }, body: Record<string, unknown>) {
  const { more, rows } = await finishSegments(user.id, body.session_id);
  return json({ ok: true, session_id: body.session_id, more, segments: rows.filter(r => r.status !== 'empty').map(segmentView) });
}

// S61-5 REC-전사삭제: rec_save {session_id, meeting_id?} — 합친 녹음 파일(구간마다 하나)을 자료실 자료로 남긴다.
//   자료 행·폴더·연결은 부른 사람 로그인(owner RLS)으로만 쓴다(서비스 권한으로 자료실 표를 쓰지 않음). 같은 Drive 파일의 자료 행이 있으면
//   새로 만들지 않는다(두 번 불러도 한 번). 자료실 맨 위 '회의 녹음' 폴더(프로젝트 없음, 휴지통 아님)가 없으면 처음 저장할 때 만든다.
//   meeting_id가 있으면 그 회의(부른 사람 로그인으로 읽은 같은 작업공간 회의)의 자료로도 붙인다. 전사·요약은 하지 않는다.
async function recSave(user: { id: string }, userDb: ReturnType<typeof userClient>, body: Record<string, unknown>) {
  const rows = await ownSession(user.id, body.session_id);
  const ws = rows[0].workspace_id as string;
  if (rows.some(r => r.status === 'recording' || r.status === 'closed')) throw new Fail('busy'); // rec_finish를 먼저(화면이 more가 끝날 때까지 부름)
  let meeting: { id: string; workspace_id: string; project_id: string | null } | null = null;
  if (body.meeting_id !== undefined && body.meeting_id !== null && body.meeting_id !== '') {
    if (!isUuid(body.meeting_id)) throw new Fail('bad_request');
    const { data, error } = await userDb.from('app_meetings').select('id,workspace_id,project_id').eq('id', body.meeting_id as string).maybeSingle();
    if (error) throw new Fail('failed');
    if (!data || data.workspace_id !== ws) throw new Fail('not_found');
    meeting = data;
  }
  const combined = rows.filter(r => r.status === 'combined' && r.job_id);
  if (!combined.length) throw new Fail('no_recording');
  const order = new Map(combined.map(r => [r.job_id, r.segment_no]));
  const jobs = (await sessionJobs(combined))
    .filter(j => !j.trashed_at && j.drive_file_id)
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  if (!jobs.length) throw new Fail('no_recording');
  const folderId = await recordingLibraryFolder(userDb, ws);
  const files = [];
  for (const job of jobs) {
    const { data: found, error: findError } = await userDb.from('app_documents').select('id,file_name,drive_url,mime_type,meeting_id')
      .eq('workspace_id', ws).eq('file_id', job.drive_file_id).limit(1);
    if (findError) throw new Fail('failed');
    let doc = found?.[0] ?? null;
    if (!doc) {
      const { data: made, error: makeError } = await userDb.from('app_documents').insert(recordingDocument({ job, workspaceId: ws, meeting, userId: user.id }))
        .select('id,file_name,drive_url,mime_type,meeting_id').single();
      if (makeError || !made) throw new Fail('failed');
      doc = made;
      // 새로 만든 자료만 '회의 녹음' 폴더로(받는 폴더 트리거가 먼저 넣었어도 이 폴더로 고침). 이미 있던 자료는 사람이 옮긴 자리를 그대로 둔다.
      const { error: linkError } = await userDb.from('app_library_folder_items')
        .upsert({ document_id: doc.id, folder_id: folderId, workspace_id: ws }, { onConflict: 'document_id' });
      if (linkError) console.warn('meeting-transcribe: recording folder link skipped', linkError.code || '-');
    }
    if (meeting && !job.meeting_id) await setJob(job.id, { meeting_id: meeting.id });
    files.push(savedFileView(doc, job));
  }
  return json({ ok: true, session_id: body.session_id, folder_id: folderId, folder_name: LIBRARY_RECORDING_FOLDER, files });
}
// 자료실 맨 위 '회의 녹음' 폴더(프로젝트 없음·휴지통 아님). 없으면 맨 아래 순서로 하나 만든다(자료실 [새 폴더]와 같은 표·같은 owner RLS).
async function recordingLibraryFolder(userDb: ReturnType<typeof userClient>, ws: string): Promise<string> {
  const { data: tops, error } = await userDb.from('app_library_folders').select('id,name,sort_order,deleted_at')
    .eq('workspace_id', ws).is('project_id', null).is('parent_id', null).limit(500);
  if (error) throw new Fail('failed');
  const live = (tops || []).filter(f => !f.deleted_at);
  const have = live.find(f => f.name === LIBRARY_RECORDING_FOLDER);
  if (have) return have.id as string;
  const sort = live.reduce((m, f) => Math.max(m, Number(f.sort_order) || 0), 0) + 1;
  const { data: made, error: makeError } = await userDb.from('app_library_folders')
    .insert({ workspace_id: ws, project_id: null, parent_id: null, name: LIBRARY_RECORDING_FOLDER, sort_order: sort }).select('id').single();
  if (makeError || !made?.id) throw new Fail('failed');
  return made.id as string;
}

async function recPending(user: { id: string }, userDb: ReturnType<typeof userClient>, body: Record<string, unknown>) {
  const workspaceId = String(body.workspace_id || '');
  await requireOwner(user.id, workspaceId);
  await sweep(workspaceId);
  await sweepRecordings(workspaceId);
  const now = new Date();
  const { data: rows, error } = await admin.from(REC_TABLE).select(REC_COLUMNS).eq('workspace_id', workspaceId).eq('created_by', user.id)
    .gte('created_at', pendingSince(now)).order('created_at', { ascending: false }).limit(200);
  if (error) throw new Fail('failed');
  const ids = [...new Set((rows || []).map(r => r.job_id).filter(Boolean))] as string[];
  let jobs: Job[] = [];
  if (ids.length) {
    const { data, error: jobError } = await admin.from(TABLE).select('id,status,drive_file_id').in('id', ids);
    if (jobError) throw new Fail('failed');
    jobs = data || [];
    // S61-5 REC-전사삭제: 자료실에 이미 저장한 녹음(같은 Drive 파일의 자료 행이 있음)은 끝난 녹음이다.
    const files = jobs.map(j => j.drive_file_id).filter(Boolean) as string[];
    if (files.length) {
      // 자료 행은 부른 사람 로그인(owner RLS)으로만 읽는다(서비스 권한으로 app_documents를 읽지 않음).
      const { data: docs, error: docError } = await userDb.from('app_documents').select('file_id').eq('workspace_id', workspaceId).in('file_id', files);
      if (docError) throw new Fail('failed');
      const kept = new Set((docs || []).map(d => d.file_id));
      jobs = jobs.map(j => ({ ...j, saved: kept.has(j.drive_file_id) }));
    }
  }
  return json({ ok: true, sessions: pendingSessions(rows || [], jobs, now), live: liveSessions(rows || [], now) });
}

// ---- 버리기·되돌리기 ----
// Drive 휴지통에서 한 파일 꺼내기(moveDriveFileToTrash의 거꾸로). 이 앱이 가진 파일이고 지정한 폴더 바로 아래 것만.
// 'restored'(꺼냄)·'ok'(이미 휴지통 밖) = 됨, 'not_ours'(없음·남의 것·다른 폴더)·'retry'(잠깐 실패) = 안 됨.
async function untrashDriveFile(id: string, folder: string, token: string): Promise<'restored' | 'ok' | 'not_ours' | 'retry'> {
  const auth = { Authorization: `Bearer ${token}` };
  let meta;
  try {
    const r = await fetch(`${DRIVE}/${encodeURIComponent(id)}?fields=id,mimeType,ownedByMe,trashed,parents`, { headers: auth, redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (r.status === 404) return 'not_ours';
    if (!r.ok) return 'retry';
    meta = await r.json();
  } catch { return 'retry'; }
  if (!meta || meta.id !== id || typeof meta.trashed !== 'boolean') return 'retry';
  if (meta.ownedByMe !== true || meta.mimeType === FOLDER || !Array.isArray(meta.parents) || meta.parents.length !== 1 || meta.parents[0] !== folder) return 'not_ours';
  if (!meta.trashed) return 'ok';
  try {
    const r = await fetch(`${DRIVE}/${encodeURIComponent(id)}?fields=id,trashed`, {
      method: 'PATCH', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: false }),
      redirect: 'error', signal: AbortSignal.timeout(30000),
    });
    const d = await r.json().catch(() => null);
    return r.ok && d?.id === id && d?.trashed === false ? 'restored' : 'retry';
  } catch { return 'retry'; }
}
async function sessionJobs(rows: Job[]): Promise<Job[]> {
  const ids = [...new Set(rows.map(r => r.job_id).filter(Boolean))] as string[];
  if (!ids.length) return [];
  const { data, error } = await admin.from(TABLE).select(JOB_COLUMNS).in('id', ids);
  if (error) throw new Fail('failed');
  return (data || []).filter(j => j.workspace_id === rows[0].workspace_id) as Job[];
}

async function recDiscard(user: { id: string }, body: Record<string, unknown>) {
  // 1) 상태부터 바꾼다(그 뒤로는 조각이 더 붙지 않음: rec_piece는 status='recording'일 때만 더함).
  //    읽은 뒤 조각이 붙었으면(updated_at이 달라짐) 다시 읽고 다시 한다(그 조각도 같이 휴지통으로).
  const plan: ReturnType<typeof discardPlan> = [];
  let ws = '';
  for (let tries = 0; ; tries++) {
    const rows = await ownSession(user.id, body.session_id);
    ws = rows[0].workspace_id as string;
    let now: ReturnType<typeof discardPlan>;
    try { now = discardPlan(rows, await sessionJobs(rows)); } catch (e) {
      if (plan.length && e instanceof Fail && e.code === 'not_found') break; // 앞 시도에서 이미 다 버림
      throw e;
    }
    const at = new Date();
    let lost = false;
    for (const p of now) {
      if (await setRec(p.row.id, discardPatch(p.row, p.kind, at), { status: p.row.status, updated_at: p.row.updated_at })) plan.push(p);
      else lost = true;
    }
    if (!lost) break;
    if (tries >= 2) throw new Fail('busy');
  }
  // 2) Drive 휴지통(영구 삭제 아님). 일부 실패해도 버림 표시는 그대로이고, 남은 것은 rec_pending 정리가 다시 넣는다.
  let trashed = true;
  try {
    const token = await driveToken(ws);
    const folder = await pieceFolder(ws, token, false);
    const target = await recordingFolder(ws, token, false);
    for (const p of plan) {
      if (p.kind === 'close') continue;
      if (p.kind === 'combined') {
        const job = p.job as Job;
        const result = target && job.drive_file_id ? await moveDriveFileToTrash(fetch, job.drive_file_id, target, token).catch(() => 'unknown') : 'not_ours';
        if (result === 'trashed' || result === 'already_trashed' || result === 'not_ours') await setJob(job.id, { trashed_at: new Date().toISOString() });
        else trashed = false;
      }
      if (!p.row.pieces_trashed_at && !(await trashPieces(p.row, token, folder).catch(() => false))) trashed = false;
    }
  } catch (e) {
    trashed = false;
    console.warn('meeting-transcribe: discard trash later', e instanceof Fail ? e.code : 'error');
  }
  return json({ ok: true, session_id: body.session_id, discarded: plan.filter(p => p.kind !== 'close').length, trashed });
}

async function recRestore(user: { id: string }, body: Record<string, unknown>) {
  const rows = await ownSession(user.id, body.session_id);
  const ws = rows[0].workspace_id as string;
  const plan = restorePlan(rows);
  const jobs = new Map((await sessionJobs(rows)).map(j => [j.id, j]));
  const token = await driveToken(ws);
  const folder = await pieceFolder(ws, token, false);
  const target = await recordingFolder(ws, token, false);
  const ok = (r: string) => r === 'restored' || r === 'ok';
  let restored = 0;
  for (const p of plan) {
    if (p.to === 'combined') {
      const job = jobs.get(p.row.job_id);
      if (!job || !target || !job.drive_file_id || !ok(await untrashDriveFile(job.drive_file_id, target, token))) throw new Fail('drive_failed');
      await setJob(job.id, { trashed_at: null });
      if (await setRec(p.row.id, { status: 'combined', error_code: null }, { status: 'failed', error_code: p.row.error_code })) restored++;
    } else {
      if (!folder) throw new Fail('drive_failed');
      const back = await mapLimit(p.row.piece_ids || [], REC_DRIVE_PARALLEL, (id: string) => untrashDriveFile(id, folder, token));
      if (!back.every(ok)) throw new Fail('drive_failed');
      if (await setRec(p.row.id, { status: 'closed', error_code: null, pieces_trashed_at: null }, { status: 'failed', error_code: p.row.error_code })) restored++;
    }
  }
  return json({ ok: true, session_id: body.session_id, restored });
}

// ---- REC-서버정리 · MTG-첨부녹음전사(S49-2): 서버 정리 작업(app_meeting_server_jobs, 설계 meeting-transcript-server.md 8절) ----
// 화면을 닫아도 서버가 합치기 → 구간(파일) 전사 → 요약을 한 단계씩 이어 간다. 한 번 호출 = 한 단계, 끝나면 같은 함수 job_tick을 다시 부른다.
// job_tick은 사용자 로그인이 없다: 게이트(verify_jwt)는 SUPABASE_ANON_KEY로 지나고, 이 코드가 서버 키 HMAC(작업 id·기한)을 확인한다.
// 작업 행은 owner만 읽고(RLS), 쓰기는 이 함수(service_role)만 한다. 전사·요약은 명진이 누른 job_start로만 시작한다.
// REC-초안버리기(S60-20): job_discard {job_id}·job_restore {job_id} — 끝난 결과에 '버림' 표시를 넣고 빼기(job_list에서 빠짐, 소리·글은 그대로).
// REC-정리멈춤반복(11/09): 서버 요약도 Web2 전용 열쇠만 읽는다(결정 D2, docs/design/ai-server.md). 옛 이름 OPENAI_API_KEY는 Web2 열쇠가 아니라 OpenAI가 401로 거절해 요약이 늘 draft_failed였다.
const OPENAI = () => (Deno.env.get('WEB2_OPENAI_API_KEY') || '').trim();
// 사람이 봐야 하는 요약 초안(답 원문 보존·칸 어긋남). 같은 실행 안에서 serverDraft → runStep으로만 넘긴다(저장하지 않음).
const draftNeedsReview = new WeakSet<object>();
// deno-lint-ignore no-explicit-any
const edgeRuntime = () => (globalThis as any).EdgeRuntime as { waitUntil?: (p: Promise<unknown>) => void } | undefined;
// 응답을 돌려준 뒤에도 이어서 돌린다(EdgeRuntime.waitUntil). 없으면(시험) 그냥 돌린다.
function inBackground(p: Promise<unknown>) {
  const q = p.catch((e) => console.warn('meeting-transcribe: job background', safeErrorLog(e)));
  const rt = edgeRuntime();
  if (rt?.waitUntil) rt.waitUntil(q);
}
const jobsFail = (error: { code?: string } | null) =>
  new Fail(error?.code === '42P01' || error?.code === 'PGRST205' || error?.code === 'PGRST204' ? 'jobs_unavailable' : 'failed');
async function readServerJob(id: string): Promise<Job | null> {
  const { data, error } = await admin.from(SERVER_JOB_TABLE).select(SERVER_JOB_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw jobsFail(error);
  return (data as Job) ?? null;
}
async function ownServerJob(userId: string, id: unknown): Promise<Job> {
  if (!isUuid(id)) throw new Fail('bad_request');
  const job = await readServerJob(id as string);
  if (!job) throw new Fail('not_found');
  await requireOwner(userId, job.workspace_id);
  if (job.created_by !== userId) throw new Fail('not_found');
  return job;
}
async function patchServerJob(id: string, patch: Record<string, unknown>) {
  const { error } = await admin.from(SERVER_JOB_TABLE).update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw jobsFail(error);
}
// 단계를 돌리는 표는 둘이다(REC-한회의로잇기 PR-2): 서버 정리 작업('job')과 잇기 작업('join'). 잡기·실패 처리·요약 단계 코드는 한 벌을 같이 쓰고,
// 표·읽는 칸·다음 단계 입구(tick)와 그 서명만 다르다. 잇기 작업 표는 고치기 권한이 있는 칸만 쓴다(joinPatch).
type StepKind = 'job' | 'join';
const STEP: Record<StepKind, { table: string; columns: string; action: string }> = {
  job: { table: SERVER_JOB_TABLE, columns: SERVER_JOB_COLUMNS, action: 'job_tick' },
  join: { table: JOIN_JOB_TABLE, columns: JOIN_STEP_COLUMNS, action: JOIN_TICK_ACTION },
};
async function readStepJob(id: string, kind: StepKind): Promise<Job | null> {
  if (kind === 'job') return await readServerJob(id);
  const { data, error } = await admin.from(JOIN_JOB_TABLE).select(JOIN_STEP_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw jobsFail(error);
  return (data as Job) ?? null;
}
async function patchStepJob(id: string, patch: Record<string, unknown>, kind: StepKind) {
  if (kind === 'job') return await patchServerJob(id, patch);
  let q = admin.from(JOIN_JOB_TABLE).update(joinPatch(patch, new Date().toISOString())).eq('id', id);
  // 이미 적용된 작업(DB 함수가 적용 기록과 함께 done으로 바꿈)은 실패로 덮지 않는다 — apply 답이 끊겨 실패로 보인 경우에도 보고와 작업 행이 어긋나지 않게.
  if (patch.status === 'failed') q = q.is('applied_at', null);
  const { error } = await q;
  if (error) throw jobsFail(error);
}

// 같은 함수의 job_tick(잇기 작업은 join_tick)을 부른다(다음 단계). 받는 쪽은 바로 202를 주고 뒤에서 단계를 돌린다.
async function kickTick(id: string, kind: StepKind = 'job') {
  const exp = Date.now() + TICK_TTL_MS;
  try {
    const sig = await tickSign(SERVICE, id, exp, kind);
    const r = await fetch(`${SB}/functions/v1/meeting-transcribe?action=${STEP[kind].action}`, {
      method: 'POST', headers: { Authorization: `Bearer ${ANON}`, apikey: ANON, 'Content-Type': 'application/json', [TICK_HEADER]: sig },
      body: JSON.stringify({ job_id: id, exp }), signal: AbortSignal.timeout(20000),
    });
    await r.body?.cancel().catch(() => undefined);
    if (!r.ok) console.warn('meeting-transcribe: job tick not accepted', r.status);
  } catch {
    console.warn('meeting-transcribe: job tick not sent'); // 화면 확인(job_read)·다시 열기(job_list)가 다시 깨운다
  }
}

// 단계 하나. 잡기(lease) → 한 단계 → 결과 저장 → 다음 부르기. 다른 호출이 잡고 있으면 아무것도 안 한다.
// 잡기는 읽은 행의 lease_until 그대로일 때만 바꾼다(동시에 두 번 와도 한 번만). 기한 지난 lease_until이 남아 있으면 앞 실행이
// 단계 중간에 끊긴 것(REC-정리멈춤반복, server-job.mjs leaseTake): 처음은 표시만 하고 한 번 더, 같은 단계에서 또 끊기면 step_cut 실패.
async function runStep(id: string, kind: StepKind = 'job') {
  const now = new Date();
  const step = STEP[kind];
  let before: Job | null;
  try { before = await readStepJob(id, kind); } catch (e) { console.warn('meeting-transcribe: job read failed', safeErrorLog(e)); return; }
  const take = leaseTake(before, now.getTime());
  if (!before || !take.ok) return;
  const lease: Record<string, unknown> = { status: 'running', lease_until: new Date(now.getTime() + LEASE_MS).toISOString(), updated_at: now.toISOString() };
  if (take.cut === 1) lease.error_code = 'step_cut';
  let q = admin.from(step.table).update(lease).eq('id', id).in('status', [...ACTIVE]);
  q = before.lease_until ? q.eq('lease_until', before.lease_until) : q.is('lease_until', null);
  const { data, error } = await q.select(step.columns);
  if (error) { console.warn('meeting-transcribe: job lease failed', error.code); return; }
  const job = (data?.[0] as Job) ?? null;
  if (!job) return;
  if (take.cut) console.warn('meeting-transcribe: job step cut', job.stage, take.cut);
  // 실패·다시·끊김·오래 걸림 이력은 DB 트리거가 fail_log에 남긴다(migration 20261111010000). 여기서는 상태만 저장한다.
  let next: Record<string, unknown>;
  try {
    // 같은 단계에서 두 번 끊김: 요약 단계면 요약 쪽 이유(전사한 글은 남음), 그 밖은 구간 쪽 이유.
    // S61-5 REC-전사삭제: 회의 녹음 서버 정리(합치기 → 전사 → 요약)는 더 하지 않는다. 배포 때 돌던 작업도 다음 단계에서 이 이유로 멈춘다(녹음 파일은 그대로).
    if (kind === 'job') throw new Fail('transcribe_off');
    if (take.cut >= 2) throw new Fail(job.stage === 'summary' ? 'draft_step_cut' : 'step_cut');
    if (job.attempts >= MAX_ATTEMPTS) throw new Fail('too_many_steps');
    // 잇기 작업: apply 단계는 DB 함수 한 번, 요약 단계는 서버 정리 작업과 같은 stepOnce를 쓰고 끝나면 done 대신 apply로 간다.
    if (kind === 'join' && job.stage === 'apply') next = await applyJoin(job);
    else {
      next = await stepOnce(job, take.cut === 1);
      if (kind === 'join') next = joinAfterSummary(next, !!next.draft && typeof next.draft === 'object' && draftNeedsReview.has(next.draft as object));
    }
  } catch (e) {
    const code = failCode(e);
    console.warn('meeting-transcribe: job step failed', kind, job.stage, code);
    // REC-멈춤띠계속뜸: 닫은 멈춤을 [다시] 했는데 같은 이유로 또 멈추면 닫은 그대로(띠를 또 띄우지 않음). 잇기 작업에는 이 표시가 없다.
    const failed = kind === 'job' ? failedCode(job.error_code as string | null, code) : code;
    await patchStepJob(id, { status: 'failed', error_code: failed, lease_until: null, attempts: job.attempts + 1, finished_at: new Date().toISOString() }, kind).catch(() => undefined);
    return;
  }
  // 잇기 작업의 apply는 DB 함수가 작업 행(done·적용 기록·잡기 비움)까지 한 트랜잭션으로 쓴다. 여기서 다시 쓰지 않는다
  // (바로 뒤에 온 되돌리기가 바꾼 상태를 done으로 덮지 않게).
  // 단계 사이에는 닫음 표시를 이어 가고(같은 이유로 또 멈추면 닫은 그대로), 끝나면 빈 값.
  // 서버 정리 작업(job)은 위에서 transcribe_off로 멈추므로 여기에는 잇기 작업만 온다(타입 좁힘을 풀어 둔 비교).
  const keep = (kind as StepKind) === 'job' && next.status !== 'done' ? carryClosed(job.error_code as string | null) : null;
  if (!(kind === 'join' && job.stage === 'apply')) await patchStepJob(id, { ...next, error_code: keep, lease_until: null, attempts: job.attempts + 1 }, kind);
  if (next.status === 'done') { await notifyDone(job, kind).catch(() => console.warn('meeting-transcribe: job push skipped')); return; }
  await kickTick(id, kind);
}

// 잇기 작업의 apply 단계: 서버 전용 DB 함수 한 번. 보고 글 바꾸기 + 녹음 연결(합치기면 자료·할 일 연결 옮기기 + 없어지는 보고 휴지통)이
// 한 트랜잭션이고, 어긋나면(그 사이 보고를 고침·휴지통 등) 고정 글자 예외로 전체가 취소된다 → 실패 코드로 바꾼다(보고는 그대로).
// 함수는 id만 받고, 만든 사람이 지금도 owner인지·같은 작업공간·[회의] 칸·글이 시작 때 그대로인지를 SQL로 다시 확인한다. 두 번 불러도 한 번만.
async function applyJoin(job: Job): Promise<Record<string, unknown>> {
  const { data, error } = await admin.rpc('app_meeting_join_apply', { p_job: job.id });
  if (error) { console.warn('meeting-transcribe: join apply', error.code || '-'); throw new Fail(joinRpcCode(error)); }
  const outcome = applyOutcome(data);
  if (outcome !== 'done') throw new Fail(outcome === 'not_found' ? 'not_found' : 'failed');
  return { status: 'done', stage: 'done' };
}

async function stepOnce(job: Job, cutBefore = false): Promise<Record<string, unknown>> {
  const started = job.started_at ? {} : { started_at: new Date().toISOString() };
  if (job.stage === 'combine') {
    const { more, rows } = await finishSegments(job.created_by, job.session_id);
    if (more) return { ...started, status: 'queued' };
    const parts = recordingParts(rows.map(segmentView));
    if (!partTotal(parts)) throw new Fail('empty_transcript');
    return { ...started, status: 'queued', stage: 'transcribe', parts, step_no: 0, step_total: partTotal(parts) };
  }
  if (job.stage === 'transcribe') {
    const parts = Array.isArray(job.parts) ? [...job.parts] : [];
    const i = nextPart(parts);
    if (i >= 0) {
      const key = GEMINI();
      if (!key) throw new Fail('not_ready');
      const p = parts[i];
      // REC-긴녹음나눠전사: 조각(range)이 있으면 그 시간 구간만. 길거나 답이 잘리면 이 자리를 시간 조각들로 바꾸고(끝난 조각 글은 그대로) 다음 단계에서 잇는다.
      const range = p.range === undefined ? null : readRange(p.range);
      if (p.range !== undefined && !range) throw new Fail('failed');
      const more = moreOfSame(parts, i);
      // S60-11: 앞 실행이 이 조각에서 끊겼으면(cutBefore) 같은 크기로 또 묻지 않고 반으로 나눈다(요약 단계와 같은 규칙).
      const thinTried = p.retry === 'thin';
      const got = p.file ? await transcribeFile(key, job, p.file, range, cutBefore, thinTried) : await transcribeSegment(key, p.job, range, more, cutBefore, thinTried);
      if ('split' in got) {
        const next = splitPart(parts, i, got.split, got.thin ? 'thin' : '');
        if (next.length === parts.length) throw new Fail('gemini_incomplete');
        return { ...started, status: 'queued', parts: next, step_no: doneParts(next), step_total: partTotal(next) };
      }
      parts[i] = { ...p, text: cleanText(got.text), ...(got.thin ? { thin: got.thin } : {}) };
      if (nextPart(parts) >= 0) return { ...started, status: 'queued', parts, step_no: doneParts(parts), step_total: partTotal(parts) };
    }
    const transcript = joinParts(parts);
    if (!hasWords(transcript)) throw new Fail('empty_transcript');
    const plan = summaryPlan(transcript, []);
    return { ...started, status: 'queued', stage: 'summary', parts, transcript_text: transcript, summary_parts: [], step_no: 0, step_total: plan.total };
  }
  if (job.stage === 'summary') {
    const done = Array.isArray(job.summary_parts) ? job.summary_parts : [];
    const plan = summaryPlan(job.transcript_text, done);
    const count = plan.count;
    // 앞 실행이 이 요약 단계 중간에 끊겼으면(Edge 실행 시간) 같은 크기로 다시 하지 않고 반으로 나눠 잇는다.
    if (cutBefore) {
      const split = splitJobSummary(job);
      if (split) return { ...started, status: 'queued', summary_parts: split, step_total: plan.kind === 'one' ? 3 : plan.total };
    }
    // 한 단계에 AI 요청은 한 번(설계 9절). 답이 잘리면(draft_cut) 그 자리에 반 나눔 표시를 남기고 다음 단계들이 반 하나씩 한다.
    if (plan.kind === 'half') {
      const h = halves(plan.piece || '');
      if (!h) throw new Fail('draft_cut');
      const at = Number(plan.at), half = Number(plan.half);
      const no = plan.single ? half + 1 : at + 1;
      const d = normalizeDraft(await serverDraft(job, h[half], { kind: 'part', no, count }));
      const got = [...done[at].halves, d];
      const list = got.length < 2 ? [...done.slice(0, at), { halves: got }]
        : plan.single ? got : [...done.slice(0, at), combineDrafts(got)];
      return { ...started, status: 'queued', summary_parts: list, step_no: plan.single ? got.length : at + (got.length < 2 ? 0 : 1), step_total: plan.total };
    }
    if (plan.kind === 'part') {
      let part;
      try { part = normalizeDraft(await serverDraft(job, plan.pieces[plan.next], { kind: 'part', no: plan.next + 1, count })); }
      catch (e) {
        // 답이 잘림·시간 초과: 같은 크기로 다시 하지 않고 반으로 나눠 잇는다.
        if (!(e instanceof Fail && SPLIT_CODES.includes(e.code) && halves(plan.pieces[plan.next]))) throw e;
        return { ...started, status: 'queued', summary_parts: [...done, halfMark()], step_no: plan.next };
      }
      return { ...started, status: 'queued', summary_parts: [...done, part], step_no: plan.next + 1 };
    }
    let raw;
    if (plan.kind === 'one') {
      try { raw = await serverDraft(job, plan.pieces[0] || '', { kind: '', no: 0, count: 0 }); }
      catch (e) {
        // 한 번에 요약하기엔 답이 길어 잘림: 반 나눔 표시 → 다음 두 단계가 반씩 → 그다음 단계에서 합친다(summaryPlan).
        if (!(e instanceof Fail && SPLIT_CODES.includes(e.code) && halves(plan.pieces[0] || ''))) throw e;
        return { ...started, status: 'queued', summary_parts: [halfMark()], step_no: 0, step_total: 3 };
      }
    } else {
      const drafts = done.filter(Boolean);
      if (!drafts.length) throw new Fail('draft_failed');
      raw = await serverDraft(job, partsText(drafts), { kind: 'merge', no: 0, count });
    }
    return { ...started, status: 'done', stage: 'done', draft: raw, step_no: plan.total, finished_at: new Date().toISOString() };
  }
  throw new Fail('failed');
}

// 녹음 구간 전사(서버 정리). 화면 transcribe와 같은 길이지만, 이미 끝난(done) 구간도 다시 전사한다(옛 화면 정리가 글을 남기지 않았음).
// 구간 행이 '진행 중'이면: 막 시작한 실행이면 busy, 오래됐으면(SEGMENT_DEAD_MS) 끊긴 앞 실행이라 넘겨받는다(REC-정리멈춤반복:
// 전엔 15분(RUNNING_STALE_MS)을 기다려, 서버 정리가 9분 뒤 다시 잡을 때 끊긴 자기 흔적에 막혀 busy로 실패했다).
// REC-긴녹음나눠전사: range = 이번에 할 시간 조각(없으면 통째). 나눌 구간({split})을 돌려주거나 같은 구간의 조각이 더 남았으면(more)
// 구간 행은 '끝'(done)이 아니라 '올림'(uploaded)으로 돌려 둔다('이어서 정리'·붙이기가 끝난 녹음으로 보지 않게). 마지막 조각 뒤에 done.
async function transcribeSegment(key: string, jobId: unknown, range: Range | null = null, more = false, halveFirst = false, thinTried = false): Promise<Piece> {
  if (!isUuid(jobId)) throw new Fail('not_found');
  const { data: job, error } = await admin.from(TABLE).select(JOB_COLUMNS).eq('id', jobId as string).maybeSingle();
  if (error) throw new Fail('failed');
  if (!job || job.trashed_at) throw new Fail('not_found');
  if (job.duration_sec && job.duration_sec > MAX_SECONDS) throw new Fail('too_long');
  const now = new Date();
  const run = segmentRun(job, now.getTime());
  if (run === 'busy') throw new Fail('busy');
  if (run === 'dead') {
    console.warn('meeting-transcribe: segment takeover');
    await setJob(job.id, { status: 'failed', error_code: 'interrupted' });
  }
  const { data: started, error: startError } = await admin.from(TABLE).update({ status: 'running', error_code: null, model: TRANSCRIBE_MODEL, started_at: now.toISOString(), finished_at: null, updated_at: now.toISOString() })
    .eq('id', job.id).in('status', ['uploaded', 'failed', 'done']).select('id');
  if (startError) throw new Fail(startError.code === '23505' ? 'busy' : 'failed');
  if (!started?.length) throw new Fail('busy');
  try {
    const out = await transcribeLoaded(key, job, await loadAudio(job), range, 0, halveFirst, thinTried);
    if ('split' in out || more) await setJob(job.id, { status: 'uploaded', error_code: null, finished_at: null });
    else await setJob(job.id, { status: 'done', error_code: null, model: out.model, finished_at: new Date().toISOString() });
    return out;
  } catch (e) {
    await setJob(job.id, { status: 'failed', error_code: failCode(e), finished_at: new Date().toISOString() }).catch(() => undefined);
    throw e;
  }
}
// 회의자료에 붙은 소리 파일 전사(B). 전사 작업 표에는 넣지 않는다(그 표의 30일 휴지통 정리가 회의자료 원본을 건드리지 않게).
// 사용량 열쇠는 서버 작업 id로 남긴다. 긴 파일은 구간 녹음과 같게 시간 조각으로 나눈다(range).
async function transcribeFile(key: string, job: Job, file: Record<string, unknown>, range: Range | null = null, halveFirst = false, thinTried = false): Promise<Piece> {
  const src = {
    id: job.id, workspace_id: job.workspace_id, drive_file_id: file.id, file_name: file.name, mime_type: file.mime,
    size_bytes: file.size, duration_sec: null,
  };
  return await transcribeLoaded(key, src, await loadAudio(src), range, 0, halveFirst, thinTried);
}

// 서버 요약 한 번(meeting-ai-draft '새 회의' 길과 같은 지시문·한도·사용량 기록). 명진 이름 목록은 읽을 수 있을 때만 넣는다.
async function serverDraft(job: Job, transcript: string, stage: { kind: '' | 'part' | 'merge'; no: number; count: number }) {
  const key = OPENAI();
  if (!key) throw new Fail('draft_failed');
  const { data: set, error: setError } = await admin.from('app_ai_workspace_settings').select('*').eq('workspace_id', job.workspace_id).maybeSingle();
  if (setError || !set) throw new Fail('draft_failed');
  // 하루 한도: ai-assist와 같은 서울 날짜·같은 합계 한도(_shared/ai-daily-usage.mjs). 작업공간 설정 daily_request_limit은 보지 않는다.
  const today = await readTodayAiUsage(admin, { workspaceId: job.workspace_id, userId: job.created_by });
  if (today.over) throw new Fail('daily_limit');
  let names = '';
  try {
    const { data: me } = await admin.from('app_profiles').select('display_name').eq('user_id', job.created_by).maybeSingle();
    names = typeof me?.display_name === 'string' ? me.display_name : '';
  } catch { names = ''; }
  const meeting = { title: '회의', meeting_at: job.created_at, location: null, attendee_count: null };
  const prompt = meetingDraftPrompt({ meeting, names, projectContext: null, materialText: '', transcript: cut(transcript, DRAFT_INPUT_CHARS), stage });
  const body = meetingDraftRequest({ model: set.default_model || DEFAULT_AI_MODEL, maxOutput: set.max_output_tokens, headroom: AI_REASONING_TOKEN_HEADROOM, developer: meetingDraftDeveloper(AI_TONE_RULE), prompt });
  let d;
  try {
    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify(withReasoning(body)), signal: AbortSignal.timeout(300000),
    });
    d = await r.json().catch(() => null);
    if (!r.ok || !d) { console.warn('meeting-transcribe: draft request', stage.kind || 'one', r.status); throw new Fail('draft_failed'); }
  } catch (e) {
    const late = e instanceof DOMException && e.name === 'TimeoutError';
    if (!(e instanceof Fail)) console.warn('meeting-transcribe: draft request', stage.kind || 'one', late ? 'timeout' : 'error');
    // 시간 초과는 따로(draft_timeout): '요약이 오래 걸려 멈췄어요'. 그 밖은 draft_failed.
    throw e instanceof Fail ? e : new Fail(late ? 'draft_timeout' : 'draft_failed');
  }
  const u = d.usage || {};
  if (await addAiRequest(admin, { workspaceId: job.workspace_id, userId: job.created_by, day: today.day, row: today.row, usage: u }) === 'failed') console.warn('meeting-transcribe: draft usage not recorded');
  // 답 상태별 실패 갈래: 답이 길어 잘림(max_output_tokens) = draft_cut(부른 쪽이 조각을 나눔), 그 밖 = draft_failed. 로그는 이유 이름만.
  const result = draftResult(d);
  if (result.code) { console.warn('meeting-transcribe: draft answer', stage.kind || 'one', result.why, transcript.length); throw new Fail(result.code); }
  const text = outputText(d, 256 * 1024);
  if (!text) { console.warn('meeting-transcribe: draft answer', stage.kind || 'one', 'empty', transcript.length); throw new Fail('draft_failed'); }
  // 답을 그대로 읽지 못해 원문을 보존했거나 일부 칸이 어긋난 초안(parse.mjs warnings)은 표시해 둔다. 서버 정리 작업은 사람이 초안 창에서 보고 저장하지만,
  // 잇기 작업은 검수 없이 보고에 저장하므로 이런 초안은 저장하지 않는다(runStep → joinAfterSummary가 draft_failed로 멈춘다).
  try {
    const parsed = parseMeetingDraft(text);
    if (parsed.warnings.length) draftNeedsReview.add(parsed.draft);
    return parsed.draft;
  } catch { throw new Fail('draft_failed'); }
}

// 끝 알림: 폰 앱(살아 있는 기기, FCM 비밀값이 있을 때) '회의 요약이 준비됐어요'. 알림 줄과 같은 기록(app_push_log) 한 줄.
// 싣는 것은 종류·짧은 제목·누르면 열 앱 안 경로뿐(전사 글·제목 없음).
// 잇기 작업(kind 'join')도 같은 길·같은 알림 종류(meeting_done)로 '보고에 이어 붙였어요'(설계 rec-join.md 3-1절: 종류를 새로 만들지 않는다).
async function notifyDone(job: Job, kind: StepKind = 'job') {
  const cfg = readFcmConfig(Deno.env.get(FCM_SECRET_NAME));
  if (!cfg) return;
  const { data: devices } = await admin.from('app_push_devices').select('id,fcm_token').eq('workspace_id', job.workspace_id).is('revoked_at', null).limit(10);
  if (!devices?.length) return;
  const at = new Date(), day = seoulDay(at), ref = `d${day}`;
  // 내 프로필 '폰 알림' 설정(회의 요약 끔·조용한 시간)을 따른다. 읽지 못하면 기본값(켬, 22:00~07:00 조용).
  let prefs: unknown = null;
  try { const { data: me } = await admin.from('app_profiles').select('notify_prefs').eq('user_id', job.created_by).maybeSingle(); prefs = me?.notify_prefs ?? null; } catch { prefs = null; }
  const decision = pushDecision(prefs, at.getTime());
  if (decision !== 'send') {
    await admin.from('app_push_log').upsert({ workspace_id: job.workspace_id, kind: 'meeting_done', ref_key: ref, day, status: decision },
      { onConflict: 'workspace_id,kind,ref_key,day', ignoreDuplicates: true });
    return;
  }
  const open = `/work/app/?view=reports&${kind === 'join' ? 'join_job' : 'rec_job'}=${job.id}&notice=meeting_done.${ref}`;
  const sender = makeFcmSender(cfg, fetch, Date.now);
  let sent = 0;
  for (const d of devices) {
    if (typeof d.fcm_token !== 'string') continue;
    const r = await sender.send(d.fcm_token, { kind: 'meeting_done', title: kind === 'join' ? '보고에 이어 붙였어요' : '회의 요약이 준비됐어요', open, urgent: true });
    if (r === 'sent') sent++;
    else if (r === 'unregistered') await admin.from('app_push_devices').update({ revoked_at: at.toISOString() }).eq('id', d.id);
  }
  await admin.from('app_push_log').upsert({ workspace_id: job.workspace_id, kind: 'meeting_done', ref_key: ref, day, status: sent ? 'sent' : 'failed' },
    { onConflict: 'workspace_id,kind,ref_key,day' });
}

// ---- 사용자 입구 ----
async function jobStart(user: { id: string }, userDb: ReturnType<typeof userClient>, body: Record<string, unknown>) {
  const start = parseStart(body);
  if (!start) throw new Fail('bad_request');
  await requireOwner(user.id, start.workspaceId);
  if (!GEMINI()) throw new Fail('not_ready');
  if (overLimit(await monthUsed(userDb, start.workspaceId))) throw new Fail('monthly_limit');
  let row: Record<string, unknown>;
  if (start.kind === 'recording') {
    const rows = await ownSession(user.id, start.sessionId);
    if (rows[0].workspace_id !== start.workspaceId) throw new Fail('not_found');
    const { data: open, error } = await admin.from(SERVER_JOB_TABLE).select(SERVER_JOB_COLUMNS).eq('session_id', start.sessionId).in('status', [...ACTIVE]).limit(1);
    if (error) throw jobsFail(error);
    if (open?.length) return await jobAnswer(open[0] as Job);
    row = { workspace_id: start.workspaceId, created_by: user.id, kind: 'recording', session_id: start.sessionId, status: 'queued', stage: 'combine' };
  } else {
    // 회의자료 행은 부른 사람 로그인(owner RLS)으로 읽는다. 같은 작업공간·회의에 붙은 자료만.
    const { data: doc, error } = await userDb.from('app_documents').select('id,workspace_id,meeting_id,file_id,file_name,title,mime_type,file_size')
      .eq('id', start.documentId).maybeSingle();
    if (error) throw new Fail('failed');
    if (!doc || doc.workspace_id !== start.workspaceId || !doc.meeting_id) throw new Fail('not_found');
    const checked = audioDocument(doc, MAX_BYTES);
    if (!checked.ok) throw new Fail(checked.code as string);
    const audio = { fileId: checked.fileId as string, name: checked.name as string };
    const token = await driveToken(start.workspaceId);
    const r = await fetch(`${DRIVE}/${encodeURIComponent(audio.fileId)}?fields=id,name,mimeType,size,md5Checksum,trashed`, { headers: { Authorization: `Bearer ${token}` } });
    const meta = await r.json().catch(() => null);
    if (!r.ok || meta?.id !== audio.fileId || meta?.trashed) throw new Fail(r.status === 404 ? 'not_found' : 'drive_failed');
    const size = Number(meta.size);
    if (!Number.isSafeInteger(size) || size <= 0) throw new Fail('drive_failed');
    if (size > MAX_BYTES) throw new Fail('too_large');
    // 형식은 이름(확장자)을 먼저 본다(Drive가 m4a를 audio/x-m4a 등으로 줄 수 있음). 모르면 Drive·자료 행의 형식.
    const mime = audioMime(audio.name, '') || audioMime(audio.name, meta.mimeType) || audioMime(audio.name, doc.mime_type);
    if (!mime) throw new Fail('bad_type');
    const md5 = /^[0-9a-f]{32}$/.test(String(meta.md5Checksum || '')) ? meta.md5Checksum : null;
    const base = { workspace_id: start.workspaceId, created_by: user.id, kind: 'attached', document_id: doc.id, meeting_id: doc.meeting_id, source_file_id: audio.fileId, source_md5: md5 };
    // 같은 파일(같은 내용)을 전에 정리했으면 그 결과를 다시 쓴다(전사·요약 비용 없음).
    if (md5) {
      const { data: prev, error: prevError } = await admin.from(SERVER_JOB_TABLE).select('transcript_text,draft,parts').eq('workspace_id', start.workspaceId)
        .eq('kind', 'attached').eq('source_file_id', audio.fileId).eq('source_md5', md5).eq('status', 'done').order('finished_at', { ascending: false }).limit(1);
      if (prevError) throw jobsFail(prevError);
      // S60-17: 글이 적은 조각이 있던 결과는 다시 쓰지 않는다(그 파일을 다시 전사해야 [다시]가 같은 짧은 글을 돌려주지 않음).
      if (prev?.length && prev[0].transcript_text && !hasThinPart(prev[0].parts)) {
        const { data: copy, error: copyError } = await admin.from(SERVER_JOB_TABLE).insert({
          ...base, status: 'done', stage: 'done', parts: prev[0].parts, transcript_text: prev[0].transcript_text, draft: prev[0].draft,
          step_no: 1, step_total: 1, finished_at: new Date().toISOString(),
        }).select(SERVER_JOB_COLUMNS).single();
        if (copyError || !copy) throw jobsFail(copyError);
        return json({ ok: true, reused: true, job: jobView(copy, true) });
      }
    }
    const { data: open, error: openError } = await admin.from(SERVER_JOB_TABLE).select(SERVER_JOB_COLUMNS).eq('workspace_id', start.workspaceId)
      .eq('kind', 'attached').eq('source_file_id', audio.fileId).in('status', [...ACTIVE]).limit(1);
    if (openError) throw jobsFail(openError);
    if (open?.length) return await jobAnswer(open[0] as Job);
    row = { ...base, status: 'queued', stage: 'transcribe', step_total: 1, parts: [{ no: 1, seconds: 0, file: { id: audio.fileId, name: audio.name, mime, size }, text: null }] };
  }
  const { data, error } = await admin.from(SERVER_JOB_TABLE).insert(row).select(SERVER_JOB_COLUMNS).single();
  if (error?.code === '23505') throw new Fail('busy');
  if (error || !data) throw jobsFail(error);
  inBackground(runStep(data.id));
  return json({ ok: true, job: jobView(data) });
}
// 진행 중이면 모양만, 끝났으면 결과까지. S61-5 REC-전사삭제: 멈춘 작업을 다시 깨우지 않는다(지난 결과 읽기만).
function jobAnswer(job: Job) {
  return json({ ok: true, job: jobView(job, true) });
}
async function jobRead(user: { id: string }, body: Record<string, unknown>) {
  return await jobAnswer(await ownServerJob(user.id, body.job_id));
}
// 지난 이틀 동안의 내 작업 중 진행 중·끝나고 아직 열지 않은 것·실패(화면이 띠를 다시 그림). 결과 글은 싣지 않는다.
async function jobList(user: { id: string }, body: Record<string, unknown>) {
  const workspaceId = String(body.workspace_id || '');
  await requireOwner(user.id, workspaceId);
  const since = new Date(Date.now() - LIST_HOURS * 3600000).toISOString();
  let { data, error } = await admin.from(SERVER_JOB_TABLE).select(SERVER_JOB_COLUMNS).eq('workspace_id', workspaceId).eq('created_by', user.id)
    .gte('created_at', since).is('opened_at', null).or('error_code.is.null,error_code.neq.discarded')
    .order('created_at', { ascending: false }).limit(20);
  if (error) throw jobsFail(error);
  // REC-초안버리기: 쓰지 않기로 한 결과는 다시 띄우지 않는다(이 기기·다른 기기 모두). 위 조건과 같은 규칙을 한 번 더.
  // REC-멈춤띠계속뜸: 닫은 멈춤은 discarded:true로 싣는다 — 띠에는 안 뜨고 녹음 줄 [다시]로만 보인다.
  data = (data || []).filter((j) => !isDiscarded(j) || j.status === 'failed');
  // 지금 보고에 잇는 중인 녹음 결과는 뺀다(다른 기기에서 [초안 열기] → 새 보고 저장으로 같은 녹음이 두 보고에 들어가지 않게). 잇기가 실패하면 다시 보인다.
  const joining = await joiningJobs(workspaceId, (data || []).filter((j) => j.status === 'done').map((j) => j.id as string));
  return json({ ok: true, jobs: (data || []).filter((j) => !joining.has(j.id)).map((j) => jobView(j)) });
}
// 잇는 중인 녹음 결과 id. 잇기 작업 표가 아직 없거나 읽지 못하면 빈 목록(지금 동작 그대로).
async function joiningJobs(workspaceId: string, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const { data, error } = await admin.from(JOIN_JOB_TABLE).select('source_job_id,status').eq('workspace_id', workspaceId).in('status', [...ACTIVE]).in('source_job_id', ids);
  if (error) return new Set();
  return joiningSources(data);
}
// 초안을 열었음(다시 띠에 뜨지 않게). 회의에 저장했으면 그 회의 id도.
async function jobOpened(user: { id: string }, userDb: ReturnType<typeof userClient>, body: Record<string, unknown>) {
  const job = await ownServerJob(user.id, body.job_id);
  const patch: Record<string, unknown> = { opened_at: job.opened_at ?? new Date().toISOString() };
  if (body.meeting_id !== undefined && body.meeting_id !== null) {
    if (!isUuid(body.meeting_id)) throw new Fail('bad_request');
    const { data: meeting, error } = await userDb.from('app_meetings').select('id,workspace_id').eq('id', body.meeting_id as string).maybeSingle();
    if (error) throw new Fail('failed');
    if (!meeting || meeting.workspace_id !== job.workspace_id) throw new Fail('not_found');
    patch.meeting_id = meeting.id;
  }
  await patchServerJob(job.id, patch);
  return json({ ok: true });
}
// REC-초안버리기(S60-20)·REC-멈춤띠계속뜸(S60-26): 끝난 결과를 쓰지 않기로(띠 [삭제])·멈춘 작업 띠를 닫기(띠 [닫기], 'discarded_'+이유). 끝난 작업에 '버림' 표시만 남기고(error_code, server-job.mjs DISCARDED)
// 녹음 소리(Drive)·전사 글·초안은 그대로 둔다 → job_list에서 빠져 다시 열어도·다른 기기에서도 띠에 뜨지 않는다. '열었음'(opened_at)은 건드리지 않는다.
// 소유 확인은 다른 job_* 입구와 같은 ownServerJob(작업공간 owner + 만든 사람). 고칠 때도 그 상태 그대로인 행만(동시에 바뀐 행은 건드리지 않음).
async function jobDiscard(user: { id: string }, body: Record<string, unknown>) {
  const job = await ownServerJob(user.id, body.job_id);
  const plan = jobDiscardPatch(job);
  if (plan.error) throw new Fail(plan.error);
  if (plan.patch) {
    let q = admin.from(SERVER_JOB_TABLE).update({ ...plan.patch, updated_at: new Date().toISOString() }).eq('id', job.id).eq('status', job.status);
    q = job.error_code ? q.eq('error_code', job.error_code) : q.is('error_code', null);
    const { data, error } = await q.select('id');
    if (error) throw jobsFail(error);
    if (!data?.length) throw new Fail('busy');
  }
  return json({ ok: true });
}
// 버린 결과·닫은 멈춤 되돌리기(작은 알림 [되돌리기]): 표시만 뺀다 → 띠 [초안 열기]·멈춤 띠에 다시 뜬다.
async function jobRestore(user: { id: string }, body: Record<string, unknown>) {
  const job = await ownServerJob(user.id, body.job_id);
  const patch = jobRestorePatch(job);
  if (patch) {
    const { error } = await admin.from(SERVER_JOB_TABLE).update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', job.id).eq('status', job.status).eq('error_code', job.error_code);
    if (error) throw jobsFail(error);
  }
  return json({ ok: true });
}
// 실패한 작업 다시: 끝난 단계(합친 구간·전사한 글·조각 요약)는 그대로 두고 멈춘 단계부터.
async function jobRetry(user: { id: string }, userDb: ReturnType<typeof userClient>, body: Record<string, unknown>) {
  const job = await ownServerJob(user.id, body.job_id);
  if (job.status !== 'failed') return await jobAnswer(job);
  if (!GEMINI()) throw new Fail('not_ready');
  if (overLimit(await monthUsed(userDb, job.workspace_id))) throw new Fail('monthly_limit');
  // 닫은 멈춤(녹음 줄 [다시])은 닫음 표시를 이어 간다 — 같은 이유로 또 멈추면 띠를 또 띄우지 않는다(runStep failedCode).
  const patch: Record<string, unknown> = { status: 'queued', error_code: carryClosed(job.error_code), finished_at: null, lease_until: null, attempts: 0, updated_at: new Date().toISOString() };
  // 요약이 시간 안에 끝나지 못해 멈췄으면 다시 할 때는 반으로 나눠 잇는다(같은 크기로 또 걸리지 않게).
  if (job.stage === 'summary' && SPLIT_CODES.includes(failReason(job))) {
    const split = splitJobSummary(job);
    if (split) patch.summary_parts = split;
  }
  const { data, error } = await admin.from(SERVER_JOB_TABLE).update(patch)
    .eq('id', job.id).eq('status', 'failed').select(SERVER_JOB_COLUMNS);
  if (error?.code === '23505') throw new Fail('busy');
  if (error) throw jobsFail(error);
  const row = (data?.[0] as Job) ?? job;
  inBackground(runStep(row.id));
  return json({ ok: true, job: jobView(row) });
}
// 서버 안 입구: 다음 단계. 열쇠가 맞을 때만 받고, 바로 202를 준 뒤 뒤에서 돌린다.
async function jobTick(req: Request) {
  const raw = await req.text();
  if (raw.length > 512) return json({ ok: false }, 401);
  let body: Record<string, unknown> | null = null;
  try { body = JSON.parse(raw); } catch { body = null; }
  if (!body || !(await tickCheck(SERVICE, body, req.headers.get(TICK_HEADER), Date.now()))) return json({ ok: false }, 401);
  inBackground(runStep(body.job_id as string));
  return json({ ok: true }, 202);
}

// ---- REC-한회의로잇기 PR-2: 잇기 작업 입구(규칙·순서는 join-job.mjs, 여기는 DB 읽기·쓰기만) ----
type UserDb = ReturnType<typeof userClient>;
// requireOwner와 같은 기준. owner가 아니면 false(잇기 입구는 없는 것·남의 것을 구분하지 않고 not_found로 답한다).
async function isOwner(userId: string, workspaceId: string) {
  try { await requireOwner(userId, workspaceId); return true; } catch (e) { if (e instanceof AuthError) return false; throw e; }
}
function joinIo(userDb: UserDb) {
  const kick = (id: string) => inBackground(runStep(id, 'join'));
  return {
    now: () => Date.now(),
    kick,
    isOwner,
    // 로그인한 사람이 owner인 작업공간(join_list는 작업공간을 몸통으로 받지 않는다). 하나도 없으면 다른 action처럼 403.
    ownerWorkspaces: async (userId: string): Promise<string[]> => {
      const { data, error } = await admin.from('app_workspace_members').select('workspace_id').eq('user_id', userId).eq('role', 'owner').limit(20);
      if (error) throw new Fail('failed');
      const ids = (data || []).map((r) => r.workspace_id as string).filter(isUuid);
      if (!ids.length) throw new AuthError(403);
      return ids;
    },
    // ---- 부른 사람 로그인(owner RLS · 휴지통 숨김)으로 읽는 것: 보고, 녹음 자료 행, 잇기 작업 행 ----
    userMeeting: async (id: string): Promise<Job | null> => {
      const { data, error } = await userDb.from('app_meetings').select(JOIN_MEETING_COLUMNS).eq('id', id).maybeSingle();
      if (error) throw new Fail('failed');
      return (data as Job | null) ?? null;
    },
    userMeetingsOfDay: async (workspaceId: string, from: string, to: string): Promise<Job[]> => {
      const { data, error } = await userDb.from('app_meetings').select(JOIN_DAY_COLUMNS).eq('workspace_id', workspaceId)
        .gte('meeting_at', from).lt('meeting_at', to).order('meeting_at', { ascending: true }).limit(100);
      if (error) throw new Fail('failed');
      return (data || []) as Job[];
    },
    userRecordingDocs: async (workspaceId: string, meetingIds: string[]): Promise<Job[]> => {
      const { data, error } = await userDb.from('app_documents').select('meeting_id').eq('workspace_id', workspaceId)
        .in('meeting_id', meetingIds).contains('tags', ['회의녹음']).limit(500);
      if (error) throw new Fail('failed');
      return (data || []) as Job[];
    },
    userJoinJob: async (id: string, columns: string): Promise<Job | null> => {
      const { data, error } = await userDb.from(JOIN_JOB_TABLE).select(columns).eq('id', id).maybeSingle();
      if (error) throw jobsFail(error);
      return (data as Job | null) ?? null;
    },
    userJoinList: async (workspaces: string[], userId: string, since: string): Promise<Job[]> => {
      const { data, error } = await userDb.from(JOIN_JOB_TABLE).select(JOIN_VIEW_COLUMNS).in('workspace_id', workspaces).eq('created_by', userId)
        .gte('created_at', since).is('seen_at', null).order('created_at', { ascending: false }).limit(20);
      if (error) throw jobsFail(error);
      return (data || []) as Job[];
    },
    // ---- 서비스 권한(owner 확인 뒤에만 부른다 — join-job.mjs의 순서). 작업공간·id로 거른다. ----
    // 서버 정리 작업: 지금 있는 ownServerJob(작업공간 owner + 만든 사람) 그대로. 없는 것·남의 것은 null.
    ownServerJob: async (userId: string, id: string): Promise<Job | null> => {
      try { return await ownServerJob(userId, id); } catch (e) {
        if (e instanceof AuthError || (e instanceof Fail && e.code === 'not_found')) return null;
        throw e;
      }
    },
    recordJobs: async (workspaceId: string, ids: string[]): Promise<Job[]> => {
      const { data, error } = await admin.from(TABLE).select(JOB_COLUMNS).eq('workspace_id', workspaceId).in('id', ids);
      if (error) throw new Fail('failed');
      return (data || []) as Job[];
    },
    linkedRecordJobs: async (workspaceId: string, meetingIds: string[]): Promise<Job[]> => {
      const { data, error } = await admin.from(TABLE).select('meeting_id,duration_sec,trashed_at').eq('workspace_id', workspaceId).in('meeting_id', meetingIds).limit(500);
      if (error) throw new Fail('failed');
      return (data || []) as Job[];
    },
    linkedServerJobs: async (workspaceId: string, meetingIds: string[]): Promise<Job[]> => {
      const { data, error } = await admin.from(SERVER_JOB_TABLE).select('id,meeting_id,status,parts').eq('workspace_id', workspaceId).in('meeting_id', meetingIds).limit(200);
      if (error) throw jobsFail(error);
      return (data || []) as Job[];
    },
    // 그 보고에 연결된 서버 정리 작업의 전문(회의록 전문 칸이 빈 보고의 앞 글), 시간순.
    linkedTranscripts: async (workspaceId: string, meetingId: string): Promise<Job[]> => {
      const { data, error } = await admin.from(SERVER_JOB_TABLE).select('id,transcript_text,created_at').eq('workspace_id', workspaceId).eq('meeting_id', meetingId)
        .eq('status', 'done').order('created_at', { ascending: true }).limit(10);
      if (error) throw jobsFail(error);
      return (data || []) as Job[];
    },
    joinReady: async () => {
      const { error } = await admin.from(JOIN_JOB_TABLE).select('id').limit(1);
      if (error) throw jobsFail(error);
    },
    activeJoins: async (workspaceId: string): Promise<Job[]> => {
      const { data, error } = await admin.from(JOIN_JOB_TABLE).select(JOIN_VIEW_COLUMNS).eq('workspace_id', workspaceId).in('status', [...ACTIVE]).limit(50);
      if (error) throw jobsFail(error);
      return (data || []) as Job[];
    },
    joinSourceText: async (workspaceId: string, id: string): Promise<string | null> => {
      const { data, error } = await admin.from(JOIN_JOB_TABLE).select('source_text').eq('workspace_id', workspaceId).eq('id', id).maybeSingle();
      if (error) throw jobsFail(error);
      return typeof data?.source_text === 'string' ? data.source_text : null;
    },
    sourceJoined: async (workspaceId: string, sourceJobId: string): Promise<boolean> => {
      const { data, error } = await admin.from(JOIN_JOB_TABLE).select('id').eq('workspace_id', workspaceId).eq('source_job_id', sourceJobId).eq('status', 'done').limit(1);
      if (error) throw jobsFail(error);
      return !!data?.length;
    },
    // 넣는 행은 join-job.mjs joinRow가 만든다(넣기 권한이 있는 칸만, 작업공간 = 부른 사람 로그인으로 읽은 보고 행의 값).
    insertJoin: async (row: Record<string, unknown>): Promise<{ job?: Job; conflict?: boolean }> => {
      const { data, error } = await admin.from(JOIN_JOB_TABLE).insert(row).select(JOIN_VIEW_COLUMNS).single();
      if (error?.code === '23505') return { conflict: true };
      if (error || !data) throw jobsFail(error);
      return { job: data as Job };
    },
    patchJoin: async (id: string, patch: Record<string, unknown>, guard: Record<string, string> = {}): Promise<Job[]> => {
      let q = admin.from(JOIN_JOB_TABLE).update(joinPatch(patch, new Date().toISOString())).eq('id', id);
      for (const [k, v] of Object.entries(guard)) q = q.eq(k, v);
      const { data, error } = await q.select(JOIN_VIEW_COLUMNS);
      if (error?.code === '23505') throw new Fail('busy');
      if (error) throw jobsFail(error);
      return (data || []) as Job[];
    },
    // 되돌리기: 서버 전용 DB 함수(id·scope만 넘긴다). 함수가 owner·보고·조건을 SQL로 다시 확인하고, 어긋나면 고정 글자 예외 → 실패 코드.
    undo: async (id: string, scope: string): Promise<Record<string, unknown> | null> => {
      const { data, error } = await admin.rpc('app_meeting_join_undo', { p_job: id, p_scope: scope });
      if (error) { console.warn('meeting-transcribe: join undo', error.code || '-'); throw new Fail(joinRpcCode(error)); }
      return data && typeof data === 'object' ? data as Record<string, unknown> : null;
    },
  };
}
// 잇기·합치기 시작. 몸통의 작업공간 값은 읽지 않는다(parseJoinStart가 고른 보고·재료 id만 꺼낸다).
async function joinStart(user: { id: string }, userDb: UserDb, body: Record<string, unknown>) {
  const want = parseJoinStart(body);
  if (!want) throw new Fail('bad_request');
  const out = await startJoin(joinIo(userDb), user.id, want);
  return json({ ok: true, job: joinView(out.job), ...(out.existing ? { existing: true } : {}) });
}
// 입력 창이 가진 전사 글을 그 보고에 잇기. 몸통 = 글 그대로(JSON 몸통 한도 앞에서 따로 가른다).
async function joinText(req: Request, user: { id: string }, userDb: UserDb) {
  // 머리글 모양이 틀리면 bad_request, 글이 한도를 넘으면 text_too_long(parseJoinText·boundedText가 던진다).
  const head = parseJoinText({ target: req.headers.get('x-target-meeting-id'), records: req.headers.get('x-record-jobs'), length: req.headers.get('content-length') });
  if (!head) throw new Fail('bad_request');
  const text = await boundedText(req.body);
  const out = await startJoin(joinIo(userDb), user.id, { ...head, text });
  return json({ ok: true, job: joinView(out.job), ...(out.existing ? { existing: true } : {}) });
}
async function joinRead(user: { id: string }, userDb: UserDb, body: Record<string, unknown>) {
  return json({ ok: true, job: joinView((await readJoin(joinIo(userDb), user.id, body)).job) });
}
async function joinList(user: { id: string }, userDb: UserDb) {
  return json({ ok: true, jobs: (await listJoins(joinIo(userDb), user.id)).jobs.map((j: Job) => joinView(j)) });
}
async function joinRetry(user: { id: string }, userDb: UserDb, body: Record<string, unknown>) {
  const out = await retryJoin(joinIo(userDb), user.id, body);
  return json({ ok: true, job: joinView(out.job), ...(out.restarted ? { restarted: true } : {}) });
}
async function joinSeen(user: { id: string }, userDb: UserDb, body: Record<string, unknown>) {
  await seenJoin(joinIo(userDb), user.id, body);
  return json({ ok: true });
}
async function joinUndo(user: { id: string }, userDb: UserDb, body: Record<string, unknown>) {
  return json({ ok: true, ...(await undoJoin(joinIo(userDb), user.id, body)) });
}
async function joinCandidateList(user: { id: string }, userDb: UserDb, body: Record<string, unknown>) {
  return json({ ok: true, ...(await joinCandidates(joinIo(userDb), user.id, body)) });
}
// 서버 안 입구: 잇기 작업의 다음 단계. job_tick과 같은 모양이지만 서명 머리글자가 달라 서로 통하지 않는다.
async function joinTick(req: Request) {
  const raw = await req.text();
  if (raw.length > 512) return json({ ok: false }, 401);
  let body: Record<string, unknown> | null = null;
  try { body = JSON.parse(raw); } catch { body = null; }
  if (!body || !(await tickCheck(SERVICE, body, req.headers.get(TICK_HEADER), Date.now(), 'join'))) return json({ ok: false }, 401);
  inBackground(runStep(body.job_id as string, 'join'));
  return json({ ok: true }, 202);
}

Deno.serve(withWebCors(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);
  try {
    const action = new URL(req.url).searchParams.get('action') || '';
    // 서버 안 입구(다음 단계)는 사용자 로그인이 아니라 서버 키 HMAC으로만 받는다(맨 앞에서 가름).
    if (action === 'job_tick') return await jobTick(req);
    if (action === JOIN_TICK_ACTION) return await joinTick(req);
    const user = await userOf(req);
    const userDb = userClient(req);
    // S61-5 REC-전사삭제: 전사·요약을 새로 시작하는 입구(파일 올려 전사·화면 전사·서버 정리 시작·다시)는 모두 닫는다. 몸통은 읽지 않는다.
    if (TRANSCRIBE_OFF_ACTIONS.has(action)) { await req.body?.cancel().catch(() => undefined); throw new Fail('transcribe_off'); }
    if (action === 'rec_piece') return await recPiece(req, user);
    if (action === 'join_text') return await joinText(req, user, userDb);
    const raw = await req.text();
    if (raw.length > 4096) throw new Fail('bad_request');
    let body: Record<string, unknown> = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { throw new Fail('bad_request'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Fail('bad_request');
    if (action === 'config') return await config(user, userDb, body);
    if (action === 'attach') return await attach(user, userDb, body);
    if (action === 'rec_start') return await recStart(user, body);
    if (action === 'rec_finish') return await recFinish(user, body);
    if (action === 'rec_save') return await recSave(user, userDb, body);
    if (action === 'rec_pending') return await recPending(user, userDb, body);
    if (action === 'rec_discard') return await recDiscard(user, body);
    if (action === 'rec_restore') return await recRestore(user, body);
    if (action === 'job_read') return await jobRead(user, body);
    if (action === 'job_list') return await jobList(user, body);
    if (action === 'job_opened') return await jobOpened(user, userDb, body);
    if (action === 'job_discard') return await jobDiscard(user, body);
    if (action === 'job_restore') return await jobRestore(user, body);
    if (action === 'join_start') return await joinStart(user, userDb, body);
    if (action === 'join_candidates') return await joinCandidateList(user, userDb, body);
    if (action === 'join_read') return await joinRead(user, userDb, body);
    if (action === 'join_list') return await joinList(user, userDb);
    if (action === 'join_retry') return await joinRetry(user, userDb, body);
    if (action === 'join_seen') return await joinSeen(user, userDb, body);
    if (action === 'join_undo') return await joinUndo(user, userDb, body);
    throw new Fail('bad_request');
  } catch (e) {
    if (e instanceof AuthError) return json({ ok: false, code: e.message, error: e.status === 401 ? '로그인이 필요합니다.' : '접근 권한이 없습니다.' }, e.status);
    if (e instanceof Fail) return fail(e.code);
    if (e instanceof RecFail) return json(recFailBody(e.code, e.extra), (REC_STATUS as Record<string, number>)[e.code] ?? 409);
    console.error('meeting-transcribe: failed', safeErrorLog(e));
    return fail('failed');
  }
}));
