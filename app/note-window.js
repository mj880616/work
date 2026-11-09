// ED③ 노트 화면: the note's big window in the new editor (ed-window.js), for a new note ([크게] on the note input, PC top line [+ 추가] →
// [노트]) and for [큰 창에서 수정]. The window saves nothing itself: the save goes to the existing owner-RLS note paths
// (createNoteDoc, or the note screen's own save for an edit).
//   New note: a title row (title box + optional [폴더 ▾]) above the text, [📎 첨부] under it (the note input's own file batch or this
//   window's), [넣기] → [사진]·[파일] (NOTE-파일그림넣기: they wait in this window until the save, then go up as the new note's own
//   attachments and stay in the text: note-pending-media.mjs), and the markdown line shortcuts.
//   There is no [업데이트 | 노트] switch here: an update is written from the update input (차이 — PR 본문).
import {holdToast as kptuHoldToast} from './small-notice.js'; // UI-작은알림자리: #toast도 위쪽·2초·올려 두면 멈춤(시계 하나)
import {openEdWindow} from './ed-window.js';
import {createNoteDoc, noteTitleFromText, readNoteDoc, saveNoteDoc} from './basket-data.js';
import {createUploadBatch, uploadNoteFiles, mountBasketPicker, fileTitle} from './basket-upload.js';
import {NOTE_TEXT_MAX} from './note-doc.mjs';
import {requestNoteAiTitle} from './note-ai-title.js';
import {WAIT_PREFIX, waitingSrcs, swapWaiting} from './note-pending-media.mjs';
import {toPlain} from './ed-text.mjs';
import {mountUploadRows} from './upload-progress.js'; // UI-올리기진행표시: 저장 뒤 올라가는 글 안 사진·파일의 막대 + %

function toast(message) {
  const box = document.querySelector('#toast'); if (!box) return;
  box.textContent = message; kptuHoldToast(box);
}
// [📎 첨부] row under the text: the basket picker part on a file batch. Returns {node, picker, pending()}.
export function attachRow({id, getBatch, isBusy, say}) {
  const node = document.createElement('div'), pickerHost = document.createElement('div'), files = document.createElement('div');
  node.dataset.edwAttach = ''; files.dataset.edwAttachFiles = '';
  node.append(pickerHost, files);
  const picker = mountBasketPicker(pickerHost, {id, filesHost: files, dropTarget: node, getBatch, isBusy, onChange: () => say(''), onError: say});
  return {node, picker, pending: () => getBatch().entries.filter(entry => entry.kind !== 'success').length};
}
// S48-30 잘림: 폴더 이름은 8글자까지 다 보이고 그보다 길면 뒤를 '…'로 줄인다(▾는 늘 보임). 버튼은 줄어들지 않고 제목 칸이 양보한다(ed-window.css).
export const shortFolder = name => { const chars = [...String(name || '')]; return chars.length > 8 ? chars.slice(0, 8).join('') + '…' : chars.join(''); };
// FORGET-노트고르기: target(note-pick.js createNoteTarget)이 있으면 줄 맨 앞에 [새 노트 ▾], 그다음 [폴더 ▾]·제목 칸·'📁 폴더 · 끝에 더함',
// 줄 아래 고른 노트의 흐린 마지막 두 줄(target.tail). 제목 칸은 새 노트일 때만, [폴더 ▾]는 새 노트와 가족 '잊지 말기' 노트일 때만 보인다.
function titleRow({value = '', folder = null, target = null, placeholder = '제목(비우면 첫 줄)'}) {
  const row = document.createElement('div'); row.className = 'edw-title-row';
  const label = document.createElement('label'); label.className = 'a11y-only'; label.htmlFor = 'edwNoteTitle'; label.textContent = '노트 제목';
  const input = document.createElement('input');
  input.id = 'edwNoteTitle'; input.type = 'text'; input.autocomplete = 'off'; input.dataset.edwTitle = ''; input.value = value;
  input.placeholder = placeholder; input.setAttribute('enterkeyhint', 'next'); input.dataset.enterField = 'off';
  let button = null;
  if (folder) {
    button = document.createElement('button'); button.type = 'button'; button.dataset.edwFolder = ''; button.setAttribute('aria-haspopup', 'dialog');
    button.addEventListener('click', () => folder.open(button));
  }
  if (target) row.append(label, target.button, ...(button ? [button] : []), input, target.info);
  else row.append(label, input, ...(button ? [button] : []));
  const paint = () => { if (button) { const name = folder.label?.() || '폴더 없음'; button.textContent = shortFolder(name) + ' ▾'; button.title = '노트 폴더: ' + name; } };
  folder?.watch?.(paint);
  paint();
  let node = row;
  if (target) {
    node = document.createElement('div'); node.className = 'edw-head-wrap';
    node.append(row, target.tail);
    const sync = () => {
      const kind = target.get().kind;
      input.hidden = kind !== 'new'; label.hidden = kind !== 'new';
      if (button) button.hidden = kind === 'note';
    };
    target.watch(sync); sync();
  }
  return {row: node, input, paint};
}

