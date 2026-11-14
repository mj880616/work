import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { noticeText } from './helpers/small-notice.mjs';
// HOME-읽을글밀기(2026-11-11 명진 요청): 홈 [하루] '읽을 만한 글' 줄을 왼쪽으로 밀면 숨기기(뉴스 글 hidden_at), 오른쪽으로 밀면 보관(뉴스 글 별표) —
// 어느 쪽이든 홈에서 바로 빠지고(서버 표시를 읽어 거름), 알림 [되돌리기]가 돌려 놓는다. PC는 마우스 단추·우클릭 같은 두 항목. 다 처리하면 '다 읽었어요' 한 줄.
// 가짜 서버만 쓴다: ai-assist(home_day_picks), 표 app_home_day_picks(읽기), 뉴스 줄 app_news_items(읽기·고치기), 환류 app_now_signals(더하기). 글은 모두 가짜.
// 시계: 2026-10-06 19:30 KST(home-day-picks.spec.mjs와 같음).
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const EVENING = '2026-10-06T10:30:00Z';
const uid = n => `00000000-0000-4000-8000-00000000000${n}`;
const READS = [1, 2, 3].map(n => ({ id: uid(n), title: `가상 소식 ${n}`, what: `가상 일 ${n}`, why: `담당 가상지부 ${n}`, source: '가상신문', at: '2026-10-06T00:10:00Z', url: `https://news.example.test/${n}` }));
const ROW = { day: '2026-10-06', reads: READS, reads_at: '2026-10-06T10:00:00Z', suggests: [], suggests_at: null, suggests_done: [] };

// gate.hold: 처리 표시 읽기(뉴스 줄 GET)를 붙잡아 느린 서버를 흉내 낸다. ask: 서버 고르기 답을 붙잡았다가 ask.row로 돌려준다.
async function boot(page, width, height, { marks = {}, gate = null, ask = null } = {}) {
  await page.setViewportSize({ width, height });
  const errors = [], patches = [], signals = [], reads = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  // 서버의 뉴스 줄 표시(숨김·별표). 테스트가 직접 고치면 '다른 기기에서 처리함'이다.
  const news = new Map(READS.map(r => [r.id, { id: r.id, hidden_at: null, starred_at: null, ...(marks[r.id] || {}) }]));
  const beforeLoad = async () => {
    await page.route(u => u.origin === SB && u.pathname === '/functions/v1/ai-assist', async r => {
      let body = null; try { body = r.request().postDataJSON(); } catch { body = null; }
      if (body?.kind !== 'home_day_picks') return r.fallback();
      if (ask) { await ask.hold; return r.fulfill({ json: { ok: true, kind: 'home_day_picks', day: body.day, picks: ask.row || ROW } }); }
      return r.fulfill({ json: { ok: true, kind: 'home_day_picks', day: body.day, picks: ROW } });
    });
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_home_day_picks', r => r.fulfill({ json: [ROW] }));
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_news_items', async r => {
      const req = r.request(), q = new URL(req.url()).searchParams;
      if (req.method() === 'GET') {
        const ids = (/^in\.\((.*)\)$/.exec(q.get('id') || '')?.[1] || '').split(',').filter(Boolean);
        reads.push(ids);
        if (gate?.hold) await gate.hold;
        return r.fulfill({ json: ids.map(i => news.get(i)).filter(Boolean).map(({ id, hidden_at, starred_at }) => ({ id, hidden_at, starred_at })) });
      }
      if (req.method() === 'PATCH') {
        const id = (q.get('id') || '').replace(/^eq\./, ''), body = req.postDataJSON(), row = news.get(id);
        if (!row) return r.fulfill({ json: [] });
        patches.push({ id, body }); Object.assign(row, body);
        return r.fulfill({ json: [{ id: row.id, starred_at: row.starred_at, folder_id: null }] });
      }
      return r.fallback();
    });
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_now_signals', async r => {
      if (r.request().method() !== 'POST') return r.fallback();
      signals.push(r.request().postDataJSON()); return r.fulfill({ status: 201, body: '' });
    });
  };
  await openHome(page, { beforeLoad, now: EVENING });
  return { errors, patches, signals, reads, news };
}
const reads = page => page.locator('#journalRoot [data-journal-reads]');
const item = (page, n) => page.locator(`#journalRoot [data-journal-read="${uid(n)}"]`);
async function swipe(locator, dx) {
  // 홈이 다시 그려져 찾은 줄이 화면에서 빠졌으면(isConnected 아님) 손가락 이벤트를 보내지 않고 다시 찾아 민다(now-row-swipe.spec.mjs와 같은 방법).
  await expect(async () => {
    await expect(locator).toBeVisible();
    const sent = await locator.evaluate((el, { dx }) => {
      if (!el.isConnected) return false;
      const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      const fire = (type, cx) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: cx, clientY: y }));
      fire('pointerdown', x); for (let i = 1; i <= 10; i++) fire('pointermove', x + dx * i / 10); fire('pointerup', x + dx);
      return true;
    }, { dx });
    expect(sent).toBe(true);
  }).toPass({ timeout: 10000 });
}
const shown = page => page.locator('#journalRoot [data-journal-read]');

