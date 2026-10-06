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
  freshTaskRead = false;
const metrics = {
  shellAt:
    window.__KPTU_STARTUP__?.marks.requestedShellVisible || performance.now(),
  readyAt: 0,
  cards: {},
};
const owner = () => rt.context.read()?.user?.id,
  workspace = () => rt.context.read()?.workspace?.id;
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
const api = (path) => rt.api(path),
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
      await import("./project-catalog.js?v=2");
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
      await import("./organization-order.js?v=1");
      await import("./google-tasks.js?v=26");
      google = window.KPTUGoogleTasks;
      return google;
    }),
  tasks: () =>
    share("tasks", async () => {
      const g = await dependencies.google();
      return g.listTasks({ publish: true, fresh: freshTaskRead });
    }),
  links: () =>
    share("links", async () => {
      const d = await dependencies.tasks();
      if (d.status !== "ok") return [];
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
      const names = meeting
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
      const due = String(t.due || "").slice(0, 10),
        past = due && due < dayKey();
      const meta = meeting
        ? esc(names.join(" · "))
        : `${past ? `<strong class="home-overdue">${Number(due.slice(5, 7))}.${Number(due.slice(8, 10))} 지남</strong>` : "오늘"}${names.length ? " · " + esc(names.join(" · ")) : ""}`;
      return `<div class="home-task ${done ? "completed" : ""}" data-home-task="${esc(t.id)}"><button type="button" class="gt-check" data-home-toggle="${esc(t.id)}" aria-label="${done ? "완료 취소" : "완료"}" aria-pressed="${done}"></button><div class="home-task-text"><div class="home-title">${esc(t.title || "제목 없음")}</div><small>${meta}</small></div></div>`;
    })
    .join("");
}
function renderTasks() {
  if (taskStatus !== "ok" || !linksReady) return;
  const shown = shownTasks(),
    dueIds = new Set(dueTasks(shown.map((x) => x.place)).map((t) => t.id));
  const rows = shown
    .filter((x) => dueIds.has(x.place.id))
    .sort((a, b) => String(a.place.due).localeCompare(String(b.place.due)));
  const n = unlinkedTasks(
    shown.map((x) => x.task),
    links,
  ).length;
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
  if (!meetingsReady) return;
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
}
const guard = (run) => {
  if (run !== epoch || !owner()) throw new Error("stale home read");
};
const loaders = {
  async dday(run) {
    const ps = await dependencies.projects();
    guard(run);
    const ids = ps.filter((p) => p.status === "active").map((p) => p.id);
    if (!ids.length) return empty("dday", "주요 일정 없음", true);
    const ms = await share("milestones", () =>
        api(
          `/rest/v1/app_project_milestones?project_id=${list(ids)}&start_at=gte.${encodeURIComponent(new Date(ranges().start).toISOString())}&or=(status.is.null,status.not.in.(done,completed,cancelled,canceled))&select=id,project_id,title,status,start_at&order=start_at.asc&limit=3`,
        ),
      ),
      rows = milestoneChips(ps, ms);
    guard(run);
    if (!rows.length) return empty("dday", "주요 일정 없음", true);
    paint(
      "dday",
      `<div class="home-chips">${rows.map((m) => `<button type="button" class="home-chip ${m.days <= 3 ? "urgent" : ""}" data-home-project="${esc(m.project_id)}">${m.days === 0 ? "D-day" : "D-" + m.days} ${esc(m.title)}</button>`).join("")}</div>`,
      rows.length,
    );
  },
  async calendar(run) {
    const status = await dependencies.calendar();
    guard(run);
    if (!status?.connected) return disconnected("calendar");
    const r = ranges(),
      d = await share("events", () =>
        api(
          `/functions/v1/google-calendar?action=events&timeMin=${encodeURIComponent(new Date(r.start).toISOString())}&timeMax=${encodeURIComponent(new Date(r.end).toISOString())}`,
        ),
      );
    guard(run);
    if (d.warning) throw new Error(d.warning);
    const rows = todayEvents(d.events || []);
    if (!rows.length) return empty("calendar", "오늘 일정 없음");
    paint(
      "calendar",
      rows
        .map((e) => {
          const time = e.allDay
              ? "종일"
              : new Intl.DateTimeFormat("ko-KR", {
                  timeZone: "Asia/Seoul",
                  hour: "2-digit",
                  minute: "2-digit",
                  hourCycle: "h23",
                }).format(new Date(e.start)),
            raw =
              e.color ||
              status.colors?.[e.calendarId] ||
              status.calendars?.find((c) => c.id === e.calendarId)
                ?.backgroundColor;
          const color = /^#[0-9a-f]{6}$/i.test(raw)
            ? raw
            : "var(--kptu-primary-ink)";
          return `<div class="home-event"><time>${time}</time><i style="background:${color}" aria-hidden="true"></i><span class="home-title">${esc(e.title)}</span></div>`;
        })
        .join(""),
      rows.length,
    );
  },
  async tasks(run) {
    const g = await dependencies.google(),
      cached = g.peekTasks();
    guard(run);
    if (cached && taskStatus === "loading") {
      tasks = cached.tasks;
      paint(
        "tasks",
        taskRows(dueTasks(tasks).map((t) => ({ task: t }))) +
          '<p class="home-status">기기 사본 · 최신 목록을 불러오는 중…</p>',
      );
    }
    const d = await dependencies.tasks();
    guard(run);
    taskStatus = d.status;
    if (d.status !== "ok") {
      tasks = [];
      return disconnected("tasks");
    }
    tasks = d.tasks;
    const ls = await dependencies.links();
    guard(run);
    links = ls;
    linksReady = true;
    tasksReady = true;
    renderTasks();
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
    if (!ids.length) return empty("updates", "이번 주 기록 없음");
    const up = await share("updates", () =>
        api(
          `/rest/v1/app_suborganization_updates?organization_id=${list(ids)}&occurred_at=gte.${encodeURIComponent(r.weekStart)}&occurred_at=lt.${encodeURIComponent(r.weekEnd)}&select=id,organization_id,occurred_at,raw_text,detail_text&order=occurred_at.desc&limit=5`,
        ),
      ),
      rows = weekUpdates(up, os, as);
    guard(run);
    if (!rows.length) return empty("updates", "이번 주 기록 없음");
    paint(
      "updates",
      rows
        .map((u) => {
          const date = dayKey(Date.parse(u.occurred_at));
          return `<button type="button" class="home-update" data-home-org="${esc(u.organization_id)}"><strong>${esc(os.find((o) => o.id === u.organization_id)?.name)}</strong><span class="home-title">${esc(u.raw_text || u.detail_text || "")}</span><time>${Number(date.slice(5, 7))}.${Number(date.slice(8, 10))}</time></button>`;
        })
        .join(""),
      rows.length,
    );
  },
};
async function loadCard(key, run = epoch) {
  try {
    await loaders[key](run);
  } catch {
    if (run === epoch) failure(key);
  }
}
function start({ freshTasks = false } = {}) {
  freshTaskRead = freshTasks;
  if (!owner() || !workspace()) return;
  homeOwner = owner();
  epoch++;
  flights = new Map();
  taskStatus = "loading";
  linksReady = false;
  tasksReady = false;
  meetingsReady = false;
  unsubscribe?.();
  metrics.readyAt = 0;
  metrics.shellAt =
    window.__KPTU_STARTUP__?.marks.requestedShellVisible || performance.now();
  metrics.cards = {};
  shell();
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
  Promise.allSettled(Object.keys(cards).map((key) => loadCard(key, run))).then(
    () => {
      if (run !== epoch) return;
      metrics.readyAt = performance.now();
      window.dispatchEvent(
        new CustomEvent("kptu:home-ready", { detail: metrics }),
      );
    },
  );
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
    await loadCard(key);
    return;
  }
  const id = b.dataset.homeToggle;
  if (id) {
    const t = google?.taskState(id)?.task || tasks.find((t) => t.id === id);
    const result = await google.toggleTask(t);
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
    return;
  }
  start({ freshTasks: true });
});
window.addEventListener("kptu:tasks-changed", () => {
  if (window.KPTURouter.current === "home") start({ freshTasks: true });
});
window.addEventListener("kptu:api-saved", (event) => {
  if (window.KPTURouter.current !== "home") return;
  const path = event.detail?.path || "";
  if (path.includes("/app_suborganization_updates")) {
    flights.delete("updates");
    void loadCard("updates");
  }
});
window.KPTUHome = { start, metrics };
start();
