// FILES-통합 2-②(S49-28, 설계 docs/design/files-unified-plan.md D-5·F·J절, J-1): 클라우드 전송 작업표의 순수 규칙.
// 표 app_cloud_jobs(migration 20261104162800) 한 줄 = 사람이 시작한 복사·옮기기 한 건. 서버(handler.ts)가 줄을 하나씩 이어 가고,
// 200MB 넘는 클라우드 사이 파일은 10MB 조각씩 여러 번에 나눠 '이어 올리기 자리'에 붙인다. 한 번의 서버 실행은 정해 둔 시간만 일하고
// 같은 함수의 job_tick을 다시 불러 다음 실행이 이어 받는다(화면을 닫아도 계속). 여기서는 DB·네트워크를 쓰지 않는다.

export const JOB_COLUMNS = 'id,workspace_id,created_by,kind,origin,src_source,src_id,dest_source,dest_parent,name,result_name,same_name,is_folder,' +
  'size_bytes,mime,src_hash,big,status,sent_bytes,result_item_id,kept_original,error_code,lease_until,attempts,started_at,finished_at,created_at,updated_at';
export const ACTIVE = Object.freeze(['queued', 'running']);
export const STATUSES = Object.freeze(['queued', 'running', 'paused', 'done', 'failed', 'skipped']);
export const JOB_ADD_MAX = 200;                    // 한 번에 넣는 줄(고르기 상한과 같음)
export const JOB_LIST_MAX = 100;                   // 화면이 읽는 줄
export const JOB_LIST_HOURS = 24;                  // 끝난 줄을 보여 주는 기간
export const JOB_STEP_MS = 60 * 1000;              // 한 번 실행에서 일하는 시간(Edge 실행 상한 안쪽 — 조각 하나가 끝나면 시간을 본다)
export const LEASE_MS = 3 * 60 * 1000;             // 한 줄을 잡아 두는 시간(조각 하나 최대 2분 + 여유)
export const STALE_MS = 45 * 1000;                 // 잡은 사람 없이 이만큼 멈춰 있으면 화면 확인(job_list)이 다시 깨운다
export const TICK_TTL_MS = 10 * 60 * 1000;         // job_tick 열쇠 기한
export const MAX_ATTEMPTS = 2000;                  // 한 줄의 실행 횟수 상한(2GB ÷ 10MB ≈ 205조각 + 여유)
export const TICK_HEADER = 'x-cloud-job-tick';
// 클라우드 사이 한 파일: 200MB 넘으면 사람이 [그래도 보내기]를 눌렀을 때만(H-4), 2GB까지(H-4 추천 상한).
export const BIG_BYTES = 200 * 1024 * 1024;
export const BIG_MAX_BYTES = 2 * 1024 * 1024 * 1024;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (v) => typeof v === 'string' && UUID.test(v);
const ITEM = /^[A-Za-z0-9!_.-]{1,200}$/;
const GD = /^[A-Za-z0-9_-]{1,200}$/;
const isSrc = (v) => v === 'od' || v === 'gd';

