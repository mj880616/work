import { test, expect } from "@playwright/test";
import { openHome } from "./helpers/home-entry.mjs";
// HOME-줄누르기 → HOME-업무일지홈(2026-10-30): 홈(업무일지)의 그날 일정 줄·D-day 칩을 누르면 그 자리로.
// 일정은 달력의 수정 창(새 창 없음)이 홈 위에 열리고, 닫으면 홈 그대로. 옛 '내일'·'놓친 약속' 칸은 홈에서 없앴다.
// 할 일 줄(B·C): 기한은 작은 진회색(.task-due-text), 연결된 사업 보고 이름은 흐린 글씨, 파란 [사업 보고 후속] 꼬리표·칸 없음.
// 고정 시각 2026-10-06 10:00(서울). 고정 자료는 helpers/home-entry.mjs, 여기서는 달력 일정·원장만 바꾼다.
const EVENTS = [
  { id: "multi", title: "여러 날 일정", allDay: true, start: "2026-10-05", end: "2026-10-08", calendarId: "c" },
  { id: "event", title: "오전 일정", start: "2026-10-06T10:00:00+09:00", end: "2026-10-06T11:00:00+09:00", calendarId: "c" },
  { id: "t1", title: "김남근 의원실", start: "2026-10-07T10:00:00+09:00", end: "2026-10-07T11:00:00+09:00", calendarId: "c" },
  { id: "t2", title: "내일 오후 회의", start: "2026-10-07T14:00:00+09:00", end: "2026-10-07T15:00:00+09:00", calendarId: "c" },
];
async function calendarRoutes(page, { milestone = null } = {}) {
  await page.route("**/functions/v1/google-calendar**", (route) => {
    const u = new URL(route.request().url()), action = u.searchParams.get("action");
    if (action === "events") return route.fulfill({ json: { events: EVENTS } });
    if (action === "event") {
      const event = EVENTS.find((e) => e.id === u.searchParams.get("eventId"));
      return event ? route.fulfill({ json: { event: { ...event, recurring: false } } }) : route.fulfill({ status: 404, json: { error: "Not Found" } });
    }
    return route.fallback();
  });
  if (milestone) await page.route("**/rest/v1/app_project_milestones**", (r) => r.fulfill({ json: [milestone] }));
}
const modal = (page) => page.locator("#ciGoogleModal");
const schedule = (page) => page.locator("#homeView [data-journal-schedule]");

for (const width of [412, 884, 1440]) test(`그날 일정 줄을 누르면 그 일정 수정 창이 홈 위에 열리고, 닫으면 홈 그대로 (${width})`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await openHome(page, { beforeLoad: () => calendarRoutes(page) });
  const row = schedule(page).locator(".journal-event-open", { hasText: "오전 일정" });
  await expect(row).toBeVisible();
  await expect(schedule(page).locator("[data-journal-events-count]")).toHaveText("2");
  await row.click();
  await expect(modal(page)).toBeVisible();
  await expect(page.locator("#ciGoogleTitle")).toHaveValue("오전 일정");
  await page.locator("#ciGoogleClose").click();
  await expect(modal(page)).toBeHidden();
  await expect(page.locator("#homeView")).toBeVisible();
  await expect(schedule(page).locator(".journal-event-open", { hasText: "오전 일정" })).toBeVisible();
});

