// S53-20 MTG-비정기회의접기(시안 docs/design/mockups/meeting-name-irregular.html): 회의명 고르기 상자의 작은 창 하나.
// 쓰는 곳: 회의명을 고르는 상자 전부(사업 보고 입력 창 #meetingNameSelect — 회의 녹음·파일로 만들기도 이 창 — 과 보고 고치기 #mrdEditNameSelect).
// - 평소: 맨 위 '회의 찾기' 칸 · 정기 회의 줄 · 상위 아래 '└ ○○ 비정기 회의 n ›' 접힌 줄(누르면 그 아래만 날짜와 함께 펼침) · 기타(직접 입력).
// - 찾기: 정기·비정기 모두에서 찾고 비정기 줄은 '비정기 · 상위' 꼬리표.
// - 줄 ⋯: 비정기로 두기 · 정기 목록에 두기 · 조직 바꾸기 · 이름 바꾸기 · 삭제(목록에서만 — 지난 보고는 그대로).
// S56-1 MTG-회의명조직묶기(시안 docs/design/mockups/meeting-name-groups.html): 정기 회의에 조직이 붙어 있으면 조직 머리글(고를 수 없는 작은 회색 글자)
//   아래에 그 조직 회의 · 맨 아래 '└ 비정기 회의 n ›'. 어느 조직에도 안 넣은 회의는 맨 아래 '기타'. 찾기 줄에는 '· 조직' 꼬리표.
//   '상위 목록 수정' → '조직 목록 수정'(비정기 상위 목록과 같은 목록 하나).
// S57-14 MTG-회의명처음배치(시안 docs/design/mockups/meeting-name-groups-phone.html): 맨 아래 '회의 미리 넣기'(아직 보고가 없는 회의명 + 조직) —
//   미리 넣은 회의는 정기 줄처럼 보이고 고를 수 있다. 줄 ⋯에 [위로]·[아래로](같은 조직 안 순서)와, 미리 넣은 줄은 [목록에서 빼기].
//   조직에 넣거나 미리 넣으면 그 조직 맨 아래에 붙는다(넣은 순서 = 보이는 순서).
// - 새 회의명('기타(직접 입력)')을 쓸 때는 입력 칸 옆 [정기 회의 ▾] 상자로 처음부터 정기/비정기·상위를 고른다(저장할 때 같이 기억).
// 값은 그대로 <select> 한 곳에 있다(이 창은 값만 고르고 input·change를 보냄 — select-menu.js와 같은 약속). 누름·키 가로채기는 select-menu.js addOpener.
// 목록 나누기·묶기 규칙은 meeting-name-sorts.mjs, 서버 읽기·쓰기는 meeting-name-sorts.js. 이 창은 기기에 아무것도 저장하지 않는다.
import {followAnchor} from './anchored-popup.js';
import {placeMenu, naturalWidth, scrollbarWidth} from './select-menu.js';
import {askConfirm} from './small-notice.js';
import {emptyHtml} from './wait-state.js';
import {seoulDateKey} from './meeting-time.js';
import {listRows, findRows, shownNames, placeOf, orgOf, setPlace, setIrregular, setOrg, moveName, nameKey, parentLabel, ETC, DEL, REGULAR,
  hasMark, addPreset, removePreset, presetNameProblem, orderSpot, stepOrder, toOrgEnd} from './meeting-name-sorts.mjs';
import {readSorts, peekSorts, changeSorts, failText} from './meeting-name-sorts.js';

const OTHER = '__other__', KEY = 'kptuNamePanel';
// 이 창과 상위 목록 창의 모양은 어느 화면에서 열려도 한 번 넣는다(사업 보고 창은 일정·홈에서도 열림).
const STYLES = ['./meeting-name-panel.css', './list-edit.css'];
function ensureStyles() {
  const have = new Set([...document.querySelectorAll('link[rel="stylesheet"]')].map(l => (l.getAttribute('href') || '').split('?')[0].split('/').at(-1)));
  for (const path of STYLES) { if (have.has(path.split('/').at(-1))) continue; const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = path; link.dataset.kptuViewStyle = '1'; document.head.append(link); }
}
ensureStyles();
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const day = at => { if (!at) return ''; const m = String(seoulDateKey(at) || '').match(/^\d{4}-(\d{2})-(\d{2})/); return m ? `${Number(m[1])}/${Number(m[2])}` : ''; };
const sorts = () => peekSorts()?.status === 'ok' ? peekSorts().sorts : null;
const names = () => window.KPTUMeetingNames;

