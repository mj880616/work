// ORG-기록첨부(S50-22): pictures and files put into an organization's record input (담당조직 상세 [기록] 칸).
// - Putting them in: the update input's own file part (basket-upload.js mountBasketPicker — clip, drop, Ctrl+V paste of PR 1860).
//   No new store and no new upload path: saving goes through the update-with-files path (update-places.js saveUpdateWithFiles):
//   the basket update with its files in Drive, linked to this organization as a record, and its files put into this
//   organization's 자료 (basket-file-docs.js putFilesIntoTargets — the same 자료 link as 정리함 [자료로 넣기]).
// - Letters written → the letters are the record and the files hang on it.
// - No letters (11/05 16:41 명진 결정) → the server AI reads one of the files and suggests the record's one line (recordLineFor);
//   when it cannot, the line is '그림 1장 · 이름'. The line is the link's summary, changed later with ⋯ [요약 수정]. Saving never waits on
//   the AI for more than LINE_TIMEOUT_MS and never fails because of it.
import { createUploadBatch, mountBasketPicker } from './basket-upload.js';
import { lineSource, recordFileLine } from './record-file-line.mjs';

export const LINE_TIMEOUT_MS = 25000;

// One request to library-files mode=record_line (owner check, AI usage record, nothing stored). '' when there is no line.
export async function askFileLine(file, rt = window.KPTURuntime, {timeoutMs = LINE_TIMEOUT_MS, fetcher = globalThis.fetch} = {}) {
  let timer = null;
  try {
    if (typeof rt?.session?.ensure === 'function' && !(await rt.session.ensure())) return '';
    const token = rt?.session?.read?.()?.access_token;
    if (!token || !rt?.config?.url) return '';
    const form = new FormData();
    form.append('mode', 'record_line');
    form.append('file', file, file.name || 'file');
    const ctl = new AbortController();
    const late = new Promise(resolve => { timer = setTimeout(() => { ctl.abort(); resolve(null); }, timeoutMs); });
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
