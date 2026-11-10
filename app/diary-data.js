// JOURNAL-일기 1차: diary rows are app_notes with kind=diary, one per day (journal_day, unique per workspace),
// read and written through the existing owner-RLS REST paths. ai_export_allowed=false is always sent (the database
// requires it, app_notes_diary_private_check). Photos go through the existing basket-files upload with note_id, one at a
// time, and are shown through its owner-only photo view (GET ?action=photo). No browser storage, no new save path.
import {seoulDateKey} from './meeting-time.js';
import {asPicture} from './picture-file.mjs';
import {uploadBasketFile, driveFileUrl} from './basket-upload.js';
import {holdPhotoMaker, forgetPhotoBlob, localImageBlob} from './photo-share.js';
import {slotBox, slotLoading, slotShown, slotFailed, slotPreview, slotTiming} from './img-slot.js';
import {diaryDocToStore, diaryDocError} from './diary-doc.mjs';
import {withMark, withOrigins} from './diary-list-model.mjs';

export const DIARY_MAX_PHOTOS = 20;
export const DIARY_TEXT_MAX = 20000;
export const DIARY_PHOTO_EDGE = 2048;
export const DIARY_COMMENT_MAX = 200;
// app_notes_raw_text_check needs text or an attachment. A photo-only day is created with this one space, and the
// space is cleared again as soon as its first photo is attached (or the empty row is removed if none could be).
const HOLD_TEXT = ' ';
// ED③ 일기: doc = the new editor's saved form (null = a diary written before it, opened converted in memory; diary-doc.mjs).
const FIELDS = 'id,journal_day,raw_text,doc,attachments,metadata,updated_at';
const encode = encodeURIComponent;
const dayKey = /^\d{4}-\d{2}-\d{2}$/;

function workspace(rt) {
  const id = rt.context.read()?.workspace?.id;
  if (!id) throw new Error('업무 공간을 확인할 수 없어요.');
  return id;
}
export const ownerScope = (rt = window.KPTURuntime) => { const c = rt.context.read(); return `${c?.user?.id || ''}:${c?.workspace?.id || ''}`; };
export const diaryText = row => String(row?.raw_text ?? '').trim() ? String(row.raw_text) : '';
export const diaryPhotos = row => (Array.isArray(row?.attachments) ? row.attachments : []).filter(file => /^image\//.test(file?.mime_type || ''));
// Per-photo comments live in the row's existing metadata jsonb (no new column, no database change):
// metadata.photo_comments = {<drive_file_id>: '짧은 코멘트'}. Only comments of photos still on the day are read.
export function photoComments(row) {
  const raw = row?.metadata?.photo_comments;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const file of diaryPhotos(row)) {
    const value = raw[file.drive_file_id];
    if (typeof value === 'string' && value.trim()) out[file.drive_file_id] = value;
  }
  return out;
}
export function cleanComment(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if ([...text].length > DIARY_COMMENT_MAX) throw new Error(`사진 코멘트는 ${DIARY_COMMENT_MAX}자까지 쓸 수 있어요.`);
  return text;
}
// A comments map reduced to the given photos, cleaned, empty ones dropped.
export function cleanComments(comments, photos) {
  const out = {};
  for (const file of photos) {
    const text = cleanComment(comments?.[file.drive_file_id]);
    if (text) out[file.drive_file_id] = text;
  }
  return out;
}
const sameComments = (a, b) => { const x = Object.keys(a), y = Object.keys(b); return x.length === y.length && x.every(key => a[key] === b[key]); };
// Other metadata keys stay as they are; photo_comments is removed when no comment is left.
function withComments(metadata, comments) {
  const next = {...(metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {})};
  if (Object.keys(comments).length) next.photo_comments = comments; else delete next.photo_comments;
  return next;
}
export async function saveDiaryComments(row, comments, rt = window.KPTURuntime) {
  const next = cleanComments(comments, diaryPhotos(row));
  const have = photoComments(row);
  if (sameComments(next, have) && (Object.keys(next).length || !row?.metadata?.photo_comments)) return row;
  return one(await patch(row, {metadata:withComments(row.metadata, next)}, rt));
}
// DIARY-넣은사진원본: 사진 화면에서 일기에 넣은 원드라이브·폰 사진의 원본 식별값을 행의 metadata.photo_origins에 더한다(기존 metadata 칸, 서버 저장).
// added = {<방금 붙은 첨부의 drive_file_id>: 'onedrive:<id>' | 'phone:<key>'}. 읽은 그대로일 때만 쓰고(updated_at), 그사이 바뀌었으면 다시 읽어 한 번 더 시도한다.
// 실패해도 사진은 이미 일기에 들어가 있으므로 던지지 않는다(원본 칸 표시만 빠짐). 돌려주는 값: 저장된 행 또는 원래 행.
export async function saveDiaryOrigins(row, added, rt = window.KPTURuntime) {
  if (!row || !added || !Object.keys(added).length) return row;
  const body = (from, list) => { const own = {}; for (const [id, value] of Object.entries(added)) if (list.has(id)) own[id] = value; return Object.keys(own).length ? {metadata:withOrigins(from.metadata, own)} : null; };
  let current = row;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const next = body(current, new Set(diaryPhotos(current).map(file => file.drive_file_id)));
      if (!next) return current;
      const rows = await patch(current, next, rt, {strict:true});
      if (Array.isArray(rows) && rows.length === 1) return rows[0];
      current = await readDiaryDay(current.journal_day, rt) || current;
    } catch { return current; }
  }
  return current;
}
export const todayKey = () => seoulDateKey(new Date());
function checkDay(day) {
  if (typeof day !== 'string' || !dayKey.test(day) || seoulDateKey(day) !== day) throw new Error('날짜를 확인해 주세요.');
  return day;
}
export function validateDiaryText(text) {
  if (typeof text !== 'string') throw new Error('글을 확인해 주세요.');
  // PostgreSQL length(text) counts Unicode characters, not UTF-16 code units.
  if ([...text].length > DIARY_TEXT_MAX) throw new Error('일기 글은 20,000자까지 쓸 수 있어요.');
  return text;
}
const one = rows => {
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error('저장 결과를 확인할 수 없어요. 접근 권한을 확인해 주세요.');
  return rows[0];
};
const base = rt => `/rest/v1/app_notes?workspace_id=eq.${encode(workspace(rt))}&kind=eq.diary`;

