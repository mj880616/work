// NOTE-보드여러개 (요청함 10/30 05:48, 사용자 결정 '위 추천안대로'): 노트 [보드] 보기(S68-38 옛 이름 포스트잇)의 보드 여러 개.
// S68-38: 보드를 지우거나 보드에서 노트를 빼면 그 보드의 연결선(links = note-board-links-data.js 모음)도 함께 정리한다.
// 이 모듈이 맡는 곳: 보드 칸 줄([보드…] [+ 새 보드], 폰은 이름 붙은 보드에서 [+ 노트 붙이기]), PC 왼쪽 폴더·노트 목록(끌어다 놓기),
// 폰 노트 고르기 창, 보드 칸 우클릭(폰 꾹 누르기) 메뉴 [이름 바꾸기] [보드 지우기], 보드에 붙이기·빼기·옮긴 자리 저장.
// S69 보드목록폴더놓기(요청함 '여기서 노트를 드래그해서 폴더로 못넣음'): 왼쪽 목록의 노트를 폴더 줄에 놓으면 그 폴더로 옮긴다.
// 옮기기는 노트 목록과 같은 길(basket-notes.js moveItems → setNoteFolderRef, 되돌리기 알림 포함)이고, 목록은 그 뒤 rerender 한 곳에서 다시 그린다.
// PC 마우스는 브라우저 끌어 놓기(판 놓기와 같은 끌기), 손가락은 공용 reorder-drag.js 꾹 눌러 끌기(노트 목록 폴더 나무와 같은 방식).
// 판 그리기는 note-board.js(그리는 곳 하나), 노트 목록·노트 메뉴·열기는 basket-notes.js가 맡는다.
// S69-33(사용자 11/24 "눌러서 노트에 붙기 x가아니라 드래그해서 붙이기만 남겨"): 왼쪽 목록 노트는 끌어 놓기로만 붙는다(놓은 자리에 카드).
//   누르기 = 이미 붙은 노트면 판에서 그 카드로 옮겨 강조(focusCard), 아니면 노트 열기(openNote — 노트 줄 누르기와 같은 길). 붙은 줄은 흐리게가 아니라 작은 점.
//   손가락 넓은 화면(폴드 펼침 등, 브라우저 끌어 놓기가 없음)은 보드 칸 줄 [+ 노트 붙이기] 고르기 창으로 붙이고, 고른 노트는 지금 보는 판 가운데부터 놓는다.
// 저장(기기 저장 없음):
// - 보드 목록·마지막에 연 보드: 서버 화면 기억 view_prefs.note_boards·note_board(migration 20261030091000). DB 적용 전에는 서버가 거절해
//   되돌리고 알린다(rejectable). 늦게 온 서버 값은 이번 접속에서 고른 뒤에는 덮지 않는다.
// - 노트가 붙은 보드와 자리: 노트 metadata.boards[보드 id](basket-data.js setNoteBoardPlace).
// S69-83(사용자 11/24 23:55 "전체는 불필요함 걍 없애"): 모든 노트를 한 판에 늘어놓던 [전체]는 없앴다. 보드 칸 줄은 내가 만든 보드와 [+ 새 보드]뿐,
//   처음엔 마지막에 연 보드(없으면 가장 최근에 만든 보드), 보드가 하나도 없으면 current = null(판 대신 빈 안내, basket-notes.js paintBoard).
//   서버 화면 기억에 옛 값 'all'이 남아 있어도 pickBoard가 무시한다. 노트의 옛 metadata.board 값은 지우지 않는다.
import { viewPrefs } from './view-prefs.js';
import { mountSplitResize } from './split-resize.js';
import { BOARD_LIMITS, parseBoards, boardsToPrefs, pickBoard, addBoard, renameBoard, removeBoard, boardPlaceOf, onBoard, notesOnBoard, dropPlace } from './note-boards-model.mjs';
import { layoutBoard, spreadFrom, topZ, placeFields, validateCardLabel, CARD_LABEL_MAX, clampPos, Z_MAX } from './note-board-model.mjs';
import { treeRows, noteLineTitle, OUTSIDE } from './note-tree.mjs';
import { setNoteBoardPlace } from './basket-data.js';
import { NOTE_DRAG } from './note-board.js';
import * as pinLock from './feature-lock.js';
import { noteTreeRowHtml, lockedFolderRowHtml } from './note-tree-row.js';
import { ftBoxHtml } from './folder-tree-ui.mjs';
import { LONG_MS, SLOP, mountReorder } from './reorder-drag.js';
import { setDragGhostImage } from './drag-ghost.js'; // S69-27 끄는 모습 보이기
import { askConfirm, askText } from './small-notice.js';
import { emptyHtml } from './wait-state.js';
import { fitChipRows } from './chip-rows.js';
import { placeAnchored, followAnchor, clearAnchored } from './anchored-popup.js';
import {installDragEdgeScroll} from './drag-edge-scroll.js';
// UI-끌기가장자리스크롤(S69-15): 이 화면의 HTML 끌기도 끄는 동안 포인터 아래 칸 위·아래 가장자리면 저절로 굴린다(공용 부품 하나, 화면마다 계산 없음).
installDragEdgeScroll();

