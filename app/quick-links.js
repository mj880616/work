import {waitHtml} from './wait-state.js';
// UI-자주가는링크 (2026-10-22 사용자 승인): PC 사이드바 [쓰기] 아래 '자주 가는 링크 ›' 한 줄이 여는 작은 창.
// - 창은 그 줄 오른쪽에서 위쪽으로 열린다(창 아래끝 = 줄 아래끝, 화면 밖으로 나가지 않음; anchored-popup.js beside:'up').
// - 바깥 누르기·Esc로 닫힌다. 링크는 새 탭(rel="noopener noreferrer").
// - 분류(처음엔 '업무'·'담당조직 홈페이지') 아래 링크가 2열. 창 오른쪽 위 [편집]으로 편집 상태.
// UI-자주가는링크편집 (2026-10-27 사용자 승인 시안): 편집 상태에서 오른쪽 위 작은 [+ 추가](링크·분류), 분류 줄 '이름 ⠿ … ✎ ⋯'
//   (✎ 이름 바꾸기, ⋯ 위로·아래로·지우기, ⠿ 끌어서 분류 순서), 링크 줄마다 ⠿(끌어서 순서·다른 분류로 옮기기, 키보드는 ↑↓).
//   링크가 든 분류를 지우면 '같이 지울까요 / 기타로 옮길까요'를 묻고 기본은 '기타'로 옮기기. 모든 고침은 [저장]을 눌러야 서버에 저장되고 [취소]로 버린다.
// 저장: 내 프로필 행의 quick_links(링크)·quick_link_groups(분류 목록·순서) 두 칸을 한 번의 PATCH로 같이 저장한다
//   (app_profiles, migration 20261022163000·20261027170000, 기존 owner RLS로 내 행만 PATCH). 분류 칸이 비어 있으면 '업무'·'담당조직 홈페이지' 두 분류,
//   링크 칸이 비어 있으면 아래 초기 링크를 보여 준다. 분류 칸이 아직 없으면(적용 전) 기존 링크 칸만 읽어 보여 주고 편집은 '저장 준비 중' 안내만 한다.
// 브라우저 기기 저장소는 쓰지 않는다 — 목록은 기기마다 같아야 한다.
import {placeAnchored,clearAnchored,followAnchor} from './anchored-popup.js';
import {createAnchoredMenu} from './anchored-menu.js';

// 분류 id는 영문 소문자·숫자 1~12자(표의 CHECK와 같은 규칙). 처음 두 분류는 옛 저장 모양 그대로 work·org.
export const DEFAULT_GROUPS = Object.freeze([['work', '업무'], ['org', '담당조직 홈페이지']].map(([id, name]) => Object.freeze({id, name})));
// 업무용 공개 주소(계정·비밀번호 없음).
export const DEFAULT_LINKS = Object.freeze([
  ['work', '조직관리시스템', 'https://www.kptu.net:8000/main'],
  ['work', '노조 NAS', 'https://kptu00.quickconnect.to/'],
  ['work', '궤도 NAS', 'https://data.railone.kr/'],
  ['work', '전자결재시스템', 'https://npasoneq.co.kr/npasoneq/index.html'],
  ['work', '문자·팩스 발송 시스템', 'https://letter.dlive.kr/'],
  ['work', '망고보드', 'https://www.mangoboard.net/'],
  ['work', '구글 시트', 'https://docs.google.com/spreadsheets/'],
  ['org', '공공운수노조', 'https://www.kptu.net'],
  ['org', '궤도협의회', 'https://railone.kr/'],
  ['org', '서울교통공사노조', 'http://www.stlu.kr/'],
  ['org', '전국철도노동조합', 'https://krwu.nodong.net'],
].map(([group, name, url]) => Object.freeze({group, name, url})));
export const LINK_MAX = 60, GROUP_MAX = 12, NAME_MAX = 40, GROUP_NAME_MAX = 20, URL_MAX = 2000;
// 링크가 든 분류를 지울 때 옮겨 갈 분류(없으면 이 이름으로 새로 만든다).
export const ETC_ID = 'etc', ETC_NAME = '기타';
const ID_RE = /^[a-z0-9]{1,12}$/;
const copyGroups = groups => groups.map(group => ({...group}));

