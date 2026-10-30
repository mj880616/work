// MTG-녹음초안 2단계: 회의 녹음 파일 → 전사 글(Gemini). 사업 보고 › [회의] 입력 창의 [녹음·전사 넣기]만 부른다.
// verify_jwt=true(첫 배포 first_deploy=true). 코드에서도 Auth 서버로 로그인을 다시 확인하고 작업공간 소유자(owner)만 받는다.
//
// action(모두 POST, 쿼리 ?action=):
//   config     {workspace_id}            → 준비 여부(열쇠 있음)·이번 달 금액·상한. 끊긴 작업·30일 지난 녹음 정리도 여기서 한다.
//   upload     몸통 = 녹음 파일 그대로     → 명진 Drive '웹2/회의자료/회의 녹음' 폴더에 올리고 작업 한 행(uploaded). 머리글
//              x-workspace-id, x-file-name(encodeURIComponent), x-duration-sec(화면이 잰 길이, 없을 수 있음), Content-Length 필수.
//   transcribe {job_id}                  → Drive에서 읽어 Gemini Files에 올리고 전사(통화 전사와 같은 설정) → 글을 이 응답으로만 돌려준다.
//              작업 행은 진행 중 → 끝/실패. 전사 글은 어디에도 저장하지 않는다(화면이 회의 기록 초안 흐름으로 넣는다).
//              사용량은 기존 app_ai_external_usage에 ref 'mtg-…'로 넣는다(홈 AI 사용량 줄·월 상한이 같은 기록을 셈).
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
// 열쇠(비밀값 GEMINI_API_KEY)가 없으면 config는 ready=false, 나머지는 503 not_ready('준비 중').
// 실패하면 작업만 failed로 두고, Gemini에 올린 임시 파일은 지운다. 녹음 원본·회의 기록은 그대로다.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { moveDriveFileToTrash } from '../_shared/drive-trash.ts';
import {
  Fail, GEMINI_KEY_NAME, MAX_BYTES, MAX_SECONDS, MONTHLY_LIMIT_KRW, STATUS, SWEEP_LIMIT, TRANSCRIBE_MODEL, USAGE_REF_PREFIX,
  attachDocument, canStart, failBody, isStale, isUuid, monthKrw, monthStart, overLimit, parseUpload, readTranscript, readUsage,
  seoulDay, transcriptionRequest, trashBefore, usageRef, wantsDiarize,
} from './model.mjs';
import {
  PIECE_FOLDER, REC_FINISH_BUDGET_MS, REC_MAX_SEGMENTS, REC_PIECE_SECONDS, REC_SEGMENT_SECONDS, REC_STATUS, RecFail,
  appendPatch, closePatch, discardPatch, discardPlan, nextSegment, ownRows, parsePiece, pendingSessions, pendingSince, pieceDecision,
  pieceFileName, recFailBody, recMime, restorePlan, segmentFileName, toCombine,
} from './recording.mjs';

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

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-workspace-id, x-file-name, x-duration-sec, x-recording-id, x-piece-seq',
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

