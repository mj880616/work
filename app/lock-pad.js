// SEC-기능PIN잠금 그 자리 풀기(S67-25): 잠금 숫자 판 부품 하나. 잠금 화면(lock-ui.js)과 '잠김' 줄의 작은 PIN 창이 같은 판을 쓴다.
// - padBox(): 자물쇠 + 제목 + 'PIN 4자리' + 점 4개 + 안내 한 줄 + 숫자 판(+ 취소). 글자는 textContent로만 넣는다.
// - unlockHere(): '잠김' 줄을 누르면(feature-lock.js가 부름) 그 화면 위에 작은 창으로 같은 판을 띄운다. 화면은 떠나지 않는다.
//   PIN은 서버(app_lock_check)로만 보내 대조 결과만 받는다(틀린 횟수·막힘도 서버). 맞으면 feature-lock.js openHere()가 풀고
//   'kptu:feature-lock-changed'를 보내 그 화면이 숨긴 줄을 스스로 다시 그린다. 입력 중 숫자는 이 모듈 메모리에만, 보낸 뒤 바로 비움.
// 문지기(feature-lock.js)는 이 모듈을 필요할 때 부르므로 여기서는 정적으로 부르지 않는다(Pages 빌드는 순환 참조를 받지 않음) — 늘 먼저 실린 window.KPTUFeatureLock을 쓴다.
const lock = () => window.KPTUFeatureLock || {};
import {hhmm} from './feed-model.mjs';
import {partStyles} from './part-styles.js';
// S69-87(명진 11/25 "꾸밈 적용 전 화면이 잠깐 떴다 꾸밈 화면으로 바뀜"): 판을 그리기 전에 모양 파일(lock.css)이 다 붙어 있게 한다.
// 이 모듈이 열리기 전에(맨 위) 기다리므로 작은 PIN 창(unlockHere)도 잠금 화면(lock-ui.js)도 꾸밈 없는 판을 한 번도 보이지 않는다.
await partStyles('lock-pad');

const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; };
const button = (className, text, data = {}) => { const b = el('button', className, text); b.type = 'button'; Object.assign(b.dataset, data); return b; };
const ICON = '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8.5 10.5V7.8a3.5 3.5 0 0 1 7 0v2.7"/></svg>';

