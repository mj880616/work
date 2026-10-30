import {waitHtml, emptyHtml} from './wait-state.js';
import { readRecordPages } from './basket-link-records.js';
import { mountQuick } from './home-quick.js';
import { mountRadar } from './todo-radar.js';
import { mountHomeFill } from './home-fill.js';
import { limitRows } from './home-fill-model.mjs';
import { mountCollectionStatus } from './collection-status.js';
import { mountTextBackfillNotice } from './text-backfill-notice.js';
import { mountAiUsageLine } from './ai-usage-line.js';
import { createHomeCache } from './home-read-cache.js';
import { viewPrefs } from './view-prefs.js';
import { normalizeCards, placement, cardOf } from './home-cards-model.mjs';
import { createExtraCard } from './home-extra.js';
import { mountHomeEdit } from './home-edit.js';
import { paintFreshness } from './data-freshness.js';
import { createTaskInline, moreButtonHtml } from './task-inline.js';
import { openGoogleEvent, openGoogleEventMenu, eventAttrs, bindLineHold } from './event-open.js';
import {
  ranges,
  dayKey,
  milestoneChips,
  todayEvents,
  dueTasks,
  meetingTasks,
  homeEventRows,
} from "./home-read-model.js";
const rt = window.KPTURuntime,
  root = document.querySelector("#homeView"),
  esc = (v) =>
    String(v ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
let epoch = 0,
  flights = new Map(),
  tasks = [],
  links = [],
  projects = [],
  orgs = [],
  meetings = [],
  google = null,
  taskStatus = "loading",
  linksReady = false,
  tasksReady = false,
  meetingsReady = false,
  unsubscribe = null,
  homeOwner = "",
  homeWorkspace = "",
  freshTaskRead = false,
  activeStart = null,
  taskFlight = null,
  tasksDirty = false,
  copies = {},
  // CAL-저장본먼저: which cards still show this device's copy (fresh read not answered yet) and when that copy was saved.
  fromCopy = {},
  copyAt = {},
  calendarState = null,
  imports = null,
  radarMount = null,
  quietMount = null,
  quietEpoch = 0,
  fillMount = null,
  tasksOpen = false,
  collectMount = null,
  textDoneMount = null,
  els = new Map(),
  extras = new Map(),
  collectLines = null,
  aiLine = null,
  aiMount = null,
  editMount = null;
const metrics = {
  shellAt:
    window.__KPTU_STARTUP__?.marks.requestedShellVisible || performance.now(),
  readyAt: 0,
  cards: {},
  firstPaint: {},
  refreshed: {},
  requests: {},
};
const owner = () => rt.context.read()?.user?.id,
  workspace = () => rt.context.read()?.workspace?.id;
// 2026-10-06 커맨드센터 승인: one display-only owner cache; runtime owns cleanup.
let homeCache;
try { homeCache = createHomeCache({storage:window.localStorage,keyPrefix:rt.ownerCache.prefix+'home-read-v1:',context:()=>({owner:owner(),workspaceId:workspace()})}); } catch {}
function saveCopy(key,value){homeCache?.save(key,value);copies=homeCache?.read()||copies;}
function preload(){
  if(!imports)imports={
    projects:import('./project-catalog.js'),
    order:import('./organization-order.js'),
    google:import('./google-tasks.js'),
  };
  Object.values(imports).forEach(p=>p.catch(()=>{}));
  return imports;
}
const share = (key, read) => {
  const map = flights;
  if (!map.has(key))
    map.set(
      key,
      Promise.resolve()
        .then(read)
        .catch((e) => {
          map.delete(key);
          throw e;
        }),
    );
  return map.get(key);
};
function request(key){metrics.requests[key]=(metrics.requests[key]||0)+1;timing();}
const api = (path) => {
    const key=path.includes('google-calendar')?(path.includes('action=status')?'calendar':'events'):path.includes('app_project_milestones')?'milestones':path.includes('app_suborganization_assignees')?'assignments':path.includes('app_suborganizations')?'orgs':'meetings';
    request(key);return rt.api(path);
  },
  list = (ids) => "in.(" + ids.map(encodeURIComponent).join(",") + ")";
const cards = {
  dday: ["주요 일정", ""],
  calendar: ["오늘 일정", "calendar", "달력"],
  tasks: ["오늘 할 일", "tasks", "할 일"],
  meetings: ["사업 보고 후속", "meetings", "사업 보고"],
};
const desktopHome = window.matchMedia('(min-width:1024px)');
// MENU-HOME-편집: 홈에 보이는 칸과 순서는 서버(view_prefs.home_cards, 없으면 기본 순서)가 정한다. 폰·중간 폭은 한 칸에 위에서 아래로,
// PC는 왼쪽(main)·오른쪽(aside) 칸별로 같은 순서(home-cards-model.mjs placement). 이 함수가 홈 칸 자리의 유일한 주인이다.
const homeCards = () => normalizeCards(viewPrefs.get('home_cards'));
function extraCard(id) {
  if (!extras.has(id)) {
    const made = createExtraCard(id);
    if (!made) return null;
    extras.set(id, made); els.set(id, made.el);
    made.refresh();
  }
  return extras.get(id).el;
}
function placeCards() {
  const left = root.querySelector('[data-home-column="main"]'),
    right = root.querySelector('[data-home-column="aside"]');
  if (!left || !right || !els.size) return;
  const phone = !desktopHome.matches,
    plan = placement(homeCards(), phone),
    want = { main: [], aside: [] };
  for (const column of ['main', 'aside']) for (const id of plan[column]) {
    const el = cardOf(id)?.extra ? extraCard(id) : els.get(id);
    if (el) want[column].push(el);
  }
  const mine = new Set(els.values());
  const same = (box, list) => { const now = [...box.children].filter(el => mine.has(el)); return now.length === list.length && now.every((el, i) => el === list[i]); };
  const collectOn = plan.main.includes('collect') || plan.aside.includes('collect');
  // 마지막 수집 시각의 폰용 경고 줄·정상 줄은 그 칸과 같이 홈에 놓이거나 빠진다.
  const lines = collectLines && ((collectLines.alert.isConnected && collectLines.ok.isConnected) === collectOn);
  // AI-사용량줄: 'AI 사용량' 줄은 수집 칸 바로 아래(PC: 마지막 수집 시각 칸 아래, 폰: '수집 정상 ✓' 줄 자리 아래). 수집 칸을 빼면 같이 빠진다.
  const aiAnchor = !aiLine || !collectOn ? null : phone ? collectLines?.ok : els.get('collect');
  const aiPlaced = !aiLine || (aiAnchor ? aiAnchor.nextElementSibling === aiLine : !aiLine.isConnected);
  if (same(left, want.main) && same(right, want.aside) && (lines ?? true) && aiPlaced) { editMount?.dock?.(); return; }
  const focused = [...mine].find(el => el.contains(document.activeElement)) ? document.activeElement : null;
  for (const el of mine) if (!want.main.includes(el) && !want.aside.includes(el)) el.remove();
  want.main.forEach(el => left.append(el));
  want.aside.forEach(el => right.append(el));
  if (collectLines) {
    if (collectOn) { if (!collectLines.alert.isConnected) left.insertBefore(collectLines.alert, left.querySelector('[data-home-text-done]')); if (!collectLines.ok.isConnected) right.after(collectLines.ok); }
    else { collectLines.alert.remove(); collectLines.ok.remove(); }
  }
  if (aiLine) { const anchor = !collectOn ? null : phone ? collectLines?.ok : els.get('collect'); if (!anchor) aiLine.remove(); else if (anchor.nextElementSibling !== aiLine) anchor.after(aiLine); }
  editMount?.dock?.();
  focused?.focus({ preventScroll: true });
}
window.addEventListener('kptu:home-cards-changed', placeCards);
window.addEventListener('kptu:view-prefs-rejected', event => { if (event.detail?.paths?.includes('home_cards')) { placeCards(); editMount?.rejected(); } if (event.detail?.paths?.includes('quiet_weeks')) editMount?.weeksRejected?.(); });
// HOME-모바일정리②는 폰·중간 폭(한 칸 홈)에서만 겹친 회의 후속을 합친다. PC(오른쪽 칸 있는 홈)는 그대로.
const mergeFollowUps = () => !desktopHome.matches;
desktopHome.addEventListener('change', () => { placeCards(); renderTasks(); });
function shell() {
  const host = root.querySelector('[data-home-cards]'),
    quick = root.querySelector('[data-home-quick],.home-quick-placeholder'),
    focused = quick?.contains(document.activeElement) ? document.activeElement : null;
  const section = key => {
    const [title, view, label] = cards[key];
    return `<section class="home-card" data-home-card="${key}" aria-labelledby="home-${key}-title"><header><h3 id="home-${key}-title">${title} <small data-home-count></small></h3>${view ? `<button type="button" data-goto="${view}">${label} ›</button>` : ""}</header>${key==='calendar'||key==='tasks'?'<div class="data-freshness" data-home-fresh role="status" aria-live="polite" hidden></div>':''}<div data-home-body>${waitHtml({rows:3})}</div></section>`;
  };
  // JOURNAL-챙길것: 챙길 것 sits below 주요 일정. todo-radar.js is the only renderer inside that card; it stays hidden until
  // the candidate table and the server function answer (not deployed yet = hidden).
  // HOME-수집경보: 폰·중간 폭의 경고 한 줄(본문 맨 위)과 '수집 정상 ✓' 한 줄(맨 아래)도 collection-status.js가 그린다.
  host.innerHTML = `<div data-home-column="main"><div class="home-collect-alert" data-home-collect-alert hidden></div><p class="home-text-done" data-home-text-done role="status" hidden></p></div><div data-home-column="aside"></div><p class="home-collect-ok" data-home-collect-ok role="status" hidden></p>`;
  els = new Map(); extras.forEach(made => made.destroy()); extras = new Map();
  const made = document.createElement('template');
  made.innerHTML = ['calendar','tasks','meetings','dday'].map(section).join('') + `<section class="home-card home-quiet" data-home-card="quiet" aria-labelledby="home-quiet-title" hidden></section><section class="home-card home-radar" data-home-card="radar" hidden></section><section class="home-card home-collect" data-home-card="collect" aria-labelledby="home-collect-title" hidden></section>`;
  [...made.content.children].filter(el => el.dataset.homeCard).forEach(el => els.set(el.dataset.homeCard, el));
  collectLines = { alert: host.querySelector('[data-home-collect-alert]'), ok: host.querySelector('[data-home-collect-ok]') };
  host.querySelector('[data-home-column="main"]').prepend(quick);
  // HOME-모바일홈채우기: 한 줄 요약과 놓친 약속·정리 안 된 것·내일 칸(폰·중간 폭만). home-fill.js가 유일한 renderer.
  fillMount?.destroy();
  fillMount = mountHomeFill({ main: host.querySelector('[data-home-column="main"]') });
  for (const [id, el] of Object.entries(fillMount?.cards || {})) els.set(id, el);
  focused?.focus({ preventScroll: true });
  radarMount?.destroy();
  radarMount = mountRadar(card('radar'), { place: 'home' });
  radarMount?.refresh();
  // FEAT-1029묶음 ③: 연락 없는 조직 한 줄. org-quiet.js가 유일한 renderer이고, 조용한 조직이 없거나 판단할 수 없으면 숨어 있다.
  // 홈 첫 화면을 무겁게 하지 않도록 나중에 불러온다.
  quietMount?.destroy(); quietMount = null;
  const quietEl = card('quiet'), quietRun = ++quietEpoch;
  void import('./org-quiet.js').then(({ mountOrgQuiet }) => {
    if (quietRun !== quietEpoch) return;
    quietMount = mountOrgQuiet(quietEl);
    quietMount?.refresh();
  }).catch(error => console.warn('org quiet load', error?.message || error));
  // OPS-수집점검: 마지막 수집 시각. collection-status.js is the only renderer; hidden until something can be checked.
  collectMount?.destroy();
  collectMount = mountCollectionStatus(card('collect'), { alert: host.querySelector('[data-home-collect-alert]'), okLine: host.querySelector('[data-home-collect-ok]') });
  collectMount?.refresh();
  // LIB-글자채우기야간: '예전 자료 글자 읽기 끝남 (N개)' 한 줄. text-backfill-notice.js is the only renderer; same status answer as above.
  // AI-사용량줄: ai-usage-line.js가 이 줄의 유일한 renderer. 함수 배포 전·표 없음이면 숨어 있다.
  aiMount?.destroy();
  aiLine = document.createElement('section');
  aiLine.className = 'home-ai-usage';
  aiLine.dataset.homeAiUsage = '';
  aiLine.setAttribute('aria-label', 'AI 사용량');
  aiMount = mountAiUsageLine(aiLine, { onPaint: () => editMount?.dock?.() });
  aiMount?.refresh();
  textDoneMount?.destroy();
  textDoneMount = mountTextBackfillNotice(host.querySelector('[data-home-text-done]'));
  textDoneMount?.refresh();
  placeCards();
  editMount?.destroy();
  editMount = mountHomeEdit({ root });
  root.querySelector('[data-home-timing]')?.remove();
  if(new URLSearchParams(location.search).get('homeTiming')==='1'){
    const p=document.createElement('p');p.className='home-timing';p.dataset.homeTiming='';root.append(p);
  }
}
const requestKeys={dday:['projects','milestones'],calendar:['calendar','events'],tasks:['tasks','links'],meetings:['tasks','links','meetings']};
function timing(){
  const p=root.querySelector('[data-home-timing]');if(!p)return;
  p.textContent=Object.entries(cards).map(([key,[label]])=>`${label}: 표시 ${metrics.firstPaint[key]??'…'}ms · 최신 ${metrics.refreshed[key]??'…'}ms · 요청 ${requestKeys[key].reduce((n,k)=>n+(metrics.requests[k]||0),0)}회`).join(' / ')+` / 전체 요청 ${Object.values(metrics.requests).reduce((a,b)=>a+b,0)}회`;
}
// MENU-HOME-편집: 칸 요소는 shell()이 한 번 모두 만들어 두고(els), 홈에 놓이는 것만 placeCards()가 붙인다. 뺀 칸은 화면에서만 빠지고 읽기·그리기는 그대로다.
const card = (key) => els.get(key) || null;
function paint(key, html, count = null) {
  const c = card(key);
  if (!c) return;
  const active = c.contains(document.activeElement) ? document.activeElement : null,
    focused = active?.dataset.homeToggle ? `toggle:${active.dataset.homeToggle}` : active?.dataset.homeEdit ? `edit:${active.dataset.homeEdit}` : active?.dataset.homeTaskMenu ? `menu:${active.dataset.homeTaskMenu}` : null;
  c.hidden = false;
  c.querySelector("[data-home-body]").innerHTML = html;
  c.querySelector("[data-home-count]").textContent =
    count === null ? "" : count;
  c.dataset.state = "ready";
  metrics.cards[key] = performance.now();
  metrics.firstPaint[key] ??= Math.round(performance.now()-metrics.shellAt);
  timing();
  if (focused)
    c.querySelector(
      focused.startsWith("edit:")
        ? `[data-home-edit="${CSS.escape(focused.slice(5))}"]`
        : focused.startsWith("menu:")
          ? `[data-home-task-menu="${CSS.escape(focused.slice(5))}"]`
          : `[data-home-toggle="${CSS.escape(focused.slice(7))}"]`,
    )?.focus({ preventScroll: true });
}
function empty(key, hide = false) {
  paint(key, emptyHtml(), 0);
  const c = card(key);
  if (!c) return;
  c.hidden = hide;
  c.dataset.state = "empty";
}
function failure(key) {
  paint(
    key,
    `<p class="home-status">불러오지 못했습니다. <button type="button" data-home-retry="${key}">다시 시도</button></p>`,
  );
  const c = card(key);
  if (c) c.dataset.state = "failed";
}
const dependencies = {
  projects: () =>
    share("projects", async () => {
      await preload().projects;
      const snapshot=window.KPTUProjectCatalog.snapshot();
      if(!snapshot.loaded||snapshot.userId!==owner()||snapshot.workspaceId!==workspace())request('projects');
      const d = await window.KPTUProjectCatalog.load({
        workspaceId: workspace(),
        userId: owner(),
      });
      return d.projects;
    }),
  orgs: () =>
    share("orgs", () =>
      readRecordPages(`/rest/v1/app_suborganizations?workspace_id=eq.${encodeURIComponent(workspace())}&active=eq.true&select=id,name,active&order=id.asc`, {...rt,api}),
    ),
  assignments: () =>
    share("assignments", () =>
      readRecordPages(`/rest/v1/app_suborganization_assignees?user_id=eq.${encodeURIComponent(owner())}&select=organization_id&order=organization_id.asc`, {...rt,api}),
    ),
  google: () =>
    share("google", async () => {
      await Promise.all([preload().order,preload().google]);
      google = window.KPTUGoogleTasks;
      return google;
    }),
  tasks: () =>
    share("tasks", async () => {
      const g = await dependencies.google();
      request('tasks');
      return g.listTasks({ publish: true, fresh: freshTaskRead });
    }),
  links: () =>
    share("links", async () => {
      const d = await dependencies.tasks();
      if (d.status !== "ok") return [];
      const ids=new Set(d.tasks.map(t=>t.id).filter(Boolean));
      for(let i=0;i<ids.size;i+=50)request('links');
      return google.readLinks(d.tasks);
    }),
  calendar: () =>
    share("calendar", () => api("/functions/v1/google-calendar?action=status")),
};
// The small 새로 불러오는 중 / 최신 아님 · 마지막 확인 HH:MM [다시 시도] line of the 오늘 일정 and 오늘 할 일 cards.
function fresh(key,state){
  if(state!=='refresh'&&state!=='stale')fromCopy[key]=false;
  paintFreshness(card(key)?.querySelector('[data-home-fresh]'),{state,checkedAt:copyAt[key]||0,onRetry:()=>void retry(key)});
}
function disconnected(key) {
  fresh(key,'');
  if (key === 'calendar') fillMount?.setTomorrow(null);
  paint(
    key,
    `<p class="home-status"><button type="button" data-goto="${key === "calendar" ? "calendar" : "tasks"}">Google ${key === "calendar" ? "캘린더" : "할 일"} 연결 ›</button></p>`,
  );
  card(key).dataset.state = "disconnected";
}
function shownTasks() {
  return tasks.map((t) => {
    const state = google?.taskState(t.id);
    return { task: state?.task || t, place: state?.place || state?.task || t };
  });
}
function taskRowHtml(id, title, done, meta, followUp = false) {
  const name = esc(title || "제목 없음");
  // HOME-모바일정리②: 회의 후속이기도 한 오늘 할 일은 여기 한 번만 나오고 작은 꼬리표를 단다.
  // TASK-바로처리통일: 줄 오른쪽 ⋯(공용 task-inline.js: 내일로·기한 바꾸기·고치기·지우기, 끝낸 줄은 다시 할 일로·고치기).
  const ready = !!google?.taskState(id)?.task;
  return `<div class="home-task ${done ? "completed" : ""}" data-home-task="${esc(id)}" data-task-inline-row><button type="button" class="gt-check" data-home-toggle="${esc(id)}" ${ready ? "" : "disabled"} aria-label="${done ? "완료 취소" : "완료"}" aria-pressed="${done}"></button><button type="button" class="home-task-text" data-home-edit="${esc(id)}" aria-label="${name} 수정"><span class="home-title">${name}</span>${followUp ? '<span class="home-tag" data-home-followup-tag>사업 보고 후속</span>' : ""}${meta ? `<small>${meta}</small>` : ""}</button>${moreButtonHtml({id, name:title || "제목 없음", attr:"homeTaskMenu", menuId:"homeTaskMenu", className:"home-task-more"}).replace('<button ', ready ? '<button ' : '<button disabled ')}</div>`;
}
const isFollowUp = (id) => linksReady
  ? links.some((l) => l.google_task_id === id && l.meeting_id && l.status === "confirmed")
  : !!copies.tasks?.names.find((r) => r.id === id)?.meeting;
function taskRows(rows, meeting = false) {
  return rows
    .map(({ task: t }) => {
      const done = t.status === "completed",
        ls = links.filter(
          (l) => l.google_task_id === t.id && l.status === "confirmed",
        );
      let names = meeting
        ? ls
            .filter((l) => l.meeting_id)
            .map((l) => {
              const m = meetings.find((m) => m.id === l.meeting_id);
              return m?.series_name || m?.title || "사업 보고 연결";
            })
        : ls.flatMap((l) =>
            [
              projects.find((p) => p.id === l.project_id)?.name,
              orgs.find((o) => o.id === l.organization_id)?.name,
            ].filter(Boolean),
          );
      if(!linksReady&&!meeting)names=copies.tasks?.names.find(r=>r.id===t.id)?.names||[];
      const due = String(t.due || "").slice(0, 10),
        past = due && due < dayKey();
      // 한 줄 행: 오늘 기한은 보조 글자를 쓰지 않고, 기한이 지난 항목만 날짜를 작게 붙인다.
      const meta = meeting
        ? esc(names.join(" · "))
        : [past ? `<strong class="home-overdue">${Number(due.slice(5, 7))}.${Number(due.slice(8, 10))} 지남</strong>` : "", ...names.map(esc)].filter(Boolean).join(" · ");
      return taskRowHtml(t.id, t.title, done, meta, !meeting && mergeFollowUps() && isFollowUp(t.id));
    })
    .join("");
}
function renderTasks({ includeMeetings = true } = {}) {
  if (taskStatus !== "ok") return;
  const shown = shownTasks(),
    dueIds = new Set(dueTasks(shown.map((x) => x.place)).map((t) => t.id));
  const rows = shown
    .filter((x) => dueIds.has(x.place.id))
    .sort((a, b) => String(a.place.due).localeCompare(String(b.place.due)));
  // HOME-모바일홈채우기: 폰·중간 폭은 2건만 보이고 나머지는 '+ n건 더'(누르면 펼침, 다시 누르면 접음). PC는 전부.
  const dueCount = dueTasks(shown.map((x) => x.task)).length,
    cut = mergeFollowUps() && !tasksOpen ? limitRows(rows) : { shown: rows, more: 0 },
    moreBtn = !mergeFollowUps() ? '' : cut.more ? `<button type="button" class="home-more" data-home-tasks-more="open">+ ${cut.more}건 더</button>` : tasksOpen && rows.length > limitRows(rows).shown.length ? '<button type="button" class="home-more" data-home-tasks-more="close">접기</button>' : '';
  if (tasksReady) {
    paint(
      "tasks",
      rows.length
        ? taskRows(cut.shown) + moreBtn
        : emptyHtml(),
      dueCount,
    );
  }
  if(tasksReady)card('meetings')?.querySelectorAll('[data-home-toggle],[data-home-task-menu]').forEach(b=>{b.disabled=!google?.taskState(b.dataset.homeToggle||b.dataset.homeTaskMenu)?.task;});
  if(tasksReady&&linksReady)saveCopy('tasks',{names:tasks.map(t=>({id:t.id,meeting:isFollowUp(t.id),names:links.filter(l=>l.google_task_id===t.id&&l.status==='confirmed').flatMap(l=>[projects.find(p=>p.id===l.project_id)?.name,orgs.find(o=>o.id===l.organization_id)?.name].filter(Boolean))}))});
  if (!meetingsReady || !includeMeetings) return;
  // HOME-모바일정리②(폰·중간 폭): 오늘 할 일에 이미 나온 항목은 빼고(그쪽에 꼬리표), 남는 것이 없으면 칸을 숨긴다.
  const ids = new Set(
      meetingTasks(
        shown.map((x) => x.place),
        links,
      ).map((t) => t.id),
    ),
    follow = shown.filter((x) => ids.has(x.place.id) && !(mergeFollowUps() && dueIds.has(x.place.id)));
  if (follow.length)
    paint(
      "meetings",
      taskRows(follow, true),
      follow.length,
    );
  else empty("meetings", true);
  saveCopy('meetings',{rows:follow.map(x=>({id:x.task.id,title:x.task.title,meetingName:links.filter(l=>l.google_task_id===x.task.id&&l.meeting_id&&l.status==='confirmed').map(l=>meetings.find(m=>m.id===l.meeting_id)?.series_name||meetings.find(m=>m.id===l.meeting_id)?.title||'사업 보고 연결').join(' · ')}))});
}
function renderDday(rows){
  const today=dayKey();
  rows=rows.filter(m=>m.date>=today).map(m=>({...m,days:Math.round((Date.parse(m.date)-Date.parse(today))/86400000)}));
  if(!rows.length)return empty('dday',true);
  // HOME-줄누르기 ④: 달력에 이어진 주요 일정은 그 일정 수정 창(꾹 누르기·우클릭은 일정 메뉴), 이어지지 않은 것은 지금처럼 그 프로젝트.
  paint('dday',`<div class="home-chips">${rows.map(m=>`<button type="button" class="home-chip ${m.days<=3?'urgent':''}" data-home-project="${esc(m.project_id)}" ${m.google_event_id?eventAttrs(m.google_event_id,m.google_calendar_id):''}>${m.days===0?'D-day':'D-'+m.days} ${esc(m.title)}</button>`).join('')}</div>`,rows.length);
}
function renderCalendar(rows){
  if(!rows.length)return empty('calendar');
  paint('calendar',rows.map(e=>{
    const time=e.allDay?'종일':new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(e.start));
    const color=/^#[0-9a-f]{6}$/i.test(e.color)?e.color:'var(--kptu-primary-ink)';
    // HOME-줄누르기 ①: 줄을 누르면 달력의 그 일정 수정 창, 꾹 누르기(폰)·우클릭(PC)은 달력의 일정 메뉴. 예전 사본(id 없음)은 누르지 않는 줄.
    if(!e.id)return `<div class="home-event"><time>${time}</time><i style="background:${color}" aria-hidden="true"></i><span class="home-title">${esc(e.title)}</span></div>`;
    return `<button type="button" class="home-event home-event-open" ${eventAttrs(e.id,e.calendarId)} aria-label="${esc(e.title||'제목 없음')} 일정 열기"><time>${time}</time><i style="background:${color}" aria-hidden="true"></i><span class="home-title">${esc(e.title)}</span></button>`;
  }).join(''),rows.length);
}
function restoreCopies(){
  if(copies.dday)renderDday(copies.dday.rows);
  if(copies.calendar){renderCalendar(copies.calendar.rows);fromCopy.calendar=true;copyAt.calendar=copies.calendar.savedAt;fresh('calendar','refresh');}
  if(copies.meetings){
    const rows=copies.meetings.rows;
    if(rows.length)paint('meetings',rows.map(r=>taskRowHtml(r.id,r.title,false,esc(r.meetingName))).join(''),rows.length);
    else empty('meetings',true);
  }
}
const calendarAuthError=e=>Number(e?.status||0)===401||Number(e?.status||0)===403||/연결되지|재인증|권한|invalid_grant|unauthori[sz]ed|invalid.?credentials/i.test(String(e?.message||e));
const current = run => run === epoch && !!owner() && owner() === homeOwner && workspace() === homeWorkspace;
const guard = (run) => {
  if (!current(run)) throw new Error("stale home read");
};
const loaders = {
  async dday(run) {
    const ps = await dependencies.projects();
    guard(run);
    const ids = ps.filter((p) => p.status === "active").map((p) => p.id);
    if (!ids.length) { saveCopy("dday",{rows:[]}); return empty("dday", true); }
    const ms = await share("milestones", () =>
        api(
          `/rest/v1/app_project_milestones?project_id=${list(ids)}&start_at=gte.${encodeURIComponent(new Date(ranges().start).toISOString())}&or=(status.is.null,status.not.in.(done,completed,cancelled,canceled))&select=id,project_id,title,status,start_at,google_calendar_id,google_event_id&order=start_at.asc&limit=3`,
        ),
      ),
      rows = milestoneChips(ps, ms);
    guard(run);
    const copy=rows.map(m=>({project_id:m.project_id,project_name:ps.find(p=>p.id===m.project_id)?.name||'',title:m.title,date:m.date,google_calendar_id:m.google_calendar_id||'',google_event_id:m.google_event_id||''}));
    saveCopy('dday',{rows:copy});renderDday(copy);
  },
  async calendar(run) {
    const fromCalendar=window.KPTUCalendarPersistence?.peek?.();
    const known=!!copies.calendar||(calendarState?.owner===owner()&&calendarState.status?.connected)||(fromCalendar?.owner===owner()&&fromCalendar.status?.connected);
    const r=ranges(),events=()=>share('events',()=>api(`/functions/v1/google-calendar?action=events&timeMin=${encodeURIComponent(new Date(r.start).toISOString())}&timeMax=${encodeURIComponent(new Date(r.end + 86400000).toISOString())}`));
    // Attach a rejection handler immediately while the status check is still pending.
    const applyEvents=(d,status)=>{
      guard(run);
      if(d?.connected===false||d?.needs_reconnect||d?.authorized===false||calendarAuthError(d?.warning||''))return disconnected('calendar');
      if(d.warning)throw new Error(d.warning);
      const rows=homeEventRows(d.events||[],status);
      // 같은 조회(오늘+내일 이틀)에서 내일 한 줄 미리보기를 만든다. 오늘 일정 사본·표시는 그대로 오늘 것만.
      fillMount?.setTomorrow(homeEventRows(d.events||[],status,Date.now()+86400000));
      saveCopy('calendar',{day:dayKey(),rows});renderCalendar(rows);fresh('calendar','');
      metrics.refreshed.calendar=Math.round(performance.now()-metrics.shellAt);timing();
    };
    // A slow calendar-list status read must not hold a completed fresh events read behind the display copy.
    // Events still authenticate server-side; the eventual status result can supersede this display.
    let statusPending=true;
    const early=known?events().then(value=>{if(statusPending)applyEvents(value,calendarState?.status||fromCalendar?.status||{});return {value};}).catch(error=>({error})):null;
    let status;
    try{status=await dependencies.calendar();}catch(e){guard(run);if(calendarAuthError(e))return disconnected('calendar');throw e;}finally{statusPending=false;}
    guard(run);
    calendarState={owner:owner(),status};
    if(!status?.connected||status.needs_reconnect||status.authorized===false)return disconnected('calendar');
    let d;
    try{const result=early?await early:{value:await events()};if(result.error)throw result.error;d=result.value;}
    catch(e){guard(run);if(calendarAuthError(e))return disconnected('calendar');throw e;}
    guard(run);
    applyEvents(d,status);
  },
  async tasks(run, includeMeetings = true) {
    const g = await dependencies.google(),
      cached = g.peekTasks();
    guard(run);
    if (cached?.owner===owner() && taskStatus === 'loading') {
      tasks=cached.tasks;taskStatus='ok';tasksReady=true;renderTasks({includeMeetings:false});fromCopy.tasks=true;copyAt.tasks=cached.savedAt;fresh('tasks','refresh');
    }
    const d = await dependencies.tasks();
    guard(run);
    taskStatus = d.status;
    if (d.status !== "ok") {
      tasks = [];
      return disconnected("tasks");
    }
    tasks = d.tasks;
    tasksReady=true;renderTasks({includeMeetings:false});fresh('tasks','');
    const ls = await dependencies.links();
    guard(run);
    links = ls;
    linksReady = true;
    tasksReady = true;
    renderTasks({includeMeetings});
  },
  async meetings(run) {
    const d = await dependencies.tasks();
    guard(run);
    if (d.status !== "ok") return disconnected("meetings");
    const ls = await dependencies.links();
    guard(run);
    const ids = [
      ...new Set(
        ls
          .filter(
            (l) =>
              l.meeting_id &&
              d.tasks.some(
                (t) => t.id === l.google_task_id && t.status !== "completed",
              ),
          )
          .map((l) => l.meeting_id),
      ),
    ];
    const ms = ids.length
      ? await share("meetings", () =>
          api(
            `/rest/v1/app_meetings?id=${list(ids)}&select=id,title,series_name`,
          ),
        )
      : [];
    guard(run);
    meetings = ms;
    tasks = d.tasks;
    links = ls;
    linksReady = true;
    taskStatus = d.status;
    guard(run);
    meetingsReady = true;
    renderTasks();
  },
};
async function loadCard(key, run = epoch) {
  try {
    await loaders[key](run);
  } catch {
    // A card still showing this device's copy keeps it and says it is not the latest; with nothing shown it says it failed.
    if (current(run)) { if(key==='calendar')fillMount?.setTomorrow(null); if(fromCopy[key])fresh(key,'stale');else{if(key==='tasks')taskStatus='failed';failure(key);} }
  } finally {
    if(current(run)){metrics.refreshed[key]=Math.round(performance.now()-metrics.shellAt);timing();}
  }
}
function start({ freshTasks = false } = {}) {
  if (!owner() || !workspace()) return;
  if(homeOwner===owner()&&homeWorkspace===workspace()&&(activeStart||taskFlight))return activeStart||taskFlight;
  freshTaskRead = freshTasks;
  homeOwner = owner();
  homeWorkspace = workspace();
  epoch++;
  flights = new Map();
  taskStatus = "loading";
  linksReady = false;
  tasksReady = false;
  meetingsReady = false;
  tasks=[];links=[];projects=[];orgs=[];meetings=[];
  copies=homeCache?.read()||{};fromCopy={};copyAt={};tasksOpen=false;
  unsubscribe?.();
  metrics.readyAt = 0;
  metrics.shellAt = performance.now();
  metrics.cards = {};
  metrics.firstPaint={};metrics.refreshed={};metrics.requests={};
  preload();
  shell();
  restoreCopies();
  const run = epoch;
  // Names enhance rows independently: a project/catalog failure does not prevent Google task rows.
  dependencies
    .projects()
    .then((v) => {
      if (current(run)) {
        projects = v;
        renderTasks();
      }
    })
    .catch(() => {});
  dependencies
    .orgs()
    .then((v) => {
      if (current(run)) {
        orgs = v;
        renderTasks();
      }
    })
    .catch(() => {});
  dependencies
    .google()
    .then((g) => {
      if (current(run))
        unsubscribe = g.subscribe(() => {
          if (current(run)) renderTasks();
        });
    })
    .catch(() => {});
  const taskReads=Promise.allSettled(['tasks','meetings'].map(key=>loadCard(key,run)));
  trackTaskFlight(taskReads,run);
  const started=Promise.allSettled([taskReads,...['dday','calendar'].map(key=>loadCard(key,run))]).then(
    () => {
      if (!current(run)) return;
      metrics.readyAt = performance.now();
      window.dispatchEvent(
        new CustomEvent("kptu:home-ready", { detail: metrics }),
      );
    },
  ).finally(()=>{if(activeStart===started)activeStart=null;});
  activeStart=started;
  return started;
}
function trackTaskFlight(promise,run){
  const tracked=promise.finally(()=>{
    if(taskFlight!==tracked)return;
    taskFlight=null;
    if(run===epoch&&tasksDirty){tasksDirty=false;return refreshTaskCards();}
  });
  taskFlight=tracked;return tracked;
}
function refreshTaskCards(){
  if(!current(epoch))return Promise.resolve();
  // A mutation burst during a read needs one following fresh read, not the in-flight snapshot.
  if(taskFlight){tasksDirty=true;return taskFlight;}
  const run=epoch;
  freshTaskRead=true;linksReady=false;meetingsReady=false;
  google?.invalidateAfterCreate();
  flights.delete('tasks');flights.delete('links');flights.delete('meetings');
  return trackTaskFlight(Promise.allSettled(['tasks','meetings'].map(key=>loadCard(key,run))),run);
}
async function retry(key){
  if (key === "calendar") {
    flights.delete("calendar");
    flights.delete("events");
  }
  if(fromCopy[key])fresh(key,'refresh');
  if(key==='tasks'||key==='meetings')return refreshTaskCards();
  await loadCard(key);
}
const homeTasks = createTaskInline({menuId:'homeTaskMenu', historyKey:'kptuHomeTaskMenu', menuAttr:'homeTaskMenu',
  find:id => google?.taskState(id)?.task || tasks.find((x) => x.id === id),
  // A deleted task leaves the card at once (the task screen's fresh read follows through kptu:google-tasks-changed).
  removed:id => { tasks = tasks.filter((t) => t.id !== id); renderTasks(); }});