// NOTE-파일그림넣기: [사진]·[파일] in a new note (no id yet). A chosen file waits in this window's memory under a waiting id; a picture
// shows from the device's own copy (a blob address of this page, never sent anywhere). Nothing goes up until the note is saved.
const WAIT_MAX_BYTES = 100 * 1024 * 1024;
export function waitingMedia() {
  const kept = new Map();
  let n = 0;
  const keep = (file, picture) => {
    if (!file?.size) throw new Error('빈 파일은 넣을 수 없어요.');
    if (file.size > WAIT_MAX_BYTES) throw new Error('파일은 100MiB까지 넣을 수 있어요.');
    const src = `${WAIT_PREFIX}${++n}_${Math.random().toString(36).slice(2, 8)}`;
    kept.set(src, {file, url: picture ? URL.createObjectURL(file) : null});
    return src;
  };
  return {
    photos: {max: 20, async add(file) { return {src: keep(file, true)}; }, async url(src) { return kept.get(src)?.url || null; }},
    files: {
      async add(file) { return {src: keep(file, false), name: file.name || '파일', size: file.size || null}; },
      open(src) {
        const file = kept.get(src)?.file; if (!file) return;
        const url = URL.createObjectURL(file);
        window.open(url, '_blank', 'noopener,noreferrer');
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      },
    },
    file: src => kept.get(src)?.file || null,
    has: file => [...kept.values()].some(entry => entry.file === file),
    preview: file => [...kept.values()].find(entry => entry.file === file)?.url || null,
    clear() { for (const entry of kept.values()) if (entry.url) URL.revokeObjectURL(entry.url); kept.clear(); },
  };
}
// After the new note is made: each waiting file goes up as one of its attachments (one at a time, in the text's order) and its id is
// swapped in the text; the note's text is then written once more (guarded by the version after the uploads). Returns '' or a warning.
async function sendWaiting(note, value, media, {rt, isCurrent}) {
  const swap = {};
  let attachments = note.attachments || [], failed = 0, error = null;
  for (const src of waitingSrcs(value)) {
    const file = media.file(src);
    if (!file || error) { failed++; continue; }
    const batch = createUploadBatch(note.id, attachments);
    batch.entries = [{file, kind: 'pending', label: '대기'}];
    const before = new Set(attachments.map(f => f?.drive_file_id));
    try {
      await uploadNoteFiles(note.id, batch, {rt, isCurrent});
      attachments = batch.attachments;
      const made = attachments.find(f => f?.drive_file_id && !before.has(f.drive_file_id));
      if (made) swap[src] = 'drive:' + made.drive_file_id; else failed++;
    } catch (e) { error = e; failed++; }
  }
  if (!Object.keys(swap).length) return failed ? `노트는 저장했지만 사진·파일을 올리지 못했어요. ${error?.message || ''} 노트를 열어 다시 넣어 주세요.` : '';
  const doc = swapWaiting(value, swap);
  try {
    const row = await readNoteDoc(note.id, rt);
    if (!row || !isCurrent()) throw new Error('note_missing');
    await saveNoteDoc(note.id, {title: row.title, raw_text: toPlain(doc), doc, version: row.updated_at}, rt);
  } catch {
    return '노트와 사진·파일은 저장했지만 글 안 자리를 맞추지 못했어요. 파일은 노트 아래에 있어요.';
  }
  return failed ? `노트는 저장했지만 사진·파일 ${failed}개를 올리지 못했어요. ${error?.message || ''}`.trim() : '';
}

