// ORG-주요인물 화면: 담당조직 상세 맨 아래 작은 탭 [주요 인물][기본 정보][소속][이전 요약] 중 [주요 인물] 칸의 유일한 renderer.
// 칩 줄([모두][이름…][+ 인물]) → '요즘' 한 문장(조직 단위, 하루 한 번) → 열린 것(약속·챙길 것) → 지난 기록(통화·텔레그램·회의).
// - 지정·찾을 이름은 서버 표 app_org_key_people(20261029014700). 표가 없으면(적용 전) 조용히 '준비 중' 한 줄.
// - 기록은 기존 읽기 경로를 그대로 쓴다: feed-data.js(통화·개인 통화함·통화 고침·텔레그램), tg-sender-data.js(보낸 사람 이름표),
//   todo-radar-data.js(챙길 것), ledger-browse-model.mjs(약속), 사업 보고(app_meetings 제목·내용). 고르는 규칙은 org-key-people-model.mjs.
// - 줄을 누르면 그 기록으로: 통화 KPTUCallFeed.show, 텔레그램 KPTUTelegramFeed.show, 회의 openReport, 약속 KPTULedgerBrowse.show, 챙길 것 정리함.
// - 칩 빼기·고치기: 칩 꾹 누르기(폰) 또는 우클릭(PC) → 칩 줄 아래 작은 메뉴.
import {readFeed, readPersonal, readCallEdits, workspaceOf, scopeOf} from './feed-data.js';
import {applyCallEdit, missingTable, kstDay} from './feed-model.mjs';
import {readSenders} from './tg-sender-data.js';
import {readOpenCandidates} from './todo-radar-data.js';
import {waitingCommitmentsPath} from './ledger-browse-model.mjs';
import {callAiAssist} from './basket-ai-summary.js';
import {openReport} from './report-open.js';
import {askConfirm, notify} from './small-notice.js';
import {personDraft, collectRecords, collectOpen, onlyPerson, dday, shortDay, briefStale, KIND_LABEL, MATCHES_MAX, PEOPLE_MAX, normName} from './org-key-people-model.mjs';

const TABLE = '/rest/v1/app_org_key_people', BRIEFS = '/rest/v1/app_org_key_people_briefs';
const FIELDS = 'id,workspace_id,organization_id,name,match_names,sort_order,created_at';
const POOL_MS = 3 * 60 * 1000;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const enc = encodeURIComponent;

let ui = null; // {host, orgId, orgName, workspaceId, canEdit, rt, people, status, brief, pick, menu, run}
let pool = null; // 기록 묶음(모든 조직 공통): {scope, at, promise}
const briefAsked = new Set(); // 이번 화면에서 '요즘'을 이미 부탁한 조직(하루 한 번 규칙은 서버 행의 day가 지킴)

// ───────────── 읽기 ─────────────
async function readPeople(rt, orgId) {
  try {
    const rows = await rt.api(`${TABLE}?organization_id=eq.${enc(orgId)}&select=${FIELDS}&order=sort_order.asc,created_at.asc,id.asc&limit=${PEOPLE_MAX}`, {singleFlight:false});
    return {status:'ready', rows:(Array.isArray(rows) ? rows : []).filter(r => r?.id && r.organization_id === orgId)};
  } catch (e) { return {status:missingTable(e) ? 'missing' : 'error', rows:[]}; }
}
async function readBrief(rt, orgId) {
  try {
    const rows = await rt.api(`${BRIEFS}?organization_id=eq.${enc(orgId)}&select=organization_id,day,brief,detail,people_ids,updated_at&limit=1`, {singleFlight:false});
    return Array.isArray(rows) && rows[0]?.organization_id === orgId ? rows[0] : null;
  } catch { return null; }
}
// 통화·텔레그램·회의·챙길 것·약속을 한 번에(몇 분 동안 다시 쓰고, 하나가 실패해도 나머지는 보인다).
function readPool(rt) {
  let scope = '';
  try { scope = scopeOf(rt); } catch { return Promise.resolve(null); }
  if (pool && pool.scope === scope && Date.now() - pool.at < POOL_MS) return pool.promise;
  const settle = p => p.then(v => v, () => null);
  const promise = (async () => {
    const ws = workspaceOf(rt);
    const [calls, personal, edits, telegram, senders, meetings, todos, promises] = await Promise.all([
      settle(readFeed('call', rt)), settle(readPersonal(rt)), settle(readCallEdits(rt)), settle(readFeed('telegram', rt)), settle(readSenders(rt)),
      settle(rt.api(`/rest/v1/app_meetings?workspace_id=eq.${enc(ws)}&deleted_at=is.null&select=id,title,series_name,round_no,meeting_at,notes&order=meeting_at.desc.nullslast&limit=300`, {singleFlight:false})),
      settle(readOpenCandidates(rt)), settle(rt.api(waitingCommitmentsPath(ws), {singleFlight:false}))]);
    const edited = rows => (rows || []).map(r => edits?.get?.(r.id) ? applyCallEdit(r, edits.get(r.id)) : r);
    return {calls:edited(calls), personal:personal || [], telegram:telegram || [], senders, meetings:Array.isArray(meetings) ? meetings : [],
      todos:todos?.ok ? todos.rows : [], promises:Array.isArray(promises) ? promises : [],
      partial:[calls, personal, telegram, meetings].some(x => x === null) || !todos?.ok};
  })();
  pool = {scope, at:Date.now(), promise};
  return promise;
}
export function dropKeyPeoplePool() { pool = null; }

