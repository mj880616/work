import {waitHtml, waitInlineHtml, failHtml, emptyHtml} from './wait-state.js';
import {SEARCH_PAGE, PERIODS, cleanTerm, rangeOf, cleanSimilar, cleanHits, hitDay, hitIsoDay, markParts, mineHits, mineIds} from './outside-search-model.mjs';
import {PRESS_QUOTE_MAX, pressQuotes, hasPressQuote, addPressQuote, removePressQuote, onPressQuotes} from './press-quotes.mjs';
// S48-18 사회운동 Now [문장 찾기](설계 docs/design/outside-statements.md 3.3·4절 [문장 찾기]·5절). 탭 칸 [data-os-search]의 유일한 그리기 주인.
// 탭 줄·탭 상태는 outside-statements.js가 갖고, 이 모듈은 그 칸 안만 그린다(한 영역 한 renderer).
// - 찾기 칸 하나 + 거르기 줄(기간 1달·6달·1년·전체·날짜 고르기, 단체 묶음 칩, [비슷한 말]·[내 성명] 켬 기본).
// - 비슷한 말: 서버 outside-feed ?action=expand(사용자 로그인·하루 횟수는 서버)로 3~6개를 받아 원래 말과 함께 찾는다. 같은 말은 이 탭 메모리에 기억(다시 부르지 않음).
//   못 받으면(하루 횟수 끝·AI 쉼) 낱말만 찾고 한 줄로 알린다.
// - 바깥 문장: RPC app_outside_search(SECURITY INVOKER, owner RLS) — 문장 하나씩, 찾은 말 칠하기(<mark>), 앞뒤 한 문장 흐리게,
//   '단체 · 제목 · 날짜 · [원문]', 비슷한 말로 찾은 것은 다른 색 + '비슷한 말: …' 꼬리표, 작은 [초안에 쓰기](성명 초안 '바깥 문장', 최대 5개, 메모리만).
// - 내 성명: 이미 있는 자료실 찾기 RPC app_search_records(종류 document)를 함께 부르고, 분류 '성명·보도자료'인 자료만 붙인다(새 찾기 함수 없음).
// 바깥에서 온 글은 모두 글자로만 그린다(esc). 로그에 찾는 말·문장을 남기지 않는다. 기기 저장 없음.

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const rt = () => window.KPTURuntime;
const q = v => encodeURIComponent(v);