test('폰 412: 왼쪽 끝까지 밀면 숨김(뉴스 글 hidden_at)·알림 [되돌리기], 오른쪽 끝까지 밀면 보관(별표)', async ({ page }) => {
  test.setTimeout(90000);
  const f = await boot(page, 412, 900);
  await expect(reads(page).locator('.journal-head-count')).toHaveText('3');
  await expect(page.locator('#journalRoot [data-journal-read]:visible')).toHaveCount(2); // 처음 둘만 펼침, 하나는 '1개 더' 안
  await swipe(item(page, 1), -320);
  await expect(item(page, 1)).toHaveCount(0);
  await expect(reads(page).locator('.journal-head-count')).toHaveText('2');
  expect(f.patches.at(-1).id).toBe(uid(1));
  expect(Object.keys(f.patches.at(-1).body).sort()).toEqual(['hidden_at', 'updated_at']);
  expect(f.patches.at(-1).body.hidden_at).toBeTruthy();
  await expect.poll(() => f.signals.some(s => s.news_item_id === uid(1) && s.action === 'dismiss')).toBe(true);
  expect(await noticeText(page)).toBe('숨겼어요');
  await page.locator('#kptuNotice .kptu-notice-undo').click();
  await expect(item(page, 1)).toBeVisible();
  await expect(reads(page).locator('.journal-head-count')).toHaveText('3');
  expect(f.patches.at(-1).body.hidden_at).toBeNull();

  await swipe(item(page, 2), 320);
  await expect(item(page, 2)).toHaveCount(0);
  expect(f.patches.at(-1).id).toBe(uid(2));
  expect(Object.keys(f.patches.at(-1).body).sort()).toEqual(['starred_at', 'updated_at']);
  expect(f.patches.at(-1).body.starred_at).toBeTruthy();
  await expect.poll(() => f.signals.some(s => s.news_item_id === uid(2) && s.action === 'star')).toBe(true);
  expect(await noticeText(page)).toBe('보관했어요');
  await page.locator('#kptuNotice .kptu-notice-undo').click();
  await expect(item(page, 2)).toBeVisible();
  expect(f.patches.at(-1).body).toMatchObject({ starred_at: null });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(f.errors).toEqual([]);
});

