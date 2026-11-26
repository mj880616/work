// S69-34 APP-업데이트확인(사용자 요청 "앱에 업데이트 확인 버튼 추가 현재 버전 몇인지도 알려주고"): 계정 메뉴 '앱 정보' 작은 창.
// - 지금 쓰는 판을 모두 보인다: 화면(웹) 판(배포 시각·판 번호), 폰 앱 판(직접 설치판/플레이판), 옛 윈도우 앱 판, 이 PC의 파일 올리기 도우미 판(문이 켜져 있을 때).
// - [업데이트 확인]: 화면은 version-notice.js와 같은 확인(배포된 index.html이 부르는 app.js 판)·같은 다시 읽기(쓰던 내용 확인 뒤 location.reload),
//   폰 앱은 앱 다리 update:check(직접 설치판은 앱이 바로 새 판 확인, 플레이판은 플레이 스토어를 연다), 도우미는 배포 때 정한 최신 판(pc-app.json)과 비교해 안내만.
// - 저장 없음(메모리만), 서버 통로 없음. 읽는 것은 같은 주소의 공개 정적 파일(build-info.json·phone-app.json·pc-app.json)뿐이다.
import {openFormModal} from './small-form-modal.js';
import {appVersionNow} from './version-notice.js';
import {shellOf, isNewer, buildInfo, webLine, phoneAnswer, phoneText} from './app-info-model.mjs';
import {loadPhoneAppInfo, apkFromInfo, loadPcAppInfo, setupFromInfo, isWindowsPc, PC_HELPER_NAME} from './app-download.mjs';
import {createPcFiles} from './pc-files.js';

const BRIDGE = 'KPTUAppShell';
const PHONE_WAIT_MS = 15000;
const PLAY_ID = 'com.workonplus.app';
const el = (tag, className, text) => { const n = document.createElement(tag); if (className) n.className = className; if (text != null) n.textContent = text; return n; };

// 폰 앱 다리 답을 기다리는 것 하나(한 번에 하나만 묻는다). 다리 듣기는 한 번만 붙인다.
let waiting = null, listening = false;
function bridge() {
  const b = window[BRIDGE];
  return b && typeof b.postMessage === 'function' && typeof b.addEventListener === 'function' ? b : null;
}
function askPhone(message) {
  const b = bridge();
  if (!b) return Promise.resolve(null);
  if (!listening) {
    listening = true;
    b.addEventListener('message', event => {
      const answer = phoneAnswer(typeof event?.data === 'string' ? event.data : '');
      if (answer && waiting) { const done = waiting; waiting = null; done(answer); }
    });
  }
  return new Promise(resolve => {
    waiting?.(null);
    const timer = setTimeout(() => { if (waiting === finish) { waiting = null; resolve(null); } }, PHONE_WAIT_MS);
    function finish(answer) { clearTimeout(timer); resolve(answer); }
    waiting = finish;
    try { b.postMessage(message); } catch { waiting = null; clearTimeout(timer); resolve(null); }
  });
}
function sendPhone(message) { try { bridge()?.postMessage(message); } catch { /* 다리가 사라진 화면 */ } }

async function readBuildInfo() {
  try {
    const res = await fetch(new URL('./build-info.json', import.meta.url).href, {cache: 'no-store', credentials: 'omit'});
    return res.ok ? buildInfo(await res.json()) : null;
  } catch { return null; }
}

// PC 파일 올리기 도우미(윈도우 PC 브라우저만): 문이 이미 허락된 경우에만 조용히 두드린다(허락 창을 새로 띄우지 않음, pc-files.js auto).
let helper = null;
function pcHelper() {
  if (helper) return helper;
  helper = createPcFiles(window, {enabled: true, token: async () => {
    const r = window.KPTURuntime;
    if (!r || !(await r.session.ensure())) return '';
    return r.session.read()?.access_token || '';
  }});
  return helper;
}

function row(list, label, value, key) {
  const item = el('div', 'apinfo-row'); item.dataset.apinfo = key;
  item.append(el('dt', 'apinfo-k', label), el('dd', 'apinfo-v', value));
  list.append(item);
  return item;
}
function result(box, key, text, action = null) {
  let line = box.querySelector(`[data-apinfo-result="${key}"]`);
  if (!line) { line = el('li', 'apinfo-result'); line.dataset.apinfoResult = key; box.append(line); }
  line.replaceChildren(el('span', 'apinfo-say', text));
  if (action) line.append(action);
  return line;
}
function smallButton(text, data, onClick) {
  const b = el('button', 'secondary mini', text); b.type = 'button'; b.dataset[data] = '';
  b.addEventListener('click', onClick);
  return b;
}
function smallLink(text, href, data) {
  const a = el('a', 'secondary mini', text); a.href = href; a.rel = 'noopener'; a.dataset[data] = '';
  return a;
}

/** 계정 메뉴 '앱 정보' 줄 오른쪽 작은 글자(폰 앱·옛 윈도우 앱이면 그 판). */
export function menuVersion(ua = navigator.userAgent || '') {
  const shell = shellOf(ua);
  return shell.kind === 'web' ? '' : shell.version;
}

