import {waitHtml, failHtml, emptyHtml} from './wait-state.js';
import {ftFolderRowHtml, ftFocusHtml} from './folder-tree-ui.mjs';
import {treeIconHtml} from './tree-icons.js';
import {loadHighlights, highlightsNow, onHighlights, openMarkMenu} from './text-highlights.js';
import {highlightRowHtml} from './now-highlights.js';
import {readSavedRows} from './now-saved.js';
import {myFeaturesOrNull} from './my-features.js';
import {bindNowRows, hoverActsHtml} from './now-row-acts.js';
import {canDeleteNews} from './now-marks.js';
import {requestNewsOpen} from './news-request.mjs';
import {openOnScreen} from './source-open.js';
import {sourceTag, quoteGone} from './text-highlights-model.mjs';
import {visibleMarks, marksNewsOn, NEWS_HL, NEWS_SAVED, isNewsAt, NEWS_NAMES, SAVED_KINDS, keepSavedKind, filterSavedKind, savedLine, newsSearch, searchHead} from './note-news-marks-model.mjs';
// NOTE-News밑줄보관보기(명진 11/15 '가'·'추천대로', 시안 docs/design/mockups/note-news-marks.html ①~④):
// 노트 [폴더] 목록 맨 아래(폴더 없음 밑) 얇은 줄 'News에서' + [밑줄 n]·[보관한 글 n]. 노트가 아니라 News와 같은 서버 자료를 그대로 읽어 보인다 —
// 밑줄은 text-highlights.js가 들고 있는 같은 목록(News에서 지우거나 메모를 고치면 이 칸도 바로 같게), 보관한 글은 읽을 거리 [News]와 같은 읽기(now-saved.js readSavedRows — S68-24 News [보관] 탭은 없앰).
// 새 저장 표·기기 저장·복사본 없음. 이 모듈은 노트 칸의 두 상자([data-nnm-head] 찾은 수 머리, [data-nnm] 목록)의 유일한 그리기 주인이다.
// 줄 모양·메뉴는 News 부품 그대로: 밑줄 줄 = now-highlights.js highlightRowHtml + 밑줄 메뉴(openMarkMenu, 여기서는 [원문에서 보기]를 더함),
// 보관한 글 줄 ⋯·우클릭·밀기 = now-row-acts.js bindNowRows(보관 풀기). 줄을 누르면 News로 가서 그 글(밑줄이면 그 자리)을 연다(news-request.mjs).
// [목록]·[포스트잇]·[태그]·[댓글] 보기에는 넣지 않는다(노트가 아님 — 껍데기 basket-notes.js가 [폴더] 보기에서만 부른다).
// S62-17 NOTE-노트에서도밑줄(11/15 명진): 노트 본문에서 저장한 밑줄(source_type 'note')도 같은 '밑줄' 목록에 새 것이 위로 함께 쌓인다.
// 줄 앞 출처 꼬리표 노트·News·텔레그램. 노트 밑줄 줄을 누르면 껍데기의 openNote(노트 id, 밑줄 id)로 그 노트 그 자리, 노트 글이 바뀌어 고른 글이 없으면 줄에 '원문이 바뀌었어요'.
// 머리 줄 [News에서 보기 ↗]는 뺐다(11/15 17:57 확정 — 줄마다 원문으로 감). '보관한 글' 머리 줄도 같은 규칙으로 뺐다.
// 바깥 글자는 모두 esc로만 그린다. 로그에 밑줄 글·제목을 남기지 않는다.

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const MORE = '<span class="more-dots" aria-hidden="true">⋯</span>';
const HL_ICON = '<span class="ft-ico nnm-hlico" aria-hidden="true"></span>';
const MEMO_ICON = '<span class="ft-ico nnm-memoico" aria-hidden="true">✎</span>';
const nameOf = key => window.KPTUOutside?.sourceName?.(key) || null;

