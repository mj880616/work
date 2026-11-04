import {waitHtml, barHtml, failHtml, emptyHtml} from './wait-state.js';
import {claimedSince} from './row-swipe.js';
import {requestLibraryDocument} from './basket-library-send.js';
import {slotBox, slotImg, slotFailed} from './img-slot.js';
import {SOURCES, SOURCE_NAME, SHELVES, SHELF_NAME, PHONE_TABS, PHONE_TAB_NAME, SYNC_EVERY_MS, SHELF_LIMIT, FIND_LIMIT, FIND_WAIT_MS,
  TEXT_PREVIEW_BYTES, PDF_FIRST_PAGES, SORTS, SORT_NAME, kindOf, kindLabel, kindIcon, previewKind, sizeText, folderCountText, isLockedItem, dayText, fullTime,
  recentGroups, syncText, sortRows, validSort, rowKey, applyChanges, touchesCounts, trailNames, trailIds, pathText, folderKey, treeRows,
  placeOf, whereOf, tabAt, cleanQuery, findSummary, errorText, failReason, moveCheck, pickRange, groupBySource, touchedFolders, moveTargetOk,
  trashAsk, writeDoneText, writeErrorText, twinRows, TWIN_LIMIT, xferPlan, xferBig, sameNameRows, sameNameAsk, bigAsk, destTitle, destButton, destName,
  pushRecentDest, recentDestOf, xferLine, xferPercent, xferDoneText, XFER_BIG_HOW,
  jobsActive, jobStatusText, jobLine, jobPercent, jobStrip, jobsTitle, jobAction, mergeJobs, newlyDone, deviceJobOnReopen,
  UPLOAD_BIG_HOW, UPLOAD_REOPEN_TEXT, upDropText, upStartText, uploadPlan, upBig, upSameName, sameUpFile, upPiece, deviceHint, upResultId,
  starWant, starLabel, applyStars} from './files-model.mjs';
import {mountSplitResize} from './split-resize.js';
import {mountColResize, gripHtml} from './col-resize.js';
import {askConfirm, askText, notify} from './small-notice.js';
import {viewPrefs} from './view-prefs.js';
import {brandIconSvg} from './brand-icons.js';
import {odLinkButtonHtml, paintOdLink} from './od-link.js';
import {FILES_SOURCES_KEY, FILES_SRC, filesSourcesValue, toggleFilesSource, visibleSources, chipInfo, filesDeviceKind, PHONE_WIDTH_QUERY} from './files-sources-model.mjs';
import {SOURCES_OFF_TEXT} from './source-flags.mjs';
import {checkFileBase, splitFileName, FILE_BASE_MAX} from './file-rename-name.mjs';
import {createPhoneFiles} from './phone-files.js';
import {PHONE_SOURCE as PH, phoneTrail, mergeRecent, PHONE_READONLY_TEXT, PHONE_ASK_TEXT, PHONE_CANNOT_TEXT} from './phone-files-model.mjs';
import {FILES_TWO_KEY, twoLayout, twoOn, twoValue, paneSide, sendLabel, paneDest, otherStart, DROP_ASK_TEXT} from './files-panes-model.mjs';
// FILES-클라우드탐색기 ④ 화면(설계 docs/design/files-explorer.md 4·5·6절, 명진 결정 F1~F9 11/02): 메뉴 '파일'(?view=files). #filesView의 유일한 그리기 주인.
// - 목록은 서버 색인(app_cloud_list·app_cloud_find·app_cloud_trail, owner + 운영자 기능 files일 때만 읽힘)에서 바로 그린다. 클라우드는 부르지 않는다.
// - 갱신(F2): 들어올 때 + 2분마다 + 창으로 돌아올 때 Edge cloud-files sync(서버가 2분 안이면 클라우드를 부르지 않음). 응답의 바뀐 줄만
//   지금 목록에 입힌다(applyChanges). 많이 바뀌면(reload) 지금 목록을 서버에서 다시 읽는다. 밤 한 번은 서버 예약(⑧).
// - 미리보기(오른쪽 칸 / 폰·폴드는 겹친 칸, 뒤로가기 한 번 = 닫힘): 사진 = 큰 썸네일, PDF = 원본, 오피스 = 서버가 PDF로 바꾼 것(F4),
//   PDF는 저장소에 고정한 pdf.js로 쪽마다 그린다. 글 = 앞 200KB. 그 밖은 이름·크기·위치만 + [열기](클라우드 보기 새 창).
// - 폰 첫 화면은 최근 파일(F9). 탭 [최근·폴더·별표], 좌우로 밀어 탭 이동. 폰은 보기·찾기·열기·공유.
// - 쓰기(S48-45 ⑤·⑦): 이름 바꾸기·새 폴더·옮기기(같은 클라우드는 200개까지, 원드라이브↔구글은 1개·200MB까지, F8)·휴지통(F1: 그 클라우드
//   휴지통, 확인 창 한 번). 모두 사람이 누른 것만 Edge cloud-files로 보내고(confirm:true), 서버가 로그인·주인·색인을 다시 본다.
//   고르기: PC는 Ctrl·⌘(하나씩)·Shift(이어서) 누르고 고르기, 폰은 꾹 누르기. 고르면 위에 한 줄 막대(옮기기·이름·휴지통·✕).
//   옮기기: [옮기기] → 옮길 폴더를 열고 [여기로 옮기기](잘라 붙이기와 같음). PC는 줄을 폴더(목록·나무)로 끌어 놓아도 된다.
//   PC 단축키: F2 이름 · Delete 휴지통 · Ctrl+A 모두 고르기 · Ctrl+X 옮기기 · Ctrl+V 여기로 옮기기 · Esc 고르기 풀기.
//   결과는 서버가 돌려준 바뀐 줄로 지금 목록을 고친다(sync와 같은 applyChanges, 다시 그리기 주인은 이 파일 하나).
// FILES-출처켜고끄기·두드라이브나무(S49-21, 요청함 11/04 07:34): 위 줄 오른쪽 출처 아이콘 [원드라이브][구글 드라이브](사진 화면과 같은 부품: od-link.js·brand-icons.js·source-chips.css)로
//   켜기/끄기(서버 view_prefs.files_sources의 이 기기 칸 — 폰 앱·폰 브라우저·PC 따로, files-sources-model.mjs). 켜진(연결된 것 중) 출처만 [최근]·[폴더]·[별표]·찾기·나무에 보인다. 모두 끄면 '위 출처 아이콘을 켜 주세요' 한 줄.
//   끄기는 보기에서만 빠진다(연결·색인·밤 예약은 그대로). 연결 안 된 출처는 누르면 연결 안내 한 줄.
//   나무: 켜진 드라이브가 맨 위 줄(▸)로 나란히, 아래로 폴더를 펼치고 접는다. 폰(≤760)도 [폴더] 탭에서 같은 나무(한 화면에 두 드라이브, 여러 단계 펼치기),
//   폴더 이름을 누르면 그 폴더 안 목록(pane 'list'), 목록 맨 위 ‹ 로 나무(pane 'tree')로 돌아온다. 펼친 폴더는 그 폴더를 바로 읽어(Edge folder) 채우고 한 번 읽은 폴더는 다시 부르지 않는다(directDone).
//   펼침 상태는 이 탭 메모리만(서버에 저장하지 않음). 켜기/끄기만 서버에 기억해 다른 기기에서도 같다.
// FILES-통합 2-① 복사(S49-27, 명진 결정 H-3·H-4·H-5, 시안 files-unified-mockup.html ③④⑤): 고르기 막대 'N개 · [복사][옮기기][이름][휴지통] ✕' →
//   받을 곳 창(하단바 위, 최근 보낸 곳 칩 3개는 서버 view_prefs.files_dest_recent, 켜진 저장소 나무, [새 폴더][여기에 복사/옮기기]) → 같은 이름은 한 번 묻기
//   ([그래도 하기] = 서버가 '이름 (2)'로 번호 붙여 둘 다 둠 / [건너뛰기], '남은 것도 모두 같게') → 200MB 넘는 클라우드 사이 파일은 묻고 이 판에서는 다음 판 안내로 건너뜀
//   → 하단바 위 얇은 전송 줄 '2/5 보내는 중'(차례로 하나씩). 폴더째 복사는 같은 저장소 안에서만(다른 저장소로는 막고 안내). PC Ctrl+C·Ctrl+X → Ctrl+V.
// FILES-통합 2-② 전송 목록(S49-28, 명진 결정 H-4·H-6, 시안 ⑤⑧): 복사와 다른 저장소로 옮기기는 서버 작업표(Edge job_add → app_cloud_jobs)에 한 건 = 한 줄로 넣고
//   서버가 화면을 닫아도 차례로 잇는다(200MB 넘는 것은 [그래도 보내기]를 누른 것만 10MB 조각씩). 같은 저장소 안 옮기기는 지금처럼 move 한 번.
//   하단바 위 전송 줄을 누르면 전송 목록(폰: 하단바 위 칸, PC: 오른쪽 아래 작은 칸) — 줄마다 진행 막대·[멈춤]/[이어 하기]/[다시], '모두 멈춤'.
//   목록은 서버(job_list)에서 읽어 그린다. 보내는 것이 있는 동안만 2초마다 다시 읽고(화면이 보일 때만), 다시 열면 서버 목록으로 이어 보인다. 기기 저장 없음.
// FILES-통합 2-③ 두 칸(S49-30, 명진 결정 H-2, 시안 ⑥⑧): 폴드 펼침(761~1199)·PC(1200~)에서 위 줄 [두 칸]. 폴드 펼침은 기본 두 칸, PC는 기본 한 칸(나무·목록·미리보기),
//   폰(≤760)은 늘 한 칸. 켬은 서버 view_prefs.files_two(기기 종류별 · 폭 종류별, files-panes-model.mjs). 상태는 '칸 2개'(state.panes) — 한 칸 화면은 같은 코드로 칸 0 하나만 그린다.
//   칸마다 따로: 저장소·위치 줄·목록·정렬·고르기·찾기. 지금 칸(state.cur)은 칸 위 줄 밑선(fx-cur). 칸을 누르거나 Tab으로 바꾼다.
//   고르기 막대는 '→ 오른쪽에 복사 / → 옮기기'(받을 곳 = 반대 칸의 지금 폴더, 받을 곳 창 없이). 같은 이름·200MB 묻기·전송 목록은 2-①·2-② 그대로(xferRun).
//   칸 사이 끌어 놓기: 놓으면 '복사 · 옮기기' 작은 고르기. PC 키(두 칸일 때): F5 반대 칸에 복사 · F6 옮기기 · Tab 칸 바꾸기(입력 칸 안에서는 안 함). F2·Del은 그대로.
//   폴드 두 칸은 나무 대신 칸 위 줄 ▾(그 칸 위로 나무가 내려옴). 미리보기는 두 칸이면 덮는 칸(뒤로가기 한 번 = 닫힘).
// FILES-통합 3단계 '이 폰'(S49-51, 명진 결정 H-1·H-7, 폰 앱 0.5.0+): 위 줄 출처 아이콘에 [이 폰](폰 앱에서만). 앱 다리(phone-files.js)로 폰 저장 공간을 읽는다 —
//   나무 맨 위 줄에 '이 폰'(폴더 펼치기·목록), [최근]은 클라우드 줄과 폰 줄을 바뀐 날 순으로 섞고 줄마다 작은 출처 점(H-7). 미리보기·받기·공유는 폰 안에서 읽는다.
//   폰 파일 → 클라우드 [복사]는 올리기 길(upload_open, 2-④)을 그대로 쓴다(바이트는 폰 앱 안에서 읽어 클라우드 자리로 바로 보냄, 서버 Edge를 거치지 않음).
//   이 판에서 폰 쪽 쓰기(이름·새 폴더·휴지통·옮기기·클라우드 → 폰 받기)는 하지 않는다(다음 판). [별표]·[큰 파일]·찾기는 클라우드만(폰 별표는 두지 않음, 설계 D-6).
//   폰 파일 목록은 이 화면 메모리에만 있고 서버·기기에 저장하지 않는다. [이 폰] 켜기/끄기는 이번 접속만 기억한다(서버 기억은 DB 한 칸이 더 필요해 다음 PR).
// 저장은 서버만: 목록은 이 탭 메모리(열린 동안만), 받은 그림·PDF는 blob: 주소(메모리)로만 두고 화면을 떠나면 놓는다. 기기 저장 없음.
// 파일 이름은 모두 글자로만 그린다(esc). 로그에 파일 이름·id를 남기지 않는다.

