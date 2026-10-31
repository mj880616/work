// ATT-이름고치기(2026-10-31 사용자 결정 "추천안대로, [AI 이름] 포함"): 첨부 파일 줄 공용 — 파일 이름을 그 자리에서 고치기.
// 여는 법: 이름 끝 작은 ✎(renameButtonHtml), PC는 이름 두 번 누르기, 폰은 이름 꾹 누르기(0.5초, 움직이지 않고 손 뗄 때 열림).
//   이름 칸에는 renameHostAttrs(spec)를, 줄(이름과 ✎을 함께 담는 상자)에는 data-fr-row를 붙인다.
// 고치는 칸: [이름 부분 입력].확장자 [AI 이름] [저장] [취소] + 작은 빨간 안내. 확장자는 따로 두고 저장 때 서버가 붙인다.
//   Enter 저장·Esc 취소. 빈 이름·못 쓰는 글자는 저장 전에 막는다(규칙은 file-rename-name.mjs 한 곳, 서버도 같은 규칙으로 다시 검사).
// 저장: document-actions action=rename-file — 서버가 Drive 원본 이름과 그 파일을 가리키는 Web2 줄(노트 첨부·할 일 첨부·자료)을 함께 바꾼다.
//   성공하면 window에 'kptu:file-renamed' {drive_file_id, name, notes:[{id,updated_at}]}를 보낸다. 화면마다 들고 있는 값을 이 알림으로 고쳐
//   다시 그린다(화면의 한 그리기 주인이 그림 — 여기서는 화면 글자를 직접 덮지 않는다). 자료가 바뀌면 'kptu:documents-changed'도 보낸다.
// [AI 이름]: ai-assist kind=file_name — 이미 읽어 둔 글자(사진 OCR·자료 본문)로 이름 하나를 추천받아 칸에 채운다. 저장은 하지 않는다.
// 기기 저장 없음. 실패 안내는 그 칸 아래 작은 글자(role=alert).
import { checkFileBase, splitFileName } from './file-rename-name.mjs';
import { holdToast } from './small-notice.js';

const HOLD_MS = 500, MOVE_PX = 10, DOUBLE_MS = 280;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);
const TARGETS = new Set(['note', 'task', 'document']);

// spec = {target:'note'|'task'|'document', id, driveId, name}
const specOk = s => !!s && TARGETS.has(s.target) && !!s.id && !!s.driveId && !!s.name;
const specAttrs = s => ` data-fr-target="${esc(s.target)}" data-fr-id="${esc(s.id)}" data-fr-drive="${esc(s.driveId)}" data-fr-name="${esc(s.name)}"`;
export function renameHostAttrs(spec) { return specOk(spec) ? ' data-fr-host' + specAttrs(spec) : ''; }
// 이미 그린 이름 칸에 붙인다(공용 fileLine처럼 이름 칸 HTML을 화면이 직접 만들지 않을 때).
export function markRenameHost(el, spec) {
  if (!el || !specOk(spec)) return;
  Object.assign(el.dataset, {frHost: '', frTarget: spec.target, frId: spec.id, frDrive: spec.driveId, frName: spec.name});
}
export function renameButtonHtml(spec, {cls = ''} = {}) {
  if (!specOk(spec)) return '';
  return `<button type="button" class="fr-edit${cls ? ' ' + esc(cls) : ''}" data-fr-edit${specAttrs(spec)} aria-label="${esc(spec.name)} 이름 고치기" title="이름 고치기">✎</button>`;
}
const specOf = el => ({target: el.dataset.frTarget || '', id: el.dataset.frId || '', driveId: el.dataset.frDrive || '', name: el.dataset.frName || ''});

// 화면이 들고 있는 첨부 목록(파일 칸 배열)을 새 이름으로 고친다. 바뀐 것이 있으면 true.
export function applyRenamed(files, detail, {idKey = 'drive_file_id', nameKey = 'file_name'} = {}) {
  let changed = false;
  for (const f of Array.isArray(files) ? files : []) {
    if (f && f[idKey] === detail?.drive_file_id && f[nameKey] !== detail.name) { f[nameKey] = detail.name; changed = true; }
  }
  return changed;
}
// 노트 행의 updated_at을 서버가 돌려준 새 값으로(다음 저장의 확인 값이 맞게).
export function applyRenamedNote(note, detail) {
  if (!note) return false;
  const changed = applyRenamed(note.attachments, detail);
  const stamp = (detail?.notes || []).find(n => n.id === note.id)?.updated_at;
  if (stamp) note.updated_at = stamp;
  return changed || !!stamp;
}

// 서버 오류 → 일상어 한 줄.
export function renameErrorText(error) {
  const status = Number(error?.status) || 0, msg = String(error?.message || '');
  if (status === 401) return '로그인을 확인하지 못했어요. 다시 로그인한 뒤 해 주세요.';
  if (msg === 'Unknown action' || msg === 'document_id가 필요합니다.' || [403, 404, 405].includes(status)) return '이름 고치기가 아직 준비되지 않았어요. 바뀐 것은 없어요.';
  if (status === 400 && msg) return msg;
  return '이름이 바뀌었는지 확인하지 못했어요. 화면을 다시 열어 확인해 주세요.';
}
export function aiNameText(data) {
  if (data?.skipped === 'no_text') return '읽어 둔 글자가 없어 추천하지 못했어요.';
  if (data?.skipped === 'not_allowed' || data?.skipped === 'secret') return '이 파일은 AI에 보내지 않아요.';
  return '추천할 이름을 찾지 못했어요.';
}

