import { expect } from '@playwright/test';
import { loginEntry } from './login-entry.mjs';
const app='http://127.0.0.1:8123/app/',SB='https://xmlkxfjeagycwttklxjw.supabase.co';
export async function openHome(
  page,
  { delay = 0, delays = {}, holds = {}, fail = "", connected = true, calendarWarning = "", query = "", milestones = true } = {},
) {
  await page.clock.setFixedTime(new Date("2026-10-06T01:00:00Z"));
  const requests = [],
    user = { id: "home-test", email: "home@example.org" },
    tasks = [
      {
        id: "overdue",
        title: "지연 항목",
        due: "2026-10-03",
        status: "needsAction",
        taskListId: "default",
      },
      {
        id: "today",
        title: "오늘 항목",
        due: "2026-10-06",
        status: "needsAction",
        taskListId: "default",
      },
      {
        id: "meeting",
        title: "기한 없는 후속",
        status: "needsAction",
        taskListId: "default",
      },
      {
        id: "completed",
        title: "완료 후속",
        status: "completed",
        taskListId: "default",
      },
      {
        id: "future",
        title: "미래 항목",
        due: "2026-10-10",
        status: "needsAction",
        taskListId: "default",
      },
    ];
  const projects = [
    {
      id: "p",
      name: "테스트 프로젝트",
      owner_id: user.id,
      status: "active",
      metadata: { project_system: "v2" },
    },
    {
      id: "child",
      name: "자식 프로젝트",
      parent_id: "p",
      owner_id: user.id,
      status: "active",
    },
  ];
  const links = [
    { google_task_id: "overdue", project_id: "p", status: "confirmed" },
    {
      google_task_id: "meeting",
      meeting_id: "m",
      status: "confirmed",
      task_completed: true,
    },
    {
      google_task_id: "completed",
      meeting_id: "m",
      status: "confirmed",
      task_completed: false,
    },
  ];
  await page.route(SB + "/**", async (route) => {
    const req = route.request(),
      u = new URL(req.url()),
      p = u.pathname,
      a = u.searchParams.get("action");
    requests.push({ path: p, action: a, query: u.search, at: Date.now() });
    const ok = (data) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(data),
      });
    if (p === "/auth/v1/token")
      return ok({
        access_token: "home-access",
        refresh_token: "home-refresh",
        expires_at: 1791334800,
        user,
      });
    if (p === "/auth/v1/user") return ok(user);
    if (p === "/rest/v1/app_workspace_members")
      return ok([
        {
          workspace_id: "w",
          role: "owner",
          workspace: { id: "w", name: "QA", slug: "kptu-work" },
        },
      ]);
    const latency=delays[a] ?? delays[p.split('/').pop()] ?? (p.includes('/functions/')?delay:0);
    await (holds[a] ?? holds[p.split('/').pop()]);
    if (latency) await new Promise((r) => setTimeout(r, latency));
    if (fail && p.endsWith(fail))
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: '{"message":"QA failure"}',
      });
    if (p.endsWith("google-tasks")) {
      if (a === "toggle") {
        const b = req.postDataJSON(),
          t = tasks.find((t) => t.id === b.task_id);
        t.status = b.completed ? "completed" : "needsAction";
        return ok({ task: t });
      }
      return ok({
        connected,
        authorized: connected,
        pending_scope: "all",
        tasks: connected ? tasks : [],
      });
    }
    if (p.endsWith("google-calendar"))
      return ok(
        a === "events"
          ? {
              warning: calendarWarning,
              events: [
                {
                  id: "multi",
                  title: "여러 날 일정",
                  allDay: true,
                  start: "2026-10-05",
                  end: "2026-10-08",
                  calendarId: "c",
                },
                {
                  id: "event",
                  title: "오전 일정",
                  start: "2026-10-06T10:00:00+09:00",
                  end: "2026-10-06T11:00:00+09:00",
                  calendarId: "c",
                },
              ],
            }
          : {
              connected,
              selected: ["c"],
              calendars: [{ id: "c", backgroundColor: "#336699" }],
              colors: {},
            },
      );
    if (p.endsWith("app_spaces")) return ok(projects);
    if (p.endsWith("app_project_milestones"))
      return ok(milestones ? [
        {
          id: "ms",
          project_id: "child",
          title: "주요 일정",
          start_at: "2026-10-07",
          status: "planned",
        },
      ] : []);
    if (p.endsWith("app_record_links")) return ok(links);
    if (p.endsWith("app_suborganizations"))
      return ok([{ id: "o", name: "테스트 조직", active: true }]);
    if (p.endsWith("app_suborganization_assignees"))
      return ok([{ organization_id: "o", user_id: user.id }]);
    if (p.endsWith("app_suborganization_updates"))
      return ok([
        {
          id: "u",
          organization_id: "o",
          raw_text: "이번 주 테스트 기록",
          occurred_at: "2026-10-05T16:00:00Z",
        },
      ]);
    if (p.endsWith("app_meetings"))
      return ok([{ id: "m", series_name: "테스트 회의", title: "회차" }]);
    return ok(p.startsWith("/rest/") ? [] : {});
  });
  await page.goto(loginEntry(app+query));
  await page.locator("#emailAuthToggle").click();
  await page.locator("#authEmail").fill(user.email);
  await page.locator("#authPassword").fill("password123");
  await page.locator("#authSubmit").click();
  await expect(page.locator("#appView")).toHaveClass(/kptu-ui-ready/, {
    timeout: 20000,
  });
  return {
    requests,
    tasks,
    links,
    setUserId: value => { user.id=value; },
    setConnected: value => { connected=value; },
    setDelay: (key,value) => { delays[key]=value; },
    setFailure: (value) => {
      fail = value;
    },
    setCalendarWarning: (value) => {
      calendarWarning = value;
    },
  };
}
