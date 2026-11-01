// HOME-업무일지홈(2026-10-30 명진 시안 v2 확정): 홈 날짜 줄 아래 요약 한 줄과 업데이트 입력줄.
// - 요약 한 줄: '나한테 온 요청 n · 챙길 것 n · 정리 안 된 것 n ›'. 누르면 정리함. 내일 약속이 있으면 끝에 ' · 내일 약속 n ›'(누르면 원장, UI-앱안알림 A5). '나한테 온 요청'만 노란 주목 글씨(1건 이상일 때),
//   나머지는 흐린 글씨. 숫자는 정리함 숫자와 같은 한 곳(inbox-count.js readInboxCount)에서 센다:
//   나한테 온 요청 = 텔레그램 ask_me 후보(asks), 챙길 것 = 처리 전 후보 중 나머지(todo - asks), 정리 안 된 것 = 업데이트 미분류(update).
//   못 읽으면 줄을 숨긴다. 옛 폰 홈 요약('새 소식 n')과 놓친 약속·정리 안 된 것·내일 칸(home-fill.js)은 이 줄로 바꾸고 지웠다.
// - 업데이트 입력줄: home-quick.js 그대로([업데이트 ▾ | 할 일], 폰은 하단 탭 위 고정). 고르기 시트 목록 읽기(dependencies)만 여기서 준다.
// - 챙길 것 찾기(D7): 이 탭에서 그날 처음 홈을 열 때 서버에 한 번(todo-radar.js autoFindToday).
// 이 파일이 요약 줄의 유일한 renderer다. 기기 저장 없음.
import {readInboxCount} from './inbox-count.js';
import {readRecordPages} from './basket-link-records.js';
import {mountQuick} from './home-quick.js';
import {autoFindToday} from './todo-radar.js';
import {setHomeAsks} from './home-asks.js';
import {tomorrowCommitmentsPath, seoulDay} from './ledger-browse-model.mjs';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

// 순수: 세 숫자 → 줄 조각. 모르는 값(null)은 null(줄 숨김).
export function summaryParts({update, todo, asks} = {}) {
  const n = v => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);
  const u = n(update), t = n(todo), a = n(asks);
  if (u === null || t === null) return null;
  const ask = a || 0;
  return {asks: ask, todos: Math.max(0, t - ask), unsorted: u};
}
// '내일 약속 n': 원장 약속 중 대기 중·유효(current·needs_check)이고 후속확인일(없으면 끝난 날)이 내일(서울)인 것(폰 알림 '원장 약속 D-1'과 같은 기준,
// docs/design/phone-notifications.md). 홈에 들어올 때 요약 숫자와 함께 한 번 센다. 못 읽으면 0(줄 끝에 붙이지 않음).
export const tomorrowOf = (now = new Date()) => { const d = new Date(Date.parse(seoulDay(now) + 'T00:00:00Z') + 86400000); return d.toISOString().slice(0, 10); };
async function readTomorrowPromises(rt) {
  const ws = rt.context.read()?.workspace?.id;
  if (!ws) return 0;
  try { const rows = await rt.api(tomorrowCommitmentsPath(ws, tomorrowOf())); return Array.isArray(rows) ? rows.length : 0; } catch { return 0; }
}

