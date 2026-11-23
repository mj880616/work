// NOTE-보기3가지 → S68-38(명진 11/23 08:12·08:23, Obsidian Canvas 참고): 노트 [보드] 보기(옛 이름 포스트잇) — 생각 지도.
// 이 모듈은 보드 칸 하나만 그린다(한 화면 영역 = 한 그리는 곳). 노트 목록·저장·메뉴는 basket-notes.js, 보드 고르기는 note-boards.js가 맡는다.
// - 판: 끝없이 넓은 캔버스처럼 한 손가락(마우스) 빈 곳 끌기 = 판 이동, 두 손가락 벌리기·오므리기·Ctrl+휠 = 확대·축소(손가락 가운데 기준),
//   휠 = 판 이동, [－][＋]·[전체](모든 카드가 보이게). 보기 자리·배율은 이번 접속 화면 메모리만(보드마다 따로, 저장 값 아님). 기기 저장 없음.
// - 카드: 제목 한 줄만 보이는 작은 칸(note-board-model.mjs CARD_W×CARD_H, 폴더 색). 누름 = 노트 열기(basket-notes.js 노트 줄과 같은 data-note-row 단추).
//   끌기(폰은 바로 끌기·꾹 누른 뒤 끌기 둘 다) = 자리 옮기기 → onMove(id, next, before)(저장은 부르는 쪽). 꾹 누름·끌기·키보드 초점 = 고르기:
//   고른 카드(PC는 마우스를 올린 카드도)에만 작은 ×(보드에서 빼기, 이름 붙은 보드)·⋯(노트 메뉴)와 네 변의 손잡이가 보인다.
//   PC 우클릭은 그 카드를 고른 뒤 공용 context-menu.js가 ⋯를 누른다.
// - 연결선: 손잡이(상·하·좌·우)를 끌어 다른 카드에 놓으면 화살표(놓은 곳에 가까운 변). 기본 곡선·실선·끝에 화살촉. 선을 누르면 작은 메뉴
//   [실선|점선] [직선으로] [→|↔|없음] [뒤집기] [글자] [삭제]. 카드를 옮기면 선이 따라온다. 선 계산은 note-board-links-model.mjs,
//   저장은 부르는 쪽(onLinkAdd·onLinkChange·onLinkRemove → note-board-links-data.js, 서버 표 app_note_board_links).
//   S68-38c(명진 11/23 08:32): 새 선은 직선. 선 위 아무 곳을 누른 채 끌면 그 점을 지나는 곡선(끄는 동안 바로 보임, 판 이동보다 먼저),
//   거의 일직선으로 되돌리면 직선. 짧게 누르면 선 메뉴(끌기/누르기는 움직인 거리로 구분). 지나는 점은 두 끝점 기준 상대 위치로 저장(카드를 옮겨도 따라옴).
// - 글 상자(S68-38c, 명진 11/23 08:47): [+ 글 상자] 단추·빈 곳 두 번 누르기(PC 더블클릭)로 그 보드에만 있는 짧은 글(노트가 아님).
//   누르면 바로 글 고치기(그 자리 입력칸, 바깥 누르기·Ctrl+Enter = 저장, Esc = 취소), 끌기(폰은 꾹 누른 뒤 끌기도) = 옮기기, 꾹 누름·초점 = 고르기:
//   고른 상자에 [삭제]와 네 변 손잡이. 카드처럼 선을 잇고 받는다(노트↔노트·노트↔글 상자·글 상자↔글 상자). 크기는 글에 맞춤(최대 폭에서 줄바꿈).
//   저장은 부르는 쪽(onTextAdd·onTextChange·onTextRemove → note-board-links-data.js, 서버 표 app_note_board_texts).
// - 화면 밖 카드·선은 그리지 않는다(판을 옮기거나 키울 때 보이는 것만 붙이고 뗌) — 카드·선 수백 개도 가볍게.
// - PC 왼쪽 노트 목록에서 끌어 온 노트(드래그 자료 형식 NOTE_DRAG)를 판에 놓으면 onDrop(id, 판 좌표, places).
import { multiTouchActive, onMultiTouch } from './photo-grid-size.js';
import { LONG_MS, SLOP } from './reorder-drag.js';
import { askText } from './small-notice.js';
import { bottomInset, keepInside } from './anchored-popup.js';
import { layoutBoard, topZ, movedTo, stepZoom, zoomAt, toBoard, fitView, visibleArea, rectsMeet, cardRect, folderTone, clampZoom, CARD_W, CARD_H } from './note-board-model.mjs';
import { linkGeometry, dragPath, linkBox, nearestSide, rectOf, flipPatch, validateLabel, hasLink, endId, endFields, bendOf, bendPatch, isBent, isStraight, validateText,
  LABEL_MAX, LINK_LIMIT, TEXT_MAX, TEXT_LIMIT, SIDES, ENDS_NAMES } from './note-board-links-model.mjs';

const EDGE = 36, KEY_STEP = 10, EDGE_STEP = 14;
export const NOTE_DRAG = 'application/x-kptu-note';
let uid = 0;

