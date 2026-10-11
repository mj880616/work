import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import fs from 'node:fs';
import path from 'node:path';

test.use({ hasTouch: true });
const reviewDir = 'docs/review/basket-home-compact';
for (const width of [390, 1280]) {
  test(`basket compact picker selection keyboard touch and desktop drop ${width}`, async ({ page }, info) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.setViewportSize({ width, height: 1000 });
    await openHome(page);
    await page.route('**/rest/v1/app_notes**', r => r.fulfill({ json: [
      { id: 'n', raw_text: '테스트 메모', occurred_at: '2026-10-06' },
    ] }));
    const capture = process.env.BASKET_REVIEW_CAPTURE === '1';
    if (capture) fs.mkdirSync(reviewDir, { recursive: true });
    const saveShot = async name => page.screenshot({
      path: capture ? path.join(reviewDir, `after-${name}-${width}.png`) : info.outputPath(`${name}-${width}.png`),
      fullPage: true,
    });
    const q = page.locator('[data-home-quick]');
    const values = { home: await q.evaluate(el => {
      const picker = el.querySelector('[data-quick-file-picker]');
      const zone = picker.querySelector('label');
      const entry = el.querySelector('.home-quick-entry');
      const link = el.querySelector('[data-goto="basket"]');
      const style = getComputedStyle(picker);
      return {
        pickerHeight: picker.getBoundingClientRect().height,
        zoneHeight: zone.getBoundingClientRect().height,
        inputToLink: link.getBoundingClientRect().top - entry.getBoundingClientRect().bottom,
        background: style.backgroundColor, padding: style.padding,
      };
    }) };
    expect(values.home.pickerHeight).toBeLessThanOrEqual(width === 390 ? 44 : 80);
    expect(values.home.zoneHeight).toBeGreaterThanOrEqual(44);
    expect(values.home.inputToLink).toBeLessThanOrEqual(width === 390 ? 60 : 96);
    if (width === 390) {
      expect(values.home.background).toBe('rgba(0, 0, 0, 0)');
      expect(values.home.padding).toBe('0px');
    }
    await saveShot('home');
    await verifySelection(q, 'home');
    await q.locator('[data-goto="basket"]').click();
    await page.locator('[data-basket-row="n"]').click();
    const detail = page.locator('[data-basket-detail]');
    values.detail = await detail.locator('[data-basket-file-picker]').evaluate(el => ({
      pickerHeight: el.getBoundingClientRect().height,
      zoneHeight: el.querySelector('label').getBoundingClientRect().height,
    }));
    expect(values.detail.pickerHeight).toBeLessThanOrEqual(width === 390 ? 44 : 80);
    expect(values.detail.zoneHeight).toBeGreaterThanOrEqual(44);
    await saveShot('detail');
    await verifySelection(detail, 'detail');
    expect(errors).toEqual([]);
    values.errors = errors;
    await info.attach('picker measurements', { body: JSON.stringify(values, null, 2), contentType: 'application/json' });
    if (capture) fs.writeFileSync(path.join(reviewDir, `after-${width}.json`), JSON.stringify(values, null, 2));

    async function verifySelection(root, name) {
      const zone = root.locator('.library-dropzone');
      await expect(root.locator('.library-picker-hint')).toHaveText('파일당 100MiB · 20개까지');
      if (width === 1280) {
        await expect(zone).toHaveCSS('border-top-style', 'dashed');
        const transfer = await page.evaluateHandle(() => {
          const dt = new DataTransfer();
          dt.items.add(new File(['fixture file'], '선택한 파일.txt', { type: 'text/plain' }));
          return dt;
        });
        await zone.dispatchEvent('dragover', { dataTransfer: transfer });
        await expect(zone).toHaveClass(/dragover/);
        await zone.dispatchEvent('drop', { dataTransfer: transfer });
        await expect(zone).not.toHaveClass(/dragover/);
        await transfer.dispose();
      } else {
        await expect(root.locator('.library-picker-mobile')).toHaveText('📎 파일 추가');
        const button = await root.locator('.library-picker-mobile').boundingBox();
        const hint = await root.locator('.library-picker-hint').boundingBox();
        expect(button.height).toBeGreaterThanOrEqual(44);
        expect(Math.abs(button.y + button.height / 2 - hint.y - hint.height / 2)).toBeLessThan(1);
        await zone.focus();
        await expect(zone).toBeFocused();
        const chooser = page.waitForEvent('filechooser');
        await zone.press('Space');
        await (await chooser).setFiles({ name: '선택한 파일.txt', mimeType: 'text/plain', buffer: Buffer.from('fixture file') });
      }
      const row = root.locator('[data-basket-file]');
      await expect(row).toHaveCount(1);
      await expect(row).toContainText('선택한 파일.txt');
      await expect(row).toContainText('12 B');
      await expect(row).toContainText('대기');
      const remove = root.getByRole('button', { name: '선택한 파일.txt 선택 취소' });
      await saveShot(`${name}-selected`);
      if (width === 390) {
        await remove.scrollIntoViewIfNeeded();
        const b = await remove.boundingBox();
        expect(b.height).toBeGreaterThanOrEqual(44);
        await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
      } else await remove.click();
      await expect(row).toHaveCount(0);
      await expect(zone).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  });
}