// month is zero-based. Only that month's days: the calendar leaves other days empty.
export async function readDiaryMonth(year, month, rt = window.KPTURuntime) {
  const first = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const last = seoulDateKey(new Date(Date.UTC(year, month + 1, 0, 3)));
  return rt.api(`${base(rt)}&journal_day=gte.${first}&journal_day=lte.${last}&select=${FIELDS}&order=journal_day.asc&limit=40`);
}
// JOURNAL-일기목록: every diary for the [목록] view, newest first (doc is left out: the list shows letters only). One read of up to
// DIARY_LIST_MAX rows; truncated tells the screen that older ones were not read.
export const DIARY_LIST_MAX = 1000;
export async function readDiaryList(rt = window.KPTURuntime, {max = DIARY_LIST_MAX} = {}) {
  const rows = await rt.api(`${base(rt)}&select=id,journal_day,raw_text,attachments,metadata,updated_at&order=journal_day.desc&limit=${max + 1}`);
  const list = Array.isArray(rows) ? rows : [];
  return {rows:list.slice(0, max), truncated:list.length > max};
}
// JOURNAL-일기목록: 📌 고정·★ 별표 = metadata.pinned_at·metadata.starred_at (diary-list-model.mjs withMark). Like the note pin, marking is
// not an edit: updated_at is not touched. The row is read again and the PATCH applies only while updated_at and both marks are still
// what was read, so a change made elsewhere (text, photos, comments, the other mark) is never overwritten; then note_changed.
const markGuard = (key, value) => typeof value === 'string' ? `&metadata->>${key}=eq.${encode(value)}` : `&metadata->>${key}=is.null`;
export async function setDiaryMark(row, key, on, rt = window.KPTURuntime, now = new Date()) {
  const where = `${base(rt)}&id=eq.${encode(row.id)}`;
  const rows = await rt.api(`${where}&select=id,journal_day,metadata,updated_at`, {singleFlight:false});
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error('일기를 찾지 못했어요.');
  const fresh = rows[0], old = fresh.metadata && typeof fresh.metadata === 'object' && !Array.isArray(fresh.metadata) ? fresh.metadata : {};
  const metadata = withMark(old, key, on, now);
  const guard = `&updated_at=eq.${encode(fresh.updated_at)}${markGuard('pinned_at', old.pinned_at)}${markGuard('starred_at', old.starred_at)}`;
  const saved = await rt.api(`${where}${guard}&select=id,journal_day,metadata,updated_at`, {method:'PATCH', prefer:'return=representation', body:{metadata}});
  if (!Array.isArray(saved) || saved.length !== 1) throw Object.assign(new Error('일기가 그사이 바뀌었어요. 다시 눌러 주세요.'), {code:'note_changed'});
  return saved[0];
}
export async function readDiaryDay(day, rt = window.KPTURuntime) {
  const rows = await rt.api(`${base(rt)}&journal_day=eq.${checkDay(day)}&select=${FIELDS}&limit=1`);
  return Array.isArray(rows) ? rows[0] || null : null;
}
// The same day twice is refused by app_notes_journal_day_unique (409); the screen then opens that day to edit.
export async function createDiary({day, text = '', doc = null}, rt = window.KPTURuntime) {
  validateDiaryText(text);
  const form = diaryDocToStore(doc, text);
  const bad = diaryDocError(form); if (bad) throw new Error(bad);
  const workspace_id = workspace(rt);
  try {
    return one(await rt.api('/rest/v1/app_notes', {method:'POST', prefer:'return=representation', body:{workspace_id, kind:'diary', journal_day:checkDay(day), raw_text:text.trim() ? text : HOLD_TEXT, ...(form ? {doc:form} : {}), ai_export_allowed:false}}));
  } catch (error) {
    if (error?.status === 409) throw Object.assign(new Error('이 날 일기가 이미 있어요. 수정으로 열게요.'), {code:'diary_exists'});
    throw error;
  }
}
function patch(row, body, rt, {strict = false} = {}) {
  const guard = strict ? `&updated_at=eq.${encode(row.updated_at)}` : '';
  return rt.api(`${base(rt)}&id=eq.${encode(row.id)}${guard}`, {method:'PATCH', prefer:'return=representation', body:{...body, updated_at:new Date().toISOString()}});
}
// doc: the new editor's saved form written with the letters in one PATCH (null = no form). Without the doc option this is a letters-only
// write, so a row that carries a form drops it with the same write (the form must never differ from its letters).
// strict: the write applies only while the row is still the version given (updated_at); a diary changed on another device is refused (note_changed).
export async function saveDiaryText(row, text, rt = window.KPTURuntime, {doc, strict = false} = {}) {
  validateDiaryText(text);
  if (!text.trim() && !row.attachments?.length) throw new Error('사진이나 글을 넣어 주세요.');
  const body = {raw_text:text.trim() ? text : ''};
  if (doc !== undefined) { const form = diaryDocToStore(doc, text); const bad = diaryDocError(form); if (bad) throw new Error(bad); body.doc = form; }
  else if (row.doc) body.doc = null;
  const rows = await patch(row, body, rt, {strict});
  if (strict && Array.isArray(rows) && !rows.length) throw Object.assign(new Error('일기가 그사이 바뀌었어요. 다시 불러온 뒤 저장해 주세요.'), {code:'note_changed'});
  return one(rows);
}
// The photo leaves this day (saved first). Its Drive original is then sent to the Drive trash by pruneDiaryPhotos below.
export function removeDiaryPhoto(row, fileId, rt = window.KPTURuntime) { return removeDiaryPhotos(row, [fileId], rt); }
// DIARY-사진바로올리기(S52-21): several photos out of the day in one write (the photos picked and already sent, then taken out with ✕
// before [저장], or the ones sent in an editor closed without saving). Same rules as one photo: their comments go in the same write.
export async function removeDiaryPhotos(row, fileIds, rt = window.KPTURuntime) {
  const gone = new Set(fileIds);
  const attachments = (row.attachments || []).filter(file => !gone.has(file.drive_file_id));
  if (attachments.length === (row.attachments || []).length) throw new Error('이미 빠진 사진이에요.');
  if (!attachments.length && !diaryText(row)) throw Object.assign(new Error('글 없이 사진 한 장만 있는 일기라 이 사진은 뺄 수 없어요. 일기를 삭제하려면 [일기 삭제]를 눌러 주세요.'), {code:'last_photo'});
  // The comment of the removed photo goes in the same write, so no orphan comment stays behind.
  const body = {attachments};
  let metadata = row.metadata;
  if (row.metadata?.photo_comments !== undefined) { const rest = {...photoComments(row)}; for (const id of gone) delete rest[id]; metadata = withComments(metadata, rest); }
  // DIARY-넣은사진원본: 빠진 사진의 원본 식별값도 같은 저장에서 뺀다.
  if (row.metadata?.photo_origins !== undefined) { const rest = {...(metadata?.photo_origins || {})}; for (const id of gone) delete rest[id]; metadata = {...metadata}; if (Object.keys(rest).length) metadata.photo_origins = rest; else delete metadata.photo_origins; }
  if (metadata !== row.metadata) body.metadata = metadata;
  const rows = await patch(row, body, rt, {strict:true});
  if (Array.isArray(rows) && !rows.length) throw Object.assign(new Error('일기가 그사이 바뀌었어요. 다시 불러온 뒤 확인해 주세요.'), {code:'note_changed'});
  return one(rows);
}
// DIARY-사진바로올리기: a diary made in this editor only to hold the photos sent right away (no text saved yet) follows the date chosen
// afterwards. The day's unique key refuses a day that already has a diary (409 → diary_exists).
export async function moveDiaryDay(row, day, rt = window.KPTURuntime) {
  try {
    const rows = await patch(row, {journal_day:checkDay(day)}, rt, {strict:true});
    if (Array.isArray(rows) && !rows.length) throw Object.assign(new Error('일기가 그사이 바뀌었어요. 다시 불러온 뒤 확인해 주세요.'), {code:'note_changed'});
    return one(rows);
  } catch (error) {
    if (error?.status === 409) throw Object.assign(new Error('그 날은 이미 일기가 있어 날짜를 바꾸지 않았어요.'), {code:'diary_exists'});
    throw error;
  }
}
// JOURNAL-일기사진정리: after a photo was taken out of the day, ask basket-files to send its Drive original to the Drive trash
// (30 days, never a permanent delete). The server trashes a file only when no other note or document still lists it. Best effort:
// it never throws; null means "not done" (offline, server not updated, error) and the file stays for the later cleanup list.
// Returns {trashed, kept, failed, unknown} counts of the files asked about.
export async function pruneDiaryPhotos(fileIds, {rt = window.KPTURuntime, fetcher = globalThis.fetch} = {}) {
  const ids = [...new Set(fileIds)].filter(id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,255}$/.test(id));
  if (!ids.length || ids.length > 20) return null;
  try {
    if (!(await rt.session.ensure())) return null;
    const token = rt.session.read()?.access_token;
    if (!token) return null;
    const response = await fetcher(`${rt.config.url}/functions/v1/basket-files?action=photo-prune`, {method:'POST', cache:'no-store',
      headers:{apikey:rt.config.key, Authorization:'Bearer ' + token, 'Content-Type':'application/json'}, body:JSON.stringify({action:'photo-prune', file_ids:ids})});
    const data = await response.json();
    if (!response.ok || data?.ok !== true || data.action !== 'photo-prune') return null;
    const count = key => Number.isInteger(data[key]) ? data[key] : 0;
    return {trashed:count('trashed'), kept:count('kept'), failed:count('failed'), unknown:count('unknown')};
  } catch { return null; }
}
// A row created only to hold photos that all failed is removed again (no attachment, plain owner-RLS delete).
export async function dropEmptyDiary(row, rt = window.KPTURuntime) {
  await rt.api(`${base(rt)}&id=eq.${encode(row.id)}&attachments=eq.%5B%5D`, {method:'DELETE', prefer:'return=representation'});
}

