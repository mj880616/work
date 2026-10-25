// CALL-통화메뉴 4단계 (docs/design/call-telegram-feed.md 10절 시안 (가)(다), 12절 결정): the 통화 screen (?view=calls, sidebar bottom).
// This module is the only renderer of #callsView. List: small day labels, then rows [시각 · 제목 한 줄 · 조직 작게]; head right
// "개인 통화 n건 걸러짐 ›" (counts only — Web2 holds nothing of those calls). Detail: title, a small line (date · time · 조직/상대),
// the core points box (`[확정]`·`[예정]`·`[확인]` heads read as small tags, feed-model.mjs), the transcript folded under
// "전문 펼치기 ▾" (speaker lines when speaker_split, else one paragraph + "화자 구분은 전사 수정 뒤"), ⋯ top right
// (고정 · 조직 연결 · 요약 복사 · Drive 원본 열기 · 목록에서 지우기); 핵심내용 제목 줄 오른쪽에 작은 [복사]. PC (1024px~): list 1/3 · detail 2/3 (split-resize.js);
// phone: list, then the detail over it as one router layer (Back = one step). Data: feed-data.js (owner RLS REST only).
import './enter-save.js';
import {createAnchoredMenu} from './anchored-menu.js';
import {mountSplitResize} from './split-resize.js';
import {groupByDay, hhmm, dayLabel, readPoints, speakerLines, callFiltered, missingTable, kstDay} from './feed-model.mjs';
import {readFeed, readDays, readRaw, readOrganizations, setPinned, setHidden, scopeOf} from './feed-data.js';
import {callCopyText} from './summary-copy-model.mjs';
import {copyButtonHtml, copySummary} from './summary-copy.js';
import {esc, newLinkBox, linkBoxHtml, openOrgPicker, saveLinkBox, orgName} from './feed-link.js';

const rt = window.KPTURuntime;
const $ = sel => document.querySelector(sel);
const pc = window.matchMedia('(min-width:1024px)');
const MORE = '<span aria-hidden="true">⋯</span>';

let state = fresh(), run = 0, layer = null, undo = null;
function fresh() { return {owner:'', loaded:false, loading:false, missing:false, error:'', rows:[], days:[], orgs:[], mine:new Set(), selected:null, mode:'', raw:new Map(), rawOpen:false, link:null, status:'', busy:false}; }

function install() {
  if ($('#callsView')) return;
  $('#appView')?.insertAdjacentHTML('beforeend', `<section id="callsView" class="view-panel feed-view hidden" aria-labelledby="cfTitle"><h2 id="cfTitle" class="a11y-only">통화</h2><div class="feed-split" id="cfSplit"><div class="feed-list" id="cfList"></div><section class="feed-pane" id="cfDetail" aria-label="통화 상세"></section></div></section>`);
}
install();
const view = () => $('#callsView');
// 상대 표기가 이미 '소속조직 이름 직책'이면 그것만, 아니면 조직 · 상대.
function whoOf(r) {
  const org = orgName(state.orgs, r.organization_id), cp = String(r.counterpart || '');
  return cp && org && cp.startsWith(org) ? cp : [org, cp].filter(Boolean).join(' · ');
}
const rowOf = id => state.rows.find(r => r.id === id) || null;

// ---------- data
async function load() {
  const owner = scopeOf(rt), me = ++run; state.loading = true; if (!state.loaded) paint();
  try {
    const [rows, days, orgs] = await Promise.all([readFeed('call', rt), readDays('call', rt).catch(() => []), readOrganizations(rt).catch(() => ({orgs:[], mine:new Set()}))]);
    if (me !== run || owner !== scopeOf(rt)) return;
    Object.assign(state, {owner, loaded:true, loading:false, missing:false, error:'', rows, days, orgs:orgs.orgs, mine:orgs.mine});
    if (state.selected && !rowOf(state.selected)) closeDetail({quiet:true});
  } catch (error) {
    if (me !== run || owner !== scopeOf(rt)) return;
    Object.assign(state, {owner, loaded:true, loading:false, rows:[], missing:missingTable(error), error:missingTable(error) ? '' : '통화 목록을 불러오지 못했어요.'});
  }
  paint();
}
async function loadRaw(id) {
  if (state.raw.has(id)) return;
  state.raw.set(id, {loading:true});
  try { const r = await readRaw(id, rt); state.raw.set(id, r ? {raw_text:r.raw_text, speaker_split:!!r.speaker_split} : {raw_text:null}); }
  catch { state.raw.set(id, {error:true}); }
  if (state.selected === id) paintDetail();
}

