// S68-09 READ-읽을거리함 화면(?view=reading, 메뉴 '읽을 거리'). #readingView의 유일한 그리기 주인. 명진 11/22 13:28 "Raindrop 가져올 것 ㄱ", 13:42 "B: 메뉴에 새 칸".
// - 목록(시안 ②): 줄마다 안 읽음 점 · 제목 · 사이트 · 날짜 한 줄, 사업영역 꼬리표. 위 칩 [안 읽음 n][전체][밑줄](폰은 좌우로 밀어 옆 칩). [+ 추가]는 주소 한 칸.
// - 보기(시안 ③): 받아 둔 원문 사본 + 고른 글 [밑줄 저장]·메모(공용 text-select-bar.js·text-highlights.js, 밑줄 표 app_news_highlights 종류 'reading')
//   + [밑줄을 노트로](밑줄 문장 + 출처 → 기존 노트 만들기 길) · [사업에 연결](공용 사업영역 고르기 창) · [읽음]. 폰은 목록 대신(뒤로 = 목록), 761px~는 오른쪽 칸.
// - 원래 페이지 링크는 늘 보인다. 저장·원문 받기 실패는 한 줄 상태로. 원문은 글자로만 그린다(textContent — HTML·스크립트 실행 없음).
// - 서버 저장만(reading-data.js, owner RLS). 기기 저장 없음.
// - S68-24 READ-보관하나로(명진 11/22 "2. A"): News 기능 키('outside', 서버 허용 표)가 있는 사람만 News에서 보관한 글(now-saved.js readSavedRows — News와 같은 읽기·RLS)도
//   이 목록에 시각순으로 함께, 줄에 작은 'News' 꼬리표 + 칩 [News]. 같은 주소는 한 줄(읽을 거리 우선, 꼬리표 둘). 줄을 누르면 News 지금 글 보기(원문·밑줄)를
//   라우터 openFrom으로 열어 뒤로 한 번 = 읽을 거리. ⋯ [보관 풀기]는 News와 같은 dropSaved. 두 자료는 각자 표 그대로(복사·이전 없음).
//   키가 없거나 답을 모르면 News 쪽은 부르지도 그리지도 않는다(서버가 거절하는 길을 부르지 않음, News 모듈도 불러오지 않음).
import {keepFilter, filterEntries, filterOptions, nextFilter, mergeEntries, markKeysOf, emptyText, lineOf, stateLine, canRetry, requestLine, paragraphs, sourceOf, readingUrl, isId} from './reading-model.mjs';
import {CHANGED, listItems, getItem, addItem, removeItem, setRead, setArea, fetchBody, fetching} from './reading-data.js';
import {loadHighlights, highlightsNow, sourceHighlights, onHighlights, paintMarks, bindMarks, saveFromSelection, noteFromSelection, noteWithNotice, revealMark} from './text-highlights.js';
import {bindSelectZone} from './text-select-bar.js';
import {renderFilterChips} from './filter-chips.js';
import {createAnchoredMenu} from './anchored-menu.js';
import {openAreaOrgPicker, usedKeysNow, catalogAreas, areaTree, areaChipText} from './area-org-picker.js';
import {waitHtml, failHtml, emptyEl} from './wait-state.js';
import {notify, askConfirm} from './small-notice.js';
import {word} from './brand/brand.mjs';
import {myFeaturesOrNull} from './my-features.js';

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const btn = (cls, text, data) => { const b = el('button', cls, text); b.type = 'button'; for (const [k, v] of Object.entries(data || {})) b.dataset[k] = v; return b; };
const view = () => document.getElementById('readingView');
const wide = () => window.matchMedia?.('(min-width: 761px)').matches;
const here = () => window.KPTURouter?.current === 'reading' && !document.hidden;

function install() {
  if (document.getElementById('readingView')) return;
  document.getElementById('appView')?.insertAdjacentHTML('beforeend', '<section id="readingView" class="view-panel hidden" aria-label="읽을 거리"><div class="rd-wrap"><div class="rd-list" data-rd-list></div><div class="rd-detail" data-rd-detail hidden></div></div></section>');
}