// moreIcon: 노트 줄과 같은 ⋯ 그림(basket-notes.js의 것을 받아 같은 메뉴 단추 모양을 쓴다).
export function mountNoteBoard(box, {esc, cardText, moreIcon, onMenu = () => {}, onBackgroundMenu = null, onMove = () => {}, onDrop = null,
  onLinkAdd = () => {}, onLinkChange = () => {}, onLinkRemove = () => {}, onTextAdd = () => {}, onTextChange = () => {}, onTextRemove = () => {}, canText = () => true, toast = () => {}}) {
  const mark = `nb${++uid}`;
  box.innerHTML = `<div class="nb-tools" role="group" aria-label="보드 도구"><button type="button" class="icon-btn nb-add-text" data-nb-add-text title="글 상자 더하기 (빈 곳 두 번 누르기)">+ 글 상자</button><button type="button" class="icon-btn" data-nb-zoom="-1" aria-label="작게">－</button><button type="button" class="icon-btn" data-nb-zoom="1" aria-label="크게">＋</button><button type="button" class="icon-btn nb-fit" data-nb-fit aria-label="전체 보기" title="전체 보기">전체</button></div><div class="nb-scroll" data-nb-scroll><div class="nb-board" data-nb-board role="group" aria-label="노트 보드"><svg class="nb-links" data-nb-links width="${20000}" height="${20000}" focusable="false"><defs><marker id="${mark}-a" class="nb-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z"/></marker><marker id="${mark}-s" class="nb-arrow nb-arrow-sel" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z"/></marker></defs><g data-nb-lines></g><path class="nb-temp" data-nb-temp d="" hidden/></svg><div class="nb-texts" data-nb-texts></div><div class="nb-cards" data-nb-cards></div></div><p class="nb-empty" data-nb-empty hidden></p></div>`;
  const empty = box.querySelector('[data-nb-empty]'), scroll = box.querySelector('[data-nb-scroll]'), board = box.querySelector('[data-nb-board]');
  const cardsBox = box.querySelector('[data-nb-cards]'), textsBox = box.querySelector('[data-nb-texts]'), linesBox = box.querySelector('[data-nb-lines]'), temp = box.querySelector('[data-nb-temp]');
  const views = new Map(); // 보드마다 보던 자리(이번 접속만)
  let view = {x:0, y:0, z:1}, key = null, frame = 0;
  let places = new Map(), shown = [], byId = new Map(), infoOf = new Map(), links = [], linkOn = new Set(), needFit = false;
  const cardEls = new Map(), lineEls = new Map(), textEls = new Map(), textSize = new Map();
  let texts = [], textById = new Map(), tdrag = null, textSel = null, editing = null, bend = null, lastTap = null, afterClick = null, bendEnded = false;
  let drag = null, pan = null, pinch = null, wire = null, selected = null, lineSel = null, menu = null, suppressUntil = 0, linesQuietUntil = 0, keyTimer = null, opts = {};
  const touches = new Map();
  const size = () => ({w:scroll.clientWidth, h:scroll.clientHeight});

  // ---- 판 보기 ----
  function paintView() {
    board.style.transform = `translate(${Math.round(view.x * 100) / 100}px,${Math.round(view.y * 100) / 100}px) scale(${view.z})`;
    box.querySelectorAll('[data-nb-zoom]').forEach(b => { b.disabled = stepZoom(view.z, Number(b.dataset.nbZoom)) === view.z; });
    box.querySelector('[data-nb-fit]').title = `전체 보기 (${Math.round(view.z * 100)}%)`;
    box.dataset.nbZoomNow = String(Math.round(view.z * 1000) / 1000);
    box.toggleAttribute('data-nb-small', view.z < 0.5);
    if (key) views.set(key, view);
  }
  function setView(next) { view = {x:next.x, y:next.y, z:clampZoom(next.z)}; paintView(); queue(); }
  const queue = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; sync(); }); };
  function fitBoard() {
    const {w, h} = size(), rects = [...shown.filter(n => isShown(n.id)).map(n => cardRect(places.get(n.id))), ...texts.map(t => textRect(t.id))];
    needFit = !w || !h; // 아직 화면에 안 보이면(크기 0) 보일 때 맞춘다
    setView(fitView(rects, w, h, 24, 1));
  }
  function zoomBy(dir, at = null) {
    const {w, h} = size(), p = at || {x:w / 2, y:h / 2};
    setView(zoomAt(view, stepZoom(view.z, dir), p.x, p.y));
  }

  // ---- 그리기 ----
  const isShown = id => !opts.visible || opts.visible.has(id);
  const cardHtml = (note, p, info) => {
    const sel = selected === note.id;
    return `<div class="nb-card${info.picked ? ' nb-picked' : ''}${sel ? ' nb-sel' : ''}" data-nb-card="${esc(note.id)}" data-tone="${folderTone(info.folderId)}"${info.color ? ` data-fc="${info.color}"` : ''} style="left:${p.x}px;top:${p.y}px;z-index:${p.z + 1}"><button type="button" class="nb-open" data-note-row="${esc(note.id)}"${opts.pickActive ? ` aria-pressed="${!!info.picked}"` : ''} aria-roledescription="노트 카드" title="${esc(info.title)}"><span class="nb-title">${esc(info.title)}</span></button>${opts.removable ? `<button type="button" class="nb-x" data-nb-remove="${esc(note.id)}" aria-label="${esc(info.title)} 보드에서 빼기" title="보드에서 빼기">×</button>` : ''}<button type="button" class="basket-row-more nb-more" data-note-row-more="${esc(note.id)}" aria-label="${esc(info.title)} 메뉴" aria-haspopup="true" aria-expanded="false" aria-controls="noteDocMenu">${moreIcon}</button>${opts.pickActive ? '' : SIDES.map(s => `<span class="nb-h nb-h-${s}" data-nb-handle="${s}" aria-hidden="true"></span>`).join('')}</div>`;
  };
  function addCard(id) {
    const note = byId.get(id), p = places.get(id), info = infoOf.get(id); if (!note || !p || !info) return;
    cardsBox.insertAdjacentHTML('beforeend', cardHtml(note, p, info));
    const el = cardsBox.lastElementChild;
    // 폰 브라우저는 누른 곳 근처의 '누를 수 있는' 요소로 손가락을 옮겨 잡는다(터치 보정). 손잡이도 누를 수 있는 요소로 알려 카드 열기 단추에 빼앗기지 않게.
    el.querySelectorAll('[data-nb-handle]').forEach(h => h.addEventListener('click', stopClick));
    cardEls.set(id, el);
  }
  const endTitle = id => infoOf.get(id)?.title || (textById.has(id) ? `글 상자 ${[...textById.get(id).body].slice(0, 20).join('')}` : '');
  const lineLabel = l => `${endTitle(endId(l, 'from'))} ${l.ends === 'both' ? '↔' : l.ends === 'none' ? '—' : '→'} ${endTitle(endId(l, 'to'))} 연결선`;
  function lineMarkup(l, g, sel) {
    const arrow = `url(#${mark}-${sel ? 's' : 'a'})`, start = l.ends === 'both' ? arrow : 'none', end = l.ends === 'none' ? 'none' : arrow;
    const label = l.label ? `<text class="nb-label" x="${Math.round(g.mid.x)}" y="${Math.round(g.mid.y)}" text-anchor="middle" dominant-baseline="central">${esc(l.label)}</text>` : '';
    return `<path class="nb-line${l.dash === 'dashed' ? ' nb-dashed' : ''}" d="${g.d}" marker-start="${start}" marker-end="${end}"/>${label}<path class="nb-hit" d="${g.d}" tabindex="0" role="button" aria-label="${esc(lineLabel(l))}" aria-haspopup="dialog" aria-description="누르면 메뉴, 끌면 곡선" data-nb-hit="${esc(l.id)}"/>`;
  }
  const placeOfNow = id => (drag?.moving && drag.id === id && drag.now ? drag.now : places.get(id));
  // 글 상자 칸(판 좌표): 자리는 끄는 중이면 끄는 자리, 크기는 그린 크기(아직 못 쟀으면 대략).
  function textRect(id) {
    const t = textById.get(id), now = tdrag?.moving && tdrag.id === id && tdrag.now ? tdrag.now : t, sz = textSize.get(id);
    return {x:now?.x || 0, y:now?.y || 0, w:sz?.w || 80, h:sz?.h || 26};
  }
  // 끝(노트 카드 또는 글 상자)의 칸.
  const rectFor = id => (places.has(id) ? rectOf(placeOfNow(id)) : textRect(id));
  const hasEnd = id => (places.has(id) ? isShown(id) : textById.has(id));
  function geometry(l) { const b = bend?.moved && bend.id === l.id ? {...l, ...bendPatch(bend.now)} : l; return linkGeometry(rectFor(endId(l, 'from')), rectFor(endId(l, 'to')), b); }
  function paintLine(l) {
    let g = lineEls.get(l.id);
    if (!g) { g = document.createElementNS('http://www.w3.org/2000/svg', 'g'); g.dataset.nbLine = l.id; linesBox.append(g); lineEls.set(l.id, g); }
    const sel = lineSel === l.id;
    g.classList.toggle('nb-line-sel', sel); g.classList.toggle('nb-pending', !!l.pending);
    g.innerHTML = lineMarkup(l, geometry(l), sel);
  }
  // 보이는 영역의 카드·선만 붙인다(고른 카드·끄는 카드·초점 카드는 늘 붙여 둔다).
  function sync() {
    const {w, h} = size(), area = visibleArea(view, w, h, 240);
    const keep = new Set([selected, drag?.id, wire?.from, document.activeElement?.closest?.('[data-nb-card]')?.dataset.nbCard].filter(Boolean));
    const want = new Set();
    for (const n of shown) {
      if (!isShown(n.id)) continue;
      const p = placeOfNow(n.id); if (p && (keep.has(n.id) || rectsMeet(cardRect(p), area))) want.add(n.id);
    }
    for (const [id, el] of cardEls) if (!want.has(id)) { el.remove(); cardEls.delete(id); }
    for (const id of want) if (!cardEls.has(id)) addCard(id);
    const wantLines = new Set();
    for (const l of links) {
      if (!linkOn.has(l.id)) continue;
      const a = rectFor(endId(l, 'from')), b = rectFor(endId(l, 'to'));
      if (lineSel === l.id || bend?.id === l.id || rectsMeet(linkBox(a, b, isBent(l) ? geometry(l).mid : null), area)) wantLines.add(l.id);
    }
    for (const [id, g] of lineEls) if (!wantLines.has(id)) { g.remove(); lineEls.delete(id); }
    for (const l of links) if (wantLines.has(l.id) && !lineEls.has(l.id)) paintLine(l);
  }
  function repaintLinesOf(id) { for (const l of links) if (lineEls.has(l.id) && (endId(l, 'from') === id || endId(l, 'to') === id)) paintLine(l); }
  // ---- 글 상자 그리기(보드 하나에 TEXT_LIMIT개까지라 늘 모두 붙인다 — 선 끝 크기를 재야 하므로) ----
  const textHtml = t => `<div class="nb-text${textSel === t.id ? ' nb-sel' : ''}${t.pending ? ' nb-pending' : ''}" data-nb-text="${esc(t.id)}" style="left:${t.x}px;top:${t.y}px"><div class="nb-tx" tabindex="0" role="button" aria-roledescription="글 상자" aria-label="${esc(t.body)}" title="누르면 수정">${esc(t.body)}</div><button type="button" class="row-act nb-tx-del" data-nb-text-del aria-label="글 상자 삭제">삭제</button>${opts.pickActive ? '' : SIDES.map(s => `<span class="nb-h nb-h-${s}" data-nb-handle="${s}" aria-hidden="true"></span>`).join('')}</div>`;
  function measureText(id) { const el = textEls.get(id); if (el) textSize.set(id, {w:el.offsetWidth || 80, h:el.offsetHeight || 26}); }
  function renderTexts() {
    for (const [id, el] of textEls) if (editing?.id !== id) { el.remove(); textEls.delete(id); }
    for (const t of texts) {
      if (textEls.has(t.id)) continue;
      textsBox.insertAdjacentHTML('beforeend', textHtml(t));
      const el = textsBox.lastElementChild; el.querySelectorAll('[data-nb-handle]').forEach(h => h.addEventListener('click', stopClick));
      textEls.set(t.id, el);
    }
    for (const id of textEls.keys()) measureText(id);
    for (const id of [...textSize.keys()]) if (!textEls.has(id)) textSize.delete(id);
  }
  // notes: 이 판의 노트(자리 계산은 전체로), visible: 그릴 노트 id(찾는 중이면 맞는 것만). folderOf(note) → 폴더 id 또는 null.
  // boardKey: 'all' 또는 보드 id(보던 자리를 보드마다 기억), links: 이 보드의 선(parseLink 모양).
  function paint({notes, folderOf, colorOfFolder = () => null, visible = null, pickActive = false, isPicked = () => false, placeOf = undefined, removable = false, emptyText = '', boardKey = 'all', links:list = [], texts:textList = []}) {
    if (drag) cancelDrag();
    if (wire) cancelWire();
    if (tdrag) cancelTextDrag();
    if (bend) cancelBend();
    if (editing && (key !== boardKey || (!editing.isNew && !textList.some(t => t.id === editing.id)))) endEdit(false);
    opts = {visible, pickActive, removable};
    texts = textList; textById = new Map(textList.map(t => [t.id, t]));
    if (textSel && !textById.has(textSel)) textSel = null;
    places = layoutBoard(notes, folderOf, placeOf); shown = notes; byId = new Map(notes.map(n => [n.id, n]));
    infoOf = new Map(notes.map(n => { const fid = folderOf(n); return [n.id, {...cardText(n, fid), folderId:fid, color:fid ? colorOfFolder(fid) : null, picked:isPicked(n.id)}]; }));
    links = list; linkOn = new Set(list.filter(l => hasEnd(endId(l, 'from')) && hasEnd(endId(l, 'to'))).map(l => l.id));
    if (selected && (!places.has(selected) || pickActive)) selected = null;
    if (lineSel && !linkOn.has(lineSel)) closeLineMenu();
    empty.textContent = emptyText; empty.hidden = !emptyText || notes.length > 0;
    const focused = document.activeElement?.closest?.('[data-nb-card]')?.dataset.nbCard, focusLine = document.activeElement?.closest?.('[data-nb-hit]')?.dataset.nbHit;
    const focusText = document.activeElement?.closest?.('.nb-tx') ? document.activeElement.closest('[data-nb-text]')?.dataset.nbText : null;
    const first = key !== boardKey; key = boardKey;
    for (const el of cardEls.values()) el.remove(); cardEls.clear();
    for (const g of lineEls.values()) g.remove(); lineEls.clear();
    renderTexts();
    if (first) { const saved = views.get(boardKey); if (saved) { view = saved; paintView(); sync(); } else { paintView(); fitBoard(); sync(); } }
    else { paintView(); sync(); }
    if (focused) cardEls.get(focused)?.querySelector('.nb-open')?.focus({preventScroll:true});
    else if (focusLine) lineEls.get(focusLine)?.querySelector('.nb-hit')?.focus({preventScroll:true});
    else if (focusText) textEls.get(focusText)?.querySelector('.nb-tx')?.focus({preventScroll:true});
  }
  // S68-47: 연결선·글 상자만 바뀌었을 때(따로 읽은 답이 늦게 오거나 선·글 상자를 더하고 고친 뒤) 카드는 건드리지 않고 선·글 상자만 다시 그린다.
  // 판 전체 paint()는 끌던 카드를 취소하고 카드를 새로 만들므로, 보드가 뜨자마자 끌기 시작하면 늦게 온 답에 끌기가 끊겼다.
  // 카드 끌기·판 이동·두 손가락·선 긋기는 이어 가고, 바뀐 목록에 기대는 글 상자 끌기만 그만둔다(paint()와 같음).
  // S68-57: 곡선 끌기는 끌던 선이 새 목록에 그대로 있으면 이어 간다 — 다른 선의 저장 답(예: [직선으로])이 끄는 도중에 와도
  // 끌기가 끊기지 않게. 곡선은 움직일 때마다 지금 목록(links)·카드 자리로 다시 계산하므로(followBend) 새 목록으로 이어 가도 된다.
  // 끌던 선이 없어졌거나 아직 저장 중(pending)이면 지금처럼 그만둔다.
  function relink({links:list = [], texts:textList = []}) {
    if (tdrag) cancelTextDrag();
    if (bend && !list.some(l => l.id === bend.id && !l.pending)) cancelBend();
    if (editing && !editing.isNew && !textList.some(t => t.id === editing.id)) endEdit(false);
    texts = textList; textById = new Map(textList.map(t => [t.id, t]));
    if (textSel && !textById.has(textSel)) textSel = null;
    if (wire && !places.has(wire.from) && !textById.has(wire.from)) cancelWire();
    links = list; linkOn = new Set(list.filter(l => hasEnd(endId(l, 'from')) && hasEnd(endId(l, 'to'))).map(l => l.id));
    if (lineSel && !linkOn.has(lineSel)) closeLineMenu();
    const focusLine = document.activeElement?.closest?.('[data-nb-hit]')?.dataset.nbHit;
    const focusText = document.activeElement?.closest?.('.nb-tx') ? document.activeElement.closest('[data-nb-text]')?.dataset.nbText : null;
    for (const g of lineEls.values()) g.remove(); lineEls.clear();
    renderTexts(); sync();
    if (focusLine) lineEls.get(focusLine)?.querySelector('.nb-hit')?.focus({preventScroll:true});
    else if (focusText) textEls.get(focusText)?.querySelector('.nb-tx')?.focus({preventScroll:true});
  }
  // 화면 칸 좌표·판 좌표.
  const local = e => { const r = scroll.getBoundingClientRect(); return {x:e.clientX - r.left, y:e.clientY - r.top}; };
  const pointOf = e => { const p = local(e); return toBoard(view, p.x, p.y); };
  const raise = (card, z) => { card.style.zIndex = String(z + 1); };
  const stopClick = e => { e.preventDefault(); e.stopPropagation(); };
  const dragOn = on => document.documentElement.classList.toggle('nb-drag-on', on);

  // ---- 고르기 ----
  function selectText(id) {
    if (textSel === id) return;
    textEls.get(textSel)?.classList.remove('nb-sel');
    textSel = id; if (id) { select(null, {keepText:true}); textEls.get(id)?.classList.add('nb-sel'); }
  }
  function select(id, {keepText = false} = {}) {
    if (!keepText && textSel) selectText(null);
    if (selected === id) return;
    const old = selected && cardEls.get(selected); old?.classList.remove('nb-sel');
    selected = id;
    if (id) { if (!cardEls.has(id)) addCard(id); cardEls.get(id)?.classList.add('nb-sel'); }
  }

  // ---- 카드 끌기(폰: 바로 끌기·꾹 누른 뒤 끌기 둘 다, 꾹 누르고 떼면 고르기만) ----
  function cancelDrag() {
    if (!drag) return;
    clearTimeout(drag.timer); stopEdge();
    const {card, place, id} = drag; drag = null; dragOn(false);
    card.classList.remove('nb-dragging', 'nb-held'); card.style.left = `${place.x}px`; card.style.top = `${place.y}px`; raise(card, place.z);
    repaintLinesOf(id);
  }
  function follow() {
    const p = pointOf(drag.last), nx = Math.max(0, drag.place.x + p.x - drag.start.x), ny = Math.max(0, drag.place.y + p.y - drag.start.y);
    drag.now = {...drag.place, x:nx, y:ny};
    drag.card.style.left = `${nx}px`; drag.card.style.top = `${ny}px`;
    repaintLinesOf(drag.id);
  }
  function finishDrag(e) {
    const d = drag; stopEdge(); drag = null; clearTimeout(d.timer); dragOn(false);
    d.card.classList.remove('nb-dragging', 'nb-held');
    if (!d.moving) { if (d.held) suppressUntil = Date.now() + 600; return; } // 짧게 누르고 뗌 = 열기(click이 맡는다)
    suppressUntil = Date.now() + 400;
    const p = pointOf(e), next = movedTo(d.place, p.x - d.start.x, p.y - d.start.y, topZ(places));
    const before = new Map(places); // 옮기기 전 자리(아직 저장 안 된 칸은 이 자리로 함께 저장)
    places.set(d.id, {...next, saved:true});
    d.card.style.left = `${next.x}px`; d.card.style.top = `${next.y}px`; raise(d.card, next.z);
    repaintLinesOf(d.id);
    onMove(d.id, next, before);
  }

  // ---- 연결선 끌기(손잡이 → 다른 카드) ----
  function cancelWire() { if (!wire) return; stopEdge(); wire = null; temp.setAttribute('d', ''); temp.setAttribute('hidden', ''); box.classList.remove('nb-wiring'); dragOn(false); }
  function followWire() { const p = pointOf(wire.last); temp.setAttribute('d', dragPath(rectFor(wire.from), wire.side, p)); temp.removeAttribute('hidden'); }
  // 놓은 곳의 끝: 노트 카드 또는 (저장된) 글 상자.
  function endAt(x, y) {
    const hit = document.elementFromPoint(x, y)?.closest?.('[data-nb-card],[data-nb-text]');
    if (!hit || !box.contains(hit)) return null;
    if (hit.dataset.nbCard) return places.has(hit.dataset.nbCard) ? {kind:'note', id:hit.dataset.nbCard} : null;
    const t = textById.get(hit.dataset.nbText); return t && !t.pending ? {kind:'text', id:t.id} : null;
  }
  function finishWire(e) {
    const w = wire; cancelWire(); suppressUntil = Date.now() + 400;
    const to = endAt(e.clientX, e.clientY);
    if (!to || to.id === w.from) return;
    if (hasLink(links, key, w.from, to.id)) { toast('이미 이어져 있어요.'); return; }
    if (links.length >= LINK_LIMIT) { toast(`연결선은 한 보드에 ${LINK_LIMIT}개까지 그을 수 있어요.`); return; }
    onLinkAdd({board_id:key, ...endFields('from', w.kind, w.from), ...endFields('to', to.kind, to.id), from_side:w.side, to_side:nearestSide(rectFor(to.id), pointOf(e)), shape:'line'});
  }

  // ---- 선 가운데 끌어 곡선(조절점 하나, 끄는 동안 바로 보임) ----
  function cancelBend() { if (!bend) return; const b = bend; bend = null; dragOn(false); const l = links.find(k => k.id === b.id); if (l && lineEls.has(l.id)) paintLine(l); }
  function followBend(e) {
    const l = links.find(k => k.id === bend.id); if (!l) { cancelBend(); return; }
    const g = linkGeometry(rectFor(endId(l, 'from')), rectFor(endId(l, 'to')), {...l, shape:'line', bend_x:null, bend_y:null});
    bend.now = bendOf(g.from, g.to, pointOf(e));
    paintLine(l);
  }
  function finishBend() {
    const b = bend; bend = null; dragOn(false); bendEnded = true; // 끌기 끝에 따라오는 click은 메뉴가 아니다(다음 누름에서 풀림)
    const l = links.find(k => k.id === b.id); if (!l) return;
    const patch = bendPatch(b.now);
    if (Object.entries(patch).every(([k, v]) => l[k] === v)) { if (lineEls.has(l.id)) paintLine(l); return; }
    paintLine({...l, ...patch}); // 서버 답 전에도 그 모양으로
    onLinkChange(l.id, patch);
  }

  // ---- 글 상자: 끌어 옮기기(폰: 바로 끌기·꾹 누른 뒤 끌기, 꾹 누르고 떼면 고르기만, 짧게 누르면 고치기) ----
  function cancelTextDrag() {
    if (!tdrag) return;
    clearTimeout(tdrag.timer); stopEdge();
    const {el, place, id} = tdrag; tdrag = null; dragOn(false);
    el.classList.remove('nb-dragging', 'nb-held'); el.style.left = `${place.x}px`; el.style.top = `${place.y}px`;
    repaintLinesOf(id);
  }
  function followText() {
    const p = pointOf(tdrag.last), nx = Math.max(0, Math.round(tdrag.place.x + p.x - tdrag.start.x)), ny = Math.max(0, Math.round(tdrag.place.y + p.y - tdrag.start.y));
    tdrag.now = {x:nx, y:ny}; tdrag.el.style.left = `${nx}px`; tdrag.el.style.top = `${ny}px`;
    repaintLinesOf(tdrag.id);
  }
  function finishTextDrag(e) {
    const d = tdrag; stopEdge(); tdrag = null; clearTimeout(d.timer); dragOn(false);
    d.el.classList.remove('nb-dragging', 'nb-held');
    // 짧게 누름 = 고치기. 입력칸은 뒤따르는 click에서 연다(폰은 손 뗀 뒤 흉내 마우스 누름이 와서, 그 전에 연 입력칸은 초점을 잃는다).
    if (!d.moving) { if (d.held) { suppressUntil = Date.now() + 600; return; } afterClick = {run:() => startEdit(d.id)}; return; }
    suppressUntil = Date.now() + 400;
    const p = pointOf(e), x = Math.max(0, Math.round(d.place.x + p.x - d.start.x)), y = Math.max(0, Math.round(d.place.y + p.y - d.start.y));
    d.el.style.left = `${x}px`; d.el.style.top = `${y}px`;
    const t = textById.get(d.id); if (t) { t.x = x; t.y = y; }
    repaintLinesOf(d.id);
    if (x !== d.place.x || y !== d.place.y) onTextChange(d.id, {x, y});
  }

  // ---- 글 상자: 그 자리 입력칸으로 고치기·새로 만들기 ----
  function startEdit(id, at = null) {
    if (editing) endEdit(true);
    const isNew = !id, t = isNew ? null : textById.get(id);
    if (!isNew && (!t || t.pending)) return;
    let el = isNew ? null : textEls.get(id);
    if (isNew) {
      textsBox.insertAdjacentHTML('beforeend', `<div class="nb-text nb-sel nb-editing" data-nb-text="" style="left:${at.x}px;top:${at.y}px"></div>`);
      el = textsBox.lastElementChild;
    }
    if (!el) return;
    selectText(isNew ? null : id);
    el.classList.add('nb-editing');
    const area = document.createElement('textarea');
    area.className = 'nb-tx-edit'; area.dataset.nbTextEdit = ''; area.maxLength = TEXT_MAX; area.rows = 1;
    area.setAttribute('aria-label', isNew ? '새 글 상자' : '글 상자 수정'); area.value = t?.body || '';
    el.append(area);
    editing = {id:isNew ? null : id, isNew, at, el, area};
    const grow = () => { area.style.height = 'auto'; area.style.height = `${area.scrollHeight}px`; };
    area.addEventListener('input', grow);
    area.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); endEdit(false, true); }
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); endEdit(true, true); }
    });
    area.addEventListener('blur', () => { if (editing?.area === area) endEdit(true); });
    grow(); area.focus({preventScroll:true}); area.setSelectionRange(area.value.length, area.value.length);
  }
  // refocus: 키보드로 끝냈을 때만 그 상자에 초점을 돌려준다(바깥을 눌러 끝냈으면 누른 곳을 그대로 둔다).
  function endEdit(save, refocus = false) {
    const ed = editing; if (!ed) return; editing = null;
    const value = ed.area.value; ed.area.remove(); ed.el.classList.remove('nb-editing');
    if (ed.isNew) ed.el.remove();
    let body = null;
    if (save) { try { body = validateText(value); } catch (err) { toast(err.message); body = null; } }
    if (ed.isNew) { if (body) onTextAdd({board_id:key, body, x:Math.round(ed.at.x), y:Math.round(ed.at.y)}); return; }
    const t = textById.get(ed.id);
    if (!ed.el.isConnected || !t) { renderTexts(); return; }
    if (body && body !== t.body) {
      t.body = body; ed.el.querySelector('.nb-tx').textContent = body; ed.el.querySelector('.nb-tx').setAttribute('aria-label', body);
      measureText(ed.id); repaintLinesOf(ed.id); onTextChange(ed.id, {body});
    }
    if (refocus) textEls.get(ed.id)?.querySelector('.nb-tx')?.focus({preventScroll:true});
  }
  function newText(at) {
    if (opts.pickActive) return;
    if (texts.length >= TEXT_LIMIT) { toast(`글 상자는 한 보드에 ${TEXT_LIMIT}개까지 만들 수 있어요.`); return; }
    if (!canText()) return;
    startEdit(null, {x:Math.max(0, Math.round(at.x)), y:Math.max(0, Math.round(at.y))});
  }

  // ---- 가장자리 자동 이동(끄는 손가락이 판 가장자리에 머물면 판이 그쪽으로 밀림) ----
  let edgeFrame = 0;
  function stopEdge() { if (edgeFrame) cancelAnimationFrame(edgeFrame); edgeFrame = 0; }
  function edgeStep(x, y) {
    const r = scroll.getBoundingClientRect();
    return {dx:x < r.left + EDGE ? EDGE_STEP : x > r.right - EDGE ? -EDGE_STEP : 0, dy:y < r.top + EDGE ? EDGE_STEP : y > r.bottom - EDGE ? -EDGE_STEP : 0};
  }
  function edgeLoop() {
    const live = drag?.moving ? drag : tdrag?.moving ? tdrag : wire; if (!live) { edgeFrame = 0; return; }
    const {dx, dy} = edgeStep(live.last.clientX, live.last.clientY);
    if (!dx && !dy) { edgeFrame = 0; return; }
    view = {...view, x:view.x + dx, y:view.y + dy}; paintView(); sync();
    if (drag?.moving) follow(); else if (tdrag?.moving) followText(); else followWire();
    edgeFrame = requestAnimationFrame(edgeLoop);
  }
  const edgeKick = () => { if (!edgeFrame) edgeFrame = requestAnimationFrame(edgeLoop); };

  // ---- 두 손가락(확대·축소 + 이동) ----
  function startPinch() {
    cancelDrag(); cancelWire(); cancelTextDrag(); cancelBend(); pan = null;
    const [a, b] = [...touches.values()];
    pinch = {d:Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)), mid:{x:(a.x + b.x) / 2, y:(a.y + b.y) / 2}, view:{...view}};
    suppressUntil = linesQuietUntil = Date.now() + 600; dragOn(true);
  }
  function movePinch() {
    const [a, b] = [...touches.values()]; if (!a || !b) return;
    const d = Math.hypot(b.x - a.x, b.y - a.y), mid = {x:(a.x + b.x) / 2, y:(a.y + b.y) / 2};
    const z = clampZoom(pinch.view.z * d / pinch.d), bx = (pinch.mid.x - pinch.view.x) / pinch.view.z, by = (pinch.mid.y - pinch.view.y) / pinch.view.z;
    setView({x:mid.x - bx * z, y:mid.y - by * z, z});
  }

  scroll.addEventListener('pointerdown', e => {
    afterClick = null; bendEnded = false; // 새 누름 = 앞 손짓의 뒷일은 끝
    closeLineMenuIfOutside(e.target);
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, local(e));
      if (touches.size === 2) { startPinch(); return; }
      if (touches.size > 2) return;
    }
    if (!e.isPrimary || multiTouchActive() || pinch) return; // 판 밖 두 번째 손가락(공용 지킴이)·판 안 두 손가락 중에는 끌기·긋기를 시작하지 않는다
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.target.closest?.('[data-nb-text-edit],[data-nb-text-del]')) return; // 입력칸 안·삭제 단추는 그대로
    const handle = e.target.closest?.('[data-nb-handle]');
    if (handle) { // 손잡이 → 연결선 긋기(노트 카드·글 상자)
      const card = handle.closest('[data-nb-card]'), textEl = card ? null : handle.closest('[data-nb-text]');
      const id = card?.dataset.nbCard || textEl?.dataset.nbText, kind = card ? 'note' : 'text';
      if (!id || (kind === 'note' ? !places.has(id) : !textById.has(id) || textById.get(id).pending)) return;
      e.preventDefault(); if (kind === 'note') select(id); else selectText(id);
      wire = {from:id, kind, side:handle.dataset.nbHandle, pointerId:e.pointerId, last:{clientX:e.clientX, clientY:e.clientY}};
      box.classList.add('nb-wiring'); dragOn(true); followWire();
      try { scroll.setPointerCapture(e.pointerId); } catch { /* 잡기 실패해도 움직임은 받는다 */ }
      return;
    }
    const card = e.target.closest?.('[data-nb-card]');
    if (card) {
      if (e.target.closest('.nb-more,.nb-x')) return;
      const id = card.dataset.nbCard, place = places.get(id); if (!place) return;
      if (drag) cancelDrag();
      drag = {id, card, place, start:pointOf(e), x:e.clientX, y:e.clientY, last:{clientX:e.clientX, clientY:e.clientY}, moving:false, held:false, touch:e.pointerType !== 'mouse', pointerId:e.pointerId, timer:null};
      if (drag.touch) {
        dragOn(true);
        drag.timer = setTimeout(() => { // 폰: 움직이지 않고 꾹 누르면 그 카드를 고른다(손잡이·×·⋯가 보임)
          if (!drag || drag.card !== card || drag.moving) return;
          drag.held = true; card.classList.add('nb-held'); select(id); raise(card, topZ(places) + 1);
          try { navigator.vibrate?.(12); } catch { /* 진동 없음 */ }
        }, LONG_MS);
      }
      return;
    }
    const textEl = e.target.closest?.('[data-nb-text]');
    if (textEl) { // 글 상자: 끌기 = 옮기기, 짧게 누름 = 고치기
      const id = textEl.dataset.nbText, t = textById.get(id); if (!t || t.pending || editing?.el === textEl) return;
      if (tdrag) cancelTextDrag();
      tdrag = {id, el:textEl, place:{x:t.x, y:t.y}, start:pointOf(e), x:e.clientX, y:e.clientY, last:{clientX:e.clientX, clientY:e.clientY}, moving:false, held:false, touch:e.pointerType !== 'mouse', pointerId:e.pointerId, timer:null};
      if (tdrag.touch) {
        dragOn(true);
        tdrag.timer = setTimeout(() => { // 폰: 꾹 누르면 고르기([삭제]·손잡이가 보임)
          if (!tdrag || tdrag.el !== textEl || tdrag.moving) return;
          tdrag.held = true; textEl.classList.add('nb-held'); selectText(id);
          try { navigator.vibrate?.(12); } catch { /* 진동 없음 */ }
        }, LONG_MS);
      }
      return;
    }
    const hit = e.target.closest?.('[data-nb-hit]');
    if (hit) { // 선: 끌면 곡선(판 이동보다 먼저), 짧게 누르면 메뉴(click이 맡는다)
      const l = links.find(k => k.id === hit.dataset.nbHit);
      if (l && !l.pending) bend = {id:l.id, pointerId:e.pointerId, x:e.clientX, y:e.clientY, touch:e.pointerType !== 'mouse', moved:false, now:null};
      return;
    }
    // 빈 곳 = 판 이동
    pan = {pointerId:e.pointerId, x:e.clientX, y:e.clientY, view:{...view}, moved:false};
    try { scroll.setPointerCapture(e.pointerId); } catch { /* 잡기 실패해도 움직임은 받는다 */ }
  });
  scroll.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch' && touches.has(e.pointerId)) { touches.set(e.pointerId, local(e)); if (pinch) { e.preventDefault(); movePinch(); return; } }
    if (wire && e.pointerId === wire.pointerId) { e.preventDefault(); wire.last = {clientX:e.clientX, clientY:e.clientY}; followWire(); edgeKick(); return; }
    if (bend && e.pointerId === bend.pointerId) {
      if (!bend.moved) {
        if (Math.hypot(e.clientX - bend.x, e.clientY - bend.y) <= (bend.touch ? SLOP : 4)) return;
        bend.moved = true; dragOn(true); closeLineMenu();
        try { scroll.setPointerCapture(e.pointerId); } catch { /* 잡기 실패해도 움직임은 받는다 */ }
      }
      e.preventDefault(); followBend(e); return;
    }
    if (tdrag && e.pointerId === tdrag.pointerId) {
      tdrag.last = {clientX:e.clientX, clientY:e.clientY};
      if (!tdrag.moving) {
        if (Math.hypot(e.clientX - tdrag.x, e.clientY - tdrag.y) <= (tdrag.touch ? SLOP : 4)) return;
        tdrag.moving = true; clearTimeout(tdrag.timer); selectText(tdrag.id);
        tdrag.el.classList.remove('nb-held'); tdrag.el.classList.add('nb-dragging');
        try { scroll.setPointerCapture(e.pointerId); } catch { /* 잡기 실패해도 움직임은 받는다 */ }
      }
      e.preventDefault(); followText(); edgeKick(); return;
    }
    if (pan && e.pointerId === pan.pointerId) {
      const dx = e.clientX - pan.x, dy = e.clientY - pan.y;
      if (!pan.moved && Math.hypot(dx, dy) <= (e.pointerType === 'mouse' ? 3 : SLOP)) return;
      if (!pan.moved) { pan.moved = true; dragOn(true); box.classList.add('nb-panning'); }
      e.preventDefault(); setView({...pan.view, x:pan.view.x + dx, y:pan.view.y + dy}); return;
    }
    if (!drag || e.pointerId !== drag.pointerId) return;
    drag.last = {clientX:e.clientX, clientY:e.clientY};
    if (!drag.moving) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) <= (drag.touch ? SLOP : 4)) return;
      drag.moving = true; clearTimeout(drag.timer); select(drag.id);
      drag.card.classList.remove('nb-held'); drag.card.classList.add('nb-dragging'); raise(drag.card, topZ(places) + 1);
      try { drag.card.setPointerCapture(e.pointerId); } catch { /* 잡기 실패해도 움직임은 받는다 */ }
    }
    e.preventDefault(); follow(); edgeKick();
  });
  const up = e => {
    if (e.pointerType === 'touch') {
      touches.delete(e.pointerId);
      if (pinch) { if (touches.size < 2) { pinch = null; if (!touches.size) dragOn(false); } return; }
    }
    if (wire && e.pointerId === wire.pointerId) { if (e.type === 'pointercancel') cancelWire(); else finishWire(e); return; }
    if (bend && e.pointerId === bend.pointerId) {
      // 짧게 누름 = 선 메뉴(손 뗄 때 바로 연다 — 폰에서 click이 늦거나 빠지는 경우에도). 뒤따르는 click은 한 번 넘긴다.
      if (!bend.moved) { const b = bend; bend = null; if (e.type !== 'pointercancel' && Date.now() >= linesQuietUntil) { bendEnded = true; openLineMenu(b.id, e.clientX, e.clientY); } }
      else if (e.type === 'pointercancel') cancelBend(); else finishBend();
      return;
    }
    if (tdrag && e.pointerId === tdrag.pointerId) { if (e.type === 'pointercancel') cancelTextDrag(); else finishTextDrag(e); return; }
    if (pan && e.pointerId === pan.pointerId) {
      const p = pan; pan = null; dragOn(false); box.classList.remove('nb-panning');
      if (!p.moved && e.type !== 'pointercancel') { // 빈 곳 누름 = 고르기 풀기, 폰에서 빠르게 두 번 = 글 상자
        select(null); closeLineMenu();
        const now = Date.now(), here = {x:e.clientX, y:e.clientY};
        if (e.pointerType !== 'mouse' && lastTap && now - lastTap.t < 350 && Math.hypot(here.x - lastTap.x, here.y - lastTap.y) < 24) { lastTap = null; const at = pointOf(e); afterClick = {run:() => newText(at)}; }
        else lastTap = e.pointerType === 'mouse' ? null : {t:now, ...here};
      }
      else suppressUntil = linesQuietUntil = Date.now() + 300;
      return;
    }
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (e.type === 'pointercancel') cancelDrag(); else finishDrag(e);
  };
  scroll.addEventListener('pointerup', up); scroll.addEventListener('pointercancel', up);
  // 터치는 처음 누른 안쪽 요소(제목 글자 등)가 잡고 있다가 끌기 시작에 칸으로 잡기를 옮기면 안쪽 요소에 lostpointercapture가 온다. 칸 자체가 잃었을 때만 끝낸다.
  scroll.addEventListener('lostpointercapture', e => { if (drag && drag.moving && e.pointerId === drag.pointerId && e.target === drag.card) finishDrag(e); });
  // 판 위 touchmove는 브라우저 몫(문서 스크롤·당겨서 새로고침·튕김·옆 넘김)으로 넘기지 않는다(CSS touch-action:none과 함께).
  scroll.addEventListener('touchmove', e => { if (e.cancelable) e.preventDefault(); }, {passive:false});
  // PC: 빈 곳 더블클릭 = 그 자리에 글 상자.
  scroll.addEventListener('dblclick', e => {
    const t = e.target instanceof Element ? e.target : null;
    if (!t || t.closest('[data-nb-card],[data-nb-text],[data-nb-hit],.nb-tools') || lastTap && Date.now() - lastTap.t < 400) return;
    e.preventDefault(); newText(pointOf(e));
  });
  // 휠: 판 이동, Ctrl(맥 ⌘)·트랙패드 벌리기 = 확대·축소(마우스 자리 기준).
  scroll.addEventListener('wheel', e => {
    e.preventDefault(); closeLineMenu();
    if (e.ctrlKey || e.metaKey) { const p = local(e); setView(zoomAt(view, view.z * Math.exp(-e.deltaY * 0.0025), p.x, p.y)); }
    else setView({...view, x:view.x - e.deltaX, y:view.y - e.deltaY});
  }, {passive:false});
  // 마우스를 올린 카드: ×·⋯·손잡이를 보인다(터치는 고르기로만). 기기 hover 판정 대신 실제 마우스 움직임으로.
  let hoverCard = null;
  scroll.addEventListener('pointerover', e => { if (e.pointerType !== 'mouse') return; const card = e.target.closest?.('[data-nb-card],[data-nb-text]'); if (card === hoverCard) return; hoverCard?.classList.remove('nb-hover'); hoverCard = card; card?.classList.add('nb-hover'); });
  scroll.addEventListener('pointerleave', () => { hoverCard?.classList.remove('nb-hover'); hoverCard = null; });
  // 끈 뒤·꾹 누른 뒤·두 손가락 뒤의 클릭은 열기가 아니다(×·⋯는 끈 바로 뒤에도 누를 수 있다).
  box.addEventListener('click', e => { if (Date.now() < suppressUntil && e.target.closest?.('[data-nb-card] .nb-open')) { e.preventDefault(); e.stopPropagation(); } }, true);
  box.addEventListener('contextmenu', e => { if (drag?.touch || tdrag?.touch || wire || pinch || Date.now() < suppressUntil) { e.preventDefault(); return; } const card = e.target.closest?.('[data-nb-card]'); if (card) select(card.dataset.nbCard); }, true);
  // UI-우클릭전수(2026-11-03): PC에서 빈 판(카드·선·도구 줄 밖)을 우클릭하면 브라우저 메뉴 대신 웹2 메뉴(onBackgroundMenu). 카드 위는 공용 context-menu.js가 카드의 ⋯를 연다.
  box.addEventListener('contextmenu', e => {
    if (!onBackgroundMenu || e.defaultPrevented || e.pointerType === 'touch' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
    const t = e.target instanceof Element ? e.target : null;
    if (!t || t.closest('[data-nb-card],[data-nb-text],[data-nb-hit],.nb-tools,input,textarea,select,[contenteditable],a[href]')) return;
    e.preventDefault(); onBackgroundMenu(e.clientX, e.clientY);
  });
  box.addEventListener('click', e => {
    if (afterClick) { const run = afterClick.run; afterClick = null; run(); return; }
    const z = e.target.closest?.('[data-nb-zoom]'); if (z && !z.disabled) { zoomBy(Number(z.dataset.nbZoom)); return; }
    if (e.target.closest?.('[data-nb-fit]')) { fitBoard(); return; }
    if (e.target.closest?.('[data-nb-add-text]')) { const {w, h} = size(), p = toBoard(view, w / 2 - 40, h / 2 - 14); newText(p); return; }
    const del = e.target.closest?.('[data-nb-text-del]');
    if (del) { const id = del.closest('[data-nb-text]')?.dataset.nbText; if (id && textById.has(id) && !textById.get(id).pending) { if (textSel === id) textSel = null; onTextRemove(id); } return; }
    const hit = e.target.closest?.('[data-nb-hit]'); if (hit && bendEnded) { bendEnded = false; return; }
    if (hit && Date.now() >= linesQuietUntil) openLineMenu(hit.dataset.nbHit, e.clientX, e.clientY);
  });
  // 키보드: 카드에 초점 = 고르기, 화살표로 옮긴다(Shift = 4배, 0.5초 멈추면 저장). 선에 초점 + Enter·Space = 선 메뉴.
  box.addEventListener('focusin', e => {
    const card = e.target.closest?.('[data-nb-card]'); if (card && !opts.pickActive) { select(card.dataset.nbCard); return; }
    const tx = e.target.closest?.('.nb-tx'); if (tx && !opts.pickActive) selectText(tx.closest('[data-nb-text]')?.dataset.nbText || null);
  });
  box.addEventListener('keydown', e => {
    const hit = e.target.closest?.('[data-nb-hit]');
    if (hit && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); const r = hit.getBoundingClientRect(); openLineMenu(hit.dataset.nbHit, r.left + r.width / 2, r.top + r.height / 2); return; }
    const tx = e.target.closest?.('.nb-tx');
    if (tx && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); startEdit(tx.closest('[data-nb-text]')?.dataset.nbText); return; }
    const dir = {ArrowLeft:[-1, 0], ArrowRight:[1, 0], ArrowUp:[0, -1], ArrowDown:[0, 1]}[e.key];
    const card = e.target.closest?.('[data-nb-card]'); if (!dir || !card || e.altKey || e.ctrlKey || e.metaKey) return;
    const id = card.dataset.nbCard, place = places.get(id); if (!place) return;
    e.preventDefault();
    const step = KEY_STEP * (e.shiftKey ? 4 : 1), before = keyTimer ? null : new Map(places);
    const next = movedTo(place, dir[0] * step, dir[1] * step, place.z === topZ(places) ? place.z - 1 : topZ(places)); // 이미 맨 위면 순서 그대로
    places.set(id, {...next, saved:place.saved}); card.style.left = `${next.x}px`; card.style.top = `${next.y}px`; raise(card, next.z);
    repaintLinesOf(id); keepVisible(next);
    const pending = keyTimer?.before || before; clearTimeout(keyTimer?.id);
    keyTimer = {before:pending, id:setTimeout(() => { const b = keyTimer.before; keyTimer = null; places.set(id, {...places.get(id), saved:true}); onMove(id, places.get(id), b); }, 500)};
  });
  // 키보드로 옮긴 카드가 화면 밖으로 나가면 판을 그만큼 민다.
  function keepVisible(p) {
    const {w, h} = size(), x = p.x * view.z + view.x, y = p.y * view.z + view.y, cw = CARD_W * view.z, ch = CARD_H * view.z;
    const dx = x < 8 ? 8 - x : x + cw > w - 8 ? w - 8 - x - cw : 0, dy = y < 8 ? 8 - y : y + ch > h - 8 ? h - 8 - y - ch : 0;
    if (dx || dy) setView({...view, x:view.x + dx, y:view.y + dy});
  }
  // PC: 왼쪽 목록의 노트를 끌어 판에 놓기(브라우저 끌어 놓기). 다른 끌기(파일 등)는 받지 않는다.
  const noteDrag = e => !!onDrop && [...(e.dataTransfer?.types || [])].includes(NOTE_DRAG);
  scroll.addEventListener('dragover', e => { if (!noteDrag(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; box.classList.add('nb-drop'); });
  scroll.addEventListener('dragleave', e => { if (!scroll.contains(e.relatedTarget)) box.classList.remove('nb-drop'); });
  scroll.addEventListener('drop', e => {
    box.classList.remove('nb-drop');
    if (!noteDrag(e)) return;
    e.preventDefault();
    const id = e.dataTransfer.getData(NOTE_DRAG); if (id) onDrop(id, pointOf(e), new Map(places));
  });
  // 두 번째 손가락이 판 밖에서 닿아도(공용 지킴이) 카드 끌기·선 긋기를 끈다(판 안 두 손가락은 위 확대·축소).
  onMultiTouch(() => { cancelDrag(); cancelWire(); cancelTextDrag(); cancelBend(); });
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => { if (needFit && scroll.clientWidth && scroll.clientHeight) fitBoard(); else queue(); }).observe(scroll);

  // ---- 선 메뉴(작은 창, 누른 자리 옆) ----
  function menuEl() {
    if (menu?.el?.isConnected) return menu.el;
    const el = document.createElement('div');
    el.className = 'nb-link-menu'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', '연결선'); el.hidden = true;
    document.body.append(el);
    el.addEventListener('click', e => { const b = e.target.closest('button'); if (b) lineAction(b); });
    el.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeLineMenu({focus:true}); } });
    menu = {el, id:null, layer:null};
    return el;
  }
  const chip = (attr, value, text, on, label = '') => `<button type="button" class="ds-chip" ${attr}="${value}" aria-pressed="${on}"${label ? ` aria-label="${label}"` : ''}>${text}</button>`;
  function menuHtml(l) {
    return `<div class="nb-lm-row" role="group" aria-label="선 종류">${chip('data-nb-dash', 'solid', '실선', l.dash === 'solid')}${chip('data-nb-dash', 'dashed', '점선', l.dash === 'dashed')}<button type="button" class="row-act" data-nb-straight${isStraight(l) ? ' disabled' : ''}>직선으로</button></div>`
      + `<div class="nb-lm-row" role="group" aria-label="화살표">${chip('data-nb-ends', 'end', '→', l.ends === 'end', `화살표 ${ENDS_NAMES.end}`)}${chip('data-nb-ends', 'both', '↔', l.ends === 'both', `화살표 ${ENDS_NAMES.both}`)}${chip('data-nb-ends', 'none', '없음', l.ends === 'none', `화살표 ${ENDS_NAMES.none}`)}<button type="button" class="row-act" data-nb-flip>뒤집기</button></div>`
      + `<div class="nb-lm-row nb-lm-foot"><button type="button" class="row-act" data-nb-label>${l.label ? '글자 수정' : '글자'}</button><button type="button" class="row-act nb-lm-del" data-nb-del>삭제</button></div>`;
  }
  function openLineMenu(id, x, y) {
    const l = links.find(k => k.id === id); if (!l || l.pending) return;
    const el = menuEl(), was = lineSel;
    lineSel = id; if (was && was !== id) { const o = links.find(k => k.id === was); if (o && lineEls.has(was)) paintLine(o); }
    if (lineEls.has(id)) paintLine(l);
    el.innerHTML = menuHtml(l); el.hidden = false; menu.id = id; menu.x = x; menu.y = y;
    placeMenu();
    if (!menu.layer) menu.layer = window.KPTURouter?.layer?.open('note-board-line', {close:() => { menu.layer = null; closeLineMenu(); return true; }}) || null;
    el.querySelector('button')?.focus({preventScroll:true});
  }
  function placeMenu() {
    const el = menu.el; el.style.left = `${Math.round(menu.x + 8)}px`; el.style.top = `${Math.round(menu.y + 8)}px`; el.style.bottom = 'auto';
    keepInside(el, 8, bottomInset());
  }
  function closeLineMenu({focus = false} = {}) {
    if (!menu || menu.el.hidden) { if (lineSel) { const was = lineSel; lineSel = null; const o = links.find(k => k.id === was); if (o && lineEls.has(was)) paintLine(o); } return; }
    const id = menu.id, layer = menu.layer; menu.el.hidden = true; menu.id = null; menu.layer = null; layer?.close();
    const was = lineSel; lineSel = null;
    const o = links.find(k => k.id === was); if (o && lineEls.has(was)) paintLine(o);
    if (focus && id) lineEls.get(id)?.querySelector('.nb-hit')?.focus({preventScroll:true});
  }
  function closeLineMenuIfOutside(target) { if (menu && !menu.el.hidden && !menu.el.contains(target)) closeLineMenu(); }
  document.addEventListener('pointerdown', e => { if (menu && !menu.el.hidden && !menu.el.contains(e.target) && !box.contains(e.target) && !e.target.closest?.('.kptu-ask')) closeLineMenu(); }, true);
  async function lineAction(b) {
    const l = links.find(k => k.id === menu?.id); if (!l) { closeLineMenu(); return; }
    let patch = null;
    if (b.hasAttribute('data-nb-straight')) patch = bendPatch(null);
    else if (b.dataset.nbDash) patch = {dash:b.dataset.nbDash};
    else if (b.dataset.nbEnds) patch = {ends:b.dataset.nbEnds};
    else if (b.hasAttribute('data-nb-flip')) {
      if (hasLink(links, key, endId(l, 'to'), endId(l, 'from'))) { toast('반대 방향 선이 이미 있어요.'); return; }
      patch = flipPatch(l);
    } else if (b.hasAttribute('data-nb-label')) {
      const typed = await askText(b, {text:`선 위 글자 (${LABEL_MAX}자까지, 비우면 없음)`, value:l.label || '', max:LABEL_MAX});
      if (typed === null) { b.isConnected && b.focus({preventScroll:true}); return; }
      try { patch = {label:validateLabel(typed)}; } catch (err) { toast(err.message); return; }
      if (patch.label === l.label) return;
    } else if (b.hasAttribute('data-nb-del')) { closeLineMenu(); onLinkRemove(l.id); return; }
    if (!patch || Object.entries(patch).every(([k, v]) => l[k] === v)) return;
    onLinkChange(l.id, patch);
  }
  // 선 값이 바뀐 뒤(부르는 쪽이 다시 paint) 메뉴가 열려 있으면 그 값으로 다시 그린다.
  function refreshMenu() {
    if (!menu || menu.el.hidden) return;
    const l = links.find(k => k.id === menu.id);
    if (!l) { closeLineMenu(); return; }
    const focused = document.activeElement && menu.el.contains(document.activeElement) ? [...menu.el.querySelectorAll('button')].indexOf(document.activeElement) : -1;
    menu.el.innerHTML = menuHtml(l); placeMenu();
    if (focused >= 0) menu.el.querySelectorAll('button')[focused]?.focus({preventScroll:true});
  }
  // 다시 그린 뒤 열려 있던 선 메뉴: 그 선이 남아 있으면 새 값으로 다시, 없으면 닫는다.
  function keepMenu(id) { if (id && links.some(l => l.id === id)) { lineSel = id; const l = links.find(k => k.id === id); if (lineEls.has(id)) paintLine(l); refreshMenu(); } else closeLineMenu(); }
  return {
    paint(args) { const id = menu?.id; paint(args); keepMenu(id); },
    relink(args) { const id = menu?.id; relink(args); keepMenu(id); },
    isDragging: () => !!(drag?.moving || tdrag?.moving || bend?.moved || wire || pan?.moved || pinch),
    places: () => new Map(places),
    view: () => ({...view}),
    closeMenu: () => closeLineMenu(),
    cardSize: {w:CARD_W, h:CARD_H},
  };
}
