// CALL-통화메뉴 4단계 (docs/design/call-telegram-feed.md 10절 시안 (가)(다), 12절 결정) + CALL-개인통화함 3단계 (docs/design/call-personal.md, B안):
// the 통화 screen (?view=calls, sidebar bottom). This module is the only renderer of #callsView. It shows one of two boxes with the same
// list and the same detail: the 업무 통화함 (default, app_feed_items) and the 개인 통화함 (the personal table, opened by the small
// '개인 통화함 n ›' at the top right, '‹ 업무 통화' goes back). 애매 calls (kind 'unsure' of the personal table) wait at the top of the work box
// as "확인할 통화 n" with [업무][개인] buttons; until decided they are used nowhere else. Moving a call between the boxes is one DB function
// (feed-data.js moveCall) from the ⋯ menu, a PC right-click or a phone long press (feed-hold.js); a personal detail has no 조직 연결 / 고정.
// List: small day labels, then rows [시각 · 제목 한 줄 · 조직 작게]. Detail: title, a small line (date · time · 조직/상대),
// the core points box (`[확정]`·`[예정]`·`[확인]` heads read as small tags, feed-model.mjs), the transcript folded under
// "전문 펼치기 ▾" (speaker lines when speaker_split, else one paragraph + "화자 구분은 전사 수정 뒤"), ⋯ top right;
// 핵심내용 제목 줄 오른쪽에 작은 [복사]. PC (1024px~): list 1/3 · detail 2/3 (split-resize.js);
// phone: list, then the detail over it as one router layer (Back = one step; the personal box is a layer too). Data: feed-data.js (owner RLS REST only).
import './enter-save.js';
import {createAnchoredMenu} from './anchored-menu.js';
import {mountSplitResize} from './split-resize.js';
import {createFeedHold} from './feed-hold.js';
import {groupByDay, hhmm, dayLabel, readPoints, speakerLines, missingTable, kstDay, splitPersonal, legacyFilteredNote, moveToPersonalWarning, moveErrorText, moveDoneText} from './feed-model.mjs';
import {readFeed, readDays, readRaw, readOrganizations, setPinned, setHidden, scopeOf, readPersonal, readPersonalRaw, setPersonalHidden, moveCall, readLedgerSeen} from './feed-data.js';
import {callCopyText} from './summary-copy-model.mjs';
import {copyButtonHtml, copySummary} from './summary-copy.js';
import {esc, newLinkBox, linkBoxHtml, openOrgPicker, saveLinkBox, orgName} from './feed-link.js';

const rt = window.KPTURuntime;
const $ = sel => document.querySelector(sel);
const pc = window.matchMedia('(min-width:1024px)');
const phone = window.matchMedia('(max-width:760px)');
const MORE = '<span aria-hidden="true">⋯</span>';

let state = fresh(), run = 0, layer = null, boxLayer = null, undo = null;
function fresh() { return {owner:'', loaded:false, loading:false, missing:false, error:'', rows:[], prows:[], pmissing:false, pfail:false, days:[], orgs:[], mine:new Set(), box:'work', selected:null, raw:new Map(), rawOpen:false, link:null, confirm:null, status:'', busy:false}; }

function install() {
  if ($('#callsView')) return;
  $('#appView')?.insertAdjacentHTML('beforeend', `<section id="callsView" class="view-panel feed-view hidden" aria-labelledby="cfTitle"><h2 id="cfTitle" class="a11y-only">통화</h2><div class="feed-split" id="cfSplit"><div class="feed-list" id="cfList"></div><section class="feed-pane" id="cfDetail" aria-label="통화 상세"></section></div></section>`);
}
install();
const view = () => $('#callsView');
// A personal-box row (kind personal | unsure) carries box:'personal' from feed-data.js readPersonal; a work row has no such mark.
const isPersonal = r => r?.box === 'personal';
// 상대 표기가 이미 '소속조직 이름 직책'이면 그것만, 아니면 조직 · 상대. 개인 통화는 조직이 없다.
function whoOf(r) {
  const org = isPersonal(r) ? '' : orgName(state.orgs, r.organization_id), cp = String(r.counterpart || '');
  return cp && org && cp.startsWith(org) ? cp : [org, cp].filter(Boolean).join(' · ');
}
const rowOf = id => state.rows.find(r => r.id === id) || state.prows.find(r => r.id === id) || null;
const personalRows = () => splitPersonal(state.prows).personal;
const unsureRows = () => splitPersonal(state.prows).unsure;