// A new note. text: the note input's letters (kept as written). upload: the note input's own batch {getBatch, isBusy, onChange, reset}
// (optional). noteFolder: {label(), open(trigger)} (optional; note-folder-pick.js, or the note screen's own). With write:true and get() the window
// puts the new note into the chosen folder itself after the save (noteFolder.put: the same setNoteFolderRef write as the note screen); without it the opener does.
// onClose({saved, text}) — saved = {kind:'note', id} after a save (FORGET-노트고르기: + folderName, added = 기존 노트 끝에 더함).
// FORGET-노트고르기 target (note-pick.js createNoteTarget, optional): [새 노트 ▾] in front of the title row. When an existing note (or the family
// '잊지 말기' note) is chosen, [저장] does not make a new note: it hands the written text to target.save({value, text, heading}) → {noteId, folderName,
// message?} (the existing append path that adds it as paragraphs at the end of that note, guarded by the version it read). A family target
// (target.family) always saves through target.save (a new family note too: kept out of AI material), and has no [📎 첨부]·사진·파일.
export function openNoteWindow({text = '', title = '새 노트', rt = window.KPTURuntime, upload = null, noteFolder = null, target = null, onClose = () => {}} = {}) {
  const owner = rt.session.read()?.user?.id;
  let own = upload ? null : createUploadBatch(), saved = null, busy = false, handle = null;
  const media = waitingMedia();
  const batch = () => upload ? upload.getBatch() : own;
  const say = message => handle?.say(message);
  const head = titleRow({folder: noteFolder, target});
  const family = !!target?.family, custom = () => !!target && (family || !target.isNew());
  // The title box's Enter goes on to the text (it is not a save).
  head.input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); handle?.editor?.focus(); } });
  const files = attachRow({id: 'edwNoteAttach', getBatch: batch, isBusy: () => busy || !!upload?.isBusy?.(), say: message => { upload?.onChange?.(); say(message); }});
  // 저장을 누른 뒤 글 안 사진·파일이 새 노트의 첨부로 올라가는 동안: 첨부 줄 위에 같은 올리는 줄(사진은 흐린 미리보기 위 막대).
  const waitingHost = document.createElement('div');
  files.node.prepend(waitingHost);
  const waitingRows = mountUploadRows(waitingHost, {has: job => media.has(job.file), preview: job => media.preview(job.file)});
  // 기존 노트 끝에 더할 때는 [📎 첨부] 줄을 숨긴다(첨부는 새 노트일 때만).
  const syncFoot = () => { files.node.hidden = custom(); };
  target?.watch(syncFoot); syncFoot();
  async function addTo({value, typed, heading}) {
    if (waitingSrcs(value).length) return {ok: false, message: '기존 노트에 더할 때는 사진·파일을 넣을 수 없어요. 새 노트로 저장해 주세요.'};
    if (!String(typed || '').trim() && !(family && target.isNew() && heading.trim())) return {ok: false, message: '더할 내용을 써 주세요.'};
    busy = true;
    try {
      const result = await target.save({value, text: typed, heading});
      saved = {kind: 'note', id: result?.noteId || '', folderName: result?.folderName || '', added: !target.isNew()};
      toast(result?.message || (target.isNew() ? '노트로 저장했어요.' : '노트 끝에 더했어요.'));
      return {ok: true};
    } catch (error) {
      return {ok: false, message: error?.message && /[가-힣]/.test(error.message) ? error.message : '저장하지 못했어요. 다시 눌러 주세요.'};
    } finally { busy = false; }
  }
  async function run({value, text: typed}) {
    if (rt.session.read()?.user?.id !== owner) return {ok: false, message: '로그인 정보가 바뀌었어요. 다시 열어 주세요.'};
    if (custom()) return addTo({value, typed, heading: head.input.value});
    const list = batch(), count = files.pending(), heading = head.input.value;
    if (count && (list.blocked || list.note_id)) return {ok: false, message: '앞선 업데이트의 첨부 저장 결과를 먼저 확인해 주세요.'};
    // NOTE-파일그림넣기: waiting pictures·files are made first without their cards (they go in after the upload, sendWaiting).
    const waits = waitingSrcs(value), bare = waits.length ? swapWaiting(value, {}) : value, letters = waits.length ? toPlain(bare) : typed;
    if (!letters.trim() && !heading.trim() && !count && !waits.length) return {ok: false, message: '제목이나 본문을 써 주세요.'};
    busy = true; files.picker.render();
    let warning = '';
    try {
      const first = media.file(waits[0])?.name || list.entries.find(entry => entry.kind !== 'success')?.file?.name;
      const note = await createNoteDoc({title: heading.trim() ? heading : noteTitleFromText(letters) || fileTitle(first), raw_text: letters, markdown: false, doc: letters.trim() || waits.length ? bare : null}, rt);
      saved = {kind: 'note', id: note.id};
      if (waits.length) warning = await sendWaiting(note, value, media, {rt, isCurrent: () => rt.session.read()?.user?.id === owner});
      void requestNoteAiTitle(note.id, {rt}); // NOTE-탐색기 ③: AI 요약 제목(서버가 정함, 기다리지 않음). 사진·파일 글 쓰기 뒤에(같은 노트를 두 번 고치지 않게).
      // NOTE-탐색기 후속 ⑤: 고른 폴더(폴더 나무 고르기 창, 폴더 id)에 넣는 일은 noteFolder.put(note-folder-pick.js, setNoteFolderRef 한 길)이 한다.
      if (noteFolder?.write && noteFolder.get?.() && noteFolder.put) {
        try { await noteFolder.put({id: note.id}); }
        catch { warning ||= `노트는 저장했지만 '${noteFolder.label()}' 폴더에 넣지 못했어요. 노트 ⋯의 [폴더로 옮기기]로 옮겨 주세요.`; }
      }
      if (count) {
        try { await uploadNoteFiles(note.id, list, {rt, isCurrent: () => rt.session.read()?.user?.id === owner, onChange: () => files.picker.render()}); }
        catch (error) { warning ||= `노트는 저장했지만 첨부를 올리지 못했어요. ${error?.message || ''} 노트를 열어 다시 붙여 주세요.`.replace(/\s+/g, ' '); }
        if (upload) upload.reset?.(); else own = createUploadBatch();
      }
    } catch (error) { return {ok: false, message: error?.message || '저장하지 못했어요. 다시 눌러 주세요.'}; }
    finally { busy = false; files.picker.render(); }
    toast(warning || '노트로 저장했어요.');
    return {ok: true};
  }
  handle = openEdWindow({title, text, draft: true, limit: NOTE_TEXT_MAX, head: head.row, foot: family ? null : files.node, shortcuts: true,
    dirty: () => (!head.input.hidden && !!head.input.value.trim()) || (!custom() && files.pending() > 0),
    photos: family ? null : media.photos, files: family ? null : media.files,
    placeholder: '노트 본문을 쓰세요', save: {aria: target ? '노트에 저장' : '새 노트로 저장', run},
    onClose: ({text: letters}) => { waitingRows.destroy(); media.clear(); noteFolder?.close?.(); target?.close?.(); onClose({saved, text: letters}); }});
  if (handle) { handle.paintFolder = head.paint; queueMicrotask(() => head.input.focus()); }
  return handle;
}

