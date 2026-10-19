import { test, expect } from '@playwright/test';
import {noteAction} from './helpers/basket-more.mjs';
import { openHome } from './helpers/home-entry.mjs';
import fs from 'node:fs';

test.use({ hasTouch: true });
const dir = 'docs/review/basket-clip-icon';
const files = names => names.map(name => ({ name, mimeType: 'text/plain', buffer: Buffer.from('fixture file') }));
for (const width of [390, 1280]) test(`basket clip placement badge keyboard touch drop and reset ${width}`, async ({ page }, info) => {
  const errors = [], calls = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.setViewportSize({ width, height: 1000 });
  await openHome(page);
  const note = { id: 'n', raw_text: '테스트 메모', occurred_at: '2026-10-06', attachments: [] };
  const homeNote = { id: 'uploaded', raw_text: '', occurred_at: '2026-10-06', attachments: [] };
  await page.route('**/rest/v1/app_notes**', r => r.fulfill({ json: [note, homeNote] }));
  await page.route('**/functions/v1/basket-files', r => {
    calls.push(r.request().postDataBuffer().toString());
    const target = calls.at(-1).includes('name="note_id"\r\n\r\nn') ? note : homeNote;
    target.attachments.push({ file_name: `첨부${calls.length}.txt`, size_bytes: 12, drive_file_id: `file_${calls.length}` });
    return r.fulfill({ json: { ok: true, note_id: target.id, attachments: target.attachments } });
  });
  const capture = process.env.BASKET_REVIEW_CAPTURE === '1';
  if (capture) fs.mkdirSync(dir, { recursive: true });
  const shot = name => page.screenshot({ path: capture ? `${dir}/after-${name}-${width}.png` : info.outputPath(`${name}-${width}.png`), fullPage: true });
  const q = page.locator('#homeView [data-home-quick]'), clip = q.getByRole('button', { name: '파일 첨부', exact: true });
  await expect(clip).toBeVisible();
  const values = { home: await q.evaluate(el => {
    const input = el.querySelector('[data-quick-input]').getBoundingClientRect();
    const clip = el.querySelector('[data-basket-clip]').getBoundingClientRect();
    return { cardHeight: el.getBoundingClientRect().height, inputToLink: el.querySelector('[data-goto="basket"]').getBoundingClientRect().top - el.querySelector('.home-quick-entry').getBoundingClientRect().bottom, input: { x: input.x, y: input.y, width: input.width, height: input.height }, clip: { x: clip.x, y: clip.y, width: clip.width, height: clip.height }, paddingLeft: parseFloat(getComputedStyle(el.querySelector('[data-quick-input]')).paddingLeft) };
  }) };
  // #482's 390px card was 204px: removing the attachment line saves at least 44px.
  // UI-디자인기준 1/3 보완: the mode tabs grew from 30px pills to 46px buttons (+16px).
  expect(values.home.cardHeight).toBeLessThanOrEqual(160 + 16);
  expect(values.home.inputToLink).toBeLessThanOrEqual(8);
  expect(values.home.clip.width).toBeGreaterThanOrEqual(44);
  expect(values.home.clip.height).toBeGreaterThanOrEqual(44);
  expect(values.home.clip.x).toBeGreaterThanOrEqual(values.home.input.x);
  expect(values.home.clip.x + values.home.clip.width).toBeLessThanOrEqual(values.home.input.x + values.home.paddingLeft);
  expect(values.home.clip.y).toBeGreaterThanOrEqual(values.home.input.y);
  expect(values.home.clip.y + values.home.clip.height).toBeLessThanOrEqual(values.home.input.y + values.home.input.height);
  await shot('home');
  await verifyPicker(q, q, 'home');
  await q.locator('[data-quick-save]').click();
  await expect(q.locator('[data-basket-file]')).toHaveCount(0);
  await expect(q.locator('[data-basket-count]')).toBeHidden();
  await expect(q.locator('[data-basket-hint]')).toBeHidden();
  await expect(q.locator('[data-quick-input]')).toHaveValue('');
  await q.locator('[data-quick-mode="task"]').click();
  await expect(clip).toBeHidden();
  const ignored = await transfer('ignored.txt');
  await q.dispatchEvent('dragover', { dataTransfer: ignored });
  await expect(q).not.toHaveClass(/basket-dragover/);
  await q.dispatchEvent('drop', { dataTransfer: ignored });
  await ignored.dispose();
  await q.locator('[data-quick-mode="update"]').click();
  await expect(q.locator('[data-basket-file]')).toHaveCount(0);
  await expect(page.locator('#toast')).toHaveClass(/hidden/);
  await page.locator('#homeView [data-goto="basket"]:visible,.mobile-tabs [data-view="basket"]:visible').click();
  await page.locator('[data-basket-row="n"]').click();
  await noteAction(page,'[data-basket-edit]');
  const detail = page.locator('[data-basket-detail]'), editor = detail.locator('[data-basket-text]');
  const detailClip = detail.getByRole('button', { name: '파일 첨부', exact: true });
  const editorBox = await editor.boundingBox(), clipBox = await detailClip.boundingBox();
  expect(clipBox.y).toBeGreaterThanOrEqual(editorBox.y + editorBox.height);
  expect(Math.abs(clipBox.x - editorBox.x)).toBeLessThanOrEqual(2);
  await shot('detail');
  await editor.fill('미저장 수정은 유지');
  await verifyPicker(detail, detail.locator('.basket-editor'), 'detail');
  await detail.locator('[data-basket-upload]').click();
  await expect(detail.locator('[data-basket-status]')).toHaveText('첨부를 저장했습니다.');
  await expect(detail.locator('[data-basket-file]')).toHaveCount(0);
  await expect(detail.locator('[data-basket-count]')).toBeHidden();
  await expect(detail.locator('[data-basket-hint]')).toBeHidden();
  await expect(editor).toHaveValue('미저장 수정은 유지');
  await expect(detail.locator('[data-basket-attachments] a')).toHaveCount(width === 1280 ? 3 : 2);
  expect(errors).toEqual([]);
  values.errors = errors;
  if (capture) fs.writeFileSync(`${dir}/after-${width}.json`, JSON.stringify(values, null, 2));
  await info.attach('clip measurements', { body: JSON.stringify(values, null, 2), contentType: 'application/json' });

  async function transfer(name) {
    return page.evaluateHandle(name => { const dt = new DataTransfer(); dt.items.add(new File(['fixture file'], name, { type: 'text/plain' })); return dt; }, name);
  }
  async function verifyPicker(root, dropTarget, name) {
    const button = root.getByRole('button', { name: '파일 첨부', exact: true }), badge = root.locator('[data-basket-count]'), hint = root.locator('[data-basket-hint]');
    await expect(root).not.toContainText('파일 추가');
    await expect(badge).toBeHidden();
    await expect(hint).toBeHidden();
    // HOME-빠른입력정리 + BASKET-업데이트통합: the last control before the clip on home is [할 일], right of [업데이트 ▾].
    await (name === 'home' ? root.locator('[data-quick-mode="task"]') : root.locator('textarea')).focus();
    await page.keyboard.press('Tab');
    await expect(button).toBeFocused();
    const chooser = page.waitForEvent('filechooser');
    await button.press(name === 'home' ? 'Space' : 'Enter');
    await (await chooser).setFiles(files(['one.txt']));
    await expect(badge).toHaveText('1');
    const second = page.waitForEvent('filechooser');
    if (width === 390) { const b = await button.boundingBox(); await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); } else await button.click();
    await (await second).setFiles(files(['two.txt', 'cancel.txt']));
    await expect(badge).toHaveText('3');
    await expect(root.locator('[data-basket-file]')).toHaveCount(3);
    await expect(root.locator('[data-basket-file]').first()).toContainText('one.txt');
    await expect(root.locator('[data-basket-file]').first()).toContainText('12 B');
    await expect(root.locator('[data-basket-file]').first()).toContainText('대기');
    await expect(hint).toHaveText('파일당 100MiB · 20개까지');
    const hintBox = await hint.boundingBox(), rowBox = await root.locator('[data-basket-file]').first().boundingBox();
    expect(hintBox.y + hintBox.height).toBeLessThanOrEqual(rowBox.y);
    await root.getByRole('button', { name: 'cancel.txt 선택 취소' }).click();
    await expect(badge).toHaveText('2');
    await shot(`${name}-selected`);
    if (width === 1280) {
      await expect(dropTarget).not.toHaveClass(/basket-dragover/);
      const dt = await transfer('dropped.txt');
      // Accept files over the editor as well as the surrounding card.
      const input = root.locator('textarea');
      await input.dispatchEvent('dragenter', { dataTransfer: dt });
      await input.dispatchEvent('dragover', { dataTransfer: dt });
      await expect(dropTarget).toHaveClass(/basket-dragover/);
      await expect(dropTarget).toHaveCSS('outline-style', 'dashed');
      await shot(`${name}-dragging`);
      await input.dispatchEvent('dragleave', { dataTransfer: dt });
      await expect(dropTarget).not.toHaveClass(/basket-dragover/);
      await dropTarget.dispatchEvent('dragenter', { dataTransfer: dt });
      await dropTarget.dispatchEvent('drop', { dataTransfer: dt });
      await expect(dropTarget).not.toHaveClass(/basket-dragover/);
      await expect(badge).toHaveText('3');
      await expect(root.locator('[data-basket-file]').last()).toContainText('dropped.txt');
      await dt.dispose();
      const text = await page.evaluateHandle(() => { const dt = new DataTransfer(); dt.setData('text/plain', 'ordinary text'); return dt; });
      await input.dispatchEvent('dragover', { dataTransfer: text });
      await expect(dropTarget).not.toHaveClass(/basket-dragover/);
      await text.dispose();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