let ui = null, seq = 0;
const panel = document.createElement('div');
panel.className = 'mnp'; panel.id = 'kptuNamePanel'; panel.hidden = true; panel.tabIndex = -1;
panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', '회의명 선택');
// 사업 보고 창(data-enter-save) 안에 붙지만 이 창의 엔터는 저장이 아니다(찾기 칸 엔터 = 첫 줄 고르기, 이름 칸 엔터 = 바꾸기).
panel.setAttribute('data-enter-field', 'off');

function entriesOf(select) { return select._nameEntries || []; }
function currentName(select) { return select.value && select.value !== OTHER ? select.value : ''; }

// ---- 고르기 상자의 option 보이기(정기 줄에 있는 이름만, 나머지는 hidden option으로 값만 남김) ----
export function paintOptions(select) {
  if (!select?.isConnected) return;
  const shown = shownNames(entriesOf(select), sorts(), {keep: currentName(select)});
  for (const o of select.options) if (o.value && o.value !== OTHER) o.hidden = !shown.has(nameKey(o.value));
}

// ---- 창 ----
function place() {
  if (!ui) return;
  const vv = window.visualViewport, probe = document.querySelector('.kptu-select-inset');
  const view = {left: vv?.offsetLeft || 0, top: vv?.offsetTop || 0, width: vv?.width || document.documentElement.clientWidth, bottom: Math.min(window.innerHeight, (vv?.offsetTop || 0) + (vv?.height || window.innerHeight))};
  panel.style.maxHeight = 'none'; panel.style.height = 'auto';
  // UI-고르기목록잘림: 폭은 칸·260px·가장 긴 줄 중 넓은 쪽(화면 폭까지). 화면보다 길면 그때만 이름이 줄바꿈된다(잘림·… 없음).
  const r = ui.select.getBoundingClientRect(), anchor = {left: r.left, top: r.top, bottom: r.bottom, width: r.width};
  const inset = probe?.getBoundingClientRect().height || 0, opts = {minWidth: 260, maxHeight: 420};
  const fit = cw => {
    const w = placeMenu({anchor, view, inset, contentH: 0, contentW: cw, ...opts});
    if (w.wrap) panel.dataset.wrap = ''; else panel.removeAttribute('data-wrap');
    Object.assign(panel.style, {width: w.width + 'px', height: 'auto', maxHeight: 'none'});
    const contentH = panel.scrollHeight + (panel.offsetHeight - panel.clientHeight);
    const p = placeMenu({anchor, view, inset, contentH, contentW: cw, ...opts});
    Object.assign(panel.style, {left: p.left + 'px', top: p.top + 'px', width: p.width + 'px', height: p.height + 'px', maxHeight: p.height + 'px'});
  };
  const contentW = naturalWidth(panel);
  fit(contentW);
  const bar = scrollbarWidth(panel);
  if (bar > 0) fit(contentW + bar);
}
const rowsNow = () => ui.query ? findRows(entriesOf(ui.select), sorts(), ui.query) : listRows(entriesOf(ui.select), sorts(), {keep: currentName(ui.select)});

