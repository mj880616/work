// ED③ 노트 화면: the note's big window in the new editor (ed-window.js), for a new note ([크게] on the note input, PC top line [+ 추가] →
// [노트]) and for [큰 창에서 수정]. The window saves nothing itself: the save goes to the existing owner-RLS note paths
// (createNoteDoc, or the note screen's own save for an edit).
//   New note: a title row (title box + optional [폴더 ▾]) above the text, [📎 첨부] under it (the note input's own file batch or this
//   window's), [넣기] → [사진]·[파일] (NOTE-파일그림넣기: they wait in this window until the save, then go up as the new note's own
//   attachments and stay in the text: note-pending-media.mjs), and the markdown line shortcuts.
//   There is no [업데이트 | 노트] switch here: an update is written from the update input (차이 — PR 본문).
//   NOTE-주소로 가져오기: under the title row, an address row [주소 | 가져오기] (importRow). It makes an address-only note at once and reads the
//   page in the background (note-import.js); it is not this window's save.
import {holdToast as kptuHoldToast} from './small-notice.js'; // UI-작은알림자리: #toast도 위쪽·2초·올려 두면 멈춤(시계 하나)
import {openEdWindow} from './ed-window.js';
import {createNoteDoc, noteTitleFromText, readNoteDoc, saveNoteDoc} from './basket-data.js';
import {createUploadBatch, mountBasketPicker, fileTitle, sendNoteBehind} from './basket-upload.js';
import {NOTE_TEXT_MAX} from './note-doc.mjs';
import {requestNoteAiTitle} from './note-ai-title.js';
import {WAIT_PREFIX, waitingSrcs, swapWaiting} from './note-pending-media.mjs';
import {toPlain} from './ed-text.mjs';
import {mountUploadRows} from './upload-progress.js'; // UI-올리기진행표시: 저장 뒤 올라가는 글 안 사진·파일의 막대 + %
import {iconNode} from './tree-icons.js';
import {readImportUrl} from './note-import-model.mjs'; // NOTE-주소로 가져오기: 주소 칸 앞 확인(읽기·저장은 note-import.js가 뒤에서)

