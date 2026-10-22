// UI-자주가는링크 (2026-10-22 사용자 승인): PC 사이드바 [쓰기] 아래 '자주 가는 링크 ›' 한 줄이 여는 작은 창.
// - 창은 그 줄 오른쪽에서 위쪽으로 열린다(창 아래끝 = 줄 아래끝, 화면 밖으로 나가지 않음; anchored-popup.js beside:'up').
// - 바깥 누르기·Esc로 닫힌다. 링크는 새 탭(rel="noopener noreferrer").
// - '업무'·'담당조직 홈페이지' 두 묶음, 2열. 창 오른쪽 위 [편집]으로 추가·이름/주소 수정·삭제·끌어서 순서 바꾸기.
// 저장: 내 프로필 행의 quick_links 칸(app_profiles, migration 20261022163000, 기존 owner RLS로 내 행만 PATCH). 칸이 비어 있으면
// 아래 초기 링크를 보여 준다. 칸이 아직 없으면(적용 전) 초기 링크를 보여 주고 편집은 '저장 준비 중' 안내만 한다.
// 기기 저장(localStorage)은 쓰지 않는다 — 목록은 기기마다 같아야 한다.
import {placeAnchored,clearAnchored,followAnchor} from './anchored-popup.js';

export const GROUPS = [['work', '업무'], ['org', '담당조직 홈페이지']];
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
export const LINK_MAX = 60, NAME_MAX = 40, URL_MAX = 2000;

