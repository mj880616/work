// S51-26 FAMILY-노트로(요청함 11/06 08:08, 명진 결정 08:26 '2', 시안 docs/design/mockups/family-forget-to-note.html):
// 홈 '잊지 말기' [노트로]의 작은 창(폰은 아래에서, PC는 가운데). 이 창의 유일한 renderer다.
// - 폴더: 처음엔 마지막으로 줄을 더한 '잊지 말기' 노트의 폴더(없으면 '가족' — 없으면 보낼 때 만든다). [📁 폴더 ▾]는 노트 화면과 같은 폴더 고르기 창.
// - 어디에: '잊지 말기' 노트에 한 줄 더하기(기본, 그 폴더의 '잊지 말기' 노트 — 없으면 그 폴더에 새로 만든다) 또는 새 노트.
// - 노트 줄은 체크 목록 한 줄('☐ 내용 (통화 11/5)', 줄 글자는 부른 쪽이 만들어 넘김). 했음은 노트에서 ☐ → ☑.
// - 노트는 기존 노트 저장 길(basket-data.js createNoteDoc·saveNoteDoc, app_notes 소유자 RLS)만 쓴다. AI 재료에서 뺀다(ai_export_allowed=false).
//   더하기는 읽은 판(updated_at)이 그대로일 때만 저장한다(다른 곳에서 고친 노트를 덮지 않음, 한 번 다시 읽어 다시 시도).
// - S51-30 [이미 함](markDone): 창 없이 처음 고르는 폴더(위와 같음)의 '잊지 말기' 노트에 체크된 줄('☑ 내용 (통화 11/5)') 하나를 더한다.
//   되돌리기(undoDone)는 그 노트에서 그 줄 하나만 뺀다(읽은 판일 때만). 할 일·일정은 만들지 않는다.
// - 보내기가 끝나야 onSent가 불린다(부른 쪽이 그 제안의 상태를 바꿈). 닫으면 아무것도 쓰지 않는다. 기기 저장 없음.
// 이 파일은 잊지 말기 표를 부르지 않는다(tests/security/family-notes-isolation.test.mjs).
import {readNoteFolders, createNoteFolder} from './note-folders-data.js';
import {openNoteFolderPicker} from './note-folder-pick.js';
import {iconNode} from './tree-icons.js';
import {createNoteDoc, saveNoteDoc} from './basket-data.js';
import {toPlain} from './ed-text.mjs';
import {cleanDoc} from './ed-schema.mjs';
import {plainToDocKeep} from './ed-markdown.mjs';
import {FAMILY_FOLDER, LIST_KEY, LIST_TITLE, appendLines, defaultFolder, dropLine, listNoteIn, newNoteTitle, nextTopOrder} from './family-note-send.mjs';

const ID = 'familyNoteSend';
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const enc = encodeURIComponent;
let state = null;