const state = {rows: [], loaded: false, failed: false, filter: 'unread', open: null, body: null, bodyFor: null, adding: false, addError: '', lines: new Map(), scope: '',
  newsOn: false, saved: []};
const scopeNow = () => { const c = window.KPTURuntime?.context?.read?.(); return `${c?.user?.id || ''}:${c?.workspace?.id || ''}`; };
const rowOf = id => state.rows.find(r => r.id === id) || null;
const markKeys = () => markKeysOf(highlightsNow() || []);
const nameOf = key => window.KPTUOutside?.sourceName?.(key) || null;
const entriesNow = () => mergeEntries(state.rows, state.newsOn ? state.saved : [], nameOf);
const savedOf = key => (state.newsOn ? state.saved.find(r => `${r.type}:${r.id}` === key) : null) || null;
let layer = null;

// News 기능 키가 있다는 답일 때만 true(모르면 false — 그 사람에게 서버가 거절할 수 있는 길을 부르지 않는다).
async function newsAllowed() {
  const features = await myFeaturesOrNull().catch(() => null);
  return Array.isArray(features) && features.includes('outside');
}
// 보관한 글 읽기(News와 같은 길). 못 읽으면 지난 목록 그대로(읽을 거리 목록은 막지 않음).
async function loadSaved() {
  if (!state.newsOn) { state.saved = []; return; }
  try {
    const {readSavedRows} = await import('./now-saved.js');
    const got = await readSavedRows();
    if (Array.isArray(got)) state.saved = got;
  } catch { /* 지난 목록 그대로 */ }
}
async function load() {
  if (state.scope !== scopeNow()) { state.scope = scopeNow(); state.rows = []; state.loaded = false; state.open = null; state.body = null; state.bodyFor = null; state.lines.clear(); state.newsOn = false; state.saved = []; }
  const scope = state.scope;
  const news = newsAllowed().then(on => { if (scope !== state.scope) return; state.newsOn = on; if (!on && state.filter === 'news') state.filter = 'unread'; return loadSaved(); }).catch(() => {});
  try { state.rows = await listItems(); state.failed = false; state.loaded = true; }
  catch { state.failed = true; }
  await news;
  void loadHighlights().then(() => draw()).catch(() => {});
}

// ---------- 사업영역 꼬리표 ----------
let areaNames = null;
async function loadAreas() {
  try {
    if (!window.KPTUProjectCatalog) await import('./project-catalog.js');
    const catalog = window.KPTUProjectCatalog, ctx = window.KPTURuntime?.context?.read?.();
    if (catalog?.load && ctx?.workspace?.id && ctx?.user?.id) await catalog.load({workspaceId: ctx.workspace.id, userId: ctx.user.id});
    return catalog?.snapshot?.().tree || [];
  } catch { return null; }
}
async function refreshAreaNames() {
  const rows = await loadAreas();
  if (!rows) return;
  const tree = areaTree(catalogAreas(rows));
  areaNames = id => areaChipText(tree, 'p:' + id) || '';
  draw();
}
const areaText = id => (id && areaNames ? areaNames(id) : '');

