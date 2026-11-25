// S68-33 READ-글자크기(명진 11/23 02:30 "+ - 버튼 텍스트 크기"): 읽을 거리 글 보기 머리 단추줄 끝 [−][+] — 본문만 다섯 단계로 커지고 작아진다.
// 끝 단계에서는 그쪽 단추가 꺼진다. 고른 크기는 서버 화면 기억(view_prefs.news_font)에 남아 새로고침 뒤에도 그대로이고, News 글 상세와 같은 값이다.
// 밑줄은 글자 안의 표시라 크기를 바꿔도 같은 글자에 붙어 있다. DB가 새 단계를 아직 모르면(쓰기 400) 이번 접속에서만 그 크기.
// 글·주소는 모두 예시. 서버는 흉내(표는 owner RLS REST, 화면 기억은 view-prefs-server).
import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const A = 'a6833000-0000-4000-8000-000000000001';
const P1 = 'a6833000-0000-4000-8000-000000000011';
const QUOTE = '공공부문 인력 충원이 늦어지는 까닭';
const BODY = `첫 문단은 배경이에요.\n\n둘째 문단: ${QUOTE}을 짚어 봐요.\n\n셋째 문단은 정리예요. 아주 긴 낱말도 줄을 넘지 않아야 해요: 가나다라마바사아자차카타파하가나다라마바사아자차카타파하가나다라마바사아자차카타파하.`;

// News(사회운동 글 하나) — news-detail.spec과 같은 모양을 줄인 것. 먼저 걸고, 읽을 거리 흉내를 뒤에 건다(뒤에 건 것이 먼저 받고 모르는 표는 넘긴다).
async function newsServer(page) {
  const post = { id: P1, source_key: 'kctu', kind: 'statement', lang: 'ko', title: '가상 글 하나', title_ko: null, url: 'https://nodong.org/statement/1', published_at: '2026-10-06T00:30:00Z', fetched_at: '2026-10-06T00:40:00Z', summary_ko: '가상 요약.', key_sentences: [], has_body: true, author: null };
  const body = { state: 'ok', reason: null, blocks: [{ t: 'p', text: '가상 첫 문단이다.' }, { t: 'h', text: '가상 소제목' }, { t: 'quote', text: '가상 인용.' }] };
  await page.route(SB + '/**', async route => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname, method = req.method();
    const ok = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (p === '/functions/v1/outside-feed') return ok({ ok: true, sources: [{ key: 'kctu', name: '민주노총', group: 'labor', lang: 'ko' }] });
    if (p === '/functions/v1/news-feed') return ok({ ok: true, sources: [], limits: {} });
    if (p === '/functions/v1/ai-assist') return ok({ ok: true, ran: false, added: 0 });
    const table = p.startsWith('/rest/v1/') ? p.slice('/rest/v1/'.length) : '';
    if (table === 'app_outside_articles') return ok([post]);
    if (table === 'app_outside_article_bodies') return ok([body]);
    if (table === 'app_outside_reads' || table === 'app_news_reads' || table === 'app_now_signals') return method === 'POST' ? route.fulfill({ status: 201 }) : ok([]);
    if (table === 'app_outside_sources') return ok([{ source_key: 'kctu', enabled: true, last_ok_at: '2026-10-05T09:07:00Z', last_error: null }]);
    if (table === 'app_outside_seen') return ok([{ seen_at: '2026-10-06T00:00:00Z' }]);
    if (table.startsWith('app_now_') || table.startsWith('app_news_') || table.startsWith('app_outside_') || table === 'app_notes') return ok([]);
    return route.fallback();
  });
}
async function readingServer(page) {
  const s = {
    rows: [{ id: A, workspace_id: 'w', url: 'https://example.com/a', title: '예시 기사 하나', site: 'example.com', saved_at: '2026-11-22T01:00:00Z', read_at: null, body_state: 'ok', body_at: '2026-11-22T01:00:10Z', business_area_id: null, updated_at: '2026-11-22T01:00:10Z', body: BODY }],
    hl: [], hlPosts: [],
  };
  await page.route(SB + '/**', async route => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname, method = req.method();
    const ok = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    const body = req.postDataJSON?.() ?? null;
    const table = p.startsWith('/rest/v1/') ? p.slice('/rest/v1/'.length) : '';
    if (table === 'app_reading_items') {
      const id = (u.searchParams.get('id') || '').replace(/^eq\./, '');
      const pick = r => { const { workspace_id, body: b, ...rest } = r; return (u.searchParams.get('select') || '').includes('body') ? { ...rest, body: b } : rest; };
      if (method === 'PATCH') { const r = s.rows.find(x => x.id === id); if (r) Object.assign(r, body); return ok(r ? [pick(r)] : []); }
      return ok((id ? s.rows.filter(x => x.id === id) : s.rows).map(pick));
    }
    if (table === 'app_news_highlights') {
      if (method === 'POST') { const row = { ...body, id: 'b6833000-0000-4000-8000-00000000000' + (s.hl.length + 1), created_at: '2026-11-22T04:00:00Z', updated_at: '2026-11-22T04:00:00Z' }; s.hlPosts.push(body); s.hl.unshift(row); return ok([row], 201); }
      return ok(s.hl);
    }
    return route.fallback();
  });
  return s;
}
async function go(page, width, name) {
  if (width <= 760) {
    await page.locator('#mobileMenuTab').click();
    await page.locator('#mobileMenu nav button:visible', { hasText: name }).click();
  } else await page.locator('#appView>.app-nav').getByRole('link', { name, exact: true }).click();
}
const detail = page => page.locator('#readingView [data-rd-detail]');
const prose = page => detail(page).locator('[data-rd-prose]');
// 글 보기는 원문 다시 받기 등으로 다시 그려질 수 있다 — 읽는 사이 칸이 바뀌면(떨어진 마디는 글자 크기가 빈 값) 다시 읽는다.
const fontPx = async loc => {
  for (let i = 0; i < 40; i++) {
    const v = await loc.evaluate(el => el.isConnected ? parseFloat(getComputedStyle(el).fontSize) : NaN).catch(() => NaN);
    if (v > 0) return v;
    await loc.page().waitForTimeout(50);
  }
  return NaN;
};
const noWideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
async function openReading(page, width) {
  await go(page, width, '저장한 글');
  await expect(page.locator('#readingView')).toBeVisible();
  await page.locator(`#readingView .rd-row[data-rd-open="${A}"]`).click();
  await expect(prose(page).locator('p')).toHaveCount(3);
}
// S68-45: 연 글은 읽음이 되어 [안 읽음]에서 빠지므로 다시 열 때는 [전체]에서.
async function openAgain(page) {
  await page.locator('#readingView .rd-switch [data-filter-value="all"]').click();
  await page.locator(`#readingView .rd-row[data-rd-open="${A}"]`).click();
}
const pick = (page, text) => page.evaluate(t => {
  const p = [...document.querySelectorAll('#readingView [data-rd-prose] p')].find(x => x.textContent.includes(t));
  const node = [...p.childNodes].find(n => n.nodeType === 3 && n.data.includes(t));
  const i = node.data.indexOf(t), r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + t.length);
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
}, text);

