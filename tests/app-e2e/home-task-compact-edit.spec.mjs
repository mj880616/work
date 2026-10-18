import { test, expect } from "@playwright/test";
import { openHome } from "./helpers/home-entry.mjs";

// UI-홈할일간격(B안) + UI-할일조작통일: one 44px line per task, no "오늘" helper text, a small date only for overdue ones,
// and a tap on the title opens the task view's existing editor.
for (const width of [412, 870]) {
  test(`home task rows are one 44px line and open the existing editor (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await openHome(page);
    const card = page.locator('[data-home-card="tasks"]');
    const rows = card.locator("[data-home-task]");
    await expect(rows).toHaveCount(2);

    // 44px per line; the 1px separator between rows is the only extra.
    const heights = await rows.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
    for (const h of heights) expect(h).toBeGreaterThanOrEqual(44);
    for (const h of heights) expect(h).toBeLessThanOrEqual(45);
    const text = await rows.evaluateAll((els) => els.map((el) => el.querySelector(".home-task-text").getBoundingClientRect().height));
    for (const h of text) expect(h).toBe(44);

    const check = await rows.first().locator(".gt-check").boundingBox();
    expect(check.width).toBeGreaterThanOrEqual(44);
    expect(check.height).toBeGreaterThanOrEqual(44);

    await expect(card).not.toContainText("오늘 항목 · 오늘");
    await expect(card.locator('[data-home-task="today"] small')).toHaveCount(0);
    await expect(card.locator('[data-home-task="today"]')).not.toContainText(/오늘$/);
    await expect(card.locator('[data-home-task="overdue"] small')).toContainText("10.3 지남");
    await expect(card.locator('[data-home-task="overdue"] .home-overdue')).toBeVisible();

    // The title opens the editor of the task screen; nothing is toggled by it.
    await card.locator('[data-home-task="today"] [data-home-edit]').click();
    await expect(page.locator("#gtTaskModal")).toBeVisible();
    await expect(page.locator("#gtEditTitle")).toHaveValue("오늘 항목");
    await expect(page.locator("#gtToggleBtn")).toBeVisible();
    await expect(page.locator("#gtDeleteBtn")).toBeVisible();
    await expect(card.locator('[data-home-task="today"]')).not.toHaveClass(/completed/);
  });
}