let open = null;
function closeEditor({focus = false} = {}) {
  if (!open) return;
  const {box, host, slot, button} = open; open = null;
  if (box.isConnected) box.replaceWith(slot);
  if (button?.isConnected) button.hidden = false;
  if (focus) (button?.isConnected ? button : host)?.focus?.({preventScroll: true});
}

export function openRenameEditor(trigger, {rt = globalThis.window?.KPTURuntime} = {}) {
  const row = trigger.closest('[data-fr-row]') || trigger.parentElement;
  const host = trigger.matches('[data-fr-host]') ? trigger : row?.querySelector('[data-fr-host]');
  const spec = specOf(trigger);
  if (!host || !specOk(spec)) return;
  if (open) { if (open.host === host) { open.input.focus(); return; } closeEditor(); }
  const {base, ext} = splitFileName(spec.name);
  const button = row?.querySelector('[data-fr-edit]');
  const box = document.createElement('span');
  box.className = 'fr-box'; box.dataset.enterField = 'off';
  box.innerHTML = `<span class="fr-field"><input type="text" class="fr-input" aria-label="파일 이름" autocomplete="off" spellcheck="false" maxlength="200">${ext ? `<span class="fr-ext">${esc(ext)}</span>` : ''}</span>`
    + `<span class="fr-acts"><button type="button" class="fr-ai" data-fr-ai>AI 이름</button><button type="button" class="fr-save" data-fr-save>저장</button><button type="button" class="fr-cancel" data-fr-cancel>취소</button></span>`
    + '<small class="fr-err" role="alert" hidden></small>';
  const input = box.querySelector('.fr-input'), err = box.querySelector('.fr-err'), saveBtn = box.querySelector('[data-fr-save]'), aiBtn = box.querySelector('[data-fr-ai]');
  input.value = base;
  const say = (text, error = true) => { err.textContent = text || ''; err.hidden = !text; err.classList.toggle('fr-note', !error); };
  // 이름 칸이 링크(<a>) 안에 있으면 링크째 잠시 바꾼다(칸 안을 누를 때 링크가 열리지 않게).
  const link = host.closest('a[href]'), slot = link && (!row || row.contains(link)) ? link : host;
  const state = {box, host, slot, button, input, busy: false};
  const setBusy = on => { state.busy = on; saveBtn.disabled = on; aiBtn.disabled = on; input.readOnly = on; };
  const check = () => { const r = checkFileBase(input.value); say(r.ok ? '' : r.message); return r; };
  input.addEventListener('input', () => { if (!err.hidden) check(); });
  const save = async () => {
    if (state.busy) return;
    const r = check(); if (!r.ok) { input.focus(); return; }
    if (r.base === base) { closeEditor({focus: true}); return; }
    setBusy(true); say('저장하는 중…', false);
    try {
      const data = await rt.api('/functions/v1/document-actions', {method: 'POST', body: {action: 'rename-file', target: spec.target, id: spec.id, drive_file_id: spec.driveId, base: r.base}, refreshSession: false, singleFlight: false});
      if (!data || data.ok !== true || typeof data.name !== 'string' || data.drive_file_id !== spec.driveId) throw Object.assign(new Error(''), {status: 0});
      if (open === state) closeEditor({focus: true});
      const detail = {drive_file_id: data.drive_file_id, name: data.name, notes: Array.isArray(data.notes) ? data.notes : [], updated: data.updated || {}};
      window.dispatchEvent(new CustomEvent('kptu:file-renamed', {detail}));
      if (detail.updated.documents) window.dispatchEvent(new CustomEvent('kptu:documents-changed'));
      if (detail.updated.tasks) window.dispatchEvent(new CustomEvent('kptu:google-tasks-changed'));
      const t = document.querySelector('#toast');
      if (t) { t.textContent = 'Drive 원본 이름도 바꿨어요.'; holdToast(t); }
    } catch (e) {
      setBusy(false); say(renameErrorText(e)); input.focus();
    }
  };
  const suggest = async () => {
    if (state.busy) return;
    setBusy(true); say('AI가 이름을 고르고 있어요…', false);
    try {
      const data = await rt.api('/functions/v1/ai-assist', {method: 'POST', body: {kind: 'file_name', target: spec.target, id: spec.id, drive_file_id: spec.driveId}, refreshSession: false, singleFlight: false});
      setBusy(false);
      if (data?.ok === true && typeof data.name === 'string' && checkFileBase(data.name).ok) { input.value = data.name; say('추천을 채웠어요. 고친 뒤 [저장]을 눌러 주세요.', false); }
      else say(aiNameText(data), false);
    } catch (e) {
      setBusy(false);
      const status = Number(e?.status) || 0;
      say(status === 429 ? '오늘 AI 추천 횟수를 다 썼어요.' : [400, 404, 405].includes(status) ? 'AI 이름이 아직 준비되지 않았어요.' : 'AI 추천을 받지 못했어요. 잠시 뒤 다시 해 주세요.');
    }
    input.focus();
  };
  // 줄을 누르면 파일이 열리므로, 칸 안의 누르기·키는 줄까지 올라가지 않게 한다.
  for (const type of ['click', 'dblclick', 'pointerdown', 'mousedown', 'touchstart']) box.addEventListener(type, e => e.stopPropagation());
  box.addEventListener('click', e => {
    if (e.target.closest('[data-fr-save]')) { e.preventDefault(); void save(); }
    else if (e.target.closest('[data-fr-cancel]')) { e.preventDefault(); closeEditor({focus: true}); }
    else if (e.target.closest('[data-fr-ai]')) { e.preventDefault(); void suggest(); }
  });
  box.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter' && e.target === input) { e.preventDefault(); void save(); }
    else if (e.key === 'Escape') { e.preventDefault(); if (!state.busy) closeEditor({focus: true}); }
  });
  slot.replaceWith(box);
  if (button) button.hidden = true;
  open = state;
  input.focus({preventScroll: true}); input.select();
}

