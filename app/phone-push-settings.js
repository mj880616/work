// APP-폰알림 N4(설계 docs/design/phone-notifications.md 3·4.4절, 사용자 결정 N-D5): 내 프로필의 '폰 알림' 칸과 폰 기기 등록.
// 서버 함수 phone-push(사용자 입구: register·unregister·test)를 부르는 곳은 이 파일 하나다('Notification boundary check' 허용 위치).
// - 종류별 켜기/끄기·조용한 시간: 내 프로필 행(app_profiles.notify_prefs, 기존 owner RLS PATCH)에 바로 저장한다. 기기에는 아무것도 남기지 않는다.
// - 등록된 폰 목록: app_push_devices를 기존 RLS로 읽는다(토큰 칸은 읽을 수 없음, migration 20261101010000). [끊기]는 phone-push unregister.
// - 폰 앱(KPTUAndroid)에서만: 앱 다리(KPTUAppShell, 허용 Origin 최상위 화면에만 보임)로 이 폰 상태를 묻고(push:hello),
//   [이 폰에서 받기]·[시험 알림]은 알림 권한을 한 번 묻고(push:enable), [이 폰 끊기]는 서버에서 지운 뒤 앱 토큰을 지운다(push:forget).
//   앱이 준 토큰은 이 화면 메모리에만 두고, 웹 세션(JWT)으로 register 한다. 화면·로그에 출력하지 않는다.
// - startDeviceSync: 폰 앱이 웹2를 열 때마다(loader-v2.js) 이 폰이 '켜짐'이면 다시 등록해 바뀐 토큰·마지막 시각을 맞춘다.
// - 최근 알림 7일(UI-앱안알림 5단계, 설계 6절 A6): 폰 알림과 맨 위 알림 줄이 같은 기록(app_push_log)에서 phone-push recent로 읽어
//   '시각 · 무엇' 한 줄씩. 누르면 그 자리(notice-place.js goPlace)로 가고 아직 안 연 것은 '열었음'을 남긴다.
import {myFeaturesOrNull, collectsFeeds} from './my-features.js';
import {barHtml, failHtml} from './wait-state.js';
import {goPlace} from './notice-place.js';
import {KINDS, FAMILY_KIND, SIGNUP_KIND, NOTE_KIND, SIGNUP_FEATURE, COLLECT_KINDS, parsePrefs, serializePrefs, toggleKind, bridgeState, appVersion, isPhoneApp, errorText, testResultText, deviceLabel, TIME, recentItems, noticeClearMessage, KIND_DESC} from './phone-push-model.mjs';
import {word} from './brand/brand.mjs';
import {groupHtml, switchRow, infoRow, actionRow, foldRow, shortTime} from './settings-list.mjs';

const ENDPOINT = '/functions/v1/phone-push';
const BRIDGE = 'KPTUAppShell';
const MAX_DEVICES = 10;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const encode = encodeURIComponent;

export function callPush(rt, action, body = {}) {
  return rt.api(`${ENDPOINT}?action=${encode(action)}`, {method: 'POST', body, singleFlight: false});
}

/**
 * 알림 자리를 열었음: 서버에 '열었음'(opened)을 남기고, 폰 앱이면 알림창의 그 폰 알림도 지운다(APP-알림숫자지우기 ②, 아이콘 숫자도 줄어듦).
 * PC·폰 브라우저는 다리가 없어 서버 기록만 남긴다(다른 기기의 폰 알림은 지우지 않음 — 새 서버 길을 만들지 않음).
 * 알림 줄(notice-done.js)·최근 알림 7일이 함께 쓴다. 기다리지 않고, 실패해도 화면은 그대로 간다.
 */
export function markNoticeOpened(rt, item, win = window) {
  const message = noticeClearMessage(item?.kind, item?.ref_key);
  if (message) {
    try { bridgeOf(win)?.postMessage(message); } catch { /* 다리가 사라진 화면 */ }
  }
  return callPush(rt, 'opened', {kind: item?.kind, ref_key: item?.ref_key}).catch(() => null);
}

// ---- 이 폰(앱 다리) — 화면 하나에 하나 ------------------------------------------------------------------------------------
const phone = {state: 'unknown', token: null, deviceId: null, error: '', registering: null, bridge: null, rt: null, win: null, waiters: [], listeners: new Set()};
const changed = () => { for (const fn of phone.listeners) { try { fn(); } catch { /* 칸이 사라짐 */ } } };