// ---------- 목록 ----------
let chipsHost = null;
const newsTag = () => el('span', 'rd-tag rd-src-tag', 'News');
function readingRowEl(e) {
  const row = e.row, l = lineOf(row);
  const r = el('div', 'rd-row');
  r.dataset.rdOpen = row.id; r.tabIndex = 0; r.setAttribute('role', 'button');
  if (state.open === row.id) r.classList.add('is-open');
  if (l.unread) r.classList.add('is-unread');
  const dot = el('span', 'rd-dot'); dot.setAttribute('aria-hidden', 'true');
  const title = el('span', 'rd-nm', l.title);
  const meta = el('span', 'rd-meta', [l.site, l.day].filter(Boolean).join(' · '));
  const more = btn('rd-more icon-btn', '⋯', {rdMore: row.id}); more.setAttribute('aria-label', '읽을 거리 메뉴: ' + l.title); more.setAttribute('aria-expanded', 'false');
  r.append(dot, title, meta, more);
  const tag = areaText(l.area), both = e.news.length > 0;
  const line = state.lines.get(row.id) || (fetching(row.id) ? stateLine(row, {busy: true}) : '');
  if (tag || line || both) {
    const sub = el('span', 'rd-sub');
    // 같은 주소를 News에서도 보관했으면 꼬리표 둘(읽을 거리 · News) — 줄은 읽을 거리 보기로 연다.
    if (both) sub.append(el('span', 'rd-tag rd-src-tag', '읽을 거리'), newsTag());
    if (tag) sub.append(el('span', 'rd-tag', tag));
    if (line) sub.append(el('span', 'rd-line', line));
    r.append(sub);
  }
  r.setAttribute('aria-label', `${l.unread ? '안 읽음 · ' : ''}${l.title}${l.site ? ' · ' + l.site : ''}${both ? ' · News에도 보관' : ''}`);
  return r;
}
// News에서 보관한 글 줄: 점 자리는 비우고 제목 · 매체 · 날짜, 꼬리표 'News'. 누르면 News 글 보기.
function newsRowEl(e) {
  const r = el('div', 'rd-row rd-row-news');
  r.dataset.rdNews = e.key; r.tabIndex = 0; r.setAttribute('role', 'button');
  const dot = el('span', 'rd-dot'); dot.setAttribute('aria-hidden', 'true');
  const more = btn('rd-more icon-btn', '⋯', {rdMore: e.key}); more.setAttribute('aria-label', 'News 보관 글 메뉴: ' + e.title); more.setAttribute('aria-expanded', 'false');
  r.append(dot, el('span', 'rd-nm', e.title), el('span', 'rd-meta', [e.site, e.day].filter(Boolean).join(' · ')), more);
  const sub = el('span', 'rd-sub');
  sub.append(newsTag());
  r.append(sub);
  r.setAttribute('aria-label', `News 보관 · ${e.title}${e.site ? ' · ' + e.site : ''}`);
  return r;
}
function drawList() {
  const box = view()?.querySelector('[data-rd-list]');
  if (!box) return;
  const head = el('div', 'rd-head');
  head.append(el('h2', 'rd-title', '읽을 거리'));
  const add = btn('rd-add mini', '+ 추가', {rdAdd: '1'});
  add.setAttribute('aria-expanded', String(state.adding));
  head.append(add);
  const parts = [head];
  if (state.adding) {
    const form = el('form', 'rd-form');
    form.dataset.rdForm = '1';
    const input = el('input', 'rd-url');
    input.type = 'text'; input.inputMode = 'url'; input.name = 'url'; input.placeholder = 'https://… 읽을 글 주소'; input.setAttribute('aria-label', '읽을 글 주소'); input.autocomplete = 'off'; input.maxLength = 2000;
    // 다시 그려도(목록·칩이 늦게 와도) 쓰던 주소와 글자 칸 초점은 그대로.
    const was = box.querySelector('input.rd-url');
    if (was) { input.value = was.value; if (document.activeElement === was) queueMicrotask(() => { if (input.isConnected) { input.focus({preventScroll: true}); try { input.setSelectionRange(was.selectionStart, was.selectionEnd); } catch { /* 고를 수 없는 칸 */ } } }); }
    const save = btn('mini primary', '저장'); save.type = 'submit';
    form.append(input, save, btn('mini', '닫기', {rdAddClose: '1'}));
    parts.push(form);
    if (state.addError) parts.push(el('p', 'rd-line rd-bad', state.addError));
    queueMicrotask(() => { if (input.isConnected && !input.value) input.focus({preventScroll: true}); });
  }
  if (state.failed && !state.rows.length) {
    box.replaceChildren(...parts);
    box.insertAdjacentHTML('beforeend', failHtml({retry: 'data-rd-retry'}));
    return;
  }
  if (!state.loaded) { box.replaceChildren(...parts); box.insertAdjacentHTML('beforeend', waitHtml({rows: 4})); return; }
  const keys = markKeys(), entries = entriesNow();
  chipsHost ||= el('div', 'rd-chips');
  renderFilterChips(chipsHost, {options: filterOptions(entries, keys, state.newsOn), value: keepFilter(state.filter, state.newsOn), label: '읽을 거리 거르기', small: true,
    onChange: v => { state.filter = keepFilter(v, state.newsOn); drawList(); }});
  parts.push(chipsHost);
  const shown = filterEntries(entries, state.filter, keys, state.newsOn);
  const list = el('div', 'rd-rows');
  list.dataset.rdRows = '1';
  for (const e of shown) list.append(e.src === 'news' ? newsRowEl(e) : readingRowEl(e));
  if (!shown.length) list.append(emptyEl(emptyText(keepFilter(state.filter, state.newsOn), entries.length)));
  parts.push(list);
  box.replaceChildren(...parts);
}