export function mountHomeSummary({root, line, rt = window.KPTURuntime, onTasksChanged = () => {}}) {
  if (!root || !line) return null;
  let run = 0;
  const scope = () => { const c = rt.context.read(); return `${c?.user?.id || ''}:${c?.workspace?.id || ''}`; };
  // promises: 내일 약속 수(UI-앱안알림 A5). 0이면 줄 끝에 붙이지 않는다.
  function paint(parts, promises = 0) {
    // UI-앱안알림 3단계(A4): 같은 숫자로 메뉴 '홈' 표시(home-asks.js). 모르면 표시를 내린다.
    setHomeAsks(parts ? parts.asks : null);
    if (!parts) { line.hidden = true; line.replaceChildren(); return; }
    line.hidden = false;
    const label = `나한테 온 요청 ${parts.asks}, 챙길 것 ${parts.todos}, 정리 안 된 것 ${parts.unsorted}. 정리함 열기`;
    line.innerHTML = `<button type="button" class="home-summary-open" data-goto="basket" aria-label="${esc(label)}">`
      + `<span class="home-summary-ask${parts.asks ? ' is-on' : ''}" data-home-summary-asks>나한테 온 요청 ${parts.asks}</span>`
      + `<span class="home-summary-rest"> · 챙길 것 <span data-home-summary-todos>${parts.todos}</span> · 정리 안 된 것 <span data-home-summary-unsorted>${parts.unsorted}</span> ›</span></button>`
      + (promises > 0 ? `<span class="home-summary-sep" aria-hidden="true"> · </span><button type="button" class="home-summary-open home-summary-promise" data-goto="ledger" data-home-summary-promises aria-label="${esc(`내일 약속 ${promises}. 원장 열기`)}">내일 약속 ${promises} ›</button>` : '');
  }
  async function refresh() {
    const mine = ++run, owner = scope();
    const titles = (window.KPTUGoogleTasks?.peekTasks?.()?.tasks || []).filter(t => t?.status !== 'completed').map(t => t.title);
    const [out, promises] = await Promise.all([readInboxCount(rt, {taskTitles: titles}), readTomorrowPromises(rt)]);
    if (mine !== run || owner !== scope()) return;
    paint(out?.ok ? summaryParts(out) : null, promises);
  }
  // 고르기 시트([업데이트 ▾]·[할 일]의 사업영역)가 쓰는 목록. 정리함·쓰기 창과 같은 읽기(update-places.js readPlaces).
  const flights = new Map();
  const share = (key, read) => { if (!flights.has(key)) flights.set(key, Promise.resolve().then(read).catch(e => { flights.delete(key); throw e; })); return flights.get(key); };
  const ctx = () => rt.context.read() || {};
  const dependencies = {
    projects: () => share('projects', async () => {
      await import('./project-catalog.js');
      return (await window.KPTUProjectCatalog.load({workspaceId: ctx().workspace?.id, userId: ctx().user?.id})).projects;
    }),
    orgs: () => share('orgs', () => readRecordPages(`/rest/v1/app_suborganizations?workspace_id=eq.${encodeURIComponent(ctx().workspace?.id || '')}&active=eq.true&select=id,name,active&order=id.asc`, rt)),
    assignments: () => share('assignments', () => readRecordPages(`/rest/v1/app_suborganization_assignees?user_id=eq.${encodeURIComponent(ctx().user?.id || '')}&select=organization_id&order=organization_id.asc`, rt)),
    google: () => share('google', async () => { await Promise.all([import('./organization-order.js'), import('./google-tasks.js')]); return window.KPTUGoogleTasks; }),
  };
  // 옛 홈처럼 할 일 모듈을 처음부터 불러 둔다(할 일 줄 바로 처리·고치기 창·할 일 화면이 같은 KPTUGoogleTasks를 씀).
  void dependencies.google().catch(() => {});
  mountQuick({root, dependencies, refreshTasks: () => onTasksChanged(), invalidateProjects: () => flights.delete('projects'), esc, view: 'home', idPrefix: 'home', onSaved: () => void refresh()});
  window.addEventListener('kptu:session-changed', () => { flights.clear(); run++; paint(null); });
  window.addEventListener('kptu:todo-radar-changed', event => { if (event.detail?.reload && window.KPTURouter?.current === 'home') void refresh(); });
  return {
    // 홈에 들어올 때마다: 숫자 다시 읽기 + 그날 첫 찾기.
    // 옛 홈처럼 들어올 때 Google 할 일 목록을 한 번 읽어 공용 사본(달력 하루 목록·정리함 '이미 할 일' 거르기·요약 숫자)이 최신이 되게 한다.
    //   숫자는 그 뒤 한 번 센다('이미 할 일로 만든 것'을 빼려고). 할 일을 못 읽어도 센다.
    enter() { void autoFindToday(); void dependencies.google().then(g => g?.listTasks?.({publish: true})).catch(() => {}).finally(() => refresh()); },
    refresh,
  };
}