// ---------- data
async function load() {
  const owner = scopeOf(rt), me = ++run; state.loading = true; if (!state.loaded) paint();
  try {
    const [rows, days, orgs, personal] = await Promise.all([
      readFeed('call', rt), readDays('call', rt).catch(() => []), readOrganizations(rt).catch(() => ({orgs:[], mine:new Set()})),
      readPersonal(rt).then(prows => ({prows, pmissing:false, pfail:false}), error => ({prows:[], pmissing:missingTable(error), pfail:!missingTable(error)})),
    ]);
    if (me !== run || owner !== scopeOf(rt)) return;
    Object.assign(state, {owner, loaded:true, loading:false, missing:false, error:'', rows, days, orgs:orgs.orgs, mine:orgs.mine}, personal);
    if (state.selected && !rowOf(state.selected)) closeDetail({quiet:true});
  } catch (error) {
    if (me !== run || owner !== scopeOf(rt)) return;
    Object.assign(state, {owner, loaded:true, loading:false, rows:[], prows:[], missing:missingTable(error), error:missingTable(error) ? '' : '통화 목록을 불러오지 못했어요.'});
  }
  paint();
}
async function loadRaw(id) {
  if (state.raw.has(id)) return;
  const personal = isPersonal(rowOf(id));
  state.raw.set(id, {loading:true});
  try { const r = await (personal ? readPersonalRaw(id, rt) : readRaw(id, rt)); state.raw.set(id, r ? {raw_text:r.raw_text, speaker_split:!!r.speaker_split} : {raw_text:null}); }
  catch { state.raw.set(id, {error:true}); }
  if (state.selected === id) paintDetail();
}