function nameRow(b, i, sub = false) {
  const on = nameKey(b.name) === nameKey(currentName(ui.select)), more = b.names.length - 1;
  return `<div class="mnp-row${sub ? ' mnp-sub' : ''}${on ? ' is-on' : ''}"${b.preset ? ' data-mnp-preset-row' : ''}><div class="mnp-pick" role="option" tabindex="0" aria-selected="${on}" data-mnp-pick="${esc(b.name)}">`
    + `<span class="mnp-name">${esc(b.name)}</span>${sub && day(b.at) ? `<span class="mnp-day">· ${esc(day(b.at))}</span>` : ''}${more > 0 ? `<span class="mnp-n">외 ${more}</span>` : ''}${b.tag ? `<span class="mnp-tag">· ${esc(b.tag)}</span>` : ''}</div>`
    + `<button type="button" class="icon-btn mnp-more" data-ctx="off" data-mnp-menu="${i}" aria-label="${esc(b.name)} 메뉴" aria-haspopup="true"><span class="more-dots" aria-hidden="true">⋯</span></button></div>`;
}
function listHtml() {
  const rows = rowsNow(), flat = [];
  const add = (b, sub) => { flat.push(b); return nameRow(b, flat.length - 1, sub); };
  let body = '';
  for (const r of rows) {
    if (r.type === 'name') { body += add(r, false); continue; }
    // 조직 머리글: 누를 수 없는 작은 회색 글자(고르기·키보드 이동 대상 아님).
    if (r.type === 'org') { body += `<div class="mnp-org" role="presentation" data-mnp-org="${esc(r.id)}">${esc(r.label)}</div>`; continue; }
    const open = ui.open.has(r.id);
    body += `<div class="mnp-grp" role="button" tabindex="0" data-mnp-group="${esc(r.id)}" aria-expanded="${open}">└ ${esc(r.label)} ${r.items.length} <span aria-hidden="true">${open ? '⌄' : '›'}</span></div>`;
    if (open) body += r.items.map(b => add(b, true)).join('');
  }
  ui.flat = flat;
  if (ui.query && !rows.length) body += emptyHtml('찾는 회의 없음');
  return `${body}<div class="mnp-row mnp-other-row"><div class="mnp-pick mnp-other" role="option" tabindex="0" aria-selected="${ui.select.value === OTHER}" data-mnp-pick="${OTHER}">기타(직접 입력)</div></div>`;
}
const findHtml = () => `<input type="search" class="mnp-find" data-mnp-find placeholder="회의 찾기 (비정기 포함)" aria-label="회의 찾기 (비정기 포함)" value="${esc(ui.query)}" autocomplete="off" enterkeyhint="search">`;
const msgHtml = () => ui.msg ? `<p class="mnp-msg" role="status">${esc(ui.msg)}</p>` : '';
const knownNames = select => entriesOf(select).map(x => x.name);
const presetOrg = s => ui.presetOrg && (ui.presetOrg === ETC || s?.parents.some(p => p.id === ui.presetOrg)) ? ui.presetOrg : ETC;
// S57-14 '회의 미리 넣기': 회의명 한 칸 + [추가] · 어느 조직에 둘지(고른 조직은 창이 열려 있는 동안 그대로 — 여러 개를 이어서 넣기 쉽게).
function presetHtml() {
  const s = sorts(), org = presetOrg(s), opts = [...(s?.parents || []).map(x => [x.id, x.name]), [ETC, '기타']];
  return `<div class="mnp-head"><button type="button" class="icon-btn mnp-back" data-mnp-back aria-label="목록으로">‹</button><span class="mnp-title">회의 미리 넣기</span></div>`
    + `<form class="mnp-rename" data-mnp-preset-form><input type="text" class="mnp-find" data-mnp-preset-name value="${esc(ui.draft ?? '')}" maxlength="100" placeholder="아직 보고가 없는 회의명" aria-label="미리 넣을 회의명" autocomplete="off"><button type="submit" class="mini primary">추가</button></form>`
    + `<p class="mnp-note">어느 조직에 둘까요?</p><div class="mnp-rows" role="radiogroup" aria-label="조직">${opts.map(([id, label]) => `<div class="mnp-act${org === id ? ' is-on' : ''}" role="radio" tabindex="0" aria-checked="${org === id}" data-mnp-preset-org="${esc(id)}">${esc(label)}</div>`).join('')}</div>`;
}
function menuHtml() {
  if (ui.mode === 'preset') return presetHtml();
  const b = ui.target, s = sorts(), p = s ? placeOf(s, b.name) : {kind: REGULAR}, org = s ? orgOf(s, b.name) : ETC;
  const head = `<div class="mnp-head"><button type="button" class="icon-btn mnp-back" data-mnp-back aria-label="목록으로">‹</button><span class="mnp-title">${esc(b.name)}</span></div>`;
  if (ui.mode === 'org') {
    const opts = [...(s?.parents || []).map(x => [x.id, x.name]), [ETC, '기타']];
    return head + `<p class="mnp-note">어느 조직에 둘까요?</p><div class="mnp-rows" role="menu" aria-label="조직">${opts.map(([id, label]) => `<div class="mnp-act${org === id ? ' is-on' : ''}" role="menuitemradio" tabindex="0" aria-checked="${org === id}" data-mnp-org-pick="${esc(id)}">${esc(label)}</div>`).join('')}</div>`
      + `<div class="mnp-foot"><div class="mnp-link" role="button" tabindex="0" data-mnp-parents>조직 목록 수정</div></div>`;
  }
  if (ui.mode === 'rename') return head + `<form class="mnp-rename" data-mnp-rename-form><input type="text" class="mnp-find" data-mnp-rename value="${esc(ui.draft ?? b.name)}" maxlength="100" aria-label="새 회의명" autocomplete="off"><button type="submit" class="mini primary">바꾸기</button></form>`;
  // S57-14: 정기 줄은 같은 조직 안에서 [위로]·[아래로](끝에서는 그 항목이 없다). 미리 넣은 줄(보고 없음)은 [삭제] 대신 [목록에서 빼기], 비정기로 두기는 없다.
  const spot = s && p.kind === REGULAR ? orderSpot(entriesOf(ui.select), s, b.name, {keep: currentName(ui.select)}) : null;
  const moves = spot ? [...(spot.index > 0 ? [['up', '위로']] : []), ...(spot.index < spot.count - 1 ? [['down', '아래로']] : [])] : [];
  const acts = b.preset
    ? [['org', `조직 바꾸기 (${parentLabel(s, org)})`], ['rename', '이름 바꾸기'], ...moves, ['unpreset', '목록에서 빼기']]
    : [p.kind === REGULAR ? ['irregular', '비정기로 두기'] : ['regular', '정기 목록에 두기'], ['org', `조직 바꾸기 (${parentLabel(s, org)})`], ['rename', '이름 바꾸기'], ...moves, ['del', '삭제']];
  return head + `<div class="mnp-rows" role="menu" aria-label="${esc(b.name)}">${acts.map(([k, l]) => `<div class="mnp-act" role="menuitem" tabindex="0" data-mnp-act="${k}">${esc(l)}</div>`).join('')}</div>`;
}
function paint({focus = ''} = {}) {
  if (!ui) return;
  // 목록 보기에서는 찾기 칸을 다시 만들지 않는다(한글 조합 중에 칸이 바뀌면 글자가 끊김). 줄·알림만 다시 그린다.
  if (ui.mode === 'list' && panel.dataset.mode === 'list' && panel.querySelector('[data-mnp-find]')) {
    panel.querySelector('.mnp-rows').innerHTML = listHtml();
    panel.querySelector('.mnp-msg-box').innerHTML = msgHtml();
  } else {
    panel.innerHTML = ui.mode === 'list'
      ? `${findHtml()}<div class="mnp-rows" role="listbox" aria-label="회의명">${listHtml()}</div><div class="mnp-msg-box">${msgHtml()}</div><div class="mnp-foot"><div class="mnp-link" role="button" tabindex="0" data-mnp-parents>조직 목록 수정</div><div class="mnp-link" role="button" tabindex="0" data-mnp-preset>회의 미리 넣기</div></div>`
      : `${menuHtml()}<div class="mnp-msg-box">${msgHtml()}</div>`;
    panel.dataset.mode = ui.mode;
  }
  place();
  const el = focus && panel.querySelector(focus);
  if (el && el !== document.activeElement) el.focus({preventScroll: true});
  else if (!el && !panel.contains(document.activeElement)) panel.focus({preventScroll: true});
}

