import {waitHtml, failHtml, emptyHtml} from './wait-state.js';
import {loadHighlights, highlightsNow, onHighlights, openMarkMenu, noteWithNotice} from './text-highlights.js';
import {hlHit, shortDay} from './text-highlights-model.mjs';
import {lockedLineHtml} from './locked-line.mjs';
// S53-5 NEWS-밑줄모으기 ③(시안 docs/design/mockups/news-highlights.html ③): News [밑줄] 탭. 이 칸(box)의 유일한 그리기 주인.
// - 새 것이 위. 줄 = 고른 글(노란 띠) · 메모 · 매체 · 날짜 · 제목. 줄을 누르면 그 글의 그 자리로(onOpen), ⋯ = 메모·노트로·복사·지우기(밑줄 메뉴와 같은 부품).
// - [여러 개 고르기] → 줄마다 고르기 칸 + 위쪽 고르기 줄 'n개 고름 [노트로] [모두 고르기] ✕'(공용 고르기 줄 .kptu-actbar-text) → 고른 밑줄을 노트 하나로.
// - 위 찾기 칸 글자로 밑줄 글·메모·제목·매체를 거른다(query).
// 읽기는 서버(app_news_highlights, 작업공간 소유자 RLS). 기기 저장 없음. 바깥 글자는 모두 esc로 그린다.

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const MORE = '<span class="more-dots" aria-hidden="true">⋯</span>';
const TYPE_LABEL = Object.freeze({telegram: '텔레그램', note: '노트'});

// 밑줄 줄 하나(News [밑줄] 탭과 — ⋯의 basket-row-more는 노트 칸에서만 모양이 붙는다(노트 줄 ⋯와 같은 자리) — 노트 'News에서 › 밑줄'이 같은 줄 — note-news-marks.js). tag: 줄 앞 작은 꼬리표(노트 검색 결과의 '밑줄').
// gone: 원문 글이 바뀌어 고른 글이 없음(노트 밑줄 — NOTE-노트에서도밑줄) → 메타 줄 끝 작은 '원문이 바뀌었어요'(밑줄은 지우지 않음).
// src: 메타 줄 맨 앞 출처 꼬리표(노트 › 밑줄 목록의 노트·News·텔레그램, S62-17) — 매체 이름이 같으면 한 번만.
export function highlightRowHtml(h, {picking = false, picked = false, tag = '', gone = false, src = ''} = {}) {
  const media = h.source_media || TYPE_LABEL[h.source_type] || '';
  const meta = [src ? `<b class="nh-src">${esc(src)}</b>` : '', ...[media === src ? '' : media, shortDay(h.source_date || h.created_at), h.source_title || ''].filter(Boolean).map(esc)].filter(Boolean);
  const pick = picking ? `<input type="checkbox" class="nh-pick" data-nh-pick="${esc(h.id)}" aria-label="이 밑줄 선택"${picked ? ' checked' : ''}>` : '';
  return `<div class="nh-row" data-nh-row="${esc(h.id)}">${pick}<button type="button" class="ghost nh-open" data-nh-open="${esc(h.id)}">${tag ? `<span class="nnm-tag">${esc(tag)}</span>` : ''}<span class="nh-q">${esc(h.quote)}</span>${h.memo ? `<span class="nh-memo"><span class="nh-k">메모</span>${esc(h.memo)}</span>` : ''}<span class="nh-meta">${meta.map(m => `<span>${m}</span>`).join('')}${gone ? '<span class="nh-gone" data-nh-gone>원문이 바뀌었어요</span>' : ''}</span></button><button type="button" class="icon-btn basket-row-more nh-more" data-nh-more data-hl-id="${esc(h.id)}" aria-haspopup="true" aria-expanded="false" aria-label="밑줄 메뉴">${MORE}</button></div>`;
}

