import {waitHtml, failHtml, emptyHtml} from './wait-state.js';
import {fitChipRows} from './chip-rows.js';
import {createAnchoredMenu} from './anchored-menu.js';
import {ALL, GROUPS, PAGE_SIZE, normalizeCatalog, enabledKeys, chipsOf, keysOf, keepChip, groupPosts, postView, bodyText, isFresh, sourceState} from './outside-statements-model.mjs';
// OUTSIDE-바깥성명 ④ 화면 1(설계 docs/design/outside-statements.md 4절, 12:43 시안): '바깥 성명' 화면(?view=outside). #outsideView의 유일한 그리기 주인.
// - [새로 온 것]: 칩 줄(전체·묶음·단체, 공용 chip-rows.js 두 줄 + [더보기 ▾]) → 날짜 묶음 → 글마다 '단체 · 종류 · 시각' / 제목 / 한 문장 요약(늘 보임)
//   / 본문 접기(<details>, 국내는 펼칠 때 서버 문장 표에서 읽음, 외국은 한국어 요약 + 핵심 문장) / 작은 [원문](그 단체 페이지, 새 창).
//   2년 지난 글은 제목·요약만(설계 2절, Q7).
// - ⋯ → [단체 켜고 끄기]: 카탈로그(서버 outside-feed ?action=catalog) 단체마다 켬/끔 + 마지막으로 읽은 시각·실패 표시.
//   켬/끔은 서버 표 app_outside_sources에만 저장(기기 저장 없음). 폰·PC 모두 같은 화면 안 한 칸이고 뒤로가기 한 번 = 목록(KPTURouter.layer).
// - 들어오면 지난번 본 시각(app_outside_seen)을 읽어 그 뒤 받은 글에 작은 '새' 표시를 하고, 지금 시각으로 바꿔 둔다(서버 저장).
// - [문장 찾기]는 다음 PR(⑤) 몫이라 여기에는 없다. 글은 서버 수집기만 넣는다(화면은 읽기·켜고 끄기·본 시각만 쓴다).
// 바깥에서 온 글은 모두 글자로만 그린다(esc). 로그에 글 제목·본문을 남기지 않는다.

