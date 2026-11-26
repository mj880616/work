// SEC-기능PIN잠금 ②: '잠금' 화면(?view=lock). #lockView의 유일한 renderer(설계 docs/design/feature-pin-lock.md 4절).
// 두 쓰임: ① 계정 메뉴 [잠금] → 기능마다 켜기/끄기·다시 잠그기·[PIN 바꾸기] ② 잠긴 기능을 열면(문지기 feature-lock.js가 보냄) 그 자리에
// 자물쇠 + 'PIN 4자리' + 점 4개 + 숫자 판. PIN은 서버(app_lock_*)로만 보내 대조 결과만 받는다. 화면은 PIN을 어디에도 남기지 않는다
// (입력 중 숫자는 이 함수의 메모리에만, 서버에 보낸 뒤 바로 비움). 글자는 textContent로만 넣는다. 화면 전환·뒤로가기는 라우터가 맡는다.
import * as lock from './feature-lock.js';
import {waitHtml, failHtml} from './wait-state.js';
import {myFeaturesOrNull} from './my-features.js';
import {padBox, padTyped, tap, shake as padShake, wrongMsg, onPadKeys, keyOfClick} from './lock-pad.js';

const rpc = (name, body) => window.KPTURuntime.api('/rest/v1/rpc/' + name, {method: 'POST', body, singleFlight: false});
const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; };
const button = (className, text, data = {}) => { const b = el('button', className, text); b.type = 'button'; Object.assign(b.dataset, data); return b; };
const code = error => String(error?.message || '').match(/LOCK_[A-Z_]+/)?.[0] || '';

// 화면 상태(메모리만). mode: list | pad | forgot | wait | fail
// task: 정리함 노트에서 온 일(S67-14) — {notes:true} 잠긴 노트 열기, {folder:{id,name,locked}} 폴더 잠그기·잠금 해제.
const ui = {mode: 'list', purpose: '', step: 0, digits: '', first: '', old: '', msg: '', busy: false, change: null, relockDraft: '5m', features: null, target: null, task: null};
const reset = patch => Object.assign(ui, {purpose: '', step: 0, digits: '', first: '', old: '', msg: '', busy: false, change: null}, patch);
const folderWord = name => `'${[...String(name || '')].slice(0, 20).join('')}' 폴더`;

function install() {
  if (document.getElementById('lockView')) return;
  // S71-38: 전체화면 잠금은 브라우저 맨 위 겹(모달 dialog) 하나에 그린다 — 아래 [data-lk-layer] 참고.
  document.getElementById('appView')?.insertAdjacentHTML('beforeend', '<section id="lockView" class="view-panel hidden" aria-label="잠금"><div class="panel lk-view" data-lk-root></div><dialog class="lk-layer" data-lk-layer aria-label="잠금" tabindex="-1"></dialog></section>');
}
const root = () => document.querySelector('#lockView [data-lk-root]');
const layer = () => document.querySelector('#lockView [data-lk-layer]');

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
  // '앱 전체'(S69-08)는 맨 위, 누구에게나.
  return Object.keys(lock.FEATURE_NAMES).filter(f => f === 'app' || f === 'diary' || f === 'photos' || on.includes(f) || !Array.isArray(got) || got.includes(f));
}

