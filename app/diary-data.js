// JOURNAL-일기 1차: diary rows are app_notes with kind=diary, one per day (journal_day, unique per workspace),
// read and written through the existing owner-RLS REST paths. ai_export_allowed=false is always sent (the database
// requires it, app_notes_diary_private_check). Photos go through the existing basket-files upload with note_id, one at a
// time, and are shown through its owner-only photo view (GET ?action=photo). No browser storage, no new save path.
import {seoulDateKey} from './meeting-time.js';
import {uploadBasketFile, driveFileUrl} from './basket-upload.js';

export const DIARY_MAX_PHOTOS = 20;
export const DIARY_TEXT_MAX = 20000;
export const DIARY_PHOTO_EDGE = 2048;
export const DIARY_COMMENT_MAX = 200;
// app_notes_raw_text_check needs text or an attachment. A photo-only day is created with this one space, and the
// space is cleared again as soon as its first photo is attached (or the empty row is removed if none could be).
const HOLD_TEXT = ' ';
const FIELDS = 'id,journal_day,raw_text,attachments,metadata,updated_at';
const encode = encodeURIComponent;
const dayKey = /^\d{4}-\d{2}-\d{2}$/;

function workspace(rt) {
  const id = rt.context.read()?.workspace?.id;
  if (!id) throw new Error('업무 공간을 확인할 수 없습니다.');
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
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error('저장 결과를 확인할 수 없습니다. 접근 권한을 확인해 주세요.');
  return rows[0];
};
const base = rt => `/rest/v1/app_notes?workspace_id=eq.${encode(workspace(rt))}&kind=eq.diary`;

// month is zero-based. Only that month's days: the calendar leaves other days empty.
export async function readDiaryMonth(year, month, rt = window.KPTURuntime) {
  const first = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const last = seoulDateKey(new Date(Date.UTC(year, month + 1, 0, 3)));
  return rt.api(`${base(rt)}&journal_day=gte.${first}&journal_day=lte.${last}&select=${FIELDS}&order=journal_day.asc&limit=40`);
}
export async function readDiaryDay(day, rt = window.KPTURuntime) {
  const rows = await rt.api(`${base(rt)}&journal_day=eq.${checkDay(day)}&select=${FIELDS}&limit=1`);
  return Array.isArray(rows) ? rows[0] || null : null;
}
// The same day twice is refused by app_notes_journal_day_unique (409); the screen then opens that day to edit.
export async function createDiary({day, text = ''}, rt = window.KPTURuntime) {
  validateDiaryText(text);
  const workspace_id = workspace(rt);
  try {
    return one(await rt.api('/rest/v1/app_notes', {method:'POST', prefer:'return=representation', body:{workspace_id, kind:'diary', journal_day:checkDay(day), raw_text:text.trim() ? text : HOLD_TEXT, ai_export_allowed:false}}));
  } catch (error) {
    if (error?.status === 409) throw Object.assign(new Error('이 날 일기가 이미 있어요. 수정으로 열게요.'), {code:'diary_exists'});
    throw error;
  }
}
function patch(row, body, rt, {strict = false} = {}) {
  const guard = strict ? `&updated_at=eq.${encode(row.updated_at)}` : '';
  return rt.api(`${base(rt)}&id=eq.${encode(row.id)}${guard}`, {method:'PATCH', prefer:'return=representation', body:{...body, updated_at:new Date().toISOString()}});
}
export async function saveDiaryText(row, text, rt = window.KPTURuntime) {
  validateDiaryText(text);
  if (!text.trim() && !row.attachments?.length) throw new Error('사진이나 글을 넣어 주세요.');
  return one(await patch(row, {raw_text:text.trim() ? text : ''}, rt));
}
// The photo leaves this day only; its Drive file stays in the "Web2 바구니" folder (no server trash path for one file).
export async function removeDiaryPhoto(row, fileId, rt = window.KPTURuntime) {
  const attachments = (row.attachments || []).filter(file => file.drive_file_id !== fileId);
  if (attachments.length === (row.attachments || []).length) throw new Error('이미 빠진 사진이에요.');
  if (!attachments.length && !diaryText(row)) throw Object.assign(new Error('글 없이 사진 한 장만 있는 일기라 이 사진은 뺄 수 없어요. 일기를 지우려면 [일기 지우기]를 눌러 주세요.'), {code:'last_photo'});
  // The comment of the removed photo goes in the same write, so no orphan comment stays behind.
  const body = {attachments};
  if (row.metadata?.photo_comments !== undefined) { const {[fileId]: gone, ...rest} = photoComments(row); body.metadata = withComments(row.metadata, rest); }
  const rows = await patch(row, body, rt, {strict:true});
  if (Array.isArray(rows) && !rows.length) throw Object.assign(new Error('일기가 그사이 바뀌었어요. 다시 불러온 뒤 확인해 주세요.'), {code:'note_changed'});
  return one(rows);
}
// A row created only to hold photos that all failed is removed again (no attachment, plain owner-RLS delete).
export async function dropEmptyDiary(row, rt = window.KPTURuntime) {
  await rt.api(`${base(rt)}&id=eq.${encode(row.id)}&attachments=eq.%5B%5D`, {method:'DELETE', prefer:'return=representation'});
}

