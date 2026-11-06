import {waitHtml, failHtml, emptyHtml} from './wait-state.js';
import {bindNowRows, hoverActsHtml} from './now-row-acts.js';
import {ensureReads} from './news-reads.js';
import {SAVED_CHIPS, keepSavedChip, savedRows, filterSaved, itemKey, titleHit} from './now-model.mjs';
// OUTSIDE-글상세·관심환류 ④(설계 docs/design/outside-statements.md 12.1절): Now [보관] 탭.
// 두 쪽의 별표·보관을 한곳에: 사회운동 글(app_outside_marks의 starred_at·archived_at) + 뉴스 기사(app_news_items.starred_at, 보관 = 별표 폴더).
// 칩 [전체] [별표] [보관] [사회운동] [언론]. 줄 전체를 누르면 같은 상세(now-detail.js)가 열린다. 언론 별표 폴더 정리는 ⋯ [별표 폴더](news-clipping.js).
// S51-8 NEWS P4b: 줄 모양은 다른 탭과 같은 news-row.mjs(껍데기가 준 rowOf), 위 찾기 칸 글자로 제목을 거른다(query).
// 읽기만 한다(서버, 작업공간 소유자 RLS). 이 칸(box)의 유일한 그리기 주인.

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const q = v => encodeURIComponent(v);
const rt = () => window.KPTURuntime;
const workspaceOf = () => rt()?.context?.read?.()?.workspace?.id || '';
const POST_COLS = 'id,source_key,kind,lang,title,title_ko,url,published_at,fetched_at,summary_ko,key_sentences,has_body';
const NEWS_COLS = 'id,lane,url,title,lang,publisher,published_at,created_at,summary,title_ko,starred_at,folder_id,state,body_kind';

// describe(type, row) → {meta, title, ...} 상세 머리, rowOf(type, row, opts) → 줄 글자(News 껍데기가 준다). onOpen(item, head).
export function createNowSaved({box, describe, rowOf, query = () => '', onOpen, onChanged, onListed} = {}) {
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
    void ensureReads(rows.map(r => ({type: r.type, id: r.id})));
    paint();
  }
  function paint() {
    if (!box) return;
    const chips = `<div class="now-saved-chips" role="group" aria-label="보관 거르기">${SAVED_CHIPS.map(c => `<button type="button" class="os-chip" data-ns-chip="${c.id}" aria-pressed="${chip === c.id}">${esc(c.label)}</button>`).join('')}</div>`;
    if (!loaded) { box.innerHTML = chips + (failed ? failHtml({retry: 'data-ns-retry'}) : waitHtml({rows: 5, h: 56})); return; }
    const list = filterSaved(rows, chip).filter(r => titleHit([describe(r.type, r.row).title, r.row?.title], query()));
    if (!list.length) { box.innerHTML = chips + emptyHtml(query() ? '제목에서 찾은 글 없음' : '보관한 글 없음', {attrs: 'data-ns-empty'}); return; }
    box.innerHTML = chips + `<div class="now-saved-list nw-card">${list.map(r => rowOf(r.type, r.row, {openAttr: 'data-ns-open', rowAttr: 'data-ns-row', star: r.star, acts: `${r.archive ? '<span class="ns-mark">보관</span>' : ''}${hoverActsHtml({saved: true})}`})).join('')}</div>`;
    onListed?.();
  }
  box?.addEventListener('click', event => {
    const b = event.target.closest('button');
    if (!b || !box.contains(b)) return;
    if (b.matches('[data-ns-chip]')) { chip = keepSavedChip(b.dataset.nsChip); paint(); box.querySelector(`[data-ns-chip="${chip}"]`)?.focus({preventScroll: true}); return; }
    if (b.matches('[data-ns-retry]')) { failed = false; paint(); load(); return; }
    if (b.matches('[data-ns-open]')) {
      const key = b.closest('[data-nw-key]')?.dataset.nwKey, r = rows.find(x => itemKey(x) === key);
      if (r) onOpen?.({type: r.type, id: r.id}, describe(r.type, r.row));
    }
  });
  // 줄 밀기·마우스 단추: [보관] 탭의 오른쪽 밀기 = 보관 풀기(now-row-acts.js). 풀면 이 탭에서 빠지고, 되돌리면 다시 읽는다.
  bindNowRows(box, {row: '[data-nw-key]', saved: true, itemOf: el => { const [type, id] = String(el.dataset.nwKey || '').split(':'); return (type === 'outside' || type === 'news') && id ? {type, id} : null; },
    changed: (item, kind, on) => {
      if (kind === 'release') rows = rows.filter(r => !(r.type === item.type && r.id === item.id));
      paint(); load(); onChanged?.(item, kind, on);
    }});
  return {load, paint, reset: () => { rows = []; loaded = false; failed = false; chip = 'all'; seq++; }};
}