function bridgeOf(win) {
  if (phone.bridge) return phone.bridge;
  if (!isPhoneApp(win?.navigator?.userAgent)) return null;
  const b = win[BRIDGE];
  if (!b || typeof b.postMessage !== 'function' || typeof b.addEventListener !== 'function') return null;
  phone.bridge = b;
  phone.win = win;
  b.addEventListener('message', event => onBridge(typeof event?.data === 'string' ? event.data : ''));
  return b;
}

function onBridge(data) {
  const s = bridgeState(data);
  if (!s) return;
  if (s.state !== 'on' || s.token !== phone.token) phone.deviceId = null;
  phone.state = s.state;
  phone.token = s.state === 'on' ? s.token : null;
  if (s.state === 'on') void registerPhone();
  const waiters = phone.waiters.splice(0);
  for (const fn of waiters) fn(s);
  changed();
}

function send(message) {
  try { phone.bridge?.postMessage(message); } catch { /* 다리가 사라진 화면 */ }
}

/** 앱에 묻고 다음 상태 글을 기다린다(알림 허용 창은 사람이 누를 때까지 걸릴 수 있다). */
function askPhone(message, ms = 15000) {
  if (!phone.bridge) return Promise.resolve({state: 'none'});
  return new Promise(resolve => {
    let done = false;
    const finish = s => { if (done) return; done = true; clearTimeout(timer); resolve(s); };
    const timer = setTimeout(() => { phone.waiters = phone.waiters.filter(f => f !== finish); finish({state: 'fail'}); }, ms);
    phone.waiters.push(finish);
    send(message);
  });
}

function registerPhone() {
  if (!phone.rt || !phone.token) return Promise.resolve(false);
  if (phone.registering) return phone.registering;
  const token = phone.token;
  const body = {token};
  const version = appVersion(phone.win?.navigator?.userAgent);
  if (version) body.app_version = version;
  phone.registering = (async () => {
    try {
      const out = await callPush(phone.rt, 'register', body);
      if (phone.token === token) phone.deviceId = typeof out?.device?.id === 'string' ? out.device.id : null;
      phone.error = '';
      return true;
    } catch (e) {
      phone.error = e?.message || '';
      return false;
    } finally {
      phone.registering = null;
      changed();
    }
  })();
  return phone.registering;
}

/** 폰 앱이 웹2를 열 때 한 번: 이 폰이 '켜짐'이면 다시 등록(토큰이 바뀌었을 수 있음). 웹 브라우저에서는 아무것도 하지 않는다. */
export function startDeviceSync(win = window) {
  if (win.__KPTU_PHONE_PUSH_SYNC__) return false;
  if (!bridgeOf(win)) return false;
  win.__KPTU_PHONE_PUSH_SYNC__ = true;
  phone.rt = phone.rt || win.KPTURuntime || null;
  send('push:hello');
  return true;
}

// ---- 내 프로필 '폰 알림' 칸 ------------------------------------------------------------------------------------------------