// ---------- paint (the only renderer of #callsView)
function paint() {
  const root = view(); if (!root) return;
  const wide = pc.matches, open = !!state.selected || state.mode === 'filtered';
  paintList(); paintDetail();
  $('#cfList').hidden = !wide && open; $('#cfDetail').hidden = !wide && !open;
  const row = rowOf(state.selected);
  window.dispatchEvent(new CustomEvent('kptu:where-item', {detail:{view:'calls', name:wide && row ? row.title : wide && state.mode === 'filtered' ? '걸러진 통화' : null}}));
  mountSplitResize({container:$('#cfSplit'), name:'tasks', label:'통화 목록과 상세 칸 폭 조절', list:() => $('#cfList'), pane:() => $('#cfDetail'), active:() => pc.matches && !view()?.classList.contains('hidden')});
}
function filteredLink() {
  const f = callFiltered(state.days, kstDay());
  const failed = f.failed ? `<span class="feed-faint">판정 실패 ${f.failed}</span>` : '';
  return `<button type="button" class="feed-text-btn" data-cf-filtered${state.mode === 'filtered' ? ' aria-current="true"' : ''}>개인 통화 ${f.total}건 걸러짐 <span aria-hidden="true">›</span></button>${failed}`;
}
function paintList() {
  const box = $('#cfList');
  const head = `<div class="feed-head"><span class="feed-head-sub"></span>${state.loaded && !state.missing && !state.error ? filteredLink() : ''}</div>`;
  if (!state.loaded) { box.innerHTML = head + '<p class="feed-empty" role="status">불러오는 중…</p>'; return; }
  if (state.missing) { box.innerHTML = head + '<p class="feed-empty" data-cf-empty="ready">준비 중이에요. 통화 수집이 연결되면 여기에 보여요.</p>'; return; }
  if (state.error) { box.innerHTML = head + `<p class="feed-empty" role="status">${esc(state.error)} <button type="button" class="feed-text-btn" data-cf-retry>다시 시도</button></p>`; return; }
  const groups = groupByDay(state.rows);
  const body = groups.length ? groups.map(g => `<div class="feed-day" data-cf-day="${esc(g.day)}">${esc(g.label)}</div>${g.items.map(r => {
    const on = r.id === state.selected, org = orgName(state.orgs, r.organization_id) || r.counterpart || '';
    return `<button type="button" class="feed-call${on ? ' is-selected' : ''}" data-cf-row="${esc(r.id)}"${on ? ' aria-current="true"' : ''}><span class="feed-time">${esc(hhmm(r.occurred_at))}</span><span class="feed-title">${r.pinned_at ? '<span class="feed-pin" aria-label="고정">고정</span>' : ''}${esc(r.title || '(제목 없음)')}</span><span class="feed-org">${esc(org)}</span></button>`;
  }).join('')}`).join('') : '<p class="feed-empty" data-cf-empty="none">아직 받은 업무 통화가 없어요.</p>';
  box.innerHTML = head + `<div class="feed-rows">${body}</div><p class="feed-status" data-cf-status role="status">${statusHtml()}</p>`;
}
const statusHtml = () => esc(state.status) + (undo ? ' <button type="button" class="feed-text-btn" data-cf-undo>되돌리기</button>' : '');
function paintDetail() {
  const box = $('#cfDetail'), back = pc.matches ? '' : '<button type="button" class="back-text" data-cf-back>‹ 통화</button>';
  if (state.mode === 'filtered') {
    const f = callFiltered(state.days, kstDay());
    box.innerHTML = `<div class="feed-detail-head">${back}${pc.matches ? '' : '<span class="feed-detail-name">걸러진 통화</span>'}</div><div class="feed-detail" data-cf-filtered-detail><p>최근 7일 개인 ${f.personal}건 · 애매 ${f.unsure}건${f.failed ? ` · 판정 실패 ${f.failed}건` : ''}</p><p class="feed-faint">Web2에는 옮기지 않았어요. 원본은 Drive 통화 녹음·전사 폴더에 있어요.</p></div>`;
    return;
  }
  const r = rowOf(state.selected);
  if (!r) { box.innerHTML = '<p class="feed-empty feed-pane-empty">왼쪽에서 통화를 고르면 핵심내용이 보여요.</p>'; return; }
  const who = whoOf(r);
  const meta = [dayLabel(r.day), hhmm(r.occurred_at), who].filter(Boolean).join(' · ');
  const points = readPoints(r.points);
  const pointsHtml = points.length ? `<div class="feed-k-row"><p class="feed-k">핵심내용</p>${copyButtonHtml('data-cf-copy')}</div><ul class="feed-points" data-cf-points>${points.map(p => `<li>${esc(p.text)}${p.tag ? `<span class="feed-tag feed-tag-${p.kind}">${esc(p.tag)}</span>` : ''}</li>`).join('')}</ul>` : '<p class="feed-faint">핵심내용이 없어요.</p>';
  const raw = state.raw.get(r.id);
  let script;
  if (!raw || raw.loading) script = '<p class="feed-faint" role="status">전문을 불러오는 중…</p>';
  else if (raw.error) script = '<p class="feed-faint">전문을 불러오지 못했어요.</p>';
  else if (!raw.raw_text) script = '<p class="feed-faint" data-cf-raw-empty>Web2에 남은 전문이 없어요. 원본은 Drive에 있어요.</p>';
  else if (raw.speaker_split) script = `<div class="feed-script" data-cf-script="lines">${speakerLines(raw.raw_text).map(l => `<p class="${l.me ? 'is-me' : ''}"><b>${esc(l.who)}</b><span>${esc(l.text)}</span></p>`).join('')}</div>`;
  else script = `<div class="feed-script feed-script-one" data-cf-script="one">${esc(raw.raw_text)}</div>`;
  const badge = raw && raw.raw_text && !raw.speaker_split ? '<span class="feed-badge">화자 구분은 전사 수정 뒤</span>' : '';
  const full = `<details class="feed-full" data-cf-full${state.rawOpen ? ' open' : ''}><summary>${state.rawOpen ? '전문 접기' : '전문 펼치기'} <span class="feed-ar" aria-hidden="true">▾</span>${badge}</summary>${script}</details>`;
  const link = state.link?.rowId === r.id ? linkBoxHtml(state.link, state.orgs, 'cf') : '';
  // UI-더보기제목줄: ⋯는 빈 줄을 따로 차지하지 않고 상세 첫 줄(폰은 제목, PC는 날짜·시간 줄) 오른쪽 끝에 둔다(공용 .kptu-title-line, base-ui.css).
  const more = `<button type="button" class="feed-more" data-cf-more aria-haspopup="true" aria-expanded="false" aria-label="통화 메뉴"${state.busy ? ' disabled' : ''}>${MORE}</button>`;
  const metaText = `${esc(meta)}${r.pinned_at ? ' · 고정' : ''}`;
  const first = pc.matches
    ? `<div class="kptu-title-line"><p class="feed-meta" data-cf-meta>${metaText}</p>${more}</div>`
    : `<div class="kptu-title-line"><h3 class="feed-detail-title" data-cf-title>${esc(r.title || '(제목 없음)')}</h3>${more}</div><p class="feed-meta" data-cf-meta>${metaText}</p>`;
  box.innerHTML = `${back ? `<div class="feed-detail-head">${back}</div>` : ''}
<div class="feed-detail" data-cf-detail="${esc(r.id)}">${first}${link}${pointsHtml}${full}<p class="feed-status" data-cf-detail-status role="status">${statusHtml()}</p></div>`;
}