// 숫자 판. forgot: '잊음' 칸을 보일지, cancel: [취소]를 둘지.
export function padBox({title = '', digits = 0, msg = '', busy = false, forgot = false, cancel = false} = {}) {
  const box = el('div', 'lk-pad');
  const icon = el('div', 'lk-icon'); icon.setAttribute('aria-hidden', 'true'); icon.innerHTML = ICON;
  const dots = el('div', 'lk-dots'); dots.setAttribute('role', 'status'); dots.setAttribute('aria-label', `${digits}자리 입력`); dots.dataset.lkDots = '';
  for (let i = 0; i < 4; i++) dots.append(el('span', 'lk-dot' + (i < digits ? ' on' : '')));
  const note = el('p', 'lk-msg', msg); note.setAttribute('aria-live', 'polite'); note.dataset.lkMsg = '';
  const keys = el('div', 'lk-keys'); keys.setAttribute('role', 'group'); keys.setAttribute('aria-label', '숫자 판');
  for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'forgot', '0', 'back']) {
    if (k === 'forgot') { if (!forgot) { keys.append(el('span')); continue; } const b = button('lk-key lk-word', '잊음', {lkForgot: ''}); b.disabled = busy; keys.append(b); continue; }
    if (k === 'back') { const b = button('lk-key lk-word', '⌫', {lkBack: ''}); b.setAttribute('aria-label', '마지막 숫자 빼기'); b.disabled = busy; keys.append(b); continue; }
    const b = button('lk-key', k, {lkKey: k}); b.disabled = busy; keys.append(b);
  }
  box.append(icon, el('p', 'lk-title', title), el('p', 'lk-sub', 'PIN 4자리'), dots, note, keys);
  if (cancel) box.append(button('secondary mini lk-cancel', '취소', {lkCancel: ''}));
  return box;
}
// S67-72(명진 11/21 "숫자 누를 때 눌러지는 느낌이 잘 안 듦"): 숫자를 누를 때는 판을 다시 그리지 않고 점·안내 줄만 바꾼다.
// 판 전체를 다시 그리면 누르고 있던 칸이 사라져 눌림 표시(:active)가 보이지 않았다. 짧은 진동도 함께(되는 기기만).
export function padTyped(host, {digits = 0, msg = ''} = {}) {
  const dots = host?.querySelector('[data-lk-dots]'); if (!dots) return false;
  dots.setAttribute('aria-label', `${digits}자리 입력`);
  [...dots.children].forEach((dot, i) => dot.classList.toggle('on', i < digits));
  const note = host.querySelector('[data-lk-msg]'); if (note && note.textContent !== msg) note.textContent = msg;
  return true;
}
// S69-87(명진 11/25 "숫자를 빠르게 터치하면 씹힘"): 숫자·지우기 칸은 손가락을 대는 순간(pointerdown) 받는다.
// 'click'은 뗄 때 같은 칸 위여야 생기는데, 눌림 모양으로 칸이 작아지거나·두 손가락이 겹치거나·판이 다시 그려지면 빠져 버렸다.
// 손가락마다 따로 받으므로 두 손가락 번갈아·같은 숫자 연타도 한 번씩. 그 뒤 따라오는 click은 keyOfClick이 버린다
// (키보드 Enter·Space로 누른 click은 detail 0이라 그대로 받는다).
const KEY = 'button[data-lk-key],button[data-lk-back]';
const keyOf = button => button.dataset.lkKey || 'back';
// 돌려주는 함수는 같은 받기(잠금 화면이 맨 위 겹으로 덮는 동안 사건을 직접 넘길 때 쓴다, lock-ui.js shield).
export function onPadKeys(host, press) {
  const down = event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const b = event.target.closest?.(KEY);
    if (!b || b.disabled || !host.contains(b)) return;
    press(keyOf(b));
  };
  host?.addEventListener('pointerdown', down);
  return down;
}
// 숫자·지우기 칸의 click: 손가락·마우스로 누른 것(detail > 0)은 이미 pointerdown에서 받았으므로 '' (무시), 키보드로 누른 것은 그 칸.
// 숫자 칸이 아니면 null(다른 단추로 처리).
export function keyOfClick(event) {
  const b = event.target.closest?.(KEY); if (!b) return null;
  return event.detail > 0 ? '' : keyOf(b);
}
export function tap() { try { navigator.vibrate?.(8); } catch {} }
export function shake(host) {
  const dots = host?.querySelector('[data-lk-dots]'); if (!dots) return;
  dots.classList.remove('lk-shake'); void dots.offsetWidth; dots.classList.add('lk-shake');
}
// 서버가 '틀림'이라 답했을 때의 한 줄(남은 횟수·막힌 시각은 서버 값 그대로).
export function wrongMsg(res) {
  lock().noteBlocked?.(res);
  if (res?.blocked_until) return `여러 번 틀려 막혔어요 · ${hhmm(res.blocked_until)}에 다시 할 수 있어요`;
  return `PIN이 맞지 않아요 · ${Number.isInteger(res?.left) ? res.left : ''}번 남았어요`;
}