test('폰 412: 처리 표시를 읽는 중에도 한 글만 빠지고 칸은 그대로, [되돌리기]는 그 글만(HOME-읽을글한글만)', async ({ page }) => {
  test.setTimeout(90000);
  const gate = { hold: null };
  let answer; const ask = { hold: new Promise(r => { answer = r; }), row: null };
  const f = await boot(page, 412, 900, { gate, ask });
  await expect(shown(page)).toHaveCount(3);
  // ① 다시 읽기(홈을 나갔다 돌아옴)가 느린 사이 한 줄 보관 → 그 줄만 빠진다.
  let release; gate.hold = new Promise(r => { release = r; });
  await page.evaluate(() => window.KPTURouter.go('diary'));
  await page.evaluate(() => window.KPTURouter.go('home'));
  await expect.poll(() => f.reads.length).toBeGreaterThan(1);
  await swipe(item(page, 1), 320);
  await expect(item(page, 1)).toHaveCount(0);
  await expect(reads(page)).toBeVisible();
  await expect(shown(page)).toHaveCount(2);
  release(); gate.hold = null;
  // ② 그 뒤 서버가 고른 글 묶음이 바뀌어 오고(보관한 1번 대신 4번, 최대 3개) 처리 표시를 다시 읽는 동안에도 칸은 비지 않는다.
  const four = { ...READS[0], id: uid(4), title: '가상 소식 4' };
  f.news.set(uid(4), { id: uid(4), hidden_at: null, starred_at: null });
  ask.row = { ...ROW, reads: [READS[1], READS[2], four] };
  gate.hold = new Promise(r => { release = r; });
  answer();
  await expect.poll(() => f.reads.some(ids => ids.includes(uid(4))), { timeout: 15000 }).toBe(true); // 새 묶음의 처리 표시를 읽기 시작함(붙잡힘)
  await expect(reads(page)).toBeVisible();
  await expect(item(page, 2)).toBeAttached();
  await expect(item(page, 3)).toBeAttached();
  await expect(item(page, 4)).toHaveCount(0); // 아직 처리 여부를 모르는 새 글만 기다린다
  release(); gate.hold = null;
  await expect(item(page, 4)).toBeAttached();
  await expect(reads(page).locator('.journal-head-count')).toHaveText('3');
  // ③ [되돌리기]는 그 한 글만 되살린다.
  await swipe(item(page, 2), -320);
  await expect(item(page, 2)).toHaveCount(0);
  await expect(reads(page).locator('.journal-head-count')).toHaveText('2');
  await page.locator('#kptuNotice .kptu-notice-undo').click();
  await expect(item(page, 2)).toBeAttached();
  await expect(item(page, 1)).toHaveCount(0);
  await expect(reads(page).locator('.journal-head-count')).toHaveText('3');
  expect(f.errors).toEqual([]);
});

test('폰 412: 처리한 글은 새로 고침·다른 기기에서도 빠져 있다(서버 표시를 읽어 거름)', async ({ page }) => {
  test.setTimeout(90000);
  const f = await boot(page, 412, 900, { marks: { [uid(3)]: { hidden_at: '2026-10-06T09:00:00Z' } } });
  await expect(shown(page)).toHaveCount(2);
  await expect(item(page, 1)).toBeVisible();
  await expect(item(page, 2)).toBeVisible();
  await expect(reads(page).locator('.journal-head-count')).toHaveText('2');
  expect(f.reads.length).toBeGreaterThan(0);
  expect(f.reads[0]).toEqual([uid(1), uid(2), uid(3)]);

  // 이 기기에서 밀어 처리 → 새로 고침해도 그대로 빠져 있다(기기 저장이 아니라 서버 표시).
  await swipe(item(page, 1), -320);
  await expect(item(page, 1)).toHaveCount(0);
  await expect.poll(() => f.patches.length).toBe(1);
  await page.reload();
  await expect(item(page, 2)).toBeVisible();
  await expect(shown(page)).toHaveCount(1);
  await expect(item(page, 1)).toHaveCount(0);

  // 다른 기기(서버 표시를 직접 고침)에서 처리 → 홈을 나갔다 돌아오면 빠진다.
  f.news.get(uid(2)).starred_at = '2026-10-06T10:00:00Z';
  await page.evaluate(() => window.KPTURouter.go('diary'));
  await page.evaluate(() => window.KPTURouter.go('home'));
  await expect(reads(page).locator('[data-journal-reads-done]')).toHaveText('다 읽었어요');
  expect(f.errors).toEqual([]);
});

