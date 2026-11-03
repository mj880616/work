// SEND-일기로 (요청함 11/03 00:36 "노트 → 일기 보내기, 사진 → 업데이트·일기 보내기"):
//   sendRecordToDiary(id) — 노트(kind=note) 또는 정리함 업데이트(kind=basket) 한 건을 그날 일기로 옮긴다.
//   putPhotosInDiary(files) — 사진 화면의 [공유] 메뉴 [일기에 넣기]: 고른 사진을 오늘 일기에 붙인다(사진 원본은 그대로).
// 새 저장 길 없음: 일기의 기존 길(diary-data.js readDiaryDay·createDiary·saveDiaryText·uploadDiaryPhotos = basket-files)과
// 노트의 기존 휴지통 길(basket-record-delete.js deleteNoteOriginal trash:true)만 쓴다. 기기 저장 없음.
// 옮기기 규칙은 기존 [노트로 옮기기]·[정리함으로 돌리기]와 같다: 원본이 따로 남지 않는다. 다만 일기는 하루 한 행이라 행 자체의 종류를
// 바꿀 수 없으므로(그날 일기가 이미 있을 수 있음), 글·사진을 그날 일기에 더한 뒤 원래 노트·업데이트는 휴지통으로 보낸다
// (30일 안에 되살리기, 알림의 [되돌리기]). 사진은 서버의 축소 사진(basket-files photo, 긴 변 1600px)을 받아 일기 사진으로 다시 올린다:
// 같은 Drive 파일을 두 행이 함께 가리키지 않게 해서, 한쪽을 지울 때 다른 쪽 사진이 사라지는 일이 없다.
// 하나라도 실패하면 원래 노트·업데이트는 지우지 않고 그대로 둔다.
import {readDiaryDay, createDiary, saveDiaryText, uploadDiaryPhotos, dropEmptyDiary, diaryPhotoUrl, diaryText,
  validateDiaryText, todayKey, DIARY_MAX_PHOTOS, DIARY_TEXT_MAX} from './diary-data.js';
import {diaryStartDoc, joinDiaryDocs} from './diary-doc.mjs';
import {plainToDocKeep} from './ed-markdown.mjs';
import {seoulDateKey} from './meeting-time.js';

const encode = encodeURIComponent;
const isPhoto = file => /^image\//.test(file?.mime_type || '');
function workspace(rt) {
  const id = rt.context.read()?.workspace?.id;
  if (!id) throw new Error('업무 공간을 확인할 수 없습니다.');
  return id;
}

// 일기에 들어갈 글: 노트는 제목 한 줄 + 본문(본문 첫 줄이 이미 제목이면 한 번만), 업데이트는 본문 그대로. 앞뒤 빈 줄은 뺀다.
export function diaryTextFrom(row) {
  const body = String(row?.raw_text ?? '').replace(/\r\n?/g, '\n').trim();
  const title = row?.kind === 'note' ? String(row?.title ?? '').trim() : '';
  if (!title) return body;
  const first = body.split('\n', 1)[0].trim();
  return first === title ? body : (body ? `${title}\n${body}` : title);
}
// 그날 일기 글 아래에 새 글을 빈 줄 하나 두고 붙인다(일기 글이 없으면 새 글만).
export function joinDiaryText(have, add) {
  const a = String(have ?? '').trim() ? String(have).replace(/\s+$/, '') : '', b = String(add ?? '').trim();
  if (!b) return a;
  return a ? `${a}\n\n${b}` : b;
}
// 보낼 날: 그 기록을 쓴 날(서울 날짜). 날짜를 읽을 수 없으면 오늘.
export function recordDay(row, today = todayKey()) {
  for (const value of [row?.occurred_at, row?.created_at]) {
    if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return seoulDateKey(value);
  }
  return today;
}
export const dayLabel = day => { const [, m, d] = String(day).split('-').map(Number); return m && d ? `${m}월 ${d}일` : String(day); };

// 보내기 전에 막을 것을 한 번에 확인한다(아무것도 쓰기 전). 돌려주는 값: 안내 문장 또는 ''.
export function diarySendProblem(row, diary) {
  const files = Array.isArray(row?.attachments) ? row.attachments : [];
  const others = files.filter(file => !isPhoto(file)).length;
  if (others) return `사진 말고 다른 파일 ${others}개가 붙어 있어 일기로 보낼 수 없어요. 일기에는 사진만 들어가요.`;
  const text = diaryTextFrom(row), photos = files.length;
  if (!text && !photos) return '보낼 글이나 사진이 없어요.';
  const have = Array.isArray(diary?.attachments) ? diary.attachments.length : 0;
  if (have + photos > DIARY_MAX_PHOTOS) return `일기 사진은 하루 ${DIARY_MAX_PHOTOS}장까지예요. 그날 일기에 ${have}장이 있어 ${photos}장을 더 넣을 수 없어요.`;
  if ([...joinDiaryText(diaryText(diary), text)].length > DIARY_TEXT_MAX) return '일기 글은 하루 20,000자까지라 이 글을 더 넣을 수 없어요.';
  return '';
}