// 이름: 앞뒤 공백을 뺀 1~40자, 제어문자 없음(표의 CHECK와 같은 규칙).
export function cleanName(value) {
  const name = String(value ?? '').trim();
  return name && [...name].length <= NAME_MAX && !/\p{Cc}/u.test(name) ? name : null;
}
// 분류 이름: 앞뒤 공백을 뺀 1~20자, 제어문자 없음.
export function cleanGroupName(value) {
  const name = String(value ?? '').trim();
  return name && [...name].length <= GROUP_NAME_MAX && !/\p{Cc}/u.test(name) ? name : null;
}
// 주소: http:// 또는 https://만. javascript:·data:·ftp: 등은 거절. 공백·제어문자 없음, 2000자까지.
// 주소창처럼 'www.example.org'만 쓰면 https://를 붙여 받는다(다른 형식의 주소는 붙이지 않고 거절).
export function cleanUrl(value) {
  let raw = String(value ?? '').trim();
  if (!raw || raw.length > URL_MAX || /[\s\p{Cc}]/u.test(raw)) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(raw) && /^[^/:?#]+\.[^/:?#]+(?::\d+)?(?:[/?#].*)?$/.test(raw)) raw = 'https://' + raw;
  if (!/^https?:\/\//i.test(raw)) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:' || !url.hostname) return null;
  } catch { return null; }
  return raw.length <= URL_MAX ? raw : null;
}
// 저장된 분류 목록을 화면용으로: 비어 있으면(null) 기본 두 분류, 올바른 목록이면 복사본, 모양이 틀리거나 id가 겹치면 null(아무것도 믿지 않음).
export function parseGroups(value) {
  if (value === null || value === undefined) return copyGroups(DEFAULT_GROUPS);
  if (!Array.isArray(value) || !value.length || value.length > GROUP_MAX) return null;
  const out = [], seen = new Set();
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    if (Object.keys(item).some(key => key !== 'id' && key !== 'name')) return null;
    const name = cleanGroupName(item.name);
    if (typeof item.id !== 'string' || !ID_RE.test(item.id) || seen.has(item.id) || name === null || name !== item.name) return null;
    seen.add(item.id);
    out.push({id: item.id, name});
  }
  return out;
}
// 저장된 값을 화면용으로: 올바른 목록이면 복사본, 비어 있으면(null) 초기 링크, 모양이 틀리면 null(아무것도 믿지 않음).
// groups는 그 링크들이 쓸 수 있는 분류(기본 두 분류) — 목록에 없는 분류를 가리키는 링크는 모양이 틀린 것으로 본다.
export function parseLinks(value, groups = DEFAULT_GROUPS) {
  if (value === null || value === undefined) return DEFAULT_LINKS.map(link => ({...link}));
  if (!Array.isArray(value) || value.length > LINK_MAX) return null;
  const ids = new Set(groups.map(group => group.id));
  const out = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    if (Object.keys(item).some(key => !['group', 'name', 'url'].includes(key))) return null;
    if (typeof item.group !== 'string' || !ids.has(item.group)) return null;
    const name = cleanName(item.name), url = typeof item.url === 'string' ? cleanUrl(item.url) : null;
    if (name !== item.name || url !== item.url) return null;
    out.push({group: item.group, name, url});
  }
  return out;
}
// 편집 칸의 값들을 저장할 목록으로. 틀린 줄은 errors에 [번호, 'name'|'url'|'group'] (링크 줄 번호),
// 분류는 [분류 번호, 'gname'|'gdup'], 개수는 [-1, 'count'|'gcount'].
export function validateDraft(rows, groups = DEFAULT_GROUPS) {
  const links = [], errors = [], cleanGroups = [], names = new Set();
  groups.forEach((group, index) => {
    const name = cleanGroupName(group.name);
    if (!name) errors.push([index, 'gname']);
    else if (names.has(name)) errors.push([index, 'gdup']);
    else { names.add(name); cleanGroups.push({id: group.id, name}); }
  });
  if (groups.length < 1 || groups.length > GROUP_MAX) errors.push([-1, 'gcount']);
  const ids = new Set(groups.map(group => group.id));
  rows.forEach((row, index) => {
    const name = cleanName(row.name), url = cleanUrl(row.url);
    if (!name) errors.push([index, 'name']);
    if (!url) errors.push([index, 'url']);
    if (!ids.has(row.group)) errors.push([index, 'group']);
    if (name && url && ids.has(row.group)) links.push({group: row.group, name, url});
  });
  if (rows.length > LINK_MAX) errors.push([-1, 'count']);
  return {links, groups: cleanGroups, errors};
}

