import {waitHtml, failHtml, emptyHtml} from './wait-state.js';
import {ftFolderRowHtml, ftFocusHtml} from './folder-tree-ui.mjs';
import {treeIconHtml} from './tree-icons.js';
import {loadHighlights, highlightsNow, onHighlights, openMarkMenu} from './text-highlights.js';
import {highlightRowHtml} from './now-highlights.js';
import {readSavedRows} from './now-saved.js';
import {bindNowRows, hoverActsHtml} from './now-row-acts.js';
import {requestNewsOpen, requestNewsTab} from './news-request.mjs';
import {NEWS_HL, NEWS_SAVED, isNewsAt, NEWS_GROUP_NAME, NEWS_NAMES, SAVED_KINDS, keepSavedKind, filterSavedKind, savedLine, newsSearch, searchHead} from './note-news-marks-model.mjs';
// NOTE-News밑줄보관보기(명진 11/15 '가'·'추천대로', 시안 docs/design/mockups/note-news-marks.html ①~④):
// 노트 [폴더] 목록 맨 아래(폴더 없음 밑) 얇은 줄 'News에서' + [밑줄 n]·[보관한 글 n]. 노트가 아니라 News와 같은 서버 자료를 그대로 읽어 보인다 —
// 밑줄은 text-highlights.js가 들고 있는 같은 목록(News에서 지우거나 메모를 고치면 이 칸도 바로 같게), 보관한 글은 News [보관] 탭과 같은 읽기(now-saved.js readSavedRows).
// 새 저장 표·기기 저장·복사본 없음. 이 모듈은 노트 칸의 두 상자([data-nnm-head] 찾은 수 머리, [data-nnm] 목록)의 유일한 그리기 주인이다.
// 줄 모양·메뉴는 News 부품 그대로: 밑줄 줄 = now-highlights.js highlightRowHtml + 밑줄 메뉴(openMarkMenu, 여기서는 [원문에서 보기]를 더함),
// 보관한 글 줄 ⋯·우클릭·밀기 = now-row-acts.js bindNowRows(보관 풀기). 줄을 누르면 News로 가서 그 글(밑줄이면 그 자리)을 연다(news-request.mjs).
// [목록]·[포스트잇]·[태그]·[댓글] 보기에는 넣지 않는다(노트가 아님 — 껍데기 basket-notes.js가 [폴더] 보기에서만 부른다).
// 바깥 글자는 모두 esc로만 그린다. 로그에 밑줄 글·제목을 남기지 않는다.

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const MORE = '<span class="more-dots" aria-hidden="true">⋯</span>';
const HL_ICON = '<span class="ft-ico nnm-hlico" aria-hidden="true"></span>';
const nameOf = key => window.KPTUOutside?.sourceName?.(key) || null;