// ---------- 보기 ----------
let detailBox = null;
function closeDetail({fromBack = false} = {}) {
  state.open = null; state.body = null; state.bodyFor = null;
  if (!fromBack && layer) { const l = layer; layer = null; void l.close(); }
  layer = null;
  draw();
}
function openLayer(id) {
  if (wide() || layer) return;
  layer = window.KPTURouter?.layer?.open?.('reading-detail', {reopen: () => openItem(id), close: () => { layer = null; closeDetail({fromBack: true}); return true; }}) || null;
}
async function openItem(id, {highlight = null} = {}) {
  if (!isId(id)) return;
  state.open = id; state.body = null; state.bodyFor = null;
  openLayer(id);
  draw();
  try { const full = await getItem(id); if (state.open !== id) return; state.body = full?.body || ''; state.bodyFor = id; if (full) Object.assign(rowOf(id) || {}, full); }
  catch { if (state.open === id) { state.body = null; state.bodyFor = 'failed:' + id; } }
  draw();
  const cur = rowOf(id);
  if (cur && cur.body_state === 'pending' && !fetching(id)) void startFetch(cur);
  if (highlight) queueMicrotask(() => revealMark(detailBox?.querySelector('[data-rd-prose]'), highlight));
}
function drawDetail() {
  detailBox ||= view()?.querySelector('[data-rd-detail]');
  const box = detailBox, listBox = view()?.querySelector('[data-rd-list]');
  if (!box) return;
  const row = state.open ? rowOf(state.open) : null;
  if (!row) { box.hidden = true; box.replaceChildren(); if (listBox) listBox.hidden = false; view()?.classList.remove('rd-reading'); return; }
  view()?.classList.add('rd-reading');
  if (listBox) listBox.hidden = !wide();
  const l = lineOf(row);
  const bar = el('div', 'rd-head');
  if (!wide()) { const back = btn('rd-back icon-btn', '‹', {rdBack: '1'}); back.setAttribute('aria-label', '목록으로'); bar.append(back); }
  bar.append(el('h2', 'rd-title rd-doc', l.title));
  const src = el('a', 'rd-src mini', '원래 페이지');
  src.href = row.url; src.target = '_blank'; src.rel = 'noopener noreferrer';
  bar.append(src);
  const meta = el('p', 'rd-meta-line', [l.site, l.day ? l.day + ' 저장' : ''].filter(Boolean).join(' · '));
  const tag = areaText(l.area);
  if (tag) meta.append(' · ', el('span', 'rd-tag', tag));
  const acts = el('div', 'rd-acts');
  const marks = sourceHighlights('reading', row.id);
  acts.append(btn('mini', marks.length ? `밑줄을 노트로 ${marks.length}` : '밑줄을 노트로', {rdNote: '1'}),
    btn('mini', tag ? word('사업영역 바꾸기') : '사업에 연결', {rdArea: '1'}),
    btn('mini', row.read_at ? '안 읽음으로' : '읽음', {rdRead: row.read_at ? '0' : '1'}));
  const parts = [bar, meta, acts];
  const busy = fetching(row.id);
  const line = state.lines.get(row.id) || stateLine(row, {busy});
  if (line) {
    const p = el('p', 'rd-line', line);
    p.setAttribute('role', 'status');
    if (!busy && canRetry(row)) p.append(' ', btn('row-act', '다시', {rdFetch: row.id}));
    parts.push(p);
  }
  const prose = el('div', 'rd-prose');
  prose.dataset.rdProse = '1';
  if (state.bodyFor === row.id) {
    for (const para of paragraphs(state.body)) prose.append(el('p', null, para));
    if (!prose.childNodes.length && !line) prose.append(el('p', 'rd-faint', '받아 둔 원문이 없어요. 원래 페이지에서 읽어 주세요.'));
  } else if (state.bodyFor === 'failed:' + row.id) {
    prose.append(el('p', 'rd-faint', '원문을 읽지 못했어요.'), btn('row-act', '다시', {rdReopen: row.id}));
  } else prose.insertAdjacentHTML('beforeend', waitHtml({rows: 3}));
  parts.push(prose);
  if (prose.querySelector('p') && state.bodyFor === row.id) parts.push(el('p', 'rd-faint rd-tip', '글을 선택하고 [밑줄 저장] · 밑줄을 누르면 메모'));
  box.replaceChildren(...parts);
  box.hidden = false;
  if (state.bodyFor === row.id) paintMarks(prose, marks);
}

