// DESK-전체현황표(요청함 11/03 07:48) → WEEKLY-메뉴짝짓기 P3(요청함 11/04 16:48·16:53, 설계 docs/design/weekly-menu-pairing.md 3.1): 담당조직 맨 위 작은 소탭 [목록 | 전체 표].
// [전체 표] = '이번 주 조직보고': 내 담당조직 전부를 주간보고 4. 조직보고 표와 같은 표 하나로 — 조직 | 조직현황(S50-7: 같은 부품 weekTableHtml, 묶음 카드·따로 만든 표 없음).
//   조직 순서 = 주간보고(개인본) 순서(weekly-org-order-model.mjs: 그 주 임시저장 바탕의 산하조직 칸 순서, 바탕이 없으면 앱 조직 순서). 쟁의 단계는 조직 이름 밑 작은 글.
// - ORG-기록하나로 O-4(설계 docs/design/record-one.md 2-6~2-9): 칸은 조직보고 '창' 공용 부품 record-window-view.js가 그린다 —
//   지난 3주~앞 2주의 조직 기록 줄 + 그 조직과 연결된 구글 캘린더 일정 줄(작은 '일정'), 조직당 7줄, 넘친 지난 줄은 접기·[넣기],
//   줄 ⋯ [보고용으로 수정]·[보고에서 빼기](다음 주에도 빠짐)·[기록 열기], [+ 쓰기] = 그 조직 기록에 한 줄. 예전 주별 줄·제안 줄은 쓰지 않는다.
// - 표 위 한 줄: 주 고르기(week-pick.js, 월~일) + [복사](보이는 줄). 확정한 주는 개인 확정본 사진 + 흐린 '확정 뒤 추가', 전환 주 앞은 옛 보고(읽기 전용).
// - 쟁의 단계는 org-dispute-stage.js 읽기만 한다. 조직 이름을 누르면 [목록]으로 돌아가 그 조직 상세를 연다.
//   줄 끝 [↗](S50-25 ⑨)도 같은 길로 그 조직 상세를 열고, 줄이 나온 기록(담당조직 기록·연결된 업데이트)을 밝힌다(record-flash.js).
// - 접은 폰·폴드 펼침·PC 모두 [조직 | 조직현황] 두 열 표(ORG-폴드두열표, 시안 docs/design/mockups/org-table-fold-two-cols.html). 쌓기 없음(CSS .oa-table).
//   [조직] 열 폭: 폴드 펼침·PC(화면 600 이상)는 끌어 정한 폭(서버 view_prefs.col_widths.orgall)이 있으면 그 폭, 없으면 가장 긴 조직 이름이 한 줄에 들어가는 폭(아래 fitOrgColumn).
//   접은 폰(600 미만)은 CSS가 좁게(7em) 고정 — 이름은 두 줄로 꺾이고 끌기 손잡이는 감춘다.
// - 고른 소탭([목록|전체 표])은 이번 접속만 기억한다. 브라우저 저장소에 아무것도 두지 않는다.
import {createRecordWindow, thisWeek, windowTableHtml} from './record-window-view.js';
import {fitAll} from './auto-grow.js';
import {readWeekDraft} from './weekly-draft-store.js';
import {reportOrgNames, orderForReport} from './weekly-org-order-model.mjs';
import {weekPickHtml, bindWeekPick} from './week-pick.js';
import {loadDisputeState, peekDisputeState} from './org-dispute-stage.js';
import {stageOfOrg, stageLabel} from './org-dispute-stage-model.mjs';
import {mountColResize, gripHtml} from './col-resize.js';
import {SPLIT_QUERY} from './screen-width.mjs';
import {waitHtml, emptyHtml} from './wait-state.js';
import {flashRecord, orgRecordSelector} from './record-flash.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const TEXT = {failed: '전체 표를 불러오지 못했어요.', copied: '복사했어요.', copyFail: '복사하지 못했어요.'};
let fitBound = false;
let st = null; // {section, tabs, panel, orgs, workspaceId, rt, view, wl(주별 조직보고 부품), msg:{text,error}, names(주간보고 순서 이름들), nameWeek, run}