(() => {
if (window.KPTUOutside) return;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const MORE = '<span class="more-dots" aria-hidden="true">⋯</span>';
const POST_COLS = 'id,source_key,kind,lang,title,title_ko,url,published_at,fetched_at,summary_ko,key_sentences,has_body';
const SOURCE_COLS = 'source_key,enabled,last_ok_at,last_error';

function install() {
  if (document.getElementById('outsideView')) return;
  document.getElementById('appView')?.insertAdjacentHTML('beforeend', `<section id="outsideView" class="view-panel hidden" aria-labelledby="osTitle">
<h2 id="osTitle" class="screen-title">바깥 성명</h2>
<div id="outsideRoot" class="os" data-mode="list">
<div class="os-bar"><div class="os-chips" data-os-chips role="group" aria-label="단체 거르기"></div><button type="button" class="os-more" data-os-more data-ctx="off" aria-haspopup="true" aria-expanded="false" aria-label="바깥 성명 메뉴">${MORE}</button></div>
<div class="os-list" data-os-list aria-label="새로 온 글"></div>
<div class="os-sources" data-os-sources aria-label="단체 켜고 끄기"></div>
</div></section>`);
}
install();

const root = document.getElementById('outsideRoot');
const $ = sel => root?.querySelector(sel);
const rt = () => window.KPTURuntime;
const workspaceOf = () => rt()?.context?.read?.()?.workspace?.id || '';
const scopeOf = () => { const c = rt()?.context?.read?.(); return `${c?.user?.id || ''}:${c?.workspace?.id || ''}`; };
const fresh = () => ({scope: '', catalog: null, catalogFailed: false, sources: new Map(), sourcesLoaded: false, sourcesFailed: false,
  posts: [], postsLoaded: false, postsFailed: false, end: true, more: false, seenAt: null, seenRead: false, chip: ALL,
  open: new Set(), bodies: new Map(), saving: new Set(), saveFailed: '', mode: 'list'});
let state = fresh(), loadSeq = 0, layer = null;

// ---------- 서버 읽기·쓰기(모두 작업공간 소유자 RLS · Edge는 사용자 로그인 확인) ----------
const q = v => encodeURIComponent(v);
async function readCatalog() {
  const data = await rt().api('/functions/v1/outside-feed?action=catalog', {method: 'POST', body: {}, singleFlight: false, timeoutMs: 20000});
  return normalizeCatalog(data);
}
const readSources = w => rt().api(`/rest/v1/app_outside_sources?workspace_id=eq.${q(w)}&select=${SOURCE_COLS}`, {singleFlight: false});
const readSeen = w => rt().api(`/rest/v1/app_outside_seen?workspace_id=eq.${q(w)}&select=seen_at&limit=1`, {singleFlight: false});
function readPosts(w, keys, offset) {
  if (keys && !keys.length) return Promise.resolve([]);
  const filter = keys ? `&source_key=in.(${keys.map(q).join(',')})` : '';
  return rt().api(`/rest/v1/app_outside_posts?workspace_id=eq.${q(w)}${filter}&select=${POST_COLS}&order=published_at.desc.nullslast,fetched_at.desc,id.desc&limit=${PAGE_SIZE + 1}&offset=${offset}`, {singleFlight: false});
}
const readBody = (w, id) => rt().api(`/rest/v1/app_outside_sentences?post_id=eq.${q(id)}&workspace_id=eq.${q(w)}&select=idx,text&order=idx.asc&limit=3001`, {singleFlight: false});
// 본 시각: 줄이 있으면 고치고, 없으면 넣는다(화면 권한은 넣기 workspace_id·seen_at, 고치기 seen_at·updated_at뿐).
async function writeSeen(w, at) {
  const rows = await rt().api(`/rest/v1/app_outside_seen?workspace_id=eq.${q(w)}&select=seen_at`, {method: 'PATCH', body: {seen_at: at, updated_at: at}, prefer: 'return=representation', singleFlight: false});
  if (Array.isArray(rows) && rows.length) return;
  await rt().api('/rest/v1/app_outside_seen', {method: 'POST', body: {workspace_id: w, seen_at: at}, prefer: 'return=minimal', singleFlight: false});
}
// 켜고 끄기: 줄이 있으면 enabled만 고치고, 없으면 새 줄(켬)을 넣는다.
async function writeSource(w, key, enabled) {
  const at = new Date().toISOString();
  const rows = state.sources.has(key)
    ? await rt().api(`/rest/v1/app_outside_sources?workspace_id=eq.${q(w)}&source_key=eq.${q(key)}&select=${SOURCE_COLS}`, {method: 'PATCH', body: {enabled, updated_at: at}, prefer: 'return=representation', singleFlight: false})
    : await rt().api(`/rest/v1/app_outside_sources?select=${SOURCE_COLS}`, {method: 'POST', body: {workspace_id: w, source_key: key, enabled}, prefer: 'return=representation', singleFlight: false});
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row || row.source_key !== key) throw new Error('save');
  return row;
}

// ---------- 그리기(이 화면의 유일한 renderer) ----------
const catalogOf = key => state.catalog?.find(s => s.key === key) || null;
const nameOf = key => catalogOf(key)?.name || key;
const enabledNow = () => enabledKeys([...state.sources.values()]);

function chipsHtml(chips) {
  return chips.map(c => `<button type="button" class="os-chip" data-os-chip="${esc(c.id)}" aria-pressed="${c.id === state.chip}">${esc(c.label)}</button>`).join('');
}

function bodyHtml(p, v) {
  if (v.body === 'foreign') {
    return `${v.origTitle ? `<p class="os-orig" lang="en">${esc(v.origTitle)}</p>` : ''}${v.summary ? `<p class="os-sum-full">${esc(v.summary)}</p>` : ''}${v.keys.length ? `<ul class="os-keys" aria-label="핵심 문장">${v.keys.map(k => `<li><span class="os-key-ko">${esc(k.ko)}</span><span class="os-key-orig" lang="en">${esc(k.orig)}</span></li>`).join('')}</ul>` : ''}`;
  }
  const b = state.bodies.get(p.id);
  if (!b || b.loading) return waitHtml({rows: 3});
  if (b.failed) return failHtml({retry: 'data-os-body-retry'});
  return b.text ? `<p class="os-text">${esc(b.text)}</p>` : emptyHtml('본문 없음');
}

function postHtml(p, now) {
  const v = postView(p, now);
  const isNew = state.seenRead && isFresh(p, state.seenAt);
  const meta = `<p class="os-meta">${isNew ? '<span class="os-new" aria-label="새 글">새</span>' : ''}<span class="os-src">${esc(nameOf(p.source_key))}</span><span>${esc(v.kind)}</span><span class="os-time">${esc(v.time)}</span></p>`;
  const lead = v.lead ? `<p class="os-lead">${esc(v.lead)}</p>` : '';
  const link = v.url ? `<a class="os-link" href="${esc(v.url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(v.title)} 원문 (새 창)">원문</a>` : '';
  const open = v.body && state.open.has(p.id);
  const body = v.body ? `<details class="os-fold" data-os-fold="${esc(p.id)}"${open ? ' open' : ''}><summary>${v.body === 'foreign' ? '요약·핵심 문장' : '본문'}</summary><div class="os-body" data-os-body="${esc(p.id)}">${open ? bodyHtml(p, v) : ''}</div></details>` : '';
  return `<article class="os-post${p.lang === 'en' ? ' is-foreign' : ''}" data-os-post="${esc(p.id)}">${meta}<h4 class="os-title"${p.lang === 'en' && !p.title_ko ? ' lang="en"' : ''}>${esc(v.title)}</h4>${lead}<div class="os-foot">${body}${link}</div></article>`;
}

function listHtml() {
  if (!state.postsLoaded) return state.postsFailed ? failHtml({retry: 'data-os-retry'}) : waitHtml({rows: 6, h: 64});
  if (!state.posts.length) {
    if (!state.sourcesLoaded) return emptyHtml();
    if (!enabledNow().length) return `${emptyHtml('켠 단체 없음', {attrs: 'data-os-empty="none"'})}<button type="button" class="os-text-btn" data-os-open-sources>단체 켜고 끄기</button>`;
    return emptyHtml('새 글 없음', {attrs: 'data-os-empty="posts"'});
  }
  const now = Date.now();
  const days = groupPosts(state.posts, now).map(g => `<section class="os-day" aria-label="${esc(g.label)}"><h3 class="os-day-head">${esc(g.label)}</h3>${g.items.map(p => postHtml(p, now)).join('')}</section>`).join('');
  const more = state.end ? '' : `<button type="button" class="os-text-btn os-more-posts" data-os-more-posts${state.more ? ' disabled aria-busy="true"' : ''}>더 보기</button>`;
  return days + more;
}

function sourcesHtml() {
  const head = `<div class="os-src-head"><button type="button" class="os-back" data-os-back aria-label="목록으로"><span aria-hidden="true">‹</span></button><b>단체 켜고 끄기</b><span class="os-faint" data-os-on-count>${state.catalog ? `켬 ${enabledNow().length}` : ''}</span></div>`;
  if (!state.catalog) return head + (state.catalogFailed || state.sourcesFailed ? failHtml({retry: 'data-os-retry'}) : waitHtml({rows: 6}));
  if (!state.sourcesLoaded) return head + (state.sourcesFailed ? failHtml({retry: 'data-os-retry'}) : waitHtml({rows: 6}));
  const groups = GROUPS.map(g => {
    const members = state.catalog.filter(s => s.group === g.key);
    if (!members.length) return '';
    return `<section class="os-src-group" aria-label="${esc(g.label)}"><h3 class="os-src-group-head">${esc(g.label)}</h3>${members.map(s => {
      const row = state.sources.get(s.key), on = row?.enabled === true, busy = state.saving.has(s.key), note = sourceState(row);
      const bad = row?.last_error ? ' is-bad' : '';
      return `<div class="os-src-row"><button type="button" class="os-switch" role="switch" data-os-source="${esc(s.key)}" aria-checked="${on}"${busy ? ' disabled' : ''}><span class="os-switch-dot" aria-hidden="true"></span><span class="os-src-name">${esc(s.name)}</span></button>${note ? `<span class="os-src-note${bad}">${esc(note)}</span>` : ''}</div>`;
    }).join('')}</section>`;
  }).join('');
  return head + (state.saveFailed ? failHtml({text: '저장하지 못했습니다', reason: state.saveFailed}) : '') + groups;
}

function paint() {
  if (!root) return;
  root.dataset.mode = state.mode;
  const chips = chipsOf(state.catalog || [], enabledNow());
  state.chip = keepChip(state.chip, chips);
  const bar = $('[data-os-chips]');
  if (bar) {
    // 칩 줄은 [전체] 하나뿐이면 감춘다(켠 단체가 없을 때).
    const html = chips.length > 1 ? chipsHtml(chips) : '';
    const toggle = bar.querySelector(':scope > [data-chip-rows-more]');
    [...bar.children].forEach(el => { if (el !== toggle) el.remove(); });
    bar.insertAdjacentHTML('afterbegin', html);
    bar.hidden = chips.length <= 1;
    if (!bar.hidden) fitChipRows(bar, {key: 'outside', keep: el => el.dataset.osChip === ALL || el.getAttribute('aria-pressed') === 'true'});
  }
  const list = $('[data-os-list]'), sources = $('[data-os-sources]');
  if (state.mode === 'sources') { sources.innerHTML = sourcesHtml(); list.replaceChildren(); }
  else { list.innerHTML = listHtml(); sources.replaceChildren(); }
}
// 펼친 본문 한 칸만 다시 그린다(같은 그리기 함수, 다른 글의 펼침·스크롤은 그대로).
function paintBody(id) {
  const p = state.posts.find(x => x.id === id), box = root?.querySelector(`[data-os-body="${CSS.escape(id)}"]`);
  if (p && box) box.innerHTML = bodyHtml(p, postView(p));
}

// ---------- 불러오기 ----------
function resetIfOwnerChanged() {
  const scope = scopeOf();
  if (state.scope === scope) return;
  closeLayer();
  state = fresh(); state.scope = scope;
}

async function loadPosts({append = false, keep = false} = {}) {
  const w = workspaceOf(), seq = ++loadSeq;
  if (!w) return;
  const keys = keysOf(state.chip, state.catalog || [], enabledNow());
  if (append) { state.more = true; paint(); }
  else { state.postsFailed = false; if (!keep || !state.postsLoaded) { state.postsLoaded = false; state.posts = []; } paint(); }
  try {
    const rows = await readPosts(w, keys, append ? state.posts.length : 0);
    if (seq !== loadSeq) return;
    const got = Array.isArray(rows) ? rows : [];
    const page = got.slice(0, PAGE_SIZE);
    state.posts = append ? [...state.posts, ...page.filter(p => !state.posts.some(x => x.id === p.id))] : page;
    state.end = got.length <= PAGE_SIZE;
    state.postsLoaded = true;
  } catch {
    if (seq !== loadSeq) return;
    if (!append) state.postsFailed = true;
  } finally {
    if (seq === loadSeq) { state.more = false; paint(); }
  }
}

let entering = null;
async function load() {
  const w = workspaceOf();
  if (!w) return;
  const scope = state.scope;
  const [catalog, sources, seen] = await Promise.allSettled([
    state.catalog ? Promise.resolve(state.catalog) : readCatalog(),
    readSources(w),
    state.seenRead ? Promise.resolve(null) : readSeen(w),
  ]);
  if (scope !== state.scope) return;
  if (catalog.status === 'fulfilled') { state.catalog = catalog.value; state.catalogFailed = false; } else state.catalogFailed = true;
  if (sources.status === 'fulfilled' && Array.isArray(sources.value)) {
    state.sources = new Map(sources.value.filter(r => r && r.source_key).map(r => [r.source_key, r]));
    state.sourcesLoaded = true; state.sourcesFailed = false;
  } else if (!state.sourcesLoaded) state.sourcesFailed = true;
  if (!state.seenRead && seen.status === 'fulfilled') {
    state.seenAt = Array.isArray(seen.value) ? seen.value[0]?.seen_at || null : null;
    state.seenRead = true;
    // 지금 본 것으로 둔다(새 표시는 이번에 연 동안 그대로 남는다). 실패해도 화면은 그대로.
    writeSeen(w, new Date().toISOString()).catch(() => {});
  }
  await loadPosts({keep: true});
}
function enter() {
  resetIfOwnerChanged();
  paint();
  entering ||= load().catch(() => {}).finally(() => { entering = null; });
  return entering;
}

// ---------- 단체 켜고 끄기 칸(같은 화면 안, 뒤로가기 한 번 = 목록) ----------
function openSources() {
  state.mode = 'sources'; state.saveFailed = '';
  layer ||= window.KPTURouter?.layer?.open('outside-sources', {reopen: () => openSources(), close: () => { layer = null; backToList(); return true; }}) || null;
  paint();
  window.scrollTo({top: 0, behavior: 'instant'});
  $('[data-os-back]')?.focus({preventScroll: true});
  if (!state.catalog || !state.sourcesLoaded) load().catch(() => {});
}
let listDirty = false;
function backToList() {
  if (state.mode !== 'sources') return;
  state.mode = 'list'; state.saveFailed = '';
  paint();
  $('[data-os-more]')?.focus({preventScroll: true});
  if (listDirty) { listDirty = false; loadPosts(); }
}
function closeLayer() { const l = layer; layer = null; l?.close(); }

async function toggleSource(key) {
  const w = workspaceOf();
  if (!w || state.saving.has(key) || !catalogOf(key)) return;
  const next = state.sources.get(key)?.enabled !== true;
  state.saving.add(key); state.saveFailed = ''; paint();
  try {
    const row = await writeSource(w, key, next);
    state.sources.set(key, row);
    listDirty = true;
  } catch (e) {
    state.saveFailed = e?.status ? `HTTP ${e.status}` : '';
    if (!state.saveFailed) state.saveFailed = '잠시 뒤 다시';
  } finally {
    state.saving.delete(key);
    paint();
    root?.querySelector(`[data-os-source="${CSS.escape(key)}"]`)?.focus({preventScroll: true});
  }
}

// ---------- 누르기 ----------
const menu = createAnchoredMenu({id: 'osMenu', className: 'topline-add-menu os-menu', label: '바깥 성명 메뉴', historyKey: 'kptuOutsideMenu', key: () => 'head',
  render: () => '<button type="button" data-os-act="sources">단체 켜고 끄기</button>',
  onAction: button => { if (button.dataset.osAct === 'sources') openSources(); }});

root?.addEventListener('click', event => {
  const b = event.target.closest('button');
  if (!b || !root.contains(b)) return;
  if (b.matches('[data-os-chip]')) {
    if (state.chip === b.dataset.osChip) return;
    state.chip = b.dataset.osChip; state.open.clear();
    loadPosts();
    return;
  }
  if (b.matches('[data-os-more]')) { menu.open(b); return; }
  if (b.matches('[data-os-open-sources]')) { openSources(); return; }
  if (b.matches('[data-os-back]')) { closeLayer(); backToList(); return; }
  if (b.matches('[data-os-source]')) { toggleSource(b.dataset.osSource); return; }
  if (b.matches('[data-os-more-posts]')) { loadPosts({append: true}); return; }
  if (b.matches('[data-os-retry]')) { load().catch(() => {}); paint(); return; }
  if (b.matches('[data-os-body-retry]')) { const id = b.closest('[data-os-body]')?.dataset.osBody; if (id) { state.bodies.delete(id); openBody(id); } }
});

async function openBody(id) {
  const p = state.posts.find(x => x.id === id), w = workspaceOf();
  if (!p || !w) return;
  if (postView(p).body !== 'sentences') { paintBody(id); return; }
  const have = state.bodies.get(id);
  if (have && !have.failed) { paintBody(id); return; }
  state.bodies.set(id, {loading: true}); paintBody(id);
  try {
    const rows = await readBody(w, id);
    state.bodies.set(id, {text: bodyText(Array.isArray(rows) ? rows : [])});
  } catch {
    state.bodies.set(id, {failed: true});
  }
  paintBody(id);
}
// <details>의 toggle은 거품이 오르지 않아 잡기 단계에서 받는다.
root?.addEventListener('toggle', event => {
  const d = event.target;
  if (!(d instanceof HTMLDetailsElement) || !d.matches('[data-os-fold]')) return;
  const id = d.dataset.osFold;
  if (d.open) { state.open.add(id); openBody(id); } else state.open.delete(id);
}, true);

window.addEventListener('kptu:view-changed', event => {
  if (event.detail?.view === 'outside') return;
  // 다른 화면으로 가면 켜고 끄기 칸은 닫힌 것으로(라우터가 그 화면의 겹을 정리한다). 다음에 들어오면 목록부터, 새 표시는 다시 읽는다.
  layer = null;
  if (state.mode === 'sources') { state.mode = 'list'; listDirty = false; }
  state.seenRead = false; state.open.clear();
});
window.KPTURouter?.on?.('outside', () => { enter(); });
window.KPTUOutside = {refresh: () => load()};
if (window.KPTURouter?.current === 'outside') enter();
})();