function draw() { drawList(); drawDetail(); }

// ---------- 동작 ----------
async function startFetch(row) {
  state.lines.delete(row.id);
  draw();
  const out = await fetchBody(row);
  if (out.state === 'request') state.lines.set(row.id, out.reason === 'gone' ? '이미 삭제한 읽을 거리예요.' : requestLine(out.reason));
  if (out.row) Object.assign(rowOf(row.id) || {}, out.row);
  if (state.open === row.id && out.row) {
    try { const full = await getItem(row.id); if (state.open === row.id) { state.body = full?.body || ''; state.bodyFor = row.id; } } catch { /* 다음에 열 때 다시 읽는다 */ }
  }
  draw();
}
async function addUrl(text) {
  const got = readingUrl(text);
  if (!got.ok) { state.addError = got.message; drawList(); return; }
  state.addError = '';
  let out;
  try { out = await addItem(got.url); }
  catch { state.addError = '저장하지 못했어요 · 잠시 뒤 다시'; drawList(); return; }
  state.adding = false;
  if (!out.dup) state.rows = [out.row, ...state.rows.filter(r => r.id !== out.row.id)];
  if (state.filter === 'marks' || state.filter === 'news') state.filter = 'all';
  notify(out.dup ? '이미 읽을 거리에 있어요' : '읽을 거리에 넣었어요', {record: false});
  draw();
  if (!out.dup) void startFetch(out.row);
}
async function toggleRead(id, read) {
  const row = rowOf(id);
  if (!row) return;
  try { Object.assign(row, await setRead(id, read)); }
  catch { notify('저장하지 못했어요 · 잠시 뒤 다시', {error: true, record: false}); }
  draw();
}
async function pickArea(button, id) {
  const row = rowOf(id);
  if (!row) return;
  const rows = await loadAreas();
  if (!rows) { notify(word('사업영역을 읽지 못했어요'), {error: true, record: false}); return; }
  const used = await usedKeysNow().catch(() => []);
  if (!button.isConnected) return;
  await openAreaOrgPicker({kind: 'area', trigger: button, areas: catalogAreas(rows), selected: row.business_area_id ? ['p:' + row.business_area_id] : [], used, multi: false, none: true,
    onCommit: async keys => {
      const k = [...keys][0] || '', areaId = k.startsWith('p:') ? k.slice(2) : null;
      if ((areaId || null) === (row.business_area_id || null)) return;
      try { Object.assign(row, await setArea(id, areaId)); await refreshAreaNames(); }
      catch { notify('연결하지 못했어요 · 잠시 뒤 다시', {error: true, record: false}); }
      draw();
    }});
}
async function marksToNote(id) {
  const marks = sourceHighlights('reading', id);
  if (!marks.length) { notify('밑줄이 없어요 · 글을 선택하고 [밑줄 저장]을 먼저 눌러 주세요', {record: false}); return; }
  await noteWithNotice([...marks].reverse());
}
async function remove(id, anchor) {
  const row = rowOf(id);
  if (!row) return;
  const marks = sourceHighlights('reading', id).length;
  if (!(await askConfirm(anchor, {text: '이 읽을 거리를 삭제할까요?', note: marks ? `밑줄 ${marks}개는 노트 › 밑줄에 남아요` : '', ok: '삭제'}))) return;
  try { await removeItem(id); }
  catch { notify('삭제하지 못했어요 · 잠시 뒤 다시', {error: true, record: false}); return; }
  state.rows = state.rows.filter(r => r.id !== id);
  if (state.open === id) closeDetail();
  notify('삭제했어요', {record: false});
  draw();
}

