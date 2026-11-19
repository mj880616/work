// SEC-기능PIN잠금 ②: '잠금' 화면(?view=lock). #lockView의 유일한 renderer(설계 docs/design/feature-pin-lock.md 4절).
// 두 쓰임: ① 계정 메뉴 [잠금] → 기능마다 켜기/끄기·다시 잠그기·[PIN 바꾸기] ② 잠긴 기능을 열면(문지기 feature-lock.js가 보냄) 그 자리에
// 자물쇠 + 'PIN 4자리' + 점 4개 + 숫자 판. PIN은 서버(app_lock_*)로만 보내 대조 결과만 받는다. 화면은 PIN을 어디에도 남기지 않는다
// (입력 중 숫자는 이 함수의 메모리에만, 서버에 보낸 뒤 바로 비움). 글자는 textContent로만 넣는다. 화면 전환·뒤로가기는 라우터가 맡는다.
import * as lock from './feature-lock.js';
import {waitHtml, failHtml} from './wait-state.js';
import {myFeaturesOrNull} from './my-features.js';
import {hhmm} from './feed-model.mjs';

const rpc = (name, body) => window.KPTURuntime.api('/rest/v1/rpc/' + name, {method: 'POST', body, singleFlight: false});
const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; };
const button = (className, text, data = {}) => { const b = el('button', className, text); b.type = 'button'; Object.assign(b.dataset, data); return b; };
const code = error => String(error?.message || '').match(/LOCK_[A-Z_]+/)?.[0] || '';
const clock = iso => hhmm(iso);

// 화면 상태(메모리만). mode: list | pad | forgot | wait | fail
const ui = {mode: 'list', purpose: '', step: 0, digits: '', first: '', old: '', msg: '', busy: false, change: null, relockDraft: '5m', features: null, target: null};
const reset = patch => Object.assign(ui, {purpose: '', step: 0, digits: '', first: '', old: '', msg: '', busy: false, change: null}, patch);

function install() {
  if (document.getElementById('lockView')) return;
  document.getElementById('appView')?.insertAdjacentHTML('beforeend', '<section id="lockView" class="view-panel hidden" aria-label="잠금"><div class="panel lk-view" data-lk-root></div></section>');
}
const root = () => document.querySelector('#lockView [data-lk-root]');

// 이 요청 세션의 로그인 시각이 9분 안인가(서버가 10분으로 다시 확인한다 — 화면 판정은 길 안내일 뿐).
function recentLogin() {
  try {
    const part = String(window.KPTURuntime?.session?.read?.()?.access_token || '').split('.')[1] || '';
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - part.length % 4) % 4)));
    const now = Date.now() / 1000;
    return Array.isArray(json.amr) && json.amr.some(a => Number(a?.timestamp) > now - 540);
  } catch { return false; }
}

async function shownFeatures() {
  const got = await myFeaturesOrNull().catch(() => null);
  const on = lock.settings()?.features || [];
  return Object.keys(lock.FEATURE_NAMES).filter(f => f === 'diary' || f === 'photos' || on.includes(f) || !Array.isArray(got) || got.includes(f));
}

// ── 그리기 ────────────────────────────────────────────────────────────────────────────────────
function draw() {
  const host = root(); if (!host) return;
  if (ui.mode === 'wait') { host.innerHTML = waitHtml({rows: 2}); return; }
  if (ui.mode === 'fail') { host.innerHTML = failHtml({retry: 'data-lk-retry', text: '잠금 설정을 읽지 못했어요'}); return; }
  if (ui.mode === 'pad') { host.replaceChildren(pad()); return; }
  if (ui.mode === 'forgot') { host.replaceChildren(forgot()); return; }
  host.replaceChildren(list());
}

