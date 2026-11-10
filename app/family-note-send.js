// S51-26 FAMILY-노트로(요청함 11/06 08:08, 명진 결정 08:26 '2', 시안 docs/design/mockups/family-forget-to-note.html) →
// FORGET-노트고르기(요청함 11/09 13:34, 시안 docs/design/mockups/forget-note-pick.html, 명진 13:37·13:38 결정): 잊지 말기 가족 줄 [노트]도
// 업무 줄과 같은 노트 창(note-window.js openNoteWindow + note-pick.js [새 노트 ▾])으로 연다. 옛 작은 '노트로 보내기' 창은 없앴다.
// - 처음 고른 곳: '잊지 말기' 노트 끝에 더하기. 폴더는 마지막으로 줄을 더한 '잊지 말기' 노트의 폴더(없으면 '가족' — 없으면 보낼 때 만든다).
//   [폴더 ▾]는 노트 화면과 같은 폴더 고르기 창. [저장] 한 번이면 지금과 같다(그 폴더의 '잊지 말기' 노트 — 없으면 그 폴더에 새로 만든다).
// - [잊지 말기 ▾]로 다른 가족 노트(AI가 읽지 않는 노트, ai_export_allowed=false)나 새 노트를 고를 수 있다. 고를 수 있는 노트는 가족 노트뿐이고,
//   저장 함수(note-append.js appendToNote familyOnly — 옛 appendTo를 옮긴 같은 길)도 읽은 노트가 가족 노트인지 다시 보고, PATCH도 ai_export_allowed=false인 행에만 쓴다(saveNoteDoc aiExcluded).
// - 노트 줄은 체크 목록 한 줄('☐ 내용 (통화 11/5)', 줄 글자는 부른 쪽이 만들어 넘김, 창에서 고칠 수 있음). 했음은 노트에서 ☐ → ☑.
// - 노트는 기존 노트 저장 길(basket-data.js createNoteDoc·saveNoteDoc, app_notes 소유자 RLS)만 쓴다. AI 재료에서 뺀다(ai_export_allowed=false).
//   더하기는 읽은 판(updated_at)이 그대로일 때만 저장한다(다른 곳에서 고친 노트를 덮지 않음, 한 번 다시 읽어 다시 시도).
// - S51-30 [이미 함](markDone): 창 없이 처음 고르는 폴더(위와 같음)의 '잊지 말기' 노트에 체크된 줄('☑ 내용 (통화 11/5)') 하나를 더한다.
//   되돌리기(undoDone)는 그 노트에서 그 줄 하나만 뺀다(읽은 판일 때만). 할 일·일정은 만들지 않는다.
// - 저장이 끝나야 onSent가 불린다(부른 쪽이 그 제안의 상태를 바꿈). 닫으면 아무것도 쓰지 않는다. 기기 저장 없음.
// 이 파일은 잊지 말기 표를 부르지 않는다(tests/security/family-notes-isolation.test.mjs).
import {readNoteFolders, createNoteFolder} from './note-folders-data.js';
import {openNoteFolderPicker} from './note-folder-pick.js';
import {createNoteDoc, saveNoteDoc} from './basket-data.js';
import {appendToNote} from './note-append.js';
export {appendToNote};
import {toPlain} from './ed-text.mjs';
import {cleanDoc} from './ed-schema.mjs';
import {plainToDocKeep} from './ed-markdown.mjs';
import {FAMILY_FOLDER, LIST_KEY, LIST_TITLE, appendDoc, appendLines, defaultFolder, dropLine, folderIdOf, listNoteIn, newNoteTitle, nextTopOrder} from './family-note-send.mjs';

const enc = encodeURIComponent;

