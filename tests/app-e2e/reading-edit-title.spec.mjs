import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { noticeText } from './helpers/small-notice.mjs';
// S69 READ-제목하나·READ-첨부본문·저장한 글 [수정](명진 11/24 "제목이 점점 힘들어지는.. 이건데 목록에서 이상한 제목이 보임" ·
// "그리고 목록에서 ... 안에 수정 버튼도 있어야"):
// ① 제목의 주인 하나: News에서 온 줄의 기사를 사람이 고쳤으면(손으로 넣은 기사) 목록도 그 제목 — 사본을 서버에서 맞춘다(글 보기와 같은 제목).
// ② 목록 ⋯ 맨 앞 [수정]: 직접 넣은 줄은 이 화면 글 보기 안 제목·매체 칸 → 저장 → 목록 갱신. News 뉴스 기사 줄은 그 글 보기의 ⋯ [수정] 창이 바로 열림.
// ③ 짧은 손 본문('[사진 1] .'): 요약 대신 '본문이 짧아 요약하지 않았어요', 원문 칸 '본문을 못 가져왔어요 · [원문 다시 가져오기]' → 다시 가져오면 본문·요약.
// 서버는 흉내(기사·주소는 모두 가짜, example.org).
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const N1 = 'b6900000-0000-4000-8000-000000000011', RN1 = 'c6900000-0000-4000-8000-000000000011', D1 = 'c6900000-0000-4000-8000-000000000021';
const ORIG = '[제2026-27호] 원래 쪽 제목 예시', MINE = '점점 힘들어지는 예시 입사 -> 이직 테크';
const PHOTO = 'https://img.example.org/graph.png';
const LONG = ['예시 보고서 첫 문단: 청년층 고용률이 하락하고 있으며 중소기업 입사 뒤 대기업으로 옮기는 길이 좁아지고 있다.', '둘째 문단: 일자리 정책의 방향을 다시 짚어 볼 필요가 있다.'];
const line = extra => ({ url: '', title: null, site: null, read_at: null, body_state: 'ok', body_at: '2026-11-23T00:30:00Z', business_area_id: null, updated_at: '2026-11-23T00:30:00Z', origin: 'direct', news_article_id: null, outside_article_id: null, ...extra });
const DETAIL = { ok: true, kind: 'now_detail', detail: { level: 'full', summary: '다시 가져온 본문으로 만든 가짜 요약.', key_sentences: [], relevance: null, implications: null, related: [], generated_at: '2026-11-24T01:00:00Z', context_at: null }, stale: false };