// wide: PC 왼쪽 목록을 보일 너비(노트 화면과 같은 761px~). get/set: basket-notes.js의 노트 배열. folderOf·folders·matches: 지금 노트 화면의 값.
const FOLDER_DRAG = 'application/x-kptu-note-folder';
// S69 보드잠금가림(요청함 '보드 화면에서 잠금 노트 제목이 보이는 문제'): 왼쪽 목록·폰 고르기 창도 노트 화면과 같은 판정(feature-lock.js 한 곳)을 쓴다.
// 잠겨 가려진 동안: 잠근 폴더는 줄 하나 '이름 · 잠김'(펼치기·개수·끌어 놓기 없음, 누르면 PIN 창), 그 아래 하위 폴더 줄과 가려진 노트는 그리지 않는다.
// 판정은 feature-lock.js가 이미 가진 값(서버 app_lock_note_folders의 잠근 폴더·덮인 하위 폴더)만 쓴다 — 화면 가림이고 자료 권한은 서버 owner 경계 그대로.
const lockedRow = id => pinLock.notesHidden() && pinLock.folderLocked(id);
const shownFolders = list => pinLock.notesHidden() ? list.filter(f => !pinLock.folderCovered(f.id) || pinLock.folderLocked(f.id)) : list;
const shownNotes = list => pinLock.notesHidden() ? list.filter(n => !pinLock.noteHidden(n)) : list;
// 잠긴 폴더 줄은 공용 노트 나무 줄(note-tree-row.js lockedFolderRowHtml): 누르면 다른 화면의 '잠김' 줄과 같은 그 자리 PIN 창. 풀리면 kptu:feature-lock-changed로 다시 그린다.

