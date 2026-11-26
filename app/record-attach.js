// ORG-기록첨부(S50-22): pictures and files put into an organization's record input (담당조직 상세 [기록] 칸).
// - Putting them in: the update input's own file part (basket-upload.js mountBasketPicker — clip, drop, Ctrl+V paste of PR 1860).
//   No new store and no new upload path: saving goes through the update-with-files path (update-places.js saveUpdateFilesBehind —
//   BIZ-저장먼저닫기 2차: the letters first, the files behind on the update's line):
//   the basket update with its files in Drive, linked to this organization as a record, and its files put into this
//   organization's 자료 (basket-file-docs.js putFilesIntoTargets — the same 자료 link as 정리함 [자료로 넣기]).
// - Letters written → the letters are the record and the files hang on it.
// - No letters (11/05 16:41 사용자 결정) → the server AI reads one of the files and suggests the record's one line (recordLineFor);
//   when it cannot, the line is '그림 1장 · 이름'. The line is the link's summary, changed later with ⋯ [요약 수정]. Saving never waits on
//   the AI for more than LINE_TIMEOUT_MS and never fails because of it.
import { createUploadBatch, mountBasketPicker } from './basket-upload.js';
import { lineSource, recordFileLine } from './record-file-line.mjs';

export const LINE_TIMEOUT_MS = 25000;
// S67-08(ORG-기록첨부 한줄실패): 그림은 AI에 보내기 전에 긴 변 1600px로 줄인다 — 주간보고 사진 설명(library-files photo-brief.ts가
// 받는 drive-photo.ts 'large')과 같은 크기. 줄이는 코드는 새로 만들지 않고 일기·공유 사진이 쓰는 diary-data.js shrinkPhoto를 쓴다
// (이 기록은 아직 Drive에 올라가기 전이라 Drive 작은 그림을 받을 수 없다). 줄인 그림은 AI 한 줄 요청에만 쓰고, Drive에는 원본이 올라간다.
// 원본 그림 통째(수 MB)를 보내면 보내기·AI 읽기가 길어져 서버 20초·화면 25초 제한에 걸린다. 줄이지 못하면 원본 그대로 보낸다.
export const LINE_PHOTO_EDGE = 1600;
const AI_IMAGE = /^image\/(png|jpeg|webp|gif)$/i;
export async function lineFile(file, {shrink = null} = {}) {
  if (!AI_IMAGE.test(String(file?.type || ''))) return file;
  try {
    const fn = shrink || (await import('./diary-data.js')).shrinkPhoto;
    const small = await fn(file, {edge:LINE_PHOTO_EDGE});
    return small?.size ? small : file;
  } catch { return file; }
}

// One request to library-files mode=record_line (owner check, AI usage record, nothing stored). '' when there is no line.
// The time limit covers the shrinking too (saving never waits on the line for more than LINE_TIMEOUT_MS).
export async function askFileLine(file, rt = window.KPTURuntime, {timeoutMs = LINE_TIMEOUT_MS, fetcher = globalThis.fetch, shrink = null} = {}) {
  let timer = null;
  try {
    const ctl = new AbortController();
    const late = new Promise(resolve => { timer = setTimeout(() => { ctl.abort(); resolve(null); }, timeoutMs); });
    if (typeof rt?.session?.ensure === 'function' && !(await Promise.race([rt.session.ensure(), late]))) return '';
    const token = rt?.session?.read?.()?.access_token;
    if (!token || !rt?.config?.url) return '';
    const sent = await Promise.race([lineFile(file, {shrink}), late]);
    if (!sent) return '';
    const form = new FormData();
    form.append('mode', 'record_line');
    form.append('file', sent, sent.name || file.name || 'file');
    const r = await Promise.race([fetcher(rt.config.url + '/functions/v1/library-files', {method:'POST', cache:'no-store', headers:{apikey:rt.config.key, Authorization:'Bearer ' + token}, body:form, signal:ctl.signal}), late]);
    if (!r?.ok) return '';
    const d = await Promise.race([r.json().catch(() => null), late]);
    return typeof d?.line === 'string' ? d.line : '';
  } catch { return ''; }
  finally { if (timer) clearTimeout(timer); }
}

// The record's line for these files (always a line: the AI's, else made from the files).
export async function recordLineFor(files, rt = window.KPTURuntime, {ask = askFileLine} = {}) {
  const source = lineSource(files);
  const ai = source ? await ask(source, rt) : '';
  return recordFileLine(ai, files);
}

// The clip button and the file rows of a record input. box: the input's box (drop and paste land there).
export function mountRecordAttach({pickerHost, filesHost, box, id, isBusy = () => false, isActive = () => true, onError = () => {}, onChange = () => {}}) {
  let batch = createUploadBatch();
  const picker = mountBasketPicker(pickerHost, {id, filesHost, dropTarget:box, pasteTarget:box, getBatch:() => batch, isBusy, isActive, onChange, onError});
  return {
    getBatch: () => batch,
    pending: () => batch.entries.filter(entry => entry.kind !== 'success').length,
    render: () => picker.render(),
    add: files => picker.add(files),
    reset() { batch = createUploadBatch(); picker.render(); },
  };
}