(() => {
if (window.KPTUFiles) return;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const FN = '/functions/v1/cloud-files';
const PHONE = window.matchMedia(PHONE_WIDTH_QUERY);
// 출처 켜기/끄기를 기억하는 기기 칸(폰 앱·폰 브라우저·PC, 명진 결정 H-8). 화면을 연 때 한 번 정한다.
const DEVICE = filesDeviceKind({ua: navigator.userAgent || '', narrow: PHONE.matches});
const WIDE = window.matchMedia('(min-width:1200px)');
const GDRIVE_SVG = brandIconSvg('gdrive', {size: 16, cls: 'fx-src-ic'});
const PDF_LIB = new URL('./pdf-lib/pdfjs-dist-6.3.289/', import.meta.url);
// '이 폰' 다리(폰 앱에서만 usable). phoneOff = 이번 접속에서 [이 폰]을 끔(메모리만).
const phone = createPhoneFiles(window);
let phoneOff = false;
const PHONE_SVG = '<svg class="fx-src-ic" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="1.5" width="8" height="13" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="12.2" r=".8" fill="currentColor"/></svg>';

// 목록 칸 하나(칸 0 = 한 칸 화면의 그 칸 / 두 칸이면 왼쪽, 칸 1 = 두 칸일 때만 있는 오른쪽). 칸 위 줄(fx-ptop)은 두 칸일 때만 보인다.
const paneHtml = i => `<div class="fx-listcol" data-fx-pane-i="${i}"><div class="fx-ptop" data-fx-ptop hidden></div><nav class="fx-ptree nx-tree" data-fx-ptree aria-label="${i ? '오른쪽' : '왼쪽'} 칸 폴더" hidden></nav>`
  + `<div class="fx-wait" data-fx-wait hidden></div><section class="fx-list" data-fx-list aria-label="${i ? '오른쪽 칸 파일 목록' : '파일 목록'}"></section></div>`;
function install() {
  if (document.getElementById('filesView')) return;
  document.getElementById('appView')?.insertAdjacentHTML('beforeend', `<section id="filesView" class="view-panel hidden" aria-labelledby="fxTitle">
<h2 id="fxTitle" class="screen-title">파일</h2>
<div id="filesRoot" class="fx" data-fx-pane="list">
<div class="fx-top"><nav class="fx-crumb" data-fx-crumb aria-label="위치"></nav><input type="search" class="fx-search" data-fx-search placeholder="이름·자료실 글자 찾기" aria-label="파일 찾기" maxlength="200" autocomplete="off" enterkeyhint="search"><select class="fx-sort" data-fx-sort aria-label="정렬">${SORTS.map(k => `<option value="${k}">${SORT_NAME[k]}</option>`).join('')}</select><button type="button" class="fx-btn fx-mkdir" data-fx-mkdir hidden>새 폴더</button><button type="button" class="fx-btn fx-upload" data-fx-upload hidden>올리기</button><input type="file" multiple hidden data-fx-file aria-hidden="true" tabindex="-1"><input type="file" hidden data-fx-refile aria-hidden="true" tabindex="-1"><button type="button" class="fx-sync" data-fx-sync title="지금 맞추기"></button><span class="fx-srcs src-chips" data-fx-srcs role="group" aria-label="파일 출처" hidden>${odLinkButtonHtml('data-fx-src="od" data-src-chip aria-pressed="true"')}<button type="button" class="mini fx-src-btn" data-fx-src="gd" data-src-chip aria-pressed="true" aria-label="구글 드라이브" title="구글 드라이브" hidden>${GDRIVE_SVG}</button><button type="button" class="mini fx-src-btn" data-fx-src="ph" data-src-chip aria-pressed="false" aria-label="이 폰" title="이 폰" hidden>${PHONE_SVG}</button></span><button type="button" class="mini fx-two" data-fx-two aria-pressed="false" title="두 칸으로 보기" hidden>두 칸</button></div>
<div class="fx-bar" data-fx-bar role="toolbar" aria-label="고른 것" hidden></div>
<div class="fx-tabs" data-fx-tabs role="tablist" aria-label="파일 보기">${PHONE_TABS.map(t => `<button type="button" role="tab" data-fx-tab="${t}" aria-selected="false">${PHONE_TAB_NAME[t]}</button>`).join('')}</div>
<p class="fx-note" data-fx-note role="status" hidden></p>
<div class="fx-cols" data-fx-cols><nav class="fx-tree nx-tree" data-fx-tree aria-label="폴더"></nav><div class="fx-main" data-fx-main>${paneHtml(0)}<aside class="fx-prev" data-fx-prev aria-label="미리보기" hidden></aside></div></div>
<div class="fx-dim" data-fx-dim hidden></div><section class="fx-dest" data-fx-dest role="dialog" aria-modal="true" aria-labelledby="fxDestTitle" hidden></section>
<div class="fx-askbox" data-fx-askbox hidden></div><div class="fx-drop-ask" data-fx-dropask role="dialog" aria-label="놓을 때 고르기" hidden></div><section class="fx-jobs" data-fx-jobs role="dialog" aria-labelledby="fxJobsTitle" hidden></section><div class="fx-xfer" data-fx-xfer role="status" aria-live="polite" hidden></div>
</div></section>`);
}
install();

const root = document.getElementById('filesRoot');
const $ = sel => root?.querySelector(sel);
const rt = () => window.KPTURuntime;
const scopeOf = () => { const c = rt()?.context?.read?.(); return `${c?.user?.id || ''}:${c?.workspace?.id || ''}`; };
// 칸 하나의 상태(S49-30 두 칸): 위치·목록·정렬·찾기·고르기. pane = 폰 [폴더] 탭의 나무/목록, drop = 폴드 두 칸의 ▾ 나무가 내려와 있는가. seq·fseq·ftimer = 늦게 온 응답 거르기.
const freshPane = () => ({where: null, rows: [], loaded: false, failed: '', failedWhy: '', trail: [], sort: 'name', dir: 'asc',
  query: '', found: null, findFailed: '', findWhy: '', sel: '', picked: new Set(), anchor: '', pane: 'list', drop: false, seq: 0, fseq: 0, ftimer: 0});
const fresh = () => ({scope: '', status: null, statusFailed: '', statusWhy: '', panes: [freshPane(), freshPane()], cur: 0,
  children: new Map(), open: new Set(), tab: 'recent', syncedAt: null, syncing: false,
  preview: null, clip: null, busy: '', hint: '', xfer: null, run: null, ask: null, dropAsk: null,
  jobs: [], jobsOpen: false, jobsBusy: false, jobsWere: false});
const jobsSeen = new Set();
let state = fresh(), syncTimer = 0, layer = null, entering = null, jobTimer = 0, jobsLayer = null;
// 지금 칸 · 두 칸인가(폰은 늘 한 칸) · 그려지는 칸들 · 반대 칸 · 칸 번호.
const P = () => state.panes[state.cur];
const twoPref = () => twoOn(viewPrefs.getFilesTwo?.(DEVICE), twoLayout(WIDE.matches));
const two = () => !PHONE.matches && twoPref();
const panesOn = () => (two() ? state.panes : [state.panes[0]]);
const idxOf = p => state.panes.indexOf(p);
const otherOf = p => state.panes[idxOf(p) ^ 1];
const paneEl = p => root?.querySelector(`[data-fx-pane-i="${idxOf(p)}"]`);
const inPane = (p, sel) => paneEl(p)?.querySelector(sel) || null;
const JOB_POLL_MS = 2000;

// ---------- 서버 ----------
const rpc = (name, body) => rt().api(`/rest/v1/rpc/${name}`, {method: 'POST', body, singleFlight: false});
const edge = (action, body = {}) => rt().api(FN, {method: 'POST', body: {action, ...body}, singleFlight: false, timeoutMs: 30000});
const codeOf = e => String(e?.message || (e?.status ? 'http_' + e.status : '') || '');
// 그림·PDF·글 바이트(썸네일·원본·미리보기 PDF). 응답이 JSON이면 서버 오류 코드.
async function bytes(body, {range = ''} = {}) {
  const r = rt();
  if (!(await r.session.ensure())) throw Object.assign(new Error('session_required'), {status: 401});
  const token = r.session.read()?.access_token;
  if (!token) throw Object.assign(new Error('session_required'), {status: 401});
  const headers = {apikey: r.config.key, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'};
  if (range) headers.Range = range;
  const res = await fetch(r.config.url + FN, {method: 'POST', cache: 'no-store', headers, body: JSON.stringify(body)});
  const type = (res.headers.get('content-type') || '').split(';')[0].trim();
  if (!res.ok || /json/.test(type)) {
    let code = ''; try { code = (await res.json())?.error || ''; } catch { /* 본문 없음 */ }
    throw Object.assign(new Error(code || `http_${res.status}`), {status: res.status});
  }
  return res.blob();
}

// ---------- 상태·목록 읽기 ----------
function resetIfOwnerChanged() {
  const scope = scopeOf();
  if (state.scope === scope) return;
  dropPreview();
  if (state.ask) state.ask.resolve({choice: 'skip', all: true, closed: true});
  state = fresh(); state.scope = scope; jobsSeen.clear(); clearTimeout(jobTimer);
}
const connected = () => SOURCES.filter(s => state.status?.[s]?.connected);
// 켜진 출처(연결된 것 중 아이콘으로 켠 것). 보기 전부(최근·폴더·별표·찾기·나무)가 이 목록만 본다.
const srcState = () => viewPrefs.getFilesSources?.(DEVICE);
// '이 폰': 폰 앱 다리가 '모든 파일 접근'으로 켜져 있고(phone.state.all) 이번 접속에서 끄지 않았을 때. 클라우드 뒤 맨 끝 줄.
const phoneLinked = () => phone.usable && phone.state.all;
const phoneOn = () => phoneLinked() && !phoneOff;
const onSources = () => [...visibleSources(srcState(), connected()), ...(phoneOn() ? [PH] : [])];
const cloudOn = () => onSources().filter(s => s !== PH);
const anyLinked = () => connected().length > 0 || phoneLinked();
const nothingOn = () => !!state.status && anyLinked() && !onSources().length;
async function loadStatus() {
  const scope = state.scope;
  try {
    const d = await edge('status');
    if (state.scope !== scope) return;
    state.status = d && typeof d === 'object' ? d : {}; state.statusFailed = '';
    const times = SOURCES.map(s => Date.parse(d?.[s]?.synced_at || '')).filter(Number.isFinite);
    if (times.length) state.syncedAt = Math.min(...times);
  } catch (e) {
    if (state.scope !== scope) return;
    state.statusFailed = codeOf(e); state.statusWhy = failReason(e);
  }
}
function setWhere(p, where, {keepPreview = false} = {}) {
  const fromShelf = !!p.where?.shelf || !p.where;
  p.where = where; p.rows = []; p.loaded = false; p.failed = ''; p.trail = []; p.drop = false;
  // 묶음은 저마다 기본 정렬(최근 = 바뀐 날, 큰 파일 = 크기, 그 밖 = 이름). 폴더 안에서 고른 정렬은 폴더를 옮겨도 그대로.
  if (where?.shelf) [p.sort, p.dir] = where.shelf === 'recent' ? ['modified', 'desc'] : where.shelf === 'big' ? ['size', 'desc'] : ['name', 'asc'];
  else if (fromShelf) [p.sort, p.dir] = ['name', 'asc'];
  if (!keepPreview) { p.sel = ''; closePreview(); }
  p.picked.clear(); p.anchor = ''; p.pane = 'list'; state.hint = '';
  if (p === state.panes[0]) {
    if (where?.shelf && PHONE_TABS.includes(where.shelf)) state.tab = where.shelf;
    else if (where?.source) state.tab = 'folders';
    window.KPTURouter?.setPlace?.('files', placeOf(where));
  }
  paint();
  return loadList(p);
}
async function loadList(p, {quiet = false} = {}) {
  const where = p.where, scope = state.scope, seq = ++p.seq;
  if (!where) return;
  try {
    let rows, trail = [];
    // 묶음(최근·큰 파일·별표)은 켜진 출처를 서버로 넘겨 서버가 거른다(S49-26, 화면이 200줄을 받아 덮어 거르지 않음).
    if (where.shelf) {
      const on = cloudOn();
      // [최근]에 폰 줄도 섞는다(H-7). 폰을 못 읽어도 클라우드 줄은 보인다(폰 실패는 한 줄 안내).
      const ph = where.shelf === 'recent' && phoneOn() ? phone.recent().catch(e => { state.hint = errorText(codeOf(e)); return []; }) : Promise.resolve(null);
      const [cloud, mine] = await Promise.all([on.length ? rpc('app_cloud_find_in', {p_sources: on, p_query: null, p_shelf: where.shelf, p_limit: SHELF_LIMIT}) : [], ph]);
      rows = mine ? mergeRecent(Array.isArray(cloud) ? cloud : [], mine, SHELF_LIMIT * 2) : cloud;
    } else if (where.source === PH) {
      rows = await phone.list(where.parent);
      trail = phoneTrail(where.parent);
    } else {
      [rows, trail] = await Promise.all([
        rpc('app_cloud_list', {p_source: where.source, p_parent_id: where.parent}),
        where.parent ? rpc('app_cloud_trail', {p_source: where.source, p_item_id: where.parent}) : Promise.resolve([])]);
    }
    if (seq !== p.seq || state.scope !== scope) return;
    p.rows = Array.isArray(rows) ? rows : []; p.trail = Array.isArray(trail) ? trail : []; p.loaded = true; p.failed = ''; p.failedWhy = '';
    recordCounts(p, scope);
    if (where.source) {
      state.children.set(folderKey(where.source, where.parent), p.rows.filter(r => r.is_folder));
      // 위치 줄의 폴더(맨 위부터 지금 폴더까지)는 나무에서 펼쳐 둔다(나무가 칠하는 지금 칸만).
      if (p === P()) for (const id of [null, ...trailIds(p.trail)]) state.open.add(folderKey(where.source, id));
    }
  } catch (e) {
    if (seq !== p.seq || state.scope !== scope) return;
    if (!quiet || !p.loaded) { p.failed = codeOf(e); p.failedWhy = failReason(e); p.loaded = false; }
  }
  paint();
  if (where.source && !where.shelf) directRead(p, where, scope);
}
// 폴더를 열면 그 폴더만 클라우드에서 바로 읽어 색인에 합친다(폴더마다 이 화면이 열려 있는 동안 한 번). 색인이 덜 찼어도 빈 화면이 되지 않게.
const directDone = new Set();
// 폴더 줄 개수: 그 폴더를 클라우드에서 실제로 읽은 뒤(directRead 성공) 보이는 줄로 센 값만 쓴다. 안 읽은 폴더는 비워 둔다(색인 장수는 모름을 0으로 보임).
const readOk = new Set(), counts = new Map();
const countKey = (scope, source, id) => scope + '|' + folderKey(source, id);
function recordCounts(p, scope) {
  const where = p.where;
  if (!where?.source || where.shelf || !readOk.has(countKey(scope, where.source, where.parent))) return;
  const rows = p.rows.filter(r => !isLockedItem(r));
  counts.set(countKey(scope, where.source, where.parent), {folders: rows.filter(r => r.is_folder).length, files: rows.filter(r => !r.is_folder).length});
}
const countOf = (source, id) => folderCountText(counts.get(countKey(state.scope, source, id)));
async function directRead(p, where, scope) {
  const key = scope + '|' + folderKey(where.source, where.parent);
  if (directDone.has(key) || !connected().includes(where.source)) return;
  directDone.add(key);
  try {
    const d = await edge('folder', {source: where.source, ...(where.parent ? {id: where.parent} : {})});
    readOk.add(key);
    if (state.scope !== scope) return;
    // 두 칸이 같은 폴더를 보고 있으면 둘 다 고친다.
    for (const q of panesOn()) {
      if (q.where?.source !== where.source || (q.where.parent || null) !== (where.parent || null) || q.where.shelf) continue;
      if (d?.added > 0 || d?.reload) await loadList(q, {quiet: true});
      else { recordCounts(q, scope); paintPane(q); }
    }
    paintTree();
  } catch { /* 이번엔 색인 그대로. 다음 갱신이 이어 맞춘다 */ }
}
async function loadChildren(source, parent) {
  const key = folderKey(source, parent), scope = state.scope;
  try {
    const rows = source === PH ? await phone.list(parent) : await rpc('app_cloud_list', {p_source: source, p_parent_id: parent});
    if (state.scope !== scope) return;
    state.children.set(key, (Array.isArray(rows) ? rows : []).filter(r => r.is_folder));
  } catch { if (state.scope === scope) state.children.set(key, []); }
  paintTree();
}

// 나무에서 폴더를 펼칠 때: 색인에서 하위 폴더를 읽고(아직 모르면), 그 폴더를 클라우드에서 바로 한 번 읽어 채운다(directRead와 같은 길·같은 directDone — 읽은 폴더는 다시 부르지 않음).
async function fillFolder(source, parent) {
  const key = folderKey(source, parent), scope = state.scope, dk = scope + '|' + key;
  if (!state.children.has(key)) await loadChildren(source, parent);
  if (state.scope !== scope || directDone.has(dk) || !connected().includes(source)) return;
  directDone.add(dk);
  try {
    const d = await edge('folder', {source, ...(parent ? {id: parent} : {})});
    readOk.add(dk);
    if (state.scope !== scope) return;
    if (d?.added > 0 || d?.reload) await loadChildren(source, parent); else { recordCountsFor(source, parent, scope); paintTree(); }
  } catch { /* 이번엔 색인 그대로. 다음 갱신이 이어 맞춘다 */ }
}
function recordCountsFor(source, parent, scope) {
  for (const p of panesOn()) { const w = p.where; if (w?.source === source && (w.parent || null) === (parent || null)) recordCounts(p, scope); }
}

// ---------- 찾기(F7: 이름 + 자료실이 이미 읽은 글자) — 칸마다 따로(위 줄 찾기 칸은 지금 칸의 찾기) ----------
function setQuery(p, raw) {
  const q = cleanQuery(raw);
  clearTimeout(p.ftimer);
  if (q === p.query) return;
  p.query = q;
  if (!q) { p.found = null; p.findFailed = ''; p.fseq++; paint(); return; }
  p.ftimer = setTimeout(() => find(p, q), FIND_WAIT_MS);
}
async function find(p, q) {
  const seq = ++p.fseq, scope = state.scope;
  try {
    const on = cloudOn();
    const rows = on.length ? await rpc('app_cloud_find_in', {p_sources: on, p_query: q, p_shelf: null, p_limit: FIND_LIMIT}) : [];
    if (seq !== p.fseq || state.scope !== scope || p.query !== q) return;
    p.found = Array.isArray(rows) ? rows : []; p.findFailed = ''; p.findWhy = '';
  } catch (e) {
    if (seq !== p.fseq || state.scope !== scope) return;
    p.found = []; p.findFailed = codeOf(e); p.findWhy = failReason(e);
  }
  paint();
}
const refind = p => { const q = p.query; p.query = ''; setQuery(p, q); };

// ---------- 갱신(F2) ----------
async function sync({force = false} = {}) {
  if (state.syncing || !state.status || !connected().length) return;
  const scope = state.scope, seen = panesOn().map(p => [p, p.where]);
  state.syncing = true; paintTop();
  try {
    const d = await edge('sync', force ? {force: true} : {});
    if (state.scope !== scope) return;
    state.syncedAt = Date.now();
    if (SOURCES.some(s => d?.[s]?.more)) setTimeout(() => { if (state.scope === scope) sync(); }, 1500);
    const changed = Array.isArray(d?.changed) ? d.changed : [], removed = Array.isArray(d?.removed) ? d.removed : [];
    // 칸마다 같은 규칙으로 입힌다(한 칸 화면은 칸 0 하나).
    for (const [p, where] of seen) {
      if (p.where !== where || !p.loaded) continue;
      if (d?.reload || where?.shelf) { if (d?.reload || changed.length || removed.length) await loadList(p, {quiet: true}); continue; }
      if (!changed.length && !removed.length) continue;
      if (touchesCounts(p.rows, where, changed, removed)) { await loadList(p, {quiet: true}); continue; }
      const next = applyChanges(p.rows, where, changed, removed);
      if (next !== p.rows) { p.rows = next; state.children.set(folderKey(where.source, where.parent), next.filter(r => r.is_folder)); recordCounts(p, scope); paintList(p); paintTree(); }
    }
  } catch { /* 맞추기 실패는 다음 차례에 다시. 목록은 색인 그대로 */ }
  finally { if (state.scope === scope) { state.syncing = false; paintTop(); for (const p of panesOn()) if (!shown(p).length) paintList(p); } }
}
function startTimer() { clearInterval(syncTimer); syncTimer = setInterval(() => { if (visible()) sync(); else paintTop(); }, SYNC_EVERY_MS); }
const visible = () => window.KPTURouter?.current === 'files' && document.visibilityState === 'visible';

// ---------- 그리기(이 화면의 유일한 그리기 주인 — 칸 둘도 이 함수들이 칸마다 같은 코드로 그린다) ----------
// 찾기·묶음 줄은 서버가 켜진 출처만 준다(app_cloud_find_in). 폴더 목록은 한 출처 것이고, 그 출처가 꺼지면 sourcesChanged가 최근으로 옮긴다.
const foundShown = p => (p.found || []).filter(r => !isLockedItem(r));
const shown = p => p.query ? foundShown(p) : sortRows(p.rows.filter(r => !isLockedItem(r)), p.sort, p.dir);
// 폰 [폴더] 탭의 첫 화면은 나무(pane 'tree'), 폴더 이름을 누르면 목록(pane 'list'). 찾는 중이면 늘 목록. PC·폴드는 CSS가 둘 다 보인다.
const treePane = () => PHONE.matches && state.tab === 'folders' && state.panes[0].pane === 'tree' && !state.panes[0].query;
// 칸 1(오른쪽)의 자리는 두 칸일 때만 있다(한 칸이면 지움 — 숨김이 아니라 없음). 그리기 주인은 paint 하나.
function ensurePanes() {
  const on = two(), main = $('[data-fx-main]');
  root.dataset.fxTwo = on ? (WIDE.matches ? 'wide' : 'fold') : '';
  if (!on) delete root.dataset.fxTwo;
  let el = root.querySelector('[data-fx-pane-i="1"]');
  if (on && !el && main) { main.querySelector('[data-fx-pane-i="0"]')?.insertAdjacentHTML('afterend', paneHtml(1)); el = root.querySelector('[data-fx-pane-i="1"]'); }
  if (!on && el) el.remove();
  markCur();
}
function markCur() {
  const on = two();
  for (const el of root.querySelectorAll('[data-fx-pane-i]')) el.classList.toggle('fx-cur', on && Number(el.dataset.fxPaneI) === state.cur);
}
function paint() {
  ensurePanes();
  root.dataset.fxPane = treePane() ? 'tree' : 'list';
  paintTop(); paintBar(); paintTree();
  for (const p of panesOn()) paintPane(p);
  paintPreview(); paintAsk(); paintDropAsk(); paintXfer(); paintJobs();
}
function paintPane(p) { paintPaneTop(p); paintList(p); }
// 위치 줄(빵부스러기): 한 칸 화면은 위 줄, 두 칸이면 칸마다 칸 위 줄에 같은 글자.
function crumbHtml(p) {
  const w = p.where;
  if (p.query) return `<span class="fx-crumb-now">${esc(p.found ? findSummary(foundShown(p)) : `'${p.query}' 찾기`)}</span>`;
  if (p === state.panes[0] && treePane()) return '<span class="fx-crumb-now">폴더</span>';
  if (!w) return '<span class="fx-crumb-now">파일</span>';
  if (w.shelf) return `<span class="fx-crumb-now">${esc(SHELF_NAME[w.shelf])}</span>`;
  const names = trailNames(w.source, p.trail), ids = [null, ...trailIds(p.trail)];
  let html = names.map((n, i) => i === names.length - 1
    ? `<span class="fx-crumb-now" aria-current="location">${esc(n)}</span>`
    : `<button type="button" class="fx-crumb-step" data-fx-go="${esc(w.source)}" data-fx-id="${esc(ids[i] || '')}">${esc(n)}</button>`).join('<span class="fx-crumb-sep" aria-hidden="true">›</span>');
  // 폰 [폴더] 탭의 목록은 맨 위 폴더에서도 ‹ 가 나무로 돌아온다.
  if (names.length > 1 || (PHONE.matches && state.tab === 'folders')) html = `<button type="button" class="fx-up" data-fx-up aria-label="${names.length > 1 ? '위 폴더' : '폴더 나무'}">‹</button>` + html;
  return html;
}
const sortHtml = p => `<select class="fx-sort" data-fx-sort aria-label="${p ? paneSide(idxOf(p)) + ' 칸 ' : ''}정렬">${SORTS.map(k => `<option value="${k}"${p?.sort === k ? ' selected' : ''}>${SORT_NAME[k]}</option>`).join('')}</select>`;
// 칸 위 줄(두 칸일 때만): 폴드는 ▾(그 칸 위로 나무) + 위치 줄 + 정렬, PC는 위치 줄 + 정렬(나무는 왼쪽 그대로).
function paintPaneTop(p) {
  const top = inPane(p, '[data-fx-ptop]'), pt = inPane(p, '[data-fx-ptree]');
  if (!top) return;
  if (!two()) { top.hidden = true; top.innerHTML = ''; if (pt) { pt.hidden = true; pt.innerHTML = ''; } return; }
  top.hidden = false;
  const fold = !WIDE.matches, i = idxOf(p);
  top.innerHTML = (fold ? `<button type="button" class="mini fx-pdrop" data-fx-pdrop aria-expanded="${p.drop}" aria-label="${paneSide(i)} 칸 폴더 나무">▾</button>` : '')
    + `<nav class="fx-crumb" aria-label="${paneSide(i)} 칸 위치">${crumbHtml(p)}</nav>${sortHtml(p)}`;
  paintPaneTree(p);
}
function paintPaneTree(p) {
  const pt = inPane(p, '[data-fx-ptree]');
  if (!pt) return;
  const on = two() && !WIDE.matches && p.drop;
  pt.hidden = !on; pt.innerHTML = on ? treeHtml(p) : '';
}
function paintTop() {
  const crumb = $('[data-fx-crumb]');
  // 두 칸이면 위치 줄·정렬은 칸 위 줄에 있다(위 줄에는 찾기·새 폴더·맞추기·출처·[두 칸]).
  const twoNow = two(), p = P();
  if (crumb) { crumb.hidden = twoNow; crumb.innerHTML = twoNow ? '' : crumbHtml(p); }
  const sort = $('.fx-top [data-fx-sort]');
  if (sort) { sort.hidden = twoNow; if (sort.value !== p.sort) sort.value = p.sort; }
  const search = $('[data-fx-search]');
  if (search && document.activeElement !== search && search.value !== p.query) search.value = p.query;
  const s = $('[data-fx-sync]');
  if (s) {
    const scanning = SOURCES.some(x => state.status?.[x]?.scanning);
    // UI-로딩자리전수: 맞추는 동안의 두 번째 글자('맞추는 중')는 없다. 목록 칸 맨 위 가는 줄(공용 부품) 하나로만 알린다.
    s.textContent = syncText(state.syncedAt) || '맞추기';
    s.disabled = state.syncing;
    s.setAttribute('aria-busy', String(state.syncing || scanning));
    for (const q of panesOn()) {
      const bar = inPane(q, '[data-fx-wait]');
      if (bar) { const on = (state.syncing || scanning) && q.loaded && !q.failed; if (on && bar.hidden) bar.innerHTML = barHtml(); bar.hidden = !on; if (!on) bar.replaceChildren(); }
    }
    s.hidden = !state.status || !connected().length;
  }
  const mk = $('[data-fx-mkdir]'), folderHere = !!p.where?.source && !p.query && !treePane() && cloudOn().includes(p.where.source);
  if (mk) { mk.hidden = !folderHere; mk.disabled = !!state.busy; }
  // 올리기(2-④): 폴더를 연 칸에서만(받을 곳 = 지금 칸의 폴더). PC는 끌어 놓기도 된다.
  const upb = $('[data-fx-upload]');
  if (upb) { upb.hidden = !folderHere; upb.disabled = !!state.busy || !!state.ask; }
  const tw = $('[data-fx-two]');
  if (tw) { tw.hidden = PHONE.matches; tw.setAttribute('aria-pressed', String(twoNow)); tw.classList.toggle('on', twoNow); }
  paintSrcs();
  for (const b of root?.querySelectorAll('[data-fx-tab]') || []) b.setAttribute('aria-selected', String(b.dataset.fxTab === state.tab));
  const note = $('[data-fx-note]');
  if (note) {
    const t = state.statusFailed ? errorText(state.statusFailed) : state.status && !anyLinked() ? '연결된 클라우드가 없습니다' : state.hint;
    note.textContent = t; note.hidden = !t;
  }
}
// 출처 아이콘(사진 화면과 같은 부품). 원드라이브는 연결 전에도 보이고(눌러 연결 안내), 구글 드라이브는 연결돼 있을 때만 보인다([파일]이 구글 드라이브를 보여 주는 조건 그대로).
function paintSrcs() {
  const box = $('[data-fx-srcs]');
  if (!box) return;
  box.hidden = !state.status;
  const link = connected();
  for (const name of FILES_SRC) {
    const b = box.querySelector(`[data-fx-src="${name}"]`);
    if (!b) continue;
    const info = chipInfo(srcState(), link, name);
    if (name === 'od') paintOdLink(b, {configured: !!state.status, connected: info.linked}); else b.hidden = !info.linked;
    b.setAttribute('aria-pressed', String(info.pressed));
    const t = `${SOURCE_NAME[name]} ${info.linked ? (info.on ? '켜짐' : '꺼짐') : '연결 안 됨'}`;
    b.title = t; b.setAttribute('aria-label', t);
  }
  // [이 폰]: 폰 앱(0.5.0+)에서만 보인다. 허락 전에는 흐리게(누르면 설정 안내), 허락 뒤에는 켜기/끄기.
  const pb = box.querySelector('[data-fx-src="ph"]');
  if (pb) {
    pb.hidden = !(phone.usable && phone.state.known);
    pb.setAttribute('aria-pressed', String(phoneOn()));
    pb.classList.toggle('fx-src-off', !phoneLinked());
    const t = `${SOURCE_NAME[PH]} ${phoneLinked() ? (phoneOn() ? '켜짐' : '꺼짐') : '허락 안 됨'}`;
    pb.title = t; pb.setAttribute('aria-label', t);
  }
}
function srcClick(name) {
  if (name === PH) { phoneClick(); return; }
  if (!FILES_SRC.includes(name)) return;
  const info = chipInfo(srcState(), connected(), name);
  if (!info.linked) {
    state.hint = name === 'od' ? '원드라이브가 연결돼 있지 않아요. 사진 화면 위 원드라이브 아이콘에서 연결할 수 있어요.' : '구글 드라이브가 연결돼 있지 않아요.';
    paintTop();
    return;
  }
  viewPrefs.setFilesSources(DEVICE, filesSourcesValue(toggleFilesSource(srcState(), name)));
  sourcesChanged();
}
// [이 폰] 누름: 허락 전이면 설정 화면(앱이 돌아오면 상태를 다시 보낸다), 허락 뒤면 이번 접속에서 켜기/끄기.
function phoneClick() {
  if (!phone.usable) return;
  if (!phone.state.can) { state.hint = PHONE_CANNOT_TEXT; paintTop(); return; }
  if (!phone.state.all) { state.hint = PHONE_ASK_TEXT; paintTop(); phone.ask(); return; }
  phoneOff = !phoneOff;
  sourcesChanged();
}
// 앱이 상태를 알려 오면(설정에서 돌아옴·열쇠 바뀜): 켜졌으면 나무 맨 위를 읽고 [최근]을 다시 읽는다.
phone.on(() => { if (state.status) { state.hint = ''; phoneChanged(); } });
function phoneChanged() {
  state.children.delete(folderKey(PH, null));
  sourcesChanged();
}
// 켜기/끄기가 바뀐 뒤: 보던 출처가 꺼졌으면 최근으로, 새로 켠 출처의 나무 맨 위를 읽고, 다시 그린다. 끄기는 보기에서만 빠진다(색인·연결은 그대로).
function sourcesChanged() {
  state.hint = '';
  const on = onSources();
  if (panesOn().some(p => p.query) || !on.length) closePreview();
  if (!on.length) { for (const p of state.panes) p.picked.clear(); state.clip = null; paint(); return; }
  let painted = false;
  for (const p of panesOn()) {
    const w = p.where;
    if (!w || (w.source && !on.includes(w.source))) { setWhere(p, {shelf: 'recent'}); painted = true; }
    else if (w.shelf) loadList(p);
    // 찾는 중이면 켜진 출처로 다시 찾는다(서버가 거름).
    if (p.query) find(p, p.query);
  }
  if (!painted) paint();
  for (const s of on) if (!state.children.has(folderKey(s, null))) loadChildren(s, null);
}
// 나무 줄(왼쪽 나무 · 폴드 두 칸의 칸 위 ▾ 나무가 같은 줄): p = 지금 위치를 칠할 칸.
function treeHtml(p) {
  const rows = treeRows({sources: onSources(), children: state.children, open: state.open});
  const w = p.where, curKey = !p.query && w ? (w.shelf ? 'shelf:' + w.shelf : folderKey(w.source, w.parent)) : '';
  return rows.map(r => {
    const cur = r.key === curKey ? ' nx-current' : '';
    if (r.type === 'shelf') return `<div class="nx-row fx-shelf${cur}"><button type="button" class="nx-main" data-fx-shelf="${r.shelf}"${cur ? ' aria-current="true"' : ''}><span class="nx-name">${esc(SHELF_NAME[r.shelf])}</span></button></div>`;
    const twist = r.hasKids ? `<button type="button" class="fx-twist" data-fx-twist="${esc(r.key)}" aria-expanded="${r.open}" aria-label="${r.open ? '접기' : '펼치기'}">${r.open ? '▾' : '▸'}</button>` : '<span class="fx-twist" aria-hidden="true"></span>';
    const name = r.type === 'root' ? SOURCE_NAME[r.source] : r.name;
    const cnt = r.type === 'folder' ? countOf(r.source, r.id) : '', num = cnt ? `<span class="nx-num${/^0개$/.test(cnt) ? ' fx-zero' : ''}">${esc(cnt)}</span>` : '';
    return `<div class="nx-row nx-folder${r.type === 'root' ? ' fx-root' : ''}${cur}" style="--nx-indent:${r.depth}" data-fx-drop="${esc(folderKey(r.source, r.id))}">${twist}<button type="button" class="nx-main" data-fx-go="${esc(r.source)}" data-fx-id="${esc(r.id || '')}"${cur ? ' aria-current="true"' : ''}><span class="nx-name">${esc(name)}</span>${num}</button></div>`;
  }).join('');
}
function paintTree() {
  paintMainTree();
  for (const p of panesOn()) paintPaneTree(p);
  // 받을 곳 창의 나무도 같은 하위 폴더 목록(state.children)을 쓴다: 새로 읽으면 함께 다시 그린다.
  if (state.xfer) paintDest();
}
// 왼쪽 나무(한 칸·PC 두 칸). 지금 칸의 위치를 칠한다. 폴드 두 칸은 CSS가 숨기고 칸 위 ▾ 나무를 쓴다.
function paintMainTree() {
  const tree = $('[data-fx-tree]');
  if (!tree) return;
  // 폰 [폴더] 탭의 나무가 첫 화면인데 켜진 출처가 없으면 빈 칸 대신 안내 한 줄(PC·폴드는 목록 칸이 안내를 보인다).
  if (nothingOn() && treePane()) { tree.innerHTML = emptyHtml(SOURCES_OFF_TEXT); return; }
  tree.innerHTML = treeHtml(P());
}
function rowHtml(p, r, {withPath = false} = {}) {
  const key = rowKey(r), sel = p.sel === key || p.picked.has(key), kind = kindOf(r);
  const picked = p.picked.has(key) ? ' fx-picked' : '', cut = state.clip?.keys.includes(key) ? ' fx-cut' : '';
  const drag = PHONE.matches ? '' : ' draggable="true"', drop = r.is_folder ? ` data-fx-drop="${esc(folderKey(r.source, r.item_id))}"` : '';
  const tags = [r.library_doc_id ? '자료실' : '', r.match_in === 'text' ? '글자 맞음' : ''].filter(Boolean).join(' · ');
  const tag = tags ? `<span class="fx-tag">${tags}</span>` : '';
  const star = r.starred ? '<span class="fx-star" aria-label="별표">★</span>' : '';
  const where = withPath ? pathText(r.source, r.folder_path) : '';
  const size = r.is_folder ? countOf(r.source, r.item_id) : sizeText(r.size_bytes);
  const day = dayText(r.modified_at);
  return `<button type="button" class="fx-row${r.is_folder ? ' fx-folder' : ''}${picked}${cut}" data-fx-row="${esc(key)}" aria-selected="${sel}"${drag}${drop}>`
    + `<span class="fx-ico" data-kind="${kind}" aria-hidden="true">${esc(kindIcon(r))}</span>`
    + `<span class="fx-nm">${withPath ? `<span class="fx-dot" data-src="${esc(r.source)}" title="${esc(SOURCE_NAME[r.source] || '')}" aria-label="${esc(SOURCE_NAME[r.source] || '')}"></span>` : ''}<span class="fx-name">${esc(r.name)}</span>${star}${tag}</span>`
    + (withPath ? `<span class="fx-path">${esc(where)}</span>` : '')
    + `<span class="fx-day">${esc(day)}</span><span class="fx-size">${esc(size)}</span><span class="fx-kind">${esc(kindLabel(r))}</span>`
    + `<span class="fx-sub">${esc([withPath ? where : day, size].filter(Boolean).join(' · '))}</span></button>`;
}
// S49-4 FILES-칸폭: 폴더 나무 | 목록 경계(split_ratio.files)와 표 머리 칸(위치·바뀐 날·크기·종류, col_widths.files)을 끌어 조절 — 둘 다 서버에 기억.
// 나무 | 목록 경계는 나무가 보이는 동안만(폰·폴드 두 칸은 나무 칸이 없다).
const COL_VARS = {path: '--fx-w-path', day: '--fx-w-day', size: '--fx-w-size', kind: '--fx-w-kind'};
function mountWidths(list) {
  const cols = $('[data-fx-cols]');
  if (cols) {
    mountSplitResize({container: cols, name: 'files', label: '폴더와 목록 칸 폭 조절', columns: [
      {el: () => $('[data-fx-tree]'), varName: '--ds-split-files-tree', minVar: '--ds-split-files-tree-min', minFallback: 160, share: 22},
      {el: () => $('[data-fx-main]'), varName: '--ds-split-files-main', minVar: '--ds-split-files-main-min', minFallback: 440, share: 78},
    ], active: () => !PHONE.matches && !(two() && !WIDE.matches)});
  }
  mountColResize({host: list, name: 'files', vars: COL_VARS,
    fit: key => Math.ceil(Math.max(0, ...[...list.querySelectorAll(`.fx-row .fx-${key}`)].map(el => el.scrollWidth))) });
}
const scanningNow = () => state.syncing || SOURCES.some(x => state.status?.[x]?.scanning);
function paintList(p) {
  const list = inPane(p, '[data-fx-list]');
  if (!list) return;
  mountWidths(list);
  if (state.statusFailed && !state.status) { list.innerHTML = failHtml({retry: 'data-fx-retry', text: errorText(state.statusFailed), reason: state.statusWhy}); return; }
  if (nothingOn()) { list.innerHTML = emptyHtml(SOURCES_OFF_TEXT); delete list.dataset.fxMode; return; }
  if (p.query) {
    if (p.findFailed) { list.innerHTML = failHtml({retry: 'data-fx-retry', text: errorText(p.findFailed), reason: p.findWhy}); return; }
    if (!p.found) { list.innerHTML = waitHtml({rows: 4}); return; }
    const found = foundShown(p);
    list.innerHTML = found.length ? `<div class="fx-rows fx-with-path" role="list">${found.map(r => rowHtml(p, r, {withPath: true})).join('')}</div>` : emptyHtml('찾은 것 없음');
    list.dataset.fxMode = 'find';
    return;
  }
  const w = p.where;
  if (!w) { list.innerHTML = state.status && !anyLinked() ? emptyHtml('연결된 클라우드 없음') : waitHtml({rows: 4}); return; }
  if (p.failed) { list.innerHTML = failHtml({retry: 'data-fx-retry', text: errorText(p.failed), reason: p.failedWhy}); return; }
  if (!p.loaded) { list.innerHTML = waitHtml({rows: 4}); return; }
  const rows = shown(p);
  list.dataset.fxMode = w.shelf || 'folder';
  // 불러오는 동안(처음 목록 맞추는 중 포함)에는 '최근 없음'·'빈 폴더'를 보이지 않는다. 다 읽은 뒤에만.
  if (!rows.length && scanningNow()) { list.innerHTML = waitHtml({rows: 4}); return; }
  if (!rows.length) { list.innerHTML = emptyHtml(w.shelf ? `${SHELF_NAME[w.shelf]} 없음` : '빈 폴더'); return; }
  if (w.shelf === 'recent' && PHONE.matches && p.sort === 'modified' && p.dir === 'desc') {
    list.innerHTML = `<div class="fx-rows fx-with-path" role="list">${recentGroups(rows).map(g => `<div class="fx-day-head">${esc(g.label)}</div>${g.rows.map(r => rowHtml(p, r, {withPath: true})).join('')}`).join('')}</div>`;
    return;
  }
  list.innerHTML = `<div class="fx-head"><span>이름</span>${w.shelf ? `<span>위치${gripHtml('path', '위치')}</span>` : ''}<span>바뀐 날${gripHtml('day', '바뀐 날')}</span><span>크기${gripHtml('size', '크기')}</span><span>종류${gripHtml('kind', '종류')}</span></div>`
    + `<div class="fx-rows${w.shelf ? ' fx-with-path' : ''}" role="list">${rows.map(r => rowHtml(p, r, {withPath: !!w.shelf})).join('')}</div>`;
}
// ---------- 미리보기 ----------
const rowByKey = (key, p = P()) => (p.query ? p.found || [] : p.rows).find(r => rowKey(r) === key) || null;
// 미리보기가 덮는 칸인가: PC 한 칸만 오른쪽 칸, 폴드·두 칸은 덮는 칸(뒤로가기 한 번 = 닫힘).
const overlayPreview = () => !WIDE.matches || two();
function dropPreview() {
  const p = state.preview;
  if (p?.url) URL.revokeObjectURL(p.url);
  if (p?.task) { try { p.task.destroy(); } catch { /* 이미 닫힘 */ } }
  state.preview = null;
}
function closePreview() { dropPreview(); const l = layer; layer = null; l?.close(); paintPreview(); }
function selectRow(key, {show = true} = {}) {
  const r = rowByKey(key);
  if (!r) return;
  const p = P();
  p.sel = key;
  for (const b of paneEl(p)?.querySelectorAll('[data-fx-row]') || []) b.setAttribute('aria-selected', String(b.dataset.fxRow === key || p.picked.has(b.dataset.fxRow)));
  if (show && !r.is_folder) openPreview(r);
}
// 줄 바이트: 클라우드는 Edge(thumb·media·preview), 이 폰은 앱 다리(폰 안에서 읽음). range = 앞 몇 바이트만(글 미리보기).
async function rowBlob(r, what, {range = 0} = {}) {
  if (r.source === PH) {
    const blob = what === 'thumb' ? await phone.thumb(r.item_id, true) : await phone.blob(r.item_id);
    return range ? blob.slice(0, range) : blob;
  }
  if (what === 'thumb') return bytes({action: 'thumb', source: r.source, id: r.item_id, size: 'large'});
  if (what === 'preview') return bytes({action: 'preview', source: r.source, id: r.item_id});
  return bytes({action: 'media', source: r.source, id: r.item_id}, range ? {range: `bytes=0-${range - 1}`} : {});
}
async function openPreview(r) {
  if (state.preview?.key === rowKey(r)) { if (overlayPreview()) openLayer(); paintPreview(); return; }
  dropPreview();
  const kind = previewKind(r), p = {key: rowKey(r), row: r, kind, status: kind === 'none' ? 'done' : 'wait', url: '', text: '', pages: 0, shown: 0, err: ''};
  state.preview = p;
  if (overlayPreview()) openLayer();
  paintPreview();
  loadTwins(p);
  if (kind === 'none') return;
  try {
    if (kind === 'image') {
      const blob = await rowBlob(r, 'thumb');
      if (state.preview !== p) return;
      p.url = URL.createObjectURL(blob);
    } else if (kind === 'text') {
      const blob = await rowBlob(r, 'media', {range: TEXT_PREVIEW_BYTES});
      if (state.preview !== p) return;
      p.text = new TextDecoder('utf-8', {fatal: false}).decode(new Uint8Array(await blob.slice(0, TEXT_PREVIEW_BYTES).arrayBuffer()));
    } else {
      const blob = await rowBlob(r, kind === 'office' ? 'preview' : 'media');
      if (state.preview !== p) return;
      const lib = await pdfjs();
      p.task = lib.getDocument({data: new Uint8Array(await blob.arrayBuffer()), cMapUrl: new URL('cmaps/', PDF_LIB).href, cMapPacked: true, isEvalSupported: false, disableFontFace: false, useSystemFonts: true, verbosity: 0});
      p.doc = await p.task.promise;
      if (state.preview !== p) return;
      p.pages = p.doc.numPages;
    }
    p.status = 'done';
  } catch (e) {
    if (state.preview !== p) return;
    p.status = 'fail'; p.err = codeOf(e);
  }
  paintPreview();
}
let pdfFlight = null;
function pdfjs() {
  if (!pdfFlight) pdfFlight = import(new URL('pdf.min.mjs', PDF_LIB).href).then(lib => {
    lib.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', PDF_LIB).href;
    return lib;
  }).catch(err => { pdfFlight = null; throw err; });
  return pdfFlight;
}
// PDF 쪽 그리기. 한 번에 하나만 돈다(p.drawing). 그리는 칸(data-fx-pages)이 다시 만들어지면 처음 쪽부터 그 칸에 다시 그린다.
async function drawPages(p, upto) {
  if (!p.doc || p.drawing) { if (p.doc) p.want = Math.max(p.want || 0, upto); return; }
  p.drawing = true;
  try {
    for (;;) {
      const host = $('[data-fx-pages]');
      if (!host || state.preview !== p) return;
      if (host !== p.host) { p.host = host; p.shown = 0; host.replaceChildren(); }
      const goal = Math.min(Math.max(upto, p.want || 0), p.pages);
      if (p.shown >= goal) break;
      const n = p.shown + 1, page = await p.doc.getPage(n);
      if (state.preview !== p || p.host !== $('[data-fx-pages]')) continue;
      const width = Math.max(200, host.clientWidth || 300);
      const base = page.getViewport({scale: 1}), ratio = Math.min(2, window.devicePixelRatio || 1);
      const vp = page.getViewport({scale: (width / base.width) * ratio});
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
      canvas.style.width = '100%'; canvas.className = 'fx-page'; canvas.setAttribute('aria-label', `${n}쪽`);
      await page.render({canvasContext: canvas.getContext('2d'), viewport: vp}).promise;
      if (state.preview !== p || p.host !== host) continue;
      host.append(canvas);
      p.shown = n;
    }
  } catch { /* 그리기 실패는 그 쪽까지만 보인다 */ }
  finally { p.drawing = false; }
  const more = $('[data-fx-more-pages]');
  if (more && state.preview === p) { more.hidden = p.shown >= p.pages; more.textContent = `다음 쪽 (${p.shown}/${p.pages})`; }
}
function openLayer() {
  root.dataset.fxPreview = 'open';
  layer ||= window.KPTURouter?.layer?.open('files-preview', {reopen: () => { if (state.preview) { root.dataset.fxPreview = 'open'; paintPreview(); } }, close: () => { layer = null; dropPreview(); paintPreview(); return true; }}) || null;
}
const canShare = () => typeof navigator.share === 'function' && typeof navigator.canShare === 'function';
function paintPreview() {
  const box = $('[data-fx-prev]');
  if (!box) return;
  const p = state.preview;
  if (!p) { box.hidden = true; box.innerHTML = ''; delete root.dataset.fxPreview; return; }
  box.hidden = false;
  const r = p.row, at = state.panes.find(q => q.where?.source === r.source && !q.query && !q.where?.shelf && q.rows.some(x => rowKey(x) === p.key));
  const where = at ? trailNames(r.source, at.trail).join(' › ') : pathText(r.source, r.folder_path);
  let view = '';
  if (p.kind === 'image') view = '<div class="fx-pv-imgbox" data-fx-img></div>';
  else if (p.status === 'wait') view = barHtml(); // 미리보기 칸 맨 위 가는 줄(칸 한가운데 회색 막대가 아니라)
  else if (p.status === 'fail') view = `<p class="fx-pv-note">${esc(errorText(p.err))}</p>`;
  else if (p.kind === 'text') view = `<pre class="fx-pv-text">${esc(p.text)}</pre>`;
  else if (p.kind === 'pdf' || p.kind === 'office') view = `<div class="fx-pages" data-fx-pages></div><button type="button" class="fx-btn" data-fx-more-pages hidden></button>`;
  // 그리고 있는 PDF 칸은 그대로 둔다(다시 그리면 쪽을 처음부터 다시 그려야 함).
  if (p.doc && p.host && p.host.isConnected && box.contains(p.host) && box.dataset.fxKey === p.key) return;
  box.dataset.fxKey = p.key;
  const mine = r.source === PH;
  box.innerHTML = `<div class="fx-pv-head"><button type="button" class="fx-back" data-fx-close aria-label="미리보기 닫기">‹</button><span class="fx-pv-nm">${esc(r.name)}</span>`
    + (mine ? '' : `<button type="button" class="mini fx-star-btn${r.starred ? ' on' : ''}" data-fx-star-one aria-pressed="${!!r.starred}" aria-label="${r.starred ? '별표 빼기' : '별표'}" title="${r.starred ? '별표 빼기' : '별표'}">${r.starred ? '★' : '☆'}</button>`) + '</div>'
    + `<div class="fx-pv-view">${view}</div>`
    + `<dl class="fx-pv-meta"><dt>위치</dt><dd>${esc(where)}</dd><dt>크기</dt><dd>${esc(sizeText(r.size_bytes))}</dd><dt>바뀐 날</dt><dd>${esc(fullTime(r.modified_at))}</dd><dt>종류</dt><dd>${esc(kindLabel(r))}</dd></dl>`
    + '<div class="fx-pv-twins" data-fx-twins hidden></div>'
    + `<div class="fx-pv-acts">${mine ? '' : '<button type="button" class="fx-btn" data-fx-open>열기</button>'}<button type="button" class="fx-btn" data-fx-down>받기</button>`
    + (canShare() ? '<button type="button" class="fx-btn fx-share" data-fx-share>공유</button>' : '')
    + (r.library_doc_id ? `<button type="button" class="fx-btn" data-fx-library="${esc(r.library_doc_id)}">자료실에서 보기</button>` : '')
    // 폰 파일은 [복사](클라우드로)만 — 이름·옮기기·휴지통은 다음 판.
    + (mine ? '<button type="button" class="fx-btn" data-fx-copy-one>클라우드에 복사</button></div>'
      : `<button type="button" class="fx-btn" data-fx-rename-one>이름</button><button type="button" class="fx-btn" data-fx-copy-one>복사</button><button type="button" class="fx-btn" data-fx-cut-one>옮기기</button>`
      + `<button type="button" class="fx-btn fx-danger" data-fx-trash-one>휴지통</button></div>`);
  paintTwins();
  if (p.doc) { p.host = null; drawPages(p, Math.max(PDF_FIRST_PAGES, p.want || 0)); }
  // 사진: 공용 그림 칸(img-slot.js) — 받는 중 회색, 못 받으면 ↻(그 사진만 다시 받기).
  const imgBox = box.querySelector('[data-fx-img]');
  if (imgBox) {
    slotBox(imgBox);
    if (p.status === 'done' && p.url) { const img = document.createElement('img'); img.className = 'fx-pv-img'; img.alt = r.name; slotImg(imgBox, img, p.url); }
    else if (p.status === 'fail') slotFailed(imgBox, () => { if (state.preview === p) { dropPreview(); openPreview(r); } }, p.err);
  }
}
// ⑦ 같은 파일(같은 해시): 색인 표를 로그인 토큰으로 읽는다(owner + files일 때만 읽히는 RLS). 미리보기 아래 작은 줄, 누르면 그 폴더로.
async function loadTwins(p) {
  const r = p.row;
  if (!r?.hash || r.is_folder) return;
  try {
    const q = `/rest/v1/app_cloud_items?hash=eq.${encodeURIComponent(r.hash)}&source=eq.${encodeURIComponent(r.source)}&trashed=eq.false`
      + `&select=source,item_id,parent_id,name,hash,trashed&order=name.asc&limit=${TWIN_LIMIT + 1}`;
    const rows = await rt().api(q, {singleFlight: false});
    if (state.preview !== p) return;
    p.twins = twinRows(Array.isArray(rows) ? rows : [], r);
    paintTwins();
  } catch { /* 같은 파일 보기는 덧붙임: 못 읽으면 줄을 보이지 않는다 */ }
}
function paintTwins() {
  const box = $('[data-fx-twins]'), p = state.preview;
  if (!box) return;
  const list = p?.twins || [];
  box.hidden = !list.length;
  box.innerHTML = list.length ? `<span class="fx-pv-twins-t">같은 파일 ${list.length}</span>` + list.map(t =>
    `<button type="button" class="fx-twin" data-fx-go="${esc(t.source)}" data-fx-id="${esc(t.parent_id || '')}" title="그 폴더 열기">${esc(t.name)}</button>`).join('') : '';
}
function note(text) { const n = $('[data-fx-note]'); if (n) { n.textContent = text; n.hidden = !text; } }
// 열기: 클라우드 보기 화면 새 창. 창은 누른 순간 열어 두고(팝업 막힘 피함) 주소를 받으면 넣는다.
async function openCloud(r) {
  if (r.source === PH) return;
  const win = window.open('about:blank', '_blank');
  try {
    const d = await edge('open-url', {source: r.source, id: r.item_id});
    if (!d?.url) throw new Error('open_unavailable');
    if (win) { win.opener = null; win.location.href = d.url; } else window.open(d.url, '_blank', 'noopener');
  } catch (e) { win?.close(); note(errorText(codeOf(e))); }
}
async function download(r, {share = false} = {}) {
  try {
    const blob = await rowBlob(r, 'media');
    if (share) {
      const file = new File([blob], r.name, {type: blob.type || 'application/octet-stream'});
      if (navigator.canShare({files: [file]})) { await navigator.share({files: [file], title: r.name}); return; }
    }
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = r.name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (e) { if (e?.name !== 'AbortError') note(errorText(codeOf(e))); }
}

// ---------- 쓰기(S48-45 ⑤·⑦) ----------
const pickedRows = (p = P()) => [...p.picked].map(k => rowByKey(k, p)).filter(Boolean);
// 지금 손댈 줄: 고른 것이 있으면 그것, 없으면 미리보기·선택한 한 줄.
const actRows = () => { const p = P(), list = pickedRows(p); if (list.length) return list; const r = p.sel && rowByKey(p.sel, p); return r ? [r] : []; };
// 두 칸: 받을 곳 = 반대 칸의 지금 폴더(찾는 중·묶음이면 없음).
const oppDest = () => (two() ? paneDest(otherOf(P())) : null);
function paintBar() {
  const bar = $('[data-fx-bar]');
  if (!bar) return;
  const p = P(), n = p.picked.size, clip = state.clip;
  if (state.busy) {
    bar.hidden = false;
    bar.innerHTML = `<span class="fx-bar-t" role="status">${esc(state.busy)}</span>`;
    return;
  }
  if (clip) {
    const here = hereDest();
    const copy = clip.mode === 'copy';
    const ok = here && (copy ? xferPlan(clip.rows, here, 'copy').ok.length > 0 : moveTargetOk(clip.rows, here));
    bar.hidden = false;
    bar.innerHTML = `<span class="fx-bar-t">${clip.rows.length}개 ${copy ? '복사하는' : '옮기는'} 중 · ${ok ? '이 폴더로' : `${copy ? '복사할' : '옮길'} 폴더를 여세요`}</span>`
      + `<button type="button" class="fx-btn" data-fx-paste${ok ? '' : ' disabled'}>${copy ? '여기에 복사' : '여기로 옮기기'}</button><button type="button" class="fx-btn" data-fx-uncut>취소</button>`;
    return;
  }
  bar.hidden = !n;
  if (!n) { bar.innerHTML = ''; return; }
  // 폰 파일을 고르면 이 판은 '클라우드에 복사'만(받을 곳 창 / 두 칸이면 반대 칸이 클라우드 폴더일 때).
  if (hasPhone(pickedRows(p))) {
    const i = state.cur, dest = two() ? oppDest() : null, ok = dest && dest.source !== PH;
    bar.innerHTML = `<span class="fx-bar-t">${n}개 · ${esc(SOURCE_NAME[PH])}</span>`
      + (two() ? `<button type="button" class="fx-btn" data-fx-send="copy"${ok ? '' : ` disabled title="${esc(paneSide(i ^ 1))} 칸에서 받을 클라우드 폴더를 여세요"`}>${esc(sendLabel(i, 'copy'))}</button>`
        : '<button type="button" class="fx-btn" data-fx-copy>클라우드에 복사</button>')
      + '<button type="button" class="fx-btn" data-fx-unpick aria-label="고르기 풀기">✕</button>';
    return;
  }
  if (two()) {
    // 시안 ⑥⑧: 'N개 (왼쪽) · [→ 오른쪽에 복사] [→ 옮기기] [이름] [휴지통] ✕' — 받을 곳 창 없이 반대 칸으로. PC는 키 이름을 함께.
    const i = state.cur, dest = oppDest(), keys = WIDE.matches, off = dest ? '' : ` disabled title="${esc(paneSide(i ^ 1))} 칸에서 받을 폴더를 여세요"`;
    bar.innerHTML = `<span class="fx-bar-t">${n}개 (${paneSide(i)})</span>`
      + `<button type="button" class="fx-btn" data-fx-send="copy"${off}>${esc(sendLabel(i, 'copy'))}${keys ? ' (F5)' : ''}</button>`
      + `<button type="button" class="fx-btn" data-fx-send="move"${off}>${esc(sendLabel(i, 'move'))}${keys ? ' (F6)' : ''}</button>`
      + (n === 1 ? `<button type="button" class="fx-btn" data-fx-rename>이름${keys ? ' (F2)' : ''}</button>` : '')
      + `<button type="button" class="fx-btn" data-fx-star>${esc(starLabel(pickedRows(p)))}</button>`
      + `<button type="button" class="fx-btn fx-danger" data-fx-trash>휴지통${keys ? ' (Del)' : ''}</button><button type="button" class="fx-btn" data-fx-unpick aria-label="고르기 풀기">✕</button>`;
    return;
  }
  // 시안 ③: 'N개 · [복사] [옮기기] [이름] [휴지통] ✕'(쓰지 않는 ⋯는 두지 않는다).
  bar.innerHTML = `<span class="fx-bar-t">${n}개</span><button type="button" class="fx-btn" data-fx-copy>복사</button><button type="button" class="fx-btn" data-fx-cut>옮기기</button>`
    + (n === 1 ? '<button type="button" class="fx-btn" data-fx-rename>이름</button>' : '')
    + `<button type="button" class="fx-btn" data-fx-star>${esc(starLabel(pickedRows(p)))}</button>`
    + '<button type="button" class="fx-btn fx-danger" data-fx-trash>휴지통</button><button type="button" class="fx-btn" data-fx-unpick aria-label="고르기 풀기">✕</button>';
}
function paintPicks(p = P()) {
  for (const b of paneEl(p)?.querySelectorAll('[data-fx-row]') || []) {
    const on = p.picked.has(b.dataset.fxRow);
    b.classList.toggle('fx-picked', on);
    b.setAttribute('aria-selected', String(on || b.dataset.fxRow === p.sel));
  }
  paintBar();
}
function togglePick(key) {
  const p = P();
  if (p.picked.has(key)) p.picked.delete(key); else p.picked.add(key);
  p.anchor = key; paintPicks(p);
}
function rangePick(key) {
  const p = P(), keys = [...(paneEl(p)?.querySelectorAll('[data-fx-row]') || [])].map(b => b.dataset.fxRow);
  for (const k of pickRange(keys, p.anchor || p.sel, key)) p.picked.add(k);
  paintPicks(p);
}
function unpick(p = P()) { p.picked.clear(); p.anchor = ''; paintPicks(p); }
// 서버가 돌려준 바뀐 줄을 보이는 칸마다 입힌다(sync와 같은 길). 찾기·묶음 화면은 서버에서 다시 읽는다.
async function applyWrite(d, touched = []) {
  const changed = Array.isArray(d?.changed) ? d.changed : [], removed = Array.isArray(d?.removed) ? d.removed : [];
  const gone = new Set(removed.map(x => `${x.source}:${x.id}`));
  for (const p of state.panes) for (const k of gone) p.picked.delete(k);
  // 지운 줄은 고른 것에서도 빠진다 → 막대 숫자를 바로 고친다(write()의 마무리 그리기는 이보다 먼저 돈다).
  paintBar();
  if (state.preview && gone.has(state.preview.key)) closePreview();
  else if (state.preview) { const c = changed.find(x => rowKey(x) === state.preview.key); if (c) { state.preview.row = {...state.preview.row, ...c}; paintPreview(); } }
  for (const key of touched) if (state.children.has(key)) { const [source, ...rest] = key.split(':'); loadChildren(source, rest.join(':') || null); }
  const work = [];
  for (const p of panesOn()) {
    if (p.query) { refind(p); continue; }
    const w = p.where;
    if (!w) continue;
    if (w.shelf || touchesCounts(p.rows, w, changed, removed)) { work.push(loadList(p, {quiet: true})); continue; }
    const next = applyChanges(p.rows, w, changed, removed);
    if (next !== p.rows) { p.rows = next; paintList(p); }
  }
  await Promise.all(work);
}
async function write(action, body, label, {timeoutMs = 60000} = {}) {
  if (state.busy || state.run) return null;
  const scope = state.scope;
  state.busy = label; paintBar(); paintTop();
  try {
    return await rt().api(FN, {method: 'POST', body: {action, ...body, confirm: true}, singleFlight: false, timeoutMs});
  } catch (e) {
    if (state.scope === scope) notify(writeErrorText(codeOf(e)), {error: true, record: false});
    return null;
  } finally {
    if (state.scope === scope) { state.busy = ''; paintBar(); paintTop(); }
  }
}
// 폰 줄·폰 받을 곳이 낀 쓰기는 이 판에서 하지 않는다(폰 → 클라우드 복사만). 막을 때 한 줄 안내.
const hasPhone = rows => (rows || []).some(r => r?.source === PH);
function phoneStop(rows, dest) {
  if (!hasPhone(rows) && dest?.source !== PH) return false;
  notify(PHONE_READONLY_TEXT, {record: false});
  return true;
}
async function renameRow(r, anchor) {
  if (!r || phoneStop([r])) return;
  const parts = r.is_folder ? {base: r.name, ext: ''} : splitFileName(r.name);
  const v = await askText(anchor, {text: '새 이름', value: parts.base, ok: '바꾸기', max: FILE_BASE_MAX});
  if (v === null) return;
  const chk = checkFileBase(v);
  if (!chk.ok) { notify(chk.message, {error: true, record: false}); return; }
  const name = chk.base + parts.ext;
  if (name === r.name) return;
  const d = await write('rename', {source: r.source, id: r.item_id, name}, '이름 바꾸는 중');
  if (d) { await applyWrite(d, touchedFolders([r])); notify(writeDoneText('rename'), {record: false}); }
}
async function makeFolder(anchor) {
  const w = P().where;
  if (!w?.source || phoneStop([], w)) return;
  const v = await askText(anchor, {text: '새 폴더 이름', value: '', ok: '만들기', max: FILE_BASE_MAX});
  if (v === null) return;
  const chk = checkFileBase(v);
  if (!chk.ok) { notify(chk.message, {error: true, record: false}); return; }
  const d = await write('mkdir', {source: w.source, parent: w.parent, name: chk.base}, '폴더 만드는 중');
  if (d) { await applyWrite(d, [folderKey(w.source, w.parent)]); notify(writeDoneText('mkdir'), {record: false}); }
}
async function trashRows(rows, anchor) {
  const list = rows.filter(Boolean);
  if (!list.length || phoneStop(list)) return;
  const ask = trashAsk(list);
  if (!(await askConfirm(anchor, {text: ask.text, note: ask.note, ok: '휴지통으로', danger: true}))) return;
  let done = 0, failed = 0;
  for (const g of groupBySource(list)) {
    let ids = g.rows.map(r => r.item_id);
    while (ids.length) {
      const d = await write('trash', {source: g.source, ids}, `휴지통으로 보내는 중 (${done}/${list.length})`);
      if (!d) { failed += ids.length; break; }
      await applyWrite(d, touchedFolders(g.rows));
      failed += (d.failed || []).length;
      done += ids.length - (d.failed || []).length - (d.left || []).length;
      ids = Array.isArray(d.left) ? d.left : [];
    }
  }
  notify(writeDoneText('trash', {done, failed}), {error: !!failed, record: false});
}
// 잘라 붙이기·복사해 붙이기(PC Ctrl+X·Ctrl+C → 폴더를 열고 Ctrl+V / [여기로 옮기기·여기에 복사]).
function cutRows(rows, mode = 'move') {
  const list = rows.filter(Boolean);
  if (!list.length || (mode === 'move' && phoneStop(list))) return;
  if (mode === 'move') { const chk = moveCheck(list); if (!chk.ok) { notify(chk.reason, {error: true, record: false}); return; } }
  state.clip = {rows: list, keys: list.map(rowKey), mode};
  P().picked.clear(); paintLists(); paintBar();
}
function uncut() { state.clip = null; paintLists(); paintBar(); }
// 잘라 둔 줄(흐리게)은 두 칸 모두에 보일 수 있다.
function paintLists() { for (const p of panesOn()) paintList(p); }
function pasteClip(dest, anchor) {
  const c = state.clip;
  if (!c) return;
  if (c.mode === 'copy') { state.clip = null; paintLists(); paintBar(); xferRun('copy', c.rows, dest); }
  else moveRows(c.rows, dest, anchor);
}
// 끌어 놓기·붙여 넣기 옮기기: 받을 곳 창과 같은 길(xferRun)로. 다른 저장소로 옮기는 것은 원본이 휴지통으로 가므로 한 번 묻는다.
async function moveRows(rows, dest, anchor) {
  const list = rows.filter(Boolean);
  if (phoneStop(list, dest) || !moveTargetOk(list, dest)) return;
  const away = list.filter(r => r.source !== dest.source);
  if (away.length) {
    const r = away[0], one = away.length === 1;
    const ok = await askConfirm(anchor, {text: one ? `'${r.name}'을(를) ${SOURCE_NAME[dest.source]}로 옮길까요?` : `${away.length}개를 ${SOURCE_NAME[dest.source]}로 옮길까요?`, ok: '옮기기',
      note: `똑같이 옮겨졌는지 맞춘 뒤 원본은 ${[...new Set(away.map(x => SOURCE_NAME[x.source]))].join('·')} 휴지통으로 보냅니다`});
    if (!ok) return;
  }
  state.clip = null; paintLists(); paintBar();
  await xferRun('move', list, dest);
}

// ---------- 복사·옮기기: 받을 곳 창(시안 ④) · 같은 이름·큰 파일 묻기(H-3·H-4) · 전송 줄(시안 ⑤ 아래 줄) ----------
// 받을 곳 창은 하단바 위로 열리고(뒤로가기 한 번 = 닫힘), 맨 위 '최근 보낸 곳' 칩 3개(서버 view_prefs.files_dest_recent), 켜진 저장소 나무, [새 폴더][여기에 복사/옮기기].
// 보내기는 한 번에 하나씩 차례로(서버가 1개씩 받음, 같은 클라우드 옮기기만 move 한 번에 200개). 쓰기는 모두 사람이 누른 것(confirm:true).
let destLayer = null;
const destKey = d => d ? folderKey(d.source, d.parent) : '';
function openDest(mode, rows) {
  const list = (rows || []).filter(Boolean);
  if (!list.length || (mode === 'move' && phoneStop(list))) return;
  if (state.run) { notify('보내는 중이에요. 끝난 뒤 다시 해 주세요.', {record: false}); return; }
  const on = cloudOn(), here = hereDest();
  const dest = here && on.includes(here.source) ? here : null;
  const open = new Set(on.map(s => folderKey(s, null)));
  const p = P();
  if (dest) for (const id of [null, ...trailIds(p.trail)]) open.add(folderKey(dest.source, id));
  state.xfer = {mode, rows: list, dest, open, names: new Map(p.trail.map(t => [folderKey(p.where?.source, t.item_id), t.name]))};
  for (const s of on) if (!state.children.has(folderKey(s, null))) loadChildren(s, null);
  destLayer ||= window.KPTURouter?.layer?.open('files-dest', {reopen: () => paintDest(), close: () => { destLayer = null; dropDest(); return true; }}) || null;
  paintDest();
  $('[data-fx-dest] [data-fx-dest-close]')?.focus({preventScroll: true});
}
function dropDest() {
  const x = state.xfer; state.xfer = null;
  if (state.ask && x) { const a = state.ask; state.ask = null; a.resolve({choice: 'skip', all: true, closed: true}); }
  paintDest(); paintAsk();
}
// 닫기 단추·보내기 시작: 창을 먼저 닫고(그리기 주인은 이 파일), 뒤로가기 칸(router layer)도 놓는다. 뒤로가기로 닫힐 때는 layer의 close가 dropDest를 부른다.
function closeDest() { const l = destLayer; destLayer = null; dropDest(); l?.close(); }
const recentDests = () => { const v = viewPrefs.get?.('files_dest_recent'); return Array.isArray(v) ? v : []; };
function destNameOf(dest) {
  if (!dest?.parent) return destName(dest);
  const known = state.xfer?.names.get(destKey(dest));
  if (known) return destName(dest, known);
  for (const p of state.panes) { const t = p.where?.source === dest.source && p.trail.find(x => x.item_id === dest.parent); if (t) return destName(dest, t.name); }
  for (const list of state.children.values()) { const f = list.find(r => r.source === dest.source && r.item_id === dest.parent); if (f) return destName(dest, f.name); }
  return destName(dest, '폴더');
}
function paintDest() {
  const box = $('[data-fx-dest]'), dim = $('[data-fx-dim]');
  if (!box) return;
  const x = state.xfer;
  if (!x) { box.hidden = true; box.innerHTML = ''; if (dim) dim.hidden = true; root.classList.remove('fx-dest-open'); return; }
  box.hidden = false; if (dim) dim.hidden = false; root.classList.add('fx-dest-open');
  const on = cloudOn(), cur = destKey(x.dest);
  const chips = recentDests().map(recentDestOf).filter(d => d && on.includes(d.source));
  const recent = chips.length ? `<div class="fx-dest-sub">최근 보낸 곳</div><div class="fx-dest-recent">${recentDests().filter(d => on.includes(d.source)).map(d =>
    `<button type="button" class="fx-dest-chip${destKey(recentDestOf(d)) === cur ? ' on' : ''}" data-fx-dest-pick="${esc(destKey(recentDestOf(d)))}" data-fx-dest-name="${esc(d.name)}">${d.source === 'gd' ? brandIconSvg('gdrive', {size: 12}) : brandIconSvg('onedrive', {size: 12})}<span>${esc(d.name)}</span></button>`).join('')}</div>` : '';
  const rows = treeRows({sources: on, children: state.children, open: x.open}).filter(r => r.type !== 'shelf');
  const tree = rows.map(r => {
    const key = r.key, sel = key === cur;
    const twist = r.hasKids ? `<button type="button" class="fx-twist" data-fx-dest-twist="${esc(key)}" aria-expanded="${r.open}" aria-label="${r.open ? '접기' : '펼치기'}">${r.open ? '▾' : '▸'}</button>` : '<span class="fx-twist" aria-hidden="true"></span>';
    const name = r.type === 'root' ? SOURCE_NAME[r.source] : r.name;
    return `<div class="nx-row nx-folder${r.type === 'root' ? ' fx-root' : ''}${sel ? ' nx-current' : ''}" style="--nx-indent:${r.depth}">${twist}<button type="button" class="nx-main" data-fx-dest-pick="${esc(key)}" data-fx-dest-name="${esc(name)}"${sel ? ' aria-current="true"' : ''}><span class="nx-name">${esc(name)}</span></button></div>`;
  }).join('');
  const can = !!x.dest && !state.ask;
  box.innerHTML = `<div class="fx-dest-h"><span id="fxDestTitle">${esc(destTitle(x.rows.length, x.mode))}</span><button type="button" class="mini" data-fx-dest-close aria-label="닫기">✕</button></div>`
    + recent + `<nav class="fx-dest-tree nx-tree" aria-label="받을 곳 폴더">${tree || waitHtml({rows: 3})}</nav>`
    + (state.ask ? askHtml(state.ask) : '')
    + `<div class="fx-dest-f"><span class="fx-dest-at">${x.dest ? esc(SOURCE_NAME[x.dest.source] + (x.dest.parent ? ' › ' + destNameOf(x.dest) : '')) : '받을 폴더를 고르세요'}</span>`
    + `<button type="button" class="fx-btn" data-fx-dest-mkdir${can ? '' : ' disabled'}>새 폴더</button><button type="button" class="fx-btn fx-pri" data-fx-dest-go${can ? '' : ' disabled'}>${esc(destButton(x.mode))}</button></div>`;
}
function pickDest(key, name) {
  const x = state.xfer, d = destOf(key);
  if (!x || !d || state.ask) return;
  x.dest = d;
  if (d.parent && name) x.names.set(key, name);
  x.open.add(key);
  fillFolder(d.source, d.parent);
  paintDest();
}
function toggleDest(key) {
  const x = state.xfer;
  if (!x) return;
  if (x.open.has(key)) x.open.delete(key); else { x.open.add(key); const d = destOf(key); if (d) fillFolder(d.source, d.parent); }
  paintDest();
  root.querySelector(`[data-fx-dest-twist="${CSS.escape(key)}"]`)?.focus({preventScroll: true});
}
async function destMkdir(anchor) {
  const x = state.xfer, d = x?.dest;
  if (!d) return;
  const v = await askText(anchor, {text: '새 폴더 이름', value: '', ok: '만들기', max: FILE_BASE_MAX});
  if (v === null || state.xfer !== x) return;
  const chk = checkFileBase(v);
  if (!chk.ok) { notify(chk.message, {error: true, record: false}); return; }
  const r = await write('mkdir', {source: d.source, parent: d.parent, name: chk.base}, '폴더 만드는 중');
  const made = r?.changed?.[0];
  if (!made) return;
  await applyWrite(r, [folderKey(d.source, d.parent)]);
  if (state.xfer !== x) return;
  x.open.add(destKey(d));
  pickDest(folderKey(made.source, made.item_id), made.name);
}
// 같은 이름·큰 파일 묻기: 받을 곳 창이 열려 있으면 그 안, 아니면 하단바 위 작은 칸. 고른 값을 돌려준다({choice:'go'|'skip', all}).
function askHtml(a) {
  return `<div class="fx-ask" role="alertdialog" aria-labelledby="fxAskText"><p id="fxAskText"><b>${esc(a.name)}</b> — ${esc(a.text)}</p>`
    + (a.note ? `<p class="fx-ask-note">${esc(a.note)}</p>` : '')
    + `<div class="fx-ask-opts"><button type="button" class="fx-btn fx-pri" data-fx-ask="go">${esc(a.go)}</button><button type="button" class="fx-btn" data-fx-ask="skip">건너뛰기</button></div>`
    + (a.many ? '<label class="fx-ask-all"><input type="checkbox" data-fx-ask-all> 남은 것도 모두 같게</label>' : '') + '</div>';
}
function paintAsk() {
  const box = $('[data-fx-askbox]');
  if (!box) return;
  const show = !!state.ask && !state.xfer && !state.jobsOpen;
  box.hidden = !show; box.innerHTML = show ? askHtml(state.ask) : '';
  if (state.jobsOpen) paintJobs();
}
function ask(a) {
  return new Promise(resolve => {
    state.ask = {...a, all: false, resolve};
    paintDest(); paintAsk();
    root.querySelector('[data-fx-ask="go"]')?.focus({preventScroll: true});
  });
}
function answer(choice) {
  const a = state.ask;
  if (!a) return;
  const all = !!root.querySelector('[data-fx-ask-all]')?.checked;
  state.ask = null;
  a.resolve({choice, all});
  paintDest(); paintAsk();
}
// 받을 곳 창 [여기에 복사/옮기기].
async function destGo() {
  const x = state.xfer;
  if (!x?.dest || state.ask || state.run) return;
  const dest = x.dest, name = destNameOf(dest);
  const ran = await xferRun(x.mode, x.rows, dest, {inSheet: true});
  if (!ran) return;
  viewPrefs.set('files_dest_recent', pushRecentDest(recentDests(), dest, name), {rejectable: true});
}
// 보내기 한 번(복사·옮기기 공용): 막을 것 거르기 → 같은 이름 묻기(한 번, '남은 것도 모두 같게') → 200MB 넘는 것 묻기 → 차례로 보내며 전송 줄.
//   덮어쓰기는 없다: [그래도 하기]는 서버가 '이름 (2)'처럼 번호를 붙여 둘 다 둔다(공용 numberedName). 끝나면 한 줄 알림.
async function xferRun(mode, rows, dest, {inSheet = false} = {}) {
  if (state.run || state.busy) return false;
  // 폰 → 클라우드 복사: 폰 앱 안에서 원본을 읽어 올리기 길(upload_open, 같은 이름·200MB 묻기·전송 목록 그대로)로. 폰이 낀 다른 일은 이 판에서 하지 않는다.
  if (hasPhone(rows) || dest?.source === PH) {
    if (mode !== 'copy' || dest?.source === PH || !hasPhone(rows) || rows.some(r => r.source !== PH)) { phoneStop(rows, dest); return false; }
    if (inSheet) closeDest();
    P().picked.clear(); paintPicks();
    await phoneToCloud(rows, dest);
    return true;
  }
  const plan = xferPlan(rows, dest, mode);
  if (!plan.ok.length) { notify(plan.reason, {error: true, record: false}); return false; }
  let destRows = [];
  try { const v = await rpc('app_cloud_list', {p_source: dest.source, p_parent_id: dest.parent}); destRows = Array.isArray(v) ? v : []; } catch { /* 모르면 묻지 않고 서버가 번호를 붙인다 */ }
  const verb = mode === 'move' ? '옮길까요' : '복사할까요';
  const same = new Set(sameNameRows(plan.ok, destRows).map(rowKey));
  const go = [], numbered = new Set(), bigGo = new Set(), sameSkip = [];
  let skipped = plan.blocked.length, sameAll = null, bigAll = null;
  const list = plan.ok;
  for (const r of list) {
    if (same.has(rowKey(r))) {
      let c = sameAll;
      if (!c) {
        const left = list.filter(y => same.has(rowKey(y))).length;
        const res = await ask({name: r.name, text: sameNameAsk(mode), go: '그래도 하기', many: left > 1});
        if (res.closed) return false;
        c = res.choice; if (res.all) sameAll = c;
      }
      if (c === 'skip') { skipped++; sameSkip.push(r); continue; }
      numbered.add(rowKey(r));
    }
    if (xferBig(r, dest)) {
      let c = bigAll;
      if (!c) {
        const res = await ask({name: r.name, text: bigAsk(r), note: XFER_BIG_HOW, go: '그래도 보내기', many: list.filter(y => xferBig(y, dest)).length > 1});
        if (res.closed) return false;
        c = res.choice; if (res.all) bigAll = c;
      }
      // [그래도 보내기]만 서버가 10MB 조각씩 이어 보낸다(2-②). [건너뛰기]는 보내지 않는다.
      if (c !== 'go') { skipped++; continue; }
      bigGo.add(rowKey(r));
    }
    go.push(r);
  }
  if (inSheet) closeDest();
  P().picked.clear(); paintPicks();
  if (plan.blocked.length) notify(plan.blocked[0].reason, {error: true, record: false});
  if (!go.length) { if (skipped) notify(xferDoneText(mode, {skipped}), {record: false}); return true; }
  // 복사·다른 저장소로 옮기기는 서버 작업표로(화면을 닫아도 서버가 잇는다). 같은 이름 [건너뛰기]도 '건너뜀' 줄로 남긴다.
  const scope = state.scope;
  const batch = mode === 'move' ? go.filter(r => r.source === dest.source) : [];
  const toJobs = go.filter(r => !batch.includes(r));
  if (toJobs.length) {
    const skipRows = sameSkip.filter(r => mode === 'copy' || r.source !== dest.source);
    const items = [...toJobs.map(r => ({source: r.source, id: r.item_id, ...(numbered.has(rowKey(r)) ? {numbered: true} : {}), ...(bigGo.has(rowKey(r)) ? {big: true} : {})})),
      ...skipRows.map(r => ({source: r.source, id: r.item_id, skip: true}))];
    const ok = await addJobs(mode, dest, items);
    if (state.scope !== scope) return true;
    if (ok && !batch.length) { notify(`${toJobs.length}개 보내기 시작 · 아래 전송 줄을 누르면 목록`, {record: false}); return true; }
    if (!ok && !batch.length) return true;
  }
  if (!batch.length) return true;
  const run = state.run = {mode, total: batch.length, at: 1, done: 0, failed: 0, name: batch[0].name, code: '', pending: false};
  paintXfer();
  const call = async (action, body) => {
    try { return await rt().api(FN, {method: 'POST', body: {action, ...body, confirm: true}, singleFlight: false, timeoutMs: action === 'move' ? 60000 : 400000}); }
    catch (e) { run.code ||= codeOf(e); return null; }
  };
  try {
    // 같은 클라우드 안 옮기기는 move 한 번(200개씩, 남은 것은 이어서).
    let ids = batch.map(r => r.item_id);
    while (ids.length && state.scope === scope) {
      const d = await call('move', {source: dest.source, ids, to: dest.parent, ...(batch.some(r => numbered.has(rowKey(r))) ? {numbered: true} : {})});
      if (!d) { run.failed += ids.length; break; }
      await applyWrite(d, touchedFolders(batch, dest));
      const bad = (d.failed || []).length, left = Array.isArray(d.left) ? d.left : [];
      if (bad && !run.code) run.code = d.failed[0]?.error || '';
      run.failed += bad; run.done += ids.length - bad - left.length; run.at = Math.min(run.total, run.done + run.failed + 1);
      ids = left; paintXfer();
    }
  } finally {
    if (state.run === run) state.run = null;
    paintXfer(); paintBar();
  }
  if (state.scope !== scope) return true;
  const note = run.failed && run.code ? (run.code === 'kept_original' ? writeDoneText('across', {kept: true}) : writeErrorText(run.code))
    : run.code === 'kept_original' ? writeDoneText('across', {kept: true}) : run.pending ? '원드라이브가 마저 복사하는 중이에요. 끝나면 곧 목록에 보여요.' : '';
  notify(xferDoneText(mode, {done: run.done, failed: run.failed, skipped: toJobs.length ? 0 : skipped}), {error: !!run.failed, note, record: false});
  return true;
}
// 전송 줄(하단바 위): 같은 저장소 안 옮기기(state.run, 화면이 직접)가 먼저, 아니면 서버 작업표 묶음(jobStrip). 누르면 전송 목록.
function paintXfer() {
  const box = $('[data-fx-xfer]');
  if (!box) return;
  const r = state.run, s = r ? null : jobStrip(state.jobs);
  const on = !!(r || s) && !state.jobsOpen;
  box.hidden = !on;
  root.classList.toggle('fx-xfer-on', on);
  if (!on) { box.innerHTML = ''; return; }
  if (r) { box.innerHTML = `<span class="fx-xfer-bar" style="width:${xferPercent(r.done + r.failed, r.total)}%"></span><span aria-hidden="true">↗</span><b>${esc(xferLine(r.at, r.total))}</b><span class="fx-xfer-nm">${esc(r.name)}</span>`; return; }
  box.innerHTML = `<span class="fx-xfer-bar" style="width:${s.percent}%"></span><button type="button" class="fx-xfer-go" data-fx-jobs-open aria-haspopup="dialog">`
    + `<span aria-hidden="true">↗</span><b>${esc(s.text)}</b>${s.name ? `<span class="fx-xfer-nm">${esc(s.name)}</span>` : '<span class="fx-xfer-nm"></span>'}`
    + `${s.paused || !s.percent ? '' : `<span class="fx-xfer-pc">${s.percent}%</span>`}<span class="fx-xfer-open">목록 ▸</span></button>`;
}

// ---------- 전송 목록(서버 작업표) ----------
async function loadJobs() {
  clearTimeout(jobTimer);
  const scope = state.scope;
  try {
    const d = await edge('job_list');
    if (state.scope !== scope) return;
    setJobs(mergeJobs([], Array.isArray(d?.jobs) ? d.jobs : []));
  } catch { if (state.scope === scope) scheduleJobs(); /* 표가 아직 없거나 잠시 실패: 이번엔 그대로 */ }
}
function scheduleJobs() {
  clearTimeout(jobTimer);
  if (jobsActive(state.jobs) && visible()) jobTimer = setTimeout(loadJobs, JOB_POLL_MS);
}
function setJobs(list) {
  // 기기 줄(올리기)은 이 탭이 보내는 것만 '보내는 중·기다림'. 다른 탭·닫힌 화면 것은 멈춤으로 본다(H-6, 다시 고르면 이어 올림).
  list = list.map(j => (j?.origin === 'device' && !upOurs(j.id) ? deviceJobOnReopen(j) : j));
  const finished = newlyDone(state.jobs, list), wasActive = state.jobsWere;
  state.jobs = list;
  state.jobsWere = jobsActive(list);
  // 이번 묶음 = 이 화면에서 '보내는 중'으로 본 줄들. 묶음이 다 끝나면(보내는 중 → 없음) 그 줄들만 세어 한 줄 알림.
  for (const j of list) if (j.status === 'queued' || j.status === 'running') jobsSeen.add(j.id);
  paintXfer(); paintJobs();
  scheduleJobs();
  if (finished.length) jobsLanded(finished);
  if (wasActive && !state.jobsWere) {
    const s = list.filter(j => jobsSeen.has(j.id));
    jobsSeen.clear();
    const done = s.filter(j => j.status === 'done').length, failed = s.filter(j => j.status === 'failed').length;
    if (done || failed) notify(failed ? `${done ? done + '개 보냄 · ' : ''}${failed}개 못 보냄 · 전송 목록에서 까닭과 [다시]` : `${done}개 보냄`, {error: !!failed, record: false});
  }
}
// 끝난 줄: 받은 곳(·옮기기면 원래 곳) 폴더를 색인에서 다시 읽는다(서버가 끝낼 때 색인에 넣었다).
async function jobsLanded(list) {
  for (const j of list) {
    for (const [source, parent] of [[j.dest_source, j.dest_parent], ...(j.kind === 'move' ? [[j.src_source, null]] : [])]) {
      if (state.children.has(folderKey(source, parent))) loadChildren(source, parent);
    }
  }
  await Promise.all(panesOn().filter(p => p.loaded && !p.query).map(p => loadList(p, {quiet: true})));
}
async function addJobs(mode, dest, items) {
  const scope = state.scope;
  state.jobsBusy = true; paintBar();
  try {
    let made = [];
    for (let i = 0; i < items.length; i += 200) {
      const d = await rt().api(FN, {method: 'POST', body: {action: 'job_add', confirm: true, kind: mode, to_source: dest.source, to: dest.parent, items: items.slice(i, i + 200)}, singleFlight: false, timeoutMs: 60000});
      made = made.concat(Array.isArray(d?.jobs) ? d.jobs : []);
    }
    if (state.scope !== scope) return false;
    setJobs(mergeJobs(state.jobs, made));
    setTimeout(() => { if (state.scope === scope) loadJobs(); }, 600);
    return true;
  } catch (e) {
    if (state.scope === scope) notify(writeErrorText(codeOf(e)), {error: true, record: false});
    return false;
  } finally { if (state.scope === scope) { state.jobsBusy = false; paintBar(); } }
}
async function jobsDo(action, ids) {
  const scope = state.scope;
  // 올리기 줄을 멈추면 이 탭이 보내던 조각도 그 자리에서 멈춘다(파일은 쥐고 있어 [이어 올리기]는 다시 고르지 않음).
  if (action === 'job_pause') {
    const hit = id => !ids || ids.includes(id);
    up.queue = up.queue.filter(q => !hit(q.id));
    if (up.cur && hit(up.cur.id)) up.cur.ctrl.abort();
  }
  try {
    const d = await rt().api(FN, {method: 'POST', body: {action, confirm: true, ...(ids ? {ids} : {all: true})}, singleFlight: false, timeoutMs: 30000});
    if (state.scope !== scope) return;
    setJobs(mergeJobs(state.jobs, Array.isArray(d?.jobs) ? d.jobs : []));
    if (action === 'job_resume') setTimeout(() => { if (state.scope === scope) loadJobs(); }, 600);
  } catch (e) { if (state.scope === scope) notify(writeErrorText(codeOf(e)), {error: true, record: false}); }
}
function openJobs() {
  state.jobsOpen = true;
  jobsLayer ||= window.KPTURouter?.layer?.open('files-jobs', {reopen: () => { state.jobsOpen = true; paintJobs(); paintXfer(); paintAsk(); }, close: () => { jobsLayer = null; state.jobsOpen = false; paintJobs(); paintXfer(); paintAsk(); return true; }}) || null;
  paintJobs(); paintXfer(); paintAsk();
  loadJobs();
  $('[data-fx-jobs] [data-fx-jobs-close]')?.focus({preventScroll: true});
}
function closeJobs() { const l = jobsLayer; jobsLayer = null; state.jobsOpen = false; paintJobs(); paintXfer(); paintAsk(); l?.close(); }
const JOB_BTN = {pause: '멈춤', resume: '이어 하기', retry: '다시', reup: '이어 올리기'};
function jobRowHtml(j) {
  const act = jobAction(j), pc = jobPercent(j), hint = deviceHint(j, upFiles.has(j.id));
  const bar = j.status === 'running' || (j.status === 'paused' && j.sent_bytes > 0) ? `<span class="fx-job-pg" aria-hidden="true"><i style="width:${pc}%"></i></span>` : '';
  const kr = {is_folder: j.is_folder, name: j.name, mime: ''};
  return `<li class="fx-job fx-job-${esc(j.status)}" data-fx-job="${esc(j.id)}"><span class="fx-ico" data-kind="${kindOf(kr)}" aria-hidden="true">${esc(kindIcon(kr))}</span>`
    + `<span class="fx-job-t"><span class="fx-job-nm">${esc(j.name)}</span><small>${esc([jobLine(j), hint].filter(Boolean).join(' · '))}</small>${bar}</span>`
    + `<span class="fx-job-st">${esc(jobStatusText(j))}</span>`
    + (act ? `<button type="button" class="mini" data-fx-job-act="${act}" data-fx-job-id="${esc(j.id)}">${JOB_BTN[act]}</button>` : '') + '</li>';
}
function paintJobs() {
  const box = $('[data-fx-jobs]');
  if (!box) return;
  if (!state.jobsOpen) { box.hidden = true; box.innerHTML = ''; root.classList.remove('fx-jobs-open'); return; }
  box.hidden = false; root.classList.add('fx-jobs-open');
  const list = state.jobs, active = jobsActive(list), paused = list.some(j => j.status === 'paused' && j.origin !== 'device');
  const all = active ? '<button type="button" class="mini" data-fx-jobs-all="pause">모두 멈춤</button>' : paused ? '<button type="button" class="mini" data-fx-jobs-all="resume">모두 이어 하기</button>' : '';
  const asking = state.ask && !state.xfer ? askHtml(state.ask) : '';
  // 2초마다 다시 그려도 누르던 단추의 포커스를 잃지 않게(키보드·화면 읽기).
  const f = document.activeElement, keep = f && box.contains(f) ? ['data-fx-job-id', 'data-fx-job-act', 'data-fx-jobs-all', 'data-fx-jobs-close', 'data-fx-ask']
    .filter(n => f.hasAttribute(n)).map(n => `[${n}="${CSS.escape(f.getAttribute(n))}"]`).join('') : '';
  box.innerHTML = `<div class="fx-jobs-h"><span id="fxJobsTitle">${esc(jobsTitle(list))}</span>${all}<button type="button" class="mini" data-fx-jobs-close aria-label="닫기">✕</button></div>${asking}`
    + (list.length ? `<ul class="fx-jobs-list">${list.map(jobRowHtml).join('')}</ul>` : '<p class="fx-jobs-none">보낸 것이 없어요(하루 지난 것은 지워져요).</p>');
  if (keep) (box.querySelector(keep) || box.querySelector('[data-fx-jobs-close]'))?.focus({preventScroll: true});
}
// ---------- 올리기(FILES-통합 2-④, S49-33, 명진 결정 H-3·H-4·H-6, 시안 ⑦) ----------
// PC: 바탕화면 파일을 목록 칸(그 칸의 지금 폴더)이나 폴더 줄에 끌어 놓기 → 점선 '여기 놓으면 ○○에 올리기'. 폰·폴드: 위 줄 [올리기] → 고르기 창.
// 같은 이름은 한 번 묻기(H-3, [그래도 하기] = 서버가 '이름 (2)'로 둘 다 둠), 200MB 넘으면 한 번 묻기(H-4, 2GB까지).
// 파일마다 서버(upload_open)가 작업표 줄(기기 줄)과 그 클라우드의 이어 올리기 자리를 열어 주고, 이 화면이 그 자리로 5MB씩 직접 보낸다(파일이 서버를 거치지 않음).
// 자리 주소는 그 한 건 응답에만 오고 이 탭 메모리에만 둔다. 조각마다 서버에 보낸 바이트를 알리고(전송 목록 진행), 끝나면 서버가 클라우드에 물어 맞춘 뒤 색인에 넣는다.
// H-6: 올리는 중 화면을 숨기면 그 자리에서 멈추고(작업표 '일시 정지'), 다시 보이면 쥐고 있던 파일로 남은 조각부터. 탭을 닫으면 멈춤으로 남고,
//   다시 연 화면에서는 [이어 올리기] → 같은 파일(이름·크기)을 다시 고르면 남은 조각부터(브라우저는 닫힌 화면의 파일을 기억하지 못한다).
// 파일 손잡이(upFiles)는 이 탭 메모리에만 — 기기 저장 없음.
const upFiles = new Map();
const up = {queue: [], cur: null, pumping: false, hiddenStop: false};
let refileFor = '';
const upOurs = id => up.cur?.id === id || up.queue.some(q => q.id === id);
// 폰 파일 → 클라우드: 파일만(폴더는 열어 파일을 고르게, H-5). 한 번에 PHONE_UP_MAX개까지 폰에서 읽어 올리기 길로 넘긴다.
const PHONE_UP_MAX = 20;
async function phoneToCloud(rows, dest) {
  const files = rows.filter(r => !r.is_folder), dirs = rows.length - files.length;
  if (!files.length) { notify('폴더는 보내지 않아요(파일만). 폴더를 열어 파일을 골라 주세요.', {record: false}); return; }
  if (files.length > PHONE_UP_MAX) notify(`폰 파일은 한 번에 ${PHONE_UP_MAX}개까지 보내요. 앞 ${PHONE_UP_MAX}개만 보냅니다.`, {record: false});
  const scope = state.scope, out = [];
  state.busy = '폰 파일 읽는 중'; paintBar();
  try {
    for (const r of files.slice(0, PHONE_UP_MAX)) {
      try {
        const blob = await phone.blob(r.item_id);
        out.push(new File([blob], r.name, {type: r.mime || blob.type || '', lastModified: Date.parse(r.modified_at || '') || Date.now()}));
      } catch (e) { notify(`${r.name}: ${errorText(codeOf(e))}`, {error: true, record: false}); }
      if (state.scope !== scope) return;
    }
  } finally { if (state.scope === scope) { state.busy = ''; paintBar(); } }
  if (out.length) await uploadFiles(out, dest, {skipDirs: dirs});
}
async function uploadFiles(files, dest, {skipDirs = 0} = {}) {
  if (!dest?.source || !SOURCES.includes(dest.source)) return;
  if (state.ask || state.busy) { notify('다른 일을 묻는 중이에요. 끝난 뒤 다시 해 주세요.', {record: false}); return; }
  const plan = uploadPlan(files, n => checkFileBase(n).ok);
  if (skipDirs) notify('폴더는 올리지 않아요(파일만). 폴더를 열어 파일을 골라 주세요.', {record: false});
  if (!plan.ok.length) { if (plan.blocked.length) notify(plan.reason, {error: true, record: false}); return; }
  if (plan.blocked.length) notify(plan.blocked[0].reason, {error: true, record: false});
  const scope = state.scope;
  let destRows = [];
  try { const v = await rpc('app_cloud_list', {p_source: dest.source, p_parent_id: dest.parent}); destRows = Array.isArray(v) ? v : []; } catch { /* 모르면 묻지 않고 서버가 번호를 붙인다 */ }
  const same = new Set(upSameName(plan.ok, destRows));
  const go = [];
  let sameAll = null, bigAll = null, skipped = 0;
  for (const f of plan.ok) {
    if (same.has(f)) {
      let c = sameAll;
      if (!c) {
        const res = await ask({name: f.name, text: sameNameAsk('up'), go: '그래도 하기', many: plan.ok.filter(y => same.has(y)).length > 1});
        if (res.closed) return;
        c = res.choice; if (res.all) sameAll = c;
      }
      if (c === 'skip') { skipped++; continue; }
    }
    if (upBig(f)) {
      let c = bigAll;
      if (!c) {
        const res = await ask({name: f.name, text: bigAsk({size_bytes: f.size}, 'up'), note: UPLOAD_BIG_HOW, go: '그래도 올리기', many: plan.ok.filter(upBig).length > 1});
        if (res.closed) return;
        c = res.choice; if (res.all) bigAll = c;
      }
      if (c !== 'go') { skipped++; continue; }
    }
    go.push(f);
  }
  if (state.scope !== scope) return;
  if (!go.length) { if (skipped) notify(`${skipped}개 건너뜀`, {record: false}); return; }
  // 줄을 모두 먼저 연다(전송 목록에 한 줄씩 '기다림'으로 보이게) → 차례로 보낸다.
  state.jobsBusy = true; paintBar();
  let opened = 0;
  try {
    for (const f of go) {
      let d;
      try {
        d = await rt().api(FN, {method: 'POST', body: {action: 'upload_open', confirm: true, to_source: dest.source, to: dest.parent, name: f.name, size: f.size,
          ...(f.type ? {mime: f.type} : {}), ...(upBig(f) ? {big: true} : {})}, singleFlight: false, timeoutMs: 60000});
      } catch (e) { if (state.scope === scope) notify(`${f.name}: ${writeErrorText(codeOf(e))}`, {error: true, record: false}); continue; }
      if (state.scope !== scope) return;
      if (!d?.job?.id) continue;
      opened++;
      setJobs(mergeJobs(state.jobs, [d.job]));
      if (d.job.status === 'done') { applyWrite(d); continue; }
      upFiles.set(d.job.id, f);
      up.queue.push({id: d.job.id, file: f});
    }
  } finally { if (state.scope === scope) { state.jobsBusy = false; paintBar(); } }
  if (!opened) return;
  notify(upStartText(opened), {note: skipped ? `${skipped}개 건너뜀` : '', record: false});
  upPump();
}
// 차례로 하나씩: 서버에 '보내는 중'으로 바꾸며 자리·이어 갈 곳을 받고(upload_resume — 처음이면 0), 남은 조각을 보낸다.
async function upPump() {
  if (up.pumping) return;
  up.pumping = true;
  const scope = state.scope;
  try {
    while (up.queue.length && state.scope === scope && !up.hiddenStop) {
      const item = up.queue[0], file = item.file;
      let d;
      try {
        d = await rt().api(FN, {method: 'POST', body: {action: 'upload_resume', confirm: true, id: item.id, name: file.name, size: file.size}, singleFlight: false, timeoutMs: 60000});
      } catch (e) {
        up.queue.shift();
        notify(`${file.name}: ${writeErrorText(codeOf(e))}`, {error: true, record: false});
        loadJobs();
        continue;
      }
      if (state.scope !== scope) return;
      if (d?.job) setJobs(mergeJobs(state.jobs, [d.job]));
      if (!d?.upload) { up.queue.shift(); if (d?.changed) applyWrite(d); continue; }
      const out = await upSend(item, d.upload);
      // 숨김: 줄은 큐에 남겨 다시 보일 때 잇는다. 사람이 멈춤(큐에서 빠짐)·다른 곳에서 멈춤: 다음 줄로.
      if (out === 'stop' && up.queue[0] === item) break;
      if (up.queue[0] === item) up.queue.shift();
    }
  } finally { up.pumping = false; up.cur = null; }
}
// 조각 보내기. 'done'·'failed' = 이 줄 끝, 'stop' = 멈춤(숨김·사람이 멈춤).
async function upSend(item, slot) {
  const file = item.file, size = file.size, ctrl = new AbortController();
  up.cur = {id: item.id, ctrl};
  let off = Math.max(0, Number(slot.offset) || 0), tries = 0;
  const fail = async code => {
    try { const v = await rt().api(FN, {method: 'POST', body: {action: 'upload_progress', confirm: true, id: item.id, error: code}, singleFlight: false, timeoutMs: 30000}); if (v?.job) setJobs(mergeJobs(state.jobs, [v.job])); } catch { loadJobs(); }
    return 'failed';
  };
  for (;;) {
    const piece = upPiece(off, size, Number(slot.chunk) || 5 * 1024 * 1024);
    if (!piece) return fail('upload_failed');
    let res;
    try {
      res = await fetch(slot.url, {method: 'PUT', cache: 'no-store', credentials: 'omit', headers: {'Content-Range': `bytes ${piece.start}-${piece.end - 1}/${size}`},
        body: file.slice(piece.start, piece.end), signal: ctrl.signal});
    } catch {
      if (ctrl.signal.aborted) return 'stop';
      if (++tries <= 2) { await new Promise(r => setTimeout(r, 1500 * tries)); if (ctrl.signal.aborted) return 'stop'; continue; }
      return fail('upload_failed');
    }
    if (ctrl.signal.aborted) return 'stop';
    if (res.status === 308 || res.status === 202) {
      off = piece.end; tries = 0;
      let v = null;
      try { v = await rt().api(FN, {method: 'POST', body: {action: 'upload_progress', confirm: true, id: item.id, sent: off}, singleFlight: false, timeoutMs: 30000}); } catch { /* 진행 알림은 덧붙임: 다음 조각 때 다시 */ }
      if (v?.job && v.job.status !== 'running') { up.queue = up.queue.filter(q => q.id !== item.id); up.cur = null; setJobs(mergeJobs(state.jobs, [v.job])); return 'paused'; }
      if (v?.job) setJobs(mergeJobs(state.jobs, [v.job]));
      continue;
    }
    if (res.status === 200 || res.status === 201) {
      let r = null; try { r = await res.json(); } catch { /* 몸통을 못 읽으면 서버가 이름·자리로 찾는다 */ }
      try {
        const d = await rt().api(FN, {method: 'POST', body: {action: 'upload_done', confirm: true, id: item.id, ...(upResultId(r) ? {item_id: upResultId(r)} : {})}, singleFlight: false, timeoutMs: 60000});
        if (d?.job) setJobs(mergeJobs(state.jobs, [d.job]));
        upFiles.delete(item.id);
        await applyWrite(d);
        return 'done';
      } catch { return fail('upload_failed'); }
    }
    if ((res.status === 429 || res.status >= 500) && ++tries <= 2) { await new Promise(r => setTimeout(r, 2000 * tries)); continue; }
    return fail(res.status === 404 || res.status === 410 ? 'session_expired' : res.status === 507 ? 'no_space' : res.status === 429 || res.status === 503 ? 'cloud_throttled' : 'upload_failed');
  }
}
// 화면을 숨기거나 닫을 때: 지금 조각을 멈추고 서버 줄을 '일시 정지'로(닫히는 화면에서도 가도록 keepalive). 큐는 메모리에 남는다.
function upStop() {
  const ids = [up.cur?.id, ...up.queue.map(q => q.id)].filter(Boolean);
  if (!ids.length) return;
  up.hiddenStop = true;
  up.cur?.ctrl.abort();
  const r = rt(), token = r?.session?.read?.()?.access_token;
  if (!token) return;
  try {
    fetch(r.config.url + FN, {method: 'POST', keepalive: true, cache: 'no-store', headers: {apikey: r.config.key, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'},
      body: JSON.stringify({action: 'job_pause', confirm: true, ids: [...new Set(ids)].slice(0, 200)})}).catch(() => {});
  } catch { /* 닫히는 중: 서버가 3분 뒤 멈춤으로 바꾼다 */ }
}
// 다시 보일 때: 쥐고 있던 파일로 남은 조각부터.
function upShow() {
  if (!up.hiddenStop) return;
  up.hiddenStop = false;
  if (up.queue.length) upPump();
}
// [이어 올리기]: 이 탭이 파일을 쥐고 있으면 바로, 아니면 같은 파일을 다시 고르게 한다.
function reupload(id) {
  const j = state.jobs.find(x => x.id === id);
  if (!j || upOurs(id)) return;
  const f = upFiles.get(id);
  if (f && sameUpFile(j, f)) { up.queue.push({id, file: f}); upPump(); return; }
  refileFor = id;
  const inp = $('[data-fx-refile]');
  if (!inp) return;
  inp.value = '';
  notify(UPLOAD_REOPEN_TEXT, {record: false});
  inp.click();
}
function refilePicked(f) {
  const id = refileFor; refileFor = '';
  const j = state.jobs.find(x => x.id === id);
  if (!j || !f) return;
  if (!sameUpFile(j, f)) { notify(writeErrorText('file_mismatch'), {error: true, record: false}); return; }
  upFiles.set(id, f);
  up.queue.push({id, file: f});
  upPump();
}
// 끌어 놓기 받을 곳: 폴더 줄이면 그 폴더, 아니면 그 칸의 지금 폴더(최근·찾기 칸은 없음).
const upTarget = event => {
  if (drag || !Array.from(event.dataTransfer?.types || []).includes('Files')) return null;
  const row = event.target.closest?.('[data-fx-drop]');
  const i = paneOfEl(event.target);
  if (row && i >= 0) { const d = destOf(row.dataset.fxDrop); if (d && onSources().includes(d.source)) return {t: row, dest: d}; }
  const box = i >= 0 ? paneEl(state.panes[i]) : null;
  const d = box && paneDest(state.panes[i]);
  return d && onSources().includes(d.source) ? {t: box, dest: d} : null;
};

// 미리보기 ☆ 한 개만 고친다(PDF를 그리는 칸은 다시 그리지 않음).
function paintStarOne() {
  const b = $('[data-fx-star-one]'), on = !!state.preview?.row?.starred;
  if (!b) return;
  b.textContent = on ? '★' : '☆'; b.classList.toggle('on', on);
  b.setAttribute('aria-pressed', String(on)); b.setAttribute('aria-label', on ? '별표 빼기' : '별표'); b.title = on ? '별표 빼기' : '별표';
}
// ---------- 별표(2-④): 고르기 막대·미리보기 ☆. 서버(app_cloud_stars)가 기억, [별표] 탭에 바로 ----------
async function starRows(rows) {
  const list = (rows || []).filter(r => r && SOURCES.includes(r.source));
  if (!list.length) return;
  const on = starWant(list);
  for (const g of groupBySource(list)) {
    const ids = g.rows.map(r => r.item_id);
    const d = await write('star', {source: g.source, ids, on}, on ? '별표 넣는 중' : '별표 빼는 중', {timeoutMs: 30000});
    if (!d) return;
    for (const p of state.panes) {
      const rs = applyStars(p.rows, g.source, ids, on); if (rs !== p.rows) p.rows = rs;
      if (p.found) { const f = applyStars(p.found, g.source, ids, on); if (f !== p.found) p.found = f; }
    }
    if (state.preview && state.preview.row.source === g.source && ids.includes(state.preview.row.item_id)) { state.preview.row = {...state.preview.row, starred: on}; paintStarOne(); }
  }
  const work = [];
  for (const p of panesOn()) { if (p.where?.shelf === 'starred' && !p.query) work.push(loadList(p, {quiet: true})); else paintList(p); }
  paintBar();
  await Promise.all(work);
  notify(on ? `${list.length}개 별표` : `${list.length}개 별표 뺌`, {record: false});
}

const hereDest = (p = P()) => paneDest(p);
const destOf = key => { const [source, ...rest] = String(key || '').split(':'); return SOURCES.includes(source) ? {source, parent: rest.join(':') || null} : null; };

// ---------- 두 칸: 켜기·지금 칸·반대 칸으로 보내기·끌어 놓기 고르기 ----------
// 지금 칸 바꾸기: 칸 안 그림은 다시 그리지 않는다(누르던 단추가 바뀌어 누름이 사라지지 않게) — 표시(fx-cur)·위 줄·막대·왼쪽 나무만.
function setCur(i) {
  if (!two() || i === state.cur || !state.panes[i]) return;
  state.cur = i;
  markCur(); paintTop(); paintBar(); paintMainTree();
}
// 한 칸으로 돌아갈 때 지금 쓰던 칸이 그 한 칸이 된다(칸 1이었으면 자리를 바꾼다). 두 칸이 될 때 오른쪽 칸이 비어 있으면 첫 위치를 연다.
function layoutChanged() {
  if (!two()) {
    if (state.cur === 1) { state.panes.reverse(); state.cur = 0; window.KPTURouter?.setPlace?.('files', placeOf(state.panes[0].where)); }
    state.panes[1].picked.clear(); state.panes[1].drop = false;
    state.dropAsk = null;
    paint();
    return;
  }
  const b = state.panes[1];
  paint();
  if (!state.status) return;
  if (b.where) { loadList(b, {quiet: true}); return; }
  const start = otherStart(state.panes[0].where, onSources());
  if (start) setWhere(b, start, {keepPreview: true});
}
function setTwo(on) {
  if (PHONE.matches) return;
  viewPrefs.setFilesTwo?.(DEVICE, twoValue(viewPrefs.getFilesTwo?.(DEVICE), twoLayout(WIDE.matches), on));
  closePreview();
  layoutChanged();
}
// 고르기 막대·F5·F6: 지금 칸에서 고른 것(없으면 선택한 한 줄)을 반대 칸의 지금 폴더로. 같은 이름·200MB 묻기·전송 목록은 xferRun 그대로.
function sendOpp(mode, anchor) {
  const dest = oppDest(), list = actRows();
  if (!list.length) return;
  if (!dest) { notify(`${paneSide(state.cur ^ 1)} 칸에서 받을 폴더를 여세요`, {record: false}); return; }
  if (mode === 'move') moveRows(list, dest, anchor); else xferRun('copy', list, dest);
}
// 칸 사이로 끌어 놓았을 때 '복사 · 옮기기' 작은 고르기(시안 ⑥ drop-hint). 놓은 자리 곁에 뜬다.
function paintDropAsk() {
  const box = $('[data-fx-dropask]');
  if (!box) return;
  const a = state.dropAsk;
  if (!a) { box.hidden = true; box.innerHTML = ''; return; }
  const copyOk = xferPlan(a.rows, a.dest, 'copy').ok.length > 0, moveOk = moveTargetOk(a.rows, a.dest);
  box.hidden = false;
  box.style.left = `${Math.max(8, Math.min(a.x - 120, window.innerWidth - 268))}px`;
  box.style.top = `${Math.max(8, Math.min(a.y + 8, window.innerHeight - 120))}px`;
  box.innerHTML = `<span class="fx-drop-t">${esc(DROP_ASK_TEXT)} → <b>${esc(destNameOf(a.dest))}</b></span>`
    + `<button type="button" class="fx-btn fx-pri" data-fx-drop-go="copy"${copyOk ? '' : ' disabled'}>복사</button><button type="button" class="fx-btn" data-fx-drop-go="move"${moveOk ? '' : ' disabled'}>옮기기</button>`
    + '<button type="button" class="mini" data-fx-drop-x aria-label="놓기 그만두기">✕</button>';
}
function dropGo(mode, anchor) {
  const a = state.dropAsk;
  state.dropAsk = null; paintDropAsk();
  if (!a) return;
  if (mode === 'move') moveRows(a.rows, a.dest, anchor); else xferRun('copy', a.rows, a.dest);
}
function dropAskClose() { if (state.dropAsk) { state.dropAsk = null; paintDropAsk(); } }

// ---------- 움직이기(지금 칸) ----------
function clearQuery(p) {
  if (!p.query) return;
  clearTimeout(p.ftimer); p.query = ''; p.found = null; p.fseq++;
  const s = $('[data-fx-search]'); if (s && p === P()) s.value = '';
}
function goFolder(source, id, p = P()) {
  if (!SOURCES.includes(source) && !(source === PH && phoneOn())) return;
  clearQuery(p);
  const parent = id || null;
  state.open.add(folderKey(source, parent));
  return setWhere(p, {source, parent});
}
function goShelf(shelf, p = P()) {
  clearQuery(p);
  return setWhere(p, {shelf});
}
function goUp() {
  const p = P(), w = p.where;
  if (!w?.source) return;
  if (!w.parent) { if (PHONE.matches && state.tab === 'folders') { p.pane = 'tree'; paint(); } return; }
  const ids = trailIds(p.trail);
  return goFolder(w.source, ids.length > 1 ? ids[ids.length - 2] : null);
}
function toggle(key, box) {
  if (state.open.has(key)) state.open.delete(key); else {
    state.open.add(key);
    const [source, ...rest] = key.split(':'), id = rest.join(':') || null;
    fillFolder(source, id);
  }
  paintTree();
  (box?.isConnected ? box : root).querySelector(`[data-fx-twist="${CSS.escape(key)}"]`)?.focus({preventScroll: true});
}
function setTab(tab) {
  if (!PHONE_TABS.includes(tab)) return;
  state.tab = tab;
  state.hint = '';
  if (tab === 'folders') {
    // 폰: [폴더] 탭은 두 드라이브 나무가 첫 화면. 켜진 드라이브의 맨 위 폴더를 읽어 둔다.
    state.panes[0].pane = 'tree';
    for (const s of onSources()) if (!state.children.has(folderKey(s, null))) loadChildren(s, null);
    paint();
  } else goShelf(tab, state.panes[0]);
}
function activate(key) {
  const r = rowByKey(key);
  if (!r) return;
  if (r.is_folder) goFolder(r.source, r.item_id); else selectRow(key);
}
const paneOfEl = el => { const box = el?.closest?.('[data-fx-pane-i]'); return box && root.contains(box) ? Number(box.dataset.fxPaneI) : -1; };

// 칸을 누르면(또는 칸 안으로 키보드가 들어가면) 그 칸이 지금 칸.
root?.addEventListener('pointerdown', event => { const i = paneOfEl(event.target); if (i >= 0) setCur(i); }, true);
root?.addEventListener('focusin', event => { const i = paneOfEl(event.target); if (i >= 0) setCur(i); });
root?.addEventListener('click', event => {
  const b = event.target.closest('button');
  if (state.dropAsk && !event.target.closest('[data-fx-dropask]')) dropAskClose();
  if (!b || !root.contains(b)) return;
  { const i = paneOfEl(b); if (i >= 0) setCur(i); }
  if (b.matches('[data-fx-row]')) {
    const key = b.dataset.fxRow, p = P();
    if (event.ctrlKey || event.metaKey) { event.preventDefault(); togglePick(key); return; }
    if (event.shiftKey) { event.preventDefault(); rangePick(key); return; }
    if (p.picked.size && PHONE.matches) { togglePick(key); return; }
    if (p.picked.size) unpick();
    p.anchor = key;
    activate(key); return;
  }
  if (b.matches('[data-fx-two]')) { setTwo(!two()); return; }
  if (b.matches('[data-fx-pdrop]')) { const p = P(); p.drop = !p.drop; paintPaneTop(p); inPane(p, '[data-fx-pdrop]')?.focus({preventScroll: true}); return; }
  if (b.matches('[data-fx-send]')) { sendOpp(b.dataset.fxSend === 'move' ? 'move' : 'copy', b); return; }
  if (b.matches('[data-fx-drop-go]')) { dropGo(b.dataset.fxDropGo === 'move' ? 'move' : 'copy', b); return; }
  if (b.matches('[data-fx-drop-x]')) { dropAskClose(); return; }
  if (b.matches('[data-fx-mkdir]')) { makeFolder(b); return; }
  if (b.matches('[data-fx-ask]')) { answer(b.dataset.fxAsk === 'go' ? 'go' : 'skip'); return; }
  if (b.matches('[data-fx-dest-close]')) { closeDest(); return; }
  if (b.matches('[data-fx-dest-pick]')) { pickDest(b.dataset.fxDestPick, b.dataset.fxDestName || ''); return; }
  if (b.matches('[data-fx-dest-twist]')) { toggleDest(b.dataset.fxDestTwist); return; }
  if (b.matches('[data-fx-dest-mkdir]')) { destMkdir(b); return; }
  if (b.matches('[data-fx-dest-go]')) { destGo(); return; }
  if (b.matches('[data-fx-copy]')) { openDest('copy', pickedRows()); return; }
  if (b.matches('[data-fx-jobs-open]')) { openJobs(); return; }
  if (b.matches('[data-fx-jobs-close]')) { closeJobs(); return; }
  if (b.matches('[data-fx-jobs-all]')) { jobsDo(b.dataset.fxJobsAll === 'pause' ? 'job_pause' : 'job_resume'); return; }
  if (b.matches('[data-fx-job-act="reup"]')) { reupload(b.dataset.fxJobId); return; }
  if (b.matches('[data-fx-job-act]')) { jobsDo(b.dataset.fxJobAct === 'pause' ? 'job_pause' : 'job_resume', [b.dataset.fxJobId]); return; }
  if (b.matches('[data-fx-upload]')) { const inp = $('[data-fx-file]'); if (inp && hereDest()) { inp.value = ''; inp.click(); } return; }
  if (b.matches('[data-fx-star]')) { starRows(pickedRows()); return; }
  if (b.matches('[data-fx-star-one]') && state.preview) { starRows([state.preview.row]); return; }
  if (b.matches('[data-fx-cut]')) { openDest('move', pickedRows()); return; }
  if (b.matches('[data-fx-rename]')) { renameRow(pickedRows()[0], b); return; }
  if (b.matches('[data-fx-trash]')) { trashRows(pickedRows(), b); return; }
  if (b.matches('[data-fx-unpick]')) { unpick(); return; }
  if (b.matches('[data-fx-paste]')) { const d = hereDest(); if (state.clip && d) pasteClip(d, b); return; }
  if (b.matches('[data-fx-uncut]')) { uncut(); return; }
  if (b.matches('[data-fx-go]')) { goFolder(b.dataset.fxGo, b.dataset.fxId || null); return; }
  if (b.matches('[data-fx-shelf]')) { goShelf(b.dataset.fxShelf); return; }
  if (b.matches('[data-fx-twist]')) { toggle(b.dataset.fxTwist, b.closest('.nx-tree')); return; }
  if (b.matches('[data-fx-up]')) { goUp(); return; }
  if (b.matches('[data-fx-tab]')) { setTab(b.dataset.fxTab); return; }
  if (b.matches('[data-fx-src]')) { srcClick(b.dataset.fxSrc); return; }
  if (b.matches('[data-fx-sync]')) { sync({force: true}); return; }
  if (b.matches('[data-fx-close]')) { closePreview(); return; }
  if (b.matches('[data-fx-more-pages]')) { const p = state.preview; if (p?.doc) drawPages(p, p.shown + PDF_FIRST_PAGES); return; }
  const p = state.preview;
  if (b.matches('[data-fx-open]') && p) { openCloud(p.row); return; }
  if (b.matches('[data-fx-down]') && p) { download(p.row); return; }
  if (b.matches('[data-fx-share]') && p) { download(p.row, {share: true}); return; }
  if (b.matches('[data-fx-rename-one]') && p) { renameRow(p.row, b); return; }
  // 미리보기 [복사]·[옮기기]: 두 칸이고 반대 칸이 폴더를 열었으면 그리로 바로, 아니면 받을 곳 창.
  if (b.matches('[data-fx-cut-one]') && p) { const d = oppDest(); if (d) { closePreview(); moveRows([p.row], d, b); } else openDest('move', [p.row]); return; }
  if (b.matches('[data-fx-copy-one]') && p) { const d = oppDest(); if (d) { closePreview(); xferRun('copy', [p.row], d); } else openDest('copy', [p.row]); return; }
  if (b.matches('[data-fx-trash-one]') && p) { trashRows([p.row], b); return; }
  if (b.matches('[data-fx-library]')) { requestLibraryDocument(b.dataset.fxLibrary); window.KPTURouter?.go?.('library', {source: 'delegated'}); return; }
  if (b.matches('[data-fx-retry]')) { const q = P(); if (!state.status) enter(true); else if (q.query) refind(q); else loadList(q); }
});
root?.addEventListener('dblclick', event => {
  const b = event.target.closest('[data-fx-row]');
  const r = b && rowByKey(b.dataset.fxRow);
  if (r && !r.is_folder) openCloud(r);
});
root?.addEventListener('input', event => { if (event.target.matches('[data-fx-search]')) setQuery(P(), event.target.value); });
root?.addEventListener('change', event => {
  if (event.target.matches('[data-fx-file]')) { const d = hereDest(), files = [...(event.target.files || [])]; event.target.value = ''; if (d && files.length) uploadFiles(files, d); return; }
  if (event.target.matches('[data-fx-refile]')) { const f = event.target.files?.[0]; event.target.value = ''; refilePicked(f); return; }
  if (!event.target.matches('[data-fx-sort]')) return;
  // 칸 위 줄의 정렬은 그 칸, 위 줄의 정렬은 지금 칸.
  const i = paneOfEl(event.target), p = i >= 0 ? state.panes[i] : P();
  p.sort = validSort(event.target.value); p.dir = p.sort === 'name' ? 'asc' : 'desc'; paintList(p);
});
// 두 칸 키(F5·F6·Tab): 이 화면이 보이고 두 칸일 때, 입력 칸 밖에서만. 포커스가 화면 안이거나 아무 데도 없을 때(body)만 가로챈다(F5 새로고침을 막는 것은 두 칸 동안만).
function twoKey(event) {
  if (!two() || !visible() || event.altKey || event.ctrlKey || event.metaKey) return false;
  const t = event.target;
  if (t?.matches?.('input,select,textarea,[contenteditable="true"]')) return false;
  if (!(t === document.body || t === document.documentElement || root.contains(t))) return false;
  if (state.xfer || state.ask || state.jobsOpen || state.dropAsk) return false;
  if (event.key === 'F5' || event.key === 'F6') {
    event.preventDefault();
    if (!state.busy && !state.run) sendOpp(event.key === 'F6' ? 'move' : 'copy', $('[data-fx-bar]') || root);
    return true;
  }
  // Tab은 목록 줄(또는 아무 데도 없을 때)에서만 칸을 바꾼다 — 위 줄·막대·칸 위 줄 단추 사이의 Tab 이동은 그대로.
  if (event.key === 'Tab' && (t === document.body || t === document.documentElement || t?.matches?.('[data-fx-row]'))) {
    event.preventDefault();
    const next = state.cur ^ 1, q = state.panes[next];
    setCur(next);
    const box = paneEl(q), rows = [...(box?.querySelectorAll('[data-fx-row]') || [])];
    (rows.find(b => b.dataset.fxRow === q.sel) || rows[0] || box?.querySelector('button,select'))?.focus({preventScroll: false});
    return true;
  }
  return false;
}
document.addEventListener('keydown', event => { if (!root.contains(event.target)) twoKey(event); });
// PC 단축키: ↑↓ 고르기 · Enter 열기(폴더는 들어가기) · Backspace 위 폴더 · / 찾기.
root?.addEventListener('keydown', event => {
  if (event.target.matches('input,select,textarea')) {
    if (event.key === 'Escape' && event.target.matches('[data-fx-search]') && event.target.value) { event.target.value = ''; setQuery(P(), ''); }
    return;
  }
  if (twoKey(event)) return;
  const p = P(), rows = [...(paneEl(p)?.querySelectorAll('[data-fx-row]') || [])];
  const mod = event.ctrlKey || event.metaKey, k = String(event.key).toLowerCase();
  if (event.key === 'Escape' && state.dropAsk) { event.preventDefault(); dropAskClose(); return; }
  if (event.key === 'F2') { const list = actRows(); if (list.length === 1) { event.preventDefault(); renameRow(list[0], event.target.closest('button') || root); } return; }
  if (event.key === 'Delete') { const list = actRows(); if (list.length) { event.preventDefault(); trashRows(list, event.target.closest('button') || root); } return; }
  if (mod && k === 'a' && rows.length) { event.preventDefault(); for (const b of rows) p.picked.add(b.dataset.fxRow); paintPicks(p); return; }
  if (mod && k === 'x') { const list = actRows(); if (list.length) { event.preventDefault(); cutRows(list); } return; }
  if (mod && k === 'c') { const list = actRows(); if (list.length) { event.preventDefault(); cutRows(list, 'copy'); } return; }
  if (mod && k === 'v') { const d = hereDest(); if (state.clip && d) { event.preventDefault(); pasteClip(d, root.querySelector('[data-fx-bar]') || root); } return; }
  if (event.key === 'Escape' && state.ask) { event.preventDefault(); answer('skip'); return; }
  if (event.key === 'Escape' && state.xfer) { event.preventDefault(); closeDest(); return; }
  if (event.key === 'Escape' && state.jobsOpen) { event.preventDefault(); closeJobs(); return; }
  if (event.key === 'Escape' && (p.picked.size || state.clip)) { event.preventDefault(); if (state.clip) uncut(); else unpick(); return; }
  if (event.key === 'Escape' && p.drop) { event.preventDefault(); p.drop = false; paintPaneTop(p); return; }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    if (!rows.length) return;
    event.preventDefault();
    const at = rows.findIndex(b => b.dataset.fxRow === p.sel);
    const next = rows[Math.max(0, Math.min(rows.length - 1, at < 0 ? 0 : at + (event.key === 'ArrowDown' ? 1 : -1)))];
    next.focus(); selectRow(next.dataset.fxRow, {show: WIDE.matches && !two()});
  } else if (event.key === 'Enter' && event.target.matches('[data-fx-row]')) {
    event.preventDefault();
    const r = rowByKey(event.target.dataset.fxRow);
    if (r?.is_folder) goFolder(r.source, r.item_id); else if (r) { selectRow(rowKey(r), {show: false}); openCloud(r); }
  } else if (event.key === 'Backspace' && !p.query) { event.preventDefault(); goUp(); }
  else if (event.key === '/') { event.preventDefault(); $('[data-fx-search]')?.focus(); }
});
// 폰: 꾹 누르면 고르기(길게 누르면 브라우저가 contextmenu를 보낸다). PC 오른쪽 단추도 같은 고르기.
root?.addEventListener('contextmenu', event => {
  const b = event.target.closest('[data-fx-row]');
  if (!b || state.busy) return;
  event.preventDefault();
  { const i = paneOfEl(b); if (i >= 0) setCur(i); }
  togglePick(b.dataset.fxRow);
});
// PC: 줄을 폴더(목록의 폴더 줄·나무의 폴더)로 끌어 놓아 옮기기. 끈 줄이 고른 것 안이면 고른 것 모두.
// 두 칸: 반대 칸(그 칸의 지금 폴더 또는 그 칸의 폴더 줄)에 놓으면 '복사 · 옮기기' 작은 고르기.
let drag = null;
root?.addEventListener('dragstart', event => {
  const b = event.target.closest?.('[data-fx-row]');
  if (!b || state.busy) { event.preventDefault?.(); return; }
  { const i = paneOfEl(b); if (i >= 0) setCur(i); }
  const key = b.dataset.fxRow, p = P();
  drag = {pane: state.cur, rows: (p.picked.has(key) ? [...p.picked] : [key]).map(k => rowByKey(k, p)).filter(Boolean)};
  event.dataTransfer?.setData('text/plain', 'files-move');
  if (event.dataTransfer) event.dataTransfer.effectAllowed = two() ? 'copyMove' : 'move';
});
const dropAt = event => {
  if (!drag) return null;
  const i = two() ? paneOfEl(event.target) : -1, cross = i >= 0 && i !== drag.pane;
  const t = event.target.closest?.('[data-fx-drop]') || (cross ? event.target.closest('[data-fx-pane-i]') : null);
  if (!t) return null;
  const dest = t.dataset.fxDrop ? destOf(t.dataset.fxDrop) : paneDest(state.panes[i]);
  if (!dest) return null;
  if (cross) return xferPlan(drag.rows, dest, 'copy').ok.length || moveTargetOk(drag.rows, dest) ? {t, dest, rows: drag.rows, cross} : null;
  return moveTargetOk(drag.rows, dest) ? {t, dest, rows: drag.rows, cross} : null;
};
const dropOff = keep => {
  for (const el of root.querySelectorAll('.fx-drop-on, .fx-drop-up')) if (el !== keep) { el.classList.remove('fx-drop-on', 'fx-drop-pane', 'fx-drop-up'); delete el.dataset.fxUptext; }
};
root?.addEventListener('dragover', event => {
  // 바탕화면 파일(시안 ⑦): 점선 '여기 놓으면 ○○에 올리기'.
  const upHit = upTarget(event);
  if (upHit) {
    dropOff(upHit.t);
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    upHit.t.classList.add('fx-drop-up');
    upHit.t.dataset.fxUptext = upDropText(destNameOf(upHit.dest));
    return;
  }
  const hit = dropAt(event);
  dropOff(hit?.t);
  if (!hit) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = hit.cross ? 'copy' : 'move';
  hit.t.classList.add('fx-drop-on');
  hit.t.classList.toggle('fx-drop-pane', hit.t.matches('[data-fx-pane-i]'));
});
root?.addEventListener('dragleave', event => { if (!event.relatedTarget || !root.contains(event.relatedTarget)) dropOff(null); });
root?.addEventListener('drop', event => {
  const upHit = upTarget(event);
  if (upHit) {
    event.preventDefault();
    dropOff(null);
    const items = [...(event.dataTransfer?.items || [])];
    const dirs = new Set(items.map((it, i) => (it.webkitGetAsEntry?.()?.isDirectory ? i : -1)).filter(i => i >= 0));
    const files = [...(event.dataTransfer?.files || [])].filter((_, i) => !dirs.has(i));
    uploadFiles(files, upHit.dest, {skipDirs: dirs.size});
    return;
  }
  const hit = dropAt(event);
  dropOff(null);
  drag = null;
  if (!hit) return;
  event.preventDefault();
  if (hit.cross) { state.dropAsk = {rows: hit.rows, dest: hit.dest, x: event.clientX, y: event.clientY}; paintDropAsk(); root.querySelector('[data-fx-drop-go]:not([disabled])')?.focus({preventScroll: true}); return; }
  moveRows(hit.rows, hit.dest, hit.t);
});
root?.addEventListener('dragend', () => { drag = null; dropOff(null); });
// 폰: 좌우로 밀어 탭(최근·폴더·별표) 이동. 미리보기가 열려 있거나 입력 칸이면 하지 않는다.
let swipe = null;
root?.addEventListener('touchstart', e => {
  swipe = null;
  if (!PHONE.matches || state.preview || e.touches.length !== 1 || e.target.closest('input,select,.fx-tabs,.fx-prev')) return;
  const p = e.touches[0]; swipe = {x: p.clientX, y: p.clientY, t: Date.now()};
}, {passive: true});
root?.addEventListener('touchend', e => {
  const s = swipe; swipe = null;
  if (!s || !e.changedTouches.length || claimedSince(s.t)) return;
  const p = e.changedTouches[0], dx = p.clientX - s.x, dy = p.clientY - s.y;
  if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 2 || Date.now() - s.t > 800) return;
  const next = tabAt(state.tab, dx < 0 ? 1 : -1);
  if (next) setTab(next);
}, {passive: true});
root?.addEventListener('touchcancel', () => { swipe = null; }, {passive: true});
document.addEventListener('visibilitychange', () => {
  // 올리는 중 화면을 숨기면 그 자리에서 멈춤(H-6), 다시 보이면 쥐고 있던 파일로 남은 조각부터.
  if (document.visibilityState === 'hidden') upStop(); else upShow();
  if (visible()) { sync(); loadJobs(); }
});
window.addEventListener('pagehide', upStop);

// ---------- 들어오기 ----------
async function enter(force = false) {
  resetIfOwnerChanged();
  if (entering && !force) return entering;
  entering = (async () => {
    if (!state.status || force) { paint(); await Promise.all([loadStatus(), phone.hello()]); }
    const place = whereOf(window.KPTURouter?.place?.('files') || {});
    const first = onSources(), a = state.panes[0];
    if (!a.where && first.length) {
      // F9: 폰 첫 화면은 최근 파일. PC·폴드도 같은 첫 화면(최근)이고, 나무에서 클라우드를 고른다.
      const want = place && (place.shelf || first.includes(place.source)) ? place : {shelf: 'recent'};
      if (want.source) state.open.add(folderKey(want.source, null));
      await setWhere(a, want);
    } else if (a.where) await loadList(a, {quiet: true});
    // 두 칸: 오른쪽 칸도 연다(처음이면 왼쪽과 다른 저장소의 맨 위).
    if (two()) {
      const b = state.panes[1];
      if (b.where) await loadList(b, {quiet: true});
      else { const start = otherStart(a.where, first); if (start) await setWhere(b, start, {keepPreview: true}); }
    }
    paint();
    for (const s of first) if (!state.children.has(folderKey(s, null))) loadChildren(s, null);
    startTimer();
    sync();
    loadJobs();
  })().finally(() => { entering = null; });
  return entering;
}
window.addEventListener('kptu:view-changed', event => {
  if (event.detail?.view === 'files') return;
  // 다른 화면으로 가면 미리보기를 놓는다(받은 그림·PDF 메모리도). 맞추기 시계는 멈춘다.
  layer = null; dropPreview(); delete root?.dataset.fxPreview; clearInterval(syncTimer); clearTimeout(jobTimer);
  if (state.jobsOpen) { jobsLayer = null; state.jobsOpen = false; paintJobs(); }
  if (state.xfer) { destLayer = null; dropDest(); }
  dropAskClose();
});
window.addEventListener('kptu:view-prefs-rejected', e => {
  const paths = e.detail?.paths || [];
  if (paths.includes(`${FILES_TWO_KEY}.${DEVICE}`)) { notify('두 칸 켜기/끄기를 저장하지 못했어요. 잠시 뒤 다시 해 주세요.', {error: true, record: false}); if (state.status) layoutChanged(); }
  if (!paths.includes(`${FILES_SOURCES_KEY}.${DEVICE}`)) return;
  notify('출처 켜기/끄기를 저장하지 못했어요. 잠시 뒤 다시 해 주세요.', {error: true, record: false});
  if (state.status) sourcesChanged();
});
// 서버 화면 설정이 늦게 오면(두 칸 켬이 바뀌었을 수 있음) 한 번 맞춘다.
let twoSeen = null;
const twoCheck = () => { const now = two(); if (twoSeen !== null && now !== twoSeen && state.status) layoutChanged(); twoSeen = now; };
window.addEventListener('kptu:view-prefs-ready', () => { if (state.status) twoCheck(); });
PHONE.addEventListener?.('change', () => { if (state.status) { twoCheck(); paint(); } });
WIDE.addEventListener?.('change', () => { if (state.status) { twoCheck(); paint(); } });
window.KPTURouter?.on?.('files', () => { enter(); });
window.KPTUFiles = {refresh: () => enter(true)};
if (window.KPTURouter?.current === 'files') enter();
})();