export function createNoteBoards({esc, rt, links = null, wide, bar, side, notes, folderOf, folders, matches, rerender, toast, refresh, scope, openNoteMenu = () => {}, openFolderMenu = () => {}, moveToFolder = null, focusCard = () => false, centerPoint = () => null, openNote = () => {}, onExport = null}) {
  const coarse = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(pointer: coarse)') : {matches:false};
  let boards = parseBoards(viewPrefs.get('note_boards')), current = pickBoard(viewPrefs.get('note_board'), boards), chosen = false;
  let openSet = new Set(), menu = null, picker = null;
  const named = () => !!current && boards.some(b => b.id === current);
  const boardName = id => boards.find(b => b.id === id)?.name || '';
  window.addEventListener('kptu:view-prefs-ready', () => {
    if (chosen) return;
    boards = parseBoards(viewPrefs.get('note_boards')); current = pickBoard(viewPrefs.get('note_board'), boards); rerender();
  });
  window.addEventListener('kptu:view-prefs-rejected', e => {
    const paths = e.detail?.paths || [];
    if (!paths.includes('note_boards') && !paths.includes('note_board')) return;
    boards = parseBoards(viewPrefs.get('note_boards')); current = pickBoard(current, boards);
    toast('보드는 아직 서버에 저장할 수 없어요(준비 중). 잠시 뒤 다시 해 주세요.'); rerender();
  });
  const saveBoards = () => { viewPrefs.set('note_boards', boardsToPrefs(boards), {rejectable:true}); void viewPrefs.flush?.(); };
  function select(id) {
    if (!boards.some(b => b.id === id)) return;
    const next = id;
    chosen = true; closeMenu();
    if (next === current) return;
    current = next; viewPrefs.set('note_board', current, {rejectable:true});
    rerender();
  }

  // 보드 칸 줄. 고른 보드는 aria-pressed. 이름 붙은 보드 칸은 우클릭·꾹 누르기로 메뉴(보드 칸 자체가 메뉴를 연다, ⋯ 없음).
  function paintBar() {
    const phoneAdd = named() && (!wide.matches || coarse.matches);
    bar.innerHTML = `${boards.map(b => `<button type="button" class="nbb-chip" data-nbb-board="${esc(b.id)}" aria-pressed="${current === b.id}" aria-haspopup="true">${esc(b.name)}</button>`).join('')}${boards.length < BOARD_LIMITS.count ? '<button type="button" class="nbb-new" data-nbb-new>+ 새 보드</button>' : ''}${phoneAdd ? '<button type="button" class="nbb-new nbb-attach" data-nbb-pick>+ 노트 붙이기</button>' : ''}`;
    // UI-칩줄두줄: 보드 칸 줄도 두 줄 + [더보기 ▾](공용 chip-rows.js). 접히는 것은 고르지 않은 보드 칸뿐, [+ 새 보드]·[+ 노트 붙이기]는 늘 보인다.
    fitChipRows(bar, { key: 'noteboards', keep: el => el.dataset.nbbBoard === undefined || el.getAttribute('aria-pressed') === 'true' });
  }
  // PC 왼쪽 목록: 노트 화면과 같은 폴더 나무(note-tree.mjs treeRows) + 그 안 노트. 이미 붙은 노트는 작은 '보드에 있음' 점(판에는 다시 놓이지 않음).
  function paintSide() {
    const show = named() && wide.matches;
    const body = side.parentElement;
    side.hidden = !show; body?.classList.toggle('nbw-split', show);
    // UI-칸폭끌기전수(요청함 10/30 10:29): PC 이름 붙은 보드는 왼쪽 노트 목록 | 보드 사이 경계를 끌어 폭을 바꾼다(공용 split-resize.js,
    // 기본 16:84·목록 최소 150px). 폭은 서버(view_prefs.split_ratio.noteboard)에 기억한다. 목록이 없으면(보드 없음·폰) 경계가 숨는다.
    if (body) mountSplitResize({container:body, name:'noteboard', label:'노트 목록과 보드 칸 폭 조절', columns:[
      {el:() => side, varName:'--ds-split-list', minVar:'--ds-split-list-min', minFallback:150, share:16},
      {el:() => body.querySelector(':scope>[data-nbw-main]'), varName:'--ds-split-detail', minVar:'--ds-split-detail-min', minFallback:360, share:84}],
      active:() => wide.matches && body.isConnected && !side.hidden && !!side.getClientRects().length});
    if (!show) { side.replaceChildren(); return; }
    const all = notes.get(), m = matches();
    // 폴더가 하나도 없으면 노트가 바로 한 목록(폴더 없음 묶음도 펼쳐 둔다).
    if (!folders().length) openSet.add(OUTSIDE);
    const rows = treeRows({folders:shownFolders(folders()), notes:shownNotes(all), folderOf, root:null, isOpen:id => openSet.has(id) && !lockedRow(id), matches:m});
    // NOTE-폴더디자인통일(S70-82): 줄은 [파일]·노트 [폴더] 나무와 같은 공용 줄(note-tree-row.js → folder-tree-ui.mjs), 목록은 [파일] 나무와 같은 둥근 상자 하나.
    // 이미 붙은 노트도 폴더로는 끌 수 있다(판에는 놓이지 않는다 — dragstart가 판 끌기 형식을 싣지 않음).
    // NOTE-보드목록음영(S70-79): 줄에 쓰는 법 안내 title은 없다. 이름 칸 title은 전체 이름만(표준 L2, 공용 줄 .ft-name).
    const html = rows.map(r => {
      if (r.type === 'folder' && lockedRow(r.id)) return lockedFolderRowHtml(r, {lockAttr:'nbb-locked'});
      if (r.type !== 'note') return noteTreeRowHtml(r, {folderAttr:'nbb-folder', noteAttr:'nbb-note', reorder:true});
      const on = onBoard(r.note, current);
      return noteTreeRowHtml(r, {folderAttr:'nbb-folder', noteAttr:'nbb-note', reorder:true, on, draggable:on ? !!moveToFolder : true});
    }).join('');
    side.innerHTML = ftBoxHtml({head:'노트 목록', body:html || emptyHtml('노트 없음'), label:'붙일 노트', attrs:{'data-nbb-list':''}});
  }
  function paint() { paintBar(); paintSide(); }

  // 판에 그릴 값(basket-notes.js paintBoard가 note-board.js에 넘긴다).
  function boardView() {
    if (!named()) return null;
    const id = current;
    return {notes:notesOnBoard(notes.get(), id), placeOf:n => boardPlaceOf(n, id), removable:true,
      emptyText:wide.matches ? '왼쪽 노트를 끌어다 놓으세요' : '[+ 노트 붙이기]로 노트를 선택하세요'};
  }

  // 붙이기·빼기·옮기기. 화면은 바로 바꾸고(서버 답을 기다리지 않음) 실패하면 알리고 다시 불러온다.
  const localPlace = (nid, boardId, place) => notes.set(list => list.map(n => {
    if (n.id !== nid) return n;
    const meta = n.metadata && typeof n.metadata === 'object' ? {...n.metadata} : {};
    const all = meta.boards && typeof meta.boards === 'object' && !Array.isArray(meta.boards) ? {...meta.boards} : {};
    if (place) all[boardId] = placeFields(place); else delete all[boardId];
    if (Object.keys(all).length) meta.boards = all; else delete meta.boards;
    return {...n, metadata:meta};
  }));
  async function store(jobs, failText) {
    const owner = scope(); let failed = 0;
    const work = jobs.map(([nid, boardId, place]) => async () => {
      const note = notes.get().find(n => n.id === nid); if (!note) return;
      try { const saved = await setNoteBoardPlace(note, boardId, place, rt); if (owner === scope() && saved?.metadata) notes.set(list => list.map(n => n.id === nid ? {...n, metadata:saved.metadata} : n)); }
      catch { failed++; }
    });
    for (let i = 0; i < work.length; i += 4) await Promise.all(work.slice(i, i + 4).map(run => run()));
    if (owner !== scope()) return;
    if (failed) { toast(failText); await refresh(); }
  }
  // point: 판 좌표(끌어 놓은 곳, 폰 고르기 창은 지금 보는 판 가운데). 여러 장이면 그 자리부터 4장씩 한 줄. 없으면 빈 곳부터 차례로.
  function attach(ids, point = null, places = null) {
    if (!named()) return;
    const id = current, all = notes.get(), fresh = ids.filter(nid => all.some(n => n.id === nid) && !all.some(n => n.id === nid && onBoard(n, id)));
    if (!fresh.length) return;
    let placed;
    if (point && fresh.length === 1) placed = new Map([[fresh[0], dropPlace(fresh[0], point, places || new Map())]]);
    else if (point) {
      const base = places || new Map(notesOnBoard(all, id).map(n => [n.id, boardPlaceOf(n, id)]).filter(([, p]) => p)), top = topZ(base), at = spreadFrom(point, fresh.length);
      placed = new Map(fresh.map((nid, i) => { const p = dropPlace(nid, at[i], base); return [nid, {...p, z:top + 1 + i}]; }));
    }
    else {
      const set = new Set(fresh), on = notesOnBoard(all, id);
      const layout = layoutBoard([...on, ...all.filter(n => set.has(n.id))], folderOf, n => (set.has(n.id) ? null : boardPlaceOf(n, id)));
      placed = new Map(fresh.map(nid => { const p = layout.get(nid); return [nid, {x:p.x, y:p.y, r:p.r, z:p.z}]; }));
    }
    for (const [nid, p] of placed) localPlace(nid, id, p);
    rerender();
    void store([...placed].map(([nid, p]) => [nid, id, p]), '보드에 붙이지 못했어요. 다시 불러올게요.');
  }
  // S70-32 ②: 보드에 넣은 사진 노트 하나를 놓은 자리(point = 사진 가운데)에 사진 비율 크기(size = {w, h})로 붙인다. 저장은 attach와 같은 길.
  function attachSized(nid, point, size) {
    if (!named() || !notes.get().some(n => n.id === nid)) return;
    const id = current, base = new Map(notesOnBoard(notes.get(), id).map(n => [n.id, boardPlaceOf(n, id)]).filter(([, p]) => p));
    const p = {x:clampPos(point.x - size.w / 2, size.w), y:clampPos(point.y - size.h / 2, size.h), r:0, z:Math.min(Z_MAX, topZ(base) + 1), w:size.w, h:size.h};
    localPlace(nid, id, p);
    rerender();
    void store([[nid, id, p]], '보드에 붙이지 못했어요. 다시 불러올게요.');
  }
  // nid: 노트 id 하나 또는 여러 개(판에서 고른 카드 함께 빼기, S69-33).
  function detach(nid) {
    if (!named()) return;
    const id = current, ids = (Array.isArray(nid) ? nid : [nid]).filter(Boolean); if (!ids.length) return;
    for (const n of ids) localPlace(n, id, null);
    rerender();
    void store(ids.map(n => [n, id, null]), '보드에서 빼지 못했어요. 다시 불러올게요.');
    for (const n of ids) void links?.removeBoard(id, n);
  }
  // S70-03 되돌리기: 보드에서 뺀 카드를 그 보드의 그 자리로 다시 붙인다(list = [[노트 id, 자리]]). 그 보드를 보고 있을 때만.
  function restore(boardId, list) {
    if (!named() || current !== boardId) return false;
    const all = notes.get(), ok = list.filter(([nid, p]) => p && all.some(n => n.id === nid));
    if (!ok.length) return !list.length;
    for (const [nid, p] of ok) localPlace(nid, boardId, p);
    rerender();
    void store(ok.map(([nid, p]) => [nid, boardId, p]), '보드에 다시 붙이지 못했어요. 다시 불러올게요.');
    return ok.length === list.length;
  }
  function move(nid, next) {
    if (!named()) return;
    const id = current; localPlace(nid, id, next);
    void store([[nid, id, next]], '카드 자리를 저장하지 못했어요. 다시 불러올게요.');
  }

  // S69-88: 이 보드에서만 카드에 보일 글자(별명, 카드 자리 정보의 label). 노트 제목·내용·연결은 그대로(누르면 그 노트가 열림). 비우면 노트 제목.
  const placeHere = nid => { const n = notes.get().find(k => k.id === nid); return n && named() ? boardPlaceOf(n, current) : null; };
  async function relabel(note, anchor) {
    if (!named()) return;
    const id = current, place = placeHere(note.id); if (!place) return;
    const title = [...noteLineTitle(note)].slice(0, 40).join('');
    const typed = await askText(anchor || bar, {text:`보드에 보일 글자 (${CARD_LABEL_MAX}자까지, 비우면 노트 제목 '${title}')`, value:place.label || '', max:CARD_LABEL_MAX});
    if (typed === null || current !== id) return;
    let label; try { label = validateCardLabel(typed); } catch (e) { toast(e.message); return; }
    const now = placeHere(note.id); if (!now || (now.label || null) === label) return;
    const next = {...placeFields(now), label}; if (!label) delete next.label;
    localPlace(note.id, id, next); rerender();
    void store([[note.id, id, next]], '보드에 보일 글자를 저장하지 못했어요. 다시 불러올게요.');
  }
  // 손으로 정한 카드 크기 → 처음 크기로.
  const isSized = note => { const p = named() ? boardPlaceOf(note, current) : null; return !!(p && (p.w || p.h)); };
  function autosize(nid) {
    const now = placeHere(nid); if (!now || !(now.w || now.h)) return;
    const next = placeFields(now); delete next.w; delete next.h;
    localPlace(nid, current, next); rerender();
    void store([[nid, current, next]], '카드 크기를 저장하지 못했어요. 다시 불러올게요.');
  }

  // 보드 만들기·이름·지우기(이름은 노트 폴더와 같은 창).
  // S48-28: 이름은 공용 작은 글 입력창(누른 칸 근처)으로 묻는다. 취소 = null.
  const askBoardName = (anchor, text, value = '') => askText(anchor || bar, {text:`${text} (${BOARD_LIMITS.name}자까지)`, value, max:BOARD_LIMITS.name});
  async function create(anchor) {
    const typed = await askBoardName(anchor, '새 보드 이름'); if (typed === null) return;
    try { const r = addBoard(boards, typed); boards = r.boards; saveBoards(); select(r.board.id); if (current !== r.board.id) rerender(); }
    catch (e) { toast(e.message); }
  }
  async function rename(id, anchor) {
    const typed = await askBoardName(anchor, '보드 이름 바꾸기', boardName(id)); if (typed === null || !boards.some(b => b.id === id) || typed.trim() === boardName(id)) return;
    try { boards = renameBoard(boards, id, typed); saveBoards(); rerender(); } catch (e) { toast(e.message); }
  }
  async function remove(id, trigger) {
    const name = boardName(id), on = notesOnBoard(notes.get(), id);
    if (!await askConfirm(trigger || bar, {text:`'${name}' 보드를 삭제할까요?`, note:`붙은 노트 ${on.length}개는 삭제하지 않아요(보드에서만 빠져요).`, ok:'삭제', danger:true})) return;
    boards = removeBoard(boards, id); saveBoards();
    // 보던 보드를 지우면 남은 보드 중 가장 최근에 만든 보드로(없으면 빈 안내). 남은 보드가 없으면 화면 기억은 그대로 두고 읽을 때 무시한다.
    if (current === id) { current = pickBoard(null, boards); if (current) viewPrefs.set('note_board', current, {rejectable:true}); }
    for (const n of on) localPlace(n.id, id, null);
    rerender();
    // 지운 보드의 자리도 노트에서 지운다(남아도 화면은 무시하지만, 노트 metadata를 깨끗이).
    void store(on.map(n => [n.id, id, null]), '삭제한 보드의 노트 자리를 다 정리하지 못했어요. 노트는 그대로예요.');
    void links?.removeBoard(id);
  }

  // 보드 칸 메뉴(노트 메뉴와 같은 모양의 작은 창).
  function menuEl() {
    let el = bar.parentElement.querySelector('[data-nbb-menu]');
    if (!el) { el = document.createElement('div'); el.className = 'basket-more-menu note-pop-menu nbb-menu'; el.dataset.nbbMenu = ''; el.setAttribute('role', 'group'); el.setAttribute('aria-label', '보드 메뉴'); el.hidden = true; bar.after(el); }
    return el;
  }
  function openMenu(chip) {
    const id = chip.dataset.nbbBoard; if (!id) return;
    closeMenu();
    const el = menuEl();
    // S70-32 ③: 지금 연 보드면 [PDF로 내보내기]·[HTML로 내보내기](보드 전체를 이 기기로 내려받기).
    const items = [['data-nbb-rename', '이름 바꾸기'], ...(onExport && id === current ? [['data-nbb-export="pdf"', 'PDF로 내보내기'], ['data-nbb-export="html"', 'HTML로 내보내기']] : []), ['data-nbb-delete', '보드 삭제', 'basket-menu-danger']];
    el.innerHTML = items.map(([attr, label, cls]) => `<button type="button" ${attr}${cls ? ` class="${cls}"` : ''}>${label}</button>`).join('');
    el.hidden = false;
    const place = () => placeAnchored(el, chip, {maxWidth:200, maxHeight:260});
    place();
    menu = {id, chip, stop:followAnchor(el, chip, {place, lost:() => closeMenu()})};
    chip.setAttribute('aria-expanded', 'true');
    el.querySelector('button')?.focus({preventScroll:true});
  }
  function closeMenu({focus = false} = {}) {
    if (!menu) return null;
    const m = menu, el = menuEl(); menu = null; m.stop(); el.hidden = true; clearAnchored(el);
    m.chip.setAttribute('aria-expanded', 'false'); if (focus) m.chip.focus({preventScroll:true});
    return m;
  }
  bar.parentElement.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const inMenu = b.closest('[data-nbb-menu]');
    if (inMenu) { e.stopPropagation(); const m = closeMenu({focus:true}); if (!m) return; if (b.hasAttribute('data-nbb-rename')) void rename(m.id, m.chip); else if (b.dataset.nbbExport && m.id === current) onExport(b.dataset.nbbExport); else if (b.hasAttribute('data-nbb-delete')) void remove(m.id, m.chip); return; }
    if (!bar.contains(b)) return;
    if (Date.now() < suppress) { e.preventDefault(); return; }
    if (b.dataset.nbbBoard) select(b.dataset.nbbBoard);
    else if (b.hasAttribute('data-nbb-new')) void create(b);
    else if (b.hasAttribute('data-nbb-pick')) openPicker(b);
  });
  document.addEventListener('click', e => { if (menu && !menuEl().contains(e.target) && !menu.chip.contains(e.target)) closeMenu(); });
  bar.parentElement.addEventListener('keydown', e => {
    if (e.key === 'Escape' && menu) { e.preventDefault(); e.stopPropagation(); closeMenu({focus:true}); return; }
    const chip = e.target.closest?.('[data-nbb-board]');
    if (chip && (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) { e.preventDefault(); openMenu(chip); }
    if (chip && e.key === 'F2') { e.preventDefault(); void rename(chip.dataset.nbbBoard, chip); }
  });
  // PC 우클릭: 이 칸의 메뉴(공용 context-menu.js보다 먼저, 브라우저 메뉴 대신).
  bar.addEventListener('contextmenu', e => { const chip = e.target.closest('[data-nbb-board]'); if (!chip) return; e.preventDefault(); e.stopPropagation(); openMenu(chip); });
  // 폰 꾹 누르기.
  let press = null, suppress = 0;
  bar.addEventListener('pointerdown', e => {
    const chip = e.target.closest('[data-nbb-board]'); if (!chip || e.pointerType === 'mouse') return;
    press = {chip, x:e.clientX, y:e.clientY, timer:setTimeout(() => { press = null; suppress = Date.now() + 600; try { navigator.vibrate?.(12); } catch { /* 진동 없음 */ } openMenu(chip); }, LONG_MS)};
  });
  const endPress = () => { if (press) { clearTimeout(press.timer); press = null; } };
  bar.addEventListener('pointermove', e => { if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > SLOP) endPress(); });
  bar.addEventListener('pointerup', endPress); bar.addEventListener('pointercancel', endPress);

  // PC 왼쪽 목록: 폴더 펴기·접기, 끌기 = 놓은 곳에 붙이기. 노트 누르기는 붙이지 않는다(S69-33): 붙은 노트 = 판에서 그 카드로, 아니면 노트 열기.
  side.addEventListener('click', e => {
    const f = e.target.closest('[data-nbb-folder]');
    if (f) { const id = f.dataset.nbbFolder; if (openSet.has(id)) openSet.delete(id); else openSet.add(id); paintSide(); side.querySelector(`[data-nbb-folder="${CSS.escape(id)}"]`)?.focus({preventScroll:true}); return; }
    const n = e.target.closest('[data-nbb-note]'); if (!n) return;
    if (n.hasAttribute('data-nbb-on') && focusCard(n.dataset.nbbNote)) return;
    openNote(n.dataset.nbbNote);
  });
  // UI-우클릭전수(2026-11-03): 왼쪽 노트 목록 우클릭(PC) = 브라우저 메뉴 대신 웹2 노트·폴더 메뉴. 글자 칸 안·Shift·터치는 그대로.
  side.addEventListener('contextmenu', e => {
    if (e.defaultPrevented || e.pointerType === 'touch' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
    const f = e.target.closest?.('[data-nbb-folder]'), n = e.target.closest?.('[data-nbb-note]');
    if (!f && !n) return;
    e.preventDefault(); e.stopPropagation();
    if (n) openNoteMenu(n, n.dataset.nbbNote, e.clientX, e.clientY);
    else openFolderMenu(f, f.dataset.nbbFolder === OUTSIDE ? null : f.dataset.nbbFolder, e.clientX, e.clientY);
  });
  // 폴더 줄에 놓기: 놓을 수 있는 폴더 줄은 끄는 동안 바탕을 칠한다(노트 목록 폴더 나무와 같은 .nx-drop 표시). 지금 그 노트가 든 폴더는 놓을 곳이 아니다.
  const folderKey = row => (row.dataset.nbbFolder === OUTSIDE ? null : row.dataset.nbbFolder);
  const sameFolder = (nid, row) => { const n = notes.get().find(x => x.id === nid); return !n || (folderOf(n) ?? null) === folderKey(row); };
  const markDrop = row => {
    side.querySelectorAll('.nx-drop').forEach(el => { if (el !== row) el.classList.remove('nx-drop'); });
    row?.closest('.ft-row')?.classList.add('nx-drop');
  };
  const dropInto = (nid, row) => { markDrop(null); if (moveToFolder && nid && row && !sameFolder(nid, row)) void moveToFolder(nid, folderKey(row)); };
  const folderDrag = e => !!moveToFolder && [...(e.dataTransfer?.types || [])].includes(FOLDER_DRAG);
  let dragNote = '';
  side.addEventListener('dragstart', e => {
    const n = e.target.closest?.('[data-nbb-note]'), on = !!n?.hasAttribute('data-nbb-on');
    // 손가락으로 이미 잡은 끌기(아래 reorder-drag)가 있으면 브라우저 끌기는 시작하지 않는다(둘이 겹치지 않게).
    if (!n || (on && !moveToFolder) || side.classList.contains('re-active')) { e.preventDefault(); return; }
    // 판 놓기 형식(NOTE_DRAG)은 아직 안 붙은 노트만 싣는다. 폴더 놓기 형식은 언제나.
    if (!on) e.dataTransfer.setData(NOTE_DRAG, n.dataset.nbbNote);
    if (moveToFolder) { e.dataTransfer.setData(FOLDER_DRAG, n.dataset.nbbNote); dragNote = n.dataset.nbbNote; }
    e.dataTransfer.effectAllowed = moveToFolder ? 'copyMove' : 'copy';
    // S69-27 끄는 모습 보이기: 노트 폴더 보기와 같은 반투명 조각(제목 한 줄)이 마우스를 따라온다(공용 drag-ghost.js).
    setDragGhostImage(e.dataTransfer, n.querySelector('.ft-name')?.textContent || '', document, e);
  });
  side.addEventListener('dragend', () => { dragNote = ''; markDrop(null); });
  side.addEventListener('dragover', e => {
    if (!folderDrag(e)) return;
    const row = e.target.closest?.('[data-nbb-folder]');
    if (!row || (dragNote && sameFolder(dragNote, row))) { markDrop(null); return; }
    e.preventDefault(); e.dataTransfer.dropEffect = 'move'; markDrop(row);
  });
  side.addEventListener('dragleave', e => { if (!side.contains(e.relatedTarget)) markDrop(null); });
  side.addEventListener('drop', e => {
    const row = e.target.closest?.('[data-nbb-folder]');
    if (!folderDrag(e) || !row) { markDrop(null); return; }
    e.preventDefault(); const nid = e.dataTransfer.getData(FOLDER_DRAG); dragNote = ''; dropInto(nid, row);
  });
  // 손가락(Fold 펼친 화면 등 넓은 터치 화면): 노트 줄을 꾹 눌러 잡고 폴더 줄에 놓는다(노트 목록 폴더 나무와 같은 공용 꾹 눌러 끌기).
  // 마우스는 위 브라우저 끌기 그대로라 여기서는 잡지 않는다. 짧게 누르기는 위 click(그 카드로·노트 열기).
  if (moveToFolder) {
    let lastPointer = '';
    side.addEventListener('pointerdown', e => { lastPointer = e.pointerType || ''; }, true);
    const rowOf = key => (key ? side.querySelector(`.ft-row[data-reorder-id="${CSS.escape(key)}"] [data-nbb-folder]`) : null);
    mountReorder(side, {listSelector:'[data-nbb-list] .ft-box-body', whole:true, scroller:() => side, ghost:el => el.querySelector('.ft-name')?.textContent || '',
      canDrag:key => lastPointer === 'touch' && key.startsWith('n:'),
      zones:{resolve:(dragKey, overKey) => {
        const row = overKey.startsWith('f:') ? rowOf(overKey) : null;
        return row && !sameFolder(dragKey.slice(2), row) ? {ok:true, canInside:true} : {ok:false};
      }},
      onHover:info => markDrop(info ? rowOf(info.over) : null),
      onDrop:({id, over}) => dropInto(id.slice(2), rowOf(over))});
  }

  // 폰 노트 고르기 창: 폴더 나무 + 검색, 여러 개 골라 [붙이기]. 뒤로가기는 창 닫기(라우터 한 겹).
  function openPicker(trigger) {
    if (!named() || picker) return;
    const dlg = document.createElement('dialog');
    dlg.className = 'nbb-pick'; dlg.setAttribute('aria-label', `${boardName(current)}에 노트 붙이기`);
    dlg.innerHTML = `<div class="nbb-pick-head"><b>${esc(boardName(current))}에 붙이기</b><button type="button" class="nbb-pick-x" data-nbb-pick-close aria-label="닫기">×</button></div><input type="search" class="nbb-pick-find" data-nbb-pick-find placeholder="노트 찾기" aria-label="노트 찾기" autocomplete="off" enterkeyhint="search"><div class="nbb-pick-list" data-nbb-pick-list role="group" aria-label="붙일 노트"></div><div class="nbb-pick-foot"><button type="button" class="nbb-pick-ok" data-nbb-pick-ok disabled>붙이기</button></div>`;
    document.body.append(dlg);
    const state = {picked:new Set(), open:new Set(folders().length ? [] : [OUTSIDE]), q:''};
    const list = dlg.querySelector('[data-nbb-pick-list]'), ok = dlg.querySelector('[data-nbb-pick-ok]');
    const paintPick = () => {
      const q = state.q, m = q ? n => `${n.title || ''}\n${n.raw_text || ''}`.toLowerCase().includes(q) : null;
      const rows = treeRows({folders:shownFolders(folders()), notes:shownNotes(notes.get()), folderOf, root:null, isOpen:id => state.open.has(id) && !lockedRow(id), matches:m});
      // 줄은 잊지 말기 [노트] 창의 노트 고르기(note-pick.js)와 같은 부품(note-tree-row.js).
      list.innerHTML = rows.map(r => {
        if (r.type === 'folder' && lockedRow(r.id)) return lockedFolderRowHtml(r, {lockAttr:'nbb-pl'});
        const on = r.type === 'note' && onBoard(r.note, current), sel = r.type === 'note' && state.picked.has(r.note.id);
        return noteTreeRowHtml(r, {folderAttr:'nbb-pf', noteAttr:'nbb-pn', pressed:on || sel, off:on});
      }).join('') || emptyHtml('맞는 노트 없음');
      ok.disabled = !state.picked.size; ok.textContent = state.picked.size ? `붙이기 ${state.picked.size}` : '붙이기';
    };
    let layer = null;
    const finish = () => { if (!picker) return; picker = null; const l = layer; layer = null; l?.close(); if (dlg.open) dlg.close(); dlg.remove(); trigger?.isConnected && trigger.focus({preventScroll:true}); };
    picker = {close:finish};
    dlg.addEventListener('click', e => {
      if (e.target === dlg) { finish(); return; } // 바깥(어두운 곳) 누르기
      const b = e.target.closest('button'); if (!b) return;
      if (b.hasAttribute('data-nbb-pick-close')) finish();
      else if (b.dataset.nbbPf) { const id = b.dataset.nbbPf; if (state.open.has(id)) state.open.delete(id); else state.open.add(id); paintPick(); }
      else if (b.dataset.nbbPn && b.getAttribute('aria-disabled') !== 'true') { const id = b.dataset.nbbPn; if (state.picked.has(id)) state.picked.delete(id); else state.picked.add(id); paintPick(); list.querySelector(`[data-nbb-pn="${CSS.escape(id)}"]`)?.focus({preventScroll:true}); }
      else if (b.hasAttribute('data-nbb-pick-ok')) { const ids = [...state.picked]; finish(); attach(ids, centerPoint()); }
    });
    dlg.addEventListener('input', e => { if (e.target.matches('[data-nbb-pick-find]')) { state.q = e.target.value.trim().toLowerCase(); paintPick(); } });
    dlg.addEventListener('cancel', e => { e.preventDefault(); finish(); });
    // 잠긴 폴더 줄에서 그 자리 PIN으로 풀거나 다시 잠기면 고르기 창도 다시 그린다(창이 닫히면 듣기를 그만둔다).
    const relock = () => { if (picker && dlg.isConnected) paintPick(); else window.removeEventListener('kptu:feature-lock-changed', relock); };
    window.addEventListener('kptu:feature-lock-changed', relock);
    paintPick();
    dlg.showModal();
    layer = window.KPTURouter?.layer?.open('note-board-pick', {close:() => { layer = null; finish(); return true; }}) || null;
  }

  return {
    paint, boardView, attach, attachSized, detach, restore, move, relabel, autosize, isSized,
    current:() => current, isNamed:named, name:boardName,
    reset() { closeMenu(); picker?.close(); openSet = new Set(); chosen = false; boards = parseBoards(viewPrefs.get('note_boards')); current = pickBoard(viewPrefs.get('note_board'), boards); },
  };
}