// ── 그 자리 풀기(작은 창) ────────────────────────────────────────────────────────────────────
let here = null; // {dialog, title, from, digits, msg, busy, layer}
function draw() {
  if (!here) return;
  const dialog = here.dialog, active = document.activeElement;
  const kept = !active || active === document.body || dialog.contains(active);
  dialog.replaceChildren(padBox({title: here.title, digits: here.digits.length, msg: here.msg, busy: here.busy, cancel: true}));
  // S69-87: 다시 그리면 누르던 칸이 사라져 초점이 창 밖으로 빠진다 — 창이 받게 해 키보드 숫자가 다음 시도에도 바로 들어가게.
  if (kept && !dialog.contains(document.activeElement)) dialog.focus({preventScroll: true});
}
function finish({focus = true} = {}) {
  const h = here; if (!h) return;
  here = null; h.digits = '';
  const layer = h.layer; h.layer = null; layer?.close?.();
  if (h.dialog.open) h.dialog.close();
  h.dialog.remove();
  if (focus && h.from?.isConnected) h.from.focus?.({preventScroll: true});
  return h;
}
async function entered() {
  const h = here; if (!h) return;
  const pin = h.digits; h.digits = ''; h.busy = true; draw();
  try {
    const res = await window.KPTURuntime.api('/rest/v1/rpc/app_lock_check', {method: 'POST', body: {p_pin: pin}, singleFlight: false});
    if (here !== h) return;
    if (res?.ok) { finish({focus: false}); lock().openHere?.(); return; }
    h.busy = false; h.msg = wrongMsg(res); draw(); shake(h.dialog);
  } catch (error) {
    if (here !== h) return;
    h.busy = false;
    if (/LOCK_PIN_MISSING/.test(String(error?.message || ''))) { finish(); void lock().refresh?.(); return; }
    h.msg = '확인하지 못했어요. 잠시 뒤 다시 해 주세요'; draw();
  }
}
function press(key) {
  const h = here; if (!h || h.busy) return;
  if (key === 'back') { h.digits = h.digits.slice(0, -1); tap(); if (!padTyped(h.dialog, {digits: h.digits.length, msg: h.msg})) draw(); return; }
  if (!/^[0-9]$/.test(key) || h.digits.length >= 4) return;
  h.digits += key; if (h.digits.length === 1) h.msg = h.msg.startsWith('여러 번') ? h.msg : '';
  tap(); if (!padTyped(h.dialog, {digits: h.digits.length, msg: h.msg})) draw();
  if (h.digits.length === 4) void entered();
}
// title: 판 맨 위 한 줄(예: '통화·텔레그램 잠김'). from: 누른 줄(취소로 닫을 때 초점을 돌려줌).
export function unlockHere({title = '잠김', from = null} = {}) {
  if (here) finish({focus: false});
  const dialog = document.createElement('dialog');
  dialog.className = 'lk-here'; dialog.setAttribute('aria-label', title); dialog.tabIndex = -1;
  document.body.append(dialog);
  here = {dialog, title, from, digits: '', msg: '', busy: false, layer: null};
  const blocked = lock().settings?.()?.blocked_until;
  if (blocked && Date.parse(blocked) > Date.now()) here.msg = `여러 번 틀려 막혔어요 · ${hhmm(blocked)}에 다시 할 수 있어요`;
  dialog.addEventListener('click', event => {
    if (event.target === dialog) { finish(); return; } // 바깥(어두운 곳) 누르기
    const key = keyOfClick(event); if (key != null) { if (key) press(key); return; }
    const t = event.target.closest?.('button'); if (!t) return;
    if (t.hasAttribute('data-lk-cancel')) finish();
  });
  onPadKeys(dialog, press);
  dialog.addEventListener('cancel', event => { event.preventDefault(); finish(); });
  dialog.addEventListener('keydown', event => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (/^[0-9]$/.test(event.key)) { event.preventDefault(); press(event.key); }
    else if (event.key === 'Backspace') { event.preventDefault(); press('back'); }
  });
  draw();
  dialog.showModal();
  // 폰 뒤로가기는 이 창만 닫는다(화면은 그대로).
  const h = here;
  h.layer = window.KPTURouter?.layer?.open?.('lock-here', {close: () => { h.layer = null; if (here === h) finish(); return true; }}) || null;
  dialog.querySelector('[data-lk-key="1"]')?.focus({preventScroll: true});
}
export const unlockOpen = () => !!here;