// ---------- actions
function openLayer() {
  if (!pc.matches) layer ||= window.KPTURouter?.layer?.open('call-detail', {close:() => { layer = null; closeDetail({fromBack:true}); return true; }}) || null;
}
function select(id) {
  if (state.link && !dropLink()) return;
  state.selected = id; state.mode = ''; state.rawOpen = false; state.status = ''; undo = null;
  openLayer(); paint(); void loadRaw(id);
  (pc.matches ? $(`#cfList [data-cf-row="${CSS.escape(id)}"]`) : $('#cfDetail [data-cf-back]'))?.focus({preventScroll:true});
}
function showFiltered() { state.selected = null; state.mode = 'filtered'; state.link = null; openLayer(); paint(); (pc.matches ? $('#cfList [data-cf-filtered]') : $('#cfDetail [data-cf-back]'))?.focus({preventScroll:true}); }
function closeDetail({fromBack = false, quiet = false} = {}) {
  const id = state.selected, wasFiltered = state.mode === 'filtered';
  state.selected = null; state.mode = ''; state.link = null; state.rawOpen = false;
  const l = layer; layer = null; if (!fromBack) l?.close();
  if (quiet) return;
  paint();
  (wasFiltered ? $('#cfList [data-cf-filtered]') : $(`#cfList [data-cf-row="${CSS.escape(id || '')}"]`))?.focus({preventScroll:true});
}
function dropLink() { const r = rowOf(state.link?.rowId), changed = state.link && r && state.link.summary.trim() !== newLinkBox(r).summary.trim(); if (changed && !window.confirm('쓰던 요약을 버릴까요?')) return false; state.link = null; return true; }
const say = text => { state.status = text; for (const el of view()?.querySelectorAll('[data-cf-status],[data-cf-detail-status]') || []) el.innerHTML = statusHtml(); };
const replaceRow = saved => { state.rows = state.rows.map(r => r.id === saved.id ? {...r, ...saved} : r); };

