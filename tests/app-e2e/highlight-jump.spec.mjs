// HL-밑줄위치로(2026-11-28 사용자 "노트 폴더 밑줄에서 글을 클릭하면 글 처음으로 가거든 근데 나는 밑줄 위치로 자동 이동했으면 좋겠어 찾기 어려워서"):
// 밑줄 줄을 누르면 그 글이 열리면서 그 밑줄 자리로 바로 가고(머리 줄·하단바에 가리지 않는 띠 안), 잠깐 밝힌 뒤 원래 밑줄 모양으로 돌아온다.
// 긴 글·늦게 오는 본문에서도 어긋나지 않고, 글이 조금 바뀌었으면 같은 문장 쪽으로, 아예 없으면 맨 위 + 짧은 안내. 뒤로가기는 밑줄 목록 그 자리.
// 글·서버는 모두 가상(owner RLS REST 흉내). 공용 부품(text-highlights.js revealMark)이라 --repeat-each=5로도 돌려 본다.
import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const A = 'a7000000-0000-4000-8000-000000000001';
const H = n => `b7000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PARAS = 70;
const para = n => `문단 ${n}: 가상 인력 충원 이야기 ${n}번째 대목이에요. 현장 상황을 하나씩 짚어 보며 길게 이어지는 설명이 계속돼요. 같은 말을 돌려 쓰지 않으려고 번호를 붙였어요.`;
const BODY = Array.from({ length: PARAS }, (_, i) => para(i + 1)).join('\n\n');
const MID = 31, END = 68; // 글 중간·끝 문단 번호
// 밑줄 24줄(끝쪽·중간·바뀐 글·없는 글 + 앞쪽 문단 20개) — 목록이 길어 폰·PC 모두 스크롤이 생긴다.
function marks() {
  const at = n => `2026-11-27T${String(23 - Math.floor(n / 4)).padStart(2, '0')}:${String(59 - n).padStart(2, '0')}:00Z`;
  const row = (id, quote, n) => ({ id: H(id), source_type: 'reading', source_id: A, quote, quote_prefix: '', quote_suffix: '', memo: null, source_title: '가상 긴 글', source_media: 'example.com', source_date: at(n), source_url: 'https://example.com/a', created_at: at(n), updated_at: at(n) });
  const list = [];
  list.push(row(1, `문단 ${END}: 가상 인력 충원 이야기 ${END}번째 대목이에요.`, 1)); // 끝쪽
  list.push(row(2, `문단 ${MID}: 가상 인력 충원 이야기 ${MID}번째 대목이에요.`, 2)); // 중간
  // 글이 조금 바뀐 줄: 첫 문장은 12번 문단에 있고 뒤는 지금 글에 없다.
  list.push(row(3, `문단 12: 가상 인력 충원 이야기 12번째 대목이에요. 이 뒷문장은 글이 바뀌어 이제 없어요.`, 3));
  // 아예 없는 줄.
  list.push(row(4, '이 글 어디에도 없는 아주 다른 문장이 여기에 있어요', 4));
  for (let i = 0; i < 20; i++) list.push(row(10 + i, `문단 ${2 + i}: 가상 인력 충원 이야기 ${2 + i}번째 대목이에요.`, 5 + i));
  return list;
}

async function server(page, { bodyDelay = 0 } = {}) {
  const s = { hl: marks() };
  const row = { id: A, url: 'https://example.com/a', title: '가상 긴 글', site: 'example.com', saved_at: '2026-11-22T01:00:00Z', read_at: '2026-11-22T02:00:00Z', body_state: 'ok', body_at: '2026-11-22T01:00:10Z', business_area_id: null, updated_at: '2026-11-22T02:00:00Z', body: BODY };
  await page.route(SB + '/**', async route => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname, method = req.method(), q = u.searchParams;
    const ok = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    const table = p.startsWith('/rest/v1/') ? p.slice('/rest/v1/'.length) : '';
    const id = (q.get('id') || '').replace(/^eq\./, '');
    if (table === 'app_news_highlights') return method === 'GET' ? ok(s.hl) : route.fulfill({ status: 204 });
    if (table === 'app_reading_items') {
      if (method !== 'GET') return ok([]);
      if (q.get('news_article_id') || q.get('outside_article_id')) return ok([]);
      const withBody = (q.get('select') || '').includes('body');
      if (withBody && bodyDelay) await new Promise(r => setTimeout(r, bodyDelay)); // 늦게 오는 본문
      const { body, ...rest } = row;
      return ok((id && id !== A ? [] : [withBody ? { ...rest, body } : rest]));
    }
    if (table === 'app_notes' && method === 'GET') return ok([]);
    if (table === 'app_note_folders' || table === 'app_note_comments' || table === 'app_record_links') return ok([]);
    if (table.startsWith('app_news_') || table.startsWith('app_outside_') || table.startsWith('app_now_')) return method === 'GET' ? ok([]) : ok([], 201);
    return route.fallback();
  });
  return s;
}

// 노트 › 폴더 › 밑줄 목록을 연다(폰은 누르면 그 줄만 상자로 바뀌고, 노트 화면이 마지막 자리를 기억한다).
async function openNoteMarks(page, width) {
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  const nav = page.locator(`${width < 600 ? '#noteRows' : '[data-nx-tree]'} [data-nx-news-item="news-hl"]`);
  const focus = page.locator('#basketView [data-nnm-focus="news-hl"]');
  await expect(nav.or(focus).first()).toBeVisible();
  if (!(await focus.isVisible())) await nav.locator('.ft-main').click();
  await expect(page.locator('#basketView [data-nnm] .nh-row').first()).toBeVisible();
}
const noteRow = (page, n) => page.locator(`#basketView [data-nnm] [data-nh-row="${H(n)}"]`);