// J3: shrink to a 2048px long edge JPEG on the phone before upload. A JPEG already within the edge is sent as is.
// redraw: always draw again, even a small JPEG (share photos: the new JPEG carries no EXIF, so no location goes out).
export async function shrinkPhoto(file, {edge = DIARY_PHOTO_EDGE, quality = 0.86, redraw = false} = {}) {
  if (!file?.size) throw new Error('빈 파일은 올릴 수 없어요.');
  if (!/^image\//.test(file.type || '')) throw new Error(`${file.name || '이 파일'}은 사진이 아니에요.`);
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
    if (!blob?.size) throw new Error('사진을 줄이지 못했어요. 다른 사진으로 다시 골라 주세요.');
    const name = (String(file.name || 'photo').replace(/\.[^./]{1,8}$/, '') || 'photo').slice(0, 200) + '.jpg';
    return new File([blob], name, {type:'image/jpeg', lastModified:file.lastModified || Date.now()});
  } finally { bitmap.close?.(); }
}
const uploadText = error => {
  if (error?.status === 401) return '로그인이 필요해요. 다시 로그인한 뒤 올려 주세요.';
  if (error?.code === 'too_many_attachments') return '일기 사진은 하루 20장까지예요.';
  if (error?.code === 'note_changed') return '일기가 그사이 바뀌었어요. 다시 불러온 뒤 확인해 주세요.';
  if (error?.code === 'note_save_result_unknown' || !error?.status || error.status >= 500) return '저장 결과를 확인하지 못했어요. 일기를 다시 불러와 확인해 주세요.';
  return '사진을 올리지 못했어요. Drive 연결 상태를 확인해 주세요.';
};
// Photos one at a time onto the day's row. A failure stops the rest; photos already up stay on the row.
export async function uploadDiaryPhotos(row, files, {rt = window.KPTURuntime, isCurrent = () => true, onProgress = () => {}, shrink = shrinkPhoto, request = uploadBasketFile} = {}) {
  let attachments = row.attachments || [], done = 0;
  if (attachments.length + files.length > DIARY_MAX_PHOTOS) throw new Error(`일기 사진은 하루 ${DIARY_MAX_PHOTOS}장까지예요.`);
  for (const file of files) {
    if (!isCurrent()) break;
    onProgress({done, total:files.length, attachments});
    try {
      const photo = await shrink(file);
      const fd = new FormData(); fd.append('file', photo); fd.append('note_id', row.id);
      const result = await request(fd, photo, rt, fetch, isCurrent);
      if (!result?.ok || result.note_id !== row.id || !Array.isArray(result.attachments)) throw Object.assign(new Error(), {code:'note_save_result_unknown'});
      attachments = result.attachments; done++;
    } catch (error) {
      return {done, attachments, failed:file.name || `${done + 1}번째 사진`, message:error instanceof Error && error.message && !error.code && !error.status ? error.message : uploadText(error)};
    }
  }
  onProgress({done, total:files.length, attachments});
  return {done, attachments};
}

