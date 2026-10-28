import {waitHtml} from './wait-state.js';
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
// CALL-손고치기 (docs/design/call-user-edit.md): 제목(줄 안 바로 고치기, F2)·조직/이름(상세 박스)·핵심내용(상세 줄 고치기)을 손으로 고친다.
// 고친 값은 서버의 app_call_edits에 사용자 값으로 저장되고(DB 함수 app_call_edit) AI가 채운 칸은 그대로다. 줄은 feed-model.mjs applyCallEdit으로 사용자 값을 덧씌워 그린다.
import './enter-save.js';
import {createAnchoredMenu} from './anchored-menu.js';
import {mountSplitResize} from './split-resize.js';
import {createFeedHold} from './feed-hold.js';
import {groupByDay, hhmm, dayLabel, readPoints, speakerLines, missingTable, kstDay, splitPersonal, legacyFilteredNote, moveToPersonalWarning, moveErrorText, moveDoneText, callWho, callTopic, REFILL_PENDING, REFILL_DONE, REFILL_SKIPPED, refillFailedText,
  applyCallEdit, cleanEditVals, isEdited, splitPerson, joinPerson, cleanTitleInput, cleanPointLines, samePoints, undoPatch, patchKeys, editErrorText, EDIT_DONE, EDIT_NOOP, EDIT_LEDGER_NOTE, EDIT_NAME_MAX, EDIT_ROLE_MAX, EDIT_TITLE_MAX, EDIT_POINT_MAX, EDIT_POINTS_MAX} from './feed-model.mjs';
import {readFeed, readDays, readRaw, readOrganizations, setPinned, setHidden, scopeOf, readPersonal, readPersonalRaw, setPersonalHidden, moveCall, readLedgerSeen, refillCall, readCallEdits, editCall} from './feed-data.js';
import {callCopyText} from './summary-copy-model.mjs';
import {copyButtonHtml, copySummary} from './summary-copy.js';
import {callLedgerRecords, retireCallRecords} from './call-ledger.js';
import {esc, newLinkBox, linkBoxHtml, openOrgPicker, saveLinkBox, orgName} from './feed-link.js';

const rt = window.KPTURuntime;
const $ = sel => document.querySelector(sel);
const pc = window.matchMedia('(min-width:1024px)');
const phone = window.matchMedia('(max-width:760px)');
const MORE = '<span class="more-dots" aria-hidden="true">⋯</span>';

let state = fresh(), run = 0, layer = null, boxLayer = null, undo = null, ledgerAsk = null, loadP = null;
function fresh() { return {edits:new Map(), editMissing:false, editFail:false, edit:null, who:null, sum:null, owner:'', loaded:false, loading:false, missing:false, error:'', rows:[], prows:[], pmissing:false, pfail:false, days:[], orgs:[], mine:new Set(), box:'work', selected:null, raw:new Map(), rawOpen:false, link:null, confirm:null, status:'', busy:false}; }

function install() {
  if ($('#callsView')) return;
  $('#appView')?.insertAdjacentHTML('beforeend', `<section id="callsView" class="view-panel feed-view hidden" aria-labelledby="cfTitle"><h2 id="cfTitle" class="a11y-only">통화</h2><div class="feed-split" id="cfSplit"><div class="feed-list" id="cfList"></div><section class="feed-pane" id="cfDetail" aria-label="통화 상세"></section></div></section>`);
}
install();
const view = () => $('#callsView');
// A personal-box row (kind personal | unsure) carries box:'personal' from feed-data.js readPersonal; a work row has no such mark.
const isPersonal = r => r?.box === 'personal';
// 오른쪽 상대 표와 제목의 주제는 feed-model.mjs 한 곳의 규칙(callWho·callTopic)으로 가른다. 조직은 연결 조직(organization_id)을 우선 쓴다.
const orgOf = r => (isPersonal(r) ? null : state.orgs.find(o => o.id === r.organization_id) || null);
const whoOf = r => callWho({organization:orgOf(r), counterpart:r.counterpart, personal:isPersonal(r)}).text;
// UI-선택표시톤다운 ③: 목록 줄 오른쪽 꼬리표는 짧게 — 조직 약칭 하나(없으면 사람 이름). 전체 '조직 · 사람'은 상세 머리 줄에 그대로 있다.
const tagOf = r => { const w = callWho({organization:orgOf(r), counterpart:r.counterpart, personal:isPersonal(r)}); return w.org || w.person; };
// 손으로 고친 제목은 그대로 보인다(앞의 조직·사람을 떼는 규칙은 AI 제목에만).
const topicOf = r => (r.edited?.title ? String(r.title || '').trim() : callTopic(r.title, {organization:orgOf(r), counterpart:r.counterpart})) || '(제목 없음)';
const rowOf = id => state.rows.find(r => r.id === id) || state.prows.find(r => r.id === id) || null;
const personalRows = () => splitPersonal(state.prows).personal;
const unsureRows = () => splitPersonal(state.prows).unsure;