async function guarded(fn) {
  if (state.busy) return; const owner = scopeOf(rt); state.busy = true; paintDetail();
  try { await fn(() => owner === scopeOf(rt)); } finally { state.busy = false; if (owner === scopeOf(rt)) paint(); }
}
const gone = () => { state.status = '이 통화가 그사이 사라졌어요. 목록을 다시 불러왔어요.'; return load(); };
function pin(r) {
  return guarded(async current => {
    try { const saved = await setPinned(r.id, !r.pinned_at, rt); if (!current()) return; if (!saved) return void await gone(); replaceRow(saved); state.status = saved.pinned_at ? '고정했어요.' : '고정을 풀었어요.'; }
    catch { if (current()) state.status = '저장하지 못했어요. 다시 시도해 주세요.'; }
  }).then(() => $('#cfDetail [data-cf-more]')?.focus({preventScroll:true}));
}
function hide(r) {
  return guarded(async current => {
    try {
      const saved = await setHidden(r.id, true, rt); if (!current()) return; if (!saved) return void await gone();
      state.rows = state.rows.filter(x => x.id !== r.id); closeDetail({quiet:true});
      undo = {id:r.id, row:{...r, hidden_at:null}}; state.status = '목록에서 지웠어요. 원본은 Drive에 있어요.';
    } catch { if (current()) state.status = '지우지 못했어요. 다시 시도해 주세요.'; }
  }).then(() => $('#cfList [data-cf-undo]')?.focus({preventScroll:true}));
}
function restore() {
  const u = undo; if (!u) return; undo = null;
  return guarded(async current => {
    try { const saved = await setHidden(u.id, false, rt); if (!current()) return; if (saved) { state.rows = [...state.rows, {...u.row, ...saved}]; state.status = '되돌렸어요.'; } else state.status = '되돌리지 못했어요.'; }
    catch { if (current()) state.status = '되돌리지 못했어요. 다시 시도해 주세요.'; }
  });
}
const callText = r => callCopyText({who:whoOf(r), title:r.title, dayText:dayLabel(r.day), time:hhmm(r.occurred_at), points:r.points});
const copyCall = r => copySummary(callText(r), {say, current:() => state.status});
function startLink(r) { state.link = newLinkBox(r); paintDetail(); $('#cfDetail [data-cf-link-pick]')?.focus({preventScroll:true}); }
function saveLink() {
  const r = rowOf(state.link?.rowId), box = state.link; if (!r || !box) return;
  box.busy = true; paintDetail();
  return guarded(async current => {
    try { const res = await saveLinkBox(r, box, rt); if (!current()) return; if (!res.saved) return void await gone(); replaceRow(res.saved); state.link = null; state.status = res.text; window.dispatchEvent(new Event('kptu:basket-links-changed')); }
    catch { if (current()) { box.busy = false; box.status = '연결하지 못했어요. 다시 시도해 주세요.'; } }
  }).then(() => $('#cfDetail [data-cf-more]')?.focus({preventScroll:true}));
}