// 그 밑줄이 눈에 보이고(화면 안), 머리 줄·하단바에 가려지지 않았는지(그 자리를 누르면 밑줄이 눌린다).
async function seen(page, id) {
  return page.evaluate(hid => {
    const m = document.querySelector(`#readingView mark.hl-mark[data-hl-id="${hid}"]`);
    if (!m) return 'no-mark';
    const r = m.getClientRects()[0];
    if (!r) return 'no-rect';
    if (r.top < 0 || r.bottom > innerHeight) return `out ${Math.round(r.top)}..${Math.round(r.bottom)} / ${innerHeight}`;
    const hit = document.elementFromPoint(r.left + Math.min(r.width / 2, 30), r.top + r.height / 2);
    return hit?.closest?.('mark.hl-mark')?.dataset.hlId === hid ? 'ok' : `covered by ${hit?.tagName}.${hit?.className}`;
  }, id);
}

for (const [label, width] of [['phone-412', 412], ['pc-1280', 1280]]) {
  for (const [what, id, delay] of [['글 중간', 2, 0], ['글 끝', 1, 0], ['글 끝 · 본문이 늦게 옴', 1, 900]]) {
    test(`노트 › 밑줄 줄을 누르면 ${what} 그 밑줄 자리로 가고 보인다 (${label})`, async ({ page }) => {
      test.setTimeout(90000);
      await page.setViewportSize({ width, height: 900 });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await openHome(page);
      await server(page, { bodyDelay: delay });
      await openNoteMarks(page, width);
      await noteRow(page, id).locator('[data-nh-open]').click();
      await expect(page.locator('#readingView [data-rd-detail] .rd-title')).toHaveText('가상 긴 글');
      await expect.poll(() => seen(page, H(id)), { timeout: 8000 }).toBe('ok');
      expect(await page.evaluate(() => { const p = document.querySelector('#readingView [data-rd-prose] p'); const r = p.getBoundingClientRect(); return r.bottom <= 0 || r.top >= innerHeight || r.bottom < 60; })).toBe(true); // 글 첫 문단에 머물지 않는다
      // 잠깐 밝힘은 끝나면 사라지고 노란 밑줄만 남는다.
      await expect(page.locator(`#readingView mark.hl-mark[data-hl-id="${H(id)}"]`)).not.toHaveAttribute('data-journal-flash', /.*/, { timeout: 5000 });
      await expect.poll(() => seen(page, H(id))).toBe('ok'); // 밝힘이 끝나도 자리 그대로
      expect(errors).toEqual([]);
    });
  }

  test(`글이 조금 바뀌었으면 같은 문장 쪽으로, 아예 없으면 맨 위 + 짧은 안내 (${label})`, async ({ page }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 900 });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await openHome(page);
    await server(page);
    // 같은 문장: 12번 문단 쪽(저장한 자리 그대로는 없다 — 밑줄 칠하기는 없고 그 문단이 보인다).
    await openNoteMarks(page, width);
    await noteRow(page, 3).locator('[data-nh-open]').click();
    await expect(page.locator('#readingView [data-rd-detail] .rd-title')).toHaveText('가상 긴 글');
    await expect.poll(() => page.evaluate(() => {
      const p = [...document.querySelectorAll('#readingView [data-rd-prose] p')].find(x => x.textContent.startsWith('문단 12:'));
      const r = p?.getBoundingClientRect();
      const first = document.querySelector('#readingView [data-rd-prose] p')?.getBoundingClientRect(); // 본문이 오기 전에는 없다 — 올 때까지 다시 잰다
      return !!r && !!first && r.top >= 0 && r.bottom <= innerHeight && first.bottom < 60;
    }), { timeout: 8000 }).toBe(true);
    await page.goBack();
    // 아예 없음: 맨 위 그대로 + 짧은 안내.
    await openNoteMarks(page, width);
    await noteRow(page, 4).locator('[data-nh-open]').click();
    await expect(page.locator('#readingView [data-rd-detail] .rd-title')).toHaveText('가상 긴 글');
    await expect(page.locator('#kptuNotice .kptu-notice-text')).toContainText('원문이 바뀌었어요');
    await expect(page.locator('#readingView [data-rd-prose] p').first()).toBeVisible();
    expect(await page.evaluate(() => { const r = document.querySelector('#readingView [data-rd-prose] p').getBoundingClientRect(); return r.top >= 0 && r.top < 300; })).toBe(true); // 글 맨 위 그대로
    expect(errors).toEqual([]);
  });

  test(`뒤로가기는 밑줄 목록 그 자리로 — 누른 줄이 화면 그 높이에 있다 (${label})`, async ({ page }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 700 });
    await openHome(page);
    await server(page);
    await openNoteMarks(page, width);
    const row = noteRow(page, 29);
    await row.scrollIntoViewIfNeeded();
    const topOf = () => row.evaluate(el => Math.round(el.getBoundingClientRect().top));
    const before = await topOf();
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(200);
    await row.locator('[data-nh-open]').evaluate(el => el.click()); // Playwright의 자동 스크롤이 "누르기 전 자리"를 바꾸지 않게 DOM 클릭
    await expect(page.locator('#readingView [data-rd-detail] .rd-title')).toHaveText('가상 긴 글');
    await expect.poll(() => seen(page, H(29)), { timeout: 8000 }).toBe('ok');
    await page.goBack();
    await expect(row).toBeVisible();
    // 줄이 화면에서 있던 높이. 폰은 ±40px 안. PC 넓은 화면은 되돌아올 때 60px 못 미치는 기존 어긋남이 main에서도 같게 재현돼(이 PR 범위 밖, PR 본문 '범위 밖 발견사항')
    // 여기서는 누른 줄이 화면 안에 그대로 보이는지까지만 지킨다.
    if (width < 600) await expect.poll(async () => Math.abs((await topOf()) - before), { timeout: 5000 }).toBeLessThanOrEqual(40);
    else await expect.poll(async () => { const t = await topOf(); return t >= 0 && t <= 700 && Math.abs(t - before) <= 100; }, { timeout: 5000 }).toBe(true);
  });
}

// 저장한 글 [밑줄] 탭(같은 공용 길)에서도 같은 자리로.
test('저장한 글 [밑줄] 탭에서 눌러도 그 밑줄 자리로 간다 (phone-412)', async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 412, height: 900 });
  await openHome(page);
  await server(page);
  await page.evaluate(() => window.KPTURouter.go('reading'));
  await expect(page.locator('#readingView')).toBeVisible();
  await page.locator('#readingView [data-rd-list] .rd-switch [data-filter-value="marks"]').click();
  await page.locator(`#readingView [data-rd-marks] [data-nh-row="${H(1)}"] [data-nh-open]`).click();
  await expect(page.locator('#readingView [data-rd-detail] .rd-title')).toHaveText('가상 긴 글');
  await expect.poll(() => seen(page, H(1)), { timeout: 8000 }).toBe('ok');
});