test('폰 412: 접힌 \'1개 더\' 안 글도 같은 밀기, 다 처리하면 \'다 읽었어요\' 한 줄(빈 상자 없음)', async ({ page }) => {
  test.setTimeout(90000);
  const f = await boot(page, 412, 900);
  const more = reads(page).locator('[data-journal-reads-more]');
  await expect(more.locator('summary')).toHaveText('1개 더');
  await more.locator('summary').click();
  await expect(item(page, 3)).toBeVisible();

  await swipe(item(page, 3), -320);
  await expect(item(page, 3)).toHaveCount(0);
  expect(f.patches.at(-1)).toMatchObject({ id: uid(3) });
  expect(f.patches.at(-1).body.hidden_at).toBeTruthy();
  await expect(more).toHaveCount(0); // 남은 둘이 모두 펼쳐 보인다
  await expect(shown(page)).toHaveCount(2);

  await swipe(item(page, 1), -320);
  await swipe(item(page, 2), 320);
  await expect(shown(page)).toHaveCount(0);
  await expect(reads(page)).toBeVisible();
  await expect(reads(page).locator('.journal-heading')).toHaveText('읽을 만한 글');
  await expect(reads(page).locator('[data-journal-reads-done]')).toHaveText('다 읽었어요');
  await expect(reads(page).locator('.journal-reads-list, details, .journal-head-count')).toHaveCount(0);
  const box = await reads(page).boundingBox();
  expect(box.height).toBeLessThan(60); // 한 줄(빈 상자 없음)
  expect(f.errors).toEqual([]);
});

test('PC 1440: 줄에 마우스를 올리면 [보관][숨기기], 눌러서 보관·숨기기, 우클릭 메뉴도 같은 두 항목', async ({ page }) => {
  test.setTimeout(90000);
  const f = await boot(page, 1440, 900);
  const first = item(page, 1);
  await expect(first.locator('[data-now-act]')).toHaveCount(2);
  await expect(first.locator('[data-now-act="save"]')).toBeHidden();
  await first.hover();
  await expect(first.locator('[data-now-act="save"]')).toBeVisible();
  await expect(first.locator('[data-now-act="hide"]')).toBeVisible();
  await first.locator('[data-now-act="save"]').click();
  await expect(item(page, 1)).toHaveCount(0);
  expect(f.patches.at(-1)).toMatchObject({ id: uid(1) });
  expect(f.patches.at(-1).body.starred_at).toBeTruthy();
  expect(await noticeText(page)).toBe('보관했어요');

  const second = item(page, 2);
  await second.hover();
  await second.locator('[data-now-act="hide"]').click();
  await expect(item(page, 2)).toHaveCount(0);
  expect(f.patches.at(-1)).toMatchObject({ id: uid(2) });
  expect(f.patches.at(-1).body.hidden_at).toBeTruthy();
  expect(await noticeText(page)).toBe('숨겼어요');

  const third = item(page, 3);
  await third.locator('.journal-read-title').click({ button: 'right' });
  const menu = page.locator('#rowMenu');
  await expect(menu).toBeVisible();
  await expect(menu).toHaveCSS('border-top-left-radius', /[1-9]/); // 공용 줄 메뉴 모양(od-link.css)이 홈에도 불려 있다
  await expect(menu.locator('[data-row-item]')).toHaveText(['보관', '숨기기']);
  await expect(menu.locator('.row-menu-title')).toHaveText('가상 소식 3');
  await menu.locator('[data-row-item="hide"]').click();
  await expect(item(page, 3)).toHaveCount(0);
  expect(f.patches.at(-1)).toMatchObject({ id: uid(3) });
  expect(f.errors).toEqual([]);
});