export function toast(message) {
  const box = document.querySelector('#toast'); if (!box) return;
  box.textContent = message; kptuHoldToast(box);
}
// [📎 첨부] row under the text: the basket picker part on a file batch. Returns {node, picker, pending(), sent}.
// going(job): UX-먼저묻고뒤에처리 — files already saved and now going up behind the screen for this row's note or update
// (the shared upload rows: bar · % · ✕, a failure with [다시]); the chosen-file list above shows only what is not saved yet.
export function attachRow({id, getBatch, isBusy, say, going = null}) {
  const node = document.createElement('div'), pickerHost = document.createElement('div'), files = document.createElement('div');
  node.dataset.edwAttach = ''; files.dataset.edwAttachFiles = '';
  node.append(pickerHost, files);
  let sent = null;
  if (going) { const host = document.createElement('div'); host.dataset.edwAttachSent = ''; node.append(host); sent = mountUploadRows(host, {has: going}); }
  const picker = mountBasketPicker(pickerHost, {id, filesHost: files, dropTarget: node, getBatch, isBusy, onChange: () => say(''), onError: say});
  return {node, picker, sent, pending: () => getBatch().entries.filter(entry => entry.kind !== 'success').length};
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

// NOTE-주소로 가져오기 2단계(안 A, 시안 docs/design/mockups/note-import-by-url.html): 새 노트 창 제목 줄 아래 주소 칸 [주소 | 가져오기].
// 이 줄은 모양만 만든다: 누르면 run(주소 글자)를 부른다. 주소 칸의 Enter도 [가져오기]다(저장이 아님).
function importRow({run}) {
  const node = document.createElement('div'); node.className = 'edw-import-row'; node.dataset.edwImport = '';
  const label = document.createElement('label'); label.className = 'a11y-only'; label.htmlFor = 'edwNoteUrl'; label.textContent = '가져올 글의 주소';
  const input = document.createElement('input');
  input.id = 'edwNoteUrl'; input.type = 'url'; input.inputMode = 'url'; input.autocomplete = 'off'; input.autocapitalize = 'off'; input.spellcheck = false;
  input.dataset.edwUrl = ''; input.dataset.enterField = 'off'; input.placeholder = '주소를 넣으면 글을 가져와요 (https://…)'; input.setAttribute('enterkeyhint', 'go');
  const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary'; button.dataset.edwImportRun = ''; button.textContent = '가져오기';
  node.append(iconNode('link', {size: 16}), label, input, button);
  button.addEventListener('click', () => run());
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); run(); } });
  return {node, input, button};
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
// BIZ-저장먼저닫기 2차(S59-8): after the new note is made, its waiting pictures·files (in the text's order) and the [📎 첨부] files go up behind
// the screen as one batch on the note's line (basket-upload.js sendNoteBehind) — the window is already closed. Each waiting file that went up has
// its id swapped into the text, and the text is written once more after the uploads — only while the note's letters are still the ones this save
// wrote (an edit made meanwhile is never overwritten; the files then stay under the note). A file that did not go up leaves the text without it
// and the bottom line offers [다시 올리기]; a later success puts it back in its place the same way. Returns true when something was sent.
export function sendNewNoteFiles(note, {value, letters, media, waits, files = [], rt = window.KPTURuntime, aiTitle = false}) {
  const batch = createUploadBatch(note.id, note.attachments || []), placed = new Map(), swap = {};
  let lost = 0;
  for (const src of waits) {
    const file = media.file(src);
    if (!file) { lost++; continue; }
    const entry = {file, kind: 'pending', label: '대기'};
    placed.set(entry, src); batch.entries.push(entry);
  }
  batch.entries.push(...files);
  if (!batch.entries.length) { if (aiTitle) void requestNoteAiTitle(note.id, {rt}); return false; }
  // Which attachment each waiting file became: the upload adds one attachment per file, in order.
  const known = new Set(batch.attachments.map(f => f?.drive_file_id)), seen = new Set();
  const onChange = () => {
    const fresh = (batch.attachments || []).filter(f => f?.drive_file_id && !known.has(f.drive_file_id));
    for (const entry of batch.entries) {
      if (entry.kind !== 'success' || seen.has(entry)) continue;
      seen.add(entry);
      const made = fresh.shift(); if (!made) continue;
      known.add(made.drive_file_id);
      if (placed.has(entry)) swap[placed.get(entry)] = 'drive:' + made.drive_file_id;
    }
  };
  let written = letters, titled = !aiTitle;
  const finish = placed.size ? async () => {
    if (!Object.keys(swap).length) return '';
    const doc = swapWaiting(value, swap);
    try {
      const row = await readNoteDoc(note.id, rt);
      if (!row || row.raw_text !== written) throw new Error('note_changed');
      await saveNoteDoc(note.id, {title: row.title, raw_text: toPlain(doc), doc, version: row.updated_at}, rt);
      written = toPlain(doc);
      return lost ? `글 안 사진·파일 ${lost}개는 넣지 못했어요.` : '';
    } catch {
      return '글 안 자리를 맞추지 못했어요. 사진·파일은 노트 아래에 있어요.';
    }
  } : null;
  void sendNoteBehind(note.id, batch, {rt, onChange, finish, textChanged: () => written !== letters,
    done: () => { if (!titled) { titled = true; void requestNoteAiTitle(note.id, {rt}); } }});
  return true;
}

