import {waitHtml, failHtml, emptyHtml} from './wait-state.js';
import {loadHighlights, highlightsNow, onHighlights, openMarkMenu, noteWithNotice} from './text-highlights.js';
import {hlHit, shortDay} from './text-highlights-model.mjs';
// S53-5 NEWS-밑줄모으기 ③(시안 docs/design/mockups/news-highlights.html ③): News [밑줄] 탭. 이 칸(box)의 유일한 그리기 주인.
// - 새 것이 위. 줄 = 고른 글(노란 띠) · 메모 · 매체 · 날짜 · 제목. 줄을 누르면 그 글의 그 자리로(onOpen), ⋯ = 메모·노트로·복사·지우기(밑줄 메뉴와 같은 부품).
// - [여러 개 고르기] → 줄마다 고르기 칸 + 위쪽 고르기 줄 'n개 고름 [노트로] [모두 고르기] ✕'(공용 고르기 줄 .kptu-actbar-text) → 고른 밑줄을 노트 하나로.
// - 위 찾기 칸 글자로 밑줄 글·메모·제목·매체를 거른다(query).
// 읽기는 서버(app_news_highlights, 작업공간 소유자 RLS). 기기 저장 없음. 바깥 글자는 모두 esc로 그린다.

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const MORE = '<span class="more-dots" aria-hidden="true">⋯</span>';
const TYPE_LABEL = Object.freeze({telegram: '텔레그램'});

// onOpen(h): 그 글 그 자리로(껍데기가 글을 읽어 상세를 연다).
export function createNowHighlights({box, query = () => '', onOpen} = {}) {
  let failed = false, picking = false, seq = 0;
  const picked = new Set();
  async function load({force = true} = {}) {
    const my = ++seq;
    try { await loadHighlights({force}); failed = false; } catch { if (my === seq && !highlightsNow()) failed = true; }
    if (my === seq) paint();
  }
  function rowHtml(h) {
    const meta = [h.source_media || TYPE_LABEL[h.source_type] || '', shortDay(h.source_date || h.created_at), h.source_title || ''].filter(Boolean);
    const pick = picking ? `<input type="checkbox" class="nh-pick" data-nh-pick="${esc(h.id)}" aria-label="이 밑줄 고르기"${picked.has(h.id) ? ' checked' : ''}>` : '';
    return `<div class="nh-row" data-nh-row="${esc(h.id)}">${pick}<button type="button" class="ghost nh-open" data-nh-open="${esc(h.id)}"><span class="nh-q">${esc(h.quote)}</span>${h.memo ? `<span class="nh-memo"><span class="nh-k">메모</span>${esc(h.memo)}</span>` : ''}<span class="nh-meta">${meta.map(m => `<span>${esc(m)}</span>`).join('')}</span></button><button type="button" class="icon-btn nh-more" data-nh-more data-hl-id="${esc(h.id)}" aria-haspopup="true" aria-expanded="false" aria-label="밑줄 메뉴">${MORE}</button></div>`;
  }
  function paint() {
    if (!box) return;
    const all = highlightsNow();
    if (!all) { box.innerHTML = failed ? failHtml({retry: 'data-nh-retry'}) : waitHtml({rows: 4, h: 56}); return; }
    for (const id of [...picked]) if (!all.some(h => h.id === id)) picked.delete(id);
    const list = all.filter(h => hlHit(h, query()));
    const head = picking
      ? `<div class="nx-select-bar nh-select" role="toolbar" aria-label="고른 밑줄"><span data-nh-count>${picked.size}개 고름</span><span class="kptu-actbar kptu-actbar-text nx-sel-acts"><button type="button" class="ghost kptu-act" data-nh-note${picked.size ? '' : ' disabled'}>노트로</button><button type="button" class="ghost kptu-act" data-nh-all>모두 고르기</button></span><button type="button" class="icon-btn nx-sel-close" data-nh-pickend aria-label="고르기 끝내기">✕</button></div>`
      : (all.length > 1 ? '<div class="nh-head"><button type="button" class="ghost os-text-btn" data-nh-pickstart>여러 개 고르기</button></div>' : '');
    if (!list.length) { box.innerHTML = head + emptyHtml(query() ? '찾은 밑줄 없음' : '저장한 밑줄 없음 · 원문에서 글을 골라 [밑줄 저장]', {attrs: 'data-nh-empty'}); return; }
    box.innerHTML = head + `<div class="nh-list nw-card">${list.map(rowHtml).join('')}</div>`;
  }
  onHighlights(() => paint());
  box?.addEventListener('change', e => {
    const c = e.target.closest?.('[data-nh-pick]');
    if (!c) return;
    if (c.checked) picked.add(c.dataset.nhPick); else picked.delete(c.dataset.nhPick);
    const n = box.querySelector('[data-nh-count]'), b = box.querySelector('[data-nh-note]');
    if (n) n.textContent = `${picked.size}개 고름`;
    if (b) b.disabled = !picked.size;
  });
  box?.addEventListener('click', async e => {
    const b = e.target.closest('button');
    if (!b || !box.contains(b)) return;
    if (b.matches('[data-nh-retry]')) { failed = false; paint(); void load(); return; }
    if (b.matches('[data-nh-more]')) { openMarkMenu(b); return; }
    if (b.matches('[data-nh-pickstart]')) { picking = true; picked.clear(); paint(); box.querySelector('[data-nh-pick]')?.focus({preventScroll: true}); return; }
    if (b.matches('[data-nh-pickend]')) { picking = false; picked.clear(); paint(); return; }
    if (b.matches('[data-nh-all]')) { for (const h of (highlightsNow() || []).filter(x => hlHit(x, query()))) picked.add(h.id); paint(); return; }
    if (b.matches('[data-nh-note]')) {
      const list = (highlightsNow() || []).filter(h => picked.has(h.id));
      if (list.length && await noteWithNotice(list)) { picking = false; picked.clear(); paint(); }
      return;
    }
    if (b.matches('[data-nh-open]')) {
      if (picking) { const c = b.parentElement.querySelector('[data-nh-pick]'); if (c) { c.checked = !c.checked; c.dispatchEvent(new Event('change', {bubbles: true})); } return; }
      const h = (highlightsNow() || []).find(x => x.id === b.dataset.nhOpen);
      if (h) onOpen?.(h);
    }
  });
  return {load, paint, reset: () => { seq++; failed = false; picking = false; picked.clear(); }};
}
