import { test, expect } from "@playwright/test";
import { openHome } from "./helpers/home-entry.mjs";
// HOME-줄누르기(요청함 10/28 19:16, 명진 'ㅇ'): 홈의 오늘 일정·내일·D-day 칩·놓친 약속 줄을 누르면 그 자리로.
// 일정은 달력의 수정 창(새 창 없음)이 홈 위에 열리고, 닫으면 홈 그대로. 우클릭(PC)은 달력의 일정 메뉴.
// 고정 시각 2026-10-06 10:00(서울). 고정 자료는 helpers/home-entry.mjs, 여기서는 달력 일정·원장만 바꾼다.
const EVENTS = [
  { id: "multi", title: "여러 날 일정", allDay: true, start: "2026-10-05", end: "2026-10-08", calendarId: "c" },
  { id: "event", title: "오전 일정", start: "2026-10-06T10:00:00+09:00", end: "2026-10-06T11:00:00+09:00", calendarId: "c" },
  { id: "t1", title: "김남근 의원실", start: "2026-10-07T10:00:00+09:00", end: "2026-10-07T11:00:00+09:00", calendarId: "c" },
  { id: "t2", title: "내일 오후 회의", start: "2026-10-07T14:00:00+09:00", end: "2026-10-07T15:00:00+09:00", calendarId: "c" },
];
const LEDGER_ID = "a0000000-0000-4000-8000-000000000001";
const ledgerRow = { id: LEDGER_ID, ledger_id: "L-1", kind: "commitment", title: "상대가 약속한 일", summary: "", commitment_status: "waiting", validity: "current", counterparty: "사측", follow_up_on: "2026-10-03" };
async function calendarRoutes(page, { milestone = null, ledger = false } = {}) {
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
  if (ledger) await page.route("**/rest/v1/app_ledger_records**", (r) => r.fulfill({ json: [ledgerRow] }));
}
const card = (page, key) => page.locator(`[data-home-card="${key}"]`);
const modal = (page) => page.locator("#ciGoogleModal");

test("phone: 오늘 일정 줄을 누르면 그 일정 수정 창이 홈 위에 열리고, 닫으면 홈 그대로", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await openHome(page, { beforeLoad: () => calendarRoutes(page) });
  const row = card(page, "calendar").locator('[data-google-event="event"]');
  await expect(row).toBeVisible();
  await row.click();
  await expect(modal(page)).toBeVisible();
  await expect(page.locator("#ciGoogleTitle")).toHaveValue("오전 일정");
  await page.locator("#ciGoogleClose").click();
  await expect(modal(page)).toBeHidden();
  await expect(page.locator("#homeView")).toBeVisible();
  await expect(card(page, "calendar").locator('[data-google-event="event"]')).toBeVisible();
});

test("phone: 내일 첫 줄은 수정 창, '외 n건'은 내일 일정을 펼치고 각 줄도 수정 창", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await openHome(page, { beforeLoad: () => calendarRoutes(page) });
  const tomorrow = card(page, "tomorrow");
  await expect(tomorrow.locator("[data-google-event]")).toHaveCount(1);
  const more = tomorrow.locator('[data-home-tomorrow-more="open"]');
  await expect(more).toHaveText("외 2건");
  await more.click();
  await expect(tomorrow.locator("[data-google-event]")).toHaveCount(3);
  await tomorrow.locator('[data-google-event="t1"]').click();
  await expect(modal(page)).toBeVisible();
  await expect(page.locator("#ciGoogleTitle")).toHaveValue("김남근 의원실");
  await page.locator("#ciGoogleClose").click();
  await expect(modal(page)).toBeHidden();
  await tomorrow.locator('[data-home-tomorrow-more="close"]').click();
  await expect(tomorrow.locator("[data-google-event]")).toHaveCount(1);
});

test("phone: 달력에 이어진 D-day 칩은 그 일정 수정 창", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await openHome(page, { beforeLoad: () => calendarRoutes(page, { milestone: { id: "ms", project_id: "child", title: "민자철도 간담회", start_at: "2026-10-07", status: "planned", google_calendar_id: "c", google_event_id: "t1" } }) });
  const chip = card(page, "dday").locator(".home-chip");
  await expect(chip).toContainText("민자철도 간담회");
  await expect(chip).toHaveAttribute("data-google-event", "t1");
  await chip.click();
  await expect(modal(page)).toBeVisible();
  await expect(page.locator("#ciGoogleTitle")).toHaveValue("김남근 의원실");
});

test("phone: 놓친 약속 줄을 누르면 원장에서 그 약속이 펼쳐진다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await openHome(page, { beforeLoad: () => calendarRoutes(page, { ledger: true }) });
  const row = card(page, "missed").locator(`[data-home-missed="${LEDGER_ID}"]`);
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.locator("#ledgerView")).toBeVisible();
  await expect(page.locator(`#ledgerView [data-lb-action="open"][data-lb-id="${LEDGER_ID}"]`).first()).toHaveAttribute("aria-expanded", "true");
});

test("PC: 오늘 일정 줄 우클릭은 달력의 일정 메뉴를 누른 자리에 연다", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openHome(page, { beforeLoad: () => calendarRoutes(page) });
  const row = card(page, "calendar").locator('[data-google-event="event"]');
  await expect(row).toBeVisible();
  await row.click({ button: "right" });
  const menu = page.locator("#calendarEventMenu");
  await expect(menu).toBeVisible();
  await expect(menu.locator("[data-calendar-event-act]").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
});