// ---- Drive(이미 있는 Web2 Drive 연결: public_policy_drive_config의 갱신 열쇠, meeting-files와 같음) ----
async function driveToken() {
  const { data: c, error } = await admin.from('public_policy_drive_config').select('google_client_id,google_client_secret,google_refresh_token').eq('id', 1).single();
  if (error || !c?.google_refresh_token) throw new Fail('drive_failed');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: c.google_client_id, client_secret: c.google_client_secret, refresh_token: c.google_refresh_token, grant_type: 'refresh_token' }),
  });
  const d = await r.json().catch(() => null);
  if (!r.ok || !d?.access_token) throw new Fail('drive_failed');
  return d.access_token as string;
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
async function geminiUpload(key: string, job: Job, media: Response) {
  const start = await fetch(`${GEM}/upload/v1beta/files`, {
    method: 'POST',
    headers: {
      'x-goog-api-key': key, 'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(job.size_bytes), 'X-Goog-Upload-Header-Content-Type': job.mime_type, 'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: `meeting-${job.id}` } }),
  });
  const url = start.headers.get('x-goog-upload-url');
  if (!start.ok || !url) throw new Fail('gemini_failed');
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Length': String(job.size_bytes), 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' },
    body: media.body, duplex: 'half',
  } as RequestInit);
  const d = await r.json().catch(() => null);
  const file = d?.file;
  if (!r.ok || typeof file?.name !== 'string' || typeof file?.uri !== 'string') throw new Fail('gemini_failed');
  return file as { name: string; uri: string; state?: string; mimeType?: string };
}
async function geminiActive(key: string, name: string, state?: string) {
  let s = state;
  for (let i = 0; s !== 'ACTIVE' && i < 30; i++) {
    if (s === 'FAILED') throw new Fail('gemini_failed');
    await new Promise(res => setTimeout(res, 2000));
    const r = await fetch(`${GEM}/v1beta/${name}`, { headers: { 'x-goog-api-key': key } });
    const d = await r.json().catch(() => null);
    if (!r.ok) throw new Fail('gemini_failed');
    s = d?.state;
  }
  if (s !== 'ACTIVE') throw new Fail('gemini_failed');
}
async function geminiDelete(key: string, name: string) {
  try { await fetch(`${GEM}/v1beta/${name}`, { method: 'DELETE', headers: { 'x-goog-api-key': key } }); } catch { /* 48시간 뒤 Gemini가 지움 */ }
}
async function geminiTranscribe(key: string, uri: string, mime: string, diarize: boolean) {
  const send = (d: boolean) => fetch(`${GEM}/v1beta/interactions`, {
    method: 'POST', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(transcriptionRequest(uri, mime, d)), signal: AbortSignal.timeout(380000),
  });
  let r = await send(diarize);
  // 통화 전사와 같은 규칙: 화자 구분을 거절(400)하면 화자 구분 없이 한 번 더.
  if (diarize && r.status === 400) { await r.body?.cancel(); r = await send(false); }
  const d = await r.json().catch(() => null);
  if (!r.ok || !d) throw new Fail('gemini_failed');
  return d;
}

// ---- 이번 달 금액(기존 사용량 기록, 호출한 사람 토큰 + 소유자 RLS로 읽음) ----
async function monthUsed(userDb: ReturnType<typeof userClient>, workspaceId: string) {
  const { data, error } = await userDb.from('app_ai_external_usage').select('ref,model,input_tokens,audio_tokens,output_tokens')
    .eq('workspace_id', workspaceId).like('ref', `${USAGE_REF_PREFIX}%`).gte('day', monthStart(new Date())).limit(1000);
  if (error || !Array.isArray(data) || data.length >= 1000) throw new Fail('usage_unavailable');
  return monthKrw(data);
}

