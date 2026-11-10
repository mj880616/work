// S53-20 MTG-비정기회의접기 ⑧⑨: '상위 목록' 고치기 창 — 공용 '목록 고치기' 모양(list-edit.mjs·list-edit.js, 자료실 분류·쟁의 단계와 같음).
// 맨 위 '새 상위 이름 [추가]', 줄 = ⠿ · 이름(누르면 그 자리 고침) · 비정기 회의 수 · ⋯([이름 바꾸기]·[지우기]). 지우기는 한 번 묻고,
// 그 아래 비정기 회의는 지우지 않고 '기타 비정기'로 옮긴다. 상위 이름은 정기 회의 이름과 따로다(같은 단체 이름이 둘 다 있어도 됨).
// 저장은 내 프로필 칸 meeting_name_sorts(meeting-name-sorts.js). 처음 값은 없다(빈 목록 + '기타 비정기').
// S56-1 MTG-회의명조직묶기 ④: 이 목록이 곧 '조직 목록'이다(제목 '조직 목록', 줄 = 그 조직에 넣은 회의 수). 조직을 지우면 그 회의는 '기타'로.
import {leAddHtml, leRowHtml, leInlineHtml, leMove} from './list-edit.mjs';
import {mountListEdit} from './list-edit.js';
import {askConfirm} from './small-notice.js';
import {waitHtml} from './wait-state.js';
import {readSorts, peekSorts, changeSorts, failText} from './meeting-name-sorts.js';
import {addParent, renameParent, orderParents, removeParent, parentNameProblem, orgCount, PARENT_NAME_MAX} from './meeting-name-sorts.mjs';

const MODAL = 'meetingParentsModal';
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
let mgr = null; // {ui:{id,draft}, addDraft, busy, msg:{text,error}, onClose}
const sortsNow = () => peekSorts()?.status === 'ok' ? peekSorts().sorts : null;

function install() {
  if (document.querySelector('#' + MODAL)) return;
  document.body.insertAdjacentHTML('beforeend', `<div id="${MODAL}" class="modal le-modal hidden" role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="mtgParentsHeading"><div class="modal-card small-card"><div class="modal-head"><div><h2 id="mtgParentsHeading">조직 목록<span class="le-count" data-le-count></span></h2></div><button class="icon-btn" data-mtgp-close type="button" aria-label="닫기">×</button></div><div id="mtgParentsBody" class="mtgp"></div></div></div>`);
  const body = document.querySelector('#mtgParentsBody');
  mountListEdit(body, {key: 'mtgp', label: '조직 수정', items: () => [{key: 'rename', label: '이름 바꾸기'}, {key: 'delete', label: '삭제'}], onAct,
    onMove: (id, index) => commitOrder(leMove(ids(), id, index), id),
    onStep: (id, dir) => { const list = ids(), i = list.indexOf(id); commitOrder(leMove(list, id, Math.max(0, Math.min(list.length - 1, i + dir))), id); },
    canDrag: () => !!mgr && !mgr.busy});
  document.querySelector('#' + MODAL).addEventListener('click', onClick);
  document.querySelector('#' + MODAL).addEventListener('submit', onSubmit);
  document.querySelector('#' + MODAL).addEventListener('input', e => {
    if (!mgr) return;
    if (e.target.matches('[data-mtgp-add-input]')) mgr.addDraft = e.target.value;
    else if (e.target.matches('[data-mtgp-rename-input]')) mgr.ui.draft = e.target.value;
  });
  document.querySelector('#' + MODAL).addEventListener('keydown', e => {
    if (e.key === 'Escape' && mgr?.ui.id && e.target.matches('[data-mtgp-rename-input]')) { e.preventDefault(); e.stopPropagation(); const id = mgr.ui.id; mgr.ui = {id: null, draft: ''}; paint(); focus(`[data-le-rename="${CSS.escape(id)}"]`); }
  }, true);
}
const ids = () => (sortsNow()?.parents || []).map(p => p.id);
const focus = sel => queueMicrotask(() => document.querySelector('#mtgParentsBody ' + sel)?.focus({preventScroll: true}));
const say = (text, error = false) => { if (mgr) mgr.msg = {text, error}; };

export function openParents({trigger = document.activeElement, onClose = null} = {}) {
  install();
  mgr = {ui: {id: null, draft: ''}, addDraft: '', busy: false, msg: {text: '', error: false}, onClose};
  const m = document.querySelector('#' + MODAL);
  m.classList.remove('hidden'); m.setAttribute('aria-hidden', 'false');
  window.KPTUA11y?.dialog?.activate?.(m, {trigger, initialFocus: '#mtgParentsBody', onRequestClose: closeParents});
  paint();
  const mine = mgr;
  void readSorts(undefined, {fresh: true}).then(() => { if (mgr === mine) { paint(); focus('[data-mtgp-add-input]'); } });
}
export function closeParents() {
  const m = document.querySelector('#' + MODAL); if (!m) return;
  m.classList.add('hidden'); m.setAttribute('aria-hidden', 'true');
  window.KPTUA11y?.dialog?.deactivate?.(m, {restoreFocus: true});
  const done = mgr?.onClose; mgr = null; done?.();
}

