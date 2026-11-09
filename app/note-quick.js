// FORGET-노트작은창(요청함 11/09 21:39, 시안 docs/design/mockups/forget-note-small.html, 명진 21:42 'ㅇㅇ'): 잊지 말기 [노트로]를 누르면
// 큰 노트 창 대신 누른 줄 바로 아래(PC는 버튼 아래, 폰은 줄 아래·하단바 위) 작은 창이 먼저 뜬다. 이 파일이 그 작은 창의 유일한 renderer다.
// - 안에는 [새 노트 ▾][폴더 ▾](note-pick.js createNoteTarget·note-folder-pick.js 그대로) · 더할 글 칸 · [취소][저장] · [크게 수정 ↗].
// - 저장 길은 큰 창과 같다: 기존 노트·가족 줄은 target.save(note-append.js appendToNote 한 길, 가족 노트 경계는 저장 함수가 다시 확인),
//   새 노트는 createNoteDoc + finishNewNote(note-window.js, 큰 창 run과 같은 뒷일). 이 파일은 새 저장 길을 만들지 않는다.
// - [크게 수정 ↗]: 고른 노트·폴더·적은 글을 그대로 큰 노트 창(note-window.js openNoteWindow)에 넘긴다. 저장이 끝나면 onClose({saved, text})는
//   openNoteWindow와 같은 모양으로 불러 부른 쪽(잊지 말기 줄 처리·알림)이 그대로 쓴다. 닫으면 아무것도 쓰지 않는다. 기기 저장 없음.
// - 자리는 공용 placeAnchored·followAnchor(버튼 아래, 모자라면 위). 쓴 글이 있으면 바깥을 눌러도 닫지 않는다([취소]·Esc로 닫음).
import {placeAnchored, followAnchor, clearAnchored, bottomInset} from './anchored-popup.js';
import {ensureEdStyles} from './ed-window.js';
import {openNoteWindow, finishNewNote, shortFolder, toast} from './note-window.js';
import {createNoteDoc, noteTitleFromText} from './basket-data.js';
import {plainToDocKeep} from './ed-markdown.mjs';
import {NOTE_TEXT_MAX} from './note-doc.mjs';

let current = null;