// [큰 창에서 수정]: the note being edited, in the big window. value: the edit field's saved form now. upload: the edit's own photo/file path.
// title: the note's title (the title box sits above the text, as in the new-note window). folder: {label(), open(trigger), get(), watch(fn), close()}
// (note-folder-pick.js) with the note's folder now, shown as [폴더 ▾] right of the title box.
// save(value, text, {title, folder}) → Promise<{ok, message}> is the note screen's own save (it keeps the window open: keepOpen); it writes the title
// with the text and the folder when it changed. attach: {getBatch, isBusy} for [📎 첨부] (files saved with the text). onClose({value, saved, changed}).
export function openNoteEditWindow({value, photos, files: edFiles = null, save, title = '', folder = null, attach = null, onClose = () => {}} = {}) {
  let handle = null, savedTitle = title, savedFolder = folder?.get?.() || null;
  const head = titleRow({value: title, folder, placeholder: '제목'});
  head.input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); handle?.editor?.focus(); } });
  const files = attach ? attachRow({id: 'edwNoteEditAttach', getBatch: attach.getBatch, isBusy: attach.isBusy, say: message => handle?.say(message)}) : null;
  const extra = () => ({title: head.input.value, folder: folder ? (folder.get() || null) : undefined});
  handle = openEdWindow({title: '큰 창에서 수정', doc: value, keepOpen: true, limit: NOTE_TEXT_MAX, head: head.row, foot: files?.node || null, shortcuts: true, photos, files: edFiles,
    dirty: () => (files?.pending() || 0) > 0 || head.input.value !== savedTitle || (!!folder && (folder.get() || null) !== savedFolder), placeholder: '노트 본문을 쓰세요',
    save: {aria: '노트 저장', run: async ({value: next, text}) => {
      const sent = extra(), result = await save(next, text, sent);
      if (result?.ok) { savedTitle = sent.title; if (folder) savedFolder = sent.folder || null; }
      return result;
    }},
    onClose: result => { folder?.close?.(); onClose(result); }});
  if (handle && files) handle.renderFiles = () => files.picker.render();
  if (handle) { handle.paintFolder = head.paint; handle.title = () => head.input.value; }
  return handle;
}
