import { appOrigin } from './helpers/test-origin.mjs';
import { test, expect } from "@playwright/test";
import { openHome } from './helpers/home-entry.mjs';
import { loginEntry } from "./helpers/login-entry.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import {expectProjectTitle} from './helpers/screen-title.mjs';
const app = `${appOrigin}/app/`,
  SB = "https://xmlkxfjeagycwttklxjw.supabase.co";
for (const width of [390, 1440])
  test(`home reading cards, shared requests and snapshot ${width}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    const { requests } = await openHome(page, { delay: 300 });
    await expect(page.locator("#homeView")).toBeVisible();
    await expect(page.locator('[data-home-card="updates"]')).toHaveCount(0);
    await expect(page.locator('[data-home-unlinked]')).toHaveCount(0);
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
    // JOURNAL-챙길것: the 챙길 것 card has its own budget: one candidate read and one ai-assist call (first open of the day).
    const radarRequest = (r) => r.path === "/rest/v1/app_todo_candidates" || r.path.endsWith("/functions/v1/ai-assist");
    // 폰·중간 폭(HOME-모바일홈채우기)은 '정리 안 된 것' 숫자가 후보를 한 번 더 읽는다(PC는 1회).
    expect(requests.filter((r) => r.path === "/rest/v1/app_todo_candidates").length).toBeLessThanOrEqual(width<761 ? 2 : 1);
    expect(requests.filter((r) => r.path.endsWith("/functions/v1/ai-assist")).length).toBeLessThanOrEqual(1);
    // OPS-수집점검: the 마지막 수집 시각 card has its own budget: one status read and one radar state read.
    const collectRequest = (r) => r.path === "/rest/v1/app_todo_radar_state" || r.path.endsWith("/functions/v1/drive-summary");
    expect(requests.filter((r) => r.path === "/rest/v1/app_todo_radar_state").length).toBeLessThanOrEqual(1);
    expect(requests.filter((r) => r.path.endsWith("/functions/v1/drive-summary")).length).toBeLessThanOrEqual(1);
    expect(requests.filter((r) => r.path.endsWith("/functions/v1/drive-summary") && r.action !== "status")).toHaveLength(0);
    // HOME-모바일홈채우기: 폰·중간 폭의 새 칸(놓친 약속 · 새 소식 수 · 정리 안 된 것)은 자기 예산을 가진다: 원장 1회, 소식 1회, 정리함 숫자용 읽기(업데이트·연결·자료)뿐.
    const fillPaths = ["app_ledger_records", "app_feed_days", "app_notes", "app_record_links", "app_documents"];
    const fillRequest = (r) => width<761 && fillPaths.some((x) => r.path.endsWith(x)) && (!r.path.endsWith("app_record_links") || r.query.includes("note_id"));
    expect(requests.filter((r) => r.path.endsWith("app_ledger_records")).length).toBeLessThanOrEqual(1);
    expect(requests.filter((r) => r.path.endsWith("app_feed_days")).length).toBeLessThanOrEqual(1);
    // FEAT-1029묶음 ③: '연락 없는 조직' 줄은 자기 예산을 가진다: 주요 인물 1회(없으면 거기서 멈춤).
    const quietRequest = (r) => r.path === "/rest/v1/app_org_key_people";
    expect(requests.filter(quietRequest).length).toBeLessThanOrEqual(1);
    const dataRequests = requests.filter(
      (r) => (r.path.includes("/rest/") || r.path.includes("/functions/")) && !radarRequest(r) && !collectRequest(r) && !fillRequest(r) && !quietRequest(r),
    );
    const basketRequests=requests.filter(r=>r.path.endsWith('app_record_links')&&r.query.includes('note_id=not.is.null'));
    expect(basketRequests).toHaveLength(0);
    expect(requests.filter(r=>r.path.endsWith('app_suborganization_updates'))).toHaveLength(0);
    expect(dataRequests.length).toBeLessThanOrEqual(9);
    expect(requests.filter((r) => r.action === "overview")).toHaveLength(1);
    expect(
      requests.filter((r) => r.path.endsWith("app_record_links")&&!r.query.includes("note_id=not.is.null")),
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
  await expect(page.locator('[data-home-card="updates"]')).toHaveCount(0);
  control.setFailure("");
  await page.locator('[data-home-retry="calendar"]').click();
  await expect(page.locator('[data-home-card="calendar"]')).toContainText(
    "오전 일정",
  );
});
test("home completion retains row 3s and task view agrees", async ({
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
  await page.locator('[data-home-card="tasks"] [data-goto="tasks"]').click();
  await expect(page.locator("#tasksView")).toBeVisible();
  await expect(page.locator("#tasksView .home-quick [data-quick-save]")).toHaveText("추가");
  await expect(page.locator("[data-gt-overdue]")).toBeVisible();
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
  await expect(page.locator('[data-home-card="updates"]')).toHaveCount(0);
});
test("meeting-name failure remains isolated while tasks and calendar succeed", async ({
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
  await expect(page.locator('[data-home-card="updates"]')).toHaveCount(0);
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
  await expect(page.locator('[data-home-card="updates"]')).toHaveCount(0);
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
  await expect(page.locator("[data-home-unlinked]")).toHaveCount(0);
});

test("home chips open the existing project detail dialog", async ({page}) => {
  await page.setViewportSize({width:390,height:1000});await openHome(page);
  await page.locator('[data-home-project="child"]').click();
  await expect(page.locator('#ps3DetailModal')).toBeVisible();
  await expectProjectTitle(page,'자식 프로젝트');
  await page.locator('[data-ps3-close="ps3DetailModal"]').click();
  await expect(page.locator('#ps3DetailModal')).toBeHidden();
  await expect(page.locator('#homeView')).toBeVisible();
});

test("phone home follows the supplied reference while desktop stays unchanged", async ({page}) => {
  await page.setViewportSize({width:390,height:1000});await openHome(page);
  const chips=page.locator('[data-home-card="dday"]');await expect(chips).toContainText('D-1');
  await expect(chips).toHaveCSS('border-top-width','0px');
  await expect(chips).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
  await expect(page.locator('.home-event').nth(1)).toHaveCSS('border-top-width','1px');
  await expect(page.locator('.home-task .gt-check').first()).toBeVisible();
  // Found and measured in one page-side call: the card repaints its rows as data arrives, so a located element can be detached before it is measured.
  const b=await page.evaluate(()=>{const r=document.querySelector('.home-task .gt-check').getBoundingClientRect();return {width:r.width,height:r.height}});expect(b.width).toBeGreaterThanOrEqual(44);expect(b.height).toBeGreaterThanOrEqual(44);
  for(const width of [390,760]) {
    await page.setViewportSize({width,height:1000});await expect(chips).toHaveCSS('border-top-width','0px');
    const chip=page.locator('.home-chip').first();const painted=await chip.evaluate(el=>{const p=getComputedStyle(el,'::before');return el.getBoundingClientRect().height-parseFloat(p.top)-parseFloat(p.bottom)});expect(painted).toBe(28);
  }
  await page.setViewportSize({width:761,height:1000});await expect(chips).toHaveCSS('border-top-width','1px');
  await page.setViewportSize({width:1440,height:1000});await expect(chips).toHaveCSS('border-top-width','1px');
});