// ---- 서버 쪽 정리(부를 때마다, 이 작업공간만): 끊긴 진행 중 → 실패, 30일 지난 붙이지 않은 녹음 → Drive 휴지통 ----
async function sweep(workspaceId: string) {
  const now = new Date();
  try {
    const { data: running } = await admin.from(TABLE).select('id,status,started_at,updated_at,created_at').eq('workspace_id', workspaceId).eq('status', 'running').limit(5);
    for (const job of running || []) if (isStale(job, now)) await setJob(job.id, { status: 'failed', error_code: 'interrupted', finished_at: now.toISOString() });
    const { data: old } = await admin.from(TABLE).select('id,drive_file_id').eq('workspace_id', workspaceId).is('meeting_id', null).is('trashed_at', null)
      .lt('created_at', trashBefore(now)).neq('status', 'running').order('created_at', { ascending: true }).limit(SWEEP_LIMIT);
    if (!old?.length) return;
    const token = await driveToken();
    const folder = await recordingFolder(workspaceId, token, false);
    if (!folder) return;
    for (const job of old) {
      const result = await moveDriveFileToTrash(fetch, job.drive_file_id, folder, token);
      // 휴지통으로 옮겼거나 이미 없거나 이 폴더 것이 아니면 다시 보지 않는다. 잠시 실패면 다음에.
      if (result === 'trashed' || result === 'already_trashed' || result === 'not_ours') await setJob(job.id, { trashed_at: new Date().toISOString() });
    }
  } catch (e) {
    console.warn('meeting-transcribe: sweep skipped', e instanceof Error ? e.message : 'error');
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
  const token = await driveToken();
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
  let geminiFile: string | null = null;
  try {
    const token = await driveToken();
    const media = await fetch(`${DRIVE}/${encodeURIComponent(job.drive_file_id)}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
    if (!media.ok || !media.body) throw new Fail('drive_failed');
    const file = await geminiUpload(key, job, media);
    geminiFile = file.name;
    await geminiActive(key, file.name, file.state);
    const response = await geminiTranscribe(key, file.uri, file.mimeType || job.mime_type, wantsDiarize(job.duration_sec));
    // Gemini가 답했으면(글이 비었어도) 쓴 만큼 기록한다.
    const usage = readUsage(response, job.duration_sec);
    const at = new Date();
    const { error: usageError } = await admin.from('app_ai_external_usage').insert({
      workspace_id: job.workspace_id, ref: usageRef(job.id, at), provider: 'gemini', source: 'transcript', day: seoulDay(at), ...usage,
    });
    if (usageError) console.warn('meeting-transcribe: usage not recorded', usageError.code);
    const result = readTranscript(response);
    await setJob(job.id, { status: 'done', error_code: null, model: usage.model, finished_at: new Date().toISOString() });
    return json({ ok: true, job_id: job.id, text: result.text, speaker_split: result.speakerSplit, model: usage.model });
  } catch (e) {
    const code = e instanceof Fail ? e.code : (e instanceof DOMException && e.name === 'TimeoutError' ? 'gemini_failed' : 'failed');
    await setJob(job.id, { status: 'failed', error_code: code, finished_at: new Date().toISOString() }).catch(() => undefined);
    throw e instanceof Fail ? e : new Fail(code);
  } finally {
    if (geminiFile) await geminiDelete(key, geminiFile);
  }
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

// 조각들을 순서대로 이어 한 흐름으로(메모리에 다 담지 않음).
function joinPieces(token: string, ids: string[]): ReadableStream<Uint8Array> {
  let i = 0;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  return new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      for (;;) {
        if (!reader) {
          if (i >= ids.length) { ctrl.close(); return; }
          const r = await fetch(`${DRIVE}/${encodeURIComponent(ids[i++])}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
          if (!r.ok || !r.body) { await r.body?.cancel(); ctrl.error(new Fail('drive_failed')); return; }
          reader = r.body.getReader();
        }
        const { value, done } = await reader.read();
        if (done) { reader = null; continue; }
        if (value?.byteLength) { ctrl.enqueue(value); return; }
      }
    },
    async cancel() { await reader?.cancel(); },
  });
}
// 조각 파일 크기(조각 폴더 바로 아래, 휴지통 아님)의 합.
async function piecesSize(token: string, ids: string[], folder: string) {
  let size = 0;
  for (const id of ids) {
    const r = await fetch(`${DRIVE}/${encodeURIComponent(id)}?fields=size,trashed,parents`, { headers: { Authorization: `Bearer ${token}` } });
    const d = await r.json().catch(() => null);
    if (!r.ok || d?.trashed !== false || !Array.isArray(d?.parents) || !d.parents.includes(folder) || !/^\d{1,12}$/.test(String(d?.size))) throw new Fail('drive_failed');
    size += Number(d.size);
  }
  return size;
}
// 조각을 Drive 휴지통으로(조각 폴더 바로 아래 것만). 모두 끝나면 표시.
async function trashPieces(seg: Job, token: string, folder: string | null, extra: Record<string, unknown> = {}) {
  let all = true;
  if (folder) {
    for (const id of seg.piece_ids || []) {
      const result = await moveDriveFileToTrash(fetch, id, folder, token);
      if (!(result === 'trashed' || result === 'already_trashed' || result === 'not_ours')) all = false;
    }
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
    const driveId = await driveUpload(token, target, joinPieces(token, seg.piece_ids), name, seg.mime_type, size);
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
    const token = await driveToken();
    const folder = await pieceFolder(workspaceId, token, false);
    for (const seg of done || []) await trashPieces(seg, token, folder);
    for (const seg of dropped || []) await trashPieces(seg, token, folder);
    for (const seg of old || []) {
      if (seg.status === 'failed' && (dropped || []).some(d => d.id === seg.id)) continue; // 위에서 이미 다시 시도함
      await trashPieces(seg, token, folder, seg.status === 'failed' ? {} : { status: 'failed', error_code: 'expired', closed_at: seg.closed_at ?? new Date().toISOString() });
    }
  } catch (e) {
    console.warn('meeting-transcribe: recording sweep skipped', e instanceof Error ? e.message : 'error');
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
  return json({ ok: true, recording_id: data.id, session_id: sessionId, segment_no: segmentNo, piece_seconds: REC_PIECE_SECONDS, segment_seconds: REC_SEGMENT_SECONDS });
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
  const token = await driveToken();
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

async function recFinish(user: { id: string }, body: Record<string, unknown>) {
  const started = Date.now();
  let rows = await ownSession(user.id, body.session_id);
  const ws = rows[0].workspace_id as string;
  const now = new Date();
  for (const r of rows) if (r.status === 'recording') await setRec(r.id, closePatch(r, now), { status: 'recording' });
  rows = await ownSession(user.id, body.session_id);
  let more = false;
  const pending = toCombine(rows);
  if (pending.length) {
    const token = await driveToken();
    const pieces = await pieceFolder(ws, token, false);
    const target = await recordingFolder(ws, token, true);
    if (!target) throw new Fail('drive_failed');
    for (const seg of pending) {
      if (Date.now() - started > REC_FINISH_BUDGET_MS) { more = true; break; }
      await combineSegment(user.id, seg, token, pieces, target);
    }
    rows = await ownSession(user.id, body.session_id);
  }
  return json({ ok: true, session_id: body.session_id, more, segments: rows.filter(r => r.status !== 'empty').map(segmentView) });
}

async function recPending(user: { id: string }, body: Record<string, unknown>) {
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
    const { data, error: jobError } = await admin.from(TABLE).select('id,status').in('id', ids);
    if (jobError) throw new Fail('failed');
    jobs = data || [];
  }
  return json({ ok: true, sessions: pendingSessions(rows || [], jobs, now) });
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
    const token = await driveToken();
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
  const token = await driveToken();
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
      for (const id of p.row.piece_ids || []) if (!ok(await untrashDriveFile(id, folder, token))) throw new Fail('drive_failed');
      if (await setRec(p.row.id, { status: 'closed', error_code: null, pieces_trashed_at: null }, { status: 'failed', error_code: p.row.error_code })) restored++;
    }
  }
  return json({ ok: true, session_id: body.session_id, restored });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);
  try {
    const user = await userOf(req);
    const userDb = userClient(req);
    const action = new URL(req.url).searchParams.get('action') || '';
    if (action === 'upload') return await upload(req, user, userDb);
    if (action === 'rec_piece') return await recPiece(req, user);
    const raw = await req.text();
    if (raw.length > 4096) throw new Fail('bad_request');
    let body: Record<string, unknown> = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { throw new Fail('bad_request'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Fail('bad_request');
    if (action === 'config') return await config(user, userDb, body);
    if (action === 'transcribe') return await transcribe(user, userDb, body);
    if (action === 'attach') return await attach(user, userDb, body);
    if (action === 'rec_start') return await recStart(user, body);
    if (action === 'rec_finish') return await recFinish(user, body);
    if (action === 'rec_pending') return await recPending(user, body);
    if (action === 'rec_discard') return await recDiscard(user, body);
    if (action === 'rec_restore') return await recRestore(user, body);
    throw new Fail('bad_request');
  } catch (e) {
    if (e instanceof AuthError) return json({ ok: false, code: e.message, error: e.status === 401 ? '로그인이 필요합니다.' : '접근 권한이 없습니다.' }, e.status);
    if (e instanceof Fail) return fail(e.code);
    if (e instanceof RecFail) return json(recFailBody(e.code, e.extra), (REC_STATUS as Record<string, number>)[e.code] ?? 409);
    console.error('meeting-transcribe: failed', e instanceof Error ? e.message : 'error');
    return fail('failed');
  }
});