// J3: shrink to a 2048px long edge JPEG on the phone before upload. A JPEG already within the edge is sent as is.
// redraw: always draw again, even a small JPEG (share photos: the new JPEG carries no EXIF, so no location goes out).
export async function shrinkPhoto(file, {edge = DIARY_PHOTO_EDGE, quality = 0.86, redraw = false} = {}) {
  const name0 = file?.name;
  if (!file?.size) throw new Error('빈 파일은 올릴 수 없어요.');
  file = await asPicture(file);
  if (!file) throw new Error(`${name0 || '이 파일'}은 사진이 아니에요.`);
  let bitmap;
  try { bitmap = await createImageBitmap(file, {imageOrientation:'from-image'}); }
  catch { throw new Error(`${file.name || '이 사진'}은 이 기기에서 열 수 없는 형식이에요. JPEG·PNG로 바꿔 올려 주세요.`); }
  try {
    const long = Math.max(bitmap.width, bitmap.height), scale = Math.min(1, edge / long);
    if (scale === 1 && file.type === 'image/jpeg' && !redraw) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d'); ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--ds-photo-paper').trim() || 'white'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob?.size) throw new Error('사진을 줄이지 못했어요. 다른 사진으로 다시 선택해 주세요.');
    const name = (String(file.name || 'photo').replace(/\.[^./]{1,8}$/, '') || 'photo').slice(0, 200) + '.jpg';
    return new File([blob], name, {type:'image/jpeg', lastModified:file.lastModified || Date.now()});
  } finally { bitmap.close?.(); }
}
const uploadText = error => {
  if (error?.status === 401) return '로그인이 필요해요. 다시 로그인한 뒤 올려 주세요.';
  if (error?.code === 'too_many_attachments') return '일기 사진은 하루 20장까지예요.';
  if (error?.code === 'note_changed') return '일기가 그사이 바뀌었어요. 다시 불러온 뒤 확인해 주세요.';
  if (error?.code === 'upload_not_sent' || error?.code === 'upload_timeout_sending') return '연결이 끊겨 다 보내지 못했어요. 연결을 확인해 주세요.';
  if (error?.code === 'note_save_result_unknown' || !error?.status || error.status >= 500) return '저장 결과를 확인하지 못했어요. 일기를 다시 불러와 확인해 주세요.';
  return '사진을 올리지 못했어요. Drive 연결 상태를 확인해 주세요.';
};
// One photo onto the day's row. photo: the shrunk photo (or a promise of it — the next photos are shrunk while one is being sent).
// source: the picked photo (the upload display's key). job: a display made before (S52-21: shown from the moment its turn starts,
// shrinking included). Returns the row's attachments after the save and the new one.
// basket-files saves a note's attachments only while they are still what it read (compare-and-swap), so photos of one day go up one
// request at a time: two at once would make the later one fail (note_changed) after its bytes were sent.
export async function uploadDiaryPhoto(row, photo, {rt = window.KPTURuntime, isCurrent = () => true, source = null, job = null, request = uploadBasketFile} = {}) {
  const file = await photo;
  const fd = new FormData(); fd.append('file', file); fd.append('note_id', row.id);
  const result = await request(fd, file, rt, null, isCurrent, {source: source || file, job});
  if (!result?.ok || result.note_id !== row.id || !Array.isArray(result.attachments)) throw Object.assign(new Error(), {code:'note_save_result_unknown'});
  const had = new Set((row.attachments || []).map(item => item.drive_file_id));
  return {attachments:result.attachments, added:result.attachments.find(item => !had.has(item.drive_file_id)) || null};
}
export const diaryUploadText = error => error instanceof Error && error.message && !error.code && !error.status ? error.message : uploadText(error);
// Photos one at a time onto the day's row (note → diary send). A failure stops the rest; photos already up stay on the row.
// UI-올리기진행표시: 사진마다 올리는 중 표시(upload-progress.js)가 고른 사진(file)을 열쇠로 막대 + %를 그린다(보내는 것은 줄인 사진).
// ✕로 취소한 사진은 건너뛰고 다음 사진을 이어서 올린다. uploaded = 올라간 사진의 고른 순서 번호(댓글을 그 사진에 붙이는 데 씀).
export async function uploadDiaryPhotos(row, files, {rt = window.KPTURuntime, isCurrent = () => true, onProgress = () => {}, shrink = shrinkPhoto, request = uploadBasketFile} = {}) {
  let attachments = row.attachments || [], done = 0;
  const uploaded = [], addedIds = {};
  if (attachments.length + files.length > DIARY_MAX_PHOTOS) throw new Error(`일기 사진은 하루 ${DIARY_MAX_PHOTOS}장까지예요.`);
  for (const [index, file] of files.entries()) {
    if (!isCurrent()) break;
    onProgress({done, total:files.length, attachments});
    try {
      const sent = await uploadDiaryPhoto({...row, attachments}, shrink(file), {rt, isCurrent, source:file, request});
      attachments = sent.attachments; done++; uploaded.push(index); if (sent.added) addedIds[index] = sent.added.drive_file_id;
    } catch (error) {
      if (error?.code === 'upload_cancelled') continue;
      return {done, attachments, uploaded, addedIds, failed:file.name || `${done + 1}번째 사진`, message:diaryUploadText(error)};
    }
  }
  onProgress({done, total:files.length, attachments});
  return {done, attachments, uploaded, addedIds};
}