// suborganizations.js가 목록을 다시 그릴 때마다 부른다(같은 목록이면 다시 읽지 않는다).
export function syncOverview({orgs, workspaceId, rt}) {
  const section = document.querySelector('#soTeamSection');
  if (!section) return;
  if (!st || st.section !== section) {
    st = {section, orgs: [], workspaceId, rt, view: 'list', msg: {text: '', error: false}, loaded: false, wl: null, names: [], nameWeek: ''};
    st.wl = createRecordWindow({rt, workspaceId, week: thisWeek(), repaint: () => paint(), say, openSource: ({org, record}) => { openOrg(org); void flashRecord(orgRecordSelector(record)); }});
    install();
  }
  const same = st.orgs.length === orgs.length && st.orgs.every((o, i) => o.id === orgs[i].id);
  st.orgs = orgs; st.workspaceId = workspaceId; st.rt = rt; st.wl.rt = rt; st.wl.workspaceId = workspaceId;
  section.classList.toggle('so-has-tabs', orgs.length > 0);
  if (st.tabs) st.tabs.hidden = !orgs.length;
  if (st.view === 'table' && (!same || !st.loaded)) void load();
}

function install() {
  const {section} = st;
  if (!section.querySelector('#soTeamTabs')) {
    section.querySelector('#soTeamHead')?.insertAdjacentHTML('afterend',
      '<div id="soTeamTabs" class="so-team-tabs ds-seg" role="tablist" aria-label="조직 보고 보기"><button type="button" role="tab" class="so-team-tab ds-seg-btn" data-so-view="list" aria-selected="true" tabindex="0">목록</button><button type="button" role="tab" class="so-team-tab ds-seg-btn" data-so-view="table" aria-selected="false" tabindex="-1">전체 표</button></div>');
  }
  if (!section.querySelector('#soOverview')) section.insertAdjacentHTML('beforeend', '<section id="soOverview" class="oa wd-st" aria-label="조직 보고 이번 주 보고" hidden></section>');
  // PC 좌우 격자에서 소탭 줄이 맨 위 한 줄을 갖고 목록·상세 칸은 그 아래 같은 줄에 머문다(suborganizations.css .so-has-tabs).
  section.classList.add('so-has-tabs');
  st.tabs = section.querySelector('#soTeamTabs');
  st.panel = section.querySelector('#soOverview');
  st.tabs.addEventListener('click', e => { const b = e.target.closest?.('[data-so-view]'); if (b) setView(b.dataset.soView, {focus: false}); });
  st.tabs.addEventListener('keydown', e => {
    const b = e.target.closest?.('[data-so-view]'); if (!b) return;
    let next = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') next = b.dataset.soView === 'list' ? 'table' : 'list';
    else if (e.key === 'Home') next = 'list'; else if (e.key === 'End') next = 'table';
    if (!next) return;
    e.preventDefault(); setView(next, {focus: true});
  });
  st.wl.bind(st.panel);
  bindWeekPick(st.panel, () => st.wl.week, week => { if (!st.wl.disabled()) { say(''); st.wl.setWeek(week); } });
  st.panel.addEventListener('click', e => {
    const b = e.target.closest?.('button'); if (!b || !st || b.disabled) return;
    if ('oaRetry' in b.dataset) void load();
    else if (b.dataset.oaOpen) openOrg(b.dataset.oaOpen);
    else if ('oaCopy' in b.dataset) void copy();
  });
  window.addEventListener('kptu:dispute-stages-changed', () => { if (st?.view === 'table') paint(); });
  // [조직] 열 맞춤 폭은 표 폭(45% 상한)·글꼴에 기대므로 화면 폭이 바뀌거나(폴드 펼침·접음, 창 크기) 글꼴이 늦게 오면 다시 잰다.
  if (!fitBound) { fitBound = true; window.addEventListener('resize', () => { if (st?.view === 'table') fitOrgColumn(); }); document.fonts?.ready?.then(() => { if (st?.view === 'table') fitOrgColumn(); }).catch(() => {}); }
}