function list() {
  const s = lock.settings() || {has_pin: false, features: [], relock: '5m'};
  const box = el('div', 'lk-list');
  box.append(el('p', 'lk-note', '켜 둔 기능은 열 때 PIN 4자리를 물어요. 폰·PC 같은 PIN이에요.'));
  const rows = el('div', 'lk-rows'); rows.setAttribute('role', 'group'); rows.setAttribute('aria-label', '잠글 기능');
  for (const f of ui.features || []) {
    const row = el('label', 'lk-row');
    const input = el('input'); input.type = 'checkbox'; input.setAttribute('role', 'switch'); input.dataset.lkFeature = f;
    input.checked = s.features.includes(f); input.disabled = ui.busy;
    row.append(el('span', 'lk-row-name', lock.FEATURE_NAMES[f]), input);
    rows.append(row);
  }
  const relock = el('div', 'lk-relock'); relock.setAttribute('role', 'group'); relock.setAttribute('aria-label', '다시 잠그기');
  relock.append(el('span', 'lk-row-name', '다시 잠그기'));
  const seg = el('span', 'lk-seg');
  const current = s.has_pin ? s.relock : ui.relockDraft;
  for (const [key, name] of lock.RELOCK) {
    const b = button('mini' + (key === current ? '' : ' secondary'), name, {lkRelock: key});
    b.setAttribute('aria-pressed', String(key === current)); b.disabled = ui.busy; seg.append(b);
  }
  relock.append(seg);
  box.append(rows, relock);
  if (s.has_pin) box.append(button('secondary mini lk-change', 'PIN 바꾸기', {lkChange: ''}));
  if (ui.msg) box.append(el('p', 'lk-msg', ui.msg));
  return box;
}

const TITLES = {
  gate: () => `${lock.FEATURE_NAMES[lock.featureOf(ui.target)] || ''} 잠김`,
  setup: () => ui.step ? '한 번 더 입력' : 'PIN 정하기',
  confirm: () => 'PIN 확인',
  change: () => ['지금 PIN', '새 PIN', '새 PIN 한 번 더'][ui.step],
  renew: () => ui.step ? '한 번 더 입력' : '새 PIN 정하기',
};
function pad() {
  const box = el('div', 'lk-pad');
  const icon = el('div', 'lk-icon'); icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8.5 10.5V7.8a3.5 3.5 0 0 1 7 0v2.7"/></svg>';
  const title = el('p', 'lk-title', TITLES[ui.purpose]?.() || '');
  const sub = el('p', 'lk-sub', 'PIN 4자리');
  const dots = el('div', 'lk-dots'); dots.setAttribute('role', 'status'); dots.setAttribute('aria-label', `${ui.digits.length}자리 입력`); dots.dataset.lkDots = '';
  for (let i = 0; i < 4; i++) dots.append(el('span', 'lk-dot' + (i < ui.digits.length ? ' on' : '')));
  const msg = el('p', 'lk-msg', ui.msg); msg.setAttribute('aria-live', 'polite'); msg.dataset.lkMsg = '';
  const keys = el('div', 'lk-keys'); keys.setAttribute('role', 'group'); keys.setAttribute('aria-label', '숫자 판');
  const canForget = ui.purpose === 'gate' || ui.purpose === 'confirm' || (ui.purpose === 'change' && ui.step === 0);
  for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'forgot', '0', 'back']) {
    if (k === 'forgot') { const b = button('lk-key lk-word', '잊음', {lkForgot: ''}); b.disabled = ui.busy || !canForget; b.hidden = !canForget; keys.append(canForget ? b : el('span')); continue; }
    if (k === 'back') { const b = button('lk-key lk-word', '⌫', {lkBack: ''}); b.setAttribute('aria-label', '마지막 숫자 빼기'); b.disabled = ui.busy; keys.append(b); continue; }
    const b = button('lk-key', k, {lkKey: k}); b.disabled = ui.busy; keys.append(b);
  }
  box.append(icon, title, sub, dots, msg, keys);
  if (ui.purpose !== 'gate') box.append(button('secondary mini lk-cancel', '취소', {lkCancel: ''}));
  return box;
}
function forgot() {
  const box = el('div', 'lk-pad lk-forgot');
  box.append(el('p', 'lk-title', 'PIN을 잊었나요?'), el('p', 'lk-note', '구글 로그인을 다시 하면 PIN을 새로 정할 수 있어요. 잠근 기능은 그대로예요.'));
  if (ui.msg) box.append(el('p', 'lk-msg', ui.msg));
  const acts = el('div', 'lk-acts');
  acts.append(button('mini', '구글로 다시 로그인', {lkRelogin: ''}), button('secondary mini', '취소', {lkCancel: ''}));
  box.append(acts);
  return box;
}
function shake() {
  const dots = root()?.querySelector('[data-lk-dots]'); if (!dots) return;
  dots.classList.remove('lk-shake'); void dots.offsetWidth; dots.classList.add('lk-shake');
}

