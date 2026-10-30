// NOTE-보기3가지: 노트 [포스트잇] 보기 — 화면보다 넓은 보드 위에 같은 크기 포스트잇을 아무 데나 끌어다 놓고 겹쳐 붙인다.
// 이 모듈은 보드 칸 하나만 그린다(한 화면 영역 = 한 그리는 곳). 노트 목록·저장·메뉴는 basket-notes.js가 맡는다:
// - 칸의 [열기]는 basket-notes.js의 노트 줄과 같은 data-note-row 단추라 누르면 같은 길로 열린다(선택 모드면 고르기).
// - 칸의 작은 ⋯는 같은 data-note-row-more 단추(PC 우클릭은 공용 context-menu.js가 이 ⋯를 누른다). 폰 꾹 눌렀다 떼기는 onMenu(꾹 누른 뒤 끌면 옮기기).
// - 끌어 놓으면 onMove(id, board, places)로 알린다(저장은 부르는 쪽, metadata.board). 끄는 칸은 바로 맨 위로 올라온다.
// 보드는 밀어서 이동(브라우저 스크롤), 두 손가락 벌리기·오므리기와 [＋][－]로 크게·작게(사진 격자와 같은 공용 핀치 부품 photo-grid-size.js attachPinch).
// 확대 단계는 이번 접속 화면 메모리만(저장할 값 아님). 기기 저장 없음.
// NOTE-보드여러개: 같은 그리는 곳이 [전체]와 이름 붙은 보드를 다 그린다. paint의 placeOf가 어느 자리 값을 읽을지(기본 [전체] metadata.board),
// removable이면 칸에 작은 ×(보드에서 빼기, data-nb-remove — 누르기는 basket-notes.js), empty는 빈 판의 한 줄.
// PC 왼쪽 노트 목록에서 끌어 온 노트(드래그 자료 형식 NOTE_DRAG)를 판에 놓으면 onDrop(id, 보드 좌표)로 알린다.
import { attachPinch } from './photo-grid-size.js';
import { LONG_MS, SLOP } from './reorder-drag.js';
import { layoutBoard, boardExtent, topZ, movedTo, stepZoom, folderTone, CARD } from './note-board-model.mjs';

const EDGE = 40, KEY_STEP = 10;
export const NOTE_DRAG = 'application/x-kptu-note';