// ---- 편집 모델(화면 없이 계산; 시험은 tests/quick-links*.test.mjs) ----
// 같은 분류 안에서 from 줄을 to 줄 자리로 옮긴 새 배열.
export function moveWithinGroup(rows, from, to) {
  if (from === to || !rows[from] || !rows[to] || rows[from].group !== rows[to].group) return rows;
  const next = [...rows], [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
// 링크 한 줄(from)을 옮긴다. target: {before: 줄 번호} | {after: 줄 번호} | {into: 분류 id}(그 분류 맨 끝).
// 다른 분류의 줄 앞·뒤나 분류 끝으로 옮기면 분류도 바뀐다. 줄 배열에서 분류끼리의 앞뒤는 상관없고 분류 안의 앞뒤만 화면 순서가 된다.
// 돌려주는 값: {rows, to}(to = 옮겨진 줄의 새 번호). 옮길 곳이 없거나 자기 자신 옆이면 rows는 그대로.
export function moveLink(rows, from, target) {
  const item = rows[from];
  if (!item || !target) return {rows, to: from};
  const at = 'before' in target ? target.before : 'after' in target ? target.after : -1;
  if ('into' in target) {
    const next = rows.filter((_, i) => i !== from);
    let last = -1;
    next.forEach((row, i) => { if (row.group === target.into) last = i; });
    const index = last < 0 ? next.length : last + 1;
    next.splice(index, 0, {...item, group: target.into});
    return {rows: next, to: index};
  }
  const anchor = rows[at];
  if (!anchor || at === from) return {rows, to: from};
  const next = rows.filter((_, i) => i !== from), pos = next.indexOf(anchor), index = 'before' in target ? pos : pos + 1;
  next.splice(index, 0, {...item, group: anchor.group});
  return {rows: next, to: index};
}
// 키보드 ↑(-1)·↓(+1) 한 칸: 분류 안에서 이웃과 자리를 바꾸고, 분류 맨 위/아래에서는 이웃 분류의 끝/처음으로 넘어간다.
export function moveLinkStep(rows, groups, from, delta) {
  const item = rows[from];
  if (!item) return {rows, to: from};
  const same = rows.map((_, i) => i).filter(i => rows[i].group === item.group), pos = same.indexOf(from);
  const inside = same[pos + delta];
  if (inside !== undefined) return moveLink(rows, from, delta < 0 ? {before: inside} : {after: inside});
  const g = groups.findIndex(group => group.id === item.group), other = groups[g + delta];
  if (!other) return {rows, to: from};
  if (delta < 0) return moveLink(rows, from, {into: other.id});
  const first = rows.findIndex(row => row.group === other.id);
  return first < 0 ? moveLink(rows, from, {into: other.id}) : moveLink(rows, from, {before: first});
}
// 분류 한 개를 from에서 to 자리로(0~끝으로 맞춤).
export function moveGroup(groups, from, to) {
  if (!groups[from]) return groups;
  const target = Math.max(0, Math.min(groups.length - 1, to));
  if (target === from) return groups;
  const next = [...groups], [item] = next.splice(from, 1);
  next.splice(target, 0, item);
  return next;
}
// 새 분류 id: 'g' + 영문 소문자·숫자 6자(겹치면 다시). rand는 시험용으로 바꿀 수 있다.
export function newGroupId(groups, rand = Math.random) {
  const taken = new Set(groups.map(group => group.id));
  for (let tries = 0; tries < 50; tries++) {
    let id = 'g';
    for (let i = 0; i < 6; i++) id += Math.floor(rand() * 36).toString(36);
    if (!taken.has(id)) return id;
  }
  throw new Error('group id exhausted');
}
// 새 분류의 기본 이름: '새 분류', 겹치면 '새 분류 2', '새 분류 3'…
export function newGroupName(groups) {
  const names = new Set(groups.map(group => group.name));
  if (!names.has('새 분류')) return '새 분류';
  for (let n = 2; ; n++) if (!names.has(`새 분류 ${n}`)) return `새 분류 ${n}`;
}
// 분류를 지울 때 링크가 옮겨 갈 분류: 이름이 '기타'인 다른 분류, 없으면 새 '기타'(지우는 분류가 '기타' 자신이면 첫 다른 분류).
// 분류가 하나뿐이면 null(지울 수 없음).
export function moveTarget(groups, id) {
  if (groups.length < 2 || !groups.some(group => group.id === id)) return null;
  const etc = groups.find(group => group.id !== id && group.name === ETC_NAME);
  if (etc) return {id: etc.id, name: etc.name, created: false};
  const self = groups.find(group => group.id === id);
  if (self.name === ETC_NAME) { const first = groups.find(group => group.id !== id); return {id: first.id, name: first.name, created: false}; }
  const free = !groups.some(group => group.id === ETC_ID);
  return {id: free ? ETC_ID : newGroupId(groups), name: ETC_NAME, created: true};
}
// 분류 지우기. mode 'move' = 그 분류의 링크를 moveTarget 분류 끝으로(기본), 'delete' = 링크도 같이 지움. {groups, rows, moved, target}.
export function removeGroup(groups, rows, id, mode) {
  const target = moveTarget(groups, id);
  if (!target) return null;
  const remaining = groups.filter(group => group.id !== id);
  const inside = rows.filter(row => row.group === id), others = rows.filter(row => row.group !== id);
  if (mode === 'delete') return {groups: remaining, rows: others, moved: 0, deleted: inside.length, target: null};
  if (target.created) remaining.push({id: target.id, name: target.name});
  return {groups: remaining, rows: [...others, ...inside.map(row => ({...row, group: target.id}))], moved: inside.length, deleted: 0, target};
}
// 분류 맨 끝에 빈 링크 한 줄. {rows, at}(at = 새 줄 번호).
export function addLinkRow(rows, groupId) {
  const next = [...rows];
  let last = -1;
  next.forEach((row, i) => { if (row.group === groupId) last = i; });
  const at = last < 0 ? next.length : last + 1;
  next.splice(at, 0, {group: groupId, name: '', url: ''});
  return {rows: next, at};
}

const profileUrl = rt => {
  const user = rt?.context?.read?.()?.user?.id;
  return user ? `/rest/v1/app_profiles?user_id=eq.${encodeURIComponent(user)}` : '';
};
const defaultState = status => ({status, links: DEFAULT_LINKS.map(link => ({...link})), groups: copyGroups(DEFAULT_GROUPS)});
// {status:'ok', links, groups} | {status:'pending', …} (분류 칸이 아직 없음: 링크 칸만 읽은 것) | {status:'error', 초기 링크·기본 분류}
export async function readLinks(rt = globalThis.window?.KPTURuntime) {
  const url = profileUrl(rt);
  if (!url) return defaultState('error');
  try {
    const rows = await rt.api(`${url}&select=quick_links,quick_link_groups&limit=1`);
    if (!Array.isArray(rows) || rows.length !== 1) return defaultState('error');
    const groups = parseGroups(rows[0]?.quick_link_groups);
    if (!groups) return defaultState('error');
    // 링크 칸이 비어 있어도 분류를 고친 적이 있으면 초기 링크(옛 두 분류용)는 맞지 않으니 빈 목록으로 둔다.
    const raw = rows[0]?.quick_links;
    const links = (raw === null || raw === undefined) && rows[0]?.quick_link_groups != null ? [] : parseLinks(raw, groups);
    return links ? {status: 'ok', links, groups} : defaultState('error');
  } catch (error) {
    // PostgREST: 없는 칸을 고르면 400(42703). 분류 칸이 아직 없는 적용 전 상태인지 링크 칸만 다시 읽어 본다.
    if (error?.status !== 400) return defaultState('error');
    try {
      const rows = await rt.api(`${url}&select=quick_links&limit=1`);
      const links = Array.isArray(rows) && rows.length === 1 ? parseLinks(rows[0]?.quick_links) : null;
      return links ? {status: 'pending', links, groups: copyGroups(DEFAULT_GROUPS)} : defaultState('pending');
    } catch { return defaultState('pending'); }
  }
}
// 링크와 분류를 한 번의 PATCH로 같이 저장한다(표 검사가 둘이 서로 맞는지 본다).
export async function saveLinks(links, groups, rt = globalThis.window?.KPTURuntime) {
  const url = profileUrl(rt);
  if (!url || parseGroups(groups) === null || parseLinks(links, groups) === null) return {ok: false};
  try {
    const saved = await rt.api(url, {method: 'PATCH', prefer: 'return=representation', body: {quick_links: links, quick_link_groups: groups}});
    const row = Array.isArray(saved) && saved.length === 1 ? saved[0] : null;
    const backGroups = row ? parseGroups(row.quick_link_groups) : null;
    const backLinks = backGroups ? parseLinks(row.quick_links, backGroups) : null;
    return backLinks ? {ok: true, links: backLinks, groups: backGroups} : {ok: false};
  } catch (error) { return {ok: false, pending: error?.status === 400}; }
}

// ---- 창 ----
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const state = {status: 'idle', links: null, groups: null, trigger: null, stop: null, editing: false, draft: [], draftGroups: [], confirm: '', lastGroup: '', saving: false, note: '', loadSeq: 0};
let panel = null, menu = null, drag = null, renaming = null;

function ensurePanel() {
  if (panel) return panel;
  panel = document.createElement('div');
  panel.id = 'quickLinksPanel';
  panel.className = 'quick-links-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', '자주 가는 링크');
  panel.hidden = true;
  document.body.append(panel);
  menu = createAnchoredMenu({id: 'quickLinksMenu', className: 'ql-menu', label: '자주 가는 링크 메뉴', historyKey: 'kptuQuickLinksMenu', key: trigger => trigger.dataset.qlMenu, render: menuHtml,
    onAction: (button, active) => menuAction(active.id, button.dataset.qlAct)});
  panel.addEventListener('click', onClick);
  panel.addEventListener('keydown', onKeydown);
  panel.addEventListener('input', onInput);
  panel.addEventListener('focusin', event => { const section = event.target.closest?.('[data-ql-group]'); if (section) state.lastGroup = section.dataset.qlGroup; });
  panel.addEventListener('dragstart', onDragStart);
  panel.addEventListener('dragover', onDragOver);
  panel.addEventListener('drop', onDrop);
  panel.addEventListener('dragend', endDrag);
  return panel;
}

function menuHtml(key) {
  if (key === 'add') return '<button type="button" data-ql-act="addLink">링크 추가</button><button type="button" data-ql-act="addGroup">분류 추가</button>';
  const id = key.startsWith('g:') ? key.slice(2) : '', index = state.draftGroups.findIndex(group => group.id === id);
  if (index < 0) return '';
  return '<button type="button" data-ql-act="rename">이름 바꾸기</button>'
    + (index > 0 ? '<button type="button" data-ql-act="up">위로</button>' : '')
    + (index < state.draftGroups.length - 1 ? '<button type="button" data-ql-act="down">아래로</button>' : '')
    + (state.draftGroups.length > 1 ? '<hr class="ql-menu-sep" role="separator"><button type="button" class="ql-menu-danger" data-ql-act="delete">분류 지우기</button>' : '');
}

function viewHtml() {
  const links = state.links || [], groups = state.groups || [];
  const sections = groups.map(({id, name}) => {
    const items = links.filter(link => link.group === id);
    const list = items.length
      ? `<ul class="ql-grid">${items.map(link => `<li><a href="${esc(link.url)}" target="_blank" rel="noopener noreferrer" title="${esc(link.url)}">${esc(link.name)}</a></li>`).join('')}</ul>`
      : '<p class="ql-empty">링크가 없습니다.</p>';
    return `<section class="ql-group" aria-label="${esc(name)}"><h3>${esc(name)}</h3>${list}</section>`;
  }).join('');
  const loading = state.status === 'loading' && !state.links;
  return `<div class="ql-head"><h2>자주 가는 링크</h2><button type="button" class="ql-btn" data-ql-edit ${loading ? 'disabled' : ''}>편집</button></div>`
    + (loading ? waitHtml({rows:3}) : sections)
    + `<p class="ql-note" role="status" aria-live="polite">${esc(state.note)}</p>`;
}

function confirmHtml(id) {
  const target = moveTarget(state.draftGroups, id), count = state.draft.filter(row => row.group === id).length;
  return `<div class="ql-confirm" role="group" aria-label="분류 지우기 확인"><p>링크 ${count}개가 들어 있어요. 같이 지울까요, '${esc(target?.name || ETC_NAME)}'로 옮길까요?</p>`
    + `<div class="ql-confirm-btns"><button type="button" class="ql-btn" data-ql-confirm="move">'${esc(target?.name || ETC_NAME)}'로 옮기기</button>`
    + '<button type="button" class="ql-btn ql-remove" data-ql-confirm="delete">같이 지우기</button><button type="button" class="ql-btn" data-ql-confirm="cancel">취소</button></div></div>';
}

function editHtml() {
  const sections = state.draftGroups.map(({id, name}) => {
    const rows = state.draft.map((row, index) => ({row, index})).filter(({row}) => row.group === id);
    const list = rows.length
      ? `<ol class="ql-edit-list">${rows.map(({row, index}) => `<li class="ql-edit-row" data-ql-row="${index}">`
        + `<button type="button" class="ql-handle" draggable="true" data-ql-handle="${index}" aria-label="${esc(row.name || '새 링크')} 순서 바꾸기(끌거나 위·아래 화살표)">⠿</button>`
        + `<input class="ql-name" data-ql-field="name" data-ql-index="${index}" value="${esc(row.name)}" maxlength="${NAME_MAX}" placeholder="이름" aria-label="이름">`
        + `<input class="ql-url" data-ql-field="url" data-ql-index="${index}" value="${esc(row.url)}" placeholder="https://" aria-label="주소" inputmode="url" spellcheck="false" autocomplete="off">`
        + `<button type="button" class="ql-btn ql-remove" data-ql-remove="${index}" aria-label="${esc(row.name || '새 링크')} 삭제">삭제</button></li>`).join('')}</ol>`
      : '<p class="ql-empty">링크가 없습니다. 다른 분류의 링크를 끌어다 놓을 수 있어요.</p>';
    return `<section class="ql-group" data-ql-group="${esc(id)}" aria-label="${esc(name)} 편집"><div class="ql-group-head">`
      + `<h3 class="ql-gname" data-ql-gname="${esc(id)}">${esc(name)}</h3>`
      + `<button type="button" class="ql-handle" draggable="true" data-ql-ghandle="${esc(id)}" aria-label="분류 순서 바꾸기(끌거나 위·아래 화살표)">⠿</button>`
      + '<span class="ql-spacer"></span>'
      + `<button type="button" class="ql-icon" data-ql-rename="${esc(id)}" aria-label="분류 이름 바꾸기">✎</button>`
      + `<button type="button" class="ql-icon" data-ql-menu="g:${esc(id)}" aria-haspopup="menu" aria-expanded="false" aria-label="분류 메뉴"><span class="more-dots" aria-hidden="true">⋯</span></button></div>`
      + (state.confirm === id ? confirmHtml(id) : '') + list + '</section>';
  }).join('');
  return '<div class="ql-head"><h2>자주 가는 링크 편집</h2><button type="button" class="ql-btn ql-add" data-ql-menu="add" aria-haspopup="menu" aria-expanded="false">+ 추가</button></div>'
    + sections
    + `<p class="ql-note" role="status" aria-live="polite">${esc(state.note)}</p>`
    + `<div class="ql-foot"><button type="button" class="ql-btn" data-ql-cancel>취소</button><button type="button" class="ql-btn ql-primary" data-ql-save ${state.saving ? 'disabled aria-busy="true"' : ''}>${state.saving ? '저장 중…' : '저장'}</button></div>`;
}

function render({focus = ''} = {}) {
  if (!panel || panel.hidden) return;
  renaming = null;
  panel.classList.toggle('ql-editing', state.editing);
  panel.innerHTML = state.editing ? editHtml() : viewHtml();
  place();
  if (focus) panel.querySelector(focus)?.focus({preventScroll: true});
}
function place() {
  if (!panel || panel.hidden || !state.trigger) return;
  placeAnchored(panel, state.trigger, {beside: 'up', maxWidth: state.editing ? 640 : 440, maxHeight: 640, gap: 6});
}

async function load() {
  const seq = ++state.loadSeq;
  if (!state.links) state.status = 'loading';
  render();
  const result = await readLinks();
  if (seq !== state.loadSeq) return;
  state.status = result.status;
  if (result.status === 'ok' || !state.links) { state.links = result.links; state.groups = result.groups; }
  if (!state.editing) render();
}

export function isOpen() { return !!panel && !panel.hidden; }
export function open(trigger) {
  ensurePanel();
  if (isOpen()) { close(); return; }
  state.trigger = trigger;
  state.editing = false; state.note = ''; state.confirm = '';
  panel.hidden = false;
  trigger.setAttribute('aria-expanded', 'true');
  render();
  state.stop = followAnchor(panel, trigger, {place, lost: () => close({focus: false})});
  document.addEventListener('pointerdown', onOutside, true);
  document.addEventListener('keydown', onEscape, true);
  void load().then(() => { if (isOpen() && !state.editing) panel.querySelector('a,[data-ql-edit]')?.focus({preventScroll: true}); });
  panel.querySelector('[data-ql-edit]')?.focus({preventScroll: true});
}
export function close({focus = true} = {}) {
  if (!isOpen()) return;
  menu?.close();
  state.stop?.(); state.stop = null;
  document.removeEventListener('pointerdown', onOutside, true);
  document.removeEventListener('keydown', onEscape, true);
  renaming = null; drag = null;
  panel.hidden = true; panel.innerHTML = ''; clearAnchored(panel);
  state.editing = false; state.draft = []; state.draftGroups = []; state.confirm = ''; state.note = '';
  const trigger = state.trigger; state.trigger = null;
  trigger?.setAttribute('aria-expanded', 'false');
  if (focus && trigger?.isConnected) trigger.focus({preventScroll: true});
}
function dirty() {
  const links = state.links || [], groups = state.groups || [];
  return state.draft.length !== links.length || state.draftGroups.length !== groups.length
    || state.draft.some((row, i) => row.group !== links[i].group || row.name !== links[i].name || row.url !== links[i].url)
    || state.draftGroups.some((group, i) => group.id !== groups[i].id || group.name !== groups[i].name);
}
function onOutside(event) {
  if (panel.contains(event.target) || state.trigger?.contains(event.target) || event.target.closest?.('.ql-menu')) return;
  // 고치던 내용이 있으면 바깥을 눌러도 버리지 않는다(저장 또는 취소).
  if (state.editing && dirty()) { state.note = '고친 내용이 있어요. [저장] 또는 [취소]를 눌러 주세요.'; render(); return; }
  close({focus: false});
}
function onEscape(event) {
  if (event.key !== 'Escape' || !isOpen()) return;
  // 열린 ⋯·+ 추가 메뉴는 자기 Esc가 먼저 닫는다(anchored-menu.js).
  if (menu?.active) return;
  event.preventDefault(); event.stopPropagation();
  if (renaming) { finishRename(false); return; }
  if (state.confirm) { state.confirm = ''; render({focus: `[data-ql-menu="g:${CSS.escape(event.target?.closest?.('[data-ql-group]')?.dataset.qlGroup || '')}"]`}); return; }
  if (state.editing) { leaveEdit(); return; }
  close();
}
function enterEdit() {
  if (state.status === 'pending') { state.note = '저장 준비 중이에요. 저장 칸이 준비되면 편집할 수 있어요(지금은 저장된 링크를 그대로 보여 줘요).'; render({focus: '[data-ql-edit]'}); return; }
  if (state.status !== 'ok') { state.note = '목록을 불러오지 못해 편집할 수 없어요. 창을 닫았다 다시 열어 주세요.'; render({focus: '[data-ql-edit]'}); return; }
  state.editing = true; state.note = ''; state.confirm = ''; state.lastGroup = '';
  state.draft = state.links.map(link => ({...link}));
  state.draftGroups = copyGroups(state.groups);
  render({focus: '.ql-name'});
}
function leaveEdit() {
  state.editing = false; state.draft = []; state.draftGroups = []; state.confirm = ''; state.note = '';
  render({focus: '[data-ql-edit]'});
}
const NOTES = {
  count: `링크는 ${LINK_MAX}개까지 둘 수 있어요.`, gcount: `분류는 1~${GROUP_MAX}개까지 둘 수 있어요.`,
  gname: `분류 이름을 1~${GROUP_NAME_MAX}자로 써 주세요.`, gdup: '같은 이름의 분류가 있어요. 이름을 다르게 써 주세요.',
  group: '분류에 속하지 않은 링크가 있어요. 창을 닫았다 다시 열어 주세요.',
  url: '주소는 http:// 또는 https://로 시작하는 웹 주소만 쓸 수 있어요.', name: `이름을 1~${NAME_MAX}자로 써 주세요.`,
};
async function save() {
  if (state.saving) return;
  if (renaming) finishRename(true);
  const {links, groups, errors} = validateDraft(state.draft, state.draftGroups);
  panel.querySelectorAll('[aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));
  if (errors.length) {
    for (const [index, field] of errors) panel.querySelector(`[data-ql-index="${index}"][data-ql-field="${field}"]`)?.setAttribute('aria-invalid', 'true');
    const first = errors.find(([index, field]) => index >= 0 && (field === 'name' || field === 'url'));
    const kind = ['gcount', 'gname', 'gdup', 'count', 'group'].find(key => errors.some(([, field]) => field === key))
      || (errors.some(([, field]) => field === 'url') ? 'url' : 'name');
    state.note = NOTES[kind];
    panel.querySelector('.ql-note').textContent = state.note;
    if (first) panel.querySelector(`[data-ql-index="${first[0]}"][data-ql-field="${first[1]}"]`)?.focus();
    return;
  }
  state.saving = true; state.note = ''; state.confirm = ''; render();
  const result = await saveLinks(links, groups);
  state.saving = false;
  if (!isOpen()) return;
  if (result.ok) { state.links = result.links; state.groups = result.groups; state.status = 'ok'; state.editing = false; state.draft = []; state.draftGroups = []; state.note = '저장했어요.'; render({focus: '[data-ql-edit]'}); return; }
  if (result.pending) state.status = 'pending';
  state.note = result.pending ? '저장 준비 중이에요. 저장 칸이 준비되면 저장할 수 있어요.' : '저장하지 못했어요. 다시 시도해 주세요.';
  render({focus: '[data-ql-save]'});
}

// ---- 분류 이름 바꾸기: 그 자리에서 글자 칸으로 바꿨다가 [Enter]·다른 곳 누르기로 확정(전체를 다시 그리지 않아 다른 버튼 누르기를 가로채지 않는다) ----
function startRename(id) {
  const heading = panel.querySelector(`[data-ql-gname="${CSS.escape(id)}"]`), group = state.draftGroups.find(item => item.id === id);
  if (!heading || !group) return;
  if (renaming) finishRename(true);
  const input = document.createElement('input');
  input.className = 'ql-gname-input';
  input.value = group.name; input.maxLength = GROUP_NAME_MAX; input.autocomplete = 'off';
  input.setAttribute('aria-label', '분류 이름');
  heading.replaceWith(input);
  renaming = {id, input, heading, original: group.name};
  input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); finishRename(true); } });
  input.addEventListener('blur', () => { if (renaming?.input === input) finishRename(true); });
  input.focus(); input.select();
}
function finishRename(commit) {
  if (!renaming) return;
  const {id, input, heading, original} = renaming;
  renaming = null;
  const group = state.draftGroups.find(item => item.id === id);
  let name = original;
  if (commit && group) {
    const clean = cleanGroupName(input.value);
    if (!clean) state.note = NOTES.gname;
    else if (state.draftGroups.some(item => item.id !== id && item.name === clean)) state.note = NOTES.gdup;
    else { name = clean; state.note = ''; }
  }
  if (group) group.name = name;
  heading.textContent = name;
  if (input.isConnected) input.replaceWith(heading);
  const section = heading.closest('[data-ql-group]');
  section?.setAttribute('aria-label', `${name} 편집`);
  const note = panel.querySelector('.ql-note');
  if (note) note.textContent = state.note;
}