// News [밑줄] 탭은 News·텔레그램 원문 밑줄만(노트에서 저장한 밑줄은 노트 › 밑줄에서 보고 연다 — 여기서 누르면 News 상세로 가므로, S62-17).
// S68-09: 읽을 거리 밑줄도 뺀다(읽을 거리 화면·노트 › 밑줄에서 보고 연다).
const newsOnly = list => (list ? list.filter(h => h.source_type !== 'note' && h.source_type !== 'reading') : list);
// onOpen(h): 그 글 그 자리로(껍데기가 글을 읽어 상세를 연다).
export function createNowHighlights({box, query = () => '', onOpen} = {}) {
  let failed = false, picking = false, seq = 0;
  const picked = new Set();
  async function load({force = true} = {}) {
    const my = ++seq;
    try { await loadHighlights({force}); failed = false; } catch { if (my === seq && !highlightsNow()) failed = true; }
    if (my === seq) paint();
  }
  const rowHtml = h => highlightRowHtml(h, {picking, picked: picked.has(h.id)});
  function paint() {
    if (!box) return;
    const raw = newsOnly(highlightsNow());
    // SEC-기능PIN잠금(S67-14): 텔레그램 소식을 잠갔고 아직 안 풀었으면 텔레그램 밑줄은 그리지 않고 맨 아래 '잠김' 한 줄만(몇 줄인지만).
    const tgLocked = !!window.KPTUFeatureLock?.hides?.('telegram') && !!window.KPTUFeatureLock?.settings?.();
    const all = raw && (tgLocked ? raw.filter(h => h.source_type !== 'telegram') : raw);
    const hidden = raw && tgLocked ? raw.length - all.length : 0;
    const lockedLine = hidden ? lockedLineHtml({features: ['telegram'], label: '텔레그램 밑줄', count: hidden, cls: 'nbx-faint forget-locked', attrs: 'data-nh-locked'}) : '';
    if (!all) { box.innerHTML = failed ? failHtml({retry: 'data-nh-retry'}) : waitHtml({rows: 4, h: 56}); return; }
    for (const id of [...picked]) if (!all.some(h => h.id === id)) picked.delete(id);
    const list = all.filter(h => hlHit(h, query()));
    const head = picking
      ? `<div class="nx-select-bar nh-select" role="toolbar" aria-label="선택한 밑줄"><span data-nh-count>${picked.size}개 선택됨</span><span class="kptu-actbar kptu-actbar-text nx-sel-acts"><button type="button" class="ghost kptu-act" data-nh-note${picked.size ? '' : ' disabled'}>노트로</button><button type="button" class="ghost kptu-act" data-nh-all>모두 선택</button></span><button type="button" class="icon-btn nx-sel-close" data-nh-pickend aria-label="선택 끝내기">✕</button></div>`
      : (all.length > 1 ? '<div class="nh-head"><button type="button" class="ghost os-text-btn" data-nh-pickstart>여러 개 선택</button></div>' : '');
    if (!list.length) { box.innerHTML = head + (hidden && !query() ? '' : emptyHtml(query() ? '찾은 밑줄 없음' : '저장한 밑줄 없음 · 원문에서 글을 선택해 [밑줄 저장]', {attrs: 'data-nh-empty'})) + lockedLine; return; }
    box.innerHTML = head + `<div class="nh-list nw-card">${list.map(rowHtml).join('')}</div>` + lockedLine;
  }
  onHighlights(() => paint());
  window.addEventListener('kptu:feature-lock-changed', () => paint());
  box?.addEventListener('change', e => {
    const c = e.target.closest?.('[data-nh-pick]');
    if (!c) return;
    if (c.checked) picked.add(c.dataset.nhPick); else picked.delete(c.dataset.nhPick);
    const n = box.querySelector('[data-nh-count]'), b = box.querySelector('[data-nh-note]');
    if (n) n.textContent = `${picked.size}개 선택됨`;
    if (b) b.disabled = !picked.size;
  });
  box?.addEventListener('click', async e => {
    const b = e.target.closest('button');
    if (!b || !box.contains(b)) return;
    if (b.matches('[data-nh-retry]')) { failed = false; paint(); void load(); return; }
    if (b.matches('[data-nh-more]')) { openMarkMenu(b); return; }
    if (b.matches('[data-nh-pickstart]')) { picking = true; picked.clear(); paint(); box.querySelector('[data-nh-pick]')?.focus({preventScroll: true}); return; }
    if (b.matches('[data-nh-pickend]')) { picking = false; picked.clear(); paint(); return; }
    if (b.matches('[data-nh-all]')) { for (const h of (newsOnly(highlightsNow()) || []).filter(x => hlHit(x, query()))) picked.add(h.id); paint(); return; }
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
