// PRIVACY-백업안내(S66-01, 시안 docs/design/mockups/backup-export.html, PR 2677 명진 확정 11/15·11/16): '내 기록 백업'의 화면 주인 하나.
// ① 내 프로필 '내 기록 백업' 칸(mountRecordBackup): 종류별 체크 → [지금 백업], '매주 자동으로' 스위치(기본 꺼짐).
// ② 백업이 끝나면 한 줄 알림: 칸이 열려 있으면 칸 안에, 자동 백업이면 화면 맨 위 알림 줄(notice-bar.js)에.
// ③ 가입 직후(계정이 만들어진 지 14일 안) 한 번만 띄우는 안내(startRecordBackup): 맨 위 알림 줄 [자동 백업 켜기] [나중에]. 누르면 다시 띄우지 않는다.
// 저장: 스위치·안내 본 것은 서버 화면 기억 record_backup({auto, intro}, view-prefs.js — 기기 저장 없음). 고른 종류는 이 화면 메모리에만(다음엔 다시 전부).
// 백업 파일은 서버 함수 record-backup이 본인 구글 드라이브 'WORK ON+ 백업/날짜' 폴더에만 만든다(서버에 사본 없음). 이 파일이 그 함수를 부르는 유일한 곳이다.
// S68-02: 새 사용자가 처음 만드는 맨 위 폴더는 'WORK ON+ 백업'(이미 있는 폴더는 이름 그대로, 서버 _shared/brand-folders.mjs).
//   화면은 서버가 알려 준 실제 폴더 이름(status folder_name·run root_name)을 쓰고, 모를 때만 기본 이름 'WORK ON+ 백업'.
// S69-42: 서버가 백업할 때 옛 이름('노조+ 백업')을 새 이름으로 바꾸므로 기본 이름도 누구나 새 이름(명진 화면 포함).
// 자동 백업: 서버 예약은 기록을 읽을 로그인이 없어(기록은 본인 토큰으로만 읽음) 앱을 연 뒤 2분에 마지막 백업이 7일 넘었으면 한 번 한다(원장 사본과 같은 방식).
import {viewPrefs} from './view-prefs.js';
import {putNotice, removeNotice} from './notice-bar.js';
import {formatSeoulTime} from './meeting-time.js';
import {waitHtml, failHtml} from './wait-state.js';
import {groupHtml, switchRow, actionRow, navRow, linkRow, noteHtml} from './settings-list.mjs';

const ENDPOINT = '/functions/v1/record-backup';
const AUTO_EVERY_DAYS = 7, START_DELAY_MS = 120000, INTRO_KEY = 'record-backup-intro', DONE_KEY = 'record-backup-done';
const SAFE_URL = /^https:\/\/drive\.google\.com\/drive\/folders\/[A-Za-z0-9_-]{10,200}$/;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
// 맨 위 폴더 이름: 서버가 알려 준 실제 이름(짧은 글자만), 없으면 기본 이름.
export const DEFAULT_FOLDER = 'WORK ON+ 백업';
export const folderName = name => typeof name === 'string' && name.trim() && name.length <= 100 ? name.trim() : DEFAULT_FOLDER;
const ERRORS = {
  DRIVE_NOT_CONNECTED: '구글 드라이브가 아직 연결되지 않았어요. 자료실에서 드라이브를 연결해 주세요.',
  DRIVE_AUTH_EXPIRED: '구글 드라이브 연결이 끝났어요. 자료실에서 다시 연결해 주세요.',
  DRIVE_PUBLIC_SHARING_FOUND: "'WORK ON+ 백업' 폴더가 공유돼 있어 백업하지 않았어요. 드라이브에서 공유를 끈 뒤 다시 해 주세요.",
  RECORD_READ_LIMIT: '기록이 너무 많아 한 번에 받지 못했어요. 종류를 나눠 백업해 주세요.',
};
export const errorText = (code, folder) => code === 'DRIVE_PUBLIC_SHARING_FOUND' && folderName(folder) !== DEFAULT_FOLDER
  ? `'${folderName(folder)}' 폴더가 공유돼 있어 백업하지 않았어요. 드라이브에서 공유를 끈 뒤 다시 해 주세요.`
  : ERRORS[code] || '백업하지 못했어요. 잠시 뒤 다시 해 주세요.';
