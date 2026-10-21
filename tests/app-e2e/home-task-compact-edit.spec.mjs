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
    // The card repaints its rows as project names and links arrive, so rows are found and measured in one page-side
    // call; resolving them first (evaluateAll, boundingBox) can measure rows a repaint has just detached (height 0).
    const sizes = await card.evaluate((c) => [...c.querySelectorAll("[data-home-task]")].map((el) => {
      const box = el.querySelector(".gt-check").getBoundingClientRect();
      return { row: el.getBoundingClientRect().height, text: el.querySelector(".home-task-text").getBoundingClientRect().height, check: [box.width, box.height] };
    }));
    expect(sizes).toHaveLength(2);
    for (const { row } of sizes) expect(row).toBeGreaterThanOrEqual(44);
    for (const { row } of sizes) expect(row).toBeLessThanOrEqual(45);
    for (const { text } of sizes) expect(text).toBe(44);

    const [checkWidth, checkHeight] = sizes[0].check;
    expect(checkWidth).toBeGreaterThanOrEqual(44);
    expect(checkHeight).toBeGreaterThanOrEqual(44);

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