// News 보관 글 열기: 라우터 openFrom(화면을 다 불러온 뒤 기록 1칸, News 상세가 같은 칸을 씀) → 뒤로가기 한 번 = 읽을 거리. 새 보기 없이 News 지금 글 보기 그대로.
async function openNews(sv) {
  const router = window.KPTURouter;
  if (!sv || !router?.openFrom) return;
  const ok = await router.openFrom('outside', () => window.KPTUOutside?.openItem?.({type: sv.type, id: sv.id}) ?? false).catch(() => false);
  if (ok === false && window.KPTURouter?.current === 'reading') notify('News에서 열지 못했어요 · 잠시 뒤 다시', {error: true, record: false});
}
// 보관 풀기: News 줄 ★·밀기와 같은 dropSaved(5초 [되돌리기], 되돌리면 원래 별표 시각·폴더로).
async function releaseSaved(sv) {
  if (!state.newsOn || !sv) return;
  const item = {type: sv.type, id: sv.id};
  try {
    const {dropSaved} = await import('./now-row-acts.js');
    await dropSaved(item, {saved: true, changed: (it, kind, on) => {
      if (kind === 'release') state.saved = state.saved.filter(r => !(r.type === it.type && r.id === it.id));
      else if (kind === 'save' && on) void loadSaved().then(() => { if (here()) draw(); });
      if (window.KPTURouter?.current === 'reading') drawList();
    }});
  } catch { notify('보관을 풀지 못했어요 · 잠시 뒤 다시', {error: true, record: false}); }
}

const menu = createAnchoredMenu({id: 'rdRowMenu', className: 'feed-menu', label: '읽을 거리 메뉴', historyKey: 'kptuReadingRowMenu',
  key: t => t.dataset.rdMore || '',
  row: t => t.closest('.rd-row'),
  render: id => {
    if (savedOf(id)) return '<button type="button" class="row-act" data-rd-act="news-open">News에서 열기</button><button type="button" class="row-act" data-rd-act="release">보관 풀기</button>';
    const row = rowOf(id);
    if (!row) return '';
    return `<button type="button" class="row-act" data-rd-act="read">${row.read_at ? '안 읽음으로' : '읽음'}</button><button type="button" class="row-act" data-rd-act="area">사업에 연결</button>${canRetry(row) ? '<button type="button" class="row-act" data-rd-act="fetch">원문 다시 가져오기</button>' : ''}<button type="button" class="row-act feed-menu-danger" data-rd-act="delete">삭제</button>`;
  },
  onAction: (button, active) => {
    const id = active.id, act = button.dataset.rdAct, at = view()?.querySelector(`[data-rd-more="${CSS.escape(id)}"]`) || null;
    if (act === 'news-open' || act === 'release') { const sv = savedOf(id); if (sv) void (act === 'release' ? releaseSaved(sv) : openNews(sv)); return; }
    const row = rowOf(id);
    if (!row) return;
    if (act === 'read') void toggleRead(id, !row.read_at);
    else if (act === 'area' && at) void pickArea(at, id);
    else if (act === 'fetch') void startFetch(row);
    else if (act === 'delete') void remove(id, at);
  }});

// 좌우 밀기: 목록 칸에서 옆으로 밀면 옆 칩으로(세로 스크롤과 구분: 가로 이동이 세로의 2배 이상·60px 이상).
function bindSwipe(box) {
  let x0 = null, y0 = 0;
  box.addEventListener('touchstart', e => { if (e.touches.length !== 1 || e.target.closest?.('input,textarea,.rd-chips')) { x0 = null; return; } x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, {passive: true});
  box.addEventListener('touchend', e => {
    if (x0 === null) return;
    const t = e.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0;
    x0 = null;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 2) return;
    const next = nextFilter(state.filter, dx < 0 ? 1 : -1, state.newsOn);
    if (next !== state.filter) { state.filter = next; drawList(); }
  }, {passive: true});
}