// ---------- data
function load() { return (loadP = loadNow()); }
async function loadNow() {
  const owner = scopeOf(rt), me = ++run; state.loading = true; if (!state.loaded) paint();
  try {
    const [rows, days, orgs, personal, edited] = await Promise.all([
      readFeed('call', rt), readDays('call', rt).catch(() => []), readOrganizations(rt).catch(() => ({orgs:[], mine:new Set()})),
      readPersonal(rt).then(prows => ({prows, pmissing:false, pfail:false}), error => ({prows:[], pmissing:missingTable(error), pfail:!missingTable(error)})),
      // 고친 값 표가 아직 없으면(DB 적용 전) 고치기만 꺼 둔다. 그 밖의 읽기 실패도 고치기를 끄고, AI 값이 보일 수 있다고 목록 위에 한 줄 알린다.
      readCallEdits(rt).then(edits => ({edits, editMissing:false, editFail:false}), error => ({edits:new Map(), editMissing:true, editFail:!missingTable(error)})),
    ]);
    if (me !== run || owner !== scopeOf(rt)) return;
    const firstLoad = !state.loaded || state.owner !== owner;
    const withEdits = r => applyCallEdit(r, edited.edits.get(r.id));
    Object.assign(state, {owner, loaded:true, loading:false, missing:false, error:'', rows:rows.map(withEdits), days, orgs:orgs.orgs, mine:orgs.mine}, personal, {prows:personal.prows.map(withEdits)}, edited);
    if (state.selected && !rowOf(state.selected)) closeDetail({quiet:true});
    // UI-선택표시톤다운 ④: PC는 오른쪽 칸을 비워 두지 않고 처음 열 때부터 맨 위 통화의 핵심내용을 보인다(고른 줄 표시와 같다). 다시 불러오기에서는 지금 고른 상태를 그대로 둔다.
    if (firstLoad && pc.matches && !state.selected) pickTop();
    window.KPTULedgerAuto?.callsOpened?.(rows);
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

// 다시 그리는 동안 일어나는 초점 잃음(blur)은 '바깥을 눌렀다'가 아니다: 제목 입력의 자동 저장이 이때는 일하지 않게 표시해 둔다.
let rendering = false;
const guardRender = fn => (...a) => { const was = rendering; rendering = true; try { return fn(...a); } finally { rendering = was; } };
const paintList = guardRender(paintListNow), paintDetail = guardRender(paintDetailNow);
// NAV-새로고침제자리: the box (?box=personal) and the open call (?call=<id>) are written to the address (no history entry of their own;
// the phone keeps its layer entries), so a reload opens the same box and call. The address is read once when this module loads and
// applied after the first list read; until then nothing is written.
let placed = (() => { const q = new URLSearchParams(globalThis.location?.search || ''); return q.get('view') === 'calls' ? {box:q.get('box') === 'personal' ? 'personal' : null, call:/^[A-Za-z0-9_.:-]{1,80}$/.test(q.get('call') || '') ? q.get('call') : null} : null; })();
function applyPlace() {
  const p = placed; if (!p || !state.loaded) return;
  placed = null;
  if (p.box === 'personal' && !state.pmissing) setBox('personal');
  const r = p.call && rowOf(p.call);
  if (r && isPersonal(r) === (state.box === 'personal')) select(p.call);
}
// ---------- paint (the only renderer of #callsView)
function paint() {
  const root = view(); if (!root) return;
  if (placed && state.loaded) { applyPlace(); paint(); return; }
  if (!placed) window.KPTURouter?.setPlace?.('calls', {box:state.box === 'personal' ? 'personal' : null, call:state.selected || null});
  const wide = pc.matches, open = !!state.selected;
  paintList(); paintDetail();
  $('#cfList').hidden = !wide && open; $('#cfDetail').hidden = !wide && !open;
  const row = rowOf(state.selected);
  window.dispatchEvent(new CustomEvent('kptu:where-item', {detail:{view:'calls', name:wide && row ? topicOf(row) : null}}));
  mountSplitResize({container:$('#cfSplit'), name:'calls', inherit:'tasks', label:'통화 목록과 상세 칸 폭 조절', list:() => $('#cfList'), pane:() => $('#cfDetail'), active:() => pc.matches && !view()?.classList.contains('hidden')});
  focusEdit();
}
// 줄 안 제목 입력칸·고치기 박스를 다시 그린 뒤에도 쓰던 칸에 초점을 돌려준다. 제목 입력칸은 처음 한 번만 전체 선택.
function focusEdit() {
  const ed = state.edit, el = ed && !ed.done ? view()?.querySelector('[data-cf-title-input]') : null;
  if (!el || document.activeElement === el) return;
  el.focus(); if (!ed.touched) { ed.touched = true; el.select(); }
}
// 맨 위 오른쪽 작은 '개인 통화함 n ›'. 개인 표가 없으면(DB 미적용) 보이지 않는다.
function boxChip() {
  if (state.pmissing) return '';
  return `<button type="button" class="feed-chip" data-cf-box="personal">개인 통화함${state.pfail ? '' : ` ${personalRows().length}`} <span aria-hidden="true">›</span></button>`;
}
const titleInputHtml = (cls = 'feed-title-input') => `<input type="text" class="${cls}" data-cf-title-input data-enter-field="off" maxlength="${EDIT_TITLE_MAX}" autocomplete="off" aria-label="통화 제목 바꾸기" value="${esc(state.edit?.value ?? '')}">`;
// 업무 · 개인: 작은 글자 버튼 둘(CALL-손고치기 3). 누르는 범위 44px은 .feed-text-btn의 ::after.
const decideHtml = id => `<span class="feed-ask-btns feed-decide-btns"><button type="button" class="feed-text-btn" data-cf-decide="work" data-cf-id="${esc(id)}"${state.busy ? ' disabled' : ''}>업무</button><span class="feed-faint" aria-hidden="true">·</span><button type="button" class="feed-text-btn" data-cf-decide="personal" data-cf-id="${esc(id)}"${state.busy ? ' disabled' : ''}>개인</button></span>`;
function rowHtml(r, {ask = false} = {}) {
  if (!ask && state.edit?.id === r.id && state.edit.where === 'list') return `<div class="feed-callrow feed-editing" data-cf-item="${esc(r.id)}"><div class="feed-call is-selected"><span class="feed-time">${esc(hhmm(r.occurred_at))}</span>${titleInputHtml()}</div></div>`;
  const on = r.id === state.selected, org = ask ? '' : tagOf(r);
  const badge = r.kind === 'unsure' && !ask ? '<span class="feed-badge">애매</span> ' : '';
  const open = `<button type="button" class="feed-call${on ? ' is-selected' : ''}" data-cf-row="${esc(r.id)}"${on ? ' aria-current="true"' : ''}><span class="feed-time">${esc(hhmm(r.occurred_at))}</span><span class="feed-title">${r.pinned_at ? '<span class="feed-pin" aria-label="고정">고정</span>' : ''}${badge}${esc(ask ? r.title || '(제목 없음)' : topicOf(r))}</span>${org ? `<span class="feed-org">${esc(org)}</span>` : ''}</button>`;
  if (ask) return `<div class="feed-callrow feed-ask" data-cf-item="${esc(r.id)}">${open}${decideHtml(r.id)}</div>`;
  return `<div class="feed-callrow" data-cf-item="${esc(r.id)}">${open}<button type="button" class="feed-hov" data-cf-rowmore="${esc(r.id)}" aria-haspopup="true" aria-expanded="false" aria-label="통화 메뉴">${MORE}</button></div>`;
}
const listHtml = (rows, emptyHtml) => {
  const groups = groupByDay(rows);
  return groups.length ? groups.map(g => `<div class="feed-day" data-cf-day="${esc(g.day)}">${esc(g.label)}</div>${g.items.map(r => rowHtml(r)).join('')}`).join('') : emptyHtml;
};
function paintListNow() {
  const box = $('#cfList');
  const personalBox = state.box === 'personal';
  const head = personalBox
    ? `<div class="feed-head"><button type="button" class="back-text" data-cf-box="work">‹ 업무 통화</button><span class="feed-head-title">개인 통화함</span><span class="feed-head-sub" data-cf-pcount>${state.pfail ? '' : `${personalRows().length}건`}</span></div>`
    : `<div class="feed-head"><span class="feed-head-sub"></span>${state.loaded && !state.missing && !state.error ? boxChip() : ''}</div>`;
  if (!state.loaded) { box.innerHTML = head + waitHtml({rows:6, h:34}); return; }
  if (state.missing) { box.innerHTML = head + '<p class="feed-empty" data-cf-empty="ready">준비 중이에요. 통화 수집이 연결되면 여기에 보여요.</p>'; return; }
  if (state.error) { box.innerHTML = head + `<p class="feed-empty" role="status">${esc(state.error)} <button type="button" class="feed-text-btn" data-cf-retry>다시 시도</button></p>`; return; }
  const status = `<p class="feed-status" data-cf-status role="status">${statusHtml()}</p>`;
  const editFail = state.editFail ? `<p class="feed-note" data-cf-editfail role="status">고친 값을 불러오지 못해 AI가 채운 값이 보일 수 있어요. <button type="button" class="feed-text-btn" data-cf-retry>다시 시도</button></p>` : '';
  if (personalBox) {
    if (state.pfail) { box.innerHTML = head + `<p class="feed-empty" role="status">개인 통화함을 불러오지 못했어요. <button type="button" class="feed-text-btn" data-cf-retry>다시 시도</button></p>${status}`; return; }
    const legacy = legacyFilteredNote(state.days, kstDay());
    box.innerHTML = head + editFail + `<p class="feed-note" data-cf-note>업무 기록(원장·주간보고·챙길 것·업무일지)에 쓰이지 않고, 전체 검색에도 나오지 않아요.</p>${legacy ? `<p class="feed-note" data-cf-legacy>${esc(legacy)}</p>` : ''}<div class="feed-rows">${listHtml(personalRows(), '<p class="feed-empty" data-cf-empty="personal">개인 통화함이 비어 있어요.</p>')}</div>${status}`;
    return;
  }
  const ask = unsureRows();
  const askHtml = ask.length ? `<div class="feed-ask-head" data-cf-ask-head>확인할 통화 ${ask.length} <span class="feed-faint">· 정하기 전에는 업무 기록에 쓰이지 않아요</span></div><div class="feed-rows feed-ask-rows">${ask.map(r => rowHtml(r, {ask:true})).join('')}</div>` : '';
  box.innerHTML = head + editFail + askHtml + `<div class="feed-rows">${listHtml(state.rows, '<p class="feed-empty" data-cf-empty="none">아직 받은 업무 통화가 없어요.</p>')}</div>${status}`;
}
const statusHtml = () => esc(state.status) + (undo ? `${undo.type === 'edit' ? ' ·' : ''} <button type="button" class="feed-text-btn" data-cf-undo>되돌리기</button>` : '')
  + (ledgerAsk?.total ? ` <span class="feed-faint">이 통화에서 원장에 들어간 기록 ${ledgerAsk.total}개는 남아요${ledgerAsk.ledgerIds.length ? ' ·' : ''}</span>${ledgerAsk.ledgerIds.length ? ' <button type="button" class="feed-text-btn" data-cf-ledger-retire>원장에서도 틀림으로</button>' : ''}` : '');
function paintDetailNow() {
  const box = $('#cfDetail'), back = pc.matches ? '' : '<button type="button" class="back-text" data-cf-back>‹ 통화</button>';
  const r = rowOf(state.selected);
  if (!r) { box.innerHTML = '<p class="feed-empty feed-pane-empty">왼쪽에서 통화를 고르면 핵심내용이 보여요.</p>'; return; }
  const personal = isPersonal(r), unsure = r.kind === 'unsure';
  const who = whoOf(r);
  const points = readPoints(r.points);
  const pencil = state.editMissing ? '' : `<button type="button" class="feed-mini-edit" data-cf-sum-open aria-label="핵심내용 고치기" title="핵심내용 고치기"${state.busy ? ' disabled' : ''}><span aria-hidden="true">✎</span></button>`;
  const pointsHtml = state.sum?.rowId === r.id ? sumBoxHtml(r) : points.length ? `<div class="feed-k-row"><p class="feed-k">핵심내용${r.edited?.points ? ' <span class="feed-faint">· 고친 값</span>' : ''}</p><span class="feed-k-tools">${pencil}${copyButtonHtml('data-cf-copy')}</span></div><ul class="feed-points" data-cf-points>${points.map(p => `<li>${esc(p.text)}${p.tag ? `<span class="feed-tag feed-tag-${p.kind}">${esc(p.tag)}</span>` : ''}</li>`).join('')}</ul>` : `<p class="feed-faint">핵심내용이 없어요.${r.edited?.points || state.editMissing ? '' : ' <button type="button" class="feed-text-btn" data-cf-sum-open>직접 쓰기</button>'}</p>`;
  const raw = state.raw.get(r.id);
  let script;
  if (!raw || raw.loading) script = waitHtml({rows:3});
  else if (raw.error) script = '<p class="feed-faint">전문을 불러오지 못했어요.</p>';
  else if (!raw.raw_text) script = '<p class="feed-faint" data-cf-raw-empty>Web2에 남은 전문이 없어요. 원본은 Drive에 있어요.</p>';
  else if (raw.speaker_split) script = `<div class="feed-script" data-cf-script="lines">${speakerLines(raw.raw_text).map(l => `<p class="${l.me ? 'is-me' : ''}"><b>${esc(l.who)}</b><span>${esc(l.text)}</span></p>`).join('')}</div>`;
  else script = `<div class="feed-script feed-script-one" data-cf-script="one">${esc(raw.raw_text)}</div>`;
  const badge = raw && raw.raw_text && !raw.speaker_split ? '<span class="feed-badge">화자 구분은 전사 수정 뒤</span>' : '';
  const full = `<details class="feed-full" data-cf-full${state.rawOpen ? ' open' : ''}><summary>${state.rawOpen ? '전문 접기' : '전문 펼치기'} <span class="feed-ar" aria-hidden="true">▾</span>${badge}</summary>${script}</details>`;
  const link = !personal && state.link?.rowId === r.id ? linkBoxHtml(state.link, state.orgs, 'cf') : '';
  const confirm = state.confirm?.id === r.id ? `<div class="feed-warn" data-cf-confirm role="alert"><p>${esc(state.confirm.text)}</p><div class="feed-link-actions"><button type="button" class="feed-small" data-cf-confirm-go>개인 통화로 옮기기</button><button type="button" class="feed-small" data-cf-confirm-cancel>취소</button></div></div>` : '';
  const decide = unsure ? `<div class="feed-decide" data-cf-decide-bar><span class="feed-faint">업무 통화인지 개인 통화인지 정해 주세요</span>${decideHtml(r.id)}</div>` : '';
  // UI-더보기제목줄: ⋯는 빈 줄을 따로 차지하지 않고 상세 첫 줄(폰은 제목, PC는 날짜·시간 줄) 오른쪽 끝에 둔다(공용 .kptu-title-line, base-ui.css).
  const more = `<button type="button" class="feed-more" data-cf-more data-ctx="area" aria-haspopup="true" aria-expanded="false" aria-label="통화 메뉴"${state.busy ? ' disabled' : ''}>${MORE}</button>`;
  // 조직·이름 표(날짜·시간 뒤의 상대)를 누르면 그 자리에서 고친다. 고친 값이 있으면 작게 '고침'을 붙인다.
  const whoBtn = who ? (state.editMissing ? esc(who) : `<button type="button" class="feed-whoname" data-cf-who-open aria-label="조직·이름 고치기">${esc(who)}</button>`) : '';
  const tail = `${r.pinned_at ? ' · 고정' : ''}${unsure ? ' · 애매' : personal ? ' · 개인' : ''}${r.edited?.counterpart || r.edited?.organization_id ? ' · 고침' : ''}`;
  const metaHtml = `${esc([dayLabel(r.day), hhmm(r.occurred_at)].filter(Boolean).join(' · '))}${whoBtn ? ' · ' + whoBtn : ''}${esc(tail)}`;
  const titleHtml = state.edit?.id === r.id && state.edit.where === 'detail' ? titleInputHtml('feed-title-input feed-detail-title-input') : `<h3 class="feed-detail-title" data-cf-title>${esc(topicOf(r))}</h3>`;
  const first = pc.matches
    ? `<div class="kptu-title-line"><p class="feed-meta" data-cf-meta>${metaHtml}</p>${more}</div>`
    : `<div class="kptu-title-line">${titleHtml}${more}</div><p class="feed-meta" data-cf-meta>${metaHtml}</p>`;
  const whoBox = state.who?.rowId === r.id ? whoBoxHtml(r) : '';
  box.innerHTML = `${back ? `<div class="feed-detail-head">${back}</div>` : ''}
<div class="feed-detail" data-cf-detail="${esc(r.id)}" data-cf-box-of="${personal ? 'personal' : 'work'}">${first}${confirm}${decide}${link}${whoBox}${pointsHtml}${full}<p class="feed-status" data-cf-detail-status role="status">${statusHtml()}</p></div>`;
}

// 조직·이름 고치기 박스. 조직은 기존 담당조직 선택 창(feed-link.js)에서 고르고, 이름·직함은 직접 쓴다. 개인 통화에는 조직 칸이 없다.
function newWhoBox(r) {
  const p = splitPerson(callWho({organization:orgOf(r), counterpart:r.counterpart, personal:isPersonal(r)}).person);
  return {rowId:r.id, orgId:isPersonal(r) ? '' : r.organization_id || '', name:p.name, role:p.role, start:{orgId:isPersonal(r) ? '' : r.organization_id || '', person:joinPerson(p.name, p.role)}, busy:false, status:''};
}
function whoBoxHtml(r) {
  const b = state.who, personal = isPersonal(r);
  const orgRow = personal ? '' : `<div class="feed-link-row"><span class="feed-link-label">조직</span><button type="button" class="feed-small" data-cf-who-pick aria-haspopup="dialog" aria-expanded="false"${b.busy ? ' disabled' : ''}>${esc(b.orgId ? orgName(state.orgs, b.orgId) || '고른 조직' : '조직 고르기')} ▾</button></div>`;
  const reset = (r.edited?.counterpart || r.edited?.organization_id) ? `<button type="button" class="feed-text-btn" data-cf-who-reset${b.busy ? ' disabled' : ''}>AI 값으로</button>` : '';
  return `<div class="feed-link feed-who-box" data-cf-who-box data-enter-save="[data-cf-who-save]">
${orgRow}<div class="feed-link-row"><label class="feed-link-label" for="cfWhoName">이름</label><input id="cfWhoName" type="text" class="feed-edit-input" data-cf-who-name maxlength="${EDIT_NAME_MAX}" autocomplete="off" value="${esc(b.name)}"${b.busy ? ' disabled' : ''}><label class="feed-link-label" for="cfWhoRole">직함</label><input id="cfWhoRole" type="text" class="feed-edit-input" data-cf-who-role maxlength="${EDIT_ROLE_MAX}" autocomplete="off" value="${esc(b.role)}"${b.busy ? ' disabled' : ''}></div>
<div class="feed-link-actions"><span class="feed-status" role="status">${esc(b.status)}</span>${reset}<button type="button" class="feed-small" data-cf-who-cancel${b.busy ? ' disabled' : ''}>취소</button><button type="button" class="feed-small primary" data-cf-who-save data-enter-save-submit${b.busy ? ' disabled' : ''}>저장</button></div>
</div>`;
}
// 핵심내용 고치기 박스: 줄마다 고치기·지우기, 줄 더하기. 줄 안 [확정]·[예정]·[확인] 머리말도 글자 그대로 고칠 수 있다.
function newSumBox(r) { return {rowId:r.id, lines:(Array.isArray(r.points) ? r.points : []).filter(p => typeof p === 'string'), start:cleanPointLines(Array.isArray(r.points) ? r.points : []), busy:false, status:'', focus:null}; }
function sumBoxHtml(r) {
  const b = state.sum, full = b.lines.length >= EDIT_POINTS_MAX;
  const items = b.lines.map((l, i) => `<li class="feed-sumedit-line"><input type="text" class="feed-edit-input" data-cf-sum-line="${i}" data-enter-field="off" maxlength="${EDIT_POINT_MAX}" autocomplete="off" aria-label="핵심내용 ${i + 1}번째 줄" value="${esc(l)}"${b.busy ? ' disabled' : ''}><button type="button" class="feed-text-btn" data-cf-sum-del="${i}" aria-label="${i + 1}번째 줄 지우기"${b.busy ? ' disabled' : ''}>지우기</button></li>`).join('');
  const reset = r.edited?.points ? `<button type="button" class="feed-text-btn" data-cf-sum-reset${b.busy ? ' disabled' : ''}>AI 값으로</button>` : '';
  return `<div class="feed-sumedit" data-cf-sum><p class="feed-k">핵심내용 고치기 <span class="feed-faint">· 줄마다 고치고, 비운 줄은 저장할 때 빠져요</span></p>
<ul class="feed-sumedit-lines">${items}</ul>
<div class="feed-link-actions"><button type="button" class="feed-text-btn" data-cf-sum-add${b.busy || full ? ' disabled' : ''}>+ 줄 더하기</button><span class="feed-status" role="status">${esc(b.status)}</span>${reset}<button type="button" class="feed-small" data-cf-sum-cancel${b.busy ? ' disabled' : ''}>취소</button><button type="button" class="feed-small primary" data-cf-sum-save${b.busy ? ' disabled' : ''}>저장</button></div>
</div>`;
}

// ---------- actions
function openLayer() {
  if (!pc.matches) layer ||= window.KPTURouter?.layer?.open('call-detail', {close:() => { layer = null; closeDetail({fromBack:true}); return true; }}) || null;
}
function select(id) {
  if (!dropBoxes()) return;
  state.selected = id; state.rawOpen = false; state.status = ''; undo = null; state.confirm = null; ledgerAsk = null;
  openLayer(); paint(); void loadRaw(id);
  (pc.matches ? $(`#cfList [data-cf-row="${CSS.escape(id)}"]`) : $('#cfDetail [data-cf-back]'))?.focus({preventScroll:true});
}
// 지금 통화함 목록의 맨 위 통화(날짜별 목록의 첫 줄, 없으면 확인할 통화의 첫 줄)를 고른 상태로 둔다. 그리기는 부르는 쪽 paint() 한 번.
function pickTop() {
  const top = state.box === 'personal' ? groupByDay(personalRows())[0]?.items[0] : groupByDay(state.rows)[0]?.items[0] || unsureRows()[0];
  if (!top) return;
  state.selected = top.id; void loadRaw(top.id);
}
function closeDetail({fromBack = false, quiet = false} = {}) {
  const id = state.selected;
  state.selected = null; state.link = null; state.who = null; state.sum = null; state.edit = null; state.rawOpen = false; state.confirm = null;
  const l = layer; layer = null; if (!fromBack) l?.close();
  if (quiet) return;
  paint();
  $(`#cfList [data-cf-row="${CSS.escape(id || '')}"]`)?.focus({preventScroll:true});
}
// 업무 통화함 ⇄ 개인 통화함. 폰은 개인 통화함을 router layer 한 칸으로 열어 뒤로가기 한 번이 '‹ 업무 통화'다.
function setBox(next, {fromBack = false} = {}) {
  if (state.box === next) return;
  if (!dropBoxes()) return;
  if (state.selected) closeDetail({quiet:true});
  state.box = next; state.confirm = null; state.status = ''; undo = null;
  if (next === 'personal') { if (!pc.matches) boxLayer ||= window.KPTURouter?.layer?.open('call-box', {close:() => { boxLayer = null; setBox('work', {fromBack:true}); return true; }}) || null; }
  else { const l = boxLayer; boxLayer = null; if (!fromBack) l?.close(); }
  if (pc.matches) pickTop();
  paint();
  $(next === 'personal' ? '#cfList [data-cf-box="work"]' : '#cfList [data-cf-box="personal"]')?.focus({preventScroll:true});
}
// 열려 있는 고치기 박스(조직 연결·조직/이름·핵심내용)를 닫는다. 쓰던 내용이 있으면 한 번 묻는다. false면 닫지 않는다.
function dropBoxes() {
  if (state.link && !dropLink()) return false;
  const dirtyWho = state.who && (state.who.busy || state.who.orgId !== state.who.start.orgId || joinPerson(state.who.name, state.who.role) !== state.who.start.person);
  const dirtySum = state.sum && (state.sum.busy || !samePoints(cleanPointLines(state.sum.lines), state.sum.start));
  if ((dirtyWho || dirtySum) && !window.confirm('쓰던 내용을 버릴까요?')) return false;
  state.who = null; state.sum = null; return true;
}
function dropLink() { const r = rowOf(state.link?.rowId), changed = state.link && r && state.link.summary.trim() !== newLinkBox(r).summary.trim(); if (changed && !window.confirm('쓰던 요약을 버릴까요?')) return false; state.link = null; return true; }
const say = text => { state.status = text; for (const el of view()?.querySelectorAll('[data-cf-status],[data-cf-detail-status]') || []) el.innerHTML = statusHtml(); };
// 서버에서 새로 읽은 줄(AI 값)을 넣을 때도 손으로 고친 값을 다시 덧씌운다.
const rebase = (r, saved) => applyCallEdit({...r, ...saved, _ai:undefined}, state.edits.get(r.id));
const replaceRow = saved => { state.rows = state.rows.map(r => r.id === saved.id ? rebase(r, saved) : r); };

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
      // 원장에 이미 들어간 기록 수(읽기만, 업무 통화만). 못 읽어도 지우기는 그대로 한다. 개인 통화는 원장 재료가 아니다.
      const found = isPersonal(r) ? null : await callLedgerRecords(r.id, rt).catch(() => null);
      if (!current()) return;
      const saved = await (isPersonal(r) ? setPersonalHidden(r.id, true, rt) : setHidden(r.id, true, rt)); if (!current()) return; if (!saved) return void await gone();
      dropFromList(r); if (state.selected === r.id) closeDetail({quiet:true});
      undo = {type:'hide', id:r.id, row:{...r, hidden_at:null}}; state.status = '목록에서 지웠어요. 원본은 Drive에 있어요.';
      ledgerAsk = found && found.total ? {...found} : null;
    } catch { if (current()) state.status = '지우지 못했어요. 다시 시도해 주세요.'; }
  }).then(() => $('#cfList [data-cf-undo]')?.focus({preventScroll:true}));
}
function retireLedger() {
  const ask = ledgerAsk; if (!ask?.ledgerIds.length) return; ledgerAsk = null;
  return guarded(async current => {
    try {
      const n = await retireCallRecords(ask.ledgerIds, rt); if (!current()) return;
      const kept = ask.total - n;
      state.status = `원장에서 ${n}개를 틀린 기록으로 표시했어요.${kept > 0 ? ` 다른 근거가 있는 ${kept}개는 그대로 뒀어요.` : ''} 되돌리기는 원장의 수정 요청에서 해요.`;
    } catch { if (current()) { ledgerAsk = ask; state.status = '원장에서 표시하지 못했어요. 다시 시도해 주세요.'; } }
  });
}
function restore() {
  const u = undo; if (!u) return; undo = null; ledgerAsk = null;
  return guarded(async current => {
    if (u.type === 'edit') {
      const res = await editCall(u.id, undoPatch(u.prev, u.keys), rt); if (!current()) return;
      if (!res.ok) { state.status = editErrorText(res.error); if (res.error === 'GONE') await load(); return; }
      applyEditVals(u.id, res.vals); state.status = EDIT_DONE.undo; return;
    }
    if (u.type === 'move') {
      const res = await moveCall(u.id, u.to, rt); if (!current()) return;
      state.status = res.ok ? '되돌렸어요.' : moveErrorText(res.error);
      await load(); return;
    }
    try {
      const personal = isPersonal(u.row), saved = await (personal ? setPersonalHidden(u.id, false, rt) : setHidden(u.id, false, rt)); if (!current()) return;
      if (saved) { if (personal) state.prows = [...state.prows, rebase(u.row, saved)]; else state.rows = [...state.rows, rebase(u.row, saved)]; state.status = '되돌렸어요.'; } else state.status = '되돌리지 못했어요.';
    } catch { if (current()) state.status = '되돌리지 못했어요. 다시 시도해 주세요.'; }
  });
}
// 옮기기: one DB function moves the call (and nothing else changes). 업무→개인은 원장에 이미 쓰였거나 고정·조직 연결이 있으면
// 먼저 한 줄로 알리고 [개인 통화로 옮기기]를 한 번 더 누르게 한다(원장 기록은 지워지지 않는다).
function moveRow(r, to, {confirmed = false} = {}) {
  const from = isPersonal(r) ? r.kind : 'work';
  let refillId = null;
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
    if (to === 'work' && res.changed && res.needsRefill) { refillId = r.id; state.status = REFILL_PENDING; }
  }).then(() => { if (refillId) void refillMoved(refillId); }).then(() => { if (state.confirm) $('#cfDetail [data-cf-confirm-go]')?.focus({preventScroll:true}); else $('#cfList [data-cf-undo]')?.focus({preventScroll:true}); });
}
// 옮긴 직후 AI 다시 채우기(CALL-개인통화함 4단계). 화면을 막지 않고 따로 돈다. 실패하면 조용히 옛 값을 두고 한 줄만 알린다.
// 그사이 다른 동작이 안내 줄을 바꿨으면 그 줄은 덮어쓰지 않는다.
async function refillMoved(id) {
  const owner = scopeOf(rt), mine = state.status, current = () => owner === scopeOf(rt);
  const res = await refillCall(id, rt).catch(() => ({ok:false, code:'internal_error'})); if (!current()) return;
  const note = text => { if (state.status === mine) say(text); };
  if (!res.ok) return void note(refillFailedText(res.code));
  if (res.skipped) return void note(REFILL_SKIPPED);
  const before = state.status; await load(); if (!current()) return;
  state.status = before === mine ? REFILL_DONE : before; paint();
}
const callText = r => callCopyText({who:whoOf(r), title:topicOf(r), dayText:dayLabel(r.day), time:hhmm(r.occurred_at), points:r.points});
const copyCall = (r, button = null) => copySummary(callText(r), {say, current:() => state.status, button});
function startLink(r) { if (state.selected !== r.id) select(r.id); state.link = newLinkBox(r); paintDetail(); $('#cfDetail [data-cf-link-pick]')?.focus({preventScroll:true}); }
function saveLink() {
  const r = rowOf(state.link?.rowId), box = state.link; if (!r || !box) return;
  box.busy = true; paintDetail();
  return guarded(async current => {
    try {
      const res = await saveLinkBox(r, box, rt); if (!current()) return; if (!res.saved) return void await gone();
      // 조직을 손으로 고친 적이 있으면 그 사용자 값이 화면에서 앞서므로 같은 조직으로 맞춘다(안 맞추면 방금 연결한 조직이 안 보인다).
      if (state.edits.get(r.id) && Object.hasOwn(state.edits.get(r.id), 'organization_id')) {
        const synced = await editCall(r.id, {organization_id:box.orgId || null}, rt); if (!current()) return;
        if (synced.ok) applyEditVals(r.id, synced.vals);
      }
      replaceRow(res.saved); state.link = null; state.status = res.text; window.dispatchEvent(new Event('kptu:basket-links-changed')); }
    catch { if (current()) { box.busy = false; box.status = '연결하지 못했어요. 다시 시도해 주세요.'; } }
  }).then(() => $('#cfDetail [data-cf-more]')?.focus({preventScroll:true}));
}

