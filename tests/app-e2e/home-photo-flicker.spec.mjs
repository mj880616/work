import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { CELL_PX, GAP_PX } from '../../app/home-day-photos-model.mjs';
// HOME-오늘사진깜빡임(2026-11-09): 홈에 들어오거나 다시 그려질 때 '오늘 사진' 줄의 사진 칸을 지우고 새로 만들어 깜빡이던 문제.
// 사진 칸(button)과 그 안 그림(img)이 새로 만들어진 횟수를 MutationObserver로 센다. 같은 목록이면 칸 수만큼(한 칸에 한 번)만 만들어져야 한다.
// 가짜 서버만 쓴다(home-day-photos.spec.mjs와 같은 방식). 시계는 2026-10-06 10:00 KST.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const kst = (h, m = 0) => new Date(Date.UTC(2026, 9, 6, h - 9, m)).toISOString();
const DAY = [8, 9, 10, 11, 12, 13, 14, 15].map(h => ({ id: 'P' + h, name: `P${h}.jpg`, taken_at: kst(h), approx: false }));

const watch = () => {
  // 같은 칸·그림은 여러 기록에서 겹쳐 보일 수 있어(바깥 줄이 먼저 붙고 안쪽이 뒤따름) 한 요소는 한 번만 센다.
  const seenCells = new WeakSet(), seenImgs = new WeakSet();
  window.__made = { cells: 0, imgs: 0 };
  new MutationObserver(list => {
    for (const m of list) {
      if (!m.target.closest?.('[data-journal-photos]')) continue;
      m.addedNodes.forEach(node => {
        if (node.nodeType !== 1) return;
        const cells = node.matches('.journal-photo-cell') ? [node] : [...node.querySelectorAll('.journal-photo-cell')];
        const imgs = node.tagName === 'IMG' ? [node] : [...node.querySelectorAll('img')];
        for (const c of cells) if (!seenCells.has(c)) { seenCells.add(c); window.__made.cells++; }
        for (const i of imgs) if (!seenImgs.has(i)) { seenImgs.add(i); window.__made.imgs++; }
      });
    }
  }).observe(document, { childList: true, subtree: true });
};

for (const [width, height] of [[390, 844], [884, 1104], [1440, 900]]) {
  test(`${width}: 같은 사진 목록이면 다시 그려도 사진 칸·그림을 새로 만들지 않는다`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.addInitScript(watch);
    await openHome(page, {
      beforeLoad: async () => {
        await page.route(u => u.origin === SB && u.pathname === '/functions/v1/onedrive-photos', r => {
          const body = r.request().postDataJSON();
          if (body.action === 'photo') return r.fulfill({ status: 200, contentType: 'image/png', body: PNG });
          if (body.action === 'status') return r.fulfill({ json: { configured: true, connected: true, folder: { name: '카메라' }, can_delete: true } });
          if (body.action === 'photos') return r.fulfill({ json: { month: body.month, days: body.month === '2026-10' ? { '2026-10-06': DAY } : {}, truncated: false } });
          return r.fulfill({ json: {} });
        });
        await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_diary_stars', r => r.fulfill({ json: [] }));
      },
    });
    const box = page.locator('#journalRoot [data-journal-photos]');
    await expect(box.locator('[data-journal-photo]').first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    const shown = await box.locator('.journal-photo-cell:not(.journal-photo-more)').count();
    expect(shown).toBeGreaterThan(0);
    const atEntry = await page.evaluate(() => window.__made.cells);
    test.info().annotations.push({ type: 'entry-cells', description: `${atEntry}/${shown}` });
    expect(atEntry).toBe(await box.locator('.journal-photo-cell').count()); // 홈에 들어올 때도 한 번에 나타난다
    // 다시 그리게 하는 부름들: 원드라이브 미리 받기 끝 알림, 폭이 조금 바뀜(칸 수는 같음).
    await page.evaluate(() => window.dispatchEvent(new Event('kptu-od-warm')));
    await page.waitForLoadState('networkidle');
    // FOLD-넓은화면 ④: 폴드 펼침(600~1199)은 사진 줄이 오른쪽 단(폭의 절반쯤)에 들어가 칸 수가 바뀌는 폭 경계에 걸릴 수 있다.
    // 경계를 넘으면 칸이 하나 더/덜 생기는 것은 정상이므로, 이 시험은 칸 수가 그대로인 쪽(남는 자리가 넉넉한 쪽)으로만 흔든다.
    const stripWidth = await box.locator('[data-journal-photo-strip]').evaluate(el => el.clientWidth);
    const room = (stripWidth + GAP_PX) % (CELL_PX + GAP_PX); // 지금 칸 수를 지킨 채 더 넓어질 수 있는 폭(px)
    const nudge = room + 3 >= CELL_PX + GAP_PX ? -3 : 3;
    await page.setViewportSize({ width: width + nudge, height });
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.setViewportSize({ width, height });
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    const now = await box.locator('.journal-photo-cell').count();
    const made = await page.evaluate(() => window.__made);
    expect(made.cells).toBe(now); // 칸마다 딱 한 번만 만들어졌다
    expect(made.imgs).toBe(shown);
  });
}