function bind() {
  const v = view();
  if (!v || v.dataset.rdBound) return;
  v.dataset.rdBound = '1';
  v.addEventListener('click', e => {
    const t = e.target;
    const more = t.closest?.('[data-rd-more]');
    if (more) { menu.open(more); return; }
    if (t.closest?.('[data-rd-add]')) { state.adding = !state.adding; state.addError = ''; drawList(); return; }
    if (t.closest?.('[data-rd-add-close]')) { state.adding = false; state.addError = ''; drawList(); return; }
    if (t.closest?.('[data-rd-retry]')) { void refresh(); return; }
    if (t.closest?.('[data-rd-back]')) { closeDetail(); return; }
    const f = t.closest?.('[data-rd-fetch]');
    if (f) { const row = rowOf(f.dataset.rdFetch); if (row) void startFetch(row); return; }
    const re = t.closest?.('[data-rd-reopen]');
    if (re) { void openItem(re.dataset.rdReopen); return; }
    if (t.closest?.('[data-rd-note]') && state.open) { void marksToNote(state.open); return; }
    const area = t.closest?.('[data-rd-area]');
    if (area && state.open) { void pickArea(area, state.open); return; }
    const read = t.closest?.('[data-rd-read]');
    if (read && state.open) { void toggleRead(state.open, read.dataset.rdRead === '1'); return; }
    const open = t.closest?.('[data-rd-open]');
    if (open && !t.closest('a,button,input')) { void openItem(open.dataset.rdOpen); return; }
    const news = t.closest?.('[data-rd-news]');
    if (news && !t.closest('a,button,input')) { const sv = savedOf(news.dataset.rdNews); if (sv) void openNews(sv); }
  });
  v.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.(':is([data-rd-open],[data-rd-news])[role=button]')) { e.preventDefault(); e.target.click(); } });
  v.addEventListener('submit', e => {
    const form = e.target.closest?.('[data-rd-form]');
    if (!form) return;
    e.preventDefault();
    void addUrl(form.querySelector('input')?.value || '');
  });
  const listBox = v.querySelector('[data-rd-list]');
  if (listBox) bindSwipe(listBox);
  detailBox = v.querySelector('[data-rd-detail]');
  bindMarks(detailBox);
  bindSelectZone(detailBox, {zone: '[data-rd-prose]', source: () => sourceOf(rowOf(state.open)), onSave: saveFromSelection, onNote: noteFromSelection});
  onHighlights(() => { if (window.KPTURouter?.current === 'reading') draw(); });
  // 원문 받는 중·끝(폰 공유로 넣은 줄 포함)은 이 화면에 있을 때 다시 그린다. 다른 화면에서 넣은 줄은 이 화면에 들어올 때 다시 읽는다(refresh).
  window.addEventListener(CHANGED, e => {
    const k = e.detail?.kind;
    if ((k === 'fetching' || k === 'fetched') && window.KPTURouter?.current === 'reading') draw();
  });
  window.addEventListener('resize', () => { if (window.KPTURouter?.current === 'reading') drawDetail(); });
}

async function refresh() {
  if (!state.loaded) drawList();
  await load();
  draw();
  if (!areaNames) void refreshAreaNames();
}
// 다른 화면(전체 검색·노트 › 밑줄·폰 공유 알림 [열기])에서 이 화면의 한 줄을 열어 달라는 요청(한 번만).
// S68-24: News 탭 줄 '보관 ↗'은 {filter:'news'} — [News] 칩으로 연다(키가 없으면 그대로 안 읽음).
function takeAsked() {
  const ask = window.KPTUReadingOpen;
  window.KPTUReadingOpen = null;
  if (ask?.filter === 'news' && state.newsOn) { closeDetail(); state.filter = 'news'; drawList(); return; }
  if (ask && isId(ask.id)) void openItem(ask.id, {highlight: ask.highlight || null});
}

install(); bind();
window.KPTURouter?.on?.('reading', () => { void refresh().then(takeAsked); });
void refresh().then(takeAsked);
window.KPTUReading = {refresh, open: (id, opts) => { window.KPTUReadingOpen = {id, ...(opts || {})}; if (window.KPTURouter?.current === 'reading') takeAsked(); else window.KPTURouter?.go?.('reading'); }};
