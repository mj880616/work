// JOURNAL-일기목록 (명진 요청 2026-10-28 08:04): 일기 [목록] 보기. diary.js가 [달력 / 목록]을 바꾸고 이 모듈이 목록 칸(#diaryRoot 안의
// [data-diary-all]) 하나만 그린다(그 칸의 유일한 렌더러). 규칙은 diary-list-model.mjs, 읽기·저장은 diary-data.js(owner RLS, 내 일기만).
// - 줄: 왼쪽 40px 작은 그림(직접 올린 사진 먼저, 없으면 원드라이브 사진 — 일기에서 원드라이브 사진을 보는 연결이 켜져 있을 때만),
//   날짜·요일·제목, 본문 첫 줄(한 줄 말줄임), 오른쪽 ☆·⋯. 작은 그림은 화면에 보이는 줄부터 받는다(IntersectionObserver, 줄마다 한 장).
//   원드라이브 사진은 그 줄이 보일 때 그 달 목록을 한 번만 읽고(메모리), 그림은 diary-onedrive.js의 같은 대기열(보이는 칸 먼저)로 받는다.
// - 📌 고정·★ 별표: ☆ 누르기, ⋯ 메뉴, 폰은 줄을 옆으로 밀기(오른쪽으로 밀면 📌, 왼쪽으로 밀면 ★). 밀기는 텔레그램 줄 밀기의 판단 부품
//   (tg-day-model.mjs swipeIntent·swipeOffset·swipeSettle)을 그대로 쓴다: 가로가 세로의 1.5배 넘게 움직여야 밀기, 아니면 위아래 넘기기.
// - 🔍 찾기: 불러온 일기 글 안에서 찾는다. 전체 검색(app_search_records)은 일기를 일부러 빼 두었으므로(search_records 결정) 그 길을 넓히지 않는다.
// - 기기 저장 없음: 펼친 달·찾기 글자·밀어 둔 줄은 메모리만, 고정·별표는 서버(일기 행 metadata).
import {readDiaryList, setDiaryMark, diaryPhotos, photoElement, ownerScope} from './diary-data.js';
import {buildDiaryList, rowText, dayLabel, diaryPinnedAt, diaryStarredAt, MARK_KEYS} from './diary-list-model.mjs';
import {odPhotos, odPhotoElement, odTakeWarmMonth} from './diary-onedrive.js';
import {swipeIntent, swipeOffset, swipeSettle, swipeOpenOffset, swipeEdge} from './tg-day-model.mjs';
import {createAnchoredMenu} from './anchored-menu.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ALLOW = Object.freeze({start:1, end:1});

