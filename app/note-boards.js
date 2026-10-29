// NOTE-보드여러개 (요청함 10/30 05:48, 명진 결정 '위 추천안대로'): 노트 [포스트잇] 보기의 보드 여러 개.
// 이 모듈이 맡는 곳: 보드 칸 줄([전체] [보드…] [+ 새 보드], 폰은 이름 붙은 보드에서 [+ 노트 붙이기]), PC 왼쪽 폴더·노트 목록(끌어다 놓기),
// 폰 노트 고르기 창, 보드 칸 우클릭(폰 꾹 누르기) 메뉴 [이름 바꾸기] [보드 지우기], 보드에 붙이기·빼기·옮긴 자리 저장.
// 판 그리기는 note-board.js(그리는 곳 하나), 노트 목록·노트 메뉴·열기는 basket-notes.js가 맡는다.
// 저장(기기 저장 없음):
// - 보드 목록·마지막에 연 보드: 서버 화면 기억 view_prefs.note_boards·note_board(migration 20261030090000). DB 적용 전에는 서버가 거절해
//   되돌리고 알린다(rejectable). 늦게 온 서버 값은 이번 접속에서 고른 뒤에는 덮지 않는다.
// - 노트가 붙은 보드와 자리: 노트 metadata.boards[보드 id](basket-data.js setNoteBoardPlace). [전체]는 지금 그대로 metadata.board.
import { viewPrefs } from './view-prefs.js';
import { ALL, BOARD_LIMITS, parseBoards, boardsToPrefs, pickBoard, addBoard, renameBoard, removeBoard, boardPlaceOf, onBoard, notesOnBoard, dropPlace } from './note-boards-model.mjs';
import { layoutBoard } from './note-board-model.mjs';
import { treeRows, noteLineTitle, OUTSIDE, OUTSIDE_NAME } from './note-tree.mjs';
import { setNoteBoardPlace } from './basket-data.js';
import { NOTE_DRAG } from './note-board.js';
import { LONG_MS, SLOP } from './reorder-drag.js';
import { askConfirm } from './small-notice.js';
import { emptyHtml } from './wait-state.js';
import { placeAnchored, followAnchor, clearAnchored } from './anchored-popup.js';