test("달력에 이어진 D-day 칩은 그 일정 수정 창, 이어지지 않은 칩은 그 사업영역 창", async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 900 });
  await openHome(page, { beforeLoad: () => calendarRoutes(page, { milestone: { id: "ms", project_id: "child", title: "민자철도 간담회", start_at: "2026-10-07", status: "planned", google_calendar_id: "c", google_event_id: "t1" } }) });
  const chip = schedule(page).locator("[data-journal-dday] .journal-dday-chip");
  await expect(chip).toHaveText("D-1 민자철도 간담회");
  await expect(chip).toHaveClass(/is-soon/);
  await expect(chip).toHaveAttribute("data-google-event", "t1");
  expect(await chip.evaluate(el => parseFloat(getComputedStyle(el, "::after").height))).toBe(44);
  await chip.click();
  await expect(modal(page)).toBeVisible();
  await expect(page.locator("#ciGoogleTitle")).toHaveValue("김남근 의원실");
});
test("D-day 칩은 오늘을 볼 때만, 다른 날에는 없다", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openHome(page, { beforeLoad: () => calendarRoutes(page) });
  await expect(schedule(page).locator("[data-journal-dday] .journal-dday-chip")).toHaveText(["D-1 주요 일정"]);
  await page.locator('#homeView [data-journal-date="2026-10-07"]').click();
  await expect(page.locator("#homeView [data-journal-title]")).toHaveText("10월 7일 수요일");
  await expect(schedule(page).locator("[data-journal-dday]")).toHaveCount(0);
  const plain = page.locator('#homeView [data-journal-date="2026-10-06"]');
  await plain.click();
  const chip = schedule(page).locator("[data-journal-dday] .journal-dday-chip");
  await expect(chip).toHaveText(["D-1 주요 일정"]);
  await expect(chip).not.toHaveAttribute("data-google-event", /./);
  await chip.click();
  await expect(page.locator("#areaWindow")).toBeVisible();
});

for (const width of [412, 1440]) test(`할 일 줄: 기한은 진회색 작은 글씨, 사업 보고 이름은 흐린 글씨, [사업 보고 후속] 꼬리표 없음 (${width})`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await openHome(page, { beforeLoad: async () => {
    await calendarRoutes(page);
    // 오늘 할 일 하나가 사업 보고(테스트 회의)에 이어져 있다(확인된 연결).
    await page.route("**/rest/v1/app_record_links**", (r) => r.fulfill({ json: [{ google_task_id: "today", meeting_id: "m", status: "confirmed" }] }));
  } });
  const todo = page.locator('#homeView [data-journal-tasks] [data-journal-group="todo"]');
  const today = todo.locator('[data-journal-task="today"]');
  await expect(today).toBeVisible();
  await expect(todo.locator("[data-journal-todo-count]")).toHaveText("2");
  await expect(today.locator("[data-journal-task-due]")).toHaveText("오늘");
  await expect(today.locator("[data-journal-task-meeting]")).toHaveText("테스트 회의");
  // 기한 지난 것(접힌 한 줄) 안: '지남 10.3'.
  const fold = todo.locator("details[data-journal-overdue]");
  await expect(fold.locator("summary")).toHaveText("기한 지난 것 1");
  await fold.locator("summary").click();
  await expect(fold.locator('[data-journal-task="overdue"] [data-journal-task-due]')).toHaveText("지남 10.3");
  await expect(fold.locator('[data-journal-task="overdue"] [data-journal-task-meeting]')).toHaveCount(0);
  const look = await today.evaluate((li) => {
    const c = (sel) => getComputedStyle(li.querySelector(sel));
    return { due: c("[data-journal-task-due]").color, meeting: c("[data-journal-task-meeting]").color, size: c("[data-journal-task-due]").fontSize,
      muted: getComputedStyle(document.documentElement).getPropertyValue("--kptu-muted").trim(), faint: getComputedStyle(document.documentElement).getPropertyValue("--kptu-faint").trim(),
      title: getComputedStyle(li.querySelector(".journal-item-open")).color };
  });
  expect(look.size).toBe("12px");
  expect(look.due).not.toBe(look.title);
  expect(look.due).not.toBe(look.meeting);
  // 진회색 = --kptu-muted, 흐림 = --kptu-faint (노란색 아님).
  const rgb = (hex) => { const n = parseInt(hex.replace("#", ""), 16); return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`; };
  if (/^#[0-9a-f]{6}$/i.test(look.muted)) expect(look.due).toBe(rgb(look.muted));
  if (/^#[0-9a-f]{6}$/i.test(look.faint)) expect(look.meeting).toBe(rgb(look.faint));
  await expect(page.locator("#homeView")).not.toContainText("사업 보고 후속");
  await expect(page.locator("#homeView .home-tag")).toHaveCount(0);
  // 기한 없는 할 일은 할 일 칸에 없고(그날 기한만), 기한 글자도 없다.
  await expect(todo.locator('[data-journal-task="meeting"]')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