// ───────────── 그리기 ─────────────
export function paintKeyPeople(opts) {
  if (!opts?.host || !opts.orgId || !opts.rt?.api) return;
  const same = ui && ui.host === opts.host && ui.orgId === opts.orgId;
  ui = {people:[], status:'loading', brief:null, pick:null, menu:null, data:null, ...(same ? {people:ui.people, status:ui.status, brief:ui.brief, pick:ui.pick, data:ui.data} : {}), ...opts, run:(ui?.run || 0) + 1};
  bind(ui.host);
  paint();
  void load(ui.run);
}
export function clearKeyPeople() { if (ui) ui.host.replaceChildren(); ui = null; }

async function load(run) {
  if (!ui) return;
  const {rt, orgId} = ui;
  const [p, brief] = await Promise.all([readPeople(rt, orgId), readBrief(rt, orgId)]);
  if (!ui || ui.run !== run) return;
  ui.status = p.status; ui.people = p.rows; ui.brief = brief;
  if (ui.pick && !ui.people.some(x => x.id === ui.pick)) ui.pick = null;
  paint();
  if (ui.status !== 'ready' || !ui.people.length) return;
  const data = await readPool(rt).catch(() => null);
  if (!ui || ui.run !== run) return;
  ui.data = data || {calls:[], personal:[], telegram:[], senders:null, meetings:[], todos:[], promises:[], partial:true};
  paint();
  askBrief(run);
}
// '요즘': 오늘 것이 없거나 주요 인물이 바뀌었으면 서버 AI에 한 번 부탁한다(재료는 서버가 로그인으로 읽음). 실패하면 빈 상태 그대로.
function askBrief(run) {
  const {rt, orgId, people, brief} = ui, today = kstDay();
  if (!briefStale(brief, people, today) || briefAsked.has(orgId + ':' + today)) return;
  briefAsked.add(orgId + ':' + today);
  void callAiAssist({kind:'org_people_brief', organization_id:orgId}, {rt}).then(async r => {
    if (!r?.ok) return;
    const fresh = await readBrief(rt, orgId);
    if (!ui || ui.run !== run || !fresh) return;
    ui.brief = fresh; paint();
  }).catch(() => {});
}

const nameOf = id => ui.people.find(p => p.id === id)?.name || '';
const whoText = ids => (ids || []).map(nameOf).filter(Boolean).join(', ');
function setTabCount() {
  const n = ui.status === 'ready' ? ui.people.length : 0;
  const tab = document.querySelector('[data-wd-tab="people"] [data-wd-tab-count]');
  if (tab) tab.textContent = n ? String(n) : '';
}