// ── 그리기 ────────────────────────────────────────────────────────────────────────────────────
// S67-76(명진 11/21 "이 화면 전체화면으로"): 숫자 판·PIN 잊음 화면(잠긴 기능에서 온 대기·오류 포함)은 폰 잠금 화면처럼
// 윗줄·하단바까지 덮는다. 덮을지는 여기 한 곳(data-lk-full)에서 정하고 모양은 lock.css가 맡는다. 덮는 동안 나가는 길은 왼쪽 위 [✕]
// (라우터 back = 폰 뒤로 가기와 같은 길: 이전 화면, 없으면 홈).
const fullMode = () => ui.mode === 'pad' || ui.mode === 'forgot' || ((ui.mode === 'wait' || ui.mode === 'fail') && !!(ui.target || ui.task));
function closeButton() {
  const b = button('lk-close', '✕', {lkClose: ''}); b.setAttribute('aria-label', '나가기');
  return b;
}
// [✕]: 하려던 일(잠긴 기능 열기·폴더 잠그기)을 그만두고 이전 화면으로(라우터 back — 폰 뒤로 가기와 같은 길, 첫 화면이면 홈).
// 바로 아래 화면이 아직 잠긴 그 화면이면(새로 연 ?view=diary, 다시 잠겨 화면째 숨긴 때) 돌아가도 다시 이 판이 뜨므로 홈으로 간다.
function leave() {
  const target = ui.target || lock.pending()?.view || null;
  lock.clearPending(); reset({mode: 'list', task: null, target: null});
  const nav = window.navigation, entry = nav?.currentEntry;
  let below = null;
  try { const prev = Number.isInteger(entry?.index) && entry.index > 0 ? nav.entries()[entry.index - 1] : null; below = prev?.url ? new URL(prev.url).searchParams.get('view') : null; } catch { below = null; }
  if (below && (below === target || lock.locked(below))) { window.KPTURouter?.go?.('home', {source: 'api', replaceUrl: true}); return; }
  window.KPTURouter?.back?.();
}
// 앱 전체가 잠긴 동안(S69-08)은 나갈 화면이 없으므로 [✕] 대신 맨 아래 [로그아웃](다른 계정으로 쓰거나 기기를 넘길 때 갇히지 않게).
const appGate = () => lock.appLocked();
// ── 맨 위 겹(S71-38 SEC-잠금위로) ─────────────────────────────────────────────────────────────
// 전체화면 잠금(숫자 판·PIN 잊음·잠긴 기능에서 온 대기)은 열려 있던 입력 창·⋯ 메뉴·고르기 창·보기 창 위를 모두 덮어야 한다.
// 그 겹들은 z-index를 저마다 갖고(창 50, 메뉴 1000대), 일부는 이미 브라우저 맨 위 겹(showModal·popover)에 있어 z-index로는 이길 수 없다.
// 그래서 덮는 동안 판(root)을 모달 dialog(data-lk-layer) 안으로 옮겨 showModal()한다: 브라우저가 맨 위 겹 맨 끝에 두고(그 뒤에 연 것 말고는 모두 아래),
// 나머지 문서 전체를 inert로 만든다 — 아래 글자는 보이지도, 접근성 나무에 읽히지도, 눌리지도 않고 초점(Tab)은 판 안에서만 돈다.
// 아래 창은 닫거나 숨기지 않는다(쓰던 글·스크롤 그대로, A1). 풀려서 다른 화면으로 가면 close() — 브라우저가 초점을 쓰던 칸으로 돌려준다.
// 겹을 열고 닫는 곳은 여기 하나(draw·화면 바뀜·겹이 저절로 닫힘이 모두 이것만 부른다).
let settling = false;
function syncLayer() {
  const section = document.getElementById('lockView'), box = layer(), host = root();
  if (!section || !box || !host) return;
  const cover = window.KPTURouter?.current === 'lock' && !section.classList.contains('hidden') && fullMode();
  settling = true;
  try {
    if (cover) {
      if (host.parentNode !== box) box.append(host);
      if (!box.open) box.showModal();
      if (!box.contains(document.activeElement)) box.focus({preventScroll: true});
    } else {
      if (box.open) box.close();
      if (host.parentNode !== section) section.prepend(host);
    }
  } finally { settling = false; }
}
function draw() {
  const host = root(); if (!host) return;
  const full = fullMode();
  host.closest('#lockView')?.toggleAttribute('data-lk-full', full);
  if (ui.mode === 'wait') host.innerHTML = waitHtml({rows: 2});
  else if (ui.mode === 'fail') host.innerHTML = failHtml({retry: 'data-lk-retry', text: '잠금 설정을 읽지 못했어요'});
  else host.replaceChildren(ui.mode === 'pad' ? pad() : ui.mode === 'forgot' ? forgot() : list());
  const gate = full && appGate();
  if (full && !gate) host.prepend(closeButton());
  if (gate && ui.mode !== 'wait') host.append(button('secondary mini lk-logout', '로그아웃', {lkLogout: ''}));
  // 다시 그린 뒤에 겹을 맞춘다(눌렀던 칸이 다시 그려져 초점이 빠졌으면 겹이 다시 받는다 — 글쇠가 아래 문서로 새지 않게).
  syncLayer();
}