root.addEventListener("click", async (event) => {
  const b = event.target.closest("button");
  if (!b) return;
  if (b.dataset.homeTasksMore) {
    tasksOpen = b.dataset.homeTasksMore === 'open';
    return renderTasks({ includeMeetings: false });
  }
  const key = b.dataset.homeRetry;
  if (key) {
    b.disabled = true;
    return retry(key);
  }
  const editId = b.dataset.homeEdit;
  if (editId) {
    // 할 일 화면의 기존 수정 창을 그대로 연다.
    const t = google?.taskState(editId)?.task || tasks.find((x) => x.id === editId);
    if (t) google?.openEditor?.(t);
    return;
  }
  // The circle and ⋯: the shared task line (task-inline.js). The rows follow the task screen's own state (google.taskState,
  // redrawn through its subscribe), so this card only says which task a line is.
  const id = b.dataset.homeToggle;
  if (id) {
    if(!google?.taskState(id)?.task||!owner())return;
    return void homeTasks.toggle(id, b);
  }
  if (b.dataset.homeTaskMenu) return homeTasks.openMenu(b);
  try {
    // HOME-줄누르기 ①③④: 오늘 일정·내일·이어진 D-day 칩 → 달력의 일정 수정 창(이 화면 위, 닫으면 홈 그대로).
    if (b.dataset.googleEvent) return void openGoogleEvent(b.dataset.googleEvent, b.dataset.googleCalendar).catch(() => {});
    // HOME-줄누르기 ⑤: 놓친 약속 → 원장 화면, 그 약속을 펼친 채로(뒤로가기는 홈).
    if (b.dataset.homeMissed) {
      await window.KPTUViewLoader.load("ledger");
      window.KPTULedgerBrowse?.show?.({ openId: b.dataset.homeMissed });
      window.KPTURouter?.go?.("ledger", { source: "delegated" });
      return;
    }
    if (b.dataset.homeProject) {
      await window.KPTUAreaWindow.open({ id: b.dataset.homeProject }); // MTG-프로젝트합치기 ①: 사업영역 관리 창
    }
  } catch {
    const c = b.closest("[data-home-card]");
    if (c) failure(c.dataset.homeCard);
  }
});
// HOME-줄누르기 ⑥: 꾹 누르기(폰)·우클릭(PC) — 일정 줄은 달력의 일정 메뉴, 할 일 줄은 그 줄의 ⋯ 메뉴(task-inline.js)를 누른 자리에.
bindLineHold(root, {
  selector: "[data-google-event],[data-home-task]",
  onHold: (line, x, y) => {
    if (line.dataset.googleEvent) return void openGoogleEventMenu(line, x, y).catch(() => {});
    const more = line.querySelector("[data-home-task-menu]");
    if (!more || more.disabled) return;
    window.KPTUContextMenu?.pinAt?.(more, x, y);
    homeTasks.openMenu(more);
  },
});
// 수정 창·일정 메뉴로 고치거나 지운 일정(달력 저장 경로의 알림, 주요 일정 저장 포함): 홈의 오늘 일정·내일·주요 일정을 다시 읽는다.
window.addEventListener("kptu:calendar-changed", () => {
  if (window.KPTURouter.current !== "home" || !current(epoch)) return;
  flights.delete("milestones");
  void retry("calendar");
  void loadCard("dday");
});
window.KPTURouter.on("home", start);
window.addEventListener("focus", () => {
  if (window.KPTURouter.current === "home") start();
});
window.addEventListener("kptu:session-changed", (event) => {
  if (event.detail?.session?.user?.id === homeOwner && workspace() === homeWorkspace) return;
  homeOwner = "";homeWorkspace = "";
  epoch++;
  flights.clear();
  unsubscribe?.();
  activeStart=null;taskFlight=null;tasksDirty=false;copies={};fromCopy={};copyAt={};calendarState=null;
  tasks = [];
  links = [];
  projects = [];
  orgs = [];
  meetings = [];
  fillMount?.destroy();fillMount=null;
  const host = root.querySelector('[data-home-cards]');
  // Keep the mounted input and its handlers when clearing another owner's cards.
  const quick = root.querySelector('[data-home-quick]');
  if (quick) host?.before(quick);
  host?.replaceChildren();
});
window.addEventListener("kptu:google-tasks-changed", (event) => {
  if (window.KPTURouter.current !== "home") return;
  if (event.detail?.source === "toggle") {
    renderTasks();
    if(taskFlight)void refreshTaskCards();
    return;
  }
  void refreshTaskCards();
});
window.addEventListener("kptu:tasks-changed", () => {
  if (window.KPTURouter.current === "home") void refreshTaskCards();
});
window.addEventListener("kptu:api-saved", (event) => {
  if (window.KPTURouter.current !== "home") return;
  const path = event.detail?.path || "";
  if(path.includes('google-tasks')&&!path.includes('action=toggle')&&taskFlight)tasksDirty=true;
});
async function refreshQuickTasks() {
  await refreshTaskCards();
}
mountQuick({root,dependencies,refreshTasks:refreshQuickTasks,invalidateProjects:()=>flights.delete("projects"),esc});
window.KPTUHome = { start:options=>{void start(options);}, metrics };
start();
