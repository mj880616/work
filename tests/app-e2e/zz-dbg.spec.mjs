import { test, expect } from '@playwright/test';
import { pinch } from './helpers/pinch.mjs';
test.use({ hasTouch: true });
test('dbg', async ({ page }) => {
  const { bootLibrary, libFolder } = await import('./helpers/library-folder-server.mjs');
  await bootLibrary(page, 412, { folders: [libFolder('fa', 'top-a', { name: '가상 A', sort_order: 1024, color: 4 }), libFolder('fc', 'top-a', { name: '가상 C', parent_id: 'fa', sort_order: 0 })], items: [{ document_id: 'a-1', folder_id: 'fc' }, { document_id: 'n-1', folder_id: 'fa' }] });
  await page.locator('#libraryGroupBy').getByRole('radio', { name: '폴더' }).click();
  await pinch(page, page.locator('#documentList details[data-lu-node="f:fa"] > summary'), 'out');
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/claude-0/libfocus.png' });
});
