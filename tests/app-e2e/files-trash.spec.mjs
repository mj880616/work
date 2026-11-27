import { test, expect } from '@playwright/test';
import { start, openFiles } from './helpers/files-server.mjs';
// S69-62 휴지통 보기(명진 11/24 18:17 "파일에서 Google 드라이브 휴지통 볼 수가 없네" / "OneDrive도 마찬가지고 휴지통을 볼 수 있어야 돼. 지운파일 복구하려면").
// [파일] 구글 드라이브·원드라이브 상자 맨 아래 '휴지통' 줄 → 그 클라우드 휴지통 창. 구글은 목록(이름·지운 날·크기, 2개씩 [더 보기]) → 선택 → [되살리기]
// (untrash, confirm:true)로만 되살림, 되살린 파일은 원래 폴더에 다시 보인다. 원드라이브는 목록 길이 없어 웹 휴지통 열기 한 줄. 서버는 흉내.
// FILES-휴지통영구삭제(사용자 결정 2026-11-28 "1 서버에 길을 둬요"): 구글은 줄 그림 단추·고르기 막대 [영구 삭제] → '되돌릴 수 없어요' 확인 → purge(confirm:true).
const root = page => page.locator('#filesRoot');
const sheet = page => page.locator('dialog[data-fx-trash-sheet][open]');
const edge = (server, action) => server.calls.filter(c => c.what === 'edge' && c.action === action);
const GD_TRASH = [
  { id: 'gdT1', name: '가짜 지운 초안.pdf', is_folder: false, size_bytes: 2048, trashed_at: '2026-11-20T01:00:00Z', parent_id: null },
  { id: 'gdT2', name: '가짜 지운 폴더', is_folder: true, size_bytes: null, trashed_at: '2026-11-21T01:00:00Z', parent_id: null },
  { id: 'gdT3', name: '가짜 지운 표.xlsx', is_folder: false, size_bytes: 512, trashed_at: '2026-11-22T01:00:00Z', parent_id: null },
];