function paint() {
  const body = document.querySelector('#mtgParentsBody'); if (!mgr || !body) return;
  const s = sortsNow(), count = document.querySelector(`#${MODAL} [data-le-count]`);
  if (count) count.textContent = s ? `${s.parents.length}개` : '';
  if (!s) { body.innerHTML = peekSorts() ? `<p class="le-status" role="status">${esc(failText('unknown'))}</p>` : waitHtml({rows: 2}); return; }
  const row = p => mgr.ui.id === p.id
    ? leInlineHtml({id: p.id, label: `‘${p.name}’의 새 이름`, value: mgr.ui.draft, limit: PARENT_NAME_MAX, disabled: mgr.busy, formAttrs: {'data-mtgp-rename-form': true}, inputAttrs: {'data-mtgp-rename-input': true}})
    : leRowHtml({id: p.id, label: p.name, drag: s.parents.length > 1, disabled: mgr.busy, meta: `회의 ${orgCount(s, p.id)}`, rowAttrs: {'data-mtgp-row': p.id}});
  body.innerHTML = leAddHtml({name: '새 조직 이름', value: mgr.addDraft, limit: PARENT_NAME_MAX, disabled: mgr.busy, formAttrs: {'data-mtgp-add-form': true}, inputAttrs: {'data-mtgp-add-input': true}})
    + `<ul class="le-list" data-reorder-list="parents">${s.parents.map(row).join('')}</ul>`
    + `<ul class="le-list"><li class="le-row le-locked"><span class="le-handle le-handle-off" aria-hidden="true"></span><span class="le-name">기타</span></li></ul>`
    + `<p class="le-status${mgr.msg.error ? ' error' : ''}" role="${mgr.msg.error ? 'alert' : 'status'}">${esc(mgr.msg.text)}</p>`;
}
async function run(change, ok, focusAfter) {
  if (!mgr || mgr.busy) return;
  const mine = mgr; mine.busy = true; say('저장하는 중…'); paint();
  const r = await changeSorts(change);
  if (mgr !== mine) return;
  mine.busy = false; say(r.ok ? ok : failText(r.reason), !r.ok); paint(); if (focusAfter) focus(focusAfter);
}
function commitOrder(order, id) {
  if (!mgr || mgr.busy) return;
  if (order.join() === ids().join()) { paint(); return; }
  void run(s => orderParents(s, order), '순서를 바꿨어요.', `[data-reorder-id="${CSS.escape(id)}"] [data-reorder-handle]`);
}
async function onAct(id, act) {
  if (!mgr || mgr.busy) return;
  const s = sortsNow(), p = s?.parents.find(x => x.id === id); if (!p) return;
  if (act === 'rename') { mgr.ui = {id, draft: p.name}; say(''); paint(); focus('[data-mtgp-rename-input]'); return; }
  if (act === 'delete') {
    const n = orgCount(s, id);
    const yes = await askConfirm(document.querySelector(`#mtgParentsBody [data-le-menu="${CSS.escape(id)}"]`) || document.querySelector('#mtgParentsBody'),
      {text: n ? `‘${p.name}’을 삭제할까요? 그 아래 회의 ${n}개는 ‘기타’로 옮겨요.` : `‘${p.name}’을 삭제할까요?`, ok: '삭제'});
    if (!yes || !mgr) return;
    void run(x => removeParent(x, id), n ? `삭제했어요. 회의 ${n}개는 ‘기타’로 옮겼어요.` : '삭제했어요.', '[data-mtgp-add-input]');
  }
}
function onClick(e) {
  if (e.target.closest('[data-mtgp-close]')) { closeParents(); return; }
  if (!mgr) return;
  const name = e.target.closest('[data-le-rename]');
  if (name && !name.disabled) { const p = sortsNow()?.parents.find(x => x.id === name.dataset.leRename); if (p) { mgr.ui = {id: p.id, draft: p.name}; say(''); paint(); focus('[data-mtgp-rename-input]'); } }
}
function onSubmit(e) {
  if (!mgr) return; e.preventDefault();
  const s = sortsNow(); if (!s) return;
  if (e.target.matches('[data-mtgp-add-form]')) {
    const name = e.target.querySelector('[data-mtgp-add-input]').value; mgr.addDraft = name;
    const problem = parentNameProblem(name, s);
    if (problem) { say(problem, true); paint(); focus('[data-mtgp-add-input]'); return; }
    mgr.addDraft = '';
    void run(x => addParent(x, name), `‘${name.trim()}’을 더했어요.`, '[data-mtgp-add-input]');
  } else if (e.target.matches('[data-mtgp-rename-form]')) {
    const id = mgr.ui.id, name = e.target.querySelector('[data-mtgp-rename-input]').value; mgr.ui.draft = name;
    if (name.trim() === s.parents.find(x => x.id === id)?.name) { mgr.ui = {id: null, draft: ''}; paint(); focus(`[data-le-rename="${CSS.escape(id)}"]`); return; }
    const problem = parentNameProblem(name, s, id);
    if (problem) { say(problem, true); paint(); focus('[data-mtgp-rename-input]'); return; }
    mgr.ui = {id: null, draft: ''};
    void run(x => renameParent(x, id, name), '이름을 바꿨어요.', `[data-le-rename="${CSS.escape(id)}"]`);
  }
}