export function mountPhonePushSettings(host, {rt, win = window, onSummary} = {}) {
  phone.rt = phone.rt || rt;
  const inApp = !!bridgeOf(win);
  let state = {phase: 'loading', prefs: parsePrefs(null), family: false, signup: false, collector: true, devices: [], devicesOk: false, recent: [], recentOk: false, busy: false, note: '', result: ''};
  let run = 0, saveChain = Promise.resolve(), savedPrefs = null;
  const userId = () => rt.context?.read?.()?.user?.id || '';
  const workspaceId = () => rt.context?.read?.()?.workspace?.id || '';

  // S71-36 PROFILE-설정화면: 장 안은 공용 설정 줄(settings-list.mjs). 이 폰 알림(앱에서만) / 알림 종류 묶음 / 조용한 시간 ›·시험 알림 보내기·등록된 폰 ›·최근 알림 7일 ›.
  // 어떤 종류가 보이는지는 지금과 같다(서버 app_my_features 답). 저장·서버 호출도 그대로다.
  function phoneRow() {
    if (!inApp) return '';
    const busy = state.busy;
    const desc = {on: phone.error ? `등록 못 함 · ${errorText(phone.error)}` : '이 폰으로 알림 받기', off: '이 폰으로 알림 받기',
      denied: word('알림 허용 꺼짐 · 폰 설정 › 애플리케이션 › WORK ON+ › 알림'), fail: '폰 주소를 받지 못했어요'}[phone.state];
    if (phone.state === 'none') return infoRow({label: '이 폰 알림', desc: '이 앱 판은 알림을 받지 못해요 · 새 판으로 업데이트해 주세요', attrs: {'data-ps-push-phone': 'none'}});
    if (!desc) return '';
    return switchRow({label: '이 폰 알림', desc, checked: phone.state === 'on', disabled: busy, attrs: {'data-ps-push-phone-switch': true}, rowAttrs: {'data-ps-push-phone': phone.state}});
  }

  function devicesRow() {
    if (!state.devicesOk) return infoRow({label: '등록된 폰', desc: '등록된 폰을 읽지 못했어요', attrs: {'data-ps-push-devices': 'failed'}});
    const busy = state.busy ? ' disabled' : '';
    const rows = state.devices.map(d => {
      const mine = inApp && phone.deviceId && d.id === phone.deviceId;
      const label = deviceLabel(d) + (mine ? ' · 이 폰' : '');
      return infoRow({label, end: `<button type="button" class="row-act" data-ps-push-remove="${esc(d.id)}" aria-label="${esc(label)} 끊기"${busy}>끊기</button>`});
    }).join('');
    return foldRow({label: '등록된 폰', sum: state.devices.length ? `${state.devices.length}대` : '없음', sumAttrs: {'data-ps-push-devices': state.devices.length}, body: rows, attrs: {'data-ps-push-fold': 'devices'}, open: isOpen('devices')});
  }

  function recentRow() {
    if (!state.recentOk) return infoRow({label: '최근 알림 7일', desc: '최근 알림을 읽지 못했어요', attrs: {'data-ps-push-recent': 'failed'}});
    const rows = state.recent.map((r, i) => actionRow({label: r.line, attrs: {'data-ps-push-recent-open': i, 'data-opened': r.opened ? true : null, class: 'ps-push-recent'}})).join('');
    return foldRow({label: '최근 알림 7일', sum: state.recent.length ? `${state.recent.length}건` : '없음', sumAttrs: {'data-ps-push-recent': state.recent.length}, body: rows, attrs: {'data-ps-push-fold': 'recent'}, open: isOpen('recent')});
  }

  let openFolds = new Set();
  const isOpen = key => openFolds.has(key);
  const keepFolds = () => { if (host.querySelector('[data-ps-push-fold]')) openFolds = new Set([...host.querySelectorAll('[data-ps-push-fold][open]')].map(el => el.dataset.psPushFold)); };

  function summary() {
    if (state.phase !== 'ready') return;
    const where = inApp && ['on', 'off', 'denied', 'fail'].includes(phone.state) ? (phone.state === 'on' ? '켜짐' : '꺼짐')
      : state.devicesOk ? (state.devices.length ? `폰 ${state.devices.length}대` : '폰 없음') : '';
    const quiet = `조용한 시간 ${shortTime(state.prefs.quiet.from)}–${shortTime(state.prefs.quiet.to)}`;
    onSummary?.({text: where ? `${where} · ${quiet}` : quiet});
  }

  function render() {
    if (!host.isConnected) return;
    keepFolds();
    const status = `<p class="sl-status" data-ps-push-state role="status" aria-live="polite">${esc(state.note)}</p>`;
    if (state.phase === 'loading') { host.innerHTML = `${status}${barHtml()}`; return; }
    if (state.phase === 'failed') { host.innerHTML = `${status}${failHtml()}`; return; }
    summary();
    const busy = state.busy;
    const {prefs} = state;
    // 잊지 말기 줄은 운영자 기능 family가 있을 때만(서버 app_my_features). 화면에서 빼는 것은 보안이 아님(알림은 서버가 family 작업공간에만 보냄).
    // MULTI-처음쓰는사람 ⑤: '수집 멈춤·아침 묶음·저녁 묶음'은 통화·텔레그램 수집이 있는 운영자 계정에만(서버 app_my_features). 저장값은 그대로 둔다.
    // OPS-새가입알림: '새 가입' 줄은 운영자(dev_inbox)일 때만. 알림 자체는 서버가 운영자 작업공간에만 보낸다.
    // S69-97: '노트 알림' 줄은 모두에게(노트에 건 알림은 누구나 쓴다). 기본 켬, 끌 때만 kinds.note=false로 저장.
    const kinds = [...KINDS.filter(([key]) => state.collector || !COLLECT_KINDS.has(key)), NOTE_KIND, ...(state.family ? [FAMILY_KIND] : []), ...(state.signup ? [SIGNUP_KIND] : [])];
    const on = key => key === FAMILY_KIND[0] ? prefs.family !== false : key === SIGNUP_KIND[0] ? prefs.signup !== false : key === NOTE_KIND[0] ? prefs.note !== false : prefs.kinds[key];
    const kindRows = kinds.map(([key, label]) => switchRow({label, desc: KIND_DESC[key] || '', checked: !!on(key), disabled: busy, attrs: {'data-ps-push-kind': key}, ariaLabel: `${label} 알림`}));
    const time = (end, label) => `<input type="time" class="ps-push-time" data-ps-push-quiet="${end}" value="${esc(prefs.quiet[end])}" aria-label="${label}" step="300"${busy ? ' disabled' : ''}>`;
    const quiet = foldRow({label: '조용한 시간', desc: '이 시간엔 소리 없이', sum: `${prefs.quiet.from}–${prefs.quiet.to}`, sumAttrs: {'data-ps-push-quiet-sum': true}, attrs: {'data-ps-push-fold': 'quiet'}, open: isOpen('quiet'),
      body: `<div class="sl-row ps-push-quiet-row">${time('from', '조용한 시간 시작')}<span aria-hidden="true">~</span>${time('to', '조용한 시간 끝')}</div>`});
    const test = actionRow({label: '시험 알림 보내기', desc: state.result || '', descAttrs: state.result ? {'data-ps-push-result': true} : null, disabled: busy, busy, attrs: {'data-ps-push-test': true}});
    host.innerHTML = `${status}${groupHtml([phoneRow()])}${groupHtml(kindRows, {title: '알림 종류', attrs: {role: 'group', 'aria-label': '받을 알림 종류'}})}${groupHtml([quiet, test, devicesRow(), recentRow()])}`;
  }
  const say = note => { state = {...state, note}; const el = host.querySelector('[data-ps-push-state]'); if (el) el.textContent = note; };
  const onPhone = () => render();
  phone.listeners.add(onPhone);

  async function readPrefs() {
    const rows = await rt.api(`/rest/v1/app_profiles?user_id=eq.${encode(userId())}&select=notify_prefs&limit=1`, {singleFlight: false});
    return parsePrefs(Array.isArray(rows) ? rows[0]?.notify_prefs : null);
  }
  async function readDevices() {
    const ws = workspaceId();
    if (!ws) throw new Error('workspace');
    const rows = await rt.api(`/rest/v1/app_push_devices?workspace_id=eq.${encode(ws)}&revoked_at=is.null&select=id,app_version,created_at,last_seen_at&order=last_seen_at.desc&limit=${MAX_DEVICES}`, {singleFlight: false});
    return (Array.isArray(rows) ? rows : []).filter(d => typeof d?.id === 'string');
  }
  async function readRecent() {
    return recentItems(await callPush(rt, 'recent'));
  }
  async function reloadDevices() {
    try { state = {...state, devices: await readDevices(), devicesOk: true}; } catch { state = {...state, devicesOk: false}; }
    render();
  }

  async function load() {
    const mine = ++run;
    if (!userId()) { state = {...state, phase: 'failed'}; render(); return; }
    state = {...state, phase: 'loading', note: '', result: ''}; render();
    if (inApp) send('push:hello');
    const [prefs, devices, recent, features] = await Promise.allSettled([readPrefs(), readDevices(), readRecent(),
      myFeaturesOrNull(rt)]); // 공용 my-features.js: 홈에서 이미 읽은 답을 같이 쓴다(못 읽으면 null)
    if (mine !== run) return;
    const got = features.status === 'fulfilled' ? features.value : null;
    // 답을 못 받으면 잊지 말기 칩은 지금처럼 빼고, 운영자 알림 칩은 지금처럼 둔다(운영자 화면이 빠지지 않게).
    state = {...state, family: Array.isArray(got) && got.includes(FAMILY_KIND[0]), signup: Array.isArray(got) && got.includes(SIGNUP_FEATURE), collector: collectsFeeds(got)};
    if (prefs.status !== 'fulfilled') { state = {...state, phase: 'failed'}; render(); return; }
    savedPrefs = prefs.value;
    state = {...state, phase: 'ready', prefs: prefs.value, devices: devices.status === 'fulfilled' ? devices.value : [], devicesOk: devices.status === 'fulfilled',
      recent: recent.status === 'fulfilled' ? recent.value : [], recentOk: recent.status === 'fulfilled'};
    render();
  }

  // 바꾸면 바로 저장. 저장은 한 줄로 세워 앞 저장이 끝난 뒤 다음 것을 보낸다. 실패하면 화면 값을 마지막 저장 값으로 되돌린다.
  function savePrefs(next) {
    const before = savedPrefs || state.prefs;
    const body = serializePrefs(next);
    if (!body) { render(); return saveChain; }
    state = {...state, prefs: next}; render();
    saveChain = saveChain.then(async () => {
      try {
        await rt.api(`/rest/v1/app_profiles?user_id=eq.${encode(userId())}`, {method: 'PATCH', body: {notify_prefs: body}});
        savedPrefs = next;
        say('저장했어요');
      } catch {
        state = {...state, prefs: before}; render();
        say('저장하지 못했어요. 다시 해 주세요.');
      }
    });
    return saveChain;
  }

  async function withBusy(fn) {
    if (state.busy) return;
    state = {...state, busy: true, result: ''}; render();
    try { await fn(); } finally { state = {...state, busy: false}; render(); }
  }

  /** 앱에서 이 폰을 켠다(알림 권한 한 번 묻기 + 토큰 → 등록). 켜졌으면 true. */
  async function enablePhone() {
    const s = await askPhone('push:enable', 120000);
    if (s.state !== 'on') {
      say(s.state === 'denied' ? '알림 허용이 꺼져 있어요' : s.state === 'none' ? '이 앱 판은 알림을 받지 못해요' : '폰 주소를 받지 못했어요');
      return false;
    }
    const ok = await (phone.registering || registerPhone());
    if (!ok && !phone.deviceId) { say(errorText(phone.error)); return false; }
    return true;
  }

  async function forgetPhone() {
    if (phone.token) await callPush(rt, 'unregister', {token: phone.token});
    await askPhone('push:forget');
  }

  host.addEventListener('click', async event => {
    const b = event.target.closest('button');
    if (!b || b.disabled || state.busy || state.phase !== 'ready') return;
    if (b.dataset.psPushRecentOpen !== undefined) {
      const item = state.recent[Number(b.dataset.psPushRecentOpen)];
      if (!item) return;
      if (!item.opened) { item.opened = true; void markNoticeOpened(rt, item, win); }
      goPlace(item.open, win);
      return;
    }
    if ('psPushTest' in b.dataset) {
      await withBusy(async () => {
        if (inApp && phone.state !== 'on' && !(await enablePhone())) { await reloadDevices(); return; }
        try {
          const out = await callPush(rt, 'test');
          state = {...state, result: testResultText(out)};
          say('');
        } catch (e) {
          say(errorText(e?.message));
        }
        await reloadDevices();
      });
      return;
    }
    const id = b.dataset.psPushRemove;
    if (id) {
      await withBusy(async () => {
        try {
          if (inApp && phone.deviceId === id) await forgetPhone();
          else await callPush(rt, 'unregister', {device_id: id});
          say('끊었어요');
        } catch (e) { say(errorText(e?.message)); }
        await reloadDevices();
      });
    }
  });
  host.addEventListener('change', async event => {
    const kindBox = event.target.closest('[data-ps-push-kind]');
    if (kindBox) {
      if (state.busy || state.phase !== 'ready') return;
      const kind = kindBox.dataset.psPushKind;
      await savePrefs(toggleKind(state.prefs, kind));
      host.querySelector(`[data-ps-push-kind="${kind}"]`)?.focus({preventScroll: true});
      return;
    }
    const phoneBox = event.target.closest('[data-ps-push-phone-switch]');
    if (phoneBox) {
      if (state.busy || state.phase !== 'ready') { render(); return; }
      if (phoneBox.checked) await withBusy(async () => { if (await enablePhone()) say('이 폰에서 받아요'); await reloadDevices(); });
      else await withBusy(async () => {
        try { await forgetPhone(); say('이 폰을 끊었어요'); } catch (e) { say(errorText(e?.message)); }
        await reloadDevices();
      });
      host.querySelector('[data-ps-push-phone-switch]')?.focus({preventScroll: true});
      return;
    }
    const input = event.target.closest('[data-ps-push-quiet]');
    if (!input || state.phase !== 'ready') return;
    const end = input.dataset.psPushQuiet;
    if (!TIME.test(input.value)) { input.value = state.prefs.quiet[end]; return; }
    void savePrefs({...state.prefs, quiet: {...state.prefs.quiet, [end]: input.value}});
  });

  render();
  return {load, destroy: () => phone.listeners.delete(onPhone)};
}