// ---------- CALL-손고치기: 사용자 값 저장·되돌리기 (서버는 DB 함수 app_call_edit 하나)
// 서버가 돌려준 사용자 값을 화면에 반영한다. 비어 있으면 AI 값으로 돌아간 것.
function applyEditVals(id, vals) {
  const clean = cleanEditVals(vals);
  if (Object.keys(clean).length) state.edits.set(id, clean); else state.edits.delete(id);
  state.rows = state.rows.map(r => r.id === id ? applyCallEdit(r, clean) : r);
  state.prows = state.prows.map(r => r.id === id ? applyCallEdit(r, clean) : r);
}
// 한 번의 고치기. patch는 서버 패치(title·counterpart·organization_id·points·reset). 성공하면 true.
// 되돌리기 줄은 고치기 전 사용자 값(prev)으로 만든다. 업무 통화를 고쳤고 이미 원장에 읽혔으면 한 줄로만 알린다(원장은 손대지 않는다).
function saveEdit(r, patch, doneText) {
  const keys = patchKeys(patch), before = state.edits.get(r.id) || {}, prev = Object.fromEntries(keys.map(k => [k, Object.hasOwn(before, k) ? before[k] : undefined]));
  let ok = false;
  return guarded(async current => {
    try {
      const res = await editCall(r.id, patch, rt); if (!current()) return;
      if (!res.ok) { state.status = editErrorText(res.error); undo = null; if (res.error === 'GONE' || res.error === 'UNKNOWN') await load(); return; }
      ok = true; applyEditVals(r.id, res.vals);
      undo = res.changed ? {type:'edit', id:r.id, prev, keys} : null;
      state.status = res.changed ? doneText : EDIT_NOOP;
      if (res.changed && !isPersonal(r) && await readLedgerSeen(r.id, rt) === true && current()) state.status += ' ' + EDIT_LEDGER_NOTE;
    } catch { if (current()) state.status = editErrorText('UNKNOWN'); }
  }).then(() => ok);
}
// 1) 제목: 줄 안(폰 상세는 상세 제목)이 바로 입력칸. Enter·바깥 누르기 = 저장, Esc = 취소.
function startTitle(r, hint = 'list') {
  if (!r || state.editMissing || state.busy || state.edit || !dropBoxes()) return;
  const where = pc.matches ? 'list' : hint === 'detail' ? 'detail' : 'list', value = topicOf(r);
  state.edit = {id:r.id, where, value, start:value, touched:false, done:false};
  paint();
}
// 제목 입력을 마칠 때는 그 줄(폰 상세는 상세)만 다시 그린다. 목록 전체를 다시 그리면 다른 줄을 누르던 중인 눌림이 끊긴다.
function repaintTitle(id, where) {
  const r = rowOf(id);
  if (where === 'list' && r) { const el = $(`#cfList [data-cf-item="${CSS.escape(id)}"]`); if (el) { const t = document.createElement('template'); t.innerHTML = rowHtml(r); el.replaceWith(t.content.firstElementChild); return; } }
  paint();
}
function finishTitle() { const ed = state.edit; if (ed) ed.done = true; state.edit = null; }
function cancelTitle() {
  const ed = state.edit; if (!ed || ed.done) return; const id = ed.id;
  finishTitle(); repaintTitle(id, ed.where);
  (pc.matches ? $(`#cfList [data-cf-row="${CSS.escape(id)}"]`) : $('#cfDetail [data-cf-more]'))?.focus({preventScroll:true});
}
async function commitTitle({refocus = true} = {}) {
  const ed = state.edit; if (!ed || ed.done) return;
  const input = view()?.querySelector('[data-cf-title-input]'), value = cleanTitleInput(input ? input.value : ed.value), r = rowOf(ed.id), id = ed.id;
  finishTitle();
  if (!r) return void paint();
  if (!value) { say('제목은 비울 수 없어서 그대로 뒀어요.'); undo = null; repaintTitle(id, ed.where); }
  else if (value === ed.start) repaintTitle(id, ed.where);
  else { repaintTitle(id, ed.where); await saveEdit(r, {title:value}, EDIT_DONE.title); }
  if (refocus) (pc.matches ? $(`#cfList [data-cf-row="${CSS.escape(id)}"]`) : $('#cfDetail [data-cf-more]'))?.focus({preventScroll:true});
}
// 2) 조직·이름: 상세 안 작은 박스. 조직은 기존 담당조직 목록에서 고르고 이름·직함은 직접 쓴다.
function startWho(r) {
  if (!r || state.editMissing || state.busy) return;
  if (state.selected !== r.id) select(r.id); else if (!dropBoxes()) return;
  if (state.selected !== r.id) return;
  state.who = newWhoBox(r); paintDetail(); $('#cfDetail [data-cf-who-name]')?.focus({preventScroll:true});
}
function saveWho() {
  const box = state.who, r = rowOf(box?.rowId); if (!r || box.busy) return;
  const person = joinPerson(box.name, box.role), orgChanged = !isPersonal(r) && box.orgId !== box.start.orgId, personChanged = person !== box.start.person, patch = {};
  if (!orgChanged && !personChanged) { state.who = null; state.status = EDIT_NOOP; undo = null; paintDetail(); return; }
  // 조직을 바꾸면 상대 표기에서도 옛 조직 이름이 빠지도록 이름·직함만 남긴 값을 함께 저장한다.
  patch.counterpart = person;
  if (orgChanged) patch.organization_id = box.orgId || null;
  box.busy = true; paintDetail();
  return saveEdit(r, patch, EDIT_DONE.who).then(ok => { if (ok) state.who = null; else if (state.who === box) box.busy = false; paintDetail(); $('#cfDetail [data-cf-who-open]')?.focus({preventScroll:true}); });
}
function resetEdit(r, fields, box) {
  if (box) box.busy = true; paintDetail();
  return saveEdit(r, {reset:fields}, EDIT_DONE.reset).then(ok => { if (ok) { state.who = null; state.sum = null; } else if (box) box.busy = false; paintDetail(); });
}
// 3) 핵심내용: 상세에서 줄마다 고치기·지우기·더하기.
function startSum(r) {
  if (!r || state.editMissing || state.busy) return;
  if (state.selected !== r.id) select(r.id); else if (!dropBoxes()) return;
  if (state.selected !== r.id) return;
  state.sum = newSumBox(r); if (!state.sum.lines.length) state.sum.lines.push('');
  state.sum.focus = 0; paintDetail(); focusSum();
}
function focusSum() { const b = state.sum; if (!b || b.focus == null) return; const el = $(`#cfDetail [data-cf-sum-line="${b.focus}"]`); b.focus = null; el?.focus({preventScroll:true}); }
function saveSum() {
  const box = state.sum, r = rowOf(box?.rowId); if (!r || box.busy) return;
  const lines = cleanPointLines(box.lines);
  if (samePoints(lines, box.start) && !(r.edited?.points)) { state.sum = null; state.status = EDIT_NOOP; undo = null; paintDetail(); return; }
  box.busy = true; paintDetail();
  return saveEdit(r, {points:lines}, EDIT_DONE.points).then(ok => { if (ok) state.sum = null; else if (state.sum === box) box.busy = false; paintDetail(); $('#cfDetail [data-cf-more]')?.focus({preventScroll:true}); });
}