function open(select) {
  if (!select.isConnected) return;
  if (ui) { const same = ui.select === select; close(); if (same) return; }
  // 창 안(.modal)에 붙여 그 창 위에 뜨게 한다(작은 확인창 .kptu-ask는 그보다 위). top layer(popover)는 쓰지 않는다 — 확인창이 가려지므로.
  const host = select.closest('dialog[open],.modal:not(.hidden)') || document.body;
  if (panel.parentElement !== host) host.append(panel);
  ui = {select, id: ++seq, mode: 'list', query: '', open: new Set(), target: null, flat: [], msg: '', stop: null};
  panel.hidden = false;
  select.setAttribute('aria-expanded', 'true');
  // 폰은 열자마자 자판이 올라오지 않게 창에 초점, 마우스·키보드는 찾기 칸에 바로.
  paint({focus: matchMedia('(pointer:coarse)').matches ? '' : '[data-mnp-find]'});
  ui.stop = followAnchor(panel, select, {place, lost: () => close()});
  history.pushState({...history.state, [KEY]: ui.id}, '', location.href);
  if (peekSorts()?.status !== 'ok') void readSorts().then(() => { if (ui?.select === select) { paintOptions(select); paint({focus: document.activeElement?.matches?.('[data-mnp-find]') ? '[data-mnp-find]' : ''}); } });
}
function close({fromBack = false, focus = true} = {}) {
  const cur = ui; if (!cur) return;
  ui = null; cur.stop?.();
  panel.hidden = true; panel.innerHTML = ''; delete panel.dataset.mode;
  cur.select.setAttribute('aria-expanded', 'false');
  let done = Promise.resolve();
  if (!fromBack && history.state?.[KEY] === cur.id) {
    // 다른 창을 이어서 열 때는 이 뒤로가기가 끝난 뒤에 연다(기록 칸이 엇갈리지 않게). popstate가 안 오면 0.4초 뒤.
    done = new Promise(resolve => { const t = setTimeout(resolve, 400); window.addEventListener('popstate', () => { clearTimeout(t); resolve(); }, {once: true}); });
    history.back();
  }
  if (focus && cur.select.isConnected) cur.select.focus({preventScroll: true});
  return done;
}
function choose(value) {
  const select = ui?.select; if (!select) return;
  close();
  if (!select.isConnected) return;
  if (value !== OTHER && ![...select.options].some(o => o.value === value)) select.add(new Option(value, value), select.options[select.options.length - 1]);
  if (select.value !== value) {
    select.value = value;
    select.dispatchEvent(new Event('input', {bubbles: true}));
    select.dispatchEvent(new Event('change', {bubbles: true}));
  }
}
// stay: 저장 뒤에도 그 줄 메뉴에 머문다([위로]·[아래로]를 이어서 누르게). 저장 중에는 다시 누른 것을 받지 않는다(순서가 엇갈리지 않게).
async function save(change, done, {stay = ''} = {}) {
  const cur = ui, select = ui?.select; if (!cur || cur.busy) return;
  cur.busy = true; cur.msg = '저장하는 중…'; paint();
  const r = await changeSorts(change);
  cur.busy = false;
  if (ui !== cur) return;
  ui.msg = r.ok ? done : failText(r.reason);
  if (r.ok && !stay) { ui.mode = 'list'; ui.target = null; }
  if (r.ok) paintOptions(select);
  paint();
  if (stay) (panel.querySelector(`[data-mnp-act="${stay}"]`) || panel.querySelector('[data-mnp-act="up"],[data-mnp-act="down"],[data-mnp-act]'))?.focus({preventScroll: true});
}
// 열린 고르기 상자를 새 이름으로(옛 이름 option·날짜 목록을 바꿈). 고른 이름이었으면 새 이름을 고른 채로 둔다.
function renameInSelect(select, from, next) {
  const oldKey = nameKey(from), wasChosen = nameKey(currentName(select)) === oldKey;
  for (const o of [...select.options]) if (o.value !== OTHER && nameKey(o.value) === oldKey) { if ([...select.options].some(x => x !== o && x.value === next)) o.remove(); else { o.value = next; o.text = next; } }
  select._nameEntries = entriesOf(select).map(x => nameKey(x.name) === oldKey ? {...x, name: next} : x);
  close();
  if (wasChosen) { select.value = next; select.dispatchEvent(new Event('change', {bubbles: true})); }
  paintOptions(select);
}