for (const [label, width] of [['phone-390', 390], ['pc-1280', 1280]]) {
  test(`읽을 거리 글자 크기 [−][+]: 본문만·끝에서 꺼짐·밑줄 그대로·새로고침 뒤 유지·News와 같은 값 (${label})`, async ({ page }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width, height: 900 });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const { prefs } = await openHome(page);
    await newsServer(page);
    const s = await readingServer(page);
    await openReading(page, width);

    // 단추 자리: 글 머리 첫 줄 아이콘 줄(공용 .ds-doc-icons, S70-40b) [↗ 원래 페이지][−][+][⋯], 이름 '글자 작게'·'글자 크게', 공용 ⑤ 모양(작은 칸).
    const acts = detail(page).locator('.ds-doc-top .ds-doc-icons');
    const ctl = acts.locator('[data-text-size-ctl]');
    await expect(ctl).toHaveAttribute('role', 'group');
    await expect(ctl).toHaveAttribute('aria-label', '글자 크기');
    expect(await acts.evaluate(el => el.lastElementChild.matches('[data-rd-head-more]') && el.lastElementChild.previousElementSibling.matches('[data-text-size-ctl]'))).toBe(true);
    const smaller = ctl.getByRole('button', { name: '글자 작게' }), bigger = ctl.getByRole('button', { name: '글자 크게' });
    await expect(smaller).toHaveClass(/ds-seg-btn/);
    expect((await bigger.boundingBox()).height).toBeLessThanOrEqual(32);

    // 밑줄 하나 긋고 시작.
    await pick(page, QUOTE);
    await page.locator('div[data-hl-bar]').getByRole('button', { name: '밑줄 저장' }).click();
    await expect.poll(() => s.hlPosts.length).toBe(1);
    const mark = prose(page).locator('mark.hl-mark');
    await expect(mark).toHaveText(QUOTE);

    const title = detail(page).locator('.rd-title');
    const base = await fontPx(prose(page)), titleBase = await fontPx(title), btnBase = await fontPx(bigger);
    const markH = (await mark.first().boundingBox()).height;
    await expect(detail(page).locator('[data-rd-prose]')).toHaveAttribute('data-text-size', 'm');

    // 크게 세 번 → 끝(아주 크게), [+] 꺼짐. 본문만 커지고 제목·단추 글자는 그대로. 서버에 저장.
    for (const want of ['l', 'xl', 'xxl']) {
      await bigger.click();
      await expect(prose(page)).toHaveAttribute('data-text-size', want);
    }
    await expect(bigger).toBeDisabled();
    await expect(smaller).toBeEnabled();
    await expect(smaller).toBeFocused();
    await expect.poll(() => fontPx(prose(page))).toBeCloseTo(base * 1.5625, 1);
    await expect.poll(() => fontPx(prose(page).locator('p').first())).toBeCloseTo(base * 1.5625, 1);
    await expect.poll(() => fontPx(title)).toBe(titleBase);
    await expect.poll(() => fontPx(bigger)).toBe(btnBase);
    await expect.poll(() => prefs.value?.news_font).toBe('xxl');
    // 밑줄은 같은 글자에 그대로(글자와 함께 커짐), 화면 가로 넘침 없음.
    await expect(mark).toHaveText(QUOTE);
    expect((await mark.first().boundingBox()).height).toBeGreaterThan(markH);
    expect(await noWideScroll(page)).toBe(true);

    // 키보드로 작게: 기본 아래 한 단계(작게)가 끝 — [−] 꺼짐.
    for (const want of ['xl', 'l', 'm', 's']) {
      await page.keyboard.press('Enter');
      await expect(prose(page)).toHaveAttribute('data-text-size', want);
    }
    await expect(smaller).toBeDisabled();
    await expect.poll(() => fontPx(prose(page))).toBeCloseTo(base * 0.875, 1);
    await expect.poll(() => prefs.value?.news_font).toBe('s');
    await expect(mark).toHaveText(QUOTE);
    await bigger.click(); await bigger.click(); await bigger.click();
    await expect(prose(page)).toHaveAttribute('data-text-size', 'xl');
    await expect.poll(() => prefs.value?.news_font).toBe('xl');

    // 새로고침 뒤에도 서버 값 그대로(기기 저장 없음).
    await page.reload();
    await expect(page.locator('#readingView')).toBeVisible();
    if (!(await prose(page).locator('p').count())) await openAgain(page);
    await expect(prose(page)).toHaveAttribute('data-text-size', 'xl');
    await expect.poll(() => fontPx(prose(page))).toBeCloseTo(base * 1.375, 1);
    await expect(prose(page).locator('mark.hl-mark')).toHaveText(QUOTE);

    // News 글 상세도 같은 값(같은 단추). 거기서 한 단계 작게 → 읽을 거리도 따라감.
    await go(page, width, '읽을 거리');
    await expect(page.locator('#outsideView')).toBeVisible();
    await page.locator('#outsideRoot').getByRole('tab', { name: '사회운동' }).click();
    await page.locator(`#outsideRoot [data-os-list] [data-nw-key="outside:${P1}"] .now-open`).click();
    const nd = page.locator('#outsideRoot [data-now-detail] .nd');
    await expect(nd.locator('[data-nd-prose] p').first()).toHaveText('가상 첫 문단이다.');
    await expect(nd).toHaveAttribute('data-text-size', 'xl');
    await expect.poll(() => fontPx(nd.locator('[data-nd-prose]'))).toBe(22);
    await expect.poll(() => fontPx(nd.locator('[data-nd-prose] blockquote'))).toBe(22);
    await nd.getByRole('button', { name: '글자 작게' }).click();
    await expect(nd).toHaveAttribute('data-text-size', 'l');
    await expect.poll(() => fontPx(nd.locator('[data-nd-prose]'))).toBe(19);
    await expect.poll(() => prefs.value?.news_font).toBe('l');
    expect(await noWideScroll(page)).toBe(true);
    await go(page, width, '저장한 글');
    if (!(await prose(page).locator('p').count())) await openAgain(page);
    await expect(prose(page)).toHaveAttribute('data-text-size', 'l');
    expect(errors).toEqual([]);
  });
}

test('DB가 새 단계를 아직 모르면(쓰기 400) 이번 접속에서만 그 크기, 아는 단계는 저장', async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 390, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const { prefs } = await openHome(page);
  prefs.denyValues = { news_font: ['xl', 'xxl'] };
  await newsServer(page);
  await readingServer(page);
  await openReading(page, 390);
  const bigger = detail(page).getByRole('button', { name: '글자 크게' });
  await bigger.click();
  await expect.poll(() => prefs.value?.news_font).toBe('l');
  await bigger.click();
  await expect(prose(page)).toHaveAttribute('data-text-size', 'xl');
  // 서버는 거절했지만 화면은 고른 크기 그대로(되돌아가 깜빡이지 않음).
  await page.waitForTimeout(1200);
  await expect(prose(page)).toHaveAttribute('data-text-size', 'xl');
  expect(prefs.value?.news_font).toBe('l');
  expect(errors).toEqual([]);
});