// Owner-only reduced photo from basket-files (PR 1). Kept as object URLs in memory for this sign-in only.
// UI-PC일기 ①: kptu:session-changed also fires when the same owner's sign-in is only refreshed (new token, runtime
// write()). Revoking then broke every photo already on screen (object URL gone, img fails), so the cache is dropped only
// when the signed-in owner really changes or signs out; diaryPhotoUrl's owner-scope check still guards each read.
const photoCache = new Map();
// PHOTO-크게보기빨리: 이미 다 받은 그림 주소(같은 키). 크게 보기가 큰 그림을 받는 동안 작은 그림을 바로 띄울 때 쓴다(요청 없음).
const photoReady = new Map();
export const readyDiaryPhotoUrl = (noteId, fileId, size = 'small') => photoReady.get(`${noteId}:${fileId}:${size}`) || '';
let cacheScope = '';
let cacheSessionOwner = globalThis.window?.KPTURuntime?.session?.read?.()?.user?.id || '';
export function photoSessionChanged(session) {
  const next = session?.user?.id || '';
  if (next && next === cacheSessionOwner) return false;
  cacheSessionOwner = next; clearPhotoCache();
  return true;
}
globalThis.window?.addEventListener?.('kptu:session-changed', event => { photoSessionChanged(event?.detail?.session || null); });
export function clearPhotoCache() { for (const flight of photoCache.values()) flight.then(url => URL.revokeObjectURL(url), () => {}); photoCache.clear(); photoReady.clear(); }
// The browser could not draw this cached photo (revoked or undecodable): forget it so the next read fetches again.
// Only the cached copy that failed is dropped (another photo element may already have read a fresh one).
export function forgetDiaryPhoto(noteId, fileId, size, failedUrl) {
  const key = `${noteId}:${fileId}:${size}`, flight = photoCache.get(key);
  if (!flight) return Promise.resolve();
  return flight.then(url => { if (url === failedUrl && photoCache.get(key) === flight) { photoCache.delete(key); photoReady.delete(key); URL.revokeObjectURL(url); } }, () => {});
}
export function diaryPhotoUrl(noteId, fileId, size = 'small', {rt = window.KPTURuntime, fetcher = globalThis.fetch} = {}) {
  const scope = ownerScope(rt);
  if (scope !== cacheScope) { clearPhotoCache(); cacheScope = scope; }
  const key = `${noteId}:${fileId}:${size}`;
  if (photoCache.has(key)) return photoCache.get(key);
  const flight = (async () => {
    if (!(await rt.session.ensure())) throw new Error('session');
    const token = rt.session.read()?.access_token;
    if (!token) throw new Error('session');
    const query = new URLSearchParams({action:'photo', note_id:noteId, file_id:fileId, size});
    const response = await fetcher(`${rt.config.url}/functions/v1/basket-files?${query}`, {headers:{apikey:rt.config.key, Authorization:'Bearer ' + token}});
    const type = response.headers.get('content-type') || '';
    if (!response.ok || !/^image\//.test(type)) throw new Error('photo');
    return URL.createObjectURL(await response.blob());
  })();
  photoCache.set(key, flight);
  flight.then(url => { if (photoCache.get(key) === flight) photoReady.set(key, url); }, () => { if (photoCache.get(key) === flight) photoCache.delete(key); });
  return flight;
}
// One photo element (shared img-slot.js rule, PHOTO-못받은사진): light gray while loading, the reduced image once drawn, and a small ↻
// when the photo view cannot answer (tap = that photo again). The day's large view (link:true) also keeps the "Drive에서 열기" link.
// retry:false: 더 큰 누르기 칸의 바탕(달력 날짜 칸·하루 미리보기·목록 줄)이라 ↻는 표시만(img-slot.js passive).
export function photoElement(row, file, size, {label = '', rt = window.KPTURuntime, link = true, retry = true} = {}) {
  const box = document.createElement('span');
  box.className = 'diary-photo'; box.dataset.diaryPhoto = file.drive_file_id;
  const img = document.createElement('img');
  img.alt = label || file.file_name || '일기 사진'; img.decoding = 'async'; img.loading = 'lazy';
  box.append(img); box.dataset.state = 'loading'; slotBox(box);
  let anchor = null;
  // 큰 그림(크게 보기): 누른 때부터 시간을 재고, 이미 받아 둔 작은 그림이 있으면 받는 동안 먼저 띄운다(PHOTO-크게보기빨리).
  const big = size === 'large';
  if (big) { slotTiming(box); slotPreview(box, readyDiaryPhotoUrl(row.id, file.drive_file_id, 'small')); }
  // 'shown' only after the browser really drew the image (load). An error (revoked URL, undecodable file) forgets the
  // cached copy and reads once more; a second failure shows the same ↻ as a failed photo view.
  const attempt = tries => diaryPhotoUrl(row.id, file.drive_file_id, size, {rt}).then(url => {
    if (big) slotTiming(box, 'url');
    img.onload = () => { img.onload = img.onerror = null; holdPhotoMaker(box, () => localImageBlob(url)); box.dataset.state = 'shown'; slotShown(box); };
    img.onerror = () => {
      img.onload = img.onerror = null; forgetPhotoBlob(box); img.removeAttribute('src');
      const forgotten = forgetDiaryPhoto(row.id, file.drive_file_id, size, url);
      if (tries < 2) { box.dataset.state = 'retry'; forgotten.then(() => attempt(tries + 1)); } else fallback('img');
    };
    img.src = url;
  }, () => fallback('photo'));
  function again() { anchor?.remove(); anchor = null; box.dataset.state = 'loading'; slotLoading(box); attempt(1); }
  function fallback(why) {
    img.onload = img.onerror = null; img.removeAttribute('src'); box.dataset.state = 'link';
    slotFailed(box, again, why, {passive: !retry});
    const href = driveFileUrl(file.drive_file_id);
    if (!link || !href || anchor) return;
    anchor = document.createElement('a');
    anchor.href = href; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; anchor.className = 'diary-photo-link';
    anchor.textContent = 'Drive에서 열기'; anchor.setAttribute('aria-label', `${label || file.file_name || '사진'} Drive에서 열기`);
    box.append(anchor);
  }
  attempt(1);
  return box;
}

// [달력] day list: that day's diary first photo, small, on top. Opening it goes to [일기] on that day.
let requestedDay = null;
export function requestDiaryDay(day) { requestedDay = {day, scope:ownerScope()}; }
export function takeRequestedDay(rt = window.KPTURuntime) { const value = requestedDay; requestedDay = null; return value && value.scope === ownerScope(rt) ? value.day : null; }
// HOME-하루채우기 ③ '이런 기록은 어때요?' [일기 쓰기]: 그날 일기 쓰기 창을 첫 줄(제안 한 줄)이 채워진 채로 연다. 저장하면 onSaved(제안 지우기)를 한 번 부른다.
let requestedWrite = null;
export function requestDiaryWrite(day, line, onSaved = null) { requestDiaryDay(day); requestedWrite = {day, line:String(line ?? '').slice(0, 200), onSaved, scope:ownerScope()}; }
export function takeRequestedWrite(day, rt = window.KPTURuntime) { const value = requestedWrite; requestedWrite = null; return value && value.day === day && value.scope === ownerScope(rt) ? value : null; }
export async function diaryDayPreview(day, {rt = window.KPTURuntime} = {}) {
  const row = await readDiaryDay(day, rt);
  if (!row) return null;
  const photos = diaryPhotos(row), text = diaryText(row);
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'diary-day-preview'; button.dataset.diaryPreview = day;
  button.setAttribute('aria-label', `이 날 일기 보기${photos.length ? `, 사진 ${photos.length}장` : ''}`);
  if (photos[0]) button.append(photoElement(row, photos[0], 'small', {label:'일기 첫 사진', rt, link:false, retry:false}));
  const body = document.createElement('span'); body.className = 'diary-day-preview-text';
  const title = document.createElement('b'); title.textContent = '일기';
  const line = document.createElement('span'); line.textContent = text ? [...text.replace(/\s+/g, ' ').trim()].slice(0, 60).join('') : `사진 ${photos.length}장`;
  body.append(title, line); button.append(body);
  return button;
}