panel.addEventListener('click', async e => {
  if (!ui) return;
  const t = sel => e.target.closest(sel);
  let b;
  if ((b = t('[data-mnp-pick]'))) { choose(b.dataset.mnpPick); return; }
  if ((b = t('[data-mnp-group]'))) { const id = b.dataset.mnpGroup; ui.open.has(id) ? ui.open.delete(id) : ui.open.add(id); paint({focus: `[data-mnp-group="${CSS.escape(id)}"]`}); return; }
  if ((b = t('[data-mnp-menu]'))) { ui.target = ui.flat[Number(b.dataset.mnpMenu)]; ui.mode = 'menu'; ui.msg = ''; paint({focus: '[data-mnp-act]'}); return; }
  if (t('[data-mnp-back]')) { ui.mode = ui.mode === 'org' || ui.mode === 'rename' ? 'menu' : 'list'; if (ui.mode === 'list') ui.target = null; ui.msg = ''; paint({focus: ui.mode === 'menu' ? '[data-mnp-act]' : '[data-mnp-find]'}); return; }
  if (t('[data-mnp-preset]')) { if (sorts() == null) { ui.msg = failText('unknown'); paint(); return; } ui.mode = 'preset'; ui.target = null; ui.draft = ''; ui.msg = ''; paint({focus: '[data-mnp-preset-name]'}); return; }
  if ((b = t('[data-mnp-preset-org]'))) { const id = b.dataset.mnpPresetOrg; ui.presetOrg = id; paint({focus: `[data-mnp-preset-org="${CSS.escape(id)}"]`}); return; }
  if (t('[data-mnp-parents]')) { const select = ui.select; const [m] = await Promise.all([import('./meeting-name-parents.js'), close({focus: false})]); m.openParents({trigger: select, onClose: () => paintOptions(select)}); return; }
  if ((b = t('[data-mnp-org-pick]'))) {
    // S57-14: 다른 조직으로 옮기면 그 조직 정기 줄 맨 아래에 붙는다(넣은 순서 = 보이는 순서). 같은 조직을 다시 고르면 자리 그대로, '기타'는 최근 먼저 그대로.
    const id = b.dataset.mnpOrgPick, list = ui.target.names, name = ui.target.name, ents = entriesOf(ui.select), opts = {keep: currentName(ui.select)};
    void save(s => { const same = orgOf(s, name) === id, next = setOrg(s, list, id); return !next || same || id === ETC ? next : toOrgEnd(ents, next, list, opts); }, `‘${parentLabel(sorts(), id)}’에 두었어요.`);
    return;
  }
  if ((b = t('[data-mnp-act]'))) {
    const act = b.dataset.mnpAct, target = ui.target;
    if (sorts() == null && act !== 'rename') { ui.msg = failText('unknown'); paint(); return; }
    if (act === 'irregular') { void save(s => setIrregular(s, target.names), `비정기로 두었어요(${parentLabel(sorts(), orgOf(sorts(), target.name))} 아래). 지난 보고는 그대로예요.`); return; }
    if (act === 'org') { ui.mode = 'org'; ui.msg = ''; paint({focus: '[data-mnp-org-pick]'}); return; }
    if (act === 'regular') { void save(s => setPlace(s, target.names, REGULAR), '정기 목록에 두었어요.'); return; }
    if (act === 'rename') { ui.mode = 'rename'; ui.draft = target.name; ui.msg = ''; paint({focus: '[data-mnp-rename]'}); return; }
    if (act === 'up' || act === 'down') { const ents = entriesOf(ui.select), opts = {keep: currentName(ui.select)}; void save(s => stepOrder(ents, s, target.name, act === 'up' ? -1 : 1, opts), '', {stay: act}); return; }
    if (act === 'unpreset') {
      const select = ui.select, yes = await askConfirm(b, {text: `‘${target.name}’을 회의명 목록에서 뺄까요?`, note: '아직 보고가 없는 회의예요. 필요하면 다시 넣을 수 있어요.', ok: '빼기'});
      if (!yes || ui?.select !== select) return;
      void save(s => removePreset(s, target.name), '목록에서 뺐어요.');
      return;
    }
    if (act === 'del') {
      const select = ui.select, yes = await askConfirm(b, {text: `‘${target.name}’을 회의명 목록에서 삭제할까요?`, note: '지난 보고·검색·연결은 그대로 남아요. 같은 이름을 다시 쓰면 목록에 돌아와요.', ok: '삭제'});
      if (!yes || ui?.select !== select) return;
      void save(s => setPlace(s, target.names, DEL), '목록에서 삭제했어요. 지난 보고는 그대로예요.');
    }
  }
});
panel.addEventListener('submit', async e => {
  if (!ui || !e.target.matches('[data-mnp-rename-form]')) return;
  e.preventDefault();
  const select = ui.select, target = ui.target, next = e.target.querySelector('[data-mnp-rename]').value.trim();
  ui.draft = next;
  if (!next) { ui.msg = '새 이름을 써 주세요.'; paint({focus: '[data-mnp-rename]'}); return; }
  if (next === target.name) { ui.mode = 'menu'; paint({focus: '[data-mnp-act]'}); return; }
  const n = names()?.count?.(target.name) ?? 0;
  if (target.preset && n === 0) {
    // S57-14 미리 넣은 회의(보고 없음): 바꿀 보고가 없으므로 정리 값의 이름만 바꾼다.
    const s = sorts(), problem = !s ? failText('unknown') : nameKey(next) === nameKey(target.name) ? '' : presetNameProblem(next, s, knownNames(select));
    if (problem) { ui.msg = problem; paint({focus: '[data-mnp-rename]'}); return; }
    ui.msg = '바꾸는 중…'; paint();
    const r = await changeSorts(x => moveName(x, target.name, next));
    if (!ui || ui.select !== select) return;
    if (!r.ok) { ui.msg = failText(r.reason); paint(); return; }
    renameInSelect(select, target.name, next);
    return;
  }
  const yes = await askConfirm(e.target.querySelector('button'), {text: `‘${target.name}’ 보고 ${n}건의 회의명을 ‘${next}’로 바꿀까요?`, note: '보고 글과 연결은 그대로예요.', ok: '바꾸기'});
  if (!yes || ui?.select !== select) return;
  ui.msg = '바꾸는 중…'; paint();
  const r = await names()?.rename?.(target.name, next).catch(() => ({ok: false}));
  if (!ui || ui.select !== select) return;
  if (!r?.ok) { ui.msg = r?.message || '이름을 바꾸지 못했어요. 다시 해 주세요.'; paint(); return; }
  if (hasMark(sorts(), target.name)) await changeSorts(s => moveName(s, target.name, next));
  renameInSelect(select, target.name, next);
});
// S57-14 '회의 미리 넣기' [추가]: 넣은 뒤에도 이 칸에 머문다(이어서 넣기). 조직은 고른 그대로.
panel.addEventListener('submit', async e => {
  if (!ui || !e.target.matches('[data-mnp-preset-form]')) return;
  e.preventDefault();
  const cur = ui, select = ui.select, s = sorts(), name = e.target.querySelector('[data-mnp-preset-name]').value.trim(), known = knownNames(select);
  if (cur.busy) return;
  cur.draft = name;
  const problem = !s ? failText('unknown') : presetNameProblem(name, s, known);
  if (problem) { cur.msg = problem; paint({focus: '[data-mnp-preset-name]'}); return; }
  const org = presetOrg(s);
  cur.busy = true; cur.msg = '저장하는 중…'; paint({focus: '[data-mnp-preset-name]'});
  const ents = entriesOf(select);
  const r = await changeSorts(x => { const next = addPreset(x, name, org, known); return !next || org === ETC ? next : toOrgEnd(ents, next, name); });
  cur.busy = false;
  if (ui !== cur) return;
  if (r.ok) { cur.draft = ''; cur.msg = `‘${name}’을 ‘${parentLabel(sorts(), org)}’에 추가했어요.`; paintOptions(select); }
  else cur.msg = failText(r.reason);
  paint({focus: '[data-mnp-preset-name]'});
});
panel.addEventListener('input', e => { if (ui && e.target.matches('[data-mnp-find]')) { ui.query = e.target.value; paint(); } else if (ui && e.target.matches('[data-mnp-rename],[data-mnp-preset-name]')) ui.draft = e.target.value; });
// 창 안 키는 문서 앞단(capture)에서 먼저 받는다: Esc가 뒤의 사업 보고 창까지 닫지 않게(select-menu.js와 같은 방식).
document.addEventListener('keydown', e => {
  if (!ui || e.isComposing || !(e.target instanceof Node) || !panel.contains(e.target)) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); if (ui.mode !== 'list') { ui.mode = ui.mode === 'menu' || ui.mode === 'preset' ? 'list' : 'menu'; paint({focus: '[data-mnp-find]'}); } else close(); return; }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.mnp-pick,.mnp-grp,.mnp-act,.mnp-link')) { e.preventDefault(); e.target.click(); return; }
  if (e.key === 'Enter' && e.target.matches('[data-mnp-find]')) { e.preventDefault(); const first = panel.querySelector('[data-mnp-pick]'); if (first && ui.query) choose(first.dataset.mnpPick); return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const items = [...panel.querySelectorAll('[data-mnp-find],.mnp-pick,.mnp-grp,.mnp-act')], i = items.indexOf(document.activeElement);
    const next = items[Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (next) { e.preventDefault(); next.focus({preventScroll: false}); }
  }
}, true);
// 바깥을 누르면 닫힘(누른 것은 그대로 동작). 확인 창(askConfirm)을 누르는 것은 바깥이 아니다.
document.addEventListener('pointerdown', e => {
  if (!ui) return;
  const t = e.target instanceof Element ? e.target : null;
  if (!t || panel.contains(t) || t === ui.select || t.closest('.kptu-ask')) return;
  close({focus: false});
}, true);
window.addEventListener('popstate', e => { if (ui && e.state?.[KEY] !== ui.id) close({fromBack: true, focus: false}); }, true);
window.addEventListener('kptu:meeting-name-sorts', () => { for (const s of document.querySelectorAll('select[data-name-panel]')) paintOptions(s); if (ui && ui.mode === 'list') paint({focus: document.activeElement?.matches?.('[data-mnp-find]') ? '[data-mnp-find]' : ''}); });
new MutationObserver(() => { if (ui && !ui.select.isConnected) close({focus: false}); }).observe(document.documentElement, {childList: true, subtree: true});