async function server(page) {
  const s = {
    reading: [
      line({ id: RN1, url: 'https://www.example.org/bbs/view?n=1', title: ORIG, site: '예시은행', saved_at: '2026-11-23T00:21:00Z', origin: 'news', news_article_id: N1 }),
      line({ id: D1, url: 'https://example.com/d/1', title: '직접 넣은 예시 글', site: 'example.com', saved_at: '2026-11-22T00:00:00Z', read_at: '2026-11-22T01:00:00Z' }),
    ],
    news: [{ id: N1, lane: 'channel', url: 'https://www.example.org/bbs/view?n=1', title: MINE, lang: 'ko', publisher: '예시은행', source_key: null, keywords: [], published_at: '2026-11-23T00:21:00Z', scrapped_at: null,
      created_at: '2026-11-23T00:21:00Z', state: 'ok', summary: null, body_kind: 'full', title_ko: null, translated_at: null, author: null, manual_at: '2026-11-23T00:21:00Z', origin: 'user', body: '.' }],
    body: { state: 'ok', reason: null, rule: 'manual@1', blocks: [{ t: 'img', src: PHOTO, cap: null, alt: null }, { t: 'p', text: '.' }] },
    patches: [], opens: [], ai: 0, titleReads: [],
  };
  await page.route(SB + '/**', async route => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname, method = req.method();
    const ok = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    const body = req.postDataJSON?.() ?? null;
    if (p === '/functions/v1/outside-feed') return ok({ ok: true, sources: [] });
    if (p === '/functions/v1/news-feed') {
      if (u.searchParams.get('action') === 'open') {
        s.opens.push(body);
        // 짧은 손 본문 + again → 원래 주소(첨부 PDF)로 전문. 손 사진은 앞에 남는다(서버 규칙 흉내).
        if (body?.again === true) { s.body = { state: 'ok', reason: null, rule: 'open@3', blocks: [{ t: 'img', src: PHOTO, cap: null, alt: null }, ...LONG.map(text => ({ t: 'p', text }))] }; s.news[0].body = LONG.join('\n'); }
        return ok({ ok: true, status: body?.again ? 'ok' : 'stored' });
      }
      return ok({ ok: true, sources: [], limits: {}, status: 'ok' });
    }
    if (p === '/functions/v1/ai-assist') {
      if (body?.kind !== 'now_detail') return ok({ ok: true, kind: body?.kind, detail: null, ran: false, added: 0 });
      s.ai += 1;
      // 서버 재료 규칙 흉내: 본문 글자가 짧으면 422 no_material.
      if (String(s.news[0].body).replace(/[\s\p{P}\p{S}]/gu, '').length < 20) return ok({ ok: false, error: 'no_material', message: 'AI 요청을 처리하지 못했어요.' }, 422);
      return ok(DETAIL);
    }
    const table = p.startsWith('/rest/v1/') ? p.slice('/rest/v1/'.length) : '';
    const eq = k => (u.searchParams.get(k) || '').replace(/^eq\./, '');
    if (table === 'app_reading_items') {
      if (method === 'PATCH') { s.patches.push({ id: eq('id'), body }); const r = s.reading.find(x => x.id === eq('id')); if (r) Object.assign(r, body); return ok(r ? [{ ...r }] : []); }
      if (eq('id')) return ok(s.reading.filter(r => r.id === eq('id')).map(r => ({ ...r, body: '저장해 둔 원문 사본.' })));
      const nid = u.searchParams.get('news_article_id');
      if (nid) return ok(s.reading.filter(r => nid === 'not.is.null' ? r.news_article_id : r.news_article_id === nid.replace(/^eq\./, '')).map(r => ({ ...r, app_news_articles: { ...s.news.find(n => n.id === r.news_article_id), app_news_marks: [] } })));
      if (u.searchParams.get('outside_article_id')) return ok([]);
      return ok([...s.reading].sort((x, y) => String(y.saved_at).localeCompare(String(x.saved_at))));
    }
    if (table === 'app_news_articles') {
      const raw = u.searchParams.get('id') || '';
      if (raw.startsWith('in.(')) { s.titleReads.push(decodeURIComponent(u.search)); const ids = raw.slice(4, -1).split(','); return ok(s.news.filter(n => ids.includes(n.id) && n.manual_at).map(n => ({ id: n.id, title: n.title, manual_at: n.manual_at }))); }
      return ok(s.news.filter(n => !eq('id') || n.id === eq('id')).map(n => ({ ...n, app_news_marks: [], app_reading_items: [{ saved_at: '2026-11-23T00:21:00Z' }] })));
    }
    if (table === 'app_news_article_bodies') return ok(eq('article_id') === N1 ? [s.body] : []);
    if (table.startsWith('rpc/app_news_article_of') || table.startsWith('rpc/app_outside_article_of')) return ok([]);
    if (table.startsWith('app_news_') || table.startsWith('app_now_') || table.startsWith('app_outside_') || table === 'app_feed_reads') return method === 'POST' ? route.fulfill({ status: 201 }) : ok([]);
    return route.fallback();
  });
  return s;
}
async function start(page, width) {
  await page.setViewportSize({ width, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await openHome(page);
  const s = await server(page);
  if (width <= 760) {
    await page.locator('#mobileMenuTab').click();
    await page.locator('#mobileMenu nav button:visible', { hasText: '저장한 글' }).click();
  } else await page.locator('#appView>.app-nav').getByRole('link', { name: '저장한 글', exact: true }).click();
  await expect(page.locator('#readingView')).toBeVisible();
  await rlist(page).locator('.rd-switch [data-filter-value="all"]').click();
  return { errors, s };
}
const rlist = page => page.locator('#readingView [data-rd-list]');
const rdetail = page => page.locator('#readingView [data-rd-detail]');
const row = (page, id) => rlist(page).locator(`.rd-row[data-rd-open="${id}"]`);
const nd = page => page.locator('#outsideRoot [data-now-detail] .nd');

for (const width of [412, 1280]) {
  test(`제목 주인 하나 ${width}: 사람이 고친 기사 제목이 목록에도 — 사본을 서버에서 맞춤, 글 보기와 같은 제목`, async ({ page }) => {
    test.setTimeout(90000);
    const { errors, s } = await start(page, width);
    await expect(row(page, RN1).locator('.rd-nm')).toHaveText(MINE);
    await expect.poll(() => s.patches.find(x => x.id === RN1 && x.body.title)?.body.title).toBe(MINE);
    expect(s.titleReads.every(q => q.includes('manual_at=not.is.null'))).toBe(true);
    // 직접 넣은 줄 제목은 그대로(고치지 않음).
    await expect(row(page, D1).locator('.rd-nm')).toHaveText('직접 넣은 예시 글');
    expect(s.patches.some(x => x.id === D1)).toBe(false);
    // 줄을 누르면 News 글 보기 — 같은 제목.
    await row(page, RN1).click();
    await expect(nd(page).locator('.nd-title')).toHaveText(MINE);
    expect(errors).toEqual([]);
  });

  test(`목록 ⋯ [수정] ${width}: 직접 넣은 줄은 이 화면 칸 → 저장 → 목록 갱신`, async ({ page }) => {
    test.setTimeout(90000);
    const { errors, s } = await start(page, width);
    await row(page, D1).locator('[data-rd-more]').click();
    await expect(page.locator('#rdRowMenu button').first()).toHaveText('수정');
    await page.locator('#rdRowMenu button', { hasText: '수정' }).click();
    const form = rdetail(page).locator('[data-rd-edit-form]');
    await expect(form).toBeVisible();
    await expect(form.locator('input[name="title"]')).toHaveValue('직접 넣은 예시 글');
    await expect(form.locator('input[name="site"]')).toHaveValue('example.com');
    await form.locator('input[name="title"]').fill('  고친 예시 제목 ');
    await form.getByRole('button', { name: '저장' }).click();
    await expect.poll(() => s.patches.find(x => x.id === D1 && 'title' in x.body)?.body).toMatchObject({ title: '고친 예시 제목', site: 'example.com' });
    await expect(form).toHaveCount(0);
    await expect(rdetail(page).locator('.rd-title')).toHaveText('고친 예시 제목');
    if (width > 760) await expect(row(page, D1).locator('.rd-nm')).toHaveText('고친 예시 제목');
    expect(await noticeText(page)).toContain('저장했어요');
    // 글 보기 머리 ⋯ [수정]도 같은 칸(S70-40b: 테두리 단추줄 대신 머리 ⋯).
    await rdetail(page).locator('[data-rd-head-more]').click();
    await page.locator('#rdRowMenu [data-rd-act="edit"]').click();
    await expect(form).toBeVisible();
    await rdetail(page).locator('[data-rd-edit-cancel]').click();
    await expect(form).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });

  test(`목록 ⋯ [수정] ${width}: News 뉴스 기사 줄은 그 글 보기의 [수정] 창이 바로(같은 칸), 짧은 손 본문은 요약 대신 한 줄 → [원문 다시 가져오기]`, async ({ page }) => {
    test.setTimeout(90000);
    const { errors, s } = await start(page, width);
    await row(page, RN1).locator('[data-rd-more]').click();
    await page.locator('#rdRowMenu button', { hasText: '수정' }).click();
    const form = nd(page).locator('[data-nd-hand-form]');
    await expect(form).toBeVisible();
    await expect(form.locator('[data-nd-hand-in="title"]')).toHaveValue(MINE);
    await expect(form.locator('[data-nd-hand-in="body"]')).toHaveValue(new RegExp(PHOTO.replace(/[.]/g, '\\.')));
    await form.locator('[data-nd-hand-cancel]').click();
    await expect(form).toHaveCount(0);
    // 짧은 손 본문: 요약을 만들지 않고 한 줄, 시사점 칸 없음. 원문 칸은 '본문을 못 가져왔어요 · [원문 다시 가져오기] · 원래 사이트'.
    await expect(nd(page).locator('[data-nd-short-sum]')).toHaveText('본문이 짧아 요약하지 않았어요');
    await expect(nd(page).locator('[data-nd-implications]')).toBeHidden();
    const why = nd(page).locator('[data-nd-short]');
    await expect(why).toContainText('본문을 못 가져왔어요');
    await expect(why.locator('a[data-nd-link]')).toHaveAttribute('href', 'https://www.example.org/bbs/view?n=1');
    await why.locator('[data-nd-refetch-hand]').click();
    await expect.poll(() => s.opens.some(o => o.id === N1 && o.again === true)).toBe(true);
    await expect(nd(page).locator('[data-nd-prose]')).toContainText('청년층 고용률이 하락하고');
    await expect(nd(page).locator('[data-nd-short]')).toHaveCount(0);
    await expect(nd(page).locator('[data-nd-summary]')).toContainText('다시 가져온 본문으로 만든 가짜 요약.');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}
