import { test, expect } from "@playwright/test";
import { openHome } from "./helpers/home-entry.mjs";
// HOME-모바일홈채우기(2026-10-24 시안 승인): 폰·중간 폭 홈의 한 줄 요약과 새 칸. PC(1024px~) 홈은 그대로.
// 고정 시각 2026-10-06 10:00(서울). 고정 자료(home-entry.mjs): 오늘 일정 2건, 오늘 할 일 2건(기한 없는 후속은 제외).
const SB_LEDGER = "**/rest/v1/app_ledger_records**";
const ledgerRow = (n, due, extra = {}) => ({ id: `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`, ledger_id: `L-${n}`, kind: "commitment", title: `상대가 약속한 일 ${n}`, summary: "", commitment_status: "waiting", validity: "current", counterparty: "사측", follow_up_on: due, ...extra });
const card = (page, key) => page.locator(`[data-home-card="${key}"]`);

for (const [name, width] of [["390", 390], ["폴드 접힘 344", 344]]) {
  test(`phone ${name}: summary line, flat cards, 놓친 약속 · 내일, nothing runs off the screen`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openHome(page, {
      beforeLoad: async () => {
        await page.route(SB_LEDGER, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([
          ledgerRow(1, "2026-10-03"), ledgerRow(2, "2026-10-01", { title: "아주 긴 제목 ".repeat(12) }), ledgerRow(3, "2026-10-05"), ledgerRow(4, "2026-10-04"),
        ]) }));
        await page.route("**/rest/v1/app_feed_days**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ day: "2026-10-06", source: "telegram", total_count: 30, kept_count: 12, room_count: 4, failed_count: 0 }]) }));
      },
    });
    // 한 줄 요약: 일정 2(오늘) · 할 일 2(기한 지난/오늘) · 새 소식 12(텔레그램 소식 메뉴의 중요한 소식 수)
    await expect(page.locator("[data-home-summary]")).toHaveText("일정 2 · 할 일 2 · 새 소식 12");
    // 칸 순서: 오늘 일정 → 오늘 할 일 → 놓친 약속 → (정리 안 된 것: 0건이라 없음) → 내일
    const order = await page.locator('#homeView [data-home-column="main"] > [data-home-card]:not([hidden])').evaluateAll((els) => els.map((e) => e.dataset.homeCard));
    expect(order.slice(0, 4)).toEqual(["calendar", "tasks", "missed", "tomorrow"]);
    // 놓친 약속: 오래된 확인일 먼저 3건, n일째 꼬리표, 원장 ›
    const rows = card(page, "missed").locator("[data-home-missed]");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0).locator(".home-day-tag")).toHaveText("5일째");
    await expect(rows.nth(2).locator(".home-day-tag")).toHaveText("2일째");
    await expect(card(page, "missed").locator('[data-goto="ledger"]')).toHaveText("원장 ›");
    // 긴 제목은 한 줄에서 말줄임 (줄이 늘어나지 않고 화면 밖으로 나가지 않음)
    const long = rows.nth(0).locator(".home-title");
    const lh = await long.evaluate((el) => ({ clipped: el.scrollWidth > el.clientWidth, h: el.getBoundingClientRect().height, line: parseFloat(getComputedStyle(el).lineHeight) }));
    expect(lh.clipped).toBe(true);
    expect(lh.h).toBeLessThanOrEqual(lh.line + 1);
    // 내일: 한 줄 미리보기(내일 일정이 있는 날짜 고정 자료: 여러 날 일정 하나)
    await expect(card(page, "tomorrow")).toContainText("여러 날 일정");
    // 테두리 없는 칸 + 얇은 줄
    const flat = await card(page, "calendar").evaluate((el) => { const s = getComputedStyle(el); return { border: s.borderTopWidth, radius: s.borderTopLeftRadius }; });
    expect(flat).toEqual({ border: "0px", radius: "0px" });
    expect(await card(page, "tasks").evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe("1px");
    // 챙길 것 카드는 폰에서 보이지 않는다
    await expect(card(page, "radar")).toBeHidden();
    // 가로로 넘치지 않음
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `test-results/home-mobile-fill-${width}.png`, fullPage: true });
  });
}

test("phone: 놓친 약속과 내일이 비면 '없음' 한 줄, 새 소식을 모르면 요약에서 뺀다, 정리 안 된 것 0건이면 줄이 없다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await openHome(page);
  await expect(card(page, "missed")).toContainText("없음");
  await expect(card(page, "missed").locator("[data-home-missed]")).toHaveCount(0);
  await expect(page.locator("[data-home-summary]")).toHaveText("일정 2 · 할 일 2");
  await expect(card(page, "inbox")).toBeHidden();
  await expect(page.locator(".home-fill-inbox-line")).toHaveCount(0);
});

test("phone: 정리 안 된 것 n건 줄은 정리함으로 간다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await openHome(page, {
    beforeLoad: async () => {
      await page.route("**/rest/v1/app_notes**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([
        { id: "n1", raw_text: "메모 1", attachments: [], metadata: {}, archived_at: null, created_at: "2026-10-05T00:00:00Z", updated_at: "2026-10-05T00:00:00Z", kind: "memo" },
      ]) }));
    },
  });
  const line = page.locator(".home-fill-inbox-line");
  await expect(line).toContainText("정리 안 된 것");
  await expect(line).toContainText("건 ›");
  await line.click();
  await expect(page.locator("#basketView")).toBeVisible();
});

test("phone: 할 일은 2건만 보이고 '+ n건 더'로 펼친다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const control = await openHome(page);
  control.tasks.push({ id: "t3", title: "셋째 항목", due: "2026-10-06", status: "needsAction", taskListId: "default" }, { id: "t4", title: "넷째 항목", due: "2026-10-06", status: "needsAction", taskListId: "default" });
  await page.evaluate(() => window.dispatchEvent(new Event("kptu:tasks-changed")));
  const rows = card(page, "tasks").locator("[data-home-task]");
  await expect(rows).toHaveCount(2);
  await expect(card(page, "tasks").locator("[data-home-tasks-more]")).toHaveText("+ 2건 더");
  await expect(page.locator("[data-home-summary]")).toContainText("할 일 4");
  await card(page, "tasks").locator("[data-home-tasks-more]").click();
  await expect(rows).toHaveCount(4);
  await card(page, "tasks").locator("[data-home-tasks-more]").click();
  await expect(rows).toHaveCount(2);
});

test("PC keeps the home as before (no summary, no new cards, 챙길 것 카드 자리 그대로)", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openHome(page);
  await expect(card(page, "calendar")).toBeVisible();
  await expect(page.locator("[data-home-summary]")).toBeHidden();
  for (const key of ["missed", "inbox", "tomorrow"]) await expect(card(page, key)).toBeHidden();
  const flat = await card(page, "calendar").evaluate((el) => getComputedStyle(el).borderTopWidth);
  expect(flat).toBe("1px");
});