const wsOf = rt => rt.context?.read?.()?.workspace?.id || '';
// '잊지 말기' 노트들(고친 때 최근 순). 휴지통 노트는 서버 정책이 빼고 준다.
export async function readListNotes(rt) {
  const ws = wsOf(rt);
  if (!ws) return [];
  const rows = await rt.api(`/rest/v1/app_notes?workspace_id=eq.${enc(ws)}&kind=eq.note&metadata->>${LIST_KEY}=eq.true&select=id,title,raw_text,updated_at,ai_export_allowed,metadata&order=updated_at.desc&limit=20`, {singleFlight: false});
  return Array.isArray(rows) ? rows : [];
}
// 홈 머리 줄 [노트 열기 ›]: 가장 최근 '잊지 말기' 노트, 없으면 노트 목록.
export async function openListNote(rt) {
  let id = '';
  try { id = (await readListNotes(rt))[0]?.id || ''; } catch { id = ''; }
  const tasks = await import('./basket-note-tasks.js');
  if (id) tasks.requestNoteDocOpen(id, rt); else tasks.requestBasketKind('note', rt);
  window.KPTURouter?.go?.('basket', {source: 'delegated'});
}

// 줄 하나를 노트로. 반환 {noteId, folderName}. 실패하면 던진다(부른 쪽은 상태를 바꾸지 않음).
// doc(FORGET-노트고르기): 노트 창에서 고친 글(저장된 모양) — 있으면 line 대신 그 글을 더한다. title: 새 노트 제목(비우면 줄 내용 앞 40자).
export async function sendLine(rt, {line, doc = null, title = '', body, where, folder, create, lists, folders = []}) {
  let target = folder || null;
  if (!target && create) {
    const folders = await readNoteFolders(rt);
    target = folders.ready ? (folders.folders.find(f => !f.parent_id && f.name === FAMILY_FOLDER)
      || await createNoteFolder({name: FAMILY_FOLDER, parent_id: null, sort_order: nextTopOrder(folders.folders)}, rt)) : null;
  }
  const folderRef = target ? {id: target.id, name: target.name} : undefined;
  if (where === 'list') {
    const list = listNoteIn(lists, target?.id || null, target && !folders.some(f => f.id === target.id) ? [...folders, target] : folders);
    if (list) { await appendToNote(rt, list.id, doc ? {doc} : {lines: [line]}); return {noteId: list.id, folderName: target?.name || ''}; }
  }
  const made = doc ? appendDoc(null, doc) : appendLines(null, [line]);
  if (!made) throw new Error('더할 내용을 써 주세요.');
  const saved = await createNoteDoc({title: where === 'list' ? LIST_TITLE : String(title || '').trim() || newNoteTitle(body), raw_text: toPlain(made), doc: made, ai_export_allowed: false,
    folder: folderRef, family_list: where === 'list'}, rt);
  return {noteId: saved?.id || '', folderName: target?.name || ''};
}

// S51-30 [이미 함]: 창 없이 '잊지 말기' 노트에 체크된 줄 하나. 반환 {noteId, folderName}. 실패하면 던진다(부른 쪽은 상태를 바꾸지 않음).
export async function markDone(rt, {line, body}) {
  const [folders, lists] = await Promise.all([readNoteFolders(rt).catch(() => ({ready: false, folders: []})), readListNotes(rt).catch(() => [])]);
  const list = folders.ready ? folders.folders : [];
  const pick = defaultFolder(lists, list, folders.ready);
  return sendLine(rt, {line, body, where: 'list', folder: pick.folder, create: pick.create, lists, folders: list});
}
// [이미 함] 되돌리기: 더한 줄 하나만 뺀다. 줄이 이미 없으면 아무것도 쓰지 않는다.
export async function undoDone(rt, {noteId, line}) {
  const ws = wsOf(rt);
  if (!noteId || !ws) return;
  for (let tries = 0; tries < 2; tries++) {
    const rows = await rt.api(`/rest/v1/app_notes?id=eq.${enc(noteId)}&workspace_id=eq.${enc(ws)}&kind=eq.note&select=id,title,doc,raw_text,updated_at`, {singleFlight: false});
    const row = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
    if (!row?.updated_at) return;
    const doc = dropLine(cleanDoc(row.doc) || plainToDocKeep(row.raw_text || ''), line);
    if (!doc) return;
    try {
      await saveNoteDoc(noteId, {title: String(row.title || '').trim() || LIST_TITLE, raw_text: toPlain(doc), doc, version: row.updated_at}, rt);
      return;
    } catch (error) {
      if (error?.code !== 'note_changed' || tries) throw error;
    }
  }
}

