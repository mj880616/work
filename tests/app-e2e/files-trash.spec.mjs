import { test, expect } from '@playwright/test';
import { start, openFiles } from './helpers/files-server.mjs';
// S69-62 휴지통 보기(사용자 11/24 18:17 "파일에서 Google 드라이브 휴지통 볼 수가 없네" / "OneDrive도 마찬가지고 휴지통을 볼 수 있어야 돼. 지운파일 복구하려면").
// [파일] 구글 드라이브·원드라이브 상자 맨 아래 '휴지통' 줄 → 그 클라우드 휴지통 창. 구글은 목록(이름·지운 날·크기, 2개씩 [더 보기]) → 선택 → [되살리기]
// (untrash, confirm:true)로만 되살림, 되살린 파일은 원래 폴더에 다시 보인다. 원드라이브는 목록 길이 없어 웹 휴지통 열기 한 줄. 영구 삭제 단추는 없다. 서버는 흉내.
const root = page => page.locator('#filesRoot');
const sheet = page => page.locator('dialog[data-fx-trash-sheet][open]');
const edge = (server, action) => server.calls.filter(c => c.what === 'edge' && c.action === action);
const GD_TRASH = [
  { id: 'gdT1', name: '가짜 지운 초안.pdf', is_folder: false, size_bytes: 2048, trashed_at: '2026-11-20T01:00:00Z', parent_id: null },
  { id: 'gdT2', name: '가짜 지운 폴더', is_folder: true, size_bytes: null, trashed_at: '2026-11-21T01:00:00Z', parent_id: null },
  { id: 'gdT3', name: '가짜 지운 표.xlsx', is_folder: false, size_bytes: 512, trashed_at: '2026-11-22T01:00:00Z', parent_id: null },
];

for (const width of [390, 1280]) {
  test(`${width}: 구글 드라이브 휴지통 줄 → 목록·더 보기 → 선택해 [되살리기]만으로 되살림 → 원래 자리에 보임 · 영구 삭제 없음`, async ({ page }) => {
    const { errors, server } = await start(page, width);
    server.gdTrash = GD_TRASH.map(x => ({ ...x }));
    await openFiles(page, width);
    const trashRow = root(page).locator('[data-fx-box="gd"] [data-fx-cloud-trash="gd"]');
    await expect(trashRow).toBeVisible();
    await expect(trashRow).toHaveText('휴지통');
    await trashRow.click();
    const box = sheet(page);
    await expect(box).toBeVisible();
    await expect(box.locator('#fxTrashTitle')).toHaveText('구글 드라이브 휴지통');
    await expect(box.locator('.fx-dest-note')).toContainText('내 드라이브에서 직접 삭제한 것만');
    await expect(box.locator('.fx-trash-name')).toHaveText(['가짜 지운 초안.pdf', '가짜 지운 폴더']);
    await expect(box.locator('.fx-trash-meta').first()).toContainText('삭제');
    await expect(box.locator('.fx-trash-meta').nth(1)).toContainText('폴더');
    // 창은 화면 안, 하단바 위(폰)·가운데 아래(PC).
    const r = await box.boundingBox();
    expect(r.y + r.height).toBeLessThanOrEqual(900);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.x + r.width).toBeLessThanOrEqual(width);
    // 고르기 전에는 [되살리기]가 꺼져 있고, 영구 삭제 단추는 어디에도 없다.
    const restore = box.locator('[data-fx-trash-restore]');
    await expect(restore).toBeDisabled();
    await expect(box.getByRole('button', { name: /영구|비우기/ })).toHaveCount(0);
    await box.locator('[data-fx-trash-more]').click();
    await expect(box.locator('.fx-trash-name')).toHaveText(['가짜 지운 초안.pdf', '가짜 지운 폴더', '가짜 지운 표.xlsx']);
    await expect(box.locator('[data-fx-trash-more]')).toHaveCount(0);
    await box.locator('[data-fx-trash-pick="gdT1"]').check();
    await box.locator('[data-fx-trash-pick="gdT3"]').check();
    await expect(box.locator('.fx-dest-at')).toHaveText('2개 선택');
    expect(edge(server, 'untrash')).toHaveLength(0);
    await restore.click();
    await expect.poll(() => edge(server, 'untrash').length).toBe(1);
    expect(edge(server, 'untrash')[0].body).toEqual({ action: 'untrash', source: 'gd', ids: ['gdT1', 'gdT3'], confirm: true });
    await expect(box.locator('.fx-trash-name')).toHaveText(['가짜 지운 폴더']);
    await expect(page.locator('#kptuNotice')).toContainText('2개를 되살렸어요');
    // 창을 닫으면 구글 드라이브 맨 위에 되살린 파일이 다시 보인다(목록을 다시 읽음).
    await box.locator('[data-fx-trash-close]').click();
    await expect(sheet(page)).toHaveCount(0);
    expect(server.items.some(i => i.source === 'gd' && i.item_id === 'gdT1' && !i.trashed)).toBe(true);
    expect(errors).toEqual([]);
  });

  test(`${width}: 원드라이브 휴지통 줄 → 목록 대신 원드라이브 웹 휴지통 열기 한 줄 · 뒤로가기·Esc로 닫힘`, async ({ page }) => {
    const { errors, server } = await start(page, width);
    await openFiles(page, width);
    const trashRow = root(page).locator('[data-fx-box="od"] [data-fx-cloud-trash="od"]');
    await expect(trashRow).toBeVisible();
    await trashRow.click();
    const box = sheet(page);
    await expect(box.locator('#fxTrashTitle')).toHaveText('원드라이브 휴지통');
    await expect(box.locator('.fx-dest-note')).toContainText('원드라이브 웹에서만');
    const link = box.locator('[data-fx-trash-web]');
    await expect(link).toHaveAttribute('href', 'https://onedrive.live.com/?v=recyclebin');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);
    expect(edge(server, 'trash_list').map(c => c.body.source)).toEqual(['od']);
    await page.keyboard.press('Escape');
    await expect(sheet(page)).toHaveCount(0);
    await expect(trashRow).toBeFocused();
    // 다시 열고 뒤로가기 한 번 = 창만 닫힘(화면은 [파일] 그대로).
    await trashRow.click();
    await expect(sheet(page)).toBeVisible();
    await page.goBack();
    await expect(sheet(page)).toHaveCount(0);
    await expect(page.locator('#filesView')).toBeVisible();
    expect(errors).toEqual([]);
  });
}
