import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
// S68-43(명진 요청 11/23 '옛 보관 글 원문 다시 불러오기'): 읽을 거리 사회운동 글 상세에서 원문 칸이 '사이트가 자동 읽기를 막아 둠'(예전 robots 실패)이면
// 까닭 줄 끝에 [원문 다시 가져오기]. 누르면 outside-feed reread(글 id만)를 한 번 부르고 원문 줄을 다시 읽어 본문을 그린다.
// 본문이 없는 동안 요약 칸은 '원문을 가져오면 요약해요 · 까닭' 한 줄(서버 no_material — 제목만으로 만든 요약·'material' 같은 내부 말을 보이지 않음),
// 본문이 생기면 요약·시사점을 다시 만든다. 서버는 흉내 낸다. 글은 모두 가상.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const P1 = 'a1000000-0000-4000-8000-000000000041';
const POST = { id: P1, source_key: 'kctu', kind: 'statement', lang: 'ko', title: '가상 막힌 글', title_ko: null, url: 'https://nodong.org/statement/41', published_at: '2026-11-19T00:30:00Z', fetched_at: '2026-11-19T00:40:00Z', summary_ko: null, key_sentences: [], has_body: false, author: null };
const DETAIL = { level: 'full', summary: '가상 본문 요약.', key_sentences: [], relevance: null, implications: { kptu: '가상 시사점.', labor: '' }, related: [], generated_at: '2026-11-23T03:00:00Z', context_at: null };