// moreIcon: 노트 줄과 같은 ⋯ 그림(basket-notes.js의 것을 받아 같은 메뉴 단추 모양을 쓴다).
export function mountNoteBoard(box, {esc, cardText, moreIcon, onMenu = () => {}, onMove = () => {}, onDrop = null}) {
  box.innerHTML = `<div class="nb-tools" role="group" aria-label="보드 크기"><button type="button" data-nb-zoom="-1" aria-label="작게">－</button><button type="button" data-nb-zoom="1" aria-label="크게">＋</button></div><div class="nb-scroll" data-nb-scroll><div class="nb-sizer" data-nb-sizer><div class="nb-board" data-nb-board role="group" aria-label="포스트잇 보드"></div></div><p class="nb-empty" data-nb-empty hidden></p></div>`;
  const empty = box.querySelector('[data-nb-empty]'), scroll = box.querySelector('[data-nb-scroll]'), sizer = box.querySelector('[data-nb-sizer]'), board = box.querySelector('[data-nb-board]');
  let zoom = globalThis.matchMedia?.('(min-width:761px)')?.matches ? 1 : 0.8;
  let places = new Map(), extent = {w:0, h:0}, drag = null, suppressUntil = 0, keyTimer = null;

  function paintZoom() {
    sizer.style.width = `${Math.round(extent.w * zoom)}px`; sizer.style.height = `${Math.round(extent.h * zoom)}px`;
    board.style.width = `${extent.w}px`; board.style.height = `${extent.h}px`; board.style.transform = `scale(${zoom})`;
    box.querySelectorAll('[data-nb-zoom]').forEach(b => { b.disabled = stepZoom(zoom, Number(b.dataset.nbZoom)) === zoom; b.title = `${Math.round(zoom * 100)}%`; });
  }
  function setZoom(next) {
    if (next === zoom) return false;
    const cx = (scroll.scrollLeft + scroll.clientWidth / 2) / zoom, cy = (scroll.scrollTop + scroll.clientHeight / 2) / zoom;
    zoom = next; paintZoom();
    scroll.scrollLeft = cx * zoom - scroll.clientWidth / 2; scroll.scrollTop = cy * zoom - scroll.clientHeight / 2;
    return true;
  }
  const cardHtml = (note, p, info) => `<div class="nb-card${info.picked ? ' nb-picked' : ''}" data-nb-card="${esc(note.id)}" data-tone="${folderTone(info.folderId)}" style="left:${p.x}px;top:${p.y}px;z-index:${p.z + 1};--nb-r:${p.r}deg"><button type="button" class="nb-open" data-note-row="${esc(note.id)}"${info.pickActive ? ` aria-pressed="${!!info.picked}"` : ''} aria-roledescription="포스트잇"><b class="nb-title">${esc(info.title)}</b>${info.text ? `<span class="nb-text">${esc(info.text)}</span>` : ''}${info.folder ? `<span class="nb-folder">${esc(info.folder)}</span>` : ''}</button>${info.removable ? `<button type="button" class="nb-x" data-nb-remove="${esc(note.id)}" aria-label="${esc(info.title)} 보드에서 빼기" title="보드에서 빼기">×</button>` : ''}<button type="button" class="basket-row-more nb-more" data-note-row-more="${esc(note.id)}" aria-label="${esc(info.title)} 메뉴" aria-haspopup="true" aria-expanded="false" aria-controls="noteDocMenu">${moreIcon}</button></div>`;
  // notes: 모든 노트(자리 계산은 전체로), visible: 그릴 노트 id(찾는 중이면 맞는 것만). folderOf(note) → 폴더 id 또는 null.
  function paint({notes, folderOf, visible = null, pickActive = false, isPicked = () => false, placeOf = undefined, removable = false, emptyText = ''}) {
    if (drag) cancelDrag();
    places = layoutBoard(notes, folderOf, placeOf); extent = boardExtent(places);
    empty.textContent = emptyText; empty.hidden = !emptyText || notes.length > 0;
    const focused = document.activeElement?.closest?.('[data-nb-card]')?.dataset.nbCard;
    board.innerHTML = notes.filter(n => !visible || visible.has(n.id)).map(n => { const fid = folderOf(n); return cardHtml(n, places.get(n.id), {...cardText(n, fid), folderId:fid, pickActive, picked:isPicked(n.id), removable}); }).join('');
    paintZoom();
    if (focused) board.querySelector(`[data-nb-card="${CSS.escape(focused)}"] .nb-open`)?.focus({preventScroll:true});
  }
  const pointOf = e => { const r = scroll.getBoundingClientRect(); return {x:(e.clientX - r.left + scroll.scrollLeft) / zoom, y:(e.clientY - r.top + scroll.scrollTop) / zoom}; };
  const raise = (card, z) => { card.style.zIndex = String(z + 1); };
  // NOTE-포스트잇끌기 (요청함 10/30 14:09 "둘 다 되게"): 폰 한 손가락은 바로 끌어도, 꾹 누른 뒤 끌어도 옮긴다.
  // 꾹 누르면(LONG_MS) 칸이 살짝 떠오르고(nb-held) 진동만 한다. 노트 메뉴는 꾹 누른 뒤 움직이지 않고 손을 뗄 때만 연다(메뉴가 끌기를 끊지 않음).
  // 끄는 동안(잡힘·끌기) 문서 당김(당겨서 새로고침·튕김)이 일어나지 않게 html에 nb-drag-on을 둔다(basket.css overscroll-behavior:none).
  const dragOn = on => document.documentElement.classList.toggle('nb-drag-on', on);
  function stopEdge() { if (drag?.edge) { cancelAnimationFrame(drag.edge); drag.edge = 0; } }
  function cancelDrag() {
    if (!drag) return;
    clearTimeout(drag.timer); stopEdge();
    const {card, place} = drag; drag = null; dragOn(false);
    card.classList.remove('nb-dragging', 'nb-held'); card.style.left = `${place.x}px`; card.style.top = `${place.y}px`; raise(card, place.z);
  }
  function follow() { // 마지막 손가락 자리로 칸을 옮긴다(가장자리 자동 스크롤 중에도 같은 계산 — 배율 반영)
    const p = pointOf(drag.last);
    drag.card.style.left = `${Math.max(0, drag.place.x + p.x - drag.start.x)}px`; drag.card.style.top = `${Math.max(0, drag.place.y + p.y - drag.start.y)}px`;
  }
  // 꾹 누르고 움직이지 않고 뗌 = 노트 메뉴. 터치는 손가락을 뗀 touchend에서 연다(브라우저가 꾹 누르기 끝을 pointerup 대신
  // pointercancel로 보내도 메뉴가 뜨게 — 노트 목록·자료실 꾹 누르기와 같은 때). 마우스·펜은 꾹 누르기가 없다.
  let heldUp = null;
  function heldMenu(d) {
    heldUp = null; suppressUntil = Date.now() + 600;
    const btn = d.card.isConnected && d.card.querySelector('.nb-more'); if (btn) onMenu(btn, d.x, d.y);
  }
  function finish(e) {
    const d = drag; stopEdge(); drag = null; clearTimeout(d.timer); dragOn(false);
    d.card.classList.remove('nb-dragging', 'nb-held');
    if (!d.moving) { if (d.held) heldMenu(d); return; } // 짧게 누르고 뗌 = 열기(click이 맡는다)
    suppressUntil = Date.now() + 400;
    const p = pointOf(e), next = movedTo(d.place, p.x - d.start.x, p.y - d.start.y, topZ(places));
    const before = new Map(places); // 옮기기 전 자리(아직 저장 안 된 칸은 이 자리로 함께 저장)
    places.set(d.id, {...next, saved:true});
    d.card.style.left = `${next.x}px`; d.card.style.top = `${next.y}px`; raise(d.card, next.z);
    onMove(d.id, next, before);
  }
  // 끌기 중 손가락이 판 가장자리(EDGE) 안에 있으면 멈춰 있어도 판이 계속 밀린다(한 프레임에 14px).
  function edgeStep(x, y) {
    const r = scroll.getBoundingClientRect();
    return {dx:x < r.left + EDGE ? -14 : x > r.right - EDGE ? 14 : 0, dy:y < r.top + EDGE ? -14 : y > r.bottom - EDGE ? 14 : 0};
  }
  function edgeScroll(e) { const {dx, dy} = edgeStep(e.clientX, e.clientY); if (dx || dy) scroll.scrollBy(dx, dy); }
  function edgeLoop() {
    if (!drag?.moving) return;
    const {dx, dy} = edgeStep(drag.last.clientX, drag.last.clientY);
    if (!dx && !dy) { drag.edge = 0; return; }
    const sl = scroll.scrollLeft, st = scroll.scrollTop; scroll.scrollBy(dx, dy);
    if (scroll.scrollLeft !== sl || scroll.scrollTop !== st) follow();
    drag.edge = requestAnimationFrame(edgeLoop);
  }
  box.addEventListener('pointerdown', e => {
    if (!e.isPrimary) { cancelDrag(); return; } // 두 번째 손가락이면 끌기 대신 핀치
    const card = e.target.closest?.('[data-nb-card]');
    if (!card || !box.contains(card) || e.target.closest('.nb-more,.nb-x') || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const id = card.dataset.nbCard, place = places.get(id); if (!place) return;
    if (drag) cancelDrag();
    drag = {id, card, place, start:pointOf(e), x:e.clientX, y:e.clientY, last:{clientX:e.clientX, clientY:e.clientY}, moving:false, held:false, touch:e.pointerType !== 'mouse', pointerId:e.pointerId, timer:null, edge:0};
    if (drag.touch) {
      dragOn(true);
      drag.timer = setTimeout(() => { // 폰: 움직이지 않고 꾹 누르면 잡힘 표시만(메뉴는 손을 뗄 때)
        if (!drag || drag.card !== card || drag.moving) return;
        drag.held = true; card.classList.add('nb-held'); raise(card, topZ(places) + 1);
        try { navigator.vibrate?.(12); } catch { /* 진동 없음 */ }
      }, LONG_MS);
    }
  });
  box.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    drag.last = {clientX:e.clientX, clientY:e.clientY};
    if (!drag.moving) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) <= (drag.touch ? SLOP : 4)) return;
      drag.moving = true; clearTimeout(drag.timer);
      drag.card.classList.remove('nb-held'); drag.card.classList.add('nb-dragging'); raise(drag.card, topZ(places) + 1);
      try { drag.card.setPointerCapture(e.pointerId); } catch { /* 잡기 실패해도 움직임은 받는다 */ }
    }
    e.preventDefault(); follow();
    if (drag.touch) { if (!drag.edge) drag.edge = requestAnimationFrame(edgeLoop); }
    else edgeScroll(e);
  });
  const up = e => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (drag.touch && drag.held && !drag.moving) { const d = drag; cancelDrag(); heldUp = d; suppressUntil = Date.now() + 600; return; } // 메뉴는 touchend
    if (e.type === 'pointercancel') cancelDrag(); else finish(e);
  };
  box.addEventListener('pointerup', up); box.addEventListener('pointercancel', up);
  // 터치는 처음 누른 안쪽 요소(제목 글자 등)가 저절로 잡고 있다가, 끌기 시작에 칸으로 잡기를 옮기면 그 안쪽 요소에 lostpointercapture가 와서 칸까지 올라온다.
  // 그것을 끌기 끝으로 보면 8px쯤 움직이고 바로 놓인다(폰 '바로 끌기가 잘 안 됨'의 원인). 칸 자체가 잡기를 잃었을 때만 끝낸다.
  box.addEventListener('lostpointercapture', e => { if (drag && drag.moving && e.pointerId === drag.pointerId && e.target === drag.card) finish(e); });
  // 칸을 누르고 있는 동안의 touchmove는 브라우저 몫(스크롤·당겨서 새로고침·튕김)으로 넘기지 않는다. 판 빈 곳은 그대로 판 밀기.
  box.addEventListener('touchmove', e => { if (drag?.touch && e.touches.length === 1 && e.cancelable) e.preventDefault(); }, {passive:false});
  box.addEventListener('touchend', e => { if (heldUp && !e.touches.length) { if (e.cancelable) e.preventDefault(); heldMenu(heldUp); } });
  box.addEventListener('touchcancel', () => { heldUp = null; });
  box.addEventListener('pointerdown', () => { heldUp = null; }, true);
  // 끈 뒤·꾹 누른 뒤의 클릭은 열기가 아니다.
  // 막는 것은 칸 열기(.nb-open)뿐: 칸의 ×(보드에서 빼기)·⋯(메뉴)는 끈 바로 뒤에도 누를 수 있다.
  box.addEventListener('click', e => { if (Date.now() < suppressUntil && e.target.closest?.('[data-nb-card] .nb-open')) { e.preventDefault(); e.stopPropagation(); } }, true);
  box.addEventListener('contextmenu', e => { if (drag?.touch || Date.now() < suppressUntil) e.preventDefault(); }, true);
  box.addEventListener('click', e => { const b = e.target.closest?.('[data-nb-zoom]'); if (b && !b.disabled) setZoom(stepZoom(zoom, Number(b.dataset.nbZoom))); });
  // 키보드: 칸에 초점을 두고 화살표로 옮긴다(Shift = 4배). 0.5초 멈추면 저장.
  box.addEventListener('keydown', e => {
    const dir = {ArrowLeft:[-1, 0], ArrowRight:[1, 0], ArrowUp:[0, -1], ArrowDown:[0, 1]}[e.key];
    const card = e.target.closest?.('[data-nb-card]'); if (!dir || !card || e.altKey || e.ctrlKey || e.metaKey) return;
    const id = card.dataset.nbCard, place = places.get(id); if (!place) return;
    e.preventDefault();
    const step = KEY_STEP * (e.shiftKey ? 4 : 1), before = keyTimer ? null : new Map(places);
    const next = movedTo(place, dir[0] * step, dir[1] * step, place.z === topZ(places) ? place.z - 1 : topZ(places)); // 이미 맨 위면 순서 그대로
    places.set(id, {...next, saved:place.saved}); card.style.left = `${next.x}px`; card.style.top = `${next.y}px`; raise(card, next.z);
    card.querySelector('.nb-open')?.scrollIntoView?.({block:'nearest', inline:'nearest'});
    const pending = keyTimer?.before || before; clearTimeout(keyTimer?.id);
    keyTimer = {before:pending, id:setTimeout(() => { const b = keyTimer.before; keyTimer = null; places.set(id, {...places.get(id), saved:true}); onMove(id, places.get(id), b); }, 500)};
  });
  // PC: 왼쪽 목록의 노트를 끌어 판에 놓기(브라우저 끌어 놓기). 다른 끌기(파일 등)는 받지 않는다.
  const noteDrag = e => !!onDrop && [...(e.dataTransfer?.types || [])].includes(NOTE_DRAG);
  scroll.addEventListener('dragover', e => { if (!noteDrag(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; edgeScroll(e); box.classList.add('nb-drop'); });
  scroll.addEventListener('dragleave', e => { if (!scroll.contains(e.relatedTarget)) box.classList.remove('nb-drop'); });
  scroll.addEventListener('drop', e => {
    box.classList.remove('nb-drop');
    if (!noteDrag(e)) return;
    e.preventDefault();
    const id = e.dataTransfer.getData(NOTE_DRAG); if (id) onDrop(id, pointOf(e), new Map(places));
  });
  attachPinch(scroll, null, dir => setZoom(stepZoom(zoom, dir)));
  return {
    paint,
    isDragging: () => !!drag?.moving,
    places: () => new Map(places),
    cardSize: CARD,
  };
}
