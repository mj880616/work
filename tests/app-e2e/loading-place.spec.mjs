import { test, expect } from '@playwright/test';
import { start, openFiles } from './helpers/files-server.mjs';
// UI-로딩자리전수(S49-15 A, 명진 요청 11/03 10:37): 로딩 표시는 불러오는 그 칸의 맨 위에 칸 폭 가득 한 줄(공용 wait-state), 한가운데·빈 곳에 뜨지 않는다.
// 불러오는 동안에는 '최근 없음'·'없음' 같은 빈 결과 글이 없고, '맞추는 중' 같은 두 번째 로딩 글자도 없다(다 읽은 뒤에만 결과).
// 느린 응답을 흉내 내(목록 응답 1.5초 지연) 불러오는 도중 모양을 PC 1440·1920에서 본다.
const root = page => page.locator('#filesRoot');
for (const width of [1440, 1920]) {
  test(`[파일] 불러오는 중 (${width}px): 로딩 줄은 목록 칸 맨 위 폭 가득, 없음·맞추는 중 글자 없음, 다 읽으면 목록`, async ({ page }) => {
    test.setTimeout(90000);
    const { errors } = await start(page, width);
    let release;
    const gate = new Promise(ok => { release = ok; });
    // 나중에 만든 길이 먼저 받는다: 목록 응답만 붙잡았다가 놓는다(나머지는 앞의 흉내 서버로).
    await page.route('**/rest/v1/rpc/app_cloud_find_in', async route => { await gate; await route.fallback(); });
    await openFiles(page, width).catch(() => {}); // 목록이 붙잡혀 있으므로 첫 줄을 기다리는 안쪽 대기는 건너뛴다
    const list = root(page).locator('[data-fx-list]');
    const bar = list.locator('.wait');
    await expect(bar).toBeVisible({ timeout: 10000 }); // 0.4초 뒤부터 보인다
    const lb = await list.boundingBox(), bb = await bar.boundingBox();
    expect(bb.y - lb.y).toBeLessThan(12); // 칸 맨 위
    expect(Math.abs(bb.width - lb.width)).toBeLessThan(2); // 칸 폭 가득
    await expect(list.locator('.wait-bar')).toHaveCount(1);
    await expect(root(page).locator('.wait-empty')).toHaveCount(0); // 불러오는 동안 '없음' 글 없음
    await expect(root(page)).not.toContainText('최근 없음');
    await expect(root(page)).not.toContainText('맞추는 중');
    await expect(root(page).locator('.wait-inline')).toHaveCount(0); // 칸 안 구석의 작은 막대 없음
    release();
    await expect(list.locator('[data-fx-row]').first()).toBeVisible({ timeout: 15000 });
    await expect(list.locator('.wait')).toHaveCount(0);
    await expect(root(page)).not.toContainText('맞추는 중');
    expect(errors).toEqual([]);
  });
}