// onChange(): 자료가 새로 왔다(껍데기가 목록을 다시 그린다 — 줄 수·찾은 수가 바뀜).
export function createNoteNewsMarks({head, box, onChange = () => {}} = {}) {
  let saved = null, savedFailed = false, hlFailed = false, kind = 'all', seq = 0, off = false;
  async function load() {
    const my = ++seq;
    off = false;
    const [hl, sv] = await Promise.allSettled([loadHighlights({force: true}), readSavedRows()]);
    if (my !== seq) return;
    hlFailed = hl.status === 'rejected' && !highlightsNow();
    if (sv.status === 'fulfilled' && sv.value) { saved = sv.value; savedFailed = false; }
    else if (sv.status === 'rejected' || sv.value === null) savedFailed = !saved;
    onChange();
  }
  async function reloadSaved() {
    const my = ++seq;
    try { const got = await readSavedRows(); if (my === seq && got) { saved = got; savedFailed = false; } } catch { /* 그대로 */ }
    if (my === seq) onChange();
  }
  onHighlights(() => { if (!off) onChange(); });
  const hlCount = () => highlightsNow()?.length ?? null;
  const svCount = () => saved?.length ?? null;

  // 'News에서' 얇은 줄 + 두 줄(노트 폴더 줄과 같은 공용 줄 — 끌어 놓을 곳이 아니다). at: 지금 고른 곳(PC 나무에서 표시).
  function navHtml({tree = false, at = null} = {}) {
    const row = (id, icon, count) => ftFolderRowHtml({name: NEWS_NAMES[id], count: count ?? '', countLabel: count === null ? '' : `${NEWS_NAMES[id]} ${count}개`, depth: 0, hasContent: false,
      current: tree && at === id, tree, className: 'nx-news-item', icon, rowAttrs: {'data-nx-news-item': id}, mainAttrs: {'data-nx-open': id}});
    return `<div class="nnm-sep" role="presentation">${esc(NEWS_GROUP_NAME)}</div>`
      + row(NEWS_HL, HL_ICON, hlCount())
      + row(NEWS_SAVED, treeIconHtml('starred', {className: 'ft-ico'}), svCount());
  }

  const hlRows = (list, tag = '') => list.map(h => highlightRowHtml(h, {tag})).join('');
  function savedRowHtml(r, tag = '') {
    const l = savedLine(r, nameOf);
    const mark = tag ? `<span class="nnm-tag">${esc(tag)}</span>` : l.star ? '<span class="nnm-star" aria-label="별표">★</span>' : '<span class="nnm-tag">보관</span>';
    return `<div class="nnm-sv now-row" data-nw-key="${esc(l.key)}"><button type="button" class="ghost nnm-open" data-nnm-saved="${esc(l.key)}">${mark}<span class="nnm-t">${esc(l.title)}</span><span class="nnm-m">${esc([l.media, l.day].filter(Boolean).join(' · '))}</span></button>${hoverActsHtml({saved: true})}<button type="button" class="icon-btn basket-row-more" data-now-more aria-haspopup="true" aria-expanded="false" aria-label="보관한 글 메뉴">${MORE}</button></div>`;
  }
  const srcBtn = id => `<button type="button" class="secondary nnm-src" data-nnm-news="${id}">News에서 보기 ↗</button>`;
  function listHtml(at) {
    if (at === NEWS_HL) {
      const all = highlightsNow();
      if (!all) return hlFailed ? failHtml({retry: 'data-nnm-retry'}) : waitHtml({rows: 4, h: 56});
      return all.length ? `<div class="nh-list nw-card nnm-card">${hlRows(all)}</div>` : emptyHtml('저장한 밑줄 없음 · News 원문에서 글을 선택해 [밑줄 저장]', {attrs: 'data-nnm-empty'});
    }
    const chips = `<div class="filter-chips nnm-chips" role="group" aria-label="보관한 글 거르기">${SAVED_KINDS.map(k => `<button type="button" class="ds-chip" data-nnm-kind="${k.id}" aria-pressed="${kind === k.id}">${esc(k.label)}</button>`).join('')}</div>`;
    if (!saved) return chips + (savedFailed ? failHtml({retry: 'data-nnm-retry'}) : waitHtml({rows: 4, h: 40}));
    const list = filterSavedKind(saved, kind);
    return chips + (list.length ? `<div class="nw-card nnm-card">${list.map(r => savedRowHtml(r)).join('')}</div>` : emptyHtml('보관한 글 없음', {attrs: 'data-nnm-empty'}));
  }

  // 그리기(껍데기 renderList가 부른다). at: 지금 자리, query: 노트 검색 글자, phone: 폰 '그 폴더만' 상자, notes: 찾은 노트 수.
  function paint({at = null, query = '', phone = false, notes = 0, folderView = true} = {}) {
    if (!head || !box) return;
    if (!folderView) { clear(); return; }
    if (query) {
      const hit = newsSearch({highlights: highlightsNow() || [], saved: saved || [], query, nameOf});
      head.hidden = false;
      head.innerHTML = `<span class="nnm-q">'${esc(query)}' 찾은 것</span><span class="nnm-n">${esc(searchHead(notes, hit.highlights.length, hit.saved.length))}</span>`;
      const rows = hlRows(hit.highlights, '밑줄') + hit.saved.map(r => savedRowHtml(r, '보관')).join('');
      box.hidden = !rows;
      box.innerHTML = rows ? `<div class="nw-card nnm-card nnm-found">${rows}</div>` : '';
      return;
    }
    head.hidden = true; head.replaceChildren();
    if (!isNewsAt(at)) { box.hidden = true; box.replaceChildren(); return; }
    box.hidden = false;
    const count = at === NEWS_HL ? hlCount() : svCount(), name = NEWS_NAMES[at];
    if (phone) {
      const ico = at === NEWS_HL ? HL_ICON : treeIconHtml('starred', {className: 'ft-ico'});
      box.innerHTML = ftFocusHtml({back: {'data-nx-back': ''}, trail: [{label: '노트', attrs: {'data-nx-at': ''}}], name, count: count === null ? '' : String(count), body: `<div class="nnm-bar">${ico}${srcBtn(at)}</div>${listHtml(at)}`, attrs: {'data-nnm-focus': at}});
      return;
    }
    box.innerHTML = `<div class="nnm-head"><b>${esc(name)}</b>${count === null ? '' : `<span class="nnm-n">${count}</span>`}${srcBtn(at)}</div>${listHtml(at)}`;
  }
  function clear() { if (head) { head.hidden = true; head.replaceChildren(); } if (box) { box.hidden = true; box.replaceChildren(); } }
  // 노트 검색에 걸린 밑줄·보관 수(껍데기의 '맞는 노트 없음'을 가린다).
  const hits = query => { if (!query) return 0; const h = newsSearch({highlights: highlightsNow() || [], saved: saved || [], query, nameOf}); return h.highlights.length + h.saved.length; };

  const goNews = () => window.KPTURouter?.go?.('news', {source: 'delegated'});
  const openHighlight = h => { if (h && requestNewsOpen({type: h.source_type, id: h.source_id, highlight: h.id})) goNews(); };
  box?.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || !box.contains(b)) return;
    if (b.matches('[data-nnm-retry]')) { hlFailed = false; savedFailed = false; onChange(); void load(); return; }
    if (b.matches('[data-nh-more]') && b.dataset.hlId) { openMarkMenu(b, {onSource: openHighlight}); return; }
    if (b.matches('[data-nh-open]')) { openHighlight((highlightsNow() || []).find(x => x.id === b.dataset.nhOpen)); return; }
    if (b.matches('[data-nnm-kind]')) { kind = keepSavedKind(b.dataset.nnmKind); onChange(); box.querySelector(`[data-nnm-kind="${kind}"]`)?.focus({preventScroll: true}); return; }
    if (b.matches('[data-nnm-saved]')) { const [type, id] = String(b.dataset.nnmSaved).split(':'); if (requestNewsOpen({type, id})) goNews(); return; }
    // [News에서 보기 ↗]: News의 같은 탭으로([밑줄] 탭은 기억하지 않는 탭이라 탭 요청 대신 열 글 없이 그 탭만).
    if (b.matches('[data-nnm-news]')) { if (b.dataset.nnmNews === NEWS_HL) requestNewsTab('marks'); else requestNewsTab('archive'); goNews(); }
  });
  bindNowRows(box, {row: '[data-nw-key]', saved: true, titleOf: el => el.querySelector('.nnm-t')?.textContent || '',
    itemOf: el => { const [type, id] = String(el.dataset.nwKey || '').split(':'); return (type === 'outside' || type === 'news') && id ? {type, id} : null; },
    changed: (item, k) => { if (k === 'release' && saved) saved = saved.filter(r => !(r.type === item.type && r.id === item.id)); onChange(); void reloadSaved(); }});
  return {load, paint, navHtml, hits, clear, reset: () => { seq++; off = true; saved = null; savedFailed = false; hlFailed = false; kind = 'all'; clear(); }};
}
export {NEWS_HL, NEWS_SAVED, isNewsAt};
