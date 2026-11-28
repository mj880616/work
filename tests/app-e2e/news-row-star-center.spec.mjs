import { test, expect } from '@playwright/test';
import { start, openNews } from './helpers/news-server.mjs';
// READ-별표가운데(11/28): 읽을 거리 목록 줄(news-row.mjs 공용 줄)의 저장 ★은 줄 전체 높이의 세로 가운데 — 제목 한 줄·두 줄 모두, 폰 412·PC 1280.
// 줄 오른쪽 여백(줄 안쪽 여백)은 그대로, ★은 줄 오른쪽 끝. 서버 흉내(helpers/news-server.mjs), 글은 모두 가짜.
const LONG = '가짜 키워드 기사 제목이 아주 길어서 폰과 PC 모두에서 두 줄 이상으로 꺾이는 경우를 보기 위한 가짜 문장입니다 가짜 문장입니다 가짜 문장입니다 가짜 문장입니다 가짜 문장입니다 가짜 문장입니다';
const item = (page, id) => page.locator(`#newsRoot [data-nc-item="${id}"]`);
const geo = row => row.evaluate(el => {
  const r = el.getBoundingClientRect(), s = el.querySelector('.nw-star').getBoundingClientRect();
  const t = el.querySelector('.nw-title'), lh = parseFloat(getComputedStyle(t).lineHeight);
  return { rowMid: r.top + r.height / 2, starMid: s.top + s.height / 2, rowRight: r.right, starRight: s.right, pad: parseFloat(getComputedStyle(el).paddingRight),
    lines: Math.round(t.getBoundingClientRect().height / lh), inMeta: !!el.querySelector('.nw-meta .nw-star') };
});

for (const width of [412, 1280]) {
  test(`읽을 거리 목록 ${width}: 저장 ★은 줄 세로 가운데(제목 한 줄·여러 줄), 오른쪽 여백 그대로`, async ({ page }) => {
    const { errors, server } = await start(page, width);
    const c1 = server.items.find(i => i.id === 'c1'), k1 = server.items.find(i => i.id === 'k1');
    c1.starred_at = '2026-10-06T00:30:00Z';
    k1.starred_at = '2026-10-06T00:31:00Z'; k1.title = LONG;
    await openNews(page, width);
    for (const [id, lines] of [['c1', 1], ['k1', 2]]) {
      const row = item(page, id);
      await expect(row.locator('.nw-star')).toHaveCount(1);
      await expect(row).toBeVisible();
      // 목록 그림이 자리 잡은 뒤(줄 높이·★ 자리)를 잰다 — 가운데 차이가 맞을 때까지 기다리고, 끝내 안 맞으면 실패.
      await expect.poll(async () => { const g = await geo(row); return g.lines >= lines && Math.abs(g.starMid - g.rowMid) <= 1; }, { message: `${id} ★ 세로 가운데` }).toBe(true);
      const g = await geo(row);
      if (lines === 1) expect(g.lines, `${id} 제목 줄 수`).toBe(1); else expect(g.lines, `${id} 제목 줄 수`).toBeGreaterThanOrEqual(2);
      expect(g.inMeta, `${id} ★은 꼬리 줄 밖`).toBe(false);
      expect(Math.abs(g.starMid - g.rowMid), `${id} ★ 세로 가운데 차이`).toBeLessThanOrEqual(1);
      expect(Math.abs(g.rowRight - g.pad - g.starRight), `${id} ★ 오른쪽 여백`).toBeLessThanOrEqual(1);
    }
    // ★ 누르기 = 저장한 글에서 삭제(공용 dropSaved) 그대로.
    await item(page, 'c1').locator('.nw-star').click();
    await expect(item(page, 'c1').locator('.nw-star')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