// ---- ⋯·+ 추가 메뉴 ----
function menuAction(key, action) {
  if (!state.editing) return;
  const id = key.startsWith('g:') ? key.slice(2) : '';
  if (key === 'add') { if (action === 'addLink') addLink(); else if (action === 'addGroup') addGroup(); return; }
  const index = state.draftGroups.findIndex(group => group.id === id);
  if (index < 0) return;
  if (action === 'rename') startRename(id);
  else if (action === 'up' || action === 'down') {
    state.draftGroups = moveGroup(state.draftGroups, index, index + (action === 'up' ? -1 : 1));
    state.note = ''; render({focus: `[data-ql-menu="g:${CSS.escape(id)}"]`});
  } else if (action === 'delete') deleteGroup(id);
}
function addLink() {
  if (state.draft.length >= LINK_MAX) { state.note = NOTES.count; render(); return; }
  const group = state.draftGroups.some(item => item.id === state.lastGroup) ? state.lastGroup : state.draftGroups[0]?.id;
  if (!group) return;
  const {rows, at} = addLinkRow(state.draft, group);
  state.draft = rows; state.note = '';
  render({focus: `[data-ql-index="${at}"][data-ql-field="name"]`});
}
function addGroup() {
  if (state.draftGroups.length >= GROUP_MAX) { state.note = NOTES.gcount; render(); return; }
  const id = newGroupId(state.draftGroups);
  state.draftGroups = [...state.draftGroups, {id, name: newGroupName(state.draftGroups)}];
  state.lastGroup = id; state.note = '';
  render();
  const heading = panel.querySelector(`[data-ql-gname="${CSS.escape(id)}"]`);
  heading?.scrollIntoView?.({block: 'nearest'});
  startRename(id);
}
function deleteGroup(id) {
  if (state.draftGroups.length < 2) { state.note = '분류는 하나 이상 있어야 해요.'; render(); return; }
  if (state.draft.some(row => row.group === id)) {
    state.confirm = id; state.note = '';
    render({focus: '[data-ql-confirm="move"]'});
    return;
  }
  applyRemove(id, 'delete');
}
function applyRemove(id, mode) {
  const result = removeGroup(state.draftGroups, state.draft, id, mode);
  state.confirm = '';
  if (!result) { render(); return; }
  state.draftGroups = result.groups; state.draft = result.rows;
  state.note = mode === 'move' && result.moved ? `링크 ${result.moved}개를 '${result.target.name}'로 옮겼어요. [저장]을 눌러야 반영돼요.`
    : mode === 'delete' && result.deleted ? `분류와 링크 ${result.deleted}개를 지웠어요. [저장]을 눌러야 반영돼요.` : '';
  render({focus: '[data-ql-menu="add"]'});
}