// ── 흐름 ────────────────────────────────────────────────────────────────────────────────────
function resultMsg(res) {
  lock.noteBlocked(res);
  if (res?.blocked_until) return `여러 번 틀려 막혔어요 · ${clock(res.blocked_until)}에 다시 할 수 있어요`;
  return `PIN이 맞지 않아요 · ${Number.isInteger(res?.left) ? res.left : ''}번 남았어요`;
}
async function send(fn, body) {
  ui.busy = true; draw();
  try { return await rpc(fn, body); }
  finally { ui.busy = false; }
}
async function entered() {
  const pin = ui.digits; ui.digits = '';
  const p = ui.purpose;
  // 두 번 입력하는 단계: 첫 번째는 메모리에만 두고 다음 단계로.
  if ((p === 'setup' || p === 'renew') && ui.step === 0) { ui.first = pin; ui.step = 1; ui.msg = ''; draw(); return; }
  if (p === 'change' && ui.step === 0) { ui.old = pin; ui.step = 1; ui.msg = ''; draw(); return; }
  if (p === 'change' && ui.step === 1) { ui.first = pin; ui.step = 2; ui.msg = ''; draw(); return; }
  if ((p === 'setup' || p === 'renew' || p === 'change') && pin !== ui.first) {
    ui.first = ''; ui.step = p === 'change' ? 1 : 0; ui.msg = '두 번 입력한 PIN이 달라요. 다시 입력해 주세요'; draw(); shake(); return;
  }
  try {
    if (p === 'gate') {
      const res = await send('app_lock_check', {p_pin: pin});
      if (res?.ok) { reset({mode: 'list'}); lock.markOpen(); return; }
      ui.msg = resultMsg(res); draw(); shake(); return;
    }
    if (p === 'confirm') {
      const res = await send('app_lock_save', {p_pin: pin, p_features: ui.change.features, p_relock: ui.change.relock});
      if (res?.ok) { lock.applySaved(res); reset({mode: 'list', msg: '저장했어요'}); draw(); return; }
      ui.msg = resultMsg(res); draw(); shake(); return;
    }
    if (p === 'setup') {
      const res = await send('app_lock_setup', {p_pin: pin, p_features: ui.change.features, p_relock: ui.change.relock});
      lock.applySaved(res); reset({mode: 'list', msg: 'PIN을 정했어요'}); draw(); return;
    }
    if (p === 'change') {
      const res = await send('app_lock_pin_change', {p_pin: ui.old, p_new_pin: pin});
      if (res?.ok) { lock.applySaved(null); reset({mode: 'list', msg: 'PIN을 바꿨어요'}); draw(); return; }
      ui.old = ''; ui.first = ''; ui.step = 0; ui.msg = resultMsg(res); draw(); shake(); return;
    }
    if (p === 'renew') {
      await send('app_lock_pin_renew', {p_new_pin: pin});
      await lock.refresh();
      const target = ui.target;
      reset({mode: 'list', msg: 'PIN을 새로 정했어요'});
      lock.applySaved(null);
      if (target && lock.isLockable(target)) { lock.markOpen({thenGo: false}); window.KPTURouter?.go?.(target, {source: 'api', replaceUrl: true}); return; }
      window.KPTURouter?.setPlace?.('lock', {renew: null, for: null});
      draw(); return;
    }
  } catch (error) {
    const why = code(error);
    if (why === 'LOCK_RECENT_LOGIN_REQUIRED') { reset({mode: 'forgot', target: ui.target, msg: '로그인한 지 오래됐어요. 구글 로그인을 다시 해 주세요'}); draw(); return; }
    if (why === 'LOCK_PIN_EXISTS' || why === 'LOCK_PIN_MISSING') { await lock.refresh(); reset({mode: 'list', msg: '설정이 바뀌어 다시 읽었어요'}); draw(); return; }
    ui.first = ''; ui.old = ''; ui.step = 0;
    ui.msg = '확인하지 못했어요. 잠시 뒤 다시 해 주세요'; draw();
  }
}
function press(key) {
  if (ui.mode !== 'pad' || ui.busy) return;
  if (key === 'back') { ui.digits = ui.digits.slice(0, -1); draw(); return; }
  if (!/^[0-9]$/.test(key) || ui.digits.length >= 4) return;
  ui.digits += key; ui.msg = ui.digits.length === 1 ? '' : ui.msg; draw();
  if (ui.digits.length === 4) void entered();
}
function askPin(purpose, change = null) { reset({mode: 'pad', purpose, change, target: ui.target}); draw(); root()?.querySelector('.lk-key')?.focus(); }
function wantChange(next) {
  const s = lock.settings();
  if (!s?.has_pin) {
    if (!next.features.length) { ui.relockDraft = next.relock; draw(); return; }
    askPin('setup', next); return;
  }
  askPin('confirm', next);
}