async function server(page, { rereadStatus = 200, body0 = { state: 'failed', reason: 'robots', blocks: [] }, after = null } = {}) {
  const s = { body: body0, rereads: [], ai: 0 };
  await page.route(SB + '/**', async route => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname, method = req.method();
    const ok = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (p === '/functions/v1/outside-feed') {
      if (u.searchParams.get('action') === 'reread') {
        s.rereads.push(req.postDataJSON?.());
        if (rereadStatus !== 200) return ok({ ok: false, error: 'DAILY_LIMIT' }, rereadStatus);
        s.body = after || { state: 'ok', reason: null, blocks: [{ t: 'p', text: '가상 다시 읽은 본문 문단.' }] };
        return ok({ ok: true, status: 'ok' });
      }
      return ok({ ok: true, sources: [{ key: 'kctu', name: '민주노총', group: 'labor', lang: 'ko' }] });
    }
    if (p === '/functions/v1/news-feed') return ok({ ok: true, sources: [], limits: {} });
    if (p === '/functions/v1/ai-assist') {
      const b = req.postDataJSON?.();
      if (b?.kind !== 'now_detail') return ok({ ok: true, ran: false, added: 0 });
      s.ai++;
      if (s.body.state !== 'ok') return ok({ ok: false, error: 'no_material' }, 422);
      return ok({ ok: true, kind: 'now_detail', detail: DETAIL, stale: false });
    }
    const table = p.startsWith('/rest/v1/') ? p.slice('/rest/v1/'.length) : '';
    if (table === 'app_outside_articles') return ok([POST]);
    if (table === 'app_outside_article_bodies') return ok([s.body]);
    if (table === 'app_outside_reads' || table === 'app_news_reads') return method === 'POST' ? route.fulfill({ status: 201 }) : ok([]);
    if (table === 'app_outside_sources') return ok([{ source_key: 'kctu', enabled: true, last_ok_at: '2026-11-23T00:07:00Z', last_error: null }]);
    if (table === 'app_outside_seen') return ok([{ seen_at: '2026-11-23T00:00:00Z' }]);
    if (table === 'app_now_signals') return method === 'POST' ? route.fulfill({ status: 201 }) : ok([]);
    if (table.startsWith('app_now_') || table.startsWith('app_news_') || table.startsWith('app_outside_') || table === 'app_notes') return ok([]);
    return route.fallback();
  });
  return s;
}
async function start(page, width, opts) {
  await page.setViewportSize({ width, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await openHome(page);
  const s = await server(page, opts);
  if (width <= 760) {
    await page.locator('#mobileMenuTab').click();
    await page.locator('#mobileMenu nav button:visible', { hasText: '읽을 거리' }).click();
  } else await page.locator('#appView>.app-nav').getByRole('link', { name: '읽을 거리', exact: true }).click();
  await expect(page.locator('#outsideView')).toBeVisible();
  await page.locator('#outsideRoot').getByRole('tab', { name: '사회운동' }).click();
  await expect(page.locator('#outsideRoot [data-os-list] [data-nw-key]')).toHaveCount(1);
  return { errors, s };
}
const nd = page => page.locator('#outsideRoot [data-now-detail] .nd');
const open = page => page.locator(`#outsideRoot [data-os-list] [data-nw-key="outside:${P1}"] .now-open`).click();

for (const width of [412, 1280]) {
  test(`읽을 거리 상세 ${width}: 막힌 원문 → [원문 다시 가져오기] → 본문·요약`, async ({ page }) => {
    test.setTimeout(60000);
    const { errors, s } = await start(page, width);
    await open(page);
    const d = nd(page);
    const why = d.locator('[data-nd-body] [data-nd-why]');
    await expect(why).toContainText('사이트가 자동 읽기를 막아 둠');
    // 본문이 없으면 요약을 만들지 않고 한 줄 안내만(시사점 칸은 숨김).
    await expect(d.locator('[data-nd-summary] [data-nd-unread]')).toContainText('원문을 가져오면 요약해요');
    await expect(d.locator('[data-nd-implications]')).toBeHidden();
    await expect(d.locator('.nd-sum')).toHaveCount(0);
    const btn = why.getByRole('button', { name: '원문 다시 가져오기' });
    await expect(btn).toBeVisible();
    await btn.click();
    // 서버에는 글 id만 보낸다(주소·작업공간 값 없음).
    await expect.poll(() => s.rereads.length).toBe(1);
    expect(s.rereads[0]).toEqual({ id: P1 });
    await expect(d.locator('[data-nd-prose] p')).toHaveText(['가상 다시 읽은 본문 문단.']);
    await expect(d.locator('[data-nd-body] [data-nd-why]')).toHaveCount(0);
    await expect(d.locator('.nd-sum')).toHaveText('가상 본문 요약.');
    await expect(d.locator('[data-nd-summary] [data-nd-unread]')).toHaveCount(0);
    await expect(d.locator('.nd-imp')).toHaveText('공공운수노조 운동 가상 시사점.');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('읽을 거리 상세: 다시 가져오기 하루 한도 → 까닭 한 줄, 단추는 그대로', async ({ page }) => {
  test.setTimeout(60000);
  const { errors, s } = await start(page, 1280, { rereadStatus: 429 });
  await open(page);
  const why = nd(page).locator('[data-nd-body] [data-nd-why]');
  await why.getByRole('button', { name: '원문 다시 가져오기' }).click();
  await expect.poll(() => s.rereads.length).toBe(1);
  await expect(why.locator('[data-nd-refetch-note]')).toHaveText('오늘 읽기 한도를 다 씀');
  await expect(why.getByRole('button', { name: '원문 다시 가져오기' })).toBeVisible();
  await expect(nd(page).locator('[data-nd-prose]')).toHaveCount(0);
  expect(errors.filter(e => !/429/.test(e))).toEqual([]);
});

// S68-52: 유료벽이 아닌데 본문 칸을 못 뽑아 리드(메타 설명)만 남은 글(lead·no_body — 조선일보처럼 문단이 페이지 스크립트 데이터에 있는 글)도 단추.
// 다시 읽어 전문이 오면 본문으로 바꾸고, 또 앞부분이면 단추를 거두고 한 줄(요약을 다시 만들지 않음). 유료벽 리드는 단추 없음.
const LEAD = { state: 'lead', reason: 'no_body', blocks: [{ t: 'p', text: '가상 공개 리드 한 줄.' }] };
test('읽을 거리 상세: 앞부분만 남은 글 → [원문 다시 가져오기] → 전문', async ({ page }) => {
  test.setTimeout(60000);
  const { errors, s } = await start(page, 412, { body0: LEAD });
  await open(page);
  const d = nd(page);
  await expect(d.locator('[data-nd-prose] p')).toHaveText(['가상 공개 리드 한 줄.']);
  const btn = d.locator('[data-nd-body] [data-nd-why]').getByRole('button', { name: '원문 다시 가져오기' });
  await btn.click();
  await expect.poll(() => s.rereads.length).toBe(1);
  await expect(d.locator('[data-nd-prose] p')).toHaveText(['가상 다시 읽은 본문 문단.']);
  await expect(d.locator('[data-nd-body] [data-nd-why]')).toHaveCount(0);
  expect(errors.filter(e => !/422/.test(e))).toEqual([]);
});
test('읽을 거리 상세: 다시 읽어도 앞부분뿐이면 단추를 거두고 한 줄, 유료벽 리드는 단추 없음', async ({ page }) => {
  test.setTimeout(60000);
  const { s } = await start(page, 1280, { body0: LEAD, after: LEAD });
  await open(page);
  const why = nd(page).locator('[data-nd-body] [data-nd-why]');
  await why.getByRole('button', { name: '원문 다시 가져오기' }).click();
  await expect.poll(() => s.rereads.length).toBe(1);
  await expect(why.locator('[data-nd-refetch-note]')).toHaveText('다시 읽어도 사이트가 본문을 주지 않아요');
  await expect(why.getByRole('button', { name: '원문 다시 가져오기' })).toHaveCount(0);
  await expect(nd(page).locator('[data-nd-prose] p')).toHaveText(['가상 공개 리드 한 줄.']);
});
test('읽을 거리 상세: 유료벽 리드(lead·paywall)에는 단추가 없다', async ({ page }) => {
  test.setTimeout(60000);
  await start(page, 1280, { body0: { state: 'lead', reason: 'paywall', blocks: [{ t: 'p', text: '가상 유료 앞부분.' }] } });
  await open(page);
  const d = nd(page);
  await expect(d.locator('[data-nd-prose] p')).toHaveText(['가상 유료 앞부분.']);
  await expect(d.locator('[data-nd-body] [data-nd-why]')).toBeVisible();
  await expect(d.getByRole('button', { name: '원문 다시 가져오기' })).toHaveCount(0);
});