function onClick(event) {
  const target = event.target.closest('button');
  if (!target) return;
  if (target.matches('[data-ql-edit]')) enterEdit();
  else if (target.matches('[data-ql-cancel]')) leaveEdit();
  else if (target.matches('[data-ql-save]')) void save();
  else if (target.matches('[data-ql-menu]')) menu?.open(target);
  else if (target.matches('[data-ql-rename]')) startRename(target.dataset.qlRename);
  else if (target.matches('[data-ql-confirm]')) {
    const id = state.confirm, choice = target.dataset.qlConfirm;
    if (choice === 'cancel') { state.confirm = ''; render({focus: `[data-ql-menu="g:${CSS.escape(id)}"]`}); }
    else applyRemove(id, choice);
  } else if (target.matches('[data-ql-remove]')) {
    const index = Number(target.dataset.qlRemove), group = state.draft[index]?.group;
    state.draft.splice(index, 1);
    render();
    const rest = [...panel.querySelectorAll('.ql-edit-row')].map(el => Number(el.dataset.qlRow)).filter(i => state.draft[i]?.group === group);
    (panel.querySelector(`[data-ql-remove="${rest.find(i => i >= index) ?? rest.at(-1)}"]`) || panel.querySelector(`[data-ql-menu="g:${CSS.escape(group || '')}"]`))?.focus({preventScroll: true});
  }
}
function onInput(event) {
  const input = event.target.closest('[data-ql-field]');
  if (!input) return;
  const row = state.draft[Number(input.dataset.qlIndex)];
  if (row) row[input.dataset.qlField] = input.value;
  input.removeAttribute('aria-invalid');
}
// 손잡이(⠿)에서 ↑↓: 링크는 한 칸(분류 맨 위/아래에서는 이웃 분류로), 분류는 한 칸.
function onKeydown(event) {
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
  const delta = event.key === 'ArrowUp' ? -1 : 1;
  const link = event.target.closest?.('[data-ql-handle]'), grp = event.target.closest?.('[data-ql-ghandle]');
  if (link) {
    event.preventDefault();
    const moved = moveLinkStep(state.draft, state.draftGroups, Number(link.dataset.qlHandle), delta);
    if (moved.rows === state.draft) return;
    state.draft = moved.rows; state.note = '';
    render({focus: `[data-ql-handle="${moved.to}"]`});
  } else if (grp) {
    event.preventDefault();
    const from = state.draftGroups.findIndex(group => group.id === grp.dataset.qlGhandle), next = moveGroup(state.draftGroups, from, from + delta);
    if (next === state.draftGroups) return;
    state.draftGroups = next; state.note = '';
    render({focus: `[data-ql-ghandle="${CSS.escape(grp.dataset.qlGhandle)}"]`});
  }
}