for (const width of [412, 1280]) {
  test(`${width}: 구글 드라이브 휴지통 줄 → 목록·더 보기 → 선택해 [되살리기]로 되살림 → 원래 자리에 보임`, async ({ page }) => {
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
    await expect(box.locator('.tr-name')).toHaveText(['가짜 지운 초안.pdf', '가짜 지운 폴더']);
    await expect(box.locator('.tr-day').first()).toContainText('삭제한 날');
    await expect(box.locator('.tr-day').nth(1)).toContainText('폴더');
    // 창은 화면 안, 하단바 위(폰)·가운데 아래(PC).
    const r = await box.boundingBox();
    expect(r.y + r.height).toBeLessThanOrEqual(900);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.x + r.width).toBeLessThanOrEqual(width);
    // 줄마다 그림 단추 ↶ [되살리기] · [영구 삭제]. 휴지통 비우기(통째로)는 없다.
    await expect(box.locator('[data-tr-restore]')).toHaveCount(2);
    await expect(box.locator('[data-tr-restore]').first()).toHaveAttribute('aria-label', /되살리기/);
    await expect(box.locator('[data-tr-purge]')).toHaveCount(2);
    await expect(box.locator('[data-tr-purge]').first()).toHaveAttribute('aria-label', '영구 삭제: 가짜 지운 초안.pdf');
    await expect(box.getByRole('button', { name: /비우기/ })).toHaveCount(0);
    await box.locator('[data-fx-trash-more]').click();
    await expect(box.locator('.tr-name')).toHaveText(['가짜 지운 초안.pdf', '가짜 지운 폴더', '가짜 지운 표.xlsx']);
    await expect(box.locator('[data-fx-trash-more]')).toHaveCount(0);
    // 줄 하나 ↶ 한 번 = 그 파일 하나 되살리기.
    await box.locator('[data-tr-restore="gdT2"]').click();
    await expect.poll(() => edge(server, 'untrash').length).toBe(1);
    expect(edge(server, 'untrash')[0].body).toEqual({ action: 'untrash', source: 'gd', ids: ['gdT2'], confirm: true });
    await expect(box.locator('.tr-name')).toHaveText(['가짜 지운 초안.pdf', '가짜 지운 표.xlsx']);
    // Ctrl+클릭(PC 고르기 방식)으로 둘을 고르면 아래 막대 'N개 선택 · 되살리기 · 영구 삭제' — 막대로 한 번에.
    await box.locator('[data-tr-row="gdT1"] .tr-name').click({ modifiers: ['Control'] });
    await box.locator('[data-tr-row="gdT3"] .tr-name').click();
    await expect(box.locator('[data-tr-bar] .kptu-sb-count')).toHaveText('2개 선택');
    await expect(box.locator('[data-tr-bar]').getByRole('button')).toHaveText(['되살리기', '영구 삭제']);
    await expect(box.locator('[data-tr-restore]')).toHaveCount(0);
    await box.locator('[data-tr-bulk-restore]').click();
    await expect.poll(() => edge(server, 'untrash').length).toBe(2);
    expect(edge(server, 'untrash')[1].body).toEqual({ action: 'untrash', source: 'gd', ids: ['gdT1', 'gdT3'], confirm: true });
    await expect(box.locator('.tr-name')).toHaveCount(0);
    await expect(page.locator('#kptuNotice')).toContainText('2개를 되살렸어요');
    expect(server.items.some(i => i.source === 'gd' && i.item_id === 'gdT2' && !i.trashed)).toBe(true);
    // 창을 닫으면 구글 드라이브 맨 위에 되살린 파일이 다시 보인다(목록을 다시 읽음).
    await box.locator('[data-fx-trash-close]').click();
    await expect(sheet(page)).toHaveCount(0);
    expect(server.items.some(i => i.source === 'gd' && i.item_id === 'gdT1' && !i.trashed)).toBe(true);
    expect(errors).toEqual([]);
  });

  test(`${width}: 구글 드라이브 휴지통 영구 삭제 — 한 줄(확인 창 취소하면 그대로 · [영구 삭제]로 지움) · 고르기 일괄(일부 거절은 개수로)`, async ({ page }) => {
    const { errors, server } = await start(page, width);
    server.gdTrash = GD_TRASH.map(x => ({ ...x }));
    await openFiles(page, width);
    await root(page).locator('[data-fx-box="gd"] [data-fx-cloud-trash="gd"]').click();
    const box = sheet(page);
    await box.locator('[data-fx-trash-more]').click();
    await expect(box.locator('.tr-name')).toHaveText(['가짜 지운 초안.pdf', '가짜 지운 폴더', '가짜 지운 표.xlsx']);
    const ask = page.locator('.kptu-ask');
    // 한 줄 영구 삭제 → 확인 창(되돌릴 수 없어요) → [취소]면 서버를 부르지 않고 그대로.
    await box.locator('[data-tr-purge="gdT1"]').click();
    await expect(ask).toBeVisible();
    await expect(ask.locator('.kptu-ask-text')).toHaveText('“가짜 지운 초안.pdf”을 영구 삭제할까요?');
    await expect(ask.locator('.kptu-ask-note')).toHaveText('삭제하면 되돌릴 수 없어요.');
    const askBox = await ask.boundingBox();
    expect(askBox.x).toBeGreaterThanOrEqual(0);
    expect(askBox.x + askBox.width).toBeLessThanOrEqual(width);
    await ask.getByRole('button', { name: '취소' }).click();
    await expect(ask).toHaveCount(0);
    await expect(box).toBeVisible();
    expect(edge(server, 'purge')).toHaveLength(0);
    await expect(box.locator('.tr-name')).toHaveCount(3);
    // 다시 눌러 [영구 삭제] → 그 파일 하나만 confirm:true로 보내고 목록에서 빠짐.
    await box.locator('[data-tr-purge="gdT1"]').click();
    await ask.getByRole('button', { name: '영구 삭제' }).click();
    await expect.poll(() => edge(server, 'purge').length).toBe(1);
    expect(edge(server, 'purge')[0].body).toEqual({ action: 'purge', source: 'gd', ids: ['gdT1'], confirm: true });
    await expect(box.locator('.tr-name')).toHaveText(['가짜 지운 폴더', '가짜 지운 표.xlsx']);
    await expect(page.locator('#kptuNotice')).toContainText('1개를 영구 삭제했어요');
    await expect(box).toBeVisible();
    // 고르기 일괄: 둘을 고르고 막대 [영구 삭제] → 폴더가 섞이면 '폴더 안 파일도 함께' 안내 → 하나는 서버가 거절하면 '1개는 못 했어요'.
    server.gdPurgeRefuse = ['gdT3'];
    await box.locator('[data-tr-row="gdT2"] .tr-name').click({ modifiers: ['Control'] });
    await box.locator('[data-tr-row="gdT3"] .tr-name').click();
    await expect(box.locator('[data-tr-bar] .kptu-sb-count')).toHaveText('2개 선택');
    await box.locator('[data-tr-bulk-purge]').click();
    await expect(ask.locator('.kptu-ask-text')).toHaveText('선택한 2개를 영구 삭제할까요?');
    await expect(ask.locator('.kptu-ask-note')).toHaveText('폴더 안 파일도 함께 삭제돼요. 삭제하면 되돌릴 수 없어요.');
    await ask.getByRole('button', { name: '영구 삭제' }).click();
    await expect.poll(() => edge(server, 'purge').length).toBe(2);
    expect(edge(server, 'purge')[1].body).toEqual({ action: 'purge', source: 'gd', ids: ['gdT2', 'gdT3'], confirm: true });
    await expect(box.locator('.tr-name')).toHaveText(['가짜 지운 표.xlsx']);
    await expect(box.locator('[data-tr-bar]')).toHaveCount(0);
    await expect(page.locator('#kptuNotice')).toContainText('1개를 영구 삭제했어요 · 1개는 못 했어요');
    expect(edge(server, 'untrash')).toHaveLength(0);
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