export function createDiaryList({host, rt = window.KPTURuntime, odReady = async () => false, onOpen = () => {}, onMarked = () => {}}) {
  const state = {owner:'', loaded:false, loading:null, error:'', rows:[], truncated:false, filter:'all', query:'', search:false, opened:{}, swipe:null, busy:new Set(), note:'', epoch:0};
  const odCache = new Map(); // 'YYYY-MM' → Promise<odMonth|null>
  let observer = null, drag = null, swallow = false;
  host.innerHTML = '<div class="diary-lv-search" data-diary-lv-search hidden><input type="search" data-diary-lv-q placeholder="일기 글에서 찾기" aria-label="일기 찾기" enterkeyhint="search" autocomplete="off"><button type="button" class="mini" data-diary-lv-search-close aria-label="찾기 닫기">×</button></div><p class="diary-lv-note" data-diary-lv-note role="status"></p><div class="diary-lv-body" data-diary-lv-body></div>';
  const body = host.querySelector('[data-diary-lv-body]'), note = host.querySelector('[data-diary-lv-note]'), searchRow = host.querySelector('[data-diary-lv-search]'), input = host.querySelector('[data-diary-lv-q]');
  const rowOf = day => state.rows.find(row => row.journal_day === day) || null;
  const scopeNow = () => ownerScope(rt);

  async function load({force = false} = {}) {
    if (state.owner !== scopeNow()) reset();
    if (state.loaded && !force) return;
    if (state.loading && !force) return state.loading;
    const run = ++state.epoch, owner = scopeNow();
    state.error = ''; if (!state.loaded) { note.textContent = '불러오는 중…'; }
    state.loading = readDiaryList(rt).then(({rows, truncated}) => {
      if (run !== state.epoch || owner !== scopeNow()) return;
      Object.assign(state, {owner, loaded:true, rows, truncated, error:''});
    }, () => {
      if (run !== state.epoch || owner !== scopeNow()) return;
      state.error = '일기 목록을 불러오지 못했어요.';
    }).finally(() => { if (run === state.epoch) { state.loading = null; paint(); } });
    return state.loading;
  }
  function reset() {
    state.epoch++; observer?.disconnect(); odCache.clear();
    Object.assign(state, {owner:scopeNow(), loaded:false, loading:null, error:'', rows:[], truncated:false, opened:{}, swipe:null, busy:new Set(), note:''});
  }

  const markButtons = row => {
    const day = esc(row.journal_day), star = !!diaryStarredAt(row), busy = state.busy.has(row.journal_day) ? ' disabled' : '';
    return `<button type="button" class="diary-lv-star" data-diary-lv-star="${day}" aria-pressed="${star}" aria-label="${star ? '별표 풀기' : '별표'}"${busy}>${star ? '★' : '☆'}</button><button type="button" class="diary-lv-more" data-diary-lv-more="${day}" aria-haspopup="true" aria-expanded="false" aria-controls="diaryListMenu" aria-label="${esc(dayLabel(row.journal_day))} 메뉴"><span class="more-dots" aria-hidden="true">⋯</span></button>`;
  };
  function rowHtml(row) {
    const day = row.journal_day, photos = diaryPhotos(row), {title, line} = rowText(row, photos.length), pinned = !!diaryPinnedAt(row), star = !!diaryStarredAt(row);
    const open = state.swipe?.day === day ? ` data-side="${state.swipe.side}"` : '';
    const label = `${dayLabel(day)}${title ? ' ' + title : ''}${pinned ? ', 고정' : ''}${star ? ', 별표' : ''}`;
    return `<div class="diary-lv-swipe" data-diary-lv-swipe="${esc(day)}"${open}><div class="diary-lv-acts diary-lv-acts-start"><button type="button" class="diary-lv-act" data-diary-lv-act="pin" tabindex="-1" aria-hidden="true">📌<span>${pinned ? '고정 풀기' : '고정'}</span></button></div><div class="diary-lv-acts diary-lv-acts-end"><button type="button" class="diary-lv-act" data-diary-lv-act="star" tabindex="-1" aria-hidden="true">★<span>${star ? '별표 풀기' : '별표'}</span></button></div>`
      + `<div class="diary-lv-row"><button type="button" class="diary-lv-open" data-diary-lv-open="${esc(day)}" aria-label="${esc(label)}"><span class="diary-lv-thumb" data-diary-lv-thumb="${esc(day)}" aria-hidden="true"></span><span class="diary-lv-text"><span class="diary-lv-top"><b>${esc(dayLabel(day))}</b>${title ? `<span class="diary-lv-title">${esc(title)}</span>` : ''}</span>${line ? `<span class="diary-lv-line">${esc(line)}</span>` : ''}</span></button>${markButtons(row)}</div></div>`;
  }
  function paint() {
    if (host.hidden) return;
    observer?.disconnect();
    searchRow.hidden = !state.search;
    if (state.error) { note.innerHTML = `${esc(state.error)} <button type="button" class="mini" data-diary-lv-retry>다시 시도</button>`; body.replaceChildren(); return; }
    if (!state.loaded) { note.textContent = '불러오는 중…'; body.replaceChildren(); return; }
    const list = buildDiaryList(state.rows, {filter:state.filter, query:state.query, opened:state.opened});
    const empty = !list.total ? (state.query ? '찾는 글이 든 일기가 없어요.' : state.filter === 'star' ? '별표한 일기가 없어요. 줄 오른쪽 ☆를 눌러 별표해 보세요.' : '아직 일기가 없어요. [+ 일기]로 남겨 보세요.') : '';
    note.textContent = state.note || empty || (state.truncated ? '최근 일기 1,000편만 보여요.' : '');
    const parts = [];
    if (list.pinned.length) parts.push(`<section class="diary-lv-group" aria-label="고정한 일기"><h4 class="diary-lv-head is-pin">📌 고정 <span>· ${list.pinned.length}</span></h4><div class="diary-lv-rows">${list.pinned.map(rowHtml).join('')}</div></section>`);
    for (const month of list.months) {
      parts.push(`<section class="diary-lv-group"><button type="button" class="diary-lv-head" data-diary-lv-month="${esc(month.key)}" aria-expanded="${month.open}">${esc(month.label)} <span>· ${month.count}</span><i aria-hidden="true">${month.open ? '▾' : '▸'}</i></button>${month.open ? `<div class="diary-lv-rows">${month.rows.map(rowHtml).join('')}</div>` : ''}</section>`);
    }
    body.innerHTML = parts.join('');
    watchThumbs();
  }

  // 작은 그림: 보이는 줄부터 한 장씩.
  function watchThumbs() {
    const boxes = [...body.querySelectorAll('[data-diary-lv-thumb]')];
    if (typeof IntersectionObserver !== 'function') { boxes.slice(0, 20).forEach(fillThumb); return; }
    observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) { observer.unobserve(entry.target); fillThumb(entry.target); }
    }, {rootMargin:'200px 0px'});
    boxes.forEach(box => observer.observe(box));
  }
  function odMonthOf(key) {
    if (!odCache.has(key)) {
      const [y, m] = key.split('-').map(Number);
      odCache.set(key, odReady().then(on => (on ? odTakeWarmMonth(rt, y, m - 1) || odPhotos(rt, y, m - 1) : null)).catch(() => null)); // OD-미리받기: 앱을 켤 때 받아 둔 이번 달이 있으면 그것
    }
    return odCache.get(key);
  }
  async function fillThumb(box) {
    if (box.dataset.filled) return; box.dataset.filled = '1';
    const day = box.dataset.diaryLvThumb, row = rowOf(day), owner = state.owner;
    if (!row) return;
    const photo = diaryPhotos(row)[0];
    if (photo) { box.append(photoElement(row, photo, 'small', {label:'', link:false, rt})); box.classList.add('has-photo'); return; }
    const month = await odMonthOf(day.slice(0, 7));
    const first = month?.days?.[day]?.[0];
    if (!first || owner !== state.owner || !box.isConnected) return;
    box.append(odPhotoElement({kind:'od', source:'onedrive', key:first.id, id:first.id, day, name:first.name, taken_at:first.taken_at, approx:first.approx}, 'small', {label:'', rt}));
    box.classList.add('has-photo');
  }

  // 📌·★ 바꾸기: 서버에 저장된 뒤 목록을 다시 그린다(실패하면 그대로 두고 알린다).
  async function toggleMark(day, kind) {
    const row = rowOf(day); if (!row || state.busy.has(day)) return;
    const key = MARK_KEYS[kind], on = !(kind === 'pin' ? diaryPinnedAt(row) : diaryStarredAt(row)), owner = state.owner;
    state.busy.add(day); state.swipe = null; state.note = ''; paint();
    try {
      const saved = await setDiaryMark(row, key, on, rt);
      if (owner !== state.owner) return;
      state.rows = state.rows.map(r => (r.journal_day === day ? {...r, metadata:saved.metadata, updated_at:saved.updated_at} : r));
      onMarked(saved);
    } catch (error) {
      if (owner !== state.owner) return;
      state.note = error?.code === 'note_changed' ? error.message : kind === 'pin' ? '고정을 저장하지 못했어요. 다시 해 주세요.' : '별표를 저장하지 못했어요. 다시 해 주세요.';
    } finally {
      if (owner === state.owner) { state.busy.delete(day); paint(); host.querySelector(`[data-diary-lv-star="${CSS.escape(day)}"]`)?.focus({preventScroll:true}); }
    }
  }

  const menu = createAnchoredMenu({id:'diaryListMenu', className:'diary-lv-menu', label:'일기 메뉴', historyKey:'kptuDiaryListMenu', key:t => t.dataset.diaryLvMore,
    render:day => {
      const row = rowOf(day); if (!row) return '';
      return `<button type="button" data-diary-lv-menu="open">열기</button><button type="button" data-diary-lv-menu="pin">${diaryPinnedAt(row) ? '📌 고정 풀기' : '📌 고정'}</button><button type="button" data-diary-lv-menu="star">${diaryStarredAt(row) ? '★ 별표 풀기' : '☆ 별표'}</button>`;
    },
    onAction:(button, {id}) => { const act = button.dataset.diaryLvMenu; if (act === 'open') onOpen(id); else if (act) toggleMark(id, act); }});

  // 줄 밀기(폰, 터치만).
  function syncSwipe(wrap, side) {
    if (side) wrap.dataset.side = side; else delete wrap.dataset.side;
    const inner = wrap.querySelector(':scope > .diary-lv-row'); if (inner) inner.style.transform = '';
    for (const b of wrap.querySelectorAll('[data-diary-lv-act]')) { const on = (b.dataset.diaryLvAct === 'pin' ? 'start' : 'end') === side; if (on) b.removeAttribute('aria-hidden'); else b.setAttribute('aria-hidden', 'true'); b.tabIndex = on ? 0 : -1; }
  }
  function closeSwipe() {
    const open = state.swipe; if (!open) return; state.swipe = null;
    const wrap = body.querySelector(`[data-diary-lv-swipe="${CSS.escape(open.day)}"]`); if (wrap) syncSwipe(wrap, '');
  }
  host.addEventListener('pointerdown', e => {
    swallow = false;
    if (e.pointerType !== 'touch') return;
    const inner = e.target.closest('.diary-lv-swipe > .diary-lv-row'); if (!inner) return;
    const wrap = inner.parentElement, day = wrap.dataset.diaryLvSwipe;
    if (state.swipe && state.swipe.day !== day) closeSwipe();
    if (swipeEdge(e.clientX, innerWidth)) return; // 화면 끝은 브라우저 뒤로가기 손동작에 양보
    drag = {id:e.pointerId, x:e.clientX, y:e.clientY, wrap, inner, day, open:state.swipe?.day === day ? swipeOpenOffset(state.swipe.side, ALLOW) : 0, dx:0, on:false};
  });
  host.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.on) {
      const intent = swipeIntent(dx, dy); if (intent === 'wait') return;
      if (intent === 'scroll') { drag = null; return; }
      drag.on = true; drag.inner.classList.add('is-drag'); try { drag.inner.setPointerCapture(e.pointerId); } catch {}
    }
    drag.dx = dx; drag.inner.style.transform = `translateX(${swipeOffset(dx, drag.open, ALLOW)}px)`;
  });
  const endDrag = e => {
    if (!drag || e.pointerId !== drag.id) return; const d = drag; drag = null;
    if (!d.on) return;
    swallow = true; d.inner.classList.remove('is-drag');
    const side = e.type === 'pointercancel' ? (state.swipe?.day === d.day ? state.swipe.side : '') : swipeSettle(swipeOffset(d.dx, d.open, ALLOW), ALLOW);
    state.swipe = side ? {day:d.day, side} : null; syncSwipe(d.wrap, side);
  };
  host.addEventListener('pointerup', endDrag); host.addEventListener('pointercancel', endDrag);
  // 밀고 손을 뗄 때 따라오는 click은 삼킨다(그날 일기가 열리지 않게).
  window.addEventListener('click', e => { if (swallow && host.contains(e.target)) { swallow = false; e.preventDefault(); e.stopImmediatePropagation(); } }, true);

  host.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.disabled || !host.contains(b)) return;
    const d = b.dataset;
    if (state.swipe && !d.diaryLvAct) { const was = state.swipe.day; closeSwipe(); if (d.diaryLvOpen === was) return; }
    if (d.diaryLvAct) { const day = b.closest('[data-diary-lv-swipe]')?.dataset.diaryLvSwipe; if (day) toggleMark(day, d.diaryLvAct); }
    else if (d.diaryLvOpen) onOpen(d.diaryLvOpen);
    else if (d.diaryLvStar) toggleMark(d.diaryLvStar, 'star');
    else if (d.diaryLvMore) menu.open(b);
    else if (d.diaryLvMonth) { const now = b.getAttribute('aria-expanded') === 'true'; state.opened[d.diaryLvMonth] = !now; paint(); host.querySelector(`[data-diary-lv-month="${CSS.escape(d.diaryLvMonth)}"]`)?.focus({preventScroll:true}); }
    else if (b.hasAttribute('data-diary-lv-retry')) load({force:true});
    else if (b.hasAttribute('data-diary-lv-search-close')) setSearch(false);
  });
  input.addEventListener('input', () => { state.query = input.value; state.opened = {}; paint(); });
  input.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); setSearch(false); } });

  function setSearch(on) {
    state.search = on;
    if (!on && state.query) { state.query = ''; input.value = ''; state.opened = {}; }
    paint();
    if (on) input.focus();
  }
  return {
    show() { host.hidden = false; if (state.owner !== scopeNow()) reset(); paint(); load(); },
    hide() { host.hidden = true; observer?.disconnect(); closeSwipe(); },
    reload() { if (state.owner !== scopeNow()) reset(); return load({force:true}); },
    setFilter(filter) { state.filter = filter === 'star' ? 'star' : 'all'; state.opened = {}; paint(); },
    get filter() { return state.filter; },
    toggleSearch() { setSearch(!state.search); },
    get searching() { return state.search; },
    // 그날 일기에서 돌아왔을 때 그 줄로.
    focusDay(day) { const b = host.querySelector(`[data-diary-lv-open="${CSS.escape(day)}"]`); if (b) { b.scrollIntoView({block:'nearest'}); b.focus({preventScroll:true}); } },
    // 일기 화면(달력 쪽)에서 바뀐 행을 목록에도 반영한다(없던 날이면 다음 reload 때).
    syncRow(row) { if (!row?.journal_day) return; const at = state.rows.findIndex(r => r.journal_day === row.journal_day); if (at >= 0) { state.rows[at] = {...state.rows[at], ...row}; } },
    dropDay(day) { state.rows = state.rows.filter(r => r.journal_day !== day); },
    reset,
  };
}
