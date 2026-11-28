import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
// HOME-읽을만한글넓힘(사용자 2026-11-28: 아침 메일 '오늘 읽을 글' 대신 홈 '읽을 만한 글'): 폰 412·PC 1280.
// - 줄마다 '왜'·'요지' 두 줄(home-day-fill.js), 줄을 누르면 그 글의 글 보기(News 글 상세, ?view=news)로(journal.js openRead).
// - 칸 머리 ⋯ → [관심 주제] 창(now-interests.js defaults + home-read-topics.mjs): 기본 주제가 '기본' 표시로 보이고,
//   기본 주제 [빼기]는 서버 표 app_now_interests에 'dropped' 줄 하나, [+ 더하기]는 'confirmed' 줄 하나(새 저장소 없음).
// 가짜 서버만 쓴다. 시계: 2026-10-06 19:30 KST(home-day-picks.spec.mjs와 같음).
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const EVENING = '2026-10-06T10:30:00Z';
const uid = n => `00000000-0000-4000-8000-00000000000${n}`;
const READS = [
  { id: uid(1), title: '가상 공공기관 경영평가의 그늘', what: '숫자 평가가 현장 안전을 밀어낸다는 주장', why: '관심 주제 공공기관 정책과 이어짐', source: '가상신문 사설·칼럼', at: '2026-10-06T00:10:00Z', url: 'https://news.example.test/1' },
  { id: uid(2), title: 'Synthetic rail and public money', what: '해외 철도 재정 구조를 비교한 장문', why: '철도·공공교통 관심 주제', source: 'PSI', at: '2026-10-05T03:00:00Z', url: 'https://news.example.test/2' },
];
const ROW = { day: '2026-10-06', reads: READS, reads_at: '2026-10-06T10:00:00Z', suggests: [], suggests_at: null, suggests_done: [] };

async function boot(page, width, height, { interests = [] } = {}) {
  await page.setViewportSize({ width, height });
  const errors = [], posts = [], state = { interests: structuredClone(interests) };
  page.on('pageerror', e => errors.push(e.message));
  const beforeLoad = async () => {
    await page.route(u => u.origin === SB && u.pathname === '/functions/v1/ai-assist', async r => {
      let body = null; try { body = r.request().postDataJSON(); } catch { body = null; }
      if (body?.kind !== 'home_day_picks') return r.fallback();
      return r.fulfill({ json: { ok: true, kind: 'home_day_picks', day: body.day, picks: ROW } });
    });
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_home_day_picks', r => r.fulfill({ json: [ROW] }));
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/rpc/app_news_article_of', r => r.fulfill({ json: [] }));
    await page.route(u => u.origin === SB && (u.pathname === '/rest/v1/app_news_marks' || u.pathname === '/rest/v1/app_reading_items'), r => r.request().method() === 'GET' ? r.fulfill({ json: [] }) : r.fallback());
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_now_interests', async r => {
      const req = r.request();
      if (req.method() === 'GET') return r.fulfill({ json: state.interests });
      if (req.method() === 'POST') {
        const b = req.postDataJSON(); posts.push(b);
        const row = { id: `i${posts.length}`, topic: b.topic, state: b.state, origin: 'user', reason: null, decided_at: b.decided_at, created_at: EVENING };
        state.interests.push(row);
        return r.fulfill({ status: 201, json: [row] });
      }
      return r.fulfill({ status: 500, json: {} });
    });
  };
  await openHome(page, { beforeLoad, now: EVENING });
  return { errors, posts, state };
}
const reads = page => page.locator('#journalRoot [data-journal-fill] [data-journal-reads]');

for (const [width, height] of [[412, 915], [1280, 900]]) {
  test(`${width}: 줄마다 '왜'·'요지' 두 줄, 줄을 누르면 그 글 보기(News)로`, async ({ page }) => {
    const f = await boot(page, width, height);
    const first = reads(page).locator(`[data-journal-read="${uid(1)}"]`);
    await expect(first).toBeVisible();
    await expect(first.locator('[data-journal-read-why]')).toHaveText('왜: 관심 주제 공공기관 정책과 이어짐');
    await expect(first.locator('[data-journal-read-what]')).toHaveText('요지: 숫자 평가가 현장 안전을 밀어낸다는 주장');
    // '왜'가 '요지' 위(두 줄, 같은 왼쪽 끝).
    const why = await first.locator('[data-journal-read-why]').boundingBox(), what = await first.locator('[data-journal-read-what]').boundingBox();
    expect(why.y).toBeLessThan(what.y);
    expect(Math.abs(why.x - what.x)).toBeLessThan(2);
    await first.locator('.journal-read-title').click();
    await expect(page).toHaveURL(/[?&]view=news\b/);
    expect(f.errors).toEqual([]);
  });

  test(`${width}: 칸 ⋯ [관심 주제] — 기본 주제가 '기본'으로 보이고, 빼기·더하기는 관심 주제 표에 한 줄씩`, async ({ page }) => {
    const f = await boot(page, width, height, { interests: [{ id: 'c1', topic: '기후 위기', state: 'confirmed', origin: 'user', reason: null, decided_at: EVENING, created_at: EVENING }] });
    await expect(reads(page)).toBeVisible();
    await reads(page).locator('[data-journal-reads-menu]').click();
    await page.locator('#rowMenu').getByRole('button', { name: '관심 주제', exact: true }).click();
    const modal = page.locator('#homeReadTopics');
    await expect(modal).toBeVisible();
    const box = modal.locator('[data-home-read-topics]');
    await expect(box.locator('[data-ni-row]').filter({ hasText: '기후 위기' })).toHaveCount(1);
    const def = box.locator('[data-ni-row][data-ni-default]').filter({ hasText: '아스날' });
    await expect(def).toContainText('기본');
    await expect(box.locator('[data-ni-row][data-ni-default]')).toHaveCount(9);
    await def.getByRole('button', { name: '빼기' }).click();
    await expect.poll(() => f.posts.length).toBe(1);
    expect(f.posts[0]).toMatchObject({ workspace_id: 'w', topic: '아스날', state: 'dropped' });
    await expect(box.locator('[data-ni-row][data-ni-default]')).toHaveCount(8);
    await expect(box.locator('[data-ni-row]').filter({ hasText: '아스날' })).toHaveCount(0);
    await box.locator('[data-ni-add-input]').fill('기후 위기');
    await box.locator('[data-ni-add-form] button[type=submit]').click();
    await expect(box.locator('.ni-note')).toHaveText('이미 있음');
    await box.locator('[data-ni-add-input]').fill('공공기관 정책');
    await box.locator('[data-ni-add-form] button[type=submit]').click();
    await expect(box.locator('.ni-note')).toHaveText('이미 있음'); // 기본 주제와 같은 이름도 겹침
    await box.locator('[data-ni-add-input]').fill('도시 재생');
    await box.locator('[data-ni-add-form] button[type=submit]').click();
    await expect.poll(() => f.posts.length).toBe(2);
    expect(f.posts[1]).toMatchObject({ topic: '도시 재생', state: 'confirmed' });
    // 창은 화면 안(폰 하단바에 가리지 않음)이고 [닫기]로 닫힌다.
    const card = await modal.locator('.sfm-card').boundingBox();
    expect(card.y + card.height).toBeLessThanOrEqual(height);
    await modal.locator('[data-sfm-ok]').click();
    await expect(modal).toHaveCount(0);
    expect(f.errors).toEqual([]);
  });
}