// ---- 새 회의명 종류(기타(직접 입력)일 때 입력 칸 옆) ----
// 처음부터 정기/비정기·상위를 고른다. 보이는 것은 새 이름일 때만(이미 있는 회의명이면 그 회의명 ⋯에서 바꿈). 저장(commitNewSort)할 때 기억한다.
function sortSelect(prefix) { return document.querySelector(`#${prefix}NameSort`); }
export function paintNewSort(prefix, {custom, name, known}) {
  const sel = sortSelect(prefix); if (!sel) return;
  const s = sorts(), isNew = custom && !!nameKey(name) && !known;
  sel.hidden = !isNew || !s;
  if (sel.hidden) return;
  // S56-1: 조직마다 정기·비정기(값 'r:조직 id' = 그 조직 정기, 조직 id = 그 조직 비정기). '정기 회의'·'비정기 · 기타'는 기타 조직.
  const keep = sel.value || REGULAR, opts = [[REGULAR, '정기 회의'], ...s.parents.flatMap(p => [['r:' + p.id, `정기 · ${p.name}`], [p.id, `비정기 · ${p.name}`]]), [ETC, '비정기 · 기타']];
  const sig = JSON.stringify(opts);
  if (sel._sig !== sig) { sel.innerHTML = opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join(''); sel._sig = sig; }
  sel.value = opts.some(([v]) => v === keep) ? keep : REGULAR;
}
export async function commitNewSort(prefix, name) {
  const sel = sortSelect(prefix), value = sel && !sel.hidden ? sel.value : REGULAR;
  if (sel) sel.value = REGULAR;
  if (!value || value === REGULAR || !nameKey(name)) {
    // 지웠던 이름을 다시 쓰면 목록에 돌아온다.
    if (sorts() && placeOf(sorts(), name).kind === DEL) await changeSorts(s => setPlace(s, name, REGULAR));
    return;
  }
  if (value.startsWith('r:')) { await changeSorts(s => setOrg(setPlace(s, name, REGULAR) || s, name, value.slice(2))); return; }
  await changeSorts(s => setPlace(s, name, value));
}

// ---- 붙이기 ----
// team.js setupMeetingNamePicker가 부른다(상자를 채울 때마다). entries: [{name, at}].
export function bindPicker(select, {entries}) {
  select._nameEntries = entries;
  select.dataset.namePanel = '1';
  select.setAttribute('aria-haspopup', 'dialog');
  // 정리는 창을 처음 열 때 읽는다(입력 창을 여는 것만으로는 서버에 묻지 않음 — 기존 '추가 요청 0건' 약속). 읽은 뒤에는 모든 상자에 바로 맞춘다.
  paintOptions(select);
}
const opener = {match: s => s.hasAttribute('data-name-panel') && s.options.length > 0, open};
if (window.KPTUSelectMenu?.addOpener) window.KPTUSelectMenu.addOpener(opener);
else document.addEventListener('DOMContentLoaded', () => window.KPTUSelectMenu?.addOpener?.(opener), {once: true});
export const _test = {open, close, get ui() { return ui; }};
