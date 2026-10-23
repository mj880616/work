import { test, expect } from "@playwright/test";
import { openHome } from './helpers/home-entry.mjs';
// HOME-모바일정리②③④(2026-10-22 시안 승인): 폰 홈의 할 일 겹침 정리와 줄·입력칸 높이. PC(1024px 이상)는 그대로.
// 고정 자료(helpers/home-entry.mjs): 오늘 할 일 = 지연 항목·오늘 항목, 회의 후속 = 기한 없는 후속(테스트 회의).
async function linkTodayToMeeting(page, control, { allDue = false } = {}) {
  control.links.push({ google_task_id: "today", meeting_id: "m", status: "confirmed" });
  if (allDue) control.tasks.find((t) => t.id === "meeting").due = "2026-10-06";
  await page.evaluate(() => window.dispatchEvent(new Event("kptu:tasks-changed")));
}
const tasksCard = (page) => page.locator('[data-home-card="tasks"]'),
  meetingsCard = (page) => page.locator('[data-home-card="meetings"]');

test("phone: a task in both 오늘 할 일 and 회의 후속 shows once with a 회의 후속 tag", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const control = await openHome(page);
  await expect(meetingsCard(page)).toContainText("기한 없는 후속");
  await linkTodayToMeeting(page, control);
  const today = tasksCard(page).locator('[data-home-task="today"]');
  await expect(today.locator("[data-home-followup-tag]")).toHaveText("사업 보고 후속");
  await expect(tasksCard(page).locator("[data-home-followup-tag]")).toHaveCount(1);
  await expect(page.locator('#homeView [data-home-task="today"]')).toHaveCount(1);
  await expect(meetingsCard(page)).toBeVisible();
  await expect(meetingsCard(page).locator("[data-home-task]")).toHaveCount(1);
  await expect(meetingsCard(page)).toContainText("기한 없는 후속");
  await expect(meetingsCard(page).locator("[data-home-count]")).toHaveText("1");
  // 꼬리표는 한 줄 안에 작게(제목 줄 높이를 늘리지 않는다).
  const row = await today.boundingBox(), tag = await today.locator("[data-home-followup-tag]").boundingBox();
  expect(tag.height).toBeLessThanOrEqual(20);
  expect(tag.y).toBeGreaterThanOrEqual(row.y);
  expect(tag.y + tag.height).toBeLessThanOrEqual(row.y + row.height);
  await page.screenshot({ path: "test-results/home-mobile-tidy-390.png", fullPage: true });
});

test("phone: when every 회의 후속 is already in 오늘 할 일 the 회의 후속 card is hidden", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const control = await openHome(page);
  await expect(meetingsCard(page)).toBeVisible();
  await linkTodayToMeeting(page, control, { allDue: true });
  await expect(tasksCard(page).locator("[data-home-followup-tag]")).toHaveCount(2);
  await expect(tasksCard(page).locator("[data-home-task]")).toHaveCount(3);
  await expect(meetingsCard(page)).toBeHidden();
});

test("PC keeps both cards as before (no merge, no tag)", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const control = await openHome(page);
  await linkTodayToMeeting(page, control);
  await expect(meetingsCard(page).locator('[data-home-task="today"]')).toBeVisible();
  await expect(tasksCard(page).locator('[data-home-task="today"]')).toBeVisible();
  await expect(page.locator("[data-home-followup-tag]")).toHaveCount(0);
  await expect(meetingsCard(page).locator("[data-home-task]")).toHaveCount(2);
});

test("phone: task rows match calendar rows, small circle, short indent; quick input and [추가] share one low height", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await openHome(page);
  await expect(tasksCard(page).locator("[data-home-task]")).toHaveCount(2);
  await expect(page.locator('[data-home-card="calendar"] .home-event')).toHaveCount(2);
  const m = await page.evaluate(() => {
    const box = (el) => el.getBoundingClientRect();
    const events = [...document.querySelectorAll('[data-home-card="calendar"] .home-event')].map((e) => box(e).height);
    const tasks = [...document.querySelectorAll("#homeView .home-task")].map((e) => box(e).height);
    const check = document.querySelector('[data-home-card="tasks"] .home-task .gt-check');
    const circle = getComputedStyle(check, "::before");
    const card = document.querySelector('[data-home-card="tasks"]'), pad = parseFloat(getComputedStyle(card).paddingLeft);
    const contentLeft = box(card).left + parseFloat(getComputedStyle(card).borderLeftWidth) + pad;
    const title = document.querySelector('[data-home-card="tasks"] .home-task .home-title');
    const input = document.querySelector("#homeView [data-quick-input]"), save = document.querySelector("#homeView .home-quick-save");
    return {
      events, tasks, circle: circle.boxSizing === "border-box" ? parseFloat(circle.width) : parseFloat(circle.width) + parseFloat(circle.borderLeftWidth) + parseFloat(circle.borderRightWidth) + parseFloat(circle.paddingLeft) + parseFloat(circle.paddingRight), check: { w: box(check).width, h: box(check).height },
      circleLeft: box(check).left + parseFloat(circle.left) - contentLeft,
      titleIndent: box(title).left - contentLeft,
      input: { top: box(input).top, h: box(input).height }, save: { top: box(save).top, h: box(save).height },
      saveHit: getComputedStyle(save, "::after").height,
    };
  });
  const event = Math.max(...m.events);
  for (const h of m.tasks) expect(Math.abs(h - event)).toBeLessThanOrEqual(2);
  expect(event).toBeLessThan(40);
  expect(m.circle).toBe(16);
  expect(m.check).toEqual({ w: 44, h: 44 }); // 누르는 범위는 그대로 44px
  expect(Math.abs(m.circleLeft)).toBeLessThanOrEqual(1); // 동그라미는 칸 안쪽 왼쪽 끝에서 시작
  expect(m.titleIndent).toBeLessThanOrEqual(28);
  expect(m.input.h).toBe(36);
  expect(m.save.h).toBe(36);
  expect(Math.abs(m.input.top - m.save.top)).toBeLessThanOrEqual(1);
  expect(m.saveHit).toBe("44px");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