export async function readSendRecord(id, rt = window.KPTURuntime) {
  const rows = await rt.api(`/rest/v1/app_notes?id=eq.${encode(id)}&workspace_id=eq.${encode(workspace(rt))}&kind=in.(note,basket)&select=id,kind,title,raw_text,attachments,occurred_at,created_at,updated_at&limit=1`, {singleFlight:false});
  return Array.isArray(rows) ? rows[0] || null : null;
}

// 사진 하나를 서버 축소 사진으로 받아 파일로 만든다(받지 못하면 멈춘다).
async function photoFile(noteId, file, rt, fetcher) {
  const url = await diaryPhotoUrl(noteId, file.drive_file_id, 'large', {rt});
  const blob = await (await fetcher(url)).blob();
  if (!blob?.size || !/^image\//.test(blob.type || '')) throw new Error('photo');
  const name = String(file.file_name || 'photo').slice(0, 200) || 'photo';
  return new File([blob], name, {type:blob.type});
}

// 그날 일기에 글·사진을 더한다(없으면 만든다). 돌려주는 값: {row, done, failed?, message?}.
async function addToDiary(day, text, files, {rt, isCurrent = () => true, onProgress = () => {}} = {}) {
  validateDiaryText(text);
  let row = await readDiaryDay(day, rt), created = false;
  if (!row) {
    try { row = await createDiary({day, text}, rt); created = true; }
    catch (error) { if (error?.code !== 'diary_exists') throw error; row = await readDiaryDay(day, rt); if (!row) throw error; }
  }
  if (!created && text.trim()) {
    const joined = joinDiaryText(diaryText(row), text);
    row = await saveDiaryText(row, joined, rt, {doc:joinDiaryDocs(diaryStartDoc(row), plainToDocKeep(text.trim())), strict:true});
  }
  let result = {done:0, attachments:row.attachments || []};
  if (files.length) result = await uploadDiaryPhotos(row, files, {rt, isCurrent, onProgress});
  let fresh = await readDiaryDay(day, rt);
  if (fresh && created && !text.trim()) {
    // 사진만 든 날은 빈칸 하나로 만들어지므로, 사진이 붙었으면 그 빈칸을 비우고, 하나도 못 붙었으면 빈 일기를 다시 지운다.
    if (fresh.attachments?.length) fresh = await saveDiaryText(fresh, '', rt);
    else { await dropEmptyDiary(fresh, rt).catch(() => {}); fresh = null; }
  }
  return {...result, row:fresh};
}

// 노트·업데이트 한 건 → 그날 일기. 돌려주는 값:
//   {status:'sent', day, trash}            — 일기에 다 들어갔고 원래 기록은 휴지통(trash = deleteNoteOriginal 결과)
//   {status:'blocked', message}            — 보내기 전에 막힘(아무것도 안 바뀜)
//   {status:'partial', day, message}       — 일기에 일부만 들어감(원래 기록은 그대로)
//   {status:'missing'|'stale'}
export async function sendRecordToDiary(id, {rt = window.KPTURuntime, day = '', isCurrent = () => true, onProgress = () => {}, fetcher = globalThis.fetch,
  trash = (noteId, movedText) => import('./basket-record-delete.js').then(m => m.deleteNoteOriginal(noteId, {rt, trash:true, confirmed:true, movedText}))} = {}) {
  const row = await readSendRecord(id, rt);
  if (!row) return {status:'missing', message:'노트를 찾지 못했어요. 다시 불러와 주세요.'};
  const target = day || recordDay(row);
  const diary = await readDiaryDay(target, rt);
  const problem = diarySendProblem(row, diary);
  if (problem) return {status:'blocked', day:target, message:problem};
  if (!isCurrent()) return {status:'stale'};
  const photos = (row.attachments || []).filter(isPhoto), files = [];
  try { for (const file of photos) files.push(await photoFile(row.id, file, rt, fetcher)); }
  catch { return {status:'blocked', day:target, message:'사진을 받지 못했어요. 잠시 뒤 다시 눌러 주세요(아무것도 바뀌지 않았어요).'}; }
  if (!isCurrent()) return {status:'stale'};
  const text = diaryTextFrom(row);
  let result;
  try { result = await addToDiary(target, text, files, {rt, isCurrent, onProgress}); }
  catch (error) { return {status:'partial', day:target, message:`${error?.message || '일기에 넣지 못했어요.'} 원래 기록은 그대로 두었어요.`}; }
  if (result.failed || result.done < files.length) {
    return {status:'partial', day:target, message:`${dayLabel(target)} 일기에 ${text ? '글과 ' : ''}사진 ${result.done}장까지 넣었어요. '${result.failed || '남은 사진'}'부터 넣지 못해 원래 기록은 그대로 두었어요.`};
  }
  const removed = await trash(row.id, `${dayLabel(target)} 일기로 보냈어요`).catch(() => ({status:'unknown'}));
  return {status:'sent', day:target, trash:removed?.status || 'unknown'};
}

// 사진 화면 [일기에 넣기]: 오늘 일기에 사진을 붙인다(사진 원본·사진 화면은 그대로). 돌려주는 값: {ok, count, day, message?}.
export async function putPhotosInDiary(files, {rt = window.KPTURuntime, day = todayKey(), isCurrent = () => true} = {}) {
  const list = (files || []).filter(Boolean);
  if (!list.length) return {ok:false, code:'none'};
  const have = (await readDiaryDay(day, rt))?.attachments?.length || 0;
  if (have + list.length > DIARY_MAX_PHOTOS) return {ok:false, day, message:`일기 사진은 하루 ${DIARY_MAX_PHOTOS}장까지예요. 오늘 일기에 ${have}장이 있어요.`};
  const result = await addToDiary(day, '', list, {rt, isCurrent});
  if (result.failed) return {ok:false, day, count:result.done, message:result.message};
  return {ok:true, day, count:result.done};
}

// 노트 ⋯·업데이트 ⋯ [일기로 보내기] 한 곳: 날짜를 묻고(기본 = 그 기록을 쓴 날, 달력) 보낸다. 결과 알림까지 여기서 한다.
// 돌려주는 값: sendRecordToDiary 결과, 또는 {status:'cancelled'}. 다 들어가면 휴지통 알림('M월 D일 일기로 보냈어요 · 되돌리기')이 뜬다.
export async function askSendToDiary(anchor, id, {rt = window.KPTURuntime, kind = 'note', isCurrent = () => true} = {}) {
  const {askDate, notify} = await import('./small-notice.js');
  let row;
  try { row = await readSendRecord(id, rt); } catch { notify('기록을 읽지 못했어요. 다시 눌러 주세요.', {error:true}); return {status:'failed'}; }
  if (!row) { notify('기록을 찾지 못했어요. 다시 불러와 주세요.', {error:true}); return {status:'missing'}; }
  const what = row.kind === 'note' ? '노트' : '업데이트';
  const day = await askDate(anchor, {text:'어느 날 일기로 보낼까요?', value:recordDay(row), ok:'보내기',
    note:`그날 일기 끝에 글·사진을 더하고, 이 ${what}는 휴지통으로 가요(30일 안에 되살리기).`});
  if (!day || !isCurrent()) return {status:'cancelled'};
  notify('일기로 보내는 중…', {ms:30000});
  let result;
  try { result = await sendRecordToDiary(id, {rt, day, isCurrent, onProgress:({done, total}) => total && notify(`사진 넣는 중… ${done}/${total}장`, {ms:30000})}); }
  catch (error) { result = {status:'partial', message:error?.message || '일기로 보내지 못했어요.'}; }
  if (result.status === 'sent') { if (result.trash !== 'deleted') notify(`${dayLabel(result.day)} 일기에 넣었어요. ${what}는 지우지 못해 그대로 있어요.`, {ms:6000}); }
  else if (result.status !== 'stale') notify(result.message || '일기로 보내지 못했어요.', {error:true, ms:7000});
  return result;
}

// 사진 화면 [일기로]: 고른 사진을 찍은 날(item.day)별로 묶는다(날짜 없는 사진은 오늘). 날짜 순.
export function diaryDayGroups(list, today) {
  const by = new Map();
  for (const item of list) { const day = /^\d{4}-\d{2}-\d{2}$/.test(item.day || '') ? item.day : today; if (!by.has(day)) by.set(day, []); by.get(day).push(item); }
  return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, items]) => ({day, items}));
}
