// ED③ 노트 화면: the note's big window in the new editor (ed-window.js), for a new note ([크게] on the note input, PC top line [+ 추가] →
// [노트]) and for [큰 창에서 수정]. The window saves nothing itself: the save goes to the existing owner-RLS note paths
// (createNoteDoc, or the note screen's own save for an edit).
//   New note: a title row (title box + optional [폴더 ▾]) above the text, [📎 첨부] under it (the note input's own file batch or this
//   window's), the [사진] button (a photo needs a saved note, so a new note says "먼저 저장"), and the markdown line shortcuts.
//   There is no [업데이트 | 노트] switch here: an update is written from the update input (차이 — PR 본문).
import {openEdWindow} from './ed-window.js';
import {createNoteDoc, noteTitleFromText} from './basket-data.js';
import {createUploadBatch, uploadNoteFiles, mountBasketPicker, fileTitle} from './basket-upload.js';
import {notePhotos} from './note-body.js';
import {NOTE_TEXT_MAX} from './note-doc.mjs';

function toast(message) {
  const box = document.querySelector('#toast'); if (!box) return;
  box.textContent = message; box.classList.remove('hidden'); clearTimeout(toast.timer); toast.timer = setTimeout(() => box.classList.add('hidden'), 3200);
}
// [📎 첨부] row under the text: the basket picker part on a file batch. Returns {node, picker, pending()}.
export function attachRow({id, getBatch, isBusy, say}) {
  const node = document.createElement('div'), pickerHost = document.createElement('div'), files = document.createElement('div');
  node.dataset.edwAttach = ''; files.dataset.edwAttachFiles = '';
  node.append(pickerHost, files);
  const picker = mountBasketPicker(pickerHost, {id, filesHost: files, dropTarget: node, getBatch, isBusy, onChange: () => say(''), onError: say});
  return {node, picker, pending: () => getBatch().entries.filter(entry => entry.kind !== 'success').length};
}
function titleRow({value = '', folder = null}) {
  const row = document.createElement('div'); row.className = 'edw-title-row';
  const label = document.createElement('label'); label.className = 'a11y-only'; label.htmlFor = 'edwNoteTitle'; label.textContent = '노트 제목';
  const input = document.createElement('input');
  input.id = 'edwNoteTitle'; input.type = 'text'; input.autocomplete = 'off'; input.dataset.edwTitle = ''; input.value = value;
  input.placeholder = '노트 제목(비우면 본문 첫 줄)'; input.setAttribute('enterkeyhint', 'next'); input.dataset.enterField = 'off';
  row.append(label, input);
  let button = null;
  if (folder) {
    button = document.createElement('button'); button.type = 'button'; button.dataset.edwFolder = ''; button.setAttribute('aria-haspopup', 'dialog');
    button.addEventListener('click', () => folder.open(button));
    row.append(button);
  }
  const paint = () => { if (button) { const name = folder.label?.() || '폴더 없음'; button.textContent = name + ' ▾'; button.title = '노트를 넣을 폴더: ' + name; } };
  paint();
  return {row, input, paint};
}

// A new note. text: the note input's letters (kept as written). upload: the note input's own batch {getBatch, isBusy, onChange, reset}
// (optional). noteFolder: {label(), open(trigger)} (optional). onClose({saved, text}) — saved = {kind:'note', id} after a save.
export function openNoteWindow({text = '', title = '새 노트', rt = window.KPTURuntime, upload = null, noteFolder = null, onClose = () => {}} = {}) {
  const owner = rt.session.read()?.user?.id;
  let own = upload ? null : createUploadBatch(), saved = null, busy = false, handle = null;
  const batch = () => upload ? upload.getBatch() : own;
  const say = message => handle?.say(message);
  const head = titleRow({folder: noteFolder});
  // The title box's Enter goes on to the text (it is not a save).
  head.input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); handle?.editor?.focus(); } });
  const files = attachRow({id: 'edwNoteAttach', getBatch: batch, isBusy: () => busy || !!upload?.isBusy?.(), say: message => { upload?.onChange?.(); say(message); }});
  async function run({value, text: letters}) {
    if (rt.session.read()?.user?.id !== owner) return {ok: false, message: '로그인 정보가 바뀌었어요. 다시 열어 주세요.'};
    const list = batch(), count = files.pending(), heading = head.input.value;
    if (count && (list.blocked || list.note_id)) return {ok: false, message: '앞선 업데이트의 첨부 저장 결과를 먼저 확인해 주세요.'};
    if (!letters.trim() && !heading.trim() && !count) return {ok: false, message: '제목이나 본문을 써 주세요.'};
    busy = true; files.picker.render();
    let warning = '';
    try {
      const first = list.entries.find(entry => entry.kind !== 'success')?.file?.name;
      const note = await createNoteDoc({title: heading.trim() ? heading : noteTitleFromText(letters) || fileTitle(first), raw_text: letters, markdown: false, doc: letters.trim() ? value : null}, rt);
      saved = {kind: 'note', id: note.id};
      if (count) {
        try { await uploadNoteFiles(note.id, list, {rt, isCurrent: () => rt.session.read()?.user?.id === owner, onChange: () => files.picker.render()}); }
        catch (error) { warning = `노트는 저장했지만 첨부를 올리지 못했어요. ${error?.message || ''} 노트를 열어 다시 붙여 주세요.`.replace(/\s+/g, ' '); }
        if (upload) upload.reset?.(); else own = createUploadBatch();
      }
    } catch (error) { return {ok: false, message: error?.message || '저장하지 못했어요. 다시 눌러 주세요.'}; }
    finally { busy = false; files.picker.render(); }
    toast(warning || '노트로 저장했어요.');
    return {ok: true};
  }
  handle = openEdWindow({title, text, draft: true, limit: NOTE_TEXT_MAX, head: head.row, foot: files.node, shortcuts: true,
    dirty: () => !!head.input.value.trim() || files.pending() > 0,
    photos: notePhotos({getNote: () => null, upload: async () => [], rt}),
    placeholder: '노트 본문을 쓰세요', save: {aria: '새 노트로 저장', run},
    onClose: ({text: letters}) => onClose({saved, text: letters})});
  if (handle) { handle.paintFolder = head.paint; queueMicrotask(() => head.input.focus()); }
  return handle;
}

// [큰 창에서 수정]: the note being edited, in the big window. value: the edit field's saved form now. upload: the edit's own photo/file path.
// save(value, text) → Promise<{ok, message}> is the note screen's own save (it keeps the window open: keepOpen).
// attach: {getBatch, isBusy} for [📎 첨부] (files saved with the text). onClose({value, saved, changed}).
export function openNoteEditWindow({value, photos, save, attach = null, onClose = () => {}} = {}) {
  let handle = null;
  const files = attach ? attachRow({id: 'edwNoteEditAttach', getBatch: attach.getBatch, isBusy: attach.isBusy, say: message => handle?.say(message)}) : null;
  handle = openEdWindow({title: '큰 창에서 수정', doc: value, keepOpen: true, limit: NOTE_TEXT_MAX, foot: files?.node || null, shortcuts: true, photos,
    dirty: () => (files?.pending() || 0) > 0, placeholder: '노트 본문을 쓰세요',
    save: {aria: '노트 저장', run: ({value: next, text}) => save(next, text)},
    onClose});
  if (handle && files) handle.renderFiles = () => files.picker.render();
  return handle;
}