// ---- job_tick 열쇠: 서버 키로 만든 HMAC(작업공간 id·기한에 묶임). 새 비밀값을 두지 않는다(meeting-transcribe와 같은 방식, 다른 접두어). ----
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function hmac(key, text) {
  const k = await crypto.subtle.importKey('raw', enc.encode(`cloud-job-tick:${key}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, enc.encode(text)));
}
export function tickSign(key, workspaceId, exp) {
  if (!key || !isUuid(workspaceId) || !Number.isSafeInteger(exp)) throw new Error('tick_sign');
  return hmac(key, `${workspaceId}.${exp}`);
}
// 맞으면 true. 열쇠 없음·모양 틀림·기한 지남·너무 먼 기한·서명 다름 = false. 비교는 고정 길이.
export async function tickCheck(key, body, sig, nowMs) {
  if (!key || typeof sig !== 'string' || !/^[0-9a-f]{64}$/.test(sig)) return false;
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).sort().join(',') !== 'exp,workspace_id') return false;
  const { workspace_id: ws, exp } = body;
  if (!isUuid(ws) || !Number.isSafeInteger(exp) || exp < nowMs || exp > nowMs + TICK_TTL_MS + 60000) return false;
  const want = await hmac(key, `${ws}.${exp}`);
  let diff = 0;
  for (let i = 0; i < 64; i++) diff |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

// ---- 화면에 내보내는 줄 모양: 이어 올리기 자리·잡기 기한·만든 사람·작업공간은 싣지 않는다. ----
export function jobView(row) {
  return {
    id: row.id, kind: row.kind, origin: row.origin, src_source: row.src_source, src_id: row.src_id ?? null,
    dest_source: row.dest_source, dest_parent: row.dest_parent ?? null, name: row.name, result_name: row.result_name ?? null,
    same_name: row.same_name ?? null, is_folder: row.is_folder === true, size_bytes: row.size_bytes ?? null, big: row.big === true,
    status: row.status, sent_bytes: Number(row.sent_bytes) || 0, result_item_id: row.result_item_id ?? null,
    kept_original: row.kept_original === true, error_code: row.error_code ?? null,
    created_at: row.created_at, finished_at: row.finished_at ?? null,
  };
}

// ---- 실패 까닭: 정해 둔 말만 줄에 남긴다(화면이 한 줄 글로 바꿈). 그 밖은 '연결 끊김'으로. ----
export const JOB_CODES = Object.freeze([
  'cloud_unavailable', 'cloud_throttled', 'no_space', 'name_invalid', 'too_large', 'verify_failed', 'changed_since_index',
  'not_in_index', 'not_found', 'size_unknown', 'across_unsupported', 'across_folder', 'folder_too_big', 'copy_into_self',
  'dest_invalid', 'name_taken', 'upload_failed', 'copy_failed', 'od_not_connected', 'od_auth_expired', 'gd_not_connected',
  'cloud_denied', 'drive_owner_mismatch', 'feature_required', 'too_many_steps', 'session_expired', 'big_not_confirmed',
]);
export const jobCode = (code) => JOB_CODES.includes(code) ? code : 'cloud_unavailable';

// 화면 확인 때 다시 깨울지: 서버가 이어 갈 줄(origin cloud, 기다림·보내는 중)이 있는데 잡은 사람이 없거나 기한이 지났고 STALE_MS 넘게 멈춤.
export function needsKick(rows, nowMs) {
  const active = (rows || []).filter((r) => r && r.origin !== 'device' && ACTIVE.includes(r.status));
  if (!active.length) return false;
  if (active.some((r) => r.lease_until && Date.parse(r.lease_until) > nowMs)) return false;
  return active.every((r) => nowMs - (Date.parse(r.updated_at || r.created_at || '') || 0) > STALE_MS);
}

// ---- job_add 몸통 ----
// {confirm:true, kind:'copy'|'move', to_source, to, items:[{source, id, numbered?, skip?, big?}]}
//   numbered: 받을 곳에 같은 이름 → [그래도 하기](번호 붙임), skip: [건너뛰기](줄은 '건너뜀'으로만 남김), big: 200MB 넘는 것 [그래도 보내기].
//   같은 저장소 안 옮기기는 move 한 번이 빠르므로 작업표로 받지 않는다(dest_invalid).
export function parseAdd(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return null;
  if (b.kind !== 'copy' && b.kind !== 'move') return null;
  if (!isSrc(b.to_source)) return null;
  const to = b.to === undefined || b.to === null || b.to === '' ? null : b.to;
  if (to !== null && (typeof to !== 'string' || !ITEM.test(to) || (b.to_source === 'gd' && !GD.test(to)))) return null;
  if (!Array.isArray(b.items) || !b.items.length || b.items.length > JOB_ADD_MAX) return null;
  const seen = new Set(), items = [];
  for (const it of b.items) {
    if (!it || typeof it !== 'object' || Array.isArray(it) || !isSrc(it.source)) return null;
    if (typeof it.id !== 'string' || !ITEM.test(it.id) || (it.source === 'gd' && !GD.test(it.id))) return null;
    for (const k of Object.keys(it)) if (!['source', 'id', 'numbered', 'skip', 'big'].includes(k)) return null;
    for (const k of ['numbered', 'skip', 'big']) if (it[k] !== undefined && typeof it[k] !== 'boolean') return null;
    if (it.numbered && it.skip) return null;
    const key = it.source + ':' + it.id;
    if (seen.has(key)) return null;
    seen.add(key);
    if (b.kind === 'move' && it.source === b.to_source) return null;
    items.push({ source: it.source, id: it.id, numbered: it.numbered === true, skip: it.skip === true, big: it.big === true });
  }
  return { kind: b.kind, toSource: b.to_source, to, items };
}
// pause·resume 대상: {all:true} 또는 {ids:[uuid…]}(1~200개).
export function parseIds(b) {
  if (b?.all === true && b.ids === undefined) return { all: true, ids: [] };
  if (!Array.isArray(b?.ids) || !b.ids.length || b.ids.length > JOB_ADD_MAX || !b.ids.every(isUuid) || new Set(b.ids).size !== b.ids.length) return null;
  return { all: false, ids: b.ids.map((x) => x.toLowerCase()) };
}

// ---- 이어 올리기 자리의 '어디까지 받았나' ----
// 원드라이브: GET 이어 올리기 주소 → {nextExpectedRanges:["12345-"]} → 12345. 모양이 다르면 null.
export function odOffset(d) {
  const r = Array.isArray(d?.nextExpectedRanges) ? d.nextExpectedRanges[0] : null;
  const m = typeof r === 'string' ? /^(\d{1,15})-(\d{0,15})$/.exec(r) : null;
  return m ? Number(m[1]) : null;
}
// 구글: PUT 'bytes */size'의 308 응답 Range 머리 'bytes=0-N' → N+1, 머리 없음 → 0. 모양이 다르면 null.
export function gdOffset(range) {
  if (range === null || range === undefined || range === '') return 0;
  const m = /^bytes=0-(\d{1,15})$/.exec(String(range).trim());
  return m ? Number(m[1]) + 1 : null;
}
// 원본에서 받을 다음 조각(끝 포함). size 0이면 없음.
export function nextRange(done, size, chunk) {
  if (!(size > done)) return null;
  return { start: done, end: Math.min(size, done + chunk) - 1 };
}
// 원본 Range 응답 'bytes a-b/total'이 기대와 같은가(원본이 그사이 바뀌지 않았나).
export function rangeOk(header, start, end, size) {
  const m = /^bytes (\d{1,15})-(\d{1,15})\/(\d{1,15})$/.exec(String(header || '').trim());
  return !!m && Number(m[1]) === start && Number(m[2]) === end && Number(m[3]) === size;
}