// ---- 끌어 놓기(PC 마우스) ----
// 자료실 폴더 끌기(library-folders.js)와 같은 방식: 손잡이를 잡고 끌면 놓을 곳이 표시된다 — 줄·분류의 위/아래 반쪽은 앞·뒤 선, 분류 줄은 점선 테두리 '여기에 놓기'(그 분류 맨 끝).
// 링크는 같은 분류 안에서 순서가 바뀌고 다른 분류로도 옮겨진다. 분류 손잡이는 분류끼리의 순서만 바꾼다. 안에서 시작한 끌기만 본다.
const MARKS = ['ql-drop-before', 'ql-drop-after', 'ql-drop-into', 'ql-drop-no'];
function clearMarks() { panel?.querySelectorAll(`.${MARKS.join(',.')},.ql-dragging`).forEach(el => el.classList.remove(...MARKS, 'ql-dragging')); }
function endDrag() { drag = null; clearMarks(); }
function onDragStart(event) {
  const link = event.target.closest?.('[data-ql-handle]'), grp = event.target.closest?.('[data-ql-ghandle]');
  if (!link && !grp) return;
  const source = link ? link.closest('.ql-edit-row') : grp.closest('.ql-group');
  drag = link ? {kind: 'link', index: Number(link.dataset.qlHandle)} : {kind: 'group', id: grp.dataset.qlGhandle};
  event.dataTransfer.effectAllowed = 'move';
  try { event.dataTransfer.setData('text/plain', link ? link.dataset.qlHandle : grp.dataset.qlGhandle); } catch {}
  try { event.dataTransfer.setDragImage(link ? source : grp.closest('.ql-group-head'), 12, 12); } catch {}
  source?.classList.add('ql-dragging');
}
// 놓을 곳: {ok, mark(표시할 요소), cls(표시 종류), ...} 또는 null(여기는 놓는 곳이 아님).
function dropFor(event) {
  if (!drag || !(event.target instanceof Element)) return null;
  const section = event.target.closest('.ql-group[data-ql-group]');
  if (drag.kind === 'link') {
    const row = event.target.closest('.ql-edit-row');
    if (row) {
      const index = Number(row.dataset.qlRow);
      if (index === drag.index) return {ok: false, mark: row, cls: 'ql-drop-no'};
      const box = row.getBoundingClientRect(), after = event.clientY >= box.top + box.height / 2;
      return {ok: true, mark: row, cls: after ? 'ql-drop-after' : 'ql-drop-before', target: after ? {after: index} : {before: index}};
    }
    return section ? {ok: true, mark: section.querySelector('.ql-group-head'), cls: 'ql-drop-into', target: {into: section.dataset.qlGroup}} : null;
  }
  if (!section) return null;
  if (section.dataset.qlGroup === drag.id) return {ok: false, mark: section, cls: 'ql-drop-no'};
  const box = section.getBoundingClientRect(), after = event.clientY >= box.top + box.height / 2;
  return {ok: true, mark: section, cls: after ? 'ql-drop-after' : 'ql-drop-before', group: section.dataset.qlGroup, after};
}
function showMark(drop) {
  panel.querySelectorAll(`.${MARKS.join(',.')}`).forEach(el => { if (el !== drop?.mark) el.classList.remove(...MARKS); });
  if (!drop) return;
  drop.mark.classList.remove(...MARKS);
  drop.mark.classList.add(drop.cls);
}
function onDragOver(event) {
  const drop = dropFor(event);
  showMark(drop);
  if (!drop) return;
  if (!drop.ok) { try { event.dataTransfer.dropEffect = 'none'; } catch {} return; }
  event.preventDefault();
  try { event.dataTransfer.dropEffect = 'move'; } catch {}
}
function onDrop(event) {
  const drop = dropFor(event), source = drag;
  endDrag();
  if (!drop?.ok || !source) return;
  event.preventDefault();
  if (source.kind === 'link') {
    const moved = moveLink(state.draft, source.index, drop.target);
    if (moved.rows === state.draft) return;
    state.draft = moved.rows; state.note = '';
    render({focus: `[data-ql-handle="${moved.to}"]`});
  } else {
    const from = state.draftGroups.findIndex(group => group.id === source.id), at = state.draftGroups.findIndex(group => group.id === drop.group);
    if (from < 0 || at < 0) return;
    const to = drop.after ? (from < at ? at : at + 1) : (from < at ? at - 1 : at);
    const next = moveGroup(state.draftGroups, from, to);
    if (next === state.draftGroups) return;
    state.draftGroups = next; state.note = '';
    render({focus: `[data-ql-ghandle="${CSS.escape(source.id)}"]`});
  }
}

globalThis.window?.addEventListener('kptu:session-changed', () => { close({focus: false}); state.links = null; state.groups = null; state.status = 'idle'; state.loadSeq++; });
