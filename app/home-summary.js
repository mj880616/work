// HOME-업무일지홈(2026-10-30 명진 시안 v2 확정): 홈 '잊지 말기' 칩(S53-13 전에는 [하루] 맨 위 한 줄)의 재료와 업데이트 입력줄.
// - S52-20 HOME-잊지말기한목록 ②(요청함 11/07 14:37, 시안 docs/design/mockups/forget-one-list.html, 명진 14:44 '좋은데'):
//   옛 '나한테 온 요청' 상자·'잊지 말기' 상자(asks-box.js·home-family.js)는 지웠다. 홈 [하루] 맨 위는 '잊지 말기' 한 줄 + 빨간 숫자 동그라미
//   (앱 안 읽은 알림처럼, 처리 안 한 수 — 0이면 숫자 없음, '놓친 것' 글자 없음)이고, 누르면 정리함(잊지 말기) 한 목록이 열린다.
//   → S53-13 HOME-잊지말기칩: 그 한 줄을 입력 칸 머리 줄 오른쪽 칩 [잊지 말기 n]으로 옮겼다(아래 forgetChipHtml). 이 파일이 그 자리의 유일한 renderer다.
//   숫자 = 연결 안 된 업데이트(미분류) + 처리 전 후보(텔레그램 요청 포함, 이미 할 일로 만든 제목은 뺌) + 가족 잊지 말기 제안(운영자 기능 family일 때).
//   정리함 한 목록의 처리 전 줄과 같은 기준이다(상대 약속은 세지 않음). 메뉴 '홈' 표시(UI-앱안알림, home-asks.js)도 같은 숫자.
//   '내일 약속 n ›'(UI-앱안알림 A5)은 0이 아닐 때만 칩 뒤 흐린 글자 버튼(원장)으로 남긴다.
// - 업데이트 입력줄: home-quick.js 그대로([업데이트 ▾ | 할 일], 폰은 하단 탭 위 고정). 고르기 시트 목록 읽기(dependencies)만 여기서 준다.
// - 챙길 것 찾기(D7): 이 탭에서 그날 처음 홈을 열 때 서버에 한 번(todo-radar.js autoFindToday).
// 기기 저장 없음. 가족 줄은 세기만 한다(내용을 이 화면에 그리지 않음).
import {readInboxCount, readInboxParts} from './inbox-count.js';
import {readRecordPages} from './basket-link-records.js';
import {mountQuick} from './home-quick.js';
import {autoFindToday} from './todo-radar.js';
import {setHomeAsks} from './home-asks.js';
import {countOpenNews} from './forget-news-data.js';
import {esc as escHtml} from './notice-box.mjs';
import {hasFamily, readNotes} from './family-notes-data.js';
import {openedFromPush} from './family-notes-model.mjs';
import {tomorrowCommitmentsPath, seoulDay} from './ledger-browse-model.mjs';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

// 순수: 숫자들 → '잊지 말기' 한 줄의 처리 안 한 수. 모르는 값(null)은 null(줄 숨김). family는 모르면 0(가족 기능 없음·못 읽음).
// news: 처리 전 소식(FORGET-소식합치기, 명진 '넣어') — 운영자 작업공간만, 모르면 0.
export function forgetCount({update, todo, family = 0, news = 0} = {}) {
  const n = v => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);
  const u = n(update), t = n(todo);
  if (u === null || t === null) return null;
  return u + t + (n(family) || 0) + (n(news) || 0);
}
// HOME-잊지말기칩(S53-13, 요청함 11/08 13:54 '4글자를 위해 한 줄 전체', 시안 docs/design/mockups/home-forget-slim.html 명진 13:55 'A'):
// 홈 [하루] 맨 위 '잊지 말기' 띠 한 줄을 없애고, 입력 칸 머리 줄([업데이트 ▾ | 할 일]) 오른쪽 칩 하나로 — ④ 칩(button.ds-chip) + 톤다운 노랑(forget),
// 처리 안 한 수는 빨간 숫자(0이면 숫자 없이 칩만 흐리게). 누르면 정리함(잊지 말기) 한 목록. 내일 약속이 있으면 칩 뒤에 흐린 '내일 약속 n ›'(원장).
export function forgetChipHtml(count, promises = 0) {
  const label = count > 0 ? `잊지 말기 ${count}건. 열기` : '잊지 말기 열기';
  const badge = count > 0 ? `<span class="nbx-badge" data-nbx-badge>${count > 99 ? '99+' : count}</span>` : '';
  const end = promises > 0 ? `<button type="button" class="row-act home-forget-promises" data-goto="ledger" data-home-summary-promises aria-label="${escHtml(`내일 약속 ${promises}. 원장 열기`)}">내일 약속 ${promises} ›</button>` : '';
  return `<button type="button" class="ds-chip home-forget-chip" data-chip-tone="forget"${count > 0 ? '' : ' data-chip-empty'} data-goto="basket" data-home-forget-open aria-label="${escHtml(label)}"><span>잊지 말기</span>${badge}</button>${end}`;
}
// '내일 약속 n': 원장 약속 중 대기 중·유효(current·needs_check)이고 후속확인일(없으면 끝난 날)이 내일(서울)인 것(폰 알림 '원장 약속 D-1'과 같은 기준,
// docs/design/phone-notifications.md). 홈에 들어올 때 요약 숫자와 함께 한 번 센다. 못 읽으면 0(줄 끝에 붙이지 않음).
export const tomorrowOf = (now = new Date()) => { const d = new Date(Date.parse(seoulDay(now) + 'T00:00:00Z') + 86400000); return d.toISOString().slice(0, 10); };
async function readTomorrowPromises(rt) {
  const ws = rt.context.read()?.workspace?.id;
  if (!ws) return 0;
  try { const rows = await rt.api(tomorrowCommitmentsPath(ws, tomorrowOf())); return Array.isArray(rows) ? rows.length : 0; } catch { return 0; }
}