// anchor: 누른 [노트로] 버튼. reanchor(): 줄이 다시 그려져 버튼이 바뀌면 새 버튼을 찾아 준다(없으면 닫음).
// 나머지는 openNoteWindow와 같다(text·title·noteFolder·target·onClose). 반환 {close, big}.
export async function openNoteQuick({anchor, reanchor = null, text = '', title = '새 노트', rt = window.KPTURuntime, noteFolder = null, target = null, onClose = () => {}} = {}) {
  await ensureEdStyles();
  if (current?.dirty()) { current.focus(); return current; }
  current?.close();
  const owner = rt.session.read()?.user?.id;
  const family = !!target?.family;
  let cur = anchor, saved = null, busy = false, closed = false, layer = null, stop = null;
  const panel = document.createElement('div');
  panel.className = 'note-quick'; panel.dataset.noteQuick = '';
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', '노트로 넣기'); panel.tabIndex = -1;
  panel.innerHTML = '<div class="nq-row" data-nq-row></div><div class="nq-tail" data-nq-tail hidden></div>'
    + '<label class="a11y-only" for="nqText">더할 글</label><textarea id="nqText" class="nq-text" data-nq-text rows="2" autocomplete="off" placeholder="노트에 넣을 글"></textarea>'
    + '<p class="nq-status" data-nq-status role="status"></p>'
    + '<div class="nq-foot"><button type="button" class="ghost nq-big" data-nq-big>크게 수정 ↗</button>'
    + '<button type="button" class="secondary" data-nq-cancel>취소</button><button type="button" class="primary" data-nq-save>저장</button></div>';
  const row = panel.querySelector('[data-nq-row]'), tail = panel.querySelector('[data-nq-tail]'), area = panel.querySelector('[data-nq-text]');
  const status = panel.querySelector('[data-nq-status]'), saveBtn = panel.querySelector('[data-nq-save]'), cancelBtn = panel.querySelector('[data-nq-cancel]');
  const say = message => { status.textContent = message || ''; };
  area.value = text; area.maxLength = NOTE_TEXT_MAX;
  const first = String(text);
  const dirty = () => !closed && area.value !== first;

  // 큰 창과 같은 부품: [새 노트 ▾]·'📁 폴더 · 끝에 더함'·흐린 마지막 두 줄은 target이, [폴더 ▾]는 noteFolder가 그린다.
  const kinds = ['secondary'];
  let folderBtn = null;
  if (noteFolder) {
    folderBtn = document.createElement('button'); folderBtn.type = 'button'; folderBtn.dataset.edwFolder = ''; folderBtn.setAttribute('aria-haspopup', 'dialog');
    folderBtn.addEventListener('click', () => noteFolder.open(folderBtn));
  }
  const paintFolder = () => { if (!folderBtn) return; const name = noteFolder.label?.() || '폴더 없음'; folderBtn.textContent = shortFolder(name) + ' ▾'; folderBtn.title = '노트 폴더: ' + name; };
  noteFolder?.watch?.(paintFolder); paintFolder();
  const sync = () => {
    if (folderBtn) folderBtn.hidden = !!target && target.get().kind === 'note';
    if (target) { tail.hidden = target.tail.hidden; tail.replaceChildren(...[...target.tail.children].map(d => d.cloneNode(true))); }
  };
  const mine = [target?.button, folderBtn].filter(Boolean);
  mine.forEach(b => b.classList.add(...kinds));
  row.append(...(target ? [target.button] : []), ...(folderBtn ? [folderBtn] : []), ...(target ? [target.info] : []));
  target?.watch(sync); sync();
  const letGo = () => mine.forEach(b => b.classList.remove(...kinds)); // 큰 창으로 넘길 때 6가지 클래스를 떼어 큰 창 모양 규칙만 받게

  const popover = typeof panel.showPopover === 'function' && 'popover' in panel;
  if (popover) panel.setAttribute('popover', 'manual');
  document.body.append(panel);
  if (popover) { try { panel.showPopover(); } catch { panel.removeAttribute('popover'); } }
  // 줄이 다시 그려져도 새 [노트로] 버튼을 따라간다(쓰던 글이 사라지지 않게).
  const ref = {
    getBoundingClientRect: () => cur.getBoundingClientRect(),
    contains: node => cur.contains(node),
    get isConnected() { if (cur.isConnected) return true; const next = reanchor?.(); if (next) { cur = next; return true; } return false; },
  };
  const place = () => placeAnchored(panel, ref, {maxWidth: 380, maxHeight: 460, minHeight: 190, bottomInset: bottomInset()});
  const outside = e => {
    if (!(e.target instanceof Element) || panel.contains(e.target) || cur.contains(e.target)) return;
    if (e.target.closest('[data-note-pick], .lu-move-picker, #toast')) return; // 안에서 연 고르기 창
    if (!dirty()) close();
  };

  function detach() {
    if (closed) return;
    closed = true; current = null;
    document.removeEventListener('pointerdown', outside, true);
    stop?.(); clearAnchored(panel);
    const l = layer; layer = null; const back = l?.close();
    document.removeEventListener('keydown', esc, true);
    if (popover) { try { panel.hidePopover(); } catch { /* 이미 닫힘 */ } }
    panel.remove();
    return back;
  }
  function close({focus = true} = {}) {
    if (closed) return;
    detach(); letGo();
    noteFolder?.close?.(); target?.close?.();
    if (focus && cur.isConnected) cur.focus({preventScroll: true});
    onClose({saved, text: area.value});
  }
  // 고른 노트·폴더·적은 글 그대로 큰 노트 창으로. 고르기 상태(target·noteFolder)는 닫지 않고 넘긴다.
  async function big() {
    if (closed || busy) return;
    const letters = area.value;
    const back = detach(); letGo(); target?.close?.();
    await back; // 폰 뒤로가기 겹이 다 닫힌 뒤 큰 창을 연다(늦은 뒤로가기가 큰 창을 닫지 않게)
    return openNoteWindow({rt, text: letters, title, noteFolder, target, onClose});
  }
  async function save() {
    if (busy || closed) return;
    if (rt.session.read()?.user?.id !== owner) { say('로그인 정보가 바뀌었어요. 다시 열어 주세요.'); return; }
    const letters = area.value;
    if (!letters.trim()) { say('더할 내용을 써 주세요.'); area.focus(); return; }
    busy = true; saveBtn.disabled = true; cancelBtn.disabled = true; say('');
    try {
      const doc = plainToDocKeep(letters);
      if (target && (family || !target.isNew())) {
        const result = await target.save({value: doc, text: letters, heading: ''});
        saved = {kind: 'note', id: result?.noteId || '', folderName: result?.folderName || '', added: !target.isNew()};
        toast(result?.message || (target.isNew() ? '노트로 저장했어요.' : '노트 끝에 더했어요.'));
      } else {
        const note = await createNoteDoc({title: noteTitleFromText(letters) || '노트', raw_text: letters, markdown: false, doc}, rt);
        saved = {kind: 'note', id: note.id};
        toast(await finishNewNote(note, {rt, noteFolder}) || '노트로 저장했어요.');
      }
    } catch (error) {
      busy = false; saveBtn.disabled = false; cancelBtn.disabled = false;
      say(error?.message && /[가-힣]/.test(error.message) ? error.message : '저장하지 못했어요. 다시 눌러 주세요.');
      return;
    }
    busy = false;
    close({focus: false});
  }

  panel.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || !panel.contains(b)) return;
    if (b.hasAttribute('data-nq-save')) void save();
    else if (b.hasAttribute('data-nq-cancel')) close();
    else if (b.hasAttribute('data-nq-big')) big();
  });
  panel.addEventListener('keydown', e => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Escape' && !e.target.closest?.('[data-note-pick]')) { e.preventDefault(); e.stopPropagation(); if (!busy) close(); }
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.target === area) { e.preventDefault(); void save(); }
  });
  // 글 칸 밖에 초점이 있어도 Esc는 이 작은 창을 닫는다(안에서 연 고르기 창이 떠 있으면 그 창이 먼저 닫힌다).
  function esc(e) {
    if (e.key !== 'Escape' || e.defaultPrevented || busy || panel.contains(e.target)) return;
    if (document.querySelector('[data-note-pick], .lu-move-picker')) return;
    e.preventDefault(); close();
  }
  document.addEventListener('keydown', esc, true);
  area.addEventListener('input', () => { say(''); place(); });
  document.addEventListener('pointerdown', outside, true);
  stop = followAnchor(panel, ref, {place, lost: () => { if (!dirty()) close({focus: false}); }});
  layer = window.KPTURouter?.layer?.open('note-quick', {close: () => { layer = null; close({focus: false}); return true; }}) || null;
  place();
  // 폰(손가락 화면)은 글 칸에 바로 초점을 두지 않는다(자판이 창을 덮지 않게, note-pick.js와 같은 규칙). 칸을 누르면 바로 고친다.
  if (matchMedia('(pointer:coarse)').matches) panel.focus({preventScroll: true});
  else { area.focus({preventScroll: true}); area.setSelectionRange(area.value.length, area.value.length); }
  current = {close, big, dirty, focus: () => area.focus({preventScroll: true})};
  return current;
}