const wsOf = rt => rt.context?.read?.()?.workspace?.id || '';
// '잊지 말기' 노트들(고친 때 최근 순). 휴지통 노트는 서버 정책이 빼고 준다.
export async function readListNotes(rt) {
  const ws = wsOf(rt);
  if (!ws) return [];
  const rows = await rt.api(`/rest/v1/app_notes?workspace_id=eq.${enc(ws)}&kind=eq.note&metadata->>${LIST_KEY}=eq.true&select=id,updated_at,metadata&order=updated_at.desc&limit=20`, {singleFlight: false});
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

async function appendTo(rt, id, lines) {
  const ws = wsOf(rt);
  for (let tries = 0; tries < 2; tries++) {
    const rows = await rt.api(`/rest/v1/app_notes?id=eq.${enc(id)}&workspace_id=eq.${enc(ws)}&kind=eq.note&select=id,title,doc,raw_text,updated_at`, {singleFlight: false});
    const row = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
    if (!row?.updated_at) throw new Error('노트를 찾지 못했어요.');
    const base = cleanDoc(row.doc) || plainToDocKeep(row.raw_text || '');
    const doc = appendLines(base, lines);
    try {
      await saveNoteDoc(id, {title: String(row.title || '').trim() || LIST_TITLE, raw_text: toPlain(doc), doc, version: row.updated_at}, rt);
      return;
    } catch (error) {
      if (error?.code !== 'note_changed' || tries) throw error;
    }
  }
}
// 줄 하나를 노트로. 반환 {noteId, folderName}. 실패하면 던진다(부른 쪽은 상태를 바꾸지 않음).
export async function sendLine(rt, {line, body, where, folder, create, lists, folders = []}) {
  let target = folder || null;
  if (!target && create) {
    const folders = await readNoteFolders(rt);
    target = folders.ready ? (folders.folders.find(f => !f.parent_id && f.name === FAMILY_FOLDER)
      || await createNoteFolder({name: FAMILY_FOLDER, parent_id: null, sort_order: nextTopOrder(folders.folders)}, rt)) : null;
  }
  const folderRef = target ? {id: target.id, name: target.name} : undefined;
  if (where === 'list') {
    const list = listNoteIn(lists, target?.id || null, target && !folders.some(f => f.id === target.id) ? [...folders, target] : folders);
    if (list) { await appendTo(rt, list.id, [line]); return {noteId: list.id, folderName: target?.name || ''}; }
  }
  const doc = appendLines(null, [line]);
  const saved = await createNoteDoc({title: where === 'list' ? LIST_TITLE : newNoteTitle(body), raw_text: toPlain(doc), doc, ai_export_allowed: false,
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

function install() {
  let el = document.getElementById(ID);
  if (!el) {
    el = document.createElement('div');
    el.id = ID; el.className = 'modal family-send hidden';
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-hidden', 'true'); el.setAttribute('aria-labelledby', `${ID}Title`);
    el.innerHTML = `<div class="modal-card family-send-card"><div class="family-send-head"><h2 id="${ID}Title">노트로 보내기</h2><button type="button" class="icon-btn" data-fs-close aria-label="노트로 보내기 닫기">×</button></div>`
      + '<p class="family-send-line" data-fs-line></p>'
      + '<div class="family-send-row"><span class="family-send-label">폴더</span><button type="button" class="secondary family-send-folder" data-fs-folder aria-haspopup="dialog"></button></div>'
      + '<div class="family-send-row" role="group" aria-label="어디에"><span class="family-send-label">어디에</span><span class="family-send-where"><button type="button" class="secondary" data-fs-where="list"></button><button type="button" class="secondary" data-fs-where="new">새 노트</button></span></div>'
      + '<p class="family-send-status" data-fs-status role="status" aria-live="polite"></p>'
      + '<div class="family-send-foot"><button type="button" class="secondary" data-fs-close>취소</button><button type="button" class="primary" data-fs-send>보내기</button></div></div>';
    el.addEventListener('click', onClick);
    el.addEventListener('keydown', onKey);
    // 폰 뒤로가기(mobile-modal-history.js)가 창을 바로 숨기면 여기서 마무리한다.
    new MutationObserver(() => { if (state && el.classList.contains('hidden')) finish(); }).observe(el, {attributes: true, attributeFilter: ['class']});
  }
  if (!el.isConnected || el.nextElementSibling) document.body.append(el);
  return el;
}
function paint() {
  const el = document.getElementById(ID), s = state;
  if (!el || !s) return;
  el.querySelector('[data-fs-line]').textContent = s.line;
  const folderName = s.folder?.name || (s.create ? FAMILY_FOLDER : '폴더 없음');
  const fb = el.querySelector('[data-fs-folder]');
  fb.replaceChildren(iconNode('folder'), ` ${folderName} ▾`); // S51-25: 그림 문자 📁 대신 공용 그림 fb.setAttribute('aria-label', `폴더: ${folderName}, 바꾸기`); fb.disabled = s.busy || !s.loaded;
  const listBtn = el.querySelector('[data-fs-where="list"]');
  listBtn.textContent = `'${LIST_TITLE}' 노트에 한 줄 더하기`;
  for (const b of el.querySelectorAll('[data-fs-where]')) { b.setAttribute('aria-pressed', String(b.dataset.fsWhere === s.where)); b.disabled = s.busy; }
  const send = el.querySelector('[data-fs-send]');
  send.disabled = s.busy || !s.loaded; send.textContent = s.busy ? '보내는 중…' : '보내기';
  el.querySelector('[data-fs-status]').textContent = s.status;
}
// line: 노트에 넣을 한 줄, body: 그 줄 내용([새 노트] 제목). onSent({noteId, folderName}) → 부른 쪽이 상태를 바꾼다.
export async function openFamilyNoteSend({rt = window.KPTURuntime, line, body, trigger = null, onSent}) {
  const el = install();
  if (state) finish({focus: false});
  const mine = state = {rt, line, body, trigger, onSent, where: 'list', folder: null, create: false, folders: [], ready: false, lists: [], loaded: false, busy: false, status: ''};
  el.classList.remove('hidden'); el.setAttribute('aria-hidden', 'false');
  paint();
  el.querySelector('[data-fs-send]').focus({preventScroll: true});
  try {
    const [folders, lists] = await Promise.all([readNoteFolders(rt), readListNotes(rt).catch(() => [])]);
    if (state !== mine) return;
    const pick = defaultFolder(lists, folders.ready ? folders.folders : [], folders.ready);
    Object.assign(mine, {folders: folders.ready ? folders.folders : [], ready: folders.ready, lists, folder: pick.folder, create: pick.create, loaded: true});
  } catch {
    if (state !== mine) return;
    Object.assign(mine, {loaded: true, status: '폴더를 읽지 못했어요. 폴더 밖으로 보내요.'});
  }
  paint();
}
function finish({focus = true} = {}) {
  const el = document.getElementById(ID), s = state;
  state = null;
  if (!el || !s) return;
  el.classList.add('hidden'); el.setAttribute('aria-hidden', 'true');
  if (focus && s.trigger?.isConnected) s.trigger.focus({preventScroll: true});
}
function close() { if (!state?.busy) finish(); }
async function send() {
  const s = state;
  if (!s || s.busy || !s.loaded) return;
  s.busy = true; s.status = ''; paint();
  try {
    const result = await sendLine(s.rt, {line: s.line, body: s.body, where: s.where, folder: s.folder, create: s.create, lists: s.lists, folders: s.folders});
    if (state !== s) return;
    s.busy = false;
    finish();
    s.onSent?.(result);
  } catch (error) {
    if (state !== s) return;
    s.busy = false; s.status = error?.message && /[가-힣]/.test(error.message) ? error.message : '노트로 보내지 못했어요. 다시 눌러 주세요.'; paint();
  }
}
function onClick(event) {
  const el = event.currentTarget, s = state;
  if (!s) return;
  if (event.target === el || event.target.closest('[data-fs-close]')) { close(); return; }
  const where = event.target.closest('[data-fs-where]');
  if (where && !where.disabled) { s.where = where.dataset.fsWhere; paint(); return; }
  const folder = event.target.closest('[data-fs-folder]');
  if (folder && !folder.disabled) {
    openNoteFolderPicker({anchor: folder, folders: s.folders, onPick: f => { if (state !== s) return; s.folder = f; s.create = false; paint(); folder.focus({preventScroll: true}); }});
    return;
  }
  if (event.target.closest('[data-fs-send]')) void send();
}
function onKey(event) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
  if (event.key !== 'Tab') return;
  const items = [...event.currentTarget.querySelectorAll('button:not([disabled])')].filter(b => b.getClientRects().length);
  if (!items.length) return;
  const first = items[0], last = items[items.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
window.addEventListener('kptu:view-changed', () => { if (state && !state.busy) finish({focus: false}); });
window.addEventListener('kptu:session-changed', () => { if (state) finish({focus: false}); });
