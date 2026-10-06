import { test, expect } from "@playwright/test";
import { loginEntry } from "./helpers/login-entry.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
const app = "http://127.0.0.1:8123/app/",
  SB = "https://xmlkxfjeagycwttklxjw.supabase.co";
export async function openHome(
  page,
  { delay = 0, fail = "", connected = true, calendarWarning = "" } = {},
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
    if (delay && p.includes("/functions/"))
      await new Promise((r) => setTimeout(r, delay));
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
      return ok([
        {
          id: "ms",
          project_id: "child",
          title: "주요 일정",
          start_at: "2026-10-07",
          status: "planned",
        },
      ]);
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
  await page.goto(loginEntry(app));
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
    setFailure: (value) => {
      fail = value;
    },
    setCalendarWarning: (value) => {
      calendarWarning = value;
    },
  };
}
for (const width of [390, 1440])
  test(`home reading cards, shared requests and snapshot ${width}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    const { requests } = await openHome(page, { delay: 300 });
    await expect(page.locator("#homeView")).toBeVisible();
    await expect(page.locator('[data-home-card="updates"]')).toContainText(
      "이번 주 테스트 기록",
    );
    await expect(page.locator('[data-home-card="tasks"]')).toContainText(
      "연결 안 된 할 일 3개",
    );
    await expect(page.locator('[data-home-card="meetings"]')).toContainText(
      "기한 없는 후속",
    );
    await expect(page.locator('[data-home-card="meetings"]')).not.toContainText(
      "완료 후속",
    );
    await expect(page.locator('[data-home-card="calendar"]')).toContainText(
      "종일",
    );
    await expect(page.locator('[data-home-card="dday"]')).toContainText("D-1");
    await expect(
      page.locator('[data-home-card="tasks"] [data-home-task]'),
    ).toHaveCount(2);
    await page.waitForFunction(() => window.KPTUHome?.metrics?.readyAt);
    const dataRequests = requests.filter(
      (r) => r.path.includes("/rest/") || r.path.includes("/functions/"),
    );
    expect(dataRequests.length).toBeLessThanOrEqual(11);
    expect(requests.filter((r) => r.action === "overview")).toHaveLength(1);
    expect(
      requests.filter((r) => r.path.endsWith("app_record_links")),
    ).toHaveLength(1);
    expect(requests.some((r) => r.path.endsWith("app_tasks"))).toBe(false);
    const metrics = await page.evaluate(() => KPTUHome.metrics);
    expect(metrics.readyAt).toBeGreaterThan(metrics.shellAt);
    mkdirSync("test-results/home-read", { recursive: true });
    const path = `test-results/home-read/home-${width}.png`;
    await page.screenshot({ path, fullPage: true });
    await info.attach(`home-${width}`, { path, contentType: "image/png" });
    writeFileSync(
      `test-results/home-read/metrics-${width}.json`,
      JSON.stringify({ metrics, requests: dataRequests }, null, 2),
    );
  });
test("card failure isolation and retry; no connection is separate", async ({
  page,
}) => {
  const control = await openHome(page, { fail: "google-calendar" });
  await expect(page.locator('[data-home-card="calendar"]')).toContainText(
    "다시 시도",
  );
  await expect(page.locator('[data-home-card="tasks"]')).toContainText(
    "오늘 항목",
  );
  await expect(page.locator('[data-home-card="updates"]')).toContainText(
    "이번 주 테스트 기록",
  );
  control.setFailure("");
  await page.locator('[data-home-retry="calendar"]').click();
  await expect(page.locator('[data-home-card="calendar"]')).toContainText(
    "오전 일정",
  );
});
test("home completion retains row 3s, task view and unlinked destination agree", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await openHome(page);
  const card = page.locator('[data-home-card="tasks"]');
  await expect(card).toContainText("오늘 항목");
  await card.locator('[data-home-toggle="today"]').click();
  await expect(card.locator('[data-home-task="today"]')).toHaveClass(
    /completed/,
  );
  await expect(card.locator('[data-home-task="today"]')).toBeVisible();
  await expect(card.locator('[data-home-task="today"]')).toHaveCount(0, {
    timeout: 6000,
  });
  await page.locator("[data-home-unlinked]").click();
  await expect(page.locator("#tasksView")).toBeVisible();
  await expect(page.locator("#newTaskBtn")).toHaveText("+ 할 일");
  await expect(page.locator("[data-gt-unlinked-heading]")).toBeVisible();
  await expect(page.locator('[data-google-task="today"]')).toBeHidden();
  await expect(page.locator('[data-google-task="meeting"]')).toBeVisible();
});

test("disconnected Google shows connection guidance separately", async ({
  page,
}) => {
  await openHome(page, { connected: false });
  await expect(page.locator('[data-home-card="calendar"]')).toHaveAttribute(
    "data-state",
    "disconnected",
  );
  await expect(page.locator('[data-home-card="tasks"]')).toHaveAttribute(
    "data-state",
    "disconnected",
  );
  await expect(page.locator('[data-home-card="updates"]')).toContainText(
    "이번 주 테스트 기록",
  );
});
test("meeting-name failure remains isolated while tasks and updates succeed", async ({
  page,
}) => {
  const control = await openHome(page, { fail: "app_meetings" });
  await expect(page.locator('[data-home-card="meetings"]')).toHaveAttribute(
    "data-state",
    "failed",
  );
  await expect(page.locator('[data-home-card="tasks"]')).toContainText(
    "오늘 항목",
  );
  await expect(page.locator('[data-home-card="updates"]')).toContainText(
    "이번 주 테스트 기록",
  );
  control.setFailure("");
  await page.locator('[data-home-retry="meetings"]').click();
  await expect(page.locator('[data-home-card="meetings"]')).toContainText(
    "테스트 회의",
  );
});
test("project-catalog failure does not block other cards", async ({ page }) => {
  await openHome(page, { fail: "app_spaces" });
  await expect(page.locator('[data-home-card="dday"]')).toHaveAttribute(
    "data-state",
    "failed",
  );
  await expect(page.locator('[data-home-card="tasks"]')).toContainText(
    "오늘 항목",
  );
  await expect(page.locator('[data-home-card="updates"]')).toContainText(
    "이번 주 테스트 기록",
  );
});

test("same-owner session refresh preserves the home and subsequent toggles", async ({
  page,
}) => {
  await openHome(page);
  await expect(page.locator('[data-home-card="tasks"]')).toContainText(
    "오늘 항목",
  );
  await page.evaluate(() => {
    const session = KPTURuntime.session.read();
    window.dispatchEvent(
      new CustomEvent("kptu:session-changed", {
        detail: { session: { ...session, access_token: "home-refreshed" } },
      }),
    );
  });
  await expect(page.locator('[data-home-card="tasks"]')).toContainText(
    "오늘 항목",
  );
  await page.locator('[data-home-toggle="today"]').click();
  await expect(page.locator('[data-home-task="today"]')).toHaveClass(
    /completed/,
  );
});
test("HTTP 200 calendar warning can retry a fresh events request", async ({
  page,
}) => {
  const control = await openHome(page, { calendarWarning: "QA warning" });
  await expect(page.locator('[data-home-card="calendar"]')).toHaveAttribute(
    "data-state",
    "failed",
  );
  control.setCalendarWarning("");
  await page.locator('[data-home-retry="calendar"]').click();
  await expect(page.locator('[data-home-card="calendar"]')).toContainText(
    "오전 일정",
  );
  expect(control.requests.filter((r) => r.action === "events")).toHaveLength(2);
});
test("existing mutation event refreshes home tasks and confirmed links", async ({
  page,
}) => {
  const control = await openHome(page);
  await expect(page.locator('[data-home-card="tasks"]')).toContainText(
    "오늘 항목",
  );
  control.tasks.push({
    id: "new",
    title: "신규 항목",
    due: "2026-10-06",
    status: "needsAction",
  });
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent("kptu:google-tasks-changed")),
  );
  await expect(page.locator('[data-home-card="tasks"]')).toContainText(
    "신규 항목",
  );
  await expect(page.locator("[data-home-unlinked]")).toContainText("4개");
});

test("home chips and update rows open the existing detail dialogs", async ({page}) => {
  await page.setViewportSize({width:390,height:1000});await openHome(page);
  await page.locator('[data-home-project="child"]').click();
  await expect(page.locator('#ps3DetailModal')).toBeVisible();
  await expect(page.locator('#ps3Title')).toHaveText('자식 프로젝트');
  await page.locator('[data-ps3-close="ps3DetailModal"]').click();
  await expect(page.locator('#ps3DetailModal')).toBeHidden();
  await expect(page.locator('#homeView')).toBeVisible();
  await page.locator('[data-home-org="o"]').click();
  await expect(page.locator('#wdModal')).toBeVisible();
  await expect(page.locator('#wdTitle')).toHaveText('테스트 조직');
});

test("phone home follows the supplied reference while desktop stays unchanged", async ({page}) => {
  await page.setViewportSize({width:390,height:1000});await openHome(page);
  const chips=page.locator('[data-home-card="dday"]');await expect(chips).toContainText('D-1');
  await expect(chips).toHaveCSS('border-top-width','0px');
  await expect(chips).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
  const update=page.locator('.home-update').first();await expect(update).toBeVisible();
  const row=await update.evaluate(el=>[...el.children].map(e=>{const r=e.getBoundingClientRect();return {y:r.y+r.height/2}}));
  expect(Math.max(...row.map(r=>r.y))-Math.min(...row.map(r=>r.y))).toBeLessThanOrEqual(2);
  await expect(page.locator('.home-event').nth(1)).toHaveCSS('border-top-width','1px');
  const check=page.locator('.home-task .gt-check').first();const b=await check.boundingBox();expect(b.width).toBeGreaterThanOrEqual(44);expect(b.height).toBeGreaterThanOrEqual(44);
  for(const width of [390,760]) {
    await page.setViewportSize({width,height:1000});await expect(chips).toHaveCSS('border-top-width','0px');
    const chip=page.locator('.home-chip').first();const painted=await chip.evaluate(el=>{const p=getComputedStyle(el,'::before');return el.getBoundingClientRect().height-parseFloat(p.top)-parseFloat(p.bottom)});expect(painted).toBe(28);
  }
  await page.setViewportSize({width:761,height:1000});await expect(chips).toHaveCSS('border-top-width','1px');
  await page.setViewportSize({width:1440,height:1000});await expect(chips).toHaveCSS('border-top-width','1px');
  const desktop=await update.evaluate(el=>[...el.children].map(e=>e.getBoundingClientRect().top));expect(desktop[0]).toBeLessThan(desktop[1]);
});