// ---------- paint (the only renderer of #callsView)
function paint() {
  const root = view(); if (!root) return;
  const wide = pc.matches, open = !!state.selected;
  paintList(); paintDetail();
  $('#cfList').hidden = !wide && open; $('#cfDetail').hidden = !wide && !open;
  const row = rowOf(state.selected);
  window.dispatchEvent(new CustomEvent('kptu:where-item', {detail:{view:'calls', name:wide && row ? row.title : null}}));
  mountSplitResize({container:$('#cfSplit'), name:'tasks', label:'통화 목록과 상세 칸 폭 조절', list:() => $('#cfList'), pane:() => $('#cfDetail'), active:() => pc.matches && !view()?.classList.contains('hidden')});
}
// 맨 위 오른쪽 작은 '개인 통화함 n ›'. 개인 표가 없으면(DB 미적용) 보이지 않는다.
function boxChip() {
  if (state.pmissing) return '';
  return `<button type="button" class="feed-chip" data-cf-box="personal">개인 통화함${state.pfail ? '' : ` ${personalRows().length}`} <span aria-hidden="true">›</span></button>`;
}
function rowHtml(r, {ask = false} = {}) {
  const on = r.id === state.selected, org = isPersonal(r) ? r.counterpart || '' : orgName(state.orgs, r.organization_id) || r.counterpart || '';
  const badge = r.kind === 'unsure' && !ask ? '<span class="feed-badge">애매</span> ' : '';
  const open = `<button type="button" class="feed-call${on ? ' is-selected' : ''}" data-cf-row="${esc(r.id)}"${on ? ' aria-current="true"' : ''}><span class="feed-time">${esc(hhmm(r.occurred_at))}</span><span class="feed-title">${r.pinned_at ? '<span class="feed-pin" aria-label="고정">고정</span>' : ''}${badge}${esc(r.title || '(제목 없음)')}</span>${ask ? '' : `<span class="feed-org">${esc(org)}</span>`}</button>`;
  if (ask) return `<div class="feed-callrow feed-ask" data-cf-item="${esc(r.id)}">${open}<span class="feed-ask-btns"><button type="button" class="feed-small" data-cf-decide="work" data-cf-id="${esc(r.id)}"${state.busy ? ' disabled' : ''}>업무</button><button type="button" class="feed-small" data-cf-decide="personal" data-cf-id="${esc(r.id)}"${state.busy ? ' disabled' : ''}>개인</button></span></div>`;
  return `<div class="feed-callrow" data-cf-item="${esc(r.id)}">${open}<button type="button" class="feed-hov" data-cf-rowmore="${esc(r.id)}" aria-haspopup="true" aria-expanded="false" aria-label="통화 메뉴">${MORE}</button></div>`;
}
const listHtml = (rows, emptyHtml) => {
  const groups = groupByDay(rows);
  return groups.length ? groups.map(g => `<div class="feed-day" data-cf-day="${esc(g.day)}">${esc(g.label)}</div>${g.items.map(r => rowHtml(r)).join('')}`).join('') : emptyHtml;
};
function paintList() {
  const box = $('#cfList');
  const personalBox = state.box === 'personal';
  const head = personalBox
    ? `<div class="feed-head"><button type="button" class="back-text" data-cf-box="work">‹ 업무 통화</button><span class="feed-head-title">개인 통화함</span><span class="feed-head-sub" data-cf-pcount>${state.pfail ? '' : `${personalRows().length}건`}</span></div>`
    : `<div class="feed-head"><span class="feed-head-sub"></span>${state.loaded && !state.missing && !state.error ? boxChip() : ''}</div>`;
  if (!state.loaded) { box.innerHTML = head + '<p class="feed-empty" role="status">불러오는 중…</p>'; return; }
  if (state.missing) { box.innerHTML = head + '<p class="feed-empty" data-cf-empty="ready">준비 중이에요. 통화 수집이 연결되면 여기에 보여요.</p>'; return; }
  if (state.error) { box.innerHTML = head + `<p class="feed-empty" role="status">${esc(state.error)} <button type="button" class="feed-text-btn" data-cf-retry>다시 시도</button></p>`; return; }
  const status = `<p class="feed-status" data-cf-status role="status">${statusHtml()}</p>`;
  if (personalBox) {
    if (state.pfail) { box.innerHTML = head + `<p class="feed-empty" role="status">개인 통화함을 불러오지 못했어요. <button type="button" class="feed-text-btn" data-cf-retry>다시 시도</button></p>${status}`; return; }
    const legacy = legacyFilteredNote(state.days, kstDay());
    box.innerHTML = head + `<p class="feed-note" data-cf-note>업무 기록(원장·주간보고·챙길 것·업무일지)에 쓰이지 않고, 전체 검색에도 나오지 않아요.</p>${legacy ? `<p class="feed-note" data-cf-legacy>${esc(legacy)}</p>` : ''}<div class="feed-rows">${listHtml(personalRows(), '<p class="feed-empty" data-cf-empty="personal">개인 통화함이 비어 있어요.</p>')}</div>${status}`;
    return;
  }
  const ask = unsureRows();
  const askHtml = ask.length ? `<div class="feed-ask-head" data-cf-ask-head>확인할 통화 ${ask.length} <span class="feed-faint">· 정하기 전에는 업무 기록에 쓰이지 않아요</span></div><div class="feed-rows feed-ask-rows">${ask.map(r => rowHtml(r, {ask:true})).join('')}</div>` : '';
  box.innerHTML = head + askHtml + `<div class="feed-rows">${listHtml(state.rows, '<p class="feed-empty" data-cf-empty="none">아직 받은 업무 통화가 없어요.</p>')}</div>${status}`;
}
const statusHtml = () => esc(state.status) + (undo ? ' <button type="button" class="feed-text-btn" data-cf-undo>되돌리기</button>' : '');
function paintDetail() {
  const box = $('#cfDetail'), back = pc.matches ? '' : '<button type="button" class="back-text" data-cf-back>‹ 통화</button>';
  const r = rowOf(state.selected);
  if (!r) { box.innerHTML = '<p class="feed-empty feed-pane-empty">왼쪽에서 통화를 고르면 핵심내용이 보여요.</p>'; return; }
  const personal = isPersonal(r), unsure = r.kind === 'unsure';
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
  const link = !personal && state.link?.rowId === r.id ? linkBoxHtml(state.link, state.orgs, 'cf') : '';
  const confirm = state.confirm?.id === r.id ? `<div class="feed-warn" data-cf-confirm role="alert"><p>${esc(state.confirm.text)}</p><div class="feed-link-actions"><button type="button" class="feed-small" data-cf-confirm-go>개인 통화로 옮기기</button><button type="button" class="feed-small" data-cf-confirm-cancel>취소</button></div></div>` : '';
  const decide = unsure ? `<div class="feed-decide" data-cf-decide-bar><span class="feed-faint">업무 통화인지 개인 통화인지 정해 주세요</span><span class="feed-ask-btns"><button type="button" class="feed-small" data-cf-decide="work" data-cf-id="${esc(r.id)}"${state.busy ? ' disabled' : ''}>업무</button><button type="button" class="feed-small" data-cf-decide="personal" data-cf-id="${esc(r.id)}"${state.busy ? ' disabled' : ''}>개인</button></span></div>` : '';
  // UI-더보기제목줄: ⋯는 빈 줄을 따로 차지하지 않고 상세 첫 줄(폰은 제목, PC는 날짜·시간 줄) 오른쪽 끝에 둔다(공용 .kptu-title-line, base-ui.css).
  const more = `<button type="button" class="feed-more" data-cf-more aria-haspopup="true" aria-expanded="false" aria-label="통화 메뉴"${state.busy ? ' disabled' : ''}>${MORE}</button>`;
  const metaText = `${esc(meta)}${r.pinned_at ? ' · 고정' : ''}${unsure ? ' · 애매' : personal ? ' · 개인' : ''}`;
  const first = pc.matches
    ? `<div class="kptu-title-line"><p class="feed-meta" data-cf-meta>${metaText}</p>${more}</div>`
    : `<div class="kptu-title-line"><h3 class="feed-detail-title" data-cf-title>${esc(r.title || '(제목 없음)')}</h3>${more}</div><p class="feed-meta" data-cf-meta>${metaText}</p>`;
  box.innerHTML = `${back ? `<div class="feed-detail-head">${back}</div>` : ''}
<div class="feed-detail" data-cf-detail="${esc(r.id)}" data-cf-box-of="${personal ? 'personal' : 'work'}">${first}${confirm}${decide}${link}${pointsHtml}${full}<p class="feed-status" data-cf-detail-status role="status">${statusHtml()}</p></div>`;
}