// One menu for the detail ⋯ and for a list row (hover ⋯ / PC right-click / phone long press). A row's menu has no 조직 연결 (that needs the detail open).
const menuTarget = trigger => trigger.dataset.cfRowmore || state.selected;
const menu = createAnchoredMenu({id:'cfMenu', className:'feed-menu', label:'통화 메뉴', historyKey:'kptuCallMenu', key:t => (t.dataset.cfRowmore ? 'item:' : 'detail:') + menuTarget(t),
  render:id => {
    const r = rowOf(id.slice(id.indexOf(':') + 1)); if (!r) return '';
    const inDetail = id.startsWith('detail:'), personal = isPersonal(r);
    const copy = callText(r) ? '<button type="button" data-cf-act="copy">요약 복사</button>' : '', drive = r.drive_url ? '<button type="button" data-cf-act="drive">Drive 원본 열기</button>' : '';
    const hideBtn = '<button type="button" class="feed-menu-danger" data-cf-act="hide">지우기 <span class="feed-faint">목록에서만</span></button>';
    // CALL-손고치기: 고치기 항목은 맨 위(제목 바꾸기 · 조직·이름 · 요약). 고친 값 표가 아직 없으면(DB 적용 전) 보이지 않는다.
    const edit = state.editMissing ? '' : `<button type="button" data-cf-act="title">제목 바꾸기${pc.matches ? ' <span class="feed-faint">F2</span>' : ''}</button><button type="button" data-cf-act="who">${personal ? '이름 고치기' : '조직·이름 고치기'}</button><button type="button" data-cf-act="sum">요약 고치기</button>`;
    if (!personal) return `${edit}<button type="button" data-cf-act="pin">${r.pinned_at ? '고정 풀기' : '고정'}</button>${inDetail ? '<button type="button" data-cf-act="link">조직 연결</button>' : ''}${copy}${drive}<button type="button" data-cf-act="to-personal">개인 통화로 옮기기</button>${hideBtn}`;
    return `${edit}<button type="button" data-cf-act="to-work">업무 통화로 옮기기</button>${r.kind === 'unsure' ? '<button type="button" data-cf-act="to-personal">개인 통화로 정하기</button>' : ''}${copy}${drive}${hideBtn}`;
  },
  onAction:(button, active) => {
    const r = rowOf(active.id.slice(active.id.indexOf(':') + 1)); if (!r) return; const act = button.dataset.cfAct;
    if (act === 'title') startTitle(r, active.id.startsWith('detail:') ? 'detail' : 'list'); else if (act === 'who') startWho(r); else if (act === 'sum') startSum(r);
    else if (act === 'pin') void pin(r); else if (act === 'hide') void hide(r); else if (act === 'copy') void copyCall(r); else if (act === 'link') startLink(r);
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
    else if (b.hasAttribute('data-cf-copy')) { const r = rowOf(state.selected); if (r) void copyCall(r, b); }
    else if (b.hasAttribute('data-cf-retry')) void load();
    else if (b.hasAttribute('data-cf-undo')) void restore();
    else if (b.hasAttribute('data-cf-ledger-retire')) void retireLedger();
    else if (b.hasAttribute('data-cf-more')) menu.open(b);
    else if (b.hasAttribute('data-cf-link-pick')) { const box = state.link; if (box) void openOrgPicker(b, {orgs:state.orgs, mine:state.mine, selected:box.orgId, onPick:id => { box.orgId = id; paintDetail(); $('#cfDetail [data-cf-link-pick]')?.focus({preventScroll:true}); }}); }
    else if (b.hasAttribute('data-cf-link-cancel')) { state.link = null; paintDetail(); $('#cfDetail [data-cf-more]')?.focus({preventScroll:true}); }
    else if (b.hasAttribute('data-cf-link-save')) void saveLink();
    else if (b.hasAttribute('data-cf-who-open')) { const r = rowOf(state.selected); if (r) startWho(r); }
    else if (b.hasAttribute('data-cf-who-pick')) { const box = state.who; if (box) void openOrgPicker(b, {orgs:state.orgs, mine:state.mine, selected:box.orgId, onPick:id => { box.orgId = id; paintDetail(); $('#cfDetail [data-cf-who-pick]')?.focus({preventScroll:true}); }}); }
    else if (b.hasAttribute('data-cf-who-cancel')) { state.who = null; paintDetail(); $('#cfDetail [data-cf-who-open]')?.focus({preventScroll:true}); }
    else if (b.hasAttribute('data-cf-who-save')) void saveWho();
    else if (b.hasAttribute('data-cf-who-reset')) { const r = rowOf(state.who?.rowId); if (r) void resetEdit(r, ['counterpart', 'organization_id'].filter(k => r.edited?.[k]), state.who); }
    else if (b.hasAttribute('data-cf-sum-open')) { const r = rowOf(state.selected); if (r) startSum(r); }
    else if (d.cfSumDel !== undefined) { const box = state.sum; if (box) { box.lines.splice(Number(d.cfSumDel), 1); box.focus = Math.max(0, Math.min(Number(d.cfSumDel), box.lines.length - 1)); paintDetail(); focusSum(); } }
    else if (b.hasAttribute('data-cf-sum-add')) { const box = state.sum; if (box && box.lines.length < EDIT_POINTS_MAX) { box.lines.push(''); box.focus = box.lines.length - 1; paintDetail(); focusSum(); } }
    else if (b.hasAttribute('data-cf-sum-cancel')) { state.sum = null; paintDetail(); $('#cfDetail [data-cf-more]')?.focus({preventScroll:true}); }
    else if (b.hasAttribute('data-cf-sum-save')) void saveSum();
    else if (b.hasAttribute('data-cf-sum-reset')) { const r = rowOf(state.sum?.rowId); if (r) void resetEdit(r, ['points'], state.sum); }
  });
  root.addEventListener('input', e => {
    const t = e.target;
    if (t.matches('[data-cf-link-text]') && state.link) state.link.summary = t.value;
    else if (t.matches('[data-cf-title-input]') && state.edit) state.edit.value = t.value;
    else if (t.matches('[data-cf-who-name]') && state.who) state.who.name = t.value;
    else if (t.matches('[data-cf-who-role]') && state.who) state.who.role = t.value;
    else if (t.matches('[data-cf-sum-line]') && state.sum) state.sum.lines[Number(t.dataset.cfSumLine)] = t.value;
  });
  // 제목 입력: 바깥을 누르면(초점이 빠지면) 저장. 다시 그리는 중의 초점 잃음은 무시.
  root.addEventListener('focusout', e => { if (rendering || !e.target.matches?.('[data-cf-title-input]')) return; void commitTitle({refocus:false}); });
  root.addEventListener('keydown', e => {
    const t = e.target;
    if (e.isComposing || e.keyCode === 229) return;
    if (t.matches?.('[data-cf-title-input]')) {
      if (e.key === 'Enter') { e.preventDefault(); void commitTitle(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelTitle(); }
      return;
    }
    if (t.matches?.('[data-cf-sum-line]') && state.sum) {
      const box = state.sum, i = Number(t.dataset.cfSumLine);
      if (e.key === 'Enter') { e.preventDefault(); if (box.lines.length < EDIT_POINTS_MAX) { box.lines.splice(i + 1, 0, ''); box.focus = i + 1; paintDetail(); focusSum(); } }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); state.sum = null; paintDetail(); $('#cfDetail [data-cf-more]')?.focus({preventScroll:true}); }
      return;
    }
    if (t.matches?.('[data-cf-who-name],[data-cf-who-role]') && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); state.who = null; paintDetail(); $('#cfDetail [data-cf-who-open]')?.focus({preventScroll:true}); return; }
    // PC: F2 = 제목 바꾸기 (고른 줄 또는 포커스가 있는 줄·상세)
    if (e.key === 'F2' && !t.closest?.('input,textarea,select,[contenteditable]')) {
      const inDetail = !!t.closest?.('#cfDetail'), id = t.closest?.('[data-cf-item]')?.dataset.cfItem || (inDetail ? state.selected : null), r = rowOf(id);
      if (r) { e.preventDefault(); startTitle(r, inDetail ? 'detail' : 'list'); }
    }
  });
  root.addEventListener('toggle', e => {
    if (!e.target.matches?.('[data-cf-full]')) return;
    state.rawOpen = e.target.open;
    const s = e.target.querySelector('summary'); if (s?.firstChild) s.firstChild.textContent = state.rawOpen ? '전문 접기 ' : '전문 펼치기 ';
  }, true);
}
bind();