export function createOutsideSearch({box, nameOf, chipsOf, keysOf, workspaceOf}) {
  const fresh = () => ({query: '', similar: [], similarNote: '', period: 'all', pickFrom: '', pickTo: '', chip: 'all', similarOn: true, mineOn: true,
    hits: [], loaded: false, loading: false, failed: false, end: true, more: false, mine: [], mineLoaded: false, mineFailed: false, note: ''});
  let state = fresh(), seq = 0, built = false;
  const expandCache = new Map(); // 찾는 말(소문자) → 비슷한 말 목록(이 탭 메모리만)
  const $ = sel => box?.querySelector(sel);

  // ---------- 서버 읽기(모두 사용자 로그인 · owner RLS) ----------
  const expandApi = query => rt().api('/functions/v1/outside-feed?action=expand', {method: 'POST', body: {query}, singleFlight: false, timeoutMs: 30000});
  function searchApi(offset) {
    const r = rangeOf(state.period, Date.now(), state.pickFrom, state.pickTo);
    const keys = keysOf(state.chip);
    return rt().api('/rest/v1/rpc/app_outside_search', {method: 'POST', singleFlight: false, body: {
      p_query: state.query, p_terms: state.similar.length ? state.similar : null, p_sources: keys && keys.length ? keys : null,
      p_from: r.from, p_to: r.to, p_limit: SEARCH_PAGE + 1, p_offset: offset}});
  }
  async function mineApi(query) {
    const data = await rt().api('/rest/v1/rpc/app_search_records', {method: 'POST', singleFlight: false,
      body: {p_query: query, p_kinds: null, p_per_kind: 50, p_offset: 0, p_kind: 'document'}});
    const ids = mineIds(data), w = workspaceOf();
    if (!ids.length || !w) return [];
    const rows = await rt().api(`/rest/v1/app_documents?workspace_id=eq.${q(w)}&id=in.(${ids.map(q).join(',')})&select=id,category&limit=${ids.length}`, {singleFlight: false});
    return mineHits(data, new Map((Array.isArray(rows) ? rows : []).map(r => [String(r.id).toLowerCase(), r.category])));
  }

  // ---------- 그리기 ----------
  function build() {
    if (built || !box) return;
    built = true;
    box.innerHTML = `<form class="osq-form" data-osq-form role="search" aria-label="문장 찾기">
<input type="search" class="osq-input" data-osq-input maxlength="100" enterkeyhint="search" placeholder="찾을 낱말·문장" aria-label="찾을 낱말·문장" autocomplete="off">
<button type="submit" class="osq-go">찾기</button></form>
<div class="osq-filters" data-osq-filters></div>
<p class="osq-note" data-osq-note role="status" aria-live="polite"></p>
<div class="osq-tray" data-osq-tray hidden></div>
<div class="osq-results" data-osq-results aria-label="찾은 문장"></div>`;
  }
  const chip = (attr, id, label, on) => `<button type="button" class="os-chip" ${attr}="${esc(id)}" aria-pressed="${on}">${esc(label)}</button>`;
  function filtersHtml() {
    const periods = PERIODS.map(p => chip('data-osq-period', p.id, p.label, state.period === p.id)).join('');
    const pick = state.period === 'pick' ? `<span class="osq-pick"><input type="date" class="osq-date" data-osq-from value="${esc(state.pickFrom)}" aria-label="시작 날짜"><span aria-hidden="true">~</span><input type="date" class="osq-date" data-osq-to value="${esc(state.pickTo)}" aria-label="끝 날짜"></span>` : '';
    const chips = chipsOf();
    const groups = chips.length > 1 ? `<div class="osq-row" role="group" aria-label="단체 거르기">${chips.map(c => chip('data-osq-chip', c.id, c.label, state.chip === c.id)).join('')}</div>` : '';
    const toggles = chip('data-osq-toggle', 'similar', '비슷한 말', state.similarOn) + chip('data-osq-toggle', 'mine', '내 성명', state.mineOn);
    return `<div class="osq-row" role="group" aria-label="기간">${periods}${pick}</div>${groups}<div class="osq-row" role="group" aria-label="함께 찾기">${toggles}</div>`;
  }
  const marked = (text, cls = 'osq-sent') => `<span class="${cls}">${markParts(text, state.query, state.similar).map(p => p.mark ? `<mark class="osq-mark${p.mark === 'sim' ? ' is-sim' : ''}">${esc(p.text)}</mark>` : esc(p.text)).join('')}</span>`;
  function hitHtml(h) {
    const on = hasPressQuote(h.post_id, h.idx);
    const foot = [`<span class="osq-src">${esc(nameOf(h.source_key))}</span>`, h.kind ? esc(h.kind) : '', `<span class="osq-title">${esc(h.title)}</span>`, esc(hitDay(h.published_at))].filter(Boolean).join(' · ');
    const link = h.url ? ` <a class="os-link" href="${esc(h.url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(h.title)} 원문 (새 창)">원문</a>` : '';
    const sim = h.similar && h.matched ? `<span class="osq-sim-tag">비슷한 말: ${esc(h.matched)}</span>` : '';
    return `<article class="osq-hit" data-osq-hit="${esc(h.post_id)}:${h.idx}">
<p class="osq-ctx">${h.prev ? `<span class="osq-near">${esc(h.prev)}</span> ` : ''}${marked(h.sentence)}${h.next ? ` <span class="osq-near">${esc(h.next)}</span>` : ''}</p>
<p class="osq-foot">${foot}${link}${sim}<button type="button" class="osq-quote" data-osq-quote="${esc(h.post_id)}:${h.idx}" aria-pressed="${on}">${on ? '초안에 넣음' : '초안에 쓰기'}</button></p></article>`;
  }
  function mineHtml() {
    if (!state.mineOn || !state.query) return '';
    const head = `<h3 class="osq-head">내 성명${state.mineLoaded ? ` <span class="os-faint">${state.mine.length}</span>` : ''}</h3>`;
    if (!state.mineLoaded) return `<section class="osq-mine" aria-label="내 성명">${head}${state.mineFailed ? failHtml({retry: 'data-osq-retry'}) : waitHtml({rows: 2})}</section>`;
    if (!state.mine.length) return `<section class="osq-mine" aria-label="내 성명">${head}${emptyHtml('내 성명에서 찾은 것 없음')}</section>`;
    return `<section class="osq-mine" aria-label="내 성명">${head}${state.mine.map(m => `<article class="osq-hit is-mine"><p class="osq-ctx">${m.snippet ? marked(m.snippet) : ''}</p><p class="osq-foot"><button type="button" class="osq-doc" data-osq-doc="${esc(m.id)}">${esc(m.title)}</button> · ${esc(m.day)}</p></article>`).join('')}</section>`;
  }
  function resultsHtml() {
    if (!state.query) return emptyHtml('낱말이나 문장을 넣고 찾기', {attrs: 'data-osq-empty="start"'});
    let outside;
    if (!state.loaded) outside = state.failed ? failHtml({retry: 'data-osq-retry'}) : waitHtml({rows: 5, h: 56});
    else if (!state.hits.length) outside = emptyHtml('찾은 문장 없음', {attrs: 'data-osq-empty="hits"'});
    else outside = state.hits.map(hitHtml).join('') + (state.end ? '' : `<button type="button" class="os-text-btn" data-osq-more${state.more ? ' disabled aria-busy="true"' : ''}>더 보기</button>`);
    return `${mineHtml()}<section class="osq-outside" aria-label="바깥 문장"><h3 class="osq-head">바깥 문장${state.loaded ? ` <span class="os-faint">${state.hits.length}${state.end ? '' : '+'}</span>` : ''}</h3>${outside}</section>`;
  }
  function noteHtml() {
    if (state.loading && !state.loaded) return waitInlineHtml();
    const parts = [];
    if (state.similar.length) parts.push(`비슷한 말: ${state.similar.map(esc).join(' · ')}`);
    if (state.similarNote) parts.push(esc(state.similarNote));
    if (state.note) parts.push(esc(state.note));
    return parts.join(' — ');
  }
  function trayHtml(list) {
    return list.length ? `<span>초안에 쓸 문장 <b>${list.length}</b>/${PRESS_QUOTE_MAX}</span><button type="button" class="os-text-btn" data-osq-draft>성명 초안 열기</button>` : '';
  }
  function paint() {
    if (!box) return;
    build();
    const f = $('[data-osq-filters]'); if (f) f.innerHTML = filtersHtml();
    const n = $('[data-osq-note]'); if (n) { n.innerHTML = noteHtml(); n.hidden = !n.innerHTML; }
    const r = $('[data-osq-results]'); if (r) r.innerHTML = resultsHtml();
    paintTray();
  }
  function paintTray() {
    const t = $('[data-osq-tray]'), list = pressQuotes();
    if (!t) return;
    t.innerHTML = trayHtml(list); t.hidden = !list.length;
  }
  // [초안에 쓰기] 단추만 다시 그린다(목록·스크롤은 그대로).
  function paintQuotes() {
    box?.querySelectorAll('[data-osq-quote]').forEach(b => {
      const [post, idx] = b.dataset.osqQuote.split(':'), on = hasPressQuote(post, Number(idx));
      b.setAttribute('aria-pressed', String(on)); b.textContent = on ? '초안에 넣음' : '초안에 쓰기';
    });
    paintTray();
  }
  onPressQuotes(() => paintQuotes());

  // ---------- 찾기 ----------
  async function loadSimilar(mine) {
    state.similar = []; state.similarNote = '';
    if (!state.similarOn) return;
    const key = state.query.toLowerCase();
    if (expandCache.has(key)) { state.similar = expandCache.get(key); return; }
    try {
      const r = await expandApi(state.query);
      if (mine !== seq) return;
      state.similar = cleanSimilar(r?.terms, state.query);
      expandCache.set(key, state.similar);
    } catch (e) {
      if (mine !== seq) return;
      state.similarNote = e?.status === 429 ? '오늘 비슷한 말 찾기를 다 씀 · 낱말만 찾음' : '비슷한 말을 못 가져옴 · 낱말만 찾음';
    }
  }
  async function run({keepSimilar = false} = {}) {
    if (!state.query || !workspaceOf()) { paint(); return; }
    const mine = ++seq;
    Object.assign(state, {hits: [], loaded: false, failed: false, end: true, more: false, loading: true, note: '', mine: [], mineLoaded: false, mineFailed: false});
    paint();
    const mineJob = state.mineOn ? mineApi(state.query).then(list => { if (mine === seq) { state.mine = list; state.mineLoaded = true; } })
      .catch(() => { if (mine === seq) { state.mineFailed = true; } }) : Promise.resolve();
    if (!keepSimilar) await loadSimilar(mine);
    if (mine !== seq) return;
    try {
      const rows = await searchApi(0);
      if (mine !== seq) return;
      const got = cleanHits(rows);
      state.hits = got.slice(0, SEARCH_PAGE); state.end = got.length <= SEARCH_PAGE; state.loaded = true;
    } catch {
      if (mine !== seq) return;
      state.failed = true;
    }
    state.loading = false;
    paint();
    await mineJob;
    if (mine === seq) paint();
  }
  async function more() {
    if (state.end || state.more || !state.loaded) return;
    const mine = seq;
    state.more = true; paint();
    try {
      const rows = await searchApi(state.hits.length);
      if (mine !== seq) return;
      const got = cleanHits(rows), have = new Set(state.hits.map(h => `${h.post_id}:${h.idx}`));
      state.hits = [...state.hits, ...got.slice(0, SEARCH_PAGE).filter(h => !have.has(`${h.post_id}:${h.idx}`))];
      state.end = got.length <= SEARCH_PAGE;
    } catch { state.note = '더 불러오지 못함'; }
    if (mine === seq) { state.more = false; paint(); }
  }
  function toggleQuote(key) {
    const [post, idx] = key.split(':');
    const h = state.hits.find(x => x.post_id === post && x.idx === Number(idx));
    if (!h) return;
    if (hasPressQuote(h.post_id, h.idx)) { removePressQuote(h.post_id, h.idx); return; }
    const r = addPressQuote({post_id: h.post_id, idx: h.idx, text: h.sentence, source: nameOf(h.source_key), title: h.title, day: hitIsoDay(h.published_at)});
    if (r === 'full') { state.note = `초안에 쓸 문장은 ${PRESS_QUOTE_MAX}개까지`; const n = $('[data-osq-note]'); if (n) { n.innerHTML = noteHtml(); n.hidden = false; } }
  }

  // ---------- 누르기 ----------
  box?.addEventListener('submit', e => {
    if (!e.target.matches('[data-osq-form]')) return;
    e.preventDefault();
    const v = cleanTerm($('[data-osq-input]')?.value);
    state.query = v;
    run();
  });
  box?.addEventListener('change', e => {
    if (e.target.matches('[data-osq-from]')) { state.pickFrom = e.target.value; run({keepSimilar: true}); }
    else if (e.target.matches('[data-osq-to]')) { state.pickTo = e.target.value; run({keepSimilar: true}); }
  });
  box?.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || !box.contains(b) || b.disabled) return;
    const d = b.dataset;
    if (d.osqPeriod) { if (state.period !== d.osqPeriod) { state.period = d.osqPeriod; if (d.osqPeriod === 'pick') paint(); else run({keepSimilar: true}); } return; }
    if (d.osqChip) { if (state.chip !== d.osqChip) { state.chip = d.osqChip; run({keepSimilar: true}); } return; }
    if (d.osqToggle === 'similar') { state.similarOn = !state.similarOn; run(); return; }
    if (d.osqToggle === 'mine') { state.mineOn = !state.mineOn; run({keepSimilar: true}); return; }
    if ('osqRetry' in d) { run({keepSimilar: !state.similarNote}); return; }
    if ('osqMore' in d) { more(); return; }
    if (d.osqQuote) { toggleQuote(d.osqQuote); return; }
    if (d.osqDoc) {
      const id = d.osqDoc;
      import('./basket-library-send.js').then(m => { m.requestLibraryDocument(id); window.KPTURouter?.go?.('library', {source: 'delegated'}); });
      return;
    }
    if ('osqDraft' in d) { import('./press-draft.js').then(m => m.openPressDraft({trigger: b, fromQuotes: true})); }
  });

  return {
    paint,
    focus: () => $('[data-osq-input]')?.focus({preventScroll: true}),
    // 로그인·작업공간이 바뀌면 찾은 것·기억한 비슷한 말을 버린다(고른 초안 문장은 press-quotes.mjs가 비운다).
    reset: () => { seq++; state = fresh(); expandCache.clear(); built = false; if (box) box.replaceChildren(); },
  };
}
