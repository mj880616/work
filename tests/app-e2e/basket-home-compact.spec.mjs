import { test, expect } from '@playwright/test';
import {noteAction} from './helpers/basket-more.mjs';
import { openHome } from './helpers/home-entry.mjs';
import fs from 'node:fs';
import path from 'node:path';

test.use({ hasTouch: true });
const reviewDir = 'docs/review/basket-clip-icon/compact-regression';
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
    const q = page.locator('#homeView [data-home-quick]');
    const values = { home: await q.evaluate(el => {
      const picker = el.querySelector('[data-quick-file-picker]');
      const zone = picker.querySelector('[data-basket-clip]');
      const entry = el.querySelector('.home-quick-entry');
      const link = el.querySelector('[data-goto="basket"]');
      const style = getComputedStyle(picker);
      return {
        pickerHeight: picker.getBoundingClientRect().height,
        zoneHeight: zone.getBoundingClientRect().height,
        zoneTouch: parseFloat(getComputedStyle(zone, '::after').height) || 0,
        inputToLink: link.getBoundingClientRect().top - entry.getBoundingClientRect().bottom,
        background: style.backgroundColor, padding: style.padding,
      };
    }) };
    expect(values.home.pickerHeight).toBeLessThanOrEqual(width === 390 ? 44 : 80);
    // UI-PC버튼36: PC [📎 첨부] paints 36px (input height) with a 44px ::after touch area.
    expect(values.home.zoneHeight).toBeGreaterThanOrEqual(width === 390 ? 44 : 36);
    if (width !== 390) expect(values.home.zoneTouch).toBeGreaterThanOrEqual(44);
    expect(values.home.inputToLink).toBeLessThanOrEqual(8);
    if (width === 390) {
      expect(values.home.background).toBe('rgba(0, 0, 0, 0)');
      expect(values.home.padding).toBe('0px');
    }
    await saveShot('home');
    await verifySelection(q, 'home');
    await page.locator('#homeView [data-goto="basket"]:visible,.mobile-tabs [data-view="basket"]:visible').click();
    await page.locator('[data-basket-row="n"]').click();
    await noteAction(page,'[data-basket-edit]');
    const detail = page.locator('[data-basket-detail]');
    values.detail = await detail.locator('[data-basket-file-picker]').evaluate(el => ({
      pickerHeight: el.getBoundingClientRect().height,
      zoneHeight: el.querySelector('[data-basket-clip]').getBoundingClientRect().height,
      zoneTouch: parseFloat(getComputedStyle(el.querySelector('[data-basket-clip]'), '::after').height) || 0,
    }));
    // UI-업데이트편집한줄: the edit screen's [📎 첨부] is a small button (32px) in the one button row, touch area 44px.
    expect(values.detail.pickerHeight).toBeLessThanOrEqual(width === 390 ? 46 : 80);
    expect(values.detail.zoneHeight).toBe(32);expect(values.detail.zoneTouch).toBe(44);
    await saveShot('detail');
    await verifySelection(detail, 'detail');
    expect(errors).toEqual([]);
    values.errors = errors;
    await info.attach('picker measurements', { body: JSON.stringify(values, null, 2), contentType: 'application/json' });
    if (capture) fs.writeFileSync(path.join(reviewDir, `after-${width}.json`), JSON.stringify(values, null, 2));

    async function verifySelection(root, name) {
      const zone = root.getByRole('button', { name: '파일 첨부', exact: true });
      const target = name === 'home' ? root : root.locator('.basket-editor');
      await expect(root.locator('[data-basket-hint]')).toBeHidden();
      if (width === 1280) {
        await expect(target).not.toHaveClass(/basket-dragover/);
        const transfer = await page.evaluateHandle(() => {
          const dt = new DataTransfer();
          dt.items.add(new File(['fixture file'], '선택한 파일.txt', { type: 'text/plain' }));
          return dt;
        });
        await target.dispatchEvent('dragover', { dataTransfer: transfer });
        await expect(target).toHaveClass(/basket-dragover/);
        await expect(target).toHaveCSS('outline-style', 'dashed');
        await target.dispatchEvent('drop', { dataTransfer: transfer });
        await expect(target).not.toHaveClass(/basket-dragover/);
        await transfer.dispose();
      } else {
        await expect(zone).toHaveAccessibleName('파일 첨부');
        const button = await zone.boundingBox();
        // UI-업데이트편집한줄: on the edit screen it is a small 32px button whose touch area (::after) is 44px.
        if (name === 'home') expect(button.height).toBeGreaterThanOrEqual(44);
        else { expect(button.height).toBe(32); expect(await zone.evaluate(el => parseFloat(getComputedStyle(el, '::after').height))).toBe(44); }
        expect(button.width).toBeGreaterThanOrEqual(44);
        await zone.focus();
        await expect(zone).toBeFocused();
        const chooser = page.waitForEvent('filechooser');
        await zone.press('Space');
        await (await chooser).setFiles({ name: '선택한 파일.txt', mimeType: 'text/plain', buffer: Buffer.from('fixture file') });
      }
      await expect(root.locator('[data-basket-hint]')).toHaveText('파일당 100MiB · 20개까지');
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