window.addEventListener('kptu:view-changed', e => {
  if (e.detail?.view === 'calls') { if (!state.loaded || state.owner !== scopeOf(rt)) void load(); else paint(); return; }
  layer = null; boxLayer = null; state.link = null; state.who = null; state.sum = null; state.edit = null; state.confirm = null; state.box = 'work'; menu.close?.(null, true);
  window.dispatchEvent(new CustomEvent('kptu:where-item', {detail:{view:'calls', name:null}}));
});
window.addEventListener('kptu:session-changed', () => { run++; layer = null; boxLayer = null; undo = null; ledgerAsk = null; state = fresh(); if (view()) paint(); });
pc.addEventListener?.('change', () => { if (view() && !view().classList.contains('hidden')) { if (pc.matches) for (const l of [layer, boxLayer]) l?.close(); if (pc.matches) { layer = null; boxLayer = null; } paint(); } });
paint();
// 원장 근거 ‹원문›이 부른다: 목록을 읽은 뒤 그 통화를 연다. 지워졌거나 목록에 없으면 열지 않는다.
async function openCall(id) {
  if (!state.loaded || state.owner !== scopeOf(rt)) await load(); else if (state.loading && loadP) await loadP;
  // 원장 근거는 업무 통화만 가리킨다. 개인 통화함으로 옮긴 통화는 열지 않는다.
  const r = rowOf(id); if (!r || isPersonal(r)) return;
  state.box = 'work'; select(id);
}
// ORG-주요인물: 담당조직 [주요 인물] 탭의 통화 줄이 부른다. 업무·개인 통화함 어느 쪽이든 그 통화함으로 바꿔 연다.
async function showCall(id) {
  if (!state.loaded || state.owner !== scopeOf(rt)) await load(); else if (state.loading && loadP) await loadP;
  const r = rowOf(id); if (!r) return false;
  const box = isPersonal(r) ? 'personal' : 'work';
  if (state.box !== box) setBox(box);
  if (state.box !== box) return false;
  select(id); return true;
}
window.KPTUCallFeed = {reload:() => load(), open:openCall, show:showCall};
