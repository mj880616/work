import {waitHtml, failHtml, emptyHtml} from './wait-state.js';
import {readHiddenArticles} from './feed-shared.js';
import {setMark, sendSignal, canDeleteNews} from './now-marks.js';
import {bindRowSwipe} from './row-swipe.js';
import {hoverButtonsHtml} from './now-row-acts.js';
import {openRowMenu, appMenuPoint} from './row-menu.js';
import {notify} from './small-notice.js';
import {hiddenEntries, withoutEntry, HIDDEN_LIMIT, UNHIDE_LABEL, UNHIDE_TEXT, HIDDEN_EMPTY} from './now-hidden-model.mjs';
// S70-62 READ-밀기메뉴 [숨긴 글](사용자 11/26 07:41 "근데 숨기기는 어떻게 다시 보지?"): 읽을 거리 머리 ⋯ [숨긴 글] 칸. 이 칸(box)의 유일한 그리기 주인.
// - 목록 = 내가 숨긴 글(뉴스 hidden_at · 사회운동 관심 없음), 최근 숨긴 것 먼저 100개. 원본은 서버 표시 표(작업공간 주인 RLS) — 기기 저장 없음.
// - 줄 = 다른 탭과 같은 글 줄(news-row.mjs, 껍데기 rowOf). 폰은 왼쪽으로 밀어 [다시 보이기], PC는 줄에 마우스를 올린 단추·우클릭 메뉴.
//   다시 보이기 = 숨기기의 반대(같은 서버 길 now-marks.js setMark 'dismiss' 끄기 + 환류 기록 'undismiss'), 5초 [되돌리기].
// - 줄을 누르면 그 글 상세(onOpen). 내가 넣은 기사의 [삭제]도 숨김 칸을 쓰므로 그 기사는 이 목록에 넣지 않는다(삭제는 [되돌리기]로만).
const ACTS = hoverButtonsHtml([{id: 'unhide', label: UNHIDE_LABEL}], {attr: 'data-nhd-act'});

// rowOf(type, row, opts) = 껍데기의 글 줄 HTML. colsOf(type) = 껍데기가 읽는 글 칸. onOpen({type, id}, row) = 글 상세. onChanged() = 다시 보이거나 되돌린 뒤(껍데기 목록 다시 읽기).
export function createNowHidden({box, rowOf, colsOf, onOpen = () => {}, onChanged = () => {}, onCount = () => {}} = {}) {
  let seq = 0, loaded = false, failed = false, entries = [];
  const busy = new Set();
  async function load() {
    const my = ++seq;
    try {
      const got = await readHiddenArticles({newsCols: colsOf('news'), postCols: colsOf('outside'), limit: HIDDEN_LIMIT});
      if (my !== seq) return;
      entries = hiddenEntries(got, {mine: canDeleteNews}); loaded = true; failed = false;
    } catch { if (my === seq && !loaded) failed = true; }
    if (my === seq) paint();
  }
  function paint() {
    if (!box) return;
    onCount(loaded ? entries.length : null);
    if (!loaded) { box.innerHTML = failed ? failHtml({retry: 'data-nhd-retry'}) : waitHtml({rows: 4, h: 56}); return; }
    if (!entries.length) { box.innerHTML = emptyHtml(HIDDEN_EMPTY, {attrs: 'data-nhd-empty'}); return; }
    box.innerHTML = `<div class="nw-card nhd-list" data-nhd-list>${entries.map(e => rowOf(e.type, e.type === 'news' ? {...e.row, starred_at: null} : e.row, {openAttr: 'data-nhd-open', rowAttr: 'data-nhd-row', acts: ACTS, day: true})).join('')}</div>`;
  }
  const entryOf = el => entries.find(e => e.key === el?.dataset?.nwKey) || null;
  async function unhide(e) {
    if (!e || busy.has(e.key)) return;
    busy.add(e.key);
    const item = {type: e.type, id: e.id};
    try {
      await setMark(item, 'dismiss', false); sendSignal(item, 'undismiss');
      entries = withoutEntry(entries, e.key); paint(); onChanged();
      notify(UNHIDE_TEXT, {label: UNHIDE_LABEL, undo: async () => { await setMark(item, 'dismiss', true); sendSignal(item, 'dismiss'); onChanged(); await load(); }});
    } catch { notify('저장하지 못했어요 · 잠시 뒤 다시', {error: true}); }
    finally { busy.delete(e.key); }
  }
  if (box) {
    bindRowSwipe(box, {row: '.now-row[data-nhd-row]', enabled: () => loaded,
      actions: el => (entryOf(el) ? {start: null, end: [{key: 'unhide', label: UNHIDE_LABEL, tone: 'info', icon: 'show'}]} : null),
      run: (key, el) => { if (key === 'unhide') void unhide(entryOf(el)); }});
    box.addEventListener('click', event => {
      const b = event.target.closest?.('button');
      if (!b || !box.contains(b)) return;
      if (b.matches('[data-nhd-retry]')) { failed = false; paint(); void load(); return; }
      const e = entryOf(b.closest('.now-row'));
      if (!e) return;
      if (b.matches('[data-nhd-act="unhide"]')) { event.preventDefault(); void unhide(e); return; }
      if (b.matches('[data-nhd-open]')) onOpen({type: e.type, id: e.id}, e.row);
    });
    // PC 우클릭(또는 Shift+F10): 누른 자리에 같은 [다시 보이기](공용 줄 메뉴 row-menu.js — 다른 글 줄과 같은 부품).
    box.addEventListener('contextmenu', event => {
      const el = event.target.closest?.('.now-row[data-nhd-row]'), e = entryOf(el);
      if (!e) return;
      const at = appMenuPoint(event, el); if (!at) return;
      const title = (el.querySelector('.nw-title')?.textContent || '').replace(/\s+/g, ' ').trim();
      if (openRowMenu(el, {key: 'hidden:' + e.key, title, items: [{id: 'unhide', label: UNHIDE_LABEL}], at, run: () => unhide(e)})) event.preventDefault();
    });
  }
  return {load, paint, reset: () => { seq++; loaded = false; failed = false; entries = []; }, loaded: () => loaded};
}