const menu = createAnchoredMenu({id:'cfMenu', className:'feed-menu', label:'통화 메뉴', historyKey:'kptuCallMenu', key:() => 'detail',
  render:() => {
    const r = rowOf(state.selected); if (!r) return '';
    return `<button type="button" data-cf-act="pin">${r.pinned_at ? '고정 풀기' : '고정'}</button><button type="button" data-cf-act="link">조직 연결</button>${callText(r) ? '<button type="button" data-cf-act="copy">요약 복사</button>' : ''}${r.drive_url ? '<button type="button" data-cf-act="drive">Drive 원본 열기</button>' : ''}<button type="button" class="feed-menu-danger" data-cf-act="hide">지우기 <span class="feed-faint">목록에서만</span></button>`;
  },
  onAction:button => {
    const r = rowOf(state.selected); if (!r) return; const act = button.dataset.cfAct;
    if (act === 'pin') void pin(r); else if (act === 'hide') void hide(r); else if (act === 'copy') void copyCall(r); else if (act === 'link') startLink(r);
    else if (act === 'drive' && /^https:\/\/(drive|docs)\.google\.com\//.test(r.drive_url || '')) window.open(r.drive_url, '_blank', 'noopener,noreferrer');
  }});

function bind() {
  const root = view(); if (!root || root.dataset.cfBound) return; root.dataset.cfBound = '1';
  root.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.disabled || !root.contains(b)) return;
    const d = b.dataset;
    if (d.cfRow) select(d.cfRow);
    else if (b.hasAttribute('data-cf-filtered')) showFiltered();
    else if (b.hasAttribute('data-cf-back')) { if (!state.link || dropLink()) closeDetail(); }
    else if (b.hasAttribute('data-cf-copy')) { const r = rowOf(state.selected); if (r) void copyCall(r); }
    else if (b.hasAttribute('data-cf-retry')) void load();
    else if (b.hasAttribute('data-cf-undo')) void restore();
    else if (b.hasAttribute('data-cf-more')) menu.open(b);
    else if (b.hasAttribute('data-cf-link-pick')) { const box = state.link; if (box) void openOrgPicker(b, {orgs:state.orgs, mine:state.mine, selected:box.orgId, onPick:id => { box.orgId = id; paintDetail(); $('#cfDetail [data-cf-link-pick]')?.focus({preventScroll:true}); }}); }
    else if (b.hasAttribute('data-cf-link-cancel')) { state.link = null; paintDetail(); $('#cfDetail [data-cf-more]')?.focus({preventScroll:true}); }
    else if (b.hasAttribute('data-cf-link-save')) void saveLink();
  });
  root.addEventListener('input', e => { if (e.target.matches('[data-cf-link-text]') && state.link) state.link.summary = e.target.value; });
  root.addEventListener('toggle', e => {
    if (!e.target.matches?.('[data-cf-full]')) return;
    state.rawOpen = e.target.open;
    const s = e.target.querySelector('summary'); if (s?.firstChild) s.firstChild.textContent = state.rawOpen ? '전문 접기 ' : '전문 펼치기 ';
  }, true);
}
bind();

window.addEventListener('kptu:view-changed', e => {
  if (e.detail?.view === 'calls') { if (!state.loaded || state.owner !== scopeOf(rt)) void load(); else paint(); return; }
  layer = null; state.link = null; menu.close?.(null, true);
  window.dispatchEvent(new CustomEvent('kptu:where-item', {detail:{view:'calls', name:null}}));
});
window.addEventListener('kptu:session-changed', () => { run++; layer = null; undo = null; state = fresh(); if (view()) paint(); });
pc.addEventListener?.('change', () => { if (view() && !view().classList.contains('hidden')) { if (pc.matches && layer) { const l = layer; layer = null; l.close(); } paint(); } });
paint();
window.KPTUCallFeed = {reload:() => load()};