function paint() {
  if (!ui) return;
  const {host, status, people, canEdit} = ui;
  setTabCount();
  if (status === 'loading' && !people.length) { host.innerHTML = '<p class="okp-faint" role="status">불러오는 중…</p>'; return; }
  if (status === 'missing') { host.innerHTML = '<p class="okp-faint" data-okp-preparing>준비 중이에요.</p>'; return; }
  if (status === 'error') { host.innerHTML = '<p class="okp-faint" role="alert">주요 인물을 불러오지 못했어요. <button type="button" class="okp-link" data-okp-retry>다시 시도</button></p>'; return; }
  const chips = [`<button type="button" class="okp-chip" data-okp-pick="" aria-pressed="${!ui.pick}">모두</button>`]
    .concat(people.map(p => `<button type="button" class="okp-chip" data-okp-pick="${esc(p.id)}" data-okp-person="${esc(p.id)}" aria-pressed="${ui.pick === p.id}" title="${esc((p.match_names || []).join(', '))}">${esc(p.name)}</button>`));
  if (canEdit && people.length < PEOPLE_MAX) chips.push('<button type="button" class="okp-add" data-okp-add>+ 인물</button>');
  let html = `<div class="okp-chips" role="group" aria-label="주요 인물 거르기">${chips.join('')}</div>`;
  if (ui.menu && canEdit) {
    const p = people.find(x => x.id === ui.menu);
    if (p) html += `<div class="okp-menu" role="group" aria-label="${esc(p.name)} 메뉴"><span>${esc(p.name)}</span><button type="button" class="okp-link" data-okp-edit="${esc(p.id)}">고치기</button><button type="button" class="okp-link danger" data-okp-del="${esc(p.id)}">빼기</button><button type="button" class="okp-link" data-okp-menu-close>닫기</button></div>`;
  }
  if (!people.length) {
    host.innerHTML = html + `<p class="okp-faint">지정한 주요 인물이 없어요.${canEdit ? ' [+ 인물]로 이름과 통화·텔레그램에 찍히는 이름을 적어 두면 그 사람 기록이 여기 모여요.' : ''}</p>`;
    return;
  }
  html += briefHtml();
  const data = ui.data, today = kstDay();
  if (!data) { host.innerHTML = html + '<p class="okp-faint" role="status">기록을 모으는 중…</p>'; return; }
  const open = onlyPerson(collectOpen({people, todos:data.todos, promises:data.promises}), ui.pick);
  const recs = onlyPerson(collectRecords({people, calls:data.calls, personal:data.personal, telegram:data.telegram, senders:data.senders, meetings:data.meetings}), ui.pick);
  const many = people.length > 1 && !ui.pick;
  html += `<h4 class="okp-h">열린 것<small>${open.length || ''}</small></h4>`;
  html += open.length ? `<ul class="okp-list">${open.map(r => `<li><button type="button" class="okp-row" data-okp-open="${esc(r.key)}"><span class="okp-tag ${r.kind}">${KIND_LABEL[r.kind]}</span><span class="okp-text">${esc(r.text)}</span>${many ? `<span class="okp-who">${esc(whoText(r.people))}</span>` : ''}<span class="okp-due${dday(r.due, today).startsWith('D+') ? ' late' : ''}">${esc(dday(r.due, today))}</span></button></li>`).join('')}</ul>`
    : '<p class="okp-faint">열린 약속·챙길 것이 없어요.</p>';
  html += `<h4 class="okp-h">지난 기록<small>${recs.length || ''}</small></h4>`;
  html += recs.length ? `<ul class="okp-list">${recs.map(r => `<li><button type="button" class="okp-row" data-okp-open="${esc(r.key)}"><span class="okp-day">${esc(shortDay(r.day, today))}</span><span class="okp-tag ${r.kind}">${KIND_LABEL[r.kind]}</span><span class="okp-text">${esc(r.text)}</span>${many ? `<span class="okp-who">${esc(whoText(r.people))}</span>` : ''}</button></li>`).join('')}</ul>`
    : '<p class="okp-faint">최근 120일 안에 모인 기록이 없어요.</p>';
  if (data.partial) html += '<p class="okp-faint">일부 기록을 불러오지 못했어요.</p>';
  host.innerHTML = html;
  ui.rows = new Map([...open, ...recs].map(r => [r.key, r]));
}
// '요즘' 줄은 늘 보인다. 문장이 없으면 빈 상태 글자. 세부(detail)는 접기.
function briefHtml() {
  const b = ui.brief, text = b?.brief ? b.brief : '아직 정리된 문장이 없어요.';
  const head = `<span class="okp-brief-k">요즘</span><span class="okp-brief-t${b?.brief ? '' : ' okp-faint'}">${esc(text)}</span>`;
  return b?.detail ? `<details class="okp-brief"><summary>${head}</summary><p class="okp-brief-d">${esc(b.detail)}</p></details>` : `<p class="okp-brief">${head}</p>`;
}