// 전역 한 번: ✎ 누르기, PC 두 번 누르기, 폰 꾹 누르기.
if (typeof document !== 'undefined' && !globalThis.__kptuFileRenameBound) {
  globalThis.__kptuFileRenameBound = true;
  // 모양은 file-rename.css 한 곳(이 부품을 쓰는 모든 화면 공용, 배포 빌드가 번호를 붙임).
  const css = new URL('./file-rename.css', import.meta.url).href;
  if (![...document.querySelectorAll('link[rel="stylesheet"]')].some(l => l.href === css)) {
    const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = css; document.head.appendChild(link);
  }
  document.addEventListener('click', e => {
    const b = e.target instanceof Element ? e.target.closest('[data-fr-edit]') : null;
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    openRenameEditor(b);
  }, true);
  // PC(마우스): 이름 한 번 누르기는 두 번 누르기인지 잠깐(0.28초) 기다린 뒤 원래 동작(파일 열기)으로 넘긴다.
  // 키보드 Enter(detail 0)·손가락은 기다리지 않는다.
  let lastPointer = '', pending = null, passing = false;
  document.addEventListener('pointerdown', e => { lastPointer = e.pointerType || ''; }, true);
  document.addEventListener('click', e => {
    if (passing || e.detail < 1 || lastPointer !== 'mouse' || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    const h = e.target instanceof Element ? e.target.closest('[data-fr-host]') : null;
    if (!h) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.detail > 1) { clearTimeout(pending?.timer); pending = null; return; } // 두 번째 누르기는 dblclick(고치기)이 받는다.
    clearTimeout(pending?.timer);
    pending = {host: h, timer: setTimeout(() => {
      const {host} = pending || {}; pending = null;
      if (!host?.isConnected) return;
      passing = true;
      try { host.click(); } finally { passing = false; }
    }, DOUBLE_MS)};
  }, true);
  document.addEventListener('dblclick', e => {
    if (pending) { clearTimeout(pending.timer); pending = null; }
    const h = e.target instanceof Element ? e.target.closest('[data-fr-host]') : null;
    if (!h) return;
    e.preventDefault(); e.stopPropagation();
    getSelection?.()?.removeAllRanges?.();
    openRenameEditor(h);
  }, true);
  let hold = null, swallow = false;
  const cancelHold = () => { if (hold) { clearTimeout(hold.timer); hold = null; } };
  document.addEventListener('pointerdown', e => {
    swallow = false;
    if (e.pointerType !== 'touch' || !e.isPrimary) { cancelHold(); return; }
    const h = e.target instanceof Element ? e.target.closest('[data-fr-host]') : null;
    if (!h) return;
    cancelHold();
    hold = {x: e.clientX, y: e.clientY, host: h, held: false, timer: setTimeout(() => { if (hold) { hold.held = true; try { navigator.vibrate?.(10); } catch { /* 진동 없음 */ } } }, HOLD_MS)};
  }, true);
  document.addEventListener('pointermove', e => { if (hold && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > MOVE_PX) cancelHold(); }, true);
  document.addEventListener('pointercancel', cancelHold, true);
  document.addEventListener('touchstart', e => { if (e.touches.length > 1) cancelHold(); }, {capture: true, passive: true});
  document.addEventListener('pointerup', () => {
    if (!hold) return;
    const {held, host} = hold; cancelHold();
    if (!held) return;
    swallow = true;
    openRenameEditor(host);
  }, true);
  // 꾹 누른 뒤 따라오는 click(파일 열기)과 길게 누르기 메뉴는 삼킨다.
  document.addEventListener('click', e => { if (swallow) { swallow = false; e.preventDefault(); e.stopPropagation(); } }, true);
  document.addEventListener('contextmenu', e => { if (e.target instanceof Element && e.target.closest('[data-fr-host]') && (hold || swallow)) e.preventDefault(); }, true);
}
