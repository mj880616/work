import {waitHtml, failHtml, emptyHtml} from './wait-state.js';
import {bindNowRows, hoverActsHtml} from './now-row-acts.js';
import {SAVED_CHIPS, keepSavedChip, savedRows, filterSaved, itemKey, interestHit} from './now-model.mjs';
// OUTSIDE-글상세·관심환류 ④(설계 docs/design/outside-statements.md 12.1절): Now [보관] 탭.
// 두 쪽의 별표·보관을 한곳에: 사회운동 글(app_outside_marks의 starred_at·archived_at) + 뉴스 기사(app_news_items.starred_at, 보관 = 별표 폴더).
// 칩 [전체] [별표] [보관] [사회운동] [뉴스]. 줄 전체를 누르면 같은 상세(now-detail.js)가 열린다. 뉴스 별표 폴더 정리는 [뉴스] 탭 [별표] 칩 그대로.
// 읽기만 한다(서버, 작업공간 소유자 RLS). 이 칸(box)의 유일한 그리기 주인.

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const q = v => encodeURIComponent(v);
const rt = () => window.KPTURuntime;
const workspaceOf = () => rt()?.context?.read?.()?.workspace?.id || '';
const POST_COLS = 'id,source_key,kind,lang,title,title_ko,url,published_at,fetched_at,summary_ko,key_sentences,has_body';
const NEWS_COLS = 'id,lane,url,title,lang,publisher,published_at,created_at,summary,title_ko,starred_at,folder_id';

// describe(type, row) → {meta, title, ...} 상세 머리(Now 껍데기가 준다). onOpen(item, head).
export function createNowSaved({box, describe, topics = () => [], onOpen, selected = () => '', onChanged, onListed} = {}) {
  let rows = [], loaded = false, failed = false, chip = 'all', seq = 0;
  async function load() {
    const w = workspaceOf(), my = ++seq;
    if (!w) return;
    const [marks, news] = await Promise.allSettled([
      rt().api(`/rest/v1/app_outside_marks?workspace_id=eq.${q(w)}&or=(starred_at.not.is.null,archived_at.not.is.null)&select=post_id,starred_at,archived_at,app_outside_posts(${POST_COLS})&limit=300`, {singleFlight: false}),
      rt().api(`/rest/v1/app_news_items?workspace_id=eq.${q(w)}&starred_at=not.is.null&select=${NEWS_COLS}&order=starred_at.desc&limit=300`, {singleFlight: false}),
    ]);
    if (my !== seq) return;
    if (marks.status === 'rejected' && news.status === 'rejected') { if (!loaded) failed = true; paint(); return; }
    rows = savedRows(marks.status === 'fulfilled' ? marks.value : [], news.status === 'fulfilled' ? news.value : []);
    loaded = true; failed = false;
    paint();
  }
  function paint() {
    if (!box) return;
    const chips = `<div class="now-saved-chips" role="group" aria-label="보관 거르기">${SAVED_CHIPS.map(c => `<button type="button" class="os-chip" data-ns-chip="${c.id}" aria-pressed="${chip === c.id}">${esc(c.label)}</button>`).join('')}</div>`;
    if (!loaded) { box.innerHTML = chips + (failed ? failHtml({retry: 'data-ns-retry'}) : waitHtml({rows: 5, h: 56})); return; }
    const list = filterSaved(rows, chip);
    if (!list.length) { box.innerHTML = chips + emptyHtml('보관한 글 없음', {attrs: 'data-ns-empty'}); return; }
    const sel = selected();
    box.innerHTML = chips + `<div class="now-saved-list">${list.map(r => {
      const h = describe(r.type, r.row);
      const hit = interestHit([h.title, h.lead], topics());
      const marks = `${r.star ? '<span class="ns-mark">★</span>' : ''}${r.archive ? '<span class="ns-mark">보관</span>' : ''}`;
      return `<article class="now-row ns-row${sel === itemKey(r) ? ' is-open' : ''}" data-ns-row="${esc(itemKey(r))}"><p class="os-meta"><span class="ns-side">${r.type === 'news' ? '뉴스' : '사회운동'}</span>${h.meta.filter(Boolean).map(m => `<span>${esc(m)}</span>`).join('')}${marks}</p><h4 class="os-title"><button type="button" class="now-open" data-ns-open="${esc(itemKey(r))}">${esc(h.title)}</button></h4>${h.lead ? `<p class="os-lead">${esc(h.lead)}</p>` : ''}${hit ? `<span class="now-hit">${esc(hit)}</span>` : ''}${hoverActsHtml({saved: true})}</article>`;
    }).join('')}</div>`;
    onListed?.();
  }
  box?.addEventListener('click', event => {
    const b = event.target.closest('button');
    if (!b || !box.contains(b)) return;
    if (b.matches('[data-ns-chip]')) { chip = keepSavedChip(b.dataset.nsChip); paint(); box.querySelector(`[data-ns-chip="${chip}"]`)?.focus({preventScroll: true}); return; }
    if (b.matches('[data-ns-retry]')) { failed = false; paint(); load(); return; }
    if (b.matches('[data-ns-open]')) {
      const r = rows.find(x => itemKey(x) === b.dataset.nsOpen);
      if (r) onOpen?.({type: r.type, id: r.id}, describe(r.type, r.row));
    }
  });
  // 줄 밀기·마우스 단추: [보관] 탭의 오른쪽 밀기 = 보관 풀기(now-row-acts.js). 풀면 이 탭에서 빠지고, 되돌리면 다시 읽는다.
  bindNowRows(box, {row: '[data-ns-row]', saved: true, itemOf: el => { const [type, id] = String(el.dataset.nsRow || '').split(':'); return (type === 'outside' || type === 'news') && id ? {type, id} : null; },
    changed: (item, kind, on) => {
      if (kind === 'release') rows = rows.filter(r => !(r.type === item.type && r.id === item.id));
      paint(); load(); onChanged?.(item, kind, on);
    }});
  return {load, paint, reset: () => { rows = []; loaded = false; failed = false; chip = 'all'; seq++; }};
}