// 새 노트를 만든 뒤 할 일 하나(큰 창 run과 FORGET-노트작은창 작은 창이 같은 길): AI 요약 제목(서버가 정함, 기다리지 않음) + 고른 폴더에 넣기.
// NOTE-탐색기 후속 ⑤: 폴더에 넣는 일은 noteFolder.put(note-folder-pick.js, setNoteFolderRef 한 길)이 한다. 반환: '' 또는 알림 글.
// aiTitle: false면 AI 요약 제목은 부른 곳이 나중에 부른다(BIZ-저장먼저닫기 2차 — 글 속 사진·파일이 뒤에서 올라가 자리를 맞춘 뒤).
export async function finishNewNote(note, {rt = window.KPTURuntime, noteFolder = null, aiTitle = true} = {}) {
  if (aiTitle) void requestNoteAiTitle(note.id, {rt}); // NOTE-탐색기 ③: 사진·파일 글 쓰기 뒤에 불러(같은 노트를 두 번 고치지 않게).
  if (noteFolder?.write && noteFolder.get?.() && noteFolder.put) {
    try { await noteFolder.put({id: note.id}); }
    catch { return `노트는 저장했지만 '${noteFolder.label()}' 폴더에 넣지 못했어요. 노트 ⋯의 [폴더로 옮기기]로 옮겨 주세요.`; }
  }
  return '';
}
// A new note. text: the note input's letters (kept as written). upload: the note input's own batch {getBatch, isBusy, onChange, reset}
// (optional). noteFolder: {label(), open(trigger)} (optional; note-folder-pick.js, or the note screen's own). With write:true and get() the window
// puts the new note into the chosen folder itself after the save (noteFolder.put: the same setNoteFolderRef write as the note screen); without it the opener does.
// onClose({saved, text}) — saved = {kind:'note', id} after a save (FORGET-노트고르기: + folderName, added = 기존 노트 끝에 더함).
// NOTE-주소로 가져오기: saved.imported = true — [가져오기]로 만든 노트(폴더는 만들 때 이미 넣었다. 글은 뒤에서 채워진다).
// FORGET-노트고르기 target (note-pick.js createNoteTarget, optional): [새 노트 ▾] in front of the title row. When an existing note (or the family
// '잊지 말기' note) is chosen, [저장] does not make a new note: it hands the written text to target.save({value, text, heading}) → {noteId, folderName,
// message?} (the existing append path that adds it as paragraphs at the end of that note, guarded by the version it read). A family target
// (target.family) always saves through target.save (a new family note too: kept out of AI material), and has no [📎 첨부]·사진·파일.
// NOTE-목록에파일놓기: dropped = files dropped on the note list (they go into this window's own batch through the same picker add as [📎 첨부]:
// the same size limit and the same-file question), heading = the title box's first value; the cursor then starts in the text.
export function openNoteWindow({text = '', title = '새 노트', rt = window.KPTURuntime, upload = null, noteFolder = null, target = null, dropped = null, heading: firstHeading = '', onClose = () => {}} = {}) {
  const owner = rt.session.read()?.user?.id;
  let own = upload ? null : createUploadBatch(), saved = null, busy = false, handle = null;
  const media = waitingMedia();
  const batch = () => upload ? upload.getBatch() : own;
  const say = message => handle?.say(message);
  const head = titleRow({value: firstHeading, folder: noteFolder, target});
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
  // NOTE-주소로 가져오기: 주소 칸은 '새 노트만 쓰는 창'에만 둔다([새 노트 ▾]로 기존 노트·가족 노트를 고르는 창에는 없다).
  // [가져오기] = '주소만' 든 노트를 바로 만들고 글은 뒤에서 읽는다(note-import.js). 이 창에 쓰던 글이 없으면 창을 닫아 목록의 새 줄을 보이고,
  // 쓰던 글·제목·첨부가 있으면 창은 그대로 둔다(가져온 글은 따로 노트 하나 — 쓰던 글은 건드리지 않는다). 처리 중에 또 눌러도 줄 세운다.
  async function runImport() {
    if (rt.session.read()?.user?.id !== owner) { say('로그인 정보가 바뀌었어요. 다시 열어 주세요.'); return; }
    const typed = urlRow.input.value, checked = readImportUrl(typed);
    if (!checked.ok) { say(checked.message); urlRow.input.focus(); return; }
    urlRow.input.value = ''; say('');
    try {
      const {startNoteImport} = await import('./note-import.js');
      const folderId = noteFolder?.get?.() || null;
      const note = await startNoteImport({url: checked.url, folder: folderId ? {id: folderId, name: noteFolder.label()} : null, rt});
      if (!handle || handle.closed) return;
      if (handle.changed) { say('가져오는 중이에요. 끝나면 알려 드릴게요. 쓰던 글은 그대로예요.'); return; }
      saved = {kind: 'note', id: note.id, imported: true};
      handle.close();
    } catch (error) {
      if (handle?.closed) return;
      if (!urlRow.input.value) urlRow.input.value = typed;
      say(error?.message && /[가-힣]/.test(error.message) ? error.message : '가져오기를 시작하지 못했어요. 다시 눌러 주세요.');
    }
  }
  const urlRow = target ? null : importRow({run: () => void runImport()});
  const headNode = urlRow ? document.createElement('div') : head.row;
  if (urlRow) { headNode.className = 'edw-head-wrap'; headNode.append(head.row, urlRow.node); }
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
    // NOTE-파일그림넣기: waiting pictures·files are made first without their cards (they go in after the upload, sendNewNoteFiles).
    const waits = waitingSrcs(value), bare = waits.length ? swapWaiting(value, {}) : value, letters = waits.length ? toPlain(bare) : typed;
    if (!letters.trim() && !heading.trim() && !count && !waits.length) return {ok: false, message: '제목이나 본문을 써 주세요.'};
    busy = true; files.picker.render();
    let warning = '', sending = false;
    try {
      const first = media.file(waits[0])?.name || list.entries.find(entry => entry.kind !== 'success')?.file?.name;
      const note = await createNoteDoc({title: heading.trim() ? heading : noteTitleFromText(letters) || fileTitle(first), raw_text: letters, markdown: false, doc: letters.trim() || waits.length ? bare : null}, rt);
      saved = {kind: 'note', id: note.id};
      // BIZ-저장먼저닫기 2차(S59-8): 글이 저장되면 폴더에 넣고 창을 닫는다. 글 속 사진·파일과 [📎 첨부]는 그 노트의 뒤 줄에서 끝까지 올라간다(화면을 옮겨도).
      // 글 저장이 실패하면(위 createNoteDoc) 창은 닫히지 않고 아무것도 보내지 않는다.
      warning = await finishNewNote(note, {rt, noteFolder, aiTitle: !waits.length});
      sending = sendNewNoteFiles(note, {value, letters, media, waits, files: list.entries.filter(entry => entry.kind !== 'success'), rt, aiTitle: !!waits.length});
      if (count) { if (upload) upload.reset?.(); else own = createUploadBatch(); }
    } catch (error) { return {ok: false, message: error?.message || '저장하지 못했어요. 다시 눌러 주세요.'}; }
    finally { busy = false; files.picker.render(); }
    // UX-알림하나로(S59-21): 사진·파일을 올리는 진행·끝은 하단바 위 한 줄 하나가 말한다(저장 알림에 '올리는 중'을 또 쓰지 않는다).
    toast(warning || '노트로 저장했어요.');
    return {ok: true};
  }
  handle = openEdWindow({title, text, draft: true, limit: NOTE_TEXT_MAX, head: headNode, foot: family ? null : files.node, shortcuts: true,
    dirty: () => (!head.input.hidden && !!head.input.value.trim()) || (!custom() && files.pending() > 0),
    photos: family ? null : media.photos, files: family ? null : media.files,
    placeholder: '노트 본문을 쓰세요', save: {aria: target ? '노트에 저장' : '새 노트로 저장', run},
    onClose: ({text: letters}) => { waitingRows.destroy(); media.clear(); noteFolder?.close?.(); target?.close?.(); onClose({saved, text: letters}); }});
  if (handle) {
    handle.paintFolder = head.paint;
    if (dropped?.length) { files.picker.add(dropped); void handle.ready?.then(h => { if (h && !h.closed) h.editor?.focus(); }); }
    else queueMicrotask(() => head.input.focus());
  }
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
  const files = attach ? attachRow({id: 'edwNoteEditAttach', getBatch: attach.getBatch, isBusy: attach.isBusy, going: attach.going || null, say: message => handle?.say(message)}) : null;
  const extra = () => ({title: head.input.value, folder: folder ? (folder.get() || null) : undefined});
  handle = openEdWindow({title: '큰 창에서 수정', doc: value, keepOpen: true, limit: NOTE_TEXT_MAX, head: head.row, foot: files?.node || null, shortcuts: true, photos, files: edFiles,
    dirty: () => (files?.pending() || 0) > 0 || head.input.value !== savedTitle || (!!folder && (folder.get() || null) !== savedFolder), placeholder: '노트 본문을 쓰세요',
    save: {aria: '노트 저장', run: async ({value: next, text}) => {
      const sent = extra(), result = await save(next, text, sent);
      if (result?.ok) { savedTitle = sent.title; if (folder) savedFolder = sent.folder || null; }
      return result;
    }},
    onClose: result => { folder?.close?.(); files?.sent?.destroy(); onClose(result); }});
  if (handle && files) handle.renderFiles = () => files.picker.render();
  if (handle) { handle.paintFolder = head.paint; handle.title = () => head.input.value; }
  return handle;
}