export const backupPrefs = v => ({auto: v?.auto === true, intro: v?.intro === true});
export function autoDue(auto, lastAt, now) {
  if (auto !== true) return false;
  const at = Date.parse(lastAt || '');
  return !Number.isFinite(at) || now - at >= AUTO_EVERY_DAYS * 86400000;
}
// '가입 직후'만: 로그인 계정이 만들어진 지 JOINED_DAYS 안. 오래 쓴 사람에게는 맨 위 줄을 띄우지 않는다(칸은 내 프로필에 늘 있음).
export const JOINED_DAYS = 14;
export function justJoined(createdAt, now) {
  const at = Date.parse(createdAt || '');
  return Number.isFinite(at) && now - at >= 0 && now - at < JOINED_DAYS * 86400000;
}
export const doneText = r => `내 드라이브 › ${folderName(r.root_name)} › ${r.date} 에 ${Number(r.count).toLocaleString('ko-KR')}건을 받았어요.`;
const when = at => formatSeoulTime(at, {month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'});

// 상태 읽기는 GET(화면을 열 때 쓰기 요청을 보내지 않음), 백업만 POST.
const call = (rt, action, body) => action === 'run'
  ? rt.api(`${ENDPOINT}?action=run`, {method: 'POST', body, singleFlight: false, refreshSession: false, timeoutMs: 150000})
  : rt.api(`${ENDPOINT}?action=${action}`, {singleFlight: false, refreshSession: false, timeoutMs: 60000});
const prefs = () => backupPrefs(viewPrefs.get('record_backup'));
const savePrefs = next => viewPrefs.set('record_backup', next, {rejectable: true});

let running = null; // 한 탭에서 백업은 한 번에 하나(칸·자동·안내가 함께 씀)
function runBackup(rt, kinds) {
  if (running) return running;
  running = call(rt, 'run', {kinds}).finally(() => { running = null; });
  return running;
}

function doneLine(r) {
  const el = document.createElement('aside');
  el.className = 'kptu-notice-line'; el.dataset.notice = DONE_KEY; el.setAttribute('aria-label', '백업 끝');
  el.innerHTML = `<span role="status">${esc(doneText(r))}</span><a class="kptu-notice-line-action" href="${esc(r.folder_url)}" target="_blank" rel="noopener">드라이브에서 보기</a><button type="button" class="kptu-notice-line-close icon-btn" aria-label="닫기">✕</button>`;
  el.querySelector('button').onclick = () => removeNotice(DONE_KEY);
  putNotice(DONE_KEY, {priority: 70, element: el});
}

/** ① 내 프로필 '내 기록 백업' 장. host 안을 이 함수만 그린다(공용 설정 줄).
 *  매주 자동 백업 스위치(서버 화면 기억) / '백업할 것' 종류마다 개수 + 스위치(고른 것은 이 화면 메모리 — 저장 칸은 DB 검사가 auto·intro만 받아 없음) /
 *  지금 백업(마지막 시각) / 백업 폴더 열기 ↗ / 이미 있는 것 한 줄. 첫 화면 요약은 마지막 백업 날짜(onSummary). */
export function mountRecordBackup(host, {rt = window.KPTURuntime, onSummary} = {}) {
  let status = null, failed = false, busy = false, picked = null, result = null, error = '';
  // 첫 화면 요약은 '마지막 11/26'처럼 짧게(서울 날짜).
  const day = at => { const p = new Intl.DateTimeFormat('ko-KR', {timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric'}).formatToParts(new Date(at)); return `${p.find(x => x.type === 'month')?.value}/${p.find(x => x.type === 'day')?.value}`; };
  function summary() {
    if (!status) return;
    onSummary?.({text: !status.connected ? '드라이브 연결 전' : status.last_at ? `마지막 ${day(status.last_at)}` : '아직 없음'});
  }
  function render() {
    const p = prefs();
    if (!status) { host.innerHTML = failed ? failHtml({retry: 'data-rb-retry'}) : waitHtml({rows: 4}); return; }
    summary();
    const kinds = status.kinds.filter(k => k.key !== 'personal' || k.count > 0);
    picked ??= new Set(kinds.map(k => k.key));
    const weeks = status.keep_weeks || 4;
    const auto = groupHtml([switchRow({label: '매주 자동 백업', desc: `앱을 열 때 · 최근 ${weeks}주만 남겨요`, checked: p.auto, attrs: {'data-rb-auto': true}, ariaLabel: '매주 자동 백업'})]);
    const list = groupHtml(kinds.map(k => switchRow({label: k.label, desc: k.note ? k.note : Number(k.count).toLocaleString('ko-KR'), checked: picked.has(k.key), disabled: busy, attrs: {'data-rb-kind': k.key}})), {title: '백업할 것'});
    const last = status.last_at ? `마지막 ${when(status.last_at)}` : '아직 없음';
    const folderUrl = result?.root_url || status.folder_url;
    const run = status.connected
      ? actionRow({label: busy ? '백업 중…' : '지금 백업', desc: last, descAttrs: {class: 'rb-last'}, disabled: busy || !picked.size, busy, attrs: {'data-rb-run': true}})
      : navRow({label: '드라이브 연결', desc: '구글 드라이브를 먼저 연결해 주세요', attrs: {'data-rb-connect': true}});
    const open = status.connected && SAFE_URL.test(folderUrl || '') ? linkRow({label: '백업 폴더 열기', desc: `내 드라이브 › ${folderName(status.folder_name)}`, href: folderUrl, attrs: {'data-rb-folder': true}}) : '';
    const done = result ? `<p class="sl-status rb-done" role="status">${esc(doneText(result))}</p>` : '';
    host.innerHTML = `${auto}${list}${done}${error ? `<p class="sl-status sl-error rb-error" role="alert">${esc(error)}</p>` : ''}${groupHtml([run, open])}${noteHtml('일정·할 일은 구글에, 자료실 파일은 내 드라이브에 이미 있어요')}`;
  }
  host.addEventListener('change', e => {
    const kind = e.target.closest?.('[data-rb-kind]');
    if (kind) { kind.checked ? picked.add(kind.dataset.rbKind) : picked.delete(kind.dataset.rbKind); render(); return; }
    if (e.target.matches?.('[data-rb-auto]')) { savePrefs({...prefs(), auto: e.target.checked, intro: true}); removeNotice(INTRO_KEY); }
  });
  host.addEventListener('click', async e => {
    if (e.target.closest?.('[data-rb-retry]')) { void load(); return; }
    if (e.target.closest?.('[data-rb-connect]')) { window.KPTURouter?.go?.('library', {source: 'delegated'}); return; }
    if (!e.target.closest?.('[data-rb-run]') || busy) return;
    busy = true; error = ''; result = null; render();
    try {
      result = await runBackup(rt, [...picked]);
      status = {...status, last_at: new Date().toISOString(), last_count: result.count, folder_name: result.root_name || status.folder_name};
    } catch (err) { error = errorText(err?.message, status?.folder_name); } // 서버 오류 코드가 runtime 오류 message로 온다(runtime-client.js responseMessage)
    busy = false; render();
  });
  window.addEventListener('kptu:view-prefs-rejected', () => render());
  async function load() {
    render();
    try { status = await call(rt, 'status'); failed = false; } catch { failed = true; }
    render();
  }
  return {load};
}

/** ③ 첫 안내 + 매주 자동 백업. 로그인된 화면이 뜬 뒤 loader-v2.js가 한 번 부른다. */
export function startRecordBackup({rt = window.KPTURuntime, now = () => Date.now(), delay = START_DELAY_MS} = {}) {
  let introShown = false;
  function intro() {
    if (introShown || prefs().intro || viewPrefs.status?.() !== 'ok' || !justJoined(rt?.session?.read?.()?.user?.created_at, now())) return;
    introShown = true;
    const el = document.createElement('aside');
    el.className = 'kptu-notice-line'; el.dataset.notice = INTRO_KEY; el.setAttribute('aria-label', '내 기록 백업 안내');
    el.innerHTML = `<span role="status">내 기록은 나만 볼 수 있어요. 잃어버리지 않게 백업을 켜 두세요.</span><button type="button" class="kptu-notice-line-action ghost" data-rb-on>자동 백업 켜기</button><button type="button" class="kptu-notice-line-action ghost" data-rb-later>나중에</button>`;
    el.querySelector('[data-rb-on]').onclick = () => { savePrefs({auto: true, intro: true}); removeNotice(INTRO_KEY); };
    el.querySelector('[data-rb-later]').onclick = () => { savePrefs({...prefs(), intro: true}); removeNotice(INTRO_KEY); };
    putNotice(INTRO_KEY, {priority: 60, element: el});
  }
  async function auto() {
    if (!prefs().auto || running) return;
    try {
      const s = await call(rt, 'status');
      if (!s?.connected || !autoDue(prefs().auto, s.last_at, now())) return;
      const kinds = s.kinds.filter(k => k.key !== 'personal' || k.count > 0).map(k => k.key);
      doneLine(await runBackup(rt, kinds));
    } catch { /* 조용히: 다음에 앱을 열 때 다시 */ }
  }
  if (viewPrefs.status?.() === 'ok') intro(); else window.addEventListener('kptu:view-prefs-ready', intro, {once: true});
  setTimeout(() => { void auto(); }, delay);
}