export function openAppInfo(trigger) {
  const ua = navigator.userAgent || '';
  const shell = shellOf(ua);
  const pcOk = shell.kind === 'web' && isWindowsPc(ua);
  let list, results, check, webValue, pcRow;
  openFormModal({id: 'appInfoModal', title: '앱 정보', okLabel: '닫기', cancel: false, trigger, className: 'apinfo-modal',
    fill(body) {
      list = el('dl', 'apinfo-list');
      webValue = row(list, '화면', webLine(appVersionNow.current, null), 'web').querySelector('dd');
      if (shell.kind === 'android') row(list, '폰 앱', `${shell.version || '알 수 없음'} · ${shell.channel === 'play' ? '플레이판' : '직접 설치판'}`, 'phone');
      if (shell.kind === 'windows') row(list, 'PC 앱', `${shell.version || '알 수 없음'} · 보관판`, 'windows');
      if (pcOk) { pcRow = row(list, `${PC_HELPER_NAME} 도우미`, '', 'pc'); pcRow.hidden = true; }
      check = smallButton('업데이트 확인', 'apinfoCheck', () => void runCheck());
      const bar = el('div', 'apinfo-bar'); bar.append(check);
      results = el('ul', 'apinfo-results'); results.setAttribute('aria-live', 'polite');
      body.append(list, bar, results);
      return '[data-apinfo-check]';
    },
    onSubmit: async () => true});
  void readBuildInfo().then(info => { if (webValue?.isConnected) webValue.textContent = webLine(appVersionNow.current, info); });
  if (pcOk) void pcHelper().hello({auto: true}).then(state => {
    if (!pcRow?.isConnected || !state?.ok || !state.version) return;
    pcRow.querySelector('dd').textContent = state.version; pcRow.hidden = false;
  }).catch(() => {});

  async function checkWeb() {
    const current = appVersionNow.current;
    if (!current) { result(results, 'web', '화면: 시험판이라 확인하지 않아요'); return; }
    const deployed = await appVersionNow.check();
    if (!results.isConnected) return;
    if (!deployed) { result(results, 'web', '화면: 확인하지 못했어요. 잠시 뒤 다시 해 주세요'); return; }
    if (deployed === current) { result(results, 'web', '화면: 최신이에요'); return; }
    result(results, 'web', '화면: 새 화면이 있어요', smallButton('지금 바꾸기', 'apinfoReload', e => void appVersionNow.reload(e.currentTarget)));
  }
  async function checkPhone() {
    if (shell.kind !== 'android') return;
    const answer = await askPhone('update:check');
    if (!results.isConnected) return;
    if (answer) {
      const get = answer.state === 'new' ? smallButton('받기', 'apinfoGet', () => sendPhone('update:get')) : null;
      result(results, 'phone', `폰 앱: ${phoneText(answer, shell.version)}`, get);
      return;
    }
    // 이 판보다 옛 앱(다리 답 없음): 배포 때 정한 최신 폰 앱 판(phone-app.json)과 비교해 안내만.
    if (shell.channel === 'play') { result(results, 'phone', '폰 앱: 플레이 스토어에서 업데이트를 확인해 주세요', smallLink('플레이 스토어', `https://play.google.com/store/apps/details?id=${PLAY_ID}`, 'apinfoStore')); return; }
    const apk = apkFromInfo(await loadPhoneAppInfo());
    if (!results.isConnected) return;
    if (!apk) result(results, 'phone', '폰 앱: 확인하지 못했어요. 잠시 뒤 다시 해 주세요');
    else if (isNewer(apk.version, shell.version)) result(results, 'phone', `폰 앱: 새 앱 ${apk.version}이 있어요`, smallLink('받기', apk.url, 'apinfoApk'));
    else result(results, 'phone', `폰 앱: 최신이에요 (${shell.version})`);
  }
  async function checkPc() {
    if (shell.kind === 'windows') result(results, 'windows', 'PC 앱: 보관판이라 새 판이 없어요. 브라우저에서 쓰면 늘 최신이에요');
    if (!pcOk) return;
    const state = await pcHelper().hello({auto: true}).catch(() => null);
    if (!state?.ok || !state.version) return;
    const setup = setupFromInfo(await loadPcAppInfo());
    if (!results.isConnected || !setup) return;
    if (isNewer(setup.version, state.version)) result(results, 'pc', `도우미: 새 판 ${setup.version}이 있어요. 도우미가 스스로 받아요(트레이 [새 버전으로 다시 시작])`, smallLink('내려받기', setup.url, 'apinfoPc'));
    else result(results, 'pc', `도우미: 최신이에요 (${state.version})`);
  }
  async function runCheck() {
    if (check.disabled) return;
    check.disabled = true; check.textContent = '확인 중…';
    try { await Promise.all([checkWeb(), checkPhone(), checkPc()]); }
    finally { if (check.isConnected) { check.disabled = false; check.textContent = '업데이트 확인'; } }
  }
}