// 이름: 앞뒤 공백을 뺀 1~40자, 제어문자 없음(표의 CHECK와 같은 규칙).
export function cleanName(value) {
  const name = String(value ?? '').trim();
  return name && [...name].length <= NAME_MAX && !/\p{Cc}/u.test(name) ? name : null;
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
// 저장된 값을 화면용으로: 올바른 목록이면 복사본, 비어 있으면(null) 초기 링크, 모양이 틀리면 null(아무것도 믿지 않음).
export function parseLinks(value) {
  if (value === null || value === undefined) return DEFAULT_LINKS.map(link => ({...link}));
  if (!Array.isArray(value) || value.length > LINK_MAX) return null;
  const out = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    if (Object.keys(item).some(key => !['group', 'name', 'url'].includes(key))) return null;
    if (!GROUPS.some(([key]) => key === item.group)) return null;
    const name = cleanName(item.name), url = typeof item.url === 'string' ? cleanUrl(item.url) : null;
    if (name !== item.name || url !== item.url) return null;
    out.push({group: item.group, name, url});
  }
  return out;
}
// 편집 칸의 값들을 저장할 목록으로. 틀린 줄은 errors에 [줄 번호, 'name'|'url'].
export function validateDraft(rows) {
  const links = [], errors = [];
  rows.forEach((row, index) => {
    const name = cleanName(row.name), url = cleanUrl(row.url);
    if (!name) errors.push([index, 'name']);
    if (!url) errors.push([index, 'url']);
    if (name && url) links.push({group: row.group, name, url});
  });
  if (rows.length > LINK_MAX) errors.push([-1, 'count']);
  return {links, errors};
}
// 같은 묶음 안에서 from 줄을 to 줄 자리로 옮긴 새 배열.
export function moveWithinGroup(rows, from, to) {
  if (from === to || !rows[from] || !rows[to] || rows[from].group !== rows[to].group) return rows;
  const next = [...rows], [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

const profileUrl = rt => {
  const user = rt?.context?.read?.()?.user?.id;
  return user ? `/rest/v1/app_profiles?user_id=eq.${encodeURIComponent(user)}` : '';
};
// {status:'ok', links} | {status:'pending', links: 초기} (칸이 아직 없음) | {status:'error', links: 초기}
export async function readLinks(rt = globalThis.window?.KPTURuntime) {
  const url = profileUrl(rt);
  const fallback = status => ({status, links: DEFAULT_LINKS.map(link => ({...link}))});
  if (!url) return fallback('error');
  try {
    const rows = await rt.api(`${url}&select=quick_links&limit=1`);
    if (!Array.isArray(rows) || rows.length !== 1) return fallback('error');
    const links = parseLinks(rows[0]?.quick_links);
    return links ? {status: 'ok', links} : fallback('error');
  } catch (error) {
    // PostgREST: 없는 칸을 고르면 400(42703). 적용 전 상태로 본다.
    return fallback(error?.status === 400 ? 'pending' : 'error');
  }
}
export async function saveLinks(links, rt = globalThis.window?.KPTURuntime) {
  const url = profileUrl(rt);
  if (!url || parseLinks(links) === null) return {ok: false};
  try {
    const saved = await rt.api(url, {method: 'PATCH', prefer: 'return=representation', body: {quick_links: links}});
    const back = Array.isArray(saved) && saved.length === 1 ? parseLinks(saved[0]?.quick_links) : null;
    return back ? {ok: true, links: back} : {ok: false};
  } catch (error) { return {ok: false, pending: error?.status === 400}; }
}

// ---- 창 ----
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const state = {status: 'idle', links: null, trigger: null, stop: null, editing: false, draft: [], saving: false, note: '', loadSeq: 0};
let panel = null;

function ensurePanel() {
  if (panel) return panel;
  panel = document.createElement('div');
  panel.id = 'quickLinksPanel';
  panel.className = 'quick-links-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', '자주 가는 링크');
  panel.hidden = true;
  document.body.append(panel);
  panel.addEventListener('click', onClick);
  panel.addEventListener('keydown', onKeydown);
  panel.addEventListener('input', onInput);
  panel.addEventListener('dragstart', onDragStart);
  panel.addEventListener('dragover', onDragOver);
  panel.addEventListener('drop', onDrop);
  panel.addEventListener('dragend', () => { dragFrom = -1; panel.querySelectorAll('.ql-drop').forEach(el => el.classList.remove('ql-drop')); });
  return panel;
}

function viewHtml() {
  const links = state.links || [];
  const groups = GROUPS.map(([key, label]) => {
    const items = links.filter(link => link.group === key);
    const list = items.length
      ? `<ul class="ql-grid">${items.map(link => `<li><a href="${esc(link.url)}" target="_blank" rel="noopener noreferrer" title="${esc(link.url)}">${esc(link.name)}</a></li>`).join('')}</ul>`
      : '<p class="ql-empty">링크가 없습니다.</p>';
    return `<section class="ql-group" aria-label="${esc(label)}"><h3>${esc(label)}</h3>${list}</section>`;
  }).join('');
  const loading = state.status === 'loading' && !state.links;
  return `<div class="ql-head"><h2>자주 가는 링크</h2><button type="button" class="ql-btn" data-ql-edit ${loading ? 'disabled' : ''}>편집</button></div>`
    + (loading ? '<p class="ql-empty" role="status">불러오는 중…</p>' : groups)
    + `<p class="ql-note" role="status" aria-live="polite">${esc(state.note)}</p>`;
}

function editHtml() {
  const groups = GROUPS.map(([key, label]) => {
    const rows = state.draft.map((row, index) => ({row, index})).filter(({row}) => row.group === key);
    return `<section class="ql-group" aria-label="${esc(label)} 편집"><div class="ql-group-head"><h3>${esc(label)}</h3><button type="button" class="ql-btn" data-ql-add="${key}">+ 추가</button></div>`
      + `<ol class="ql-edit-list">${rows.map(({row, index}) => `<li class="ql-edit-row" data-ql-row="${index}">`
        + `<button type="button" class="ql-handle" draggable="true" data-ql-handle="${index}" aria-label="${esc(row.name || '새 링크')} 순서 바꾸기(끌거나 위·아래 화살표)">⋮⋮</button>`
        + `<input class="ql-name" data-ql-field="name" data-ql-index="${index}" value="${esc(row.name)}" maxlength="${NAME_MAX}" placeholder="이름" aria-label="이름">`
        + `<input class="ql-url" data-ql-field="url" data-ql-index="${index}" value="${esc(row.url)}" placeholder="https://" aria-label="주소" inputmode="url" spellcheck="false" autocomplete="off">`
        + `<button type="button" class="ql-btn ql-remove" data-ql-remove="${index}" aria-label="${esc(row.name || '새 링크')} 삭제">삭제</button></li>`).join('')}</ol></section>`;
  }).join('');
  return `<div class="ql-head"><h2>자주 가는 링크 편집</h2></div>${groups}`
    + `<p class="ql-note" role="status" aria-live="polite">${esc(state.note)}</p>`
    + `<div class="ql-foot"><button type="button" class="ql-btn" data-ql-cancel>취소</button><button type="button" class="ql-btn ql-primary" data-ql-save ${state.saving ? 'disabled aria-busy="true"' : ''}>${state.saving ? '저장 중…' : '저장'}</button></div>`;
}

function render({focus = ''} = {}) {
  if (!panel || panel.hidden) return;
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
  if (result.status === 'ok' || !state.links) state.links = result.links;
  if (!state.editing) render();
}

export function isOpen() { return !!panel && !panel.hidden; }
export function open(trigger) {
  ensurePanel();
  if (isOpen()) { close(); return; }
  state.trigger = trigger;
  state.editing = false; state.note = '';
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
  state.stop?.(); state.stop = null;
  document.removeEventListener('pointerdown', onOutside, true);
  document.removeEventListener('keydown', onEscape, true);
  panel.hidden = true; panel.innerHTML = ''; clearAnchored(panel);
  state.editing = false; state.draft = []; state.note = '';
  const trigger = state.trigger; state.trigger = null;
  trigger?.setAttribute('aria-expanded', 'false');
  if (focus && trigger?.isConnected) trigger.focus({preventScroll: true});
}
function dirty() {
  const base = state.links || [];
  return state.draft.length !== base.length || state.draft.some((row, i) => row.group !== base[i].group || row.name !== base[i].name || row.url !== base[i].url);
}
function onOutside(event) {
  if (panel.contains(event.target) || state.trigger?.contains(event.target)) return;
  // 고치던 내용이 있으면 바깥을 눌러도 버리지 않는다(저장 또는 취소).
  if (state.editing && dirty()) { state.note = '고친 내용이 있어요. [저장] 또는 [취소]를 눌러 주세요.'; render(); return; }
  close({focus: false});
}
function onEscape(event) {
  if (event.key !== 'Escape' || !isOpen()) return;
  event.preventDefault(); event.stopPropagation();
  if (state.editing) { leaveEdit(); return; }
  close();
}
function enterEdit() {
  if (state.status === 'pending') { state.note = '저장 준비 중이에요. 저장 칸이 준비되면 편집할 수 있어요(지금은 초기 링크를 보여 줘요).'; render({focus: '[data-ql-edit]'}); return; }
  if (state.status !== 'ok') { state.note = '목록을 불러오지 못해 편집할 수 없어요. 창을 닫았다 다시 열어 주세요.'; render({focus: '[data-ql-edit]'}); return; }
  state.editing = true; state.note = '';
  state.draft = state.links.map(link => ({...link}));
  render({focus: '.ql-name'});
}
function leaveEdit() {
  state.editing = false; state.draft = []; state.note = '';
  render({focus: '[data-ql-edit]'});
}
async function save() {
  if (state.saving) return;
  const {links, errors} = validateDraft(state.draft);
  panel.querySelectorAll('[aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));
  if (errors.length) {
    for (const [index, field] of errors) panel.querySelector(`[data-ql-index="${index}"][data-ql-field="${field}"]`)?.setAttribute('aria-invalid', 'true');
    const first = errors.find(([index]) => index >= 0);
    state.note = errors.some(([, field]) => field === 'count') ? `링크는 ${LINK_MAX}개까지 둘 수 있어요.`
      : errors.some(([, field]) => field === 'url') ? '주소는 http:// 또는 https://로 시작하는 웹 주소만 쓸 수 있어요.' : `이름을 1~${NAME_MAX}자로 써 주세요.`;
    panel.querySelector('.ql-note').textContent = state.note;
    if (first) panel.querySelector(`[data-ql-index="${first[0]}"][data-ql-field="${first[1]}"]`)?.focus();
    return;
  }
  state.saving = true; state.note = ''; render();
  const result = await saveLinks(links);
  state.saving = false;
  if (!isOpen()) return;
  if (result.ok) { state.links = result.links; state.status = 'ok'; state.editing = false; state.draft = []; state.note = '저장했어요.'; render({focus: '[data-ql-edit]'}); return; }
  if (result.pending) state.status = 'pending';
  state.note = result.pending ? '저장 준비 중이에요. 저장 칸이 준비되면 저장할 수 있어요.' : '저장하지 못했어요. 다시 시도해 주세요.';
  render({focus: '[data-ql-save]'});
}

function onClick(event) {
  const target = event.target.closest('button');
  if (!target) return;
  if (target.matches('[data-ql-edit]')) enterEdit();
  else if (target.matches('[data-ql-cancel]')) leaveEdit();
  else if (target.matches('[data-ql-save]')) void save();
  else if (target.matches('[data-ql-add]')) {
    const group = target.dataset.qlAdd;
    // After the last row of that group; an empty 업무 group starts at the top, an empty 담당조직 group at the end.
    const last = state.draft.map(row => row.group).lastIndexOf(group);
    const at = last >= 0 ? last + 1 : group === 'work' ? 0 : state.draft.length;
    state.draft.splice(at, 0, {group, name: '', url: ''});
    state.note = '';
    render({focus: `[data-ql-index="${at}"][data-ql-field="name"]`});
  } else if (target.matches('[data-ql-remove]')) {
    const index = Number(target.dataset.qlRemove), group = state.draft[index]?.group;
    state.draft.splice(index, 1);
    render();
    const rest = [...panel.querySelectorAll('.ql-edit-row')].map(el => Number(el.dataset.qlRow)).filter(i => state.draft[i]?.group === group);
    (panel.querySelector(`[data-ql-remove="${rest.find(i => i >= index) ?? rest.at(-1)}"]`) || panel.querySelector(`[data-ql-add="${group}"]`))?.focus({preventScroll: true});
  }
}
function onInput(event) {
  const input = event.target.closest('[data-ql-field]');
  if (!input) return;
  const row = state.draft[Number(input.dataset.qlIndex)];
  if (row) row[input.dataset.qlField] = input.value;
  input.removeAttribute('aria-invalid');
}
function onKeydown(event) {
  const handle = event.target.closest?.('[data-ql-handle]');
  if (!handle || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
  event.preventDefault();
  const from = Number(handle.dataset.qlHandle), group = state.draft[from]?.group;
  const same = state.draft.map((row, i) => i).filter(i => state.draft[i].group === group), pos = same.indexOf(from);
  const to = same[pos + (event.key === 'ArrowUp' ? -1 : 1)];
  if (to === undefined) return;
  state.draft = moveWithinGroup(state.draft, from, to);
  render({focus: `[data-ql-handle="${to}"]`});
}
let dragFrom = -1;
function onDragStart(event) {
  const handle = event.target.closest?.('[data-ql-handle]');
  if (!handle) return;
  dragFrom = Number(handle.dataset.qlHandle);
  event.dataTransfer.effectAllowed = 'move';
  try { event.dataTransfer.setData('text/plain', String(dragFrom)); } catch {}
  try { event.dataTransfer.setDragImage(handle.closest('.ql-edit-row'), 12, 12); } catch {}
}
function dropRow(event) {
  const row = event.target.closest?.('.ql-edit-row');
  return row && dragFrom >= 0 && state.draft[Number(row.dataset.qlRow)]?.group === state.draft[dragFrom]?.group ? row : null;
}
function onDragOver(event) {
  const row = dropRow(event);
  if (!row) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  panel.querySelectorAll('.ql-drop').forEach(el => el !== row && el.classList.remove('ql-drop'));
  row.classList.add('ql-drop');
}
function onDrop(event) {
  const row = dropRow(event);
  if (!row) return;
  event.preventDefault();
  const to = Number(row.dataset.qlRow), from = dragFrom;
  dragFrom = -1;
  state.draft = moveWithinGroup(state.draft, from, to);
  render({focus: `[data-ql-handle="${to}"]`});
}

globalThis.window?.addEventListener('kptu:session-changed', () => { close({focus: false}); state.links = null; state.status = 'idle'; state.loadSeq++; });