function setView(view, {focus = false} = {}) {
  if (!st) return;
  st.view = view === 'table' ? 'table' : 'list';
  const table = st.view === 'table';
  st.section.classList.toggle('so-view-table', table);
  st.panel.hidden = !table;
  st.tabs.querySelectorAll('[data-so-view]').forEach(b => { const on = b.dataset.soView === st.view; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; if (on && focus) b.focus({preventScroll: true}); });
  if (table) { fitOrgColumn(); void load(); }
}

async function load() {
  if (!st) return;
  st.loaded = true; st.nameWeek = '';
  void loadDisputeState({rt: st.rt, workspaceId: st.workspaceId}).then(() => { if (st?.view === 'table') paint(); }).catch(() => {});
  await st.wl.load(st.orgs, {quiet: st.wl.status === 'ready'});
}

function stageText(orgId) {
  const state = peekDisputeState();
  if (!state || state.status !== 'ready') return '';
  const cur = stageOfOrg(orgId, state.histories, state.stages);
  return stageLabel(cur) || '';
}
// 주간보고(개인본) 순서: 그 주 임시저장 바탕의 산하조직 칸 순서. 읽지 못하거나 바탕이 없으면 앱 조직 순서(이름이 안 맞는 조직도 뒤에 앱 순서).
function orderedOrgs() {
  const order = window.KPTUOrganizationOrder;
  return orderForReport(st.orgs, st.names, order ? list => order.sort(list) : list => list);
}
function loadNames(week) {
  if (!st || st.nameWeek === week) return;
  st.nameWeek = week;
  const run = st.rt, ws = st.workspaceId;
  void readWeekDraft(week, st.rt).then(r => { if (st && st.nameWeek === week && st.rt === run && st.workspaceId === ws) { st.names = r.missing ? [] : reportOrgNames(r.row?.draft); paint(); } })
    .catch(() => { if (st && st.nameWeek === week) { st.names = []; paint(); } });
}
function paint() {
  if (!st || !st.panel) return;
  const {panel, wl} = st;
  if (wl.status === 'loading' || wl.status === 'idle') { put(waitHtml({rows: 4})); return; }
  if (wl.status === 'error') { put(`<p class="wd-st-note" role="alert">${TEXT.failed} <button type="button" class="wd-st-btn" data-oa-retry>다시 시도</button></p>`); return; }
  if (!st.orgs.length) { put(emptyHtml()); return; }
  if (wl.status === 'ready') loadNames(wl.week);
  const dis = wl.disabled();
  const bar = `<div class="oa-bar btn-row">${weekPickHtml(wl.week, {disabled: dis})}<button type="button" class="wd-st-btn" data-oa-copy>복사</button><span class="wl-tools">${wl.orderMenuHtml()}</span></div>`;
  const table = windowTableHtml(wl, orderedOrgs(), {
    msg: st.msg.text, error: st.msg.error, tableClass: 'oa-table', orderMenu: false, headRows: `${wl.week === thisWeek() ? '이번 주' : '그 주'} 조직보고`,
    headOrg: `조직${gripHtml('org', '조직', 1)}`,
    orgHtml: o => `<button type="button" class="oa-name" data-oa-open="${esc(o.id)}">${esc(o.name)}</button>`,
    stageOf: o => stageText(o.id)});
  put(`${bar}${table}`);
  mountColResize({host: panel, name: 'orgall', vars: {org: '--oa-w-org'}, dir: 1, labels: {org: '조직'}, fit: () => nameWidth(panel)});
  fitOrgColumn();
}
// ORG-폴드두열표: 줄바꿈 없이 늘어놓은 가장 긴 조직 이름의 글 폭(px). 이름을 잠깐 한 줄로 두고 잰다 — 지금 칸이 좁아 꺾여 있어도 본래 길이가 나오게.
function nameWidth(panel) {
  const names = [...panel.querySelectorAll('.oa-name')], was = names.map(el => el.style.whiteSpace);
  names.forEach(el => { el.style.whiteSpace = 'nowrap'; });
  const widths = names.map(el => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect().width; });
  names.forEach((el, i) => { el.style.whiteSpace = was[i]; });
  return Math.ceil(Math.max(0, ...widths));
}
// [조직] 열 기본 폭(폴드 펼침·PC) = 가장 긴 조직 이름 한 줄 + 칸 안쪽 여백·선. 표 폭의 45%까지(넘는 이름은 칸 안에서 꺾임). 끌어 정한 폭(--oa-w-org)은 CSS가 이 값보다 먼저 쓴다.
// 접은 폰(600 미만)은 CSS가 7em으로 고정하므로 맞추지 않는다. 표가 감춰진 동안(목록 보기)은 폭이 0이라 건너뛰고, 보일 때(setView) 다시 맞춘다.
function fitOrgColumn() {
  const panel = st?.panel, table = panel?.querySelector('table.oa-table'), head = table?.querySelector('thead th.wl-c-org');
  if (!panel || !table || !head || !window.matchMedia(SPLIT_QUERY).matches) { panel?.style.removeProperty('--oa-w-org-fit'); return; }
  const tableWidth = table.getBoundingClientRect().width;
  if (!tableWidth) return;
  const css = getComputedStyle(head), pad = (parseFloat(css.paddingLeft) || 0) + (parseFloat(css.paddingRight) || 0);
  const want = nameWidth(panel);
  if (want > 0) panel.style.setProperty('--oa-w-org-fit', `${Math.round(Math.min(want + pad + 2, tableWidth * 0.45))}px`);
  else panel.style.removeProperty('--oa-w-org-fit');
}
// 표를 그리는 곳은 paint() 하나다. 쟁의 단계·주간보고 순서·줄 읽기가 따로따로 끝나며 paint()를 부르므로,
// 그린 결과가 지금 화면과 같으면 DOM을 갈지 않는다 — 누르려던 단추·입력 중인 칸이 같은 내용으로 바뀌어 사라지지 않게(S51-19).
function put(html) {
  if (st.painted === html && st.panel.childElementCount) return;
  st.painted = html;
  // 쟁의 단계·주간보고 순서·일정이 따로 와서 다시 그려도 쓰던 칸 초점과 커서는 그대로(글은 부품의 draft에 있음).
  const f = document.activeElement, field = f?.matches?.('[data-rw-field]') && st.panel.contains(f) ? f.dataset.rwField : '';
  const caret = field && typeof f.selectionStart === 'number' ? [f.selectionStart, f.selectionEnd] : null;
  st.panel.innerHTML = html;
  st.wl.afterPaint(); // ⋯ 자리표를 공용 줄 메뉴(row-more.js)로
  if (field) { const el = st.panel.querySelector(`[data-rw-field="${field}"]`); if (el) { el.focus({preventScroll: true}); if (caret) try { el.setSelectionRange(...caret); } catch { /* 날짜 칸은 커서 없음 */ } } }
  fitAll(st.panel); // UI-줄입력늘어나기: 다시 그린 줄 고치기 칸도 글 전체가 보이게
}
function say(text, error = false) { if (!st) return; st.msg = {text, error}; const el = st.panel?.querySelector('[data-wl-status]'); if (el) { el.textContent = text; el.classList.toggle('is-error', error); } }

function openOrg(orgId) {
  setView('list');
  const row = st.section.querySelector(`#soOrganizationList [data-so-org="${CSS.escape(orgId)}"]`);
  row?.click();
}
// [복사]: 그 주 보이는 줄(접힌 줄·뺀 줄 빼고, 보고용 글 반영 — 사진 주는 사진 줄).
async function copy() {
  const lines = [];
  for (const o of orderedOrgs()) {
    const stage = stageText(o.id);
    lines.push(`○ ${o.name}${stage ? ` (${stage})` : ''}`);
    lines.push(...st.wl.lineTexts(o.id));
  }
  try { await navigator.clipboard.writeText(lines.join('\n')); say(TEXT.copied); } catch { say(TEXT.copyFail, true); }
}