// 잠금 화면에 들어올 때: 문지기가 보낸 화면(또는 새로고침한 ?view=lock&for=…)이면 숫자 판, 아니면 설정 목록.
async function enter() {
  install();
  const place = window.KPTURouter?.place?.('lock') || {};
  const target = lock.pending()?.view || (lock.isLockable(place.for) ? place.for : null);
  reset({mode: 'wait', target});
  draw();
  await lock.ready();
  if (window.KPTURouter?.current !== 'lock') return;
  if (lock.readFailed()) { ui.mode = 'fail'; draw(); return; }
  if (target) window.KPTURouter?.setPlace?.('lock', {for: target});
  if (place.renew === '1' && lock.settings()?.has_pin) {
    reset({mode: recentLogin() ? 'pad' : 'forgot', purpose: recentLogin() ? 'renew' : '', target}); draw(); return;
  }
  if (target) {
    if (!lock.locked(target)) { lock.clearPending(); window.KPTURouter?.go?.(target, {source: 'api', replaceUrl: true}); return; }
    reset({mode: 'pad', purpose: 'gate', target}); draw(); return;
  }
  ui.features = await shownFeatures();
  reset({mode: 'list', target: null}); draw();
}

install();
document.querySelector('#lockView')?.addEventListener('click', event => {
  const t = event.target.closest?.('button,[data-lk-retry]'); if (!t) return;
  if (t.matches('[data-lk-retry]')) { void lock.refresh().then(enter); return; }
  if (t.dataset.lkKey) { press(t.dataset.lkKey); return; }
  if (t.matches('[data-lk-back]')) { press('back'); return; }
  if (t.matches('[data-lk-forgot]')) {
    if (recentLogin()) { reset({mode: 'pad', purpose: 'renew', target: ui.target}); draw(); return; }
    reset({mode: 'forgot', target: ui.target}); draw(); return;
  }
  if (t.matches('[data-lk-relogin]')) {
    const back = new URL(location.href); back.searchParams.set('view', 'lock'); back.searchParams.set('renew', '1');
    if (ui.target) back.searchParams.set('for', ui.target);
    const auth = window.KPTUAuth; if (!auth) return;
    const url = new URL(auth.loginUrl(back.href)); url.searchParams.set('again', '1');
    location.assign(url.href); return;
  }
  if (t.matches('[data-lk-cancel]')) {
    if (ui.target) { reset({mode: 'pad', purpose: 'gate', target: ui.target}); draw(); return; }
    reset({mode: 'list'}); window.KPTURouter?.setPlace?.('lock', {renew: null}); draw(); return;
  }
  if (t.matches('[data-lk-change]')) { askPin('change'); return; }
  if (t.dataset.lkRelock) {
    const s = lock.settings() || {features: []};
    if ((s.has_pin ? s.relock : ui.relockDraft) === t.dataset.lkRelock) return;
    wantChange({features: s.features, relock: t.dataset.lkRelock}); return;
  }
});
document.querySelector('#lockView')?.addEventListener('change', event => {
  const input = event.target.closest?.('[data-lk-feature]'); if (!input) return;
  const s = lock.settings() || {features: [], relock: '5m'};
  const f = input.dataset.lkFeature;
  const want = input.checked;
  input.checked = s.features.includes(f); // 서버가 받은 뒤 다시 그린다(한 주인)
  const features = want ? [...new Set([...s.features, f])] : s.features.filter(x => x !== f);
  wantChange({features, relock: s.has_pin ? s.relock : ui.relockDraft});
});
// PC: 숫자 판이 보이면 키보드 숫자·지우기도.
document.addEventListener('keydown', event => {
  if (window.KPTURouter?.current !== 'lock' || ui.mode !== 'pad' || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.target?.closest?.('input,textarea,[contenteditable="true"]')) return;
  if (/^[0-9]$/.test(event.key)) { event.preventDefault(); press(event.key); }
  else if (event.key === 'Backspace') { event.preventDefault(); press('back'); }
});
window.KPTURouter?.on?.('lock', () => { void enter(); });
if (window.KPTURouter?.current === 'lock') void enter();