// 가족 줄 [노트]: 업무 줄과 같은 노트 창. 처음 고른 곳은 '잊지 말기' 노트 끝(지금 가족 창과 같은 기본값·폴더 기억).
// line: 노트에 넣을 한 줄, body: 그 줄 내용(새 노트 제목). onSent({noteId, folderName}) → 부른 쪽이 상태를 바꾼다.
export async function openFamilyNoteWindow({rt = window.KPTURuntime, line, body, onSent, anchor = null}) {
  const [{openNoteWindow}, {createNoteTarget}] = await Promise.all([import('./note-window.js'), import('./note-pick.js')]);
  const s = {folder: null, create: false, folders: [], lists: []};
  try {
    const [folders, lists] = await Promise.all([readNoteFolders(rt), readListNotes(rt).catch(() => [])]);
    const list = folders.ready ? folders.folders : [];
    const pick = defaultFolder(lists, list, folders.ready);
    Object.assign(s, {folders: list, lists, folder: pick.folder, create: pick.create});
  } catch { /* 폴더를 읽지 못하면 폴더 밖(옛 창과 같음) */ }
  const watchers = [];
  const tell = () => watchers.forEach(fn => fn());
  const folder = {
    get: () => s.folder?.id || null,
    label: () => s.folder?.name || (s.create ? FAMILY_FOLDER : '폴더 없음'),
    watch: fn => { watchers.push(fn); },
    open: trigger => openNoteFolderPicker({anchor: trigger, folders: s.folders, onPick: f => { s.folder = f; s.create = false; tell(); }}),
    close: () => {},
  };
  const listNote = () => listNoteIn(s.lists, s.folder?.id || null, s.folders);
  const target = createNoteTarget({rt, family: true, start: {kind: 'list'}, listNote, listTitle: LIST_TITLE,
    save: async (pick, {value, heading}) => {
      if (pick.kind === 'note') {
        await appendToNote(rt, pick.note.id, {doc: value});
        const id = folderIdOf(pick.note, s.folders);
        return {noteId: pick.note.id, folderName: s.folders.find(f => f.id === id)?.name || ''};
      }
      return sendLine(rt, {doc: value, title: heading, body, where: pick.kind === 'list' ? 'list' : 'new', folder: s.folder, create: s.create, lists: s.lists, folders: s.folders});
    }});
  folder.watch(() => target.paint());
  const args = {rt, text: line, title: '노트로 보내기', noteFolder: folder, target,
    onClose: ({saved}) => { if (saved) onSent?.({noteId: saved.id, folderName: saved.folderName}); }};
  // FORGET-노트작은창: 누른 줄 아래 작은 창이 먼저(note-quick.js), [크게 수정 ↗]로 큰 창. 누른 버튼이 없으면 큰 창.
  if (!anchor?.isConnected) return openNoteWindow(args);
  const rowKey = anchor.closest('[data-nbx-row]')?.dataset.nbxRow || '';
  const {openNoteQuick} = await import('./note-quick.js');
  // UI-잊지말기줄단추: 폰은 [노트로]가 줄 ⋯ 안에 있으므로, 다시 그린 뒤에는 보이는 [노트로], 없으면 그 줄의 ⋯ 옆에 둔다.
  const shown = el => el && el.getClientRects().length ? el : null;
  return openNoteQuick({...args, anchor, reanchor: () => {
    const row = rowKey ? [...document.querySelectorAll('[data-nbx-row]')].find(r => r.dataset.nbxRow === rowKey) : null;
    return shown(row?.querySelector('[data-nbx-act="note"]')) || shown(row?.querySelector('.nbx-more')) || null;
  }});
}