export function mountHomeSummary({root, rt = window.KPTURuntime, onTasksChanged = () => {}}) {
  if (!root) return null;
  let run = 0, line = null;
  const scope = () => { const c = rt.context.read(); return `${c?.user?.id || ''}:${c?.workspace?.id || ''}`; };
  let pushShown = false;
  // 칩 그리기: 모르는 동안(null — 처음·세션 바뀜·못 읽음)도 칩은 늘 있다(정리함 가는 길, 옛 '전체 보기' 링크 자리). 숫자 없이 흐리게.
  function draw(count, promises = 0) {
    if (!line) return false;
    if (count === null) delete line.dataset.homeForgetCount; else line.dataset.homeForgetCount = String(count);
    line.innerHTML = forgetChipHtml(count === null ? 0 : count, count === null ? 0 : promises);
    return true;
  }
  // count: 처리 안 한 수(null = 모름 → 숫자 없는 흐린 칩). promises: 내일 약속 수(UI-앱안알림 A5).
  function paint(count, promises = 0) {
    // UI-앱안알림 3단계(A4): 같은 숫자로 메뉴 '홈' 표시(home-asks.js). 모르면 표시를 내린다.
    setHomeAsks(count);
    if (!draw(count, promises) || count === null) return;
    // 폰 알림(가족 잊지 말기)을 눌러 연 홈(family=1): 이 줄이 보이게 한 번 옮긴다.
    if (!pushShown && openedFromPush(window.location?.search)) { pushShown = true; line.scrollIntoView?.({block: 'nearest'}); }
  }
  // 가족 잊지 말기 제안 수: 운영자 기능 family(서버 app_my_features)일 때만 읽는다. 못 읽으면 0(줄은 그대로).
  async function familyCount() {
    const ws = rt.context.read()?.workspace?.id;
    if (!ws || !(await hasFamily(rt).catch(() => false))) return 0;
    try { return (await readNotes(rt, ws)).length; } catch { return 0; }
  }
  // early: 들어올 때 미리 시작한 읽기(PERF-첫로딩 요청 합치기, S48-59). 빼야 할 할 일 제목은 할 일을 읽은 뒤에야 알므로 세기만 그 뒤에 한다.
  async function refresh(early = null) {
    const mine = ++run, owner = scope();
    const titles = (window.KPTUGoogleTasks?.peekTasks?.()?.tasks || []).filter(t => t?.status !== 'completed').map(t => t.title);
    const [out, promises, family, news] = await Promise.all([readInboxCount(rt, {taskTitles: titles, parts: early?.parts}), early?.promises || readTomorrowPromises(rt), familyCount(), countOpenNews(rt).catch(() => 0)]);
    if (mine !== run || owner !== scope()) return;
    paint(out?.ok ? forgetCount({update: out.update, todo: out.todo, family, news}) : null, promises);
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
  // 칩 자리: 입력 칸 머리 줄 오른쪽 빈 자리(home-quick.js가 놓기만 함). 이 파일이 그 자리의 유일한 renderer.
  line = root.querySelector('.home-quick[data-home-quick] [data-home-summary]');
  draw(null);
  window.addEventListener('kptu:session-changed', () => { flights.clear(); run++; paint(null); });
  // 정리함(잊지 말기) 한 목록에서 처리하면 숫자를 다시 센다(홈이 보이는 동안만 읽음).
  window.addEventListener('kptu:todo-radar-changed', event => { if (event.detail?.reload && window.KPTURouter?.current === 'home') void refresh(); });
  return {
    // 홈에 들어올 때마다: 숫자 다시 읽기 + 그날 첫 찾기.
    // 옛 홈처럼 들어올 때 Google 할 일 목록을 한 번 읽어 공용 사본(달력 하루 목록·정리함 '이미 할 일' 거르기·요약 숫자)이 최신이 되게 한다.
    //   숫자는 그 뒤 한 번 센다('이미 할 일로 만든 것'을 빼려고). 할 일을 못 읽어도 센다.
    //   PERF-첫로딩 요청 합치기(S48-59): 숫자 재료(정리함·챙길 것·내일 약속) 읽기는 할 일 읽기를 기다리지 않고 바로 시작한다 — 업무일지가 같은 때
    //   정리함을 읽으므로 같은 주소 요청이 한 번만 나간다(runtime single flight). 세기는 전처럼 할 일 읽기 뒤.
    enter() {
      void autoFindToday();
      const parts = readInboxParts(rt), promises = readTomorrowPromises(rt);
      parts.catch(() => {}); // 실패는 refresh가 받는다(그 전에 끝나도 처리되지 않은 실패로 남지 않게)
      void dependencies.google().then(g => g?.listTasks?.({publish: true})).catch(() => {}).finally(() => refresh({parts, promises}));
    },
    refresh,
  };
}
