import { mountQuick } from './home-quick.js?v=3';
import { createHomeCache } from './home-read-cache.js?v=1';
import {
  ranges,
  dayKey,
  milestoneChips,
  todayEvents,
  dueTasks,
  unlinkedTasks,
  meetingTasks,
  weekUpdates,
} from "./home-read-model.js?v=1";
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
  freshTaskRead = false,
  activeStart = null,
  taskFlight = null,
  tasksDirty = false,
  copies = {},
  calendarState = null,
  imports = null;
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
    projects:import('./project-catalog.js?v=2'),
    order:import('./organization-order.js?v=1'),
    google:import('./google-tasks.js?v=30'),
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
    const key=path.includes('google-calendar')?(path.includes('action=status')?'calendar':'events'):path.includes('app_project_milestones')?'milestones':path.includes('app_suborganization_assignees')?'assignments':path.includes('app_suborganization_updates')?'updates':path.includes('app_suborganizations')?'orgs':'meetings';
    request(key);return rt.api(path);
  },
  list = (ids) => "in.(" + ids.map(encodeURIComponent).join(",") + ")";
const cards = {
  dday: ["주요 일정", ""],
  calendar: ["오늘 일정", "calendar", "달력"],
  tasks: ["오늘·밀린 할 일", "tasks", "할 일"],
  meetings: ["회의 후속", "meetings", "회의"],
  updates: ["이번 주 업데이트", "team", "담당조직"],
};
function shell() {
  root.querySelector("[data-home-cards]").innerHTML = Object.entries(cards)
    .map(
      ([key, [title, view, label]]) =>
        `<section class="home-card" data-home-card="${key}" aria-labelledby="home-${key}-title"><header><h3 id="home-${key}-title">${title} <small data-home-count></small></h3>${view ? `<button type="button" data-goto="${view}">${label} ›</button>` : ""}</header><div data-home-body role="status">불러오는 중…</div></section>`,
    )
    .join("");
  root.querySelector('[data-home-timing]')?.remove();
  if(new URLSearchParams(location.search).get('homeTiming')==='1'){
    const p=document.createElement('p');p.className='home-timing';p.dataset.homeTiming='';root.append(p);
  }
}
const requestKeys={dday:['projects','milestones'],calendar:['calendar','events'],tasks:['tasks','links'],meetings:['tasks','links','meetings'],updates:['orgs','assignments','updates']};
function timing(){
  const p=root.querySelector('[data-home-timing]');if(!p)return;
  p.textContent=Object.entries(cards).map(([key,[label]])=>`${label}: 표시 ${metrics.firstPaint[key]??'…'}ms · 최신 ${metrics.refreshed[key]??'…'}ms · 요청 ${requestKeys[key].reduce((n,k)=>n+(metrics.requests[k]||0),0)}회`).join(' / ')+` / 전체 요청 ${Object.values(metrics.requests).reduce((a,b)=>a+b,0)}회`;
}
const card = (key) => root.querySelector(`[data-home-card="${key}"]`);
function paint(key, html, count = null) {
  const c = card(key);
  if (!c) return;
  const focused = c.contains(document.activeElement)
    ? document.activeElement.dataset.homeToggle
    : null;
  c.hidden = false;
  c.querySelector("[data-home-body]").innerHTML = html;
  c.querySelector("[data-home-count]").textContent =
    count === null ? "" : count;
  c.dataset.state = "ready";
  metrics.cards[key] = performance.now();
  metrics.firstPaint[key] ??= Math.round(performance.now()-metrics.shellAt);
  timing();
  if (focused)
    c.querySelector(`[data-home-toggle="${CSS.escape(focused)}"]`)?.focus({
      preventScroll: true,
    });
}
function empty(key, text, hide = false) {
  paint(key, `<p class="home-status">${text}</p>`, 0);
  card(key).hidden = hide;
  card(key).dataset.state = "empty";
}
function failure(key) {
  paint(
    key,
    `<p class="home-status">불러오지 못했습니다. <button type="button" data-home-retry="${key}">다시 시도</button></p>`,
  );
  card(key).dataset.state = "failed";
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
      api(
        `/rest/v1/app_suborganizations?workspace_id=eq.${encodeURIComponent(workspace())}&active=eq.true&select=id,name,active`,
      ),
    ),
  assignments: () =>
    share("assignments", () =>
      api(
        `/rest/v1/app_suborganization_assignees?user_id=eq.${encodeURIComponent(owner())}&select=organization_id`,
      ),
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
function disconnected(key) {
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
              return m?.series_name || m?.title || "회의 연결";
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
      const meta = meeting
        ? esc(names.join(" · "))
        : `${past ? `<strong class="home-overdue">${Number(due.slice(5, 7))}.${Number(due.slice(8, 10))} 지남</strong>` : "오늘"}${names.length ? " · " + esc(names.join(" · ")) : ""}`;
      return `<div class="home-task ${done ? "completed" : ""}" data-home-task="${esc(t.id)}"><button type="button" class="gt-check" data-home-toggle="${esc(t.id)}" ${google?.taskState(t.id)?.task?'':'disabled'} aria-label="${done ? "완료 취소" : "완료"}" aria-pressed="${done}"></button><div class="home-task-text"><div class="home-title">${esc(t.title || "제목 없음")}</div><small>${meta}</small></div></div>`;
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
  const n = linksReady ? unlinkedTasks(
    shown.map((x) => x.task),
    links,
  ).length : copies.tasks?.unlinkedCount ?? (tasks.every(t=>typeof t.unlinked==='boolean')?tasks.filter(t=>t.status!=='completed'&&t.unlinked).length:null);
  if (tasksReady)
    paint(
      "tasks",
      (rows.length
        ? taskRows(rows)
        : '<p class="home-status">오늘·밀린 할 일 없음</p>') +
        (n
          ? `<button type="button" class="home-unlinked" data-home-unlinked>연결 안 된 할 일 ${n}개 정리하기 ›</button>`
          : ""),
      dueTasks(shown.map((x) => x.task)).length,
    );
  if(tasksReady&&n!==null){metrics.firstPaint.unlinked??=Math.round(performance.now()-metrics.shellAt);timing();}
  if(tasksReady)card('meetings')?.querySelectorAll('[data-home-toggle]').forEach(b=>{b.disabled=!google?.taskState(b.dataset.homeToggle)?.task;});
  if(tasksReady&&linksReady)saveCopy('tasks',{unlinkedCount:n,names:tasks.map(t=>({id:t.id,names:links.filter(l=>l.google_task_id===t.id&&l.status==='confirmed').flatMap(l=>[projects.find(p=>p.id===l.project_id)?.name,orgs.find(o=>o.id===l.organization_id)?.name].filter(Boolean))}))});
  if (!meetingsReady || !includeMeetings) return;
  const ids = new Set(
      meetingTasks(
        shown.map((x) => x.place),
        links,
      ).map((t) => t.id),
    ),
    follow = shown.filter((x) => ids.has(x.place.id));
  if (follow.length)
    paint(
      "meetings",
      taskRows(follow, true),
      meetingTasks(
        shown.map((x) => x.task),
        links,
      ).length,
    );
  else empty("meetings", "회의 후속 없음", true);
  saveCopy('meetings',{rows:follow.map(x=>({id:x.task.id,title:x.task.title,meetingName:links.filter(l=>l.google_task_id===x.task.id&&l.meeting_id&&l.status==='confirmed').map(l=>meetings.find(m=>m.id===l.meeting_id)?.series_name||meetings.find(m=>m.id===l.meeting_id)?.title||'회의 연결').join(' · ')}))});
}
function renderDday(rows){
  const today=dayKey();
  rows=rows.filter(m=>m.date>=today).map(m=>({...m,days:Math.round((Date.parse(m.date)-Date.parse(today))/86400000)}));
  if(!rows.length)return empty('dday','주요 일정 없음',true);
  paint('dday',`<div class="home-chips">${rows.map(m=>`<button type="button" class="home-chip ${m.days<=3?'urgent':''}" data-home-project="${esc(m.project_id)}">${m.days===0?'D-day':'D-'+m.days} ${esc(m.title)}</button>`).join('')}</div>`,rows.length);
}
function eventRows(events,status={}){
  return todayEvents(events).map(e=>{
    const raw=e.color||status.colors?.[e.calendarId]||status.calendars?.find(c=>c.id===e.calendarId)?.backgroundColor;
    return {start:e.start,end:e.end,allDay:!!e.allDay,title:e.title,color:/^#[0-9a-f]{6}$/i.test(raw)?raw:'var(--kptu-primary-ink)'};
  });
}
function renderCalendar(rows){
  if(!rows.length)return empty('calendar','오늘 일정 없음');
  paint('calendar',rows.map(e=>{
    const time=e.allDay?'종일':new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(e.start));
    const color=/^#[0-9a-f]{6}$/i.test(e.color)?e.color:'var(--kptu-primary-ink)';
    return `<div class="home-event"><time>${time}</time><i style="background:${color}" aria-hidden="true"></i><span class="home-title">${esc(e.title)}</span></div>`;
  }).join(''),rows.length);
}
function renderUpdates(rows){
  if(!rows.length)return empty('updates','이번 주 기록 없음');
  paint('updates',rows.map(u=>`<button type="button" class="home-update" data-home-org="${esc(u.organization_id)}"><strong>${esc(u.name)}</strong><span class="home-title">${esc(u.text)}</span><time>${Number(u.date.slice(5,7))}.${Number(u.date.slice(8,10))}</time></button>`).join(''),rows.length);
}
function restoreCopies(){
  if(copies.dday)renderDday(copies.dday.rows);
  if(copies.calendar)renderCalendar(copies.calendar.rows);
  if(copies.updates)renderUpdates(copies.updates.rows);
  if(copies.meetings){
    const rows=copies.meetings.rows;
    if(rows.length)paint('meetings',rows.map(r=>`<div class="home-task" data-home-task="${esc(r.id)}"><button type="button" class="gt-check" data-home-toggle="${esc(r.id)}" ${google?.taskState(r.id)?.task?'':'disabled'} aria-label="완료" aria-pressed="false"></button><div class="home-task-text"><div class="home-title">${esc(r.title)}</div><small>${esc(r.meetingName)}</small></div></div>`).join(''),rows.length);
    else empty('meetings','회의 후속 없음',true);
  }
}
const calendarAuthError=e=>Number(e?.status||0)===401||Number(e?.status||0)===403||/연결되지|재인증|권한|invalid_grant|unauthori[sz]ed|invalid.?credentials/i.test(String(e?.message||e));
const guard = (run) => {
  if (run !== epoch || !owner()) throw new Error("stale home read");
};
const loaders = {
  async dday(run) {
    const ps = await dependencies.projects();
    guard(run);
    const ids = ps.filter((p) => p.status === "active").map((p) => p.id);
    if (!ids.length) { saveCopy("dday",{rows:[]}); return empty("dday", "주요 일정 없음", true); }
    const ms = await share("milestones", () =>
        api(
          `/rest/v1/app_project_milestones?project_id=${list(ids)}&start_at=gte.${encodeURIComponent(new Date(ranges().start).toISOString())}&or=(status.is.null,status.not.in.(done,completed,cancelled,canceled))&select=id,project_id,title,status,start_at&order=start_at.asc&limit=3`,
        ),
      ),
      rows = milestoneChips(ps, ms);
    guard(run);
    const copy=rows.map(m=>({project_id:m.project_id,project_name:ps.find(p=>p.id===m.project_id)?.name||'',title:m.title,date:m.date}));
    saveCopy('dday',{rows:copy});renderDday(copy);
  },
  async calendar(run) {
    const fromCalendar=window.KPTUCalendarPersistence?.peek?.();
    const known=!!copies.calendar||(calendarState?.owner===owner()&&calendarState.status?.connected)||(fromCalendar?.owner===owner()&&fromCalendar.status?.connected);
    const r=ranges(),events=()=>share('events',()=>api(`/functions/v1/google-calendar?action=events&timeMin=${encodeURIComponent(new Date(r.start).toISOString())}&timeMax=${encodeURIComponent(new Date(r.end).toISOString())}`));
    // Attach a rejection handler immediately while the status check is still pending.
    const applyEvents=(d,status)=>{
      guard(run);
      if(d?.connected===false||d?.needs_reconnect||d?.authorized===false||calendarAuthError(d?.warning||''))return disconnected('calendar');
      if(d.warning)throw new Error(d.warning);
      const rows=eventRows(d.events||[],status);
      saveCopy('calendar',{day:dayKey(),rows});renderCalendar(rows);
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
      tasks=cached.tasks;taskStatus='ok';tasksReady=true;renderTasks({includeMeetings:false});
    }
    const d = await dependencies.tasks();
    guard(run);
    taskStatus = d.status;
    if (d.status !== "ok") {
      tasks = [];
      return disconnected("tasks");
    }
    tasks = d.tasks;
    tasksReady=true;renderTasks({includeMeetings:false});
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
  async updates(run) {
    const [os, as] = await Promise.all([
        dependencies.orgs(),
        dependencies.assignments(),
      ]),
      ids = os
        .filter((o) => as.some((a) => a.organization_id === o.id))
        .map((o) => o.id),
      r = ranges();
    guard(run);
    if (!ids.length) { saveCopy("updates",{week:r.weekStart,rows:[]}); return empty("updates", "이번 주 기록 없음"); }
    const up = await share("updates", () =>
        api(
          `/rest/v1/app_suborganization_updates?organization_id=${list(ids)}&occurred_at=gte.${encodeURIComponent(r.weekStart)}&occurred_at=lt.${encodeURIComponent(r.weekEnd)}&select=id,organization_id,occurred_at,raw_text,detail_text&order=occurred_at.desc&limit=5`,
        ),
      ),
      rows = weekUpdates(up, os, as);
    guard(run);
    const copy=rows.map(u=>({organization_id:u.organization_id,name:os.find(o=>o.id===u.organization_id)?.name||'',date:dayKey(Date.parse(u.occurred_at)),text:[...String(u.raw_text||u.detail_text||'')].slice(0,80).join('')}));
    saveCopy('updates',{week:r.weekStart,rows:copy});renderUpdates(copy);
  },
};
async function loadCard(key, run = epoch) {
  try {
    await loaders[key](run);
  } catch {
    if (run === epoch) { if(key==='tasks')taskStatus='failed';failure(key); }
  } finally {
    if(run===epoch){metrics.refreshed[key]=Math.round(performance.now()-metrics.shellAt);timing();}
  }
}
function start({ freshTasks = false } = {}) {
  if (!owner() || !workspace()) return;
  if(homeOwner===owner()&&(activeStart||taskFlight))return activeStart||taskFlight;
  freshTaskRead = freshTasks;
  homeOwner = owner();
  epoch++;
  flights = new Map();
  taskStatus = "loading";
  linksReady = false;
  tasksReady = false;
  meetingsReady = false;
  tasks=[];links=[];projects=[];orgs=[];meetings=[];
  copies=homeCache?.read()||{};
  unsubscribe?.();
  metrics.readyAt = 0;
  metrics.shellAt = performance.now();
  metrics.cards = {};
  metrics.firstPaint={};metrics.refreshed={};metrics.requests={};
  preload();
  shell();
  restoreCopies();
  const run = epoch;
  // Names enhance rows independently: a project/catalog failure does not prevent Google task rows or organization updates.
  dependencies
    .projects()
    .then((v) => {
      if (run === epoch) {
        projects = v;
        renderTasks();
      }
    })
    .catch(() => {});
  dependencies
    .orgs()
    .then((v) => {
      if (run === epoch) {
        orgs = v;
        renderTasks();
      }
    })
    .catch(() => {});
  dependencies
    .google()
    .then((g) => {
      if (run === epoch)
        unsubscribe = g.subscribe(() => {
          if (run === epoch) renderTasks();
        });
    })
    .catch(() => {});
  const taskReads=Promise.allSettled(['tasks','meetings'].map(key=>loadCard(key,run)));
  trackTaskFlight(taskReads,run);
  const started=Promise.allSettled([taskReads,...['dday','calendar','updates'].map(key=>loadCard(key,run))]).then(
    () => {
      if (run !== epoch) return;
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
  if(!owner()||homeOwner!==owner())return Promise.resolve();
  // A mutation burst during a read needs one following fresh read, not the in-flight snapshot.
  if(taskFlight){tasksDirty=true;return taskFlight;}
  const run=epoch;
  freshTaskRead=true;linksReady=false;meetingsReady=false;
  google?.invalidateAfterCreate();
  flights.delete('tasks');flights.delete('links');flights.delete('meetings');
  return trackTaskFlight(Promise.allSettled(['tasks','meetings'].map(key=>loadCard(key,run))),run);
}
root.addEventListener("click", async (event) => {
  const b = event.target.closest("button");
  if (!b) return;
  const key = b.dataset.homeRetry;
  if (key) {
    b.disabled = true;
    if (key === "calendar") {
      flights.delete("calendar");
      flights.delete("events");
    }
    if(key==='tasks'||key==='meetings')return refreshTaskCards();
    await loadCard(key);
    return;
  }
  const id = b.dataset.homeToggle;
  if (id) {
    const run=epoch,me=owner(),t = google?.taskState(id)?.task;
    if(!t||!me||run!==epoch||owner()!==me)return;
    const result = await google.toggleTask(t);
    if(run!==epoch||owner()!==me)return;
    if (result?.ok === false) {
      const msg = document.createElement("p");
      msg.className = "home-status";
      msg.setAttribute("role", "alert");
      msg.textContent = result.message;
      card("tasks").append(msg);
    }
    return;
  }
  try {
    if (b.hasAttribute("data-home-unlinked")) {
      await window.KPTUViewLoader.load("tasks");
      window.KPTURouter.go("tasks", { source: "delegated" });
      google.showUnlinked();
    } else if (b.dataset.homeProject) {
      await window.KPTUViewLoader.load("projects");
      await window.KPTUProjects.open(b.dataset.homeProject);
    } else if (b.dataset.homeOrg) {
      await window.KPTUViewLoader.load("team");
      await window.KPTUWorkplace.open(b.dataset.homeOrg);
    }
  } catch {
    const c = b.closest("[data-home-card]");
    if (c) failure(c.dataset.homeCard);
  }
});
window.KPTURouter.on("home", start);
window.addEventListener("focus", () => {
  if (window.KPTURouter.current === "home") start();
});
window.addEventListener("kptu:session-changed", (event) => {
  if (event.detail?.session?.user?.id === homeOwner) return;
  homeOwner = "";
  epoch++;
  flights.clear();
  unsubscribe?.();
  activeStart=null;taskFlight=null;tasksDirty=false;copies={};calendarState=null;
  tasks = [];
  links = [];
  projects = [];
  orgs = [];
  meetings = [];
  root.querySelector("[data-home-cards]")?.replaceChildren();
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
  if (path.includes("/app_suborganization_updates")) {
    flights.delete("updates");
    void loadCard("updates");
  }
});
async function refreshQuickTasks() {
  await refreshTaskCards();
}
mountQuick({root,dependencies,refreshTasks:refreshQuickTasks,invalidateProjects:()=>flights.delete("projects"),esc});
window.KPTUHome = { start:options=>{void start(options);}, metrics };
start();
