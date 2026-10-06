import { test, expect } from "@playwright/test";
import { openHome } from './helpers/home-entry.mjs';
import { loginEntry } from "./helpers/login-entry.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
const app = "http://127.0.0.1:8123/app/",
  SB = "https://xmlkxfjeagycwttklxjw.supabase.co";
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