// Owner-only reduced photo from basket-files (PR 1). Kept as object URLs in memory for this sign-in only.
// UI-PC일기 ①: kptu:session-changed also fires when the same owner's sign-in is only refreshed (new token, runtime
// write()). Revoking then broke every photo already on screen (object URL gone, img fails), so the cache is dropped only
// when the signed-in owner really changes or signs out; diaryPhotoUrl's owner-scope check still guards each read.
const photoCache = new Map();
let cacheScope = '';
let cacheSessionOwner = globalThis.window?.KPTURuntime?.session?.read?.()?.user?.id || '';
export function photoSessionChanged(session) {
  const next = session?.user?.id || '';
  if (next && next === cacheSessionOwner) return false;
  cacheSessionOwner = next; clearPhotoCache();
  return true;
}
globalThis.window?.addEventListener?.('kptu:session-changed', event => { photoSessionChanged(event?.detail?.session || null); });
export function clearPhotoCache() { for (const flight of photoCache.values()) flight.then(url => URL.revokeObjectURL(url), () => {}); photoCache.clear(); }
// The browser could not draw this cached photo (revoked or undecodable): forget it so the next read fetches again.
// Only the cached copy that failed is dropped (another photo element may already have read a fresh one).
export function forgetDiaryPhoto(noteId, fileId, size, failedUrl) {
  const key = `${noteId}:${fileId}:${size}`, flight = photoCache.get(key);
  if (!flight) return Promise.resolve();
  return flight.then(url => { if (url === failedUrl && photoCache.get(key) === flight) { photoCache.delete(key); URL.revokeObjectURL(url); } }, () => {});
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
  flight.catch(() => { if (photoCache.get(key) === flight) photoCache.delete(key); });
  return flight;
}
// One photo element: the reduced image, or the "Drive에서 열기" link when the photo view cannot answer
// (before the basket-files deploy, or a Drive error). Inside a button (calendar cell, day preview) link:false shows a
// plain photo mark instead, since a link cannot sit inside a button; the day's large view keeps the link.
export function photoElement(row, file, size, {label = '', rt = window.KPTURuntime, link = true} = {}) {
  const box = document.createElement('span');
  box.className = 'diary-photo'; box.dataset.diaryPhoto = file.drive_file_id;
  const img = document.createElement('img');
  img.alt = label || file.file_name || '일기 사진'; img.decoding = 'async'; img.loading = 'lazy'; img.hidden = true;
  box.append(img); box.dataset.state = 'loading';
  // 'shown' only after the browser really drew the image (load). An error (revoked URL, undecodable file) forgets the
  // cached copy and reads once more; a second failure shows the same fallback as a failed photo view.
  const attempt = tries => diaryPhotoUrl(row.id, file.drive_file_id, size, {rt}).then(url => {
    img.onload = () => { img.onload = img.onerror = null; box.dataset.state = 'shown'; };
    img.onerror = () => {
      img.onload = img.onerror = null; img.hidden = true; img.removeAttribute('src');
      const forgotten = forgetDiaryPhoto(row.id, file.drive_file_id, size, url);
      if (tries < 2) { box.dataset.state = 'retry'; forgotten.then(() => attempt(tries + 1)); } else fallback();
    };
    img.src = url; img.hidden = false;
  }, fallback);
  function fallback() {
    img.onload = img.onerror = null; img.remove(); box.dataset.state = 'link';
    const href = driveFileUrl(file.drive_file_id);
    if (!link || !href) { const mark = document.createElement('span'); mark.className = 'diary-photo-mark'; mark.setAttribute('aria-hidden', 'true'); mark.textContent = '사진'; box.append(mark); return; }
    const anchor = document.createElement('a');
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
export async function diaryDayPreview(day, {rt = window.KPTURuntime} = {}) {
  const row = await readDiaryDay(day, rt);
  if (!row) return null;
  const photos = diaryPhotos(row), text = diaryText(row);
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'diary-day-preview'; button.dataset.diaryPreview = day;
  button.setAttribute('aria-label', `이 날 일기 보기${photos.length ? `, 사진 ${photos.length}장` : ''}`);
  if (photos[0]) button.append(photoElement(row, photos[0], 'small', {label:'일기 첫 사진', rt, link:false}));
  const body = document.createElement('span'); body.className = 'diary-day-preview-text';
  const title = document.createElement('b'); title.textContent = '일기';
  const line = document.createElement('span'); line.textContent = text ? [...text.replace(/\s+/g, ' ').trim()].slice(0, 60).join('') : `사진 ${photos.length}장`;
  body.append(title, line); button.append(body);
  return button;
}