// ───────────── 누르기 ─────────────
let pressTimer = 0, pressFired = false;
function bind(host) {
  if (host.dataset.okpBound) return;
  host.dataset.okpBound = '1';
  host.addEventListener('click', e => {
    const b = e.target.closest?.('button'); if (!b || !ui || ui.host !== host) return;
    if (pressFired) { pressFired = false; if (b.dataset.okpPerson) { e.preventDefault(); return; } }
    if ('okpRetry' in b.dataset) { ui.status = 'loading'; paint(); void load(ui.run); return; }
    if ('okpPick' in b.dataset) { ui.pick = b.dataset.okpPick || null; ui.menu = null; paint(); host.querySelector(`[data-okp-pick="${CSS.escape(b.dataset.okpPick)}"]`)?.focus({preventScroll:true}); return; }
    if ('okpAdd' in b.dataset) { openEditor(null, b); return; }
    if ('okpMenuClose' in b.dataset) { const id = ui.menu; ui.menu = null; paint(); host.querySelector(`[data-okp-person="${CSS.escape(id || '')}"]`)?.focus({preventScroll:true}); return; }
    if (b.dataset.okpEdit) { const p = ui.people.find(x => x.id === b.dataset.okpEdit); ui.menu = null; paint(); if (p) openEditor(p, host.querySelector(`[data-okp-person="${CSS.escape(p.id)}"]`)); return; }
    if (b.dataset.okpDel) { void removePerson(b.dataset.okpDel, b); return; }
    if (b.dataset.okpOpen) { const r = ui.rows?.get(b.dataset.okpOpen); if (r) void openRecord(r); }
  });
  // PC 우클릭·폰 꾹 누르기 → 칩 메뉴(고칠 수 있을 때만).
  host.addEventListener('contextmenu', e => {
    const chip = e.target.closest?.('[data-okp-person]'); if (!chip || !ui?.canEdit) return;
    e.preventDefault(); showMenu(chip.dataset.okpPerson);
  });
  host.addEventListener('pointerdown', e => {
    const chip = e.target.closest?.('[data-okp-person]'); if (!chip || !ui?.canEdit || e.pointerType === 'mouse') return;
    clearTimeout(pressTimer); pressFired = false;
    pressTimer = setTimeout(() => { pressFired = true; showMenu(chip.dataset.okpPerson); }, 550);
  });
  for (const t of ['pointerup', 'pointercancel', 'pointerleave']) host.addEventListener(t, () => clearTimeout(pressTimer));
  host.addEventListener('keydown', e => {
    const chip = e.target.closest?.('[data-okp-person]');
    if (chip && ui?.canEdit && (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) { e.preventDefault(); showMenu(chip.dataset.okpPerson); }
  });
}
function showMenu(id) {
  if (!ui) return;
  ui.menu = id; paint();
  ui.host.querySelector(`[data-okp-edit="${CSS.escape(id)}"]`)?.focus({preventScroll:true});
}

async function openRecord(r) {
  const router = window.KPTURouter, o = r.open; if (!router || !o) return;
  try {
    if (o.view === 'meetings') { await openReport(o.id); return; }
    await window.KPTUViewLoader?.load?.(o.view);
    if (o.view === 'calls') { router.go('calls', {source:'delegated'}); await window.KPTUCallFeed?.show?.(o.id); }
    else if (o.view === 'telegram') { router.go('telegram', {source:'delegated'}); await window.KPTUTelegramFeed?.show?.(o.room, o.day, o.item); }
    else if (o.view === 'ledger') { window.KPTULedgerBrowse?.show?.({kinds:['commitment'], openId:o.id}); router.go('ledger', {source:'delegated'}); }
    else if (o.view === 'basket') router.go('basket', {source:'delegated', sub:'todo'});
  } catch (e) { console.warn('key people open failed', e?.name || 'Error'); }
}

async function removePerson(id, anchor) {
  const p = ui?.people.find(x => x.id === id); if (!p) return;
  const ok = await askConfirm(anchor, {text:`${p.name}을(를) 주요 인물에서 뺄까요?`, ok:'빼기', danger:true, note:'통화·텔레그램 기록은 그대로예요.'});
  if (!ok || !ui) return;
  const {rt, orgId} = ui, run = ui.run;
  try {
    await rt.api(`${TABLE}?id=eq.${enc(id)}&organization_id=eq.${enc(orgId)}`, {method:'DELETE', prefer:'return=minimal'});
  } catch { notify('빼지 못했어요. 다시 시도해 주세요.', {error:true}); return; }
  if (!ui || ui.run !== run) return;
  ui.people = ui.people.filter(x => x.id !== id); ui.menu = null; if (ui.pick === id) ui.pick = null; paint();
  notify(`${p.name}을(를) 뺐어요.`, {undo:async () => {
    await rt.api(TABLE, {method:'POST', prefer:'return=minimal', body:{workspace_id:p.workspace_id, organization_id:p.organization_id, name:p.name, match_names:p.match_names || [], sort_order:p.sort_order ?? 0}});
    if (ui && ui.orgId === orgId) void load(ui.run);
    return true;
  }});
}

// ───────────── [+ 인물] 창 ─────────────
let ed = null; // {person, matches:[], back, busy}
function modal() {
  let m = document.getElementById('okpModal');
  if (m) return m;
  m = document.createElement('div');
  m.id = 'okpModal'; m.className = 'modal hidden'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-labelledby', 'okpTitle');
  m.innerHTML = '<div class="modal-card small-card okp-card"><div class="modal-head"><h2 id="okpTitle">주요 인물</h2><button type="button" class="icon-btn" data-okp-close aria-label="닫기">×</button></div>'
    + '<label class="okp-field">이름<input id="okpName" type="text" maxlength="40" autocomplete="off"></label>'
    + '<div class="okp-field"><span id="okpMatchLabel">찾을 이름 <small>통화·텔레그램에 이 사람이 찍히는 이름</small></span><div class="okp-matches" id="okpMatches" aria-labelledby="okpMatchLabel"></div>'
    + '<div class="okp-match-add"><input id="okpMatchInput" type="text" maxlength="40" autocomplete="off" placeholder="직접 적기" aria-label="찾을 이름 직접 적기"><button type="button" class="secondary" data-okp-match-add>추가</button></div>'
    + '<div class="okp-suggest" id="okpSuggest" aria-label="통화·텔레그램에서 찾은 이름"></div></div>'
    + '<div class="modal-action-footer"><div id="okpStatus" class="status" role="status"></div><button type="button" class="secondary" data-okp-close>취소</button><button type="button" class="primary" data-okp-save>저장</button></div></div>';
  document.body.append(m);
  m.addEventListener('click', e => {
    if (e.target === m) { closeEditor(); return; }
    const b = e.target.closest?.('button'); if (!b) return;
    if ('okpClose' in b.dataset) closeEditor();
    else if ('okpSave' in b.dataset) void saveEditor();
    else if ('okpMatchAdd' in b.dataset) addMatch(m.querySelector('#okpMatchInput').value, true);
    else if (b.dataset.okpMatchDel !== undefined) { ed.matches.splice(Number(b.dataset.okpMatchDel), 1); paintMatches(); }
    else if (b.dataset.okpSuggest !== undefined) addMatch(b.dataset.okpSuggest, false);
  });
  m.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); closeEditor(); return; }
    if (e.key === 'Enter' && e.target.id === 'okpMatchInput') { e.preventDefault(); addMatch(e.target.value, true); }
    else if (e.key === 'Enter' && e.target.id === 'okpName') { e.preventDefault(); void saveEditor(); }
  });
  m.querySelector('#okpName').addEventListener('input', paintSuggest);
  return m;
}
function openEditor(person, back) {
  if (!ui?.canEdit) return;
  const m = modal();
  ed = {person, back, busy:false, matches:person ? (person.match_names || []).filter(x => x !== person.name) : [], org:ui.orgId};
  m.querySelector('#okpTitle').textContent = person ? '주요 인물 고치기' : '주요 인물 추가';
  m.querySelector('#okpName').value = person?.name || '';
  m.querySelector('#okpMatchInput').value = '';
  m.querySelector('#okpStatus').textContent = '';
  paintMatches(); paintSuggest();
  m.classList.remove('hidden');
  m.querySelector('#okpName').focus();
  if (!ui.data) void readPool(ui.rt).then(paintSuggest, () => {});
}
function closeEditor() {
  const m = document.getElementById('okpModal'); if (!m || m.classList.contains('hidden')) return;
  m.classList.add('hidden');
  const back = ed?.back; ed = null;
  if (back?.isConnected) back.focus({preventScroll:true});
}
function addMatch(value, fromInput) {
  if (!ed) return;
  const v = String(value ?? '').replace(/\s+/g, ' ').trim(), status = document.getElementById('okpStatus');
  if (!v) return;
  if ([...v].length < 2) { status.textContent = '찾을 이름은 2자 이상이에요.'; return; }
  if (ed.matches.length >= MATCHES_MAX - 1) { status.textContent = `찾을 이름은 ${MATCHES_MAX}개까지예요.`; return; }
  if (!ed.matches.includes(v)) ed.matches.push(v);
  status.textContent = '';
  if (fromInput) document.getElementById('okpMatchInput').value = '';
  paintMatches(); paintSuggest();
}
function paintMatches() {
  const box = document.getElementById('okpMatches'); if (!box || !ed) return;
  box.innerHTML = ed.matches.length
    ? ed.matches.map((x, i) => `<span class="okp-mchip">${esc(x)}<button type="button" data-okp-match-del="${i}" aria-label="${esc(x)} 빼기">×</button></span>`).join('')
    : '<span class="okp-faint">이름만으로 찾아요. 다르게 찍히면 아래에서 골라 두세요.</span>';
}
// 통화 상대·텔레그램 이름표 중 적은 이름(2자 이상)과 겹치는 것을 골라 보인다(최대 8개).
function paintSuggest() {
  const box = document.getElementById('okpSuggest'); if (!box || !ed) return;
  const name = normName(document.getElementById('okpName')?.value);
  if ([...name].length < 2) { box.innerHTML = ''; return; }
  const seen = new Set(ed.matches.map(normName).concat(name)), out = [];
  const add = v => { const t = String(v ?? '').replace(/\s+/g, ' ').trim(), k = normName(t); if ([...t].length < 2 || [...t].length > 40 || seen.has(k) || !(k.includes(name) || name.includes(k))) return; seen.add(k); out.push(t); };
  void readPool(ui?.rt || window.KPTURuntime).then(data => {
    if (!ed) return;
    for (const s of data?.senders?.senders || []) { if (!s.is_self) { add(s.name); add(s.auto_name); } }
    for (const r of [...(data?.calls || []), ...(data?.personal || [])]) add(r.counterpart);
    box.innerHTML = out.length ? `<small>찾은 이름</small>${out.slice(0, 8).map(x => `<button type="button" class="okp-sg" data-okp-suggest="${esc(x)}">+ ${esc(x)}</button>`).join('')}` : '';
  }, () => {});
}
async function saveEditor() {
  if (!ed || ed.busy || !ui) return;
  const m = document.getElementById('okpModal'), status = m.querySelector('#okpStatus');
  const pending = m.querySelector('#okpMatchInput').value.trim();
  const d = personDraft({name:m.querySelector('#okpName').value, matches:pending ? [...ed.matches, pending] : ed.matches});
  if (!d.ok) { status.textContent = d.error; return; }
  if (ui.people.some(p => p.name === d.name && p.id !== ed.person?.id)) { status.textContent = '이 조직에 같은 이름이 이미 있어요.'; return; }
  const {rt, orgId} = ui, run = ui.run;
  if (ed.org !== orgId) { closeEditor(); return; }
  ed.busy = true; status.textContent = '저장하는 중…';
  try {
    if (ed.person) await rt.api(`${TABLE}?id=eq.${enc(ed.person.id)}&organization_id=eq.${enc(orgId)}`, {method:'PATCH', prefer:'return=minimal', body:{name:d.name, match_names:d.match_names, updated_at:new Date().toISOString()}});
    else await rt.api(TABLE, {method:'POST', prefer:'return=minimal', body:{workspace_id:ui.workspaceId, organization_id:orgId, name:d.name, match_names:d.match_names, sort_order:(ui.people.reduce((n, p) => Math.max(n, p.sort_order || 0), 0) + 1024)}});
  } catch (e) {
    if (ed) { ed.busy = false; status.textContent = /23505|duplicate/i.test(String(e?.message || '') + (e?.code || '')) ? '이 조직에 같은 이름이 이미 있어요.' : '저장하지 못했어요. 다시 시도해 주세요.'; }
    return;
  }
  closeEditor();
  if (ui && ui.run === run) void load(run);
}