// onChange(): 자료가 새로 왔다(껍데기가 목록을 다시 그린다 — 줄 수·찾은 수가 바뀜).
// openNote(noteId, highlightId): 노트 밑줄을 그 노트 그 자리로 연다. noteText(noteId): 노트 글자(raw_text), 노트가 없으면 null, 아직 모르면 undefined.
// noteHidden(noteId): 그 노트가 잠근 노트 폴더에 있어 가려졌나(SEC-기능PIN잠금 S67-14) — 그 노트 밑줄은 '밑줄' 목록에 두지 않는다.
// memoCount(): 노트 [메모] 보기의 메모 수(모르면 null — 껍데기가 memo-store.js에서 센다).
export function createNoteNewsMarks({head, box, onChange = () => {}, openNote = null, noteText = () => undefined, noteHidden = () => false, memoCount = () => null} = {}) {
  let saved = null, savedFailed = false, hlFailed = false, kind = 'all', seq = 0, off = false;
  // NEWS-운영자만(S63-03): News는 운영자 기능 키 'outside'가 있는 계정만. 키가 없다는 답이면 '보관한 글' 줄을 빼고(읽지도 않음) 밑줄은 노트 밑줄만 보인다
  // (News·텔레그램 밑줄은 누르면 News로 가므로). 모인 밑줄·보관은 지우지 않는다. 답을 모르면(null) 지금처럼 다 보인다(메뉴 myFeaturesOrNull 규칙과 같음).
  let newsOn = true;
  // S68-09: 읽을 거리 밑줄은 모든 사람 것(누르면 읽을 거리 화면으로) — News 기능 키와 상관없이 노트 밑줄과 함께 보인다.
  // S69-04: 저장한 글 [밑줄] 탭과 같은 한 규칙(visibleMarks) — 같은 목록·같은 개수.
  const hlNow = () => visibleMarks(highlightsNow(), {newsOn, noteHidden});
  async function load() {
    const my = ++seq;
    off = false;
    const features = await myFeaturesOrNull().catch(() => null);
    if (my !== seq) return;
    newsOn = marksNewsOn(features);
    if (!newsOn) { saved = []; savedFailed = false; }
    const [hl, sv] = await Promise.allSettled([loadHighlights({force: true}), newsOn ? readSavedRows() : Promise.resolve([])]);
    if (my !== seq) return;
    hlFailed = hl.status === 'rejected' && !highlightsNow();
    if (sv.status === 'fulfilled' && sv.value) { saved = sv.value; savedFailed = false; }
    else if (sv.status === 'rejected' || sv.value === null) savedFailed = !saved;
    onChange();
  }
  async function reloadSaved() {
    const my = ++seq;
    if (!newsOn) { if (my === seq) onChange(); return; }
    try { const got = await readSavedRows(); if (my === seq && got) { saved = got; savedFailed = false; } } catch { /* 그대로 */ }
    if (my === seq) onChange();
  }
  onHighlights(() => { if (!off) onChange(); });
  const hlCount = () => hlNow()?.length ?? null;
  const svCount = () => saved?.length ?? null;

  // 글자 없는 얇은 구분 줄 + 두 줄(노트 폴더 줄과 같은 공용 줄 — 끌어 놓을 곳이 아니다). at: 지금 고른 곳(PC 나무에서 표시).
  // NOTE-News에서글자빼기(11/15 명진): 구분 줄의 'News에서' 글자는 뺐다(밑줄이 노트·텔레그램에서도 옴). 줄마다 붙는 출처 꼬리표(노트·News·텔레그램)는 그대로.
  // sep: 구분 줄을 넣을지(폰에서 두 줄이 따로 선 상자에 들 때는 상자 테두리가 이미 나누므로 껍데기가 false).
  function navHtml({tree = false, at = null, sep = true} = {}) {
    const row = (id, icon, count) => ftFolderRowHtml({name: NEWS_NAMES[id], count: count ?? '', countLabel: count === null ? '' : `${NEWS_NAMES[id]} ${count}개`, depth: 0, hasContent: false,
      current: tree && at === id, tree, className: 'nx-news-item', icon, rowAttrs: {'data-nx-news-item': id}, mainAttrs: {'data-nx-open': id}});
    return (sep ? '<div class="nnm-sep" role="presentation" aria-hidden="true"></div>' : '')
      + row(NEWS_HL, HL_ICON, hlCount())
      // S69-94 NOTE-메모통일: 밑줄 바로 아래 '메모' 한 줄 — 누르면 노트 [메모] 보기(모든 메모 모아 보기, 껍데기가 보기를 바꾼다).
      + ftFolderRowHtml({name: '메모', count: memoCount() ?? '', countLabel: memoCount() === null ? '' : `메모 ${memoCount()}개`, depth: 0, hasContent: false,
        current: false, tree, className: 'nx-news-item nx-memo-item', icon: MEMO_ICON, rowAttrs: {'data-nx-memo-item': ''}, mainAttrs: {'data-nx-memos': ''}})
      + (newsOn ? row(NEWS_SAVED, treeIconHtml('starred', {className: 'ft-ico'}), svCount()) : '');
  }

  const gone = h => { if (h?.source_type !== 'note') return false; const t = noteText(h.source_id); return t !== undefined && quoteGone(t, h.quote); };
  const hlRows = (list, tag = '') => list.map(h => highlightRowHtml(h, {tag, src: sourceTag(h), gone: gone(h)})).join('');
  function savedRowHtml(r, tag = '') {
    const l = savedLine(r, nameOf);
    // 보관 = 별표(S67-09). S67-11: ★은 단추 — 누르면 보관에서 빼기(News 줄 ★과 같은 dropSaved, 5초 [되돌리기]). 찾기 결과 꼬리표 줄은 그대로 글자.
    const mark = tag ? `<span class="nnm-tag">${esc(tag)}</span>` : '';
    const star = tag ? '' : '<button type="button" class="icon-btn nnm-star" data-now-act="unstar" aria-label="저장한 글에서 삭제" title="저장한 글에서 삭제"><span aria-hidden="true">★</span></button>';
    const del = r.type === 'news' && canDeleteNews(r.row);
    return `<div class="nnm-sv now-row" data-nw-key="${esc(l.key)}">${star}<button type="button" class="ghost nnm-open" data-nnm-saved="${esc(l.key)}">${mark}<span class="nnm-t">${esc(l.title)}</span><span class="nnm-m">${esc([l.media, l.day].filter(Boolean).join(' · '))}</span></button>${hoverActsHtml({saved: true, canDelete: del})}<button type="button" class="icon-btn basket-row-more" data-now-more aria-haspopup="true" aria-expanded="false" aria-label="저장한 글 메뉴">${MORE}</button></div>`;
  }
  function listHtml(at) {
    if (at === NEWS_HL) {
      const all = hlNow();
      if (!all) return hlFailed ? failHtml({retry: 'data-nnm-retry'}) : waitHtml({rows: 4, h: 56});
      return all.length ? `<div class="nh-list nw-card nnm-card">${hlRows(all)}</div>` : emptyHtml('저장한 밑줄 없음 · 원문에서 글을 선택해 [밑줄 저장]', {attrs: 'data-nnm-empty'});
    }
    const chips = `<div class="filter-chips nnm-chips" role="group" aria-label="저장한 글 거르기">${SAVED_KINDS.map(k => `<button type="button" class="ds-chip" data-nnm-kind="${k.id}" aria-pressed="${kind === k.id}">${esc(k.label)}</button>`).join('')}</div>`;
    if (!newsOn) return emptyHtml('저장한 글 없음', {attrs: 'data-nnm-empty'});
    if (!saved) return chips + (savedFailed ? failHtml({retry: 'data-nnm-retry'}) : waitHtml({rows: 4, h: 40}));
    const list = filterSavedKind(saved, kind);
    return chips + (list.length ? `<div class="nw-card nnm-card">${list.map(r => savedRowHtml(r)).join('')}</div>` : emptyHtml('저장한 글 없음', {attrs: 'data-nnm-empty'}));
  }

  // 그리기(껍데기 renderList가 부른다). at: 지금 자리, query: 노트 검색 글자, phone: 폰 '그 폴더만' 상자, notes: 찾은 노트 수.
  function paint({at = null, query = '', phone = false, notes = 0, folderView = true} = {}) {
    if (!head || !box) return;
    if (!folderView) { clear(); return; }
    if (query) {
      const hit = newsSearch({highlights: hlNow() || [], saved: saved || [], query, nameOf});
      head.hidden = false;
      head.innerHTML = `<span class="nnm-q">'${esc(query)}' 찾은 것</span><span class="nnm-n">${esc(searchHead(notes, hit.highlights.length, hit.saved.length))}</span>`;
      const rows = hlRows(hit.highlights, '밑줄') + hit.saved.map(r => savedRowHtml(r, '저장한 글')).join('');
      box.hidden = !rows;
      box.innerHTML = rows ? `<div class="nw-card nnm-card nnm-found">${rows}</div>` : '';
      return;
    }
    head.hidden = true; head.replaceChildren();
    if (!isNewsAt(at)) { box.hidden = true; box.replaceChildren(); return; }
    box.hidden = false;
    const count = at === NEWS_HL ? hlCount() : svCount(), name = NEWS_NAMES[at];
    if (phone) {
      // 머리 아이콘은 폴더가 아니라 그 줄 아이콘(밑줄 = 노란 띠, 보관한 글 = 별) — 노트 왼쪽 목록 줄과 같은 아이콘(시안 note-news-marks.html).
      const ico = at === NEWS_HL ? HL_ICON : treeIconHtml('starred', {className: 'ft-ico'});
      box.innerHTML = ftFocusHtml({back: {'data-nx-back': ''}, trail: [{label: '노트', attrs: {'data-nx-at': ''}}], name, icon: ico, count: count === null ? '' : String(count), body: listHtml(at), attrs: {'data-nnm-focus': at}});
      return;
    }
    box.innerHTML = `<div class="nnm-head">${at === NEWS_HL ? HL_ICON : treeIconHtml('starred', {className: 'ft-ico'})}<b>${esc(name)}</b>${count === null ? '' : `<span class="nnm-n">${count}</span>`}</div>${listHtml(at)}`;
  }
  function clear() { if (head) { head.hidden = true; head.replaceChildren(); } if (box) { box.hidden = true; box.replaceChildren(); } }
  // 노트 검색에 걸린 밑줄·보관 수(껍데기의 '맞는 노트 없음'을 가린다).
  const hits = query => { if (!query) return 0; const h = newsSearch({highlights: hlNow() || [], saved: saved || [], query, nameOf}); return h.highlights.length + h.saved.length; };

  // S71-76 NAV-뒤로가기직전화면: 다른 화면(읽을 거리·저장한 글·브리핑 룸)으로 가는 길은 openOnScreen 한 길 — 뒤로가기 한 번 = 노트 그 목록 그 자리.
  const goNews = () => openOnScreen('outside');
  const openHighlight = h => {
    if (!h) return;
    if (h.source_type === 'note') { openNote?.(h.source_id, h.id); return; }
    if (h.source_type === 'reading') { window.KPTUReadingOpen = {id: h.source_id, highlight: h.id}; void openOnScreen('reading'); return; }
    // S69-86: 브리핑 밑줄은 브리핑 룸 그 자료·그 밑줄로(브리핑이 사라졌으면 브리핑 룸이 알림 한 줄 — 밑줄은 그대로).
    if (h.source_type === 'brief') { window.KPTUBriefOpen = {id: h.source_id, highlight: h.id}; void openOnScreen('brief'); return; }
    if (requestNewsOpen({type: h.source_type, id: h.source_id, highlight: h.id})) void goNews();
  };
  box?.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || !box.contains(b)) return;
    if (b.matches('[data-nnm-retry]')) { hlFailed = false; savedFailed = false; onChange(); void load(); return; }
    if (b.matches('[data-nh-more]') && b.dataset.hlId) { openMarkMenu(b, {onSource: openHighlight}); return; }
    if (b.matches('[data-nh-open]')) { openHighlight((hlNow() || []).find(x => x.id === b.dataset.nhOpen)); return; }
    if (b.matches('[data-nnm-kind]')) { kind = keepSavedKind(b.dataset.nnmKind); onChange(); box.querySelector(`[data-nnm-kind="${kind}"]`)?.focus({preventScroll: true}); return; }
    if (b.matches('[data-nnm-saved]')) { const [type, id] = String(b.dataset.nnmSaved).split(':'); if (requestNewsOpen({type, id})) void goNews(); return; }
  });
  bindNowRows(box, {row: '[data-nw-key]', saved: true, titleOf: el => el.querySelector('.nnm-t')?.textContent || '',
    itemOf: el => { const [type, id] = String(el.dataset.nwKey || '').split(':'); return (type === 'outside' || type === 'news') && id ? {type, id} : null; },
    canDelete: item => item.type === 'news' && canDeleteNews((saved || []).find(r => r.type === 'news' && r.id === item.id)?.row),
    changed: (item, k, on) => { if ((k === 'release' || (k === 'delete' && on)) && saved) saved = saved.filter(r => !(r.type === item.type && r.id === item.id)); onChange(); void reloadSaved(); }});
  return {load, paint, navHtml, hits, clear, reset: () => { seq++; off = true; newsOn = true; saved = null; savedFailed = false; hlFailed = false; kind = 'all'; clear(); }};
}
export {NEWS_HL, NEWS_SAVED, isNewsAt};