// ---------- actions
function openLayer() {
  if (!pc.matches) layer ||= window.KPTURouter?.layer?.open('call-detail', {close:() => { layer = null; closeDetail({fromBack:true}); return true; }}) || null;
}
function select(id) {
  if (state.link && !dropLink()) return;
  state.selected = id; state.rawOpen = false; state.status = ''; undo = null; state.confirm = null;
  openLayer(); paint(); void loadRaw(id);
  (pc.matches ? $(`#cfList [data-cf-row="${CSS.escape(id)}"]`) : $('#cfDetail [data-cf-back]'))?.focus({preventScroll:true});
}
function closeDetail({fromBack = false, quiet = false} = {}) {
  const id = state.selected;
  state.selected = null; state.link = null; state.rawOpen = false; state.confirm = null;
  const l = layer; layer = null; if (!fromBack) l?.close();
  if (quiet) return;
  paint();
  $(`#cfList [data-cf-row="${CSS.escape(id || '')}"]`)?.focus({preventScroll:true});
}
// 업무 통화함 ⇄ 개인 통화함. 폰은 개인 통화함을 router layer 한 칸으로 열어 뒤로가기 한 번이 '‹ 업무 통화'다.
function setBox(next, {fromBack = false} = {}) {
  if (state.box === next) return;
  if (state.link && !dropLink()) return;
  if (state.selected) closeDetail({quiet:true});
  state.box = next; state.confirm = null; state.status = ''; undo = null;
  if (next === 'personal') { if (!pc.matches) boxLayer ||= window.KPTURouter?.layer?.open('call-box', {close:() => { boxLayer = null; setBox('work', {fromBack:true}); return true; }}) || null; }
  else { const l = boxLayer; boxLayer = null; if (!fromBack) l?.close(); }
  paint();
  $(next === 'personal' ? '#cfList [data-cf-box="work"]' : '#cfList [data-cf-box="personal"]')?.focus({preventScroll:true});
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
const dropFromList = r => { if (isPersonal(r)) state.prows = state.prows.filter(x => x.id !== r.id); else state.rows = state.rows.filter(x => x.id !== r.id); };
function hide(r) {
  return guarded(async current => {
    try {
      const saved = await (isPersonal(r) ? setPersonalHidden(r.id, true, rt) : setHidden(r.id, true, rt)); if (!current()) return; if (!saved) return void await gone();
      dropFromList(r); if (state.selected === r.id) closeDetail({quiet:true});
      undo = {type:'hide', id:r.id, row:{...r, hidden_at:null}}; state.status = '목록에서 지웠어요. 원본은 Drive에 있어요.';
    } catch { if (current()) state.status = '지우지 못했어요. 다시 시도해 주세요.'; }
  }).then(() => $('#cfList [data-cf-undo]')?.focus({preventScroll:true}));
}
function restore() {
  const u = undo; if (!u) return; undo = null;
  return guarded(async current => {
    if (u.type === 'move') {
      const res = await moveCall(u.id, u.to, rt); if (!current()) return;
      state.status = res.ok ? '되돌렸어요.' : moveErrorText(res.error);
      await load(); return;
    }
    try {
      const personal = isPersonal(u.row), saved = await (personal ? setPersonalHidden(u.id, false, rt) : setHidden(u.id, false, rt)); if (!current()) return;
      if (saved) { if (personal) state.prows = [...state.prows, {...u.row, ...saved}]; else state.rows = [...state.rows, {...u.row, ...saved}]; state.status = '되돌렸어요.'; } else state.status = '되돌리지 못했어요.';
    } catch { if (current()) state.status = '되돌리지 못했어요. 다시 시도해 주세요.'; }
  });
}
// 옮기기: one DB function moves the call (and nothing else changes). 업무→개인은 원장에 이미 쓰였거나 고정·조직 연결이 있으면
// 먼저 한 줄로 알리고 [개인 통화로 옮기기]를 한 번 더 누르게 한다(원장 기록은 지워지지 않는다).
function moveRow(r, to, {confirmed = false} = {}) {
  const from = isPersonal(r) ? r.kind : 'work';
  return guarded(async current => {
    if (to === 'personal' && from === 'work' && !confirmed) {
      const ledger = await readLedgerSeen(r.id, rt); if (!current()) return;
      const text = moveToPersonalWarning({ledger, linked:!!(r.pinned_at || r.organization_id || r.project_id)});
      if (text) { state.busy = false; if (state.selected !== r.id) select(r.id); state.confirm = {id:r.id, text}; return; }
    }
    const res = await moveCall(r.id, to, rt); if (!current()) return;
    state.confirm = null;
    if (!res.ok) { state.status = moveErrorText(res.error); if (res.error !== 'REFUSED' && res.error !== 'UNAVAILABLE') await load(); return; }
    if (state.selected === r.id) closeDetail({quiet:true});
    undo = res.changed && from !== 'unsure' ? {type:'move', id:r.id, to:from} : null;
    await load(); if (!current()) return;
    state.status = res.changed ? moveDoneText(from, to) : '이미 그 통화함에 있어요.';
  }).then(() => { if (state.confirm) $('#cfDetail [data-cf-confirm-go]')?.focus({preventScroll:true}); else $('#cfList [data-cf-undo]')?.focus({preventScroll:true}); });
}
const callText = r => callCopyText({who:whoOf(r), title:r.title, dayText:dayLabel(r.day), time:hhmm(r.occurred_at), points:r.points});
const copyCall = r => copySummary(callText(r), {say, current:() => state.status});
function startLink(r) { if (state.selected !== r.id) select(r.id); state.link = newLinkBox(r); paintDetail(); $('#cfDetail [data-cf-link-pick]')?.focus({preventScroll:true}); }
function saveLink() {
  const r = rowOf(state.link?.rowId), box = state.link; if (!r || !box) return;
  box.busy = true; paintDetail();
  return guarded(async current => {
    try { const res = await saveLinkBox(r, box, rt); if (!current()) return; if (!res.saved) return void await gone(); replaceRow(res.saved); state.link = null; state.status = res.text; window.dispatchEvent(new Event('kptu:basket-links-changed')); }
    catch { if (current()) { box.busy = false; box.status = '연결하지 못했어요. 다시 시도해 주세요.'; } }
  }).then(() => $('#cfDetail [data-cf-more]')?.focus({preventScroll:true}));
}

// One menu for the detail ⋯ and for a list row (hover ⋯ / PC right-click / phone long press). A row's menu has no 조직 연결 (that needs the detail open).
const menuTarget = trigger => trigger.dataset.cfRowmore || state.selected;
const menu = createAnchoredMenu({id:'cfMenu', className:'feed-menu', label:'통화 메뉴', historyKey:'kptuCallMenu', key:t => (t.dataset.cfRowmore ? 'item:' : 'detail:') + menuTarget(t),
  render:id => {
    const r = rowOf(id.slice(id.indexOf(':') + 1)); if (!r) return '';
    const inDetail = id.startsWith('detail:'), personal = isPersonal(r);
    const copy = callText(r) ? '<button type="button" data-cf-act="copy">요약 복사</button>' : '', drive = r.drive_url ? '<button type="button" data-cf-act="drive">Drive 원본 열기</button>' : '';
    const hideBtn = '<button type="button" class="feed-menu-danger" data-cf-act="hide">지우기 <span class="feed-faint">목록에서만</span></button>';
    if (!personal) return `<button type="button" data-cf-act="pin">${r.pinned_at ? '고정 풀기' : '고정'}</button>${inDetail ? '<button type="button" data-cf-act="link">조직 연결</button>' : ''}${copy}${drive}<button type="button" data-cf-act="to-personal">개인 통화로 옮기기</button>${hideBtn}`;
    return `<button type="button" data-cf-act="to-work">업무 통화로 옮기기</button>${r.kind === 'unsure' ? '<button type="button" data-cf-act="to-personal">개인 통화로 정하기</button>' : ''}${copy}${drive}${hideBtn}`;
  },
  onAction:(button, active) => {
    const r = rowOf(active.id.slice(active.id.indexOf(':') + 1)); if (!r) return; const act = button.dataset.cfAct;
    if (act === 'pin') void pin(r); else if (act === 'hide') void hide(r); else if (act === 'copy') void copyCall(r); else if (act === 'link') startLink(r);
    else if (act === 'to-personal') void moveRow(r, 'personal'); else if (act === 'to-work') void moveRow(r, 'work');
    else if (act === 'drive' && /^https:\/\/(drive|docs)\.google\.com\//.test(r.drive_url || '')) window.open(r.drive_url, '_blank', 'noopener,noreferrer');
  },
  onClose:() => hold.unpin()});
const hold = createFeedHold({menu, itemSelector:'[data-cf-item]', moreSelector:'[data-cf-rowmore]', skipSelector:'[data-cf-decide]', busy:() => state.busy, isPhone:() => phone.matches});

function bind() {
  const root = view(); if (!root || root.dataset.cfBound) return; root.dataset.cfBound = '1';
  hold.bind(root);
  root.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.disabled || !root.contains(b)) return;
    const d = b.dataset;
    if (d.cfRow) select(d.cfRow);
    else if (d.cfRowmore) menu.open(b);
    else if (d.cfBox) setBox(d.cfBox);
    else if (d.cfDecide) { const r = rowOf(d.cfId); if (r) void moveRow(r, d.cfDecide); }
    else if (b.hasAttribute('data-cf-confirm-go')) { const r = rowOf(state.confirm?.id); if (r) void moveRow(r, 'personal', {confirmed:true}); }
    else if (b.hasAttribute('data-cf-confirm-cancel')) { state.confirm = null; paintDetail(); $('#cfDetail [data-cf-more]')?.focus({preventScroll:true}); }
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
  layer = null; boxLayer = null; state.link = null; state.confirm = null; state.box = 'work'; menu.close?.(null, true);
  window.dispatchEvent(new CustomEvent('kptu:where-item', {detail:{view:'calls', name:null}}));
});
window.addEventListener('kptu:session-changed', () => { run++; layer = null; boxLayer = null; undo = null; state = fresh(); if (view()) paint(); });
pc.addEventListener?.('change', () => { if (view() && !view().classList.contains('hidden')) { if (pc.matches) for (const l of [layer, boxLayer]) l?.close(); if (pc.matches) { layer = null; boxLayer = null; } paint(); } });
paint();
window.KPTUCallFeed = {reload:() => load()};