function list() {
  const s = lock.settings() || {has_pin: false, features: [], relock: '5m'};
  const box = el('div', 'lk-list');
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
  const seg = el('span', 'lk-seg ds-seg');
  const current = s.has_pin ? s.relock : ui.relockDraft;
  for (const [key, name] of lock.RELOCK) {
    const b = button('ds-seg-btn', name, {lkRelock: key});
    b.setAttribute('aria-pressed', String(key === current)); b.disabled = ui.busy; seg.append(b);
  }
  relock.append(seg);
  box.append(rows, relock);
  // 잠근 노트 폴더 수(잠그기·풀기는 노트 폴더 ⋯에서). 0개면 줄을 두지 않는다.
  const folders = lock.noteFolderLocks()?.length || 0;
  if (folders) { const line = el('p', 'lk-folders', `잠긴 노트 폴더 ${folders}개`); line.dataset.lkFolders = ''; box.append(line); }
  if (s.has_pin) box.append(button('secondary mini lk-change', 'PIN 바꾸기', {lkChange: ''}));
  if (ui.msg) box.append(el('p', 'lk-msg', ui.msg));
  return box;
}

const TITLES = {
  gate: () => ui.task?.notes ? '노트 잠김' : lock.appLocked() ? '앱 잠김' : `${lock.FEATURE_NAMES[lock.featureOf(ui.target)] || ''} 잠김`,
  folder: () => ui.step ? '한 번 더 입력' : ui.task?.folder?.locked ? `${folderWord(ui.task.folder.name)} 잠그기` : `${folderWord(ui.task?.folder?.name)} 잠금 해제`,
  setup: () => ui.step ? '한 번 더 입력' : 'PIN 정하기',
  confirm: () => 'PIN 확인',
  change: () => ['지금 PIN', '새 PIN', '새 PIN 한 번 더'][ui.step],
  renew: () => ui.step ? '한 번 더 입력' : '새 PIN 정하기',
};
// 숫자 판은 lock-pad.js 한 부품(그 자리 작은 PIN 창과 같은 판).
function pad() {
  const canForget = ui.purpose === 'gate' || ui.purpose === 'confirm' || (ui.purpose === 'change' && ui.step === 0) || (ui.purpose === 'folder' && !ui.change?.setup);
  return padBox({title: TITLES[ui.purpose]?.() || '', digits: ui.digits.length, msg: ui.msg, busy: ui.busy, forgot: canForget,
    cancel: ui.purpose !== 'gate' || !!ui.task?.notes});
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
const shake = () => padShake(root());

// ── 흐름 ────────────────────────────────────────────────────────────────────────────────────
const resultMsg = wrongMsg;
async function send(fn, body) {
  ui.busy = true; draw();
  try { return await rpc(fn, body); }
  finally { ui.busy = false; }
}
async function entered() {
  const pin = ui.digits; ui.digits = '';
  const p = ui.purpose;
  // 두 번 입력하는 단계: 첫 번째는 메모리에만 두고 다음 단계로.
  if ((p === 'setup' || p === 'renew' || (p === 'folder' && ui.change?.setup)) && ui.step === 0) { ui.first = pin; ui.step = 1; ui.msg = ''; draw(); return; }
  if (p === 'change' && ui.step === 0) { ui.old = pin; ui.step = 1; ui.msg = ''; draw(); return; }
  if (p === 'change' && ui.step === 1) { ui.first = pin; ui.step = 2; ui.msg = ''; draw(); return; }
  if ((p === 'setup' || p === 'renew' || p === 'change' || (p === 'folder' && ui.change?.setup)) && pin !== ui.first) {
    ui.first = ''; ui.step = p === 'change' ? 1 : 0; ui.msg = '두 번 입력한 PIN이 달라요. 다시 입력해 주세요'; draw(); shake(); return;
  }
  try {
    if (p === 'folder') {
      const f = ui.task.folder;
      // PIN이 아직 없으면 먼저 정한다(잠근 기능 없이, 다시 잠그기는 기본값) — 그 PIN으로 바로 폴더를 잠근다.
      if (ui.change?.setup) { const res = await send('app_lock_setup', {p_pin: pin, p_features: [], p_relock: ui.relockDraft}); lock.applySaved(res); ui.change = null; }
      const res = await send('app_lock_note_folder_set', {p_pin: pin, p_folder: f.id, p_locked: f.locked});
      if (res?.ok) { lock.applyNoteFolders(res); reset({mode: 'list', task: null}); lock.markOpen(); return; }
      ui.msg = resultMsg(res); draw(); shake(); return;
    }
    if (p === 'gate') {
      const res = await send('app_lock_check', {p_pin: pin});
      if (res?.ok) {
        // 문지기가 보낸 일(pending)은 markOpen이 그 화면으로 보낸다(시작 문지기면 시작 순서가). 새로고침한 ?view=lock&for=…이면 여기서 돌려보낸다.
        const back = lock.pending() ? null : ui.target;
        reset({mode: 'list', task: null}); lock.markOpen();
        if (back && window.KPTURouter?.current === 'lock') window.KPTURouter?.go?.(back, {source: 'api', replaceUrl: true});
        return;
      }
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
      // 앱을 열 때 시작 문지기가 연 잠금 화면이면, 풀린 뒤 첫 화면은 시작 순서가 연다(여기서 옮기지 않음).
      const startup = !!lock.pending()?.startup;
      reset({mode: 'list', msg: 'PIN을 새로 정했어요'});
      lock.applySaved(null);
      if (startup) return;
      if (target && lock.canReturnTo(target)) { lock.markOpen({thenGo: false}); window.KPTURouter?.go?.(target, {source: 'api', replaceUrl: true}); return; }
      window.KPTURouter?.setPlace?.('lock', {renew: null, for: null});
      draw(); return;
    }
  } catch (error) {
    const why = code(error);
    if (why === 'LOCK_RECENT_LOGIN_REQUIRED') { reset({mode: 'forgot', target: ui.target, msg: '로그인한 지 오래됐어요. 구글 로그인을 다시 해 주세요'}); draw(); return; }
    if (why === 'LOCK_PIN_EXISTS' || why === 'LOCK_PIN_MISSING') { await lock.refresh(); reset({mode: 'list', task: null, msg: '설정이 바뀌어 다시 읽었어요'}); lock.clearPending(); draw(); return; }
    if (why === 'LOCK_FOLDER_FORBIDDEN' || why === 'LOCK_FOLDER_LIMIT') {
      ui.first = ''; ui.step = 0; ui.msg = why === 'LOCK_FOLDER_LIMIT' ? '잠글 수 있는 폴더는 50개까지예요' : '이 폴더는 잠글 수 없어요'; draw(); return;
    }
    ui.first = ''; ui.old = ''; ui.step = 0;
    ui.msg = '확인하지 못했어요. 잠시 뒤 다시 해 주세요'; draw();
  }
}
function press(key) {
  if (ui.mode !== 'pad' || ui.busy) return;
  // S67-72: 판은 그대로 두고 점·안내 줄만 바꾼다(눌림 표시가 보이게, lock-pad.js padTyped).
  if (key === 'back') { ui.digits = ui.digits.slice(0, -1); tap(); if (!padTyped(root(), {digits: ui.digits.length, msg: ui.msg})) draw(); return; }
  if (!/^[0-9]$/.test(key) || ui.digits.length >= 4) return;
  ui.digits += key; ui.msg = ui.digits.length === 1 ? '' : ui.msg; tap(); if (!padTyped(root(), {digits: ui.digits.length, msg: ui.msg})) draw();
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
  const task = lock.pending()?.notes || lock.pending()?.folder ? {notes: !!lock.pending().notes, folder: lock.pending().folder || null} : null;
  // 앱 전체가 잠겼는데 보낼 화면이 없으면(잠금 화면을 바로 연 때) 풀린 뒤 홈으로.
  const target = lock.pending()?.view || (lock.canReturnTo(place.for) ? place.for : null) || (lock.appLocked() && !task ? 'home' : null);
  reset({mode: 'wait', target, task});
  draw();
  await lock.ready();
  if (window.KPTURouter?.current !== 'lock') return;
  if (lock.readFailed()) { ui.mode = 'fail'; draw(); return; }
  // 시작 문지기가 연 때(주소는 원래 화면 그대로)는 주소를 고치지 않는다.
  const startup = !!lock.pending()?.startup;
  if (target && !task && !startup) window.KPTURouter?.setPlace?.('lock', {for: target});
  if (task) {
    if (!lock.pendingNeedsPin()) { lock.markOpen(); return; }
    if (task.folder) { reset({mode: 'pad', purpose: 'folder', target, task, change: lock.settings()?.has_pin ? null : {setup: true}}); draw(); return; }
    reset({mode: 'pad', purpose: 'gate', target, task}); draw(); return;
  }
  if ((place.renew === '1' || lock.pending()?.renew) && lock.settings()?.has_pin) {
    reset({mode: recentLogin() ? 'pad' : 'forgot', purpose: recentLogin() ? 'renew' : '', target}); draw(); return;
  }
  if (target) {
    if (!lock.locked(target)) { if (startup) return; const hold = !!lock.pending()?.hold; lock.clearPending(); window.KPTURouter?.go?.(target, {source: 'api', replaceUrl: true, ...(hold ? {hold: true} : {})}); return; }
    reset({mode: 'pad', purpose: 'gate', target}); draw(); return;
  }
  ui.features = await shownFeatures();
  reset({mode: 'list', target: null}); draw();
}

install();
const padDown = onPadKeys(document.querySelector('#lockView'), press);
// 겹의 Esc·폰 뒤로 가기(브라우저가 모달에 보내는 cancel)는 겹을 닫지 않는다: [✕]가 있는 판이면 [✕]와 같은 길(이전 화면), 앱 전체가 잠겼으면 아무 일 없음.
layer()?.addEventListener('cancel', event => { event.preventDefault(); if (fullMode() && !appGate()) leave(); });
// 브라우저가 cancel 없이 겹을 닫아 버린 때(같은 Esc를 거듭 누름 등)에도 잠금이 남아 있으면 곧바로 다시 덮는다.
layer()?.addEventListener('close', () => { if (!settling) syncLayer(); });
// 화면이 잠금에서 다른 화면으로 바뀌면(풀림·[✕]·로그아웃) 겹을 닫는다 — 라우터가 #lockView를 숨긴 같은 차례에서.
window.addEventListener('kptu:view-changed', () => syncLayer());
function onClick(event) {
  const key = keyOfClick(event); if (key != null) { if (key) press(key); return; }
  const t = event.target.closest?.('button,[data-lk-retry]'); if (!t) return;
  if (t.matches('[data-lk-retry]')) { void lock.refresh().then(enter); return; }
  if (t.matches('[data-lk-close]')) { leave(); return; }
  if (t.matches('[data-lk-logout]')) { t.disabled = true; void window.KPTUTeamAuth?.logout?.(); return; }
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
    if (ui.task && ui.purpose !== 'renew') { reset({mode: 'list', task: null}); lock.clearPending(); window.KPTURouter?.go?.('basket', {source: 'api', replaceUrl: true, sub: 'note'}); return; }
    if (ui.target) { reset({mode: 'pad', purpose: 'gate', target: ui.target}); draw(); return; }
    reset({mode: 'list'}); window.KPTURouter?.setPlace?.('lock', {renew: null}); draw(); return;
  }
  if (t.matches('[data-lk-change]')) { askPin('change'); return; }
  if (t.dataset.lkRelock) {
    const s = lock.settings() || {features: []};
    if ((s.has_pin ? s.relock : ui.relockDraft) === t.dataset.lkRelock) return;
    wantChange({features: s.features, relock: t.dataset.lkRelock}); return;
  }
}
document.querySelector('#lockView')?.addEventListener('click', onClick);
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
function onKey(event) {
  if (window.KPTURouter?.current !== 'lock' || ui.mode !== 'pad' || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.target?.closest?.('input,textarea,[contenteditable="true"]')) return;
  if (/^[0-9]$/.test(event.key)) { event.preventDefault(); press(event.key); }
  else if (event.key === 'Backspace') { event.preventDefault(); press('back'); }
}
document.addEventListener('keydown', onKey);
// S71-38 가림막: 맨 위 겹이 덮는 동안 그 안에서 생긴 누르기·글쇠 사건은 앱의 다른 손잡이에 가지 않는다.
// 브라우저 inert는 아래 칸이 사건을 받지 못하게만 한다 — document·window에서 듣는 손잡이(⋯ 메뉴 '바깥 누름'으로 닫기·Esc·Tab 돌리기,
// 창의 Enter 저장 등)는 잠금 판을 누른 사건도 받아, 아래 메뉴가 닫히며 뒤로 가기를 하거나 아래 창이 움직였다.
// 그래서 window 잡기 단계(문서의 어떤 손잡이보다 앞)에서 멈추고 잠금 화면 자신의 손잡이에만 넘긴다. 브라우저 기본 동작(단추 누름·Tab 이동)은 그대로.
const OWN = {pointerdown: padDown, click: onClick, keydown: onKey};
const SHIELD = ['pointerdown', 'pointerup', 'pointercancel', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu',
  'keydown', 'keyup', 'keypress', 'beforeinput', 'input', 'change', 'paste', 'copy', 'cut'];
const PASSIVE = ['touchstart', 'touchmove', 'touchend', 'touchcancel', 'wheel'];
// 덮는 동안 나머지 문서는 inert라 사건은 판 안이나(누르기·초점) 문서 몸통(초점이 빠진 순간의 글쇠)에서만 생긴다 — 어느 쪽이든 멈춘다.
function shield(event) {
  const box = layer();
  if (!box?.open || !box.matches(':modal')) return;
  event.stopPropagation();
  OWN[event.type]?.(event);
}
for (const type of SHIELD) window.addEventListener(type, shield, true);
for (const type of PASSIVE) window.addEventListener(type, shield, {capture: true, passive: true});
window.KPTURouter?.on?.('lock', () => { void enter(); });
// 앱 전체(S69-08): 잠금 설정 목록을 보던 중 앱 전체가 다시 잠기면(앱을 떠났다 돌아옴) 목록 대신 숫자 판.
window.addEventListener('kptu:feature-lock-changed', () => { if (window.KPTURouter?.current === 'lock' && ui.mode === 'list' && lock.appLocked()) void enter(); });
if (window.KPTURouter?.current === 'lock') void enter();
