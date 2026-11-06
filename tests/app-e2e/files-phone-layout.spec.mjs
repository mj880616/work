import { test, expect } from '@playwright/test';
import { start, openFiles, treeGo } from './helpers/files-server.mjs';
// S49-17 FILES-폰화면깨짐: 폰에서 정렬 칸이 폭 가득 빈 칸으로 보이던 것, 안 읽은 폴더가 '0개'로 보이던 것, 개인 중요 보관소가 0B 파일로 보이던 것.
// 폭 세 가지: 폰 390 · 펼친 폴드 900 · PC 1440. 이름·id는 모두 가짜.
const root = page => page.locator('#filesRoot');
const VAULT = { source: 'od', item_id: 'OD!99', parent_id: null, name: '가짜 잠긴 보관소', is_folder: false, mime: null, size_bytes: 0, modified_at: '2024-11-26T01:00:00Z', hash: null, trashed: false, starred: false, library_doc_id: null };

for (const width of [390, 900, 1440]) {
  test(`[파일] ${width}폭: 정렬 칸은 작은 칩 · 폴더 개수는 읽은 뒤에만 · 잠긴 보관소는 목록에 없음`, async ({ page }) => {
    test.setTimeout(90000);
    const { errors, server } = await start(page, width);
    server.items.push(VAULT);
    await openFiles(page, width);
    const phone = width <= 760;
    await treeGo(page, 'od');
    const list = root(page).locator('[data-fx-list]');
    await expect(list.locator('[data-fx-row]').first()).toBeVisible();
    // 정렬 칸: 폭 가득이 아니다.
    const sort = (await root(page).locator('[data-fx-sort]').boundingBox());
    expect(sort.width).toBeLessThan(130);
    // 폰은 표 머리가 없다. 보이는 머리 칸·손잡이 0.
    if (phone) {
      await expect(root(page).locator('.fx-head:visible')).toHaveCount(0);
      await expect(root(page).locator('.col-grip:visible')).toHaveCount(0);
    }
    // 잠긴 보관소(종류 없는 0B)는 목록에 없다.
    await expect(list.getByText('가짜 잠긴 보관소')).toHaveCount(0);
    // 폴더를 열기 전: 개수 글자 없음('0개' 아님). 연 뒤: 실제 개수.
    const row = name => list.locator('[data-fx-row]', { hasText: name });
    const text = async name => (await row(name).innerText()).replace(/\s+/g, ' ');
    expect(await text('가짜 문서함')).not.toMatch(/\d+개|폴더 \d|파일 \d/);
    await row('가짜 문서함').click();
    await expect(list.getByText('가짜 안내문.pdf')).toBeVisible();
    // 열린 폴더 안: 하위 폴더 줄(가짜 2026)은 아직 안 읽음 → 비어 있다.
    expect(await text('가짜 2026')).not.toMatch(/\d+개/);
    await root(page).locator('[data-fx-go]:visible').first().click();
    await expect(list.getByText('가짜 문서함')).toBeVisible();
    expect(await text('가짜 문서함')).toContain('폴더 1 · 파일 3');
    expect(await root(page).evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });
}