// wide: PC 왼쪽 목록을 보일 너비(노트 화면과 같은 1024px~). get/set: basket-notes.js의 노트 배열. folderOf·folders·matches: 지금 노트 화면의 값.
export function createNoteBoards({esc, rt, wide, bar, side, notes, folderOf, folders, matches, rerender, toast, refresh, scope}) {
  let boards = parseBoards(viewPrefs.get('note_boards')), current = pickBoard(viewPrefs.get('note_board'), boards), chosen = false;
  let openSet = new Set(), menu = null, picker = null;
  const named = () => current !== ALL && boards.some(b => b.id === current);
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
    const next = id === ALL || boards.some(b => b.id === id) ? id : ALL;
    chosen = true; closeMenu();
    if (next === current) return;
    current = next; viewPrefs.set('note_board', current, {rejectable:true});
    rerender();
  }

  // 보드 칸 줄. 고른 보드는 aria-pressed. 이름 붙은 보드 칸은 우클릭·꾹 누르기로 메뉴(보드 칸 자체가 메뉴를 연다, ⋯ 없음).
  function paintBar() {
    const phoneAdd = named() && !wide.matches;
    bar.innerHTML = `<button type="button" class="nbb-chip" data-nbb-board="${ALL}" aria-pressed="${current === ALL}">전체</button>${boards.map(b => `<button type="button" class="nbb-chip" data-nbb-board="${esc(b.id)}" aria-pressed="${current === b.id}" aria-haspopup="true" title="우클릭(폰은 꾹 누르기): 이름 바꾸기·지우기">${esc(b.name)}</button>`).join('')}${boards.length < BOARD_LIMITS.count ? '<button type="button" class="nbb-new" data-nbb-new>+ 새 보드</button>' : ''}${phoneAdd ? '<button type="button" class="nbb-new nbb-attach" data-nbb-pick>+ 노트 붙이기</button>' : ''}`;
  }
  // PC 왼쪽 목록: 노트 화면과 같은 폴더 나무(note-tree.mjs treeRows) + 그 안 노트. 이미 붙은 노트는 흐리게(끌 수 없음).
  function paintSide() {
    const show = named() && wide.matches;
    side.hidden = !show; side.parentElement?.classList.toggle('nbw-split', show);
    if (!show) { side.replaceChildren(); return; }
    const all = notes.get(), m = matches();
    // 폴더가 하나도 없으면 노트가 바로 한 목록(폴더 없음 묶음도 펼쳐 둔다).
    if (!folders().length) openSet.add(OUTSIDE);
    const rows = treeRows({folders:folders(), notes:all, folderOf, root:null, isOpen:id => openSet.has(id), matches:m});
    const html = rows.map(r => {
      if (r.type === 'folder' || r.type === 'outside') {
        const name = r.type === 'outside' ? OUTSIDE_NAME : r.name;
        return `<button type="button" class="nbb-folder" data-nbb-folder="${esc(r.id)}" aria-expanded="${!!r.open}" style="--nx-indent:${r.indent}"><span class="nbb-caret" aria-hidden="true">${r.open ? '▾' : '▸'}</span><span class="nbb-name">${esc(name)}</span><span class="nbb-num">${r.count}</span></button>`;
      }
      const on = onBoard(r.note, current), title = [...noteLineTitle(r.note)].slice(0, 60).join('');
      return `<button type="button" class="nbb-note${on ? ' nbb-on' : ''}" data-nbb-note="${esc(r.note.id)}" draggable="${on ? 'false' : 'true'}" style="--nx-indent:${r.indent}"${on ? ' aria-disabled="true" title="이미 붙어 있음"' : ' title="끌어다 놓거나 누르면 보드에 붙어요"'}><span class="nbb-name">${esc(title)}</span></button>`;
    }).join('');
    side.innerHTML = `<div class="nbb-side-head" aria-hidden="true">노트 목록</div><div class="nbb-side-list" role="group" aria-label="붙일 노트">${html || emptyHtml('노트 없음')}</div>`;
  }
  function paint() { paintBar(); paintSide(); }

  // 판에 그릴 값(basket-notes.js paintBoard가 note-board.js에 넘긴다).
  function boardView() {
    if (!named()) return null;
    const id = current;
    return {notes:notesOnBoard(notes.get(), id), placeOf:n => boardPlaceOf(n, id), removable:true,
      emptyText:wide.matches ? '왼쪽 노트를 끌어다 놓으세요' : '[+ 노트 붙이기]로 노트를 고르세요'};
  }

  // 붙이기·빼기·옮기기. 화면은 바로 바꾸고(서버 답을 기다리지 않음) 실패하면 알리고 다시 불러온다.
  const localPlace = (nid, boardId, place) => notes.set(list => list.map(n => {
    if (n.id !== nid) return n;
    const meta = n.metadata && typeof n.metadata === 'object' ? {...n.metadata} : {};
    const all = meta.boards && typeof meta.boards === 'object' && !Array.isArray(meta.boards) ? {...meta.boards} : {};
    if (place) all[boardId] = {x:place.x, y:place.y, r:place.r, z:place.z}; else delete all[boardId];
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
  // point: 판 좌표(끌어 놓은 곳). 없으면(누르기·폰 고르기) 빈 곳부터 차례로.
  function attach(ids, point = null, places = null) {
    if (!named()) return;
    const id = current, all = notes.get(), fresh = ids.filter(nid => all.some(n => n.id === nid) && !all.some(n => n.id === nid && onBoard(n, id)));
    if (!fresh.length) return;
    let placed;
    if (point && fresh.length === 1) placed = new Map([[fresh[0], dropPlace(fresh[0], point, places || new Map())]]);
    else {
      const set = new Set(fresh), on = notesOnBoard(all, id);
      const layout = layoutBoard([...on, ...all.filter(n => set.has(n.id))], folderOf, n => (set.has(n.id) ? null : boardPlaceOf(n, id)));
      placed = new Map(fresh.map(nid => { const p = layout.get(nid); return [nid, {x:p.x, y:p.y, r:p.r, z:p.z}]; }));
    }
    for (const [nid, p] of placed) localPlace(nid, id, p);
    rerender();
    void store([...placed].map(([nid, p]) => [nid, id, p]), '보드에 붙이지 못했어요. 다시 불러올게요.');
  }
  function detach(nid) {
    if (!named()) return;
    const id = current; localPlace(nid, id, null); rerender();
    void store([[nid, id, null]], '보드에서 빼지 못했어요. 다시 불러올게요.');
  }
  function move(nid, next) {
    if (!named()) return;
    const id = current; localPlace(nid, id, next);
    void store([[nid, id, next]], '포스트잇 자리를 저장하지 못했어요. 다시 불러올게요.');
  }

  // 보드 만들기·이름·지우기(이름은 노트 폴더와 같은 창).
  const askBoardName = (text, value = '') => window.prompt(`${text} (${BOARD_LIMITS.name}자까지)`, value);
  function create() {
    const typed = askBoardName('새 보드 이름'); if (typed === null) return;
    try { const r = addBoard(boards, typed); boards = r.boards; saveBoards(); select(r.board.id); if (current !== r.board.id) rerender(); }
    catch (e) { toast(e.message); }
  }
  function rename(id) {
    const typed = askBoardName('보드 이름 바꾸기', boardName(id)); if (typed === null || typed.trim() === boardName(id)) return;
    try { boards = renameBoard(boards, id, typed); saveBoards(); rerender(); } catch (e) { toast(e.message); }
  }
  async function remove(id, trigger) {
    const name = boardName(id), on = notesOnBoard(notes.get(), id);
    if (!await askConfirm(trigger || bar, {text:`'${name}' 보드를 지울까요?`, note:`붙은 노트 ${on.length}개는 지우지 않아요(보드에서만 빠져요).`, ok:'지우기', danger:true})) return;
    boards = removeBoard(boards, id); saveBoards();
    if (current === id) { current = ALL; viewPrefs.set('note_board', ALL, {rejectable:true}); }
    for (const n of on) localPlace(n.id, id, null);
    rerender();
    // 지운 보드의 자리도 노트에서 지운다(남아도 화면은 무시하지만, 노트 metadata를 깨끗이).
    void store(on.map(n => [n.id, id, null]), '지운 보드의 노트 자리를 다 정리하지 못했어요. 노트는 그대로예요.');
  }

  // 보드 칸 메뉴(노트 메뉴와 같은 모양의 작은 창).
  function menuEl() {
    let el = bar.parentElement.querySelector('[data-nbb-menu]');
    if (!el) { el = document.createElement('div'); el.className = 'basket-more-menu note-pop-menu nbb-menu'; el.dataset.nbbMenu = ''; el.setAttribute('role', 'group'); el.setAttribute('aria-label', '보드 메뉴'); el.hidden = true; bar.after(el); }
    return el;
  }
  function openMenu(chip) {
    const id = chip.dataset.nbbBoard; if (!id || id === ALL) return;
    closeMenu();
    const el = menuEl();
    el.innerHTML = '<button type="button" data-nbb-rename>이름 바꾸기</button><button type="button" class="basket-menu-danger" data-nbb-delete>보드 지우기</button>';
    el.hidden = false;
    const place = () => placeAnchored(el, chip, {maxWidth:200, maxHeight:200});
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
    if (inMenu) { e.stopPropagation(); const m = closeMenu({focus:true}); if (!m) return; if (b.hasAttribute('data-nbb-rename')) rename(m.id); else if (b.hasAttribute('data-nbb-delete')) void remove(m.id, m.chip); return; }
    if (!bar.contains(b)) return;
    if (Date.now() < suppress) { e.preventDefault(); return; }
    if (b.dataset.nbbBoard) select(b.dataset.nbbBoard);
    else if (b.hasAttribute('data-nbb-new')) create();
    else if (b.hasAttribute('data-nbb-pick')) openPicker(b);
  });
  document.addEventListener('click', e => { if (menu && !menuEl().contains(e.target) && !menu.chip.contains(e.target)) closeMenu(); });
  bar.parentElement.addEventListener('keydown', e => {
    if (e.key === 'Escape' && menu) { e.preventDefault(); e.stopPropagation(); closeMenu({focus:true}); return; }
    const chip = e.target.closest?.('[data-nbb-board]');
    if (chip && (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) { e.preventDefault(); openMenu(chip); }
    if (chip && e.key === 'F2' && chip.dataset.nbbBoard !== ALL) { e.preventDefault(); rename(chip.dataset.nbbBoard); }
  });
  // PC 우클릭: 이 칸의 메뉴(공용 context-menu.js보다 먼저, 브라우저 메뉴 대신).
  bar.addEventListener('contextmenu', e => { const chip = e.target.closest('[data-nbb-board]'); if (!chip || chip.dataset.nbbBoard === ALL) return; e.preventDefault(); e.stopPropagation(); openMenu(chip); });
  // 폰 꾹 누르기.
  let press = null, suppress = 0;
  bar.addEventListener('pointerdown', e => {
    const chip = e.target.closest('[data-nbb-board]'); if (!chip || e.pointerType === 'mouse' || chip.dataset.nbbBoard === ALL) return;
    press = {chip, x:e.clientX, y:e.clientY, timer:setTimeout(() => { press = null; suppress = Date.now() + 600; try { navigator.vibrate?.(12); } catch { /* 진동 없음 */ } openMenu(chip); }, LONG_MS)};
  });
  const endPress = () => { if (press) { clearTimeout(press.timer); press = null; } };
  bar.addEventListener('pointermove', e => { if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > SLOP) endPress(); });
  bar.addEventListener('pointerup', endPress); bar.addEventListener('pointercancel', endPress);

  // PC 왼쪽 목록: 폴더 펴기·접기, 노트 누르기 = 빈 곳에 붙이기, 끌기 = 놓은 곳에 붙이기.
  side.addEventListener('click', e => {
    const f = e.target.closest('[data-nbb-folder]');
    if (f) { const id = f.dataset.nbbFolder; if (openSet.has(id)) openSet.delete(id); else openSet.add(id); paintSide(); side.querySelector(`[data-nbb-folder="${CSS.escape(id)}"]`)?.focus({preventScroll:true}); return; }
    const n = e.target.closest('[data-nbb-note]');
    if (n && n.getAttribute('aria-disabled') !== 'true') attach([n.dataset.nbbNote]);
  });
  side.addEventListener('dragstart', e => {
    const n = e.target.closest?.('[data-nbb-note]');
    if (!n || n.getAttribute('aria-disabled') === 'true') { e.preventDefault(); return; }
    e.dataTransfer.setData(NOTE_DRAG, n.dataset.nbbNote); e.dataTransfer.effectAllowed = 'copy';
  });

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
      const rows = treeRows({folders:folders(), notes:notes.get(), folderOf, root:null, isOpen:id => state.open.has(id), matches:m});
      list.innerHTML = rows.map(r => {
        if (r.type !== 'note') return `<button type="button" class="nbb-folder" data-nbb-pf="${esc(r.id)}" aria-expanded="${!!r.open}" style="--nx-indent:${r.indent}"><span class="nbb-caret" aria-hidden="true">${r.open ? '▾' : '▸'}</span><span class="nbb-name">${esc(r.type === 'outside' ? OUTSIDE_NAME : r.name)}</span><span class="nbb-num">${r.count}</span></button>`;
        const on = onBoard(r.note, current), sel = state.picked.has(r.note.id);
        return `<button type="button" class="nbb-note${on ? ' nbb-on' : ''}" data-nbb-pn="${esc(r.note.id)}" aria-pressed="${on || sel}"${on ? ' aria-disabled="true"' : ''} style="--nx-indent:${r.indent}"><span class="nbb-check" aria-hidden="true">${on || sel ? '✓' : ''}</span><span class="nbb-name">${esc([...noteLineTitle(r.note)].slice(0, 60).join(''))}</span></button>`;
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
      else if (b.hasAttribute('data-nbb-pick-ok')) { const ids = [...state.picked]; finish(); attach(ids); }
    });
    dlg.addEventListener('input', e => { if (e.target.matches('[data-nbb-pick-find]')) { state.q = e.target.value.trim().toLowerCase(); paintPick(); } });
    dlg.addEventListener('cancel', e => { e.preventDefault(); finish(); });
    paintPick();
    dlg.showModal();
    layer = window.KPTURouter?.layer?.open('note-board-pick', {close:() => { layer = null; finish(); return true; }}) || null;
  }

  return {
    paint, boardView, attach, detach, move,
    current:() => current, isNamed:named, name:boardName,
    reset() { closeMenu(); picker?.close(); openSet = new Set(); },
  };
}
