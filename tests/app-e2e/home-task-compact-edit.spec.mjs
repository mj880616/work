import { test, expect } from "@playwright/test";
import { openHome } from "./helpers/home-entry.mjs";

// UI-홈할일간격(B안) + UI-할일조작통일 (+ HOME-모바일정리③ 줄 높이): one line per task, no "오늘" helper text, a small date only for overdue ones,
// and a tap on the title opens the task view's existing editor.
for (const width of [412, 870]) {
  test(`home task rows are one compact line and open the existing editor (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await openHome(page);
    const card = page.locator('[data-home-card="tasks"]');
    const rows = card.locator("[data-home-task]");
    await expect(rows).toHaveCount(2);

    // HOME-모바일정리③(2026-10-22): 폰·중간 폭은 일정 줄과 같은 높이(약 36px). 동그라미·제목의 누르는 범위는 44px 그대로.
    // The card repaints its rows as project names and links arrive, so rows are found and measured in one page-side
    // call; resolving them first (evaluateAll, boundingBox) can measure rows a repaint has just detached (height 0).
    const sizes = await card.evaluate((c) => [...c.querySelectorAll("[data-home-task]")].map((el) => {
      const box = el.querySelector(".gt-check").getBoundingClientRect();
      const text = el.querySelector(".home-task-text");
      return { row: el.getBoundingClientRect().height, text: text.getBoundingClientRect().height, textHit: getComputedStyle(text, "::after").height, check: [box.width, box.height] };
    }));
    expect(sizes).toHaveLength(2);
    for (const { row } of sizes) expect(row).toBeGreaterThanOrEqual(35);
    for (const { row } of sizes) expect(row).toBeLessThanOrEqual(38);
    for (const { text, textHit } of sizes) { expect(text).toBeGreaterThanOrEqual(34); expect(textHit).toBe("44px"); }

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
