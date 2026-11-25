import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { newsServer, openNews, ITEMS } from './helpers/news-server.mjs';
// NEWS-모두에게열기 ③ 화면(설계 docs/design/news-for-all.md 13·14절): 두 작업공간(w = 운영자, w2 = 다른 사람)이 같은 공용 기사 목록을 보고,
// 별표·읽음은 사람마다 따로 둔다. 가짜 서버는 공용 기사 한 벌 + 작업공간별 표시·읽음을 들고, 작업공간 주인 정책처럼 '부른 사람 작업공간' 줄만 준다.
// 화면이 다른 작업공간 id로 표시·읽음을 묻거나 쓰면 위반으로 적고 거절한다(403). 기사·주소는 모두 가짜(example.org).
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const MARK = ['starred_at', 'folder_id', 'hidden_at'];
const root = page => page.locator('#newsRoot');
const items = page => root(page).locator('[data-nc-item]');
const item = (page, id) => root(page).locator(`[data-nc-item="${id}"]`);

function sharedStore() {
  const articles = ITEMS().map(({ starred_at, folder_id, keywords, _body, _body_ko, ...a }) => ({ ...a, body: _body, body_ko: null }));
  return { articles, marks: new Map(), saved: new Map(), reads: new Set(), signals: [], violations: [], asked: { w: [], w2: [] } };
}

// 한 사람(작업공간 me)의 화면이 부르는 공용·사람별 표. 다른 작업공간 id가 주소·몸통에 있으면 거절(서버 owner 정책 흉내).
async function installShared(page, store, me) {
  await page.route(u => u.origin === SB && /^\/rest\/v1\/(app_news_articles|app_news_marks|app_news_reads|app_news_now_signals|app_news_items|app_feed_reads|app_now_signals|rpc\/app_news_article_of|app_reading_items|rpc\/app_reading_keep)$/.test(u.pathname), async route => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname.slice('/rest/v1/'.length), method = req.method();
    const body = req.postDataJSON?.() ?? null, query = decodeURIComponent(u.search);
    const ok = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    store.asked[me].push(`${method} ${p}${query} ${body ? JSON.stringify(body) : ""}`);
    const other = me === 'w' ? 'w2' : 'w';
    if (new RegExp(`workspace_id=eq\\.${other}(&|$| )`).test(query) || body?.workspace_id === other || body?.p_workspace === other) { store.violations.push({ me, p, query, body }); return ok({ code: '42501', message: 'new row violates row-level security policy' }, 403); }
    if (p === 'rpc/app_news_article_of') return ok([]);
    if (p === 'app_news_items' || p === 'app_feed_reads' || p === 'app_now_signals') return ok([]); // 옮기는 동안 같이 써 보는 옛 표: 받기만
    const key = id => `${me}:${id}`;
    const markOf = id => store.marks.get(key(id)) || null;
    // S68-27: 보관 = 그 기사를 가리키는 내 읽을 거리 줄(저장 시각). 쓰기는 서버 함수 하나(작업공간 = 나).
    const savedOf = id => (store.saved.has(key(id)) ? [{ saved_at: store.saved.get(key(id)) }] : []);
    if (p === 'rpc/app_reading_keep') {
      expect(body.p_workspace).toBe(me);
      const was = store.saved.get(key(body.p_article)) || null;
      if (body.p_on) { store.saved.set(key(body.p_article), was || body.p_saved_at || new Date().toISOString()); return ok({ ok: true, on: true, id: 'r', saved_at: store.saved.get(key(body.p_article)), created: !was }); }
      store.saved.delete(key(body.p_article)); return ok({ ok: true, on: false, removed: was ? 1 : 0, saved_at: was });
    }
    if (p === 'app_reading_items') {
      expect(query).toContain(`workspace_id=eq.${me}`);
      if (!u.searchParams.has('news_article_id')) return route.fallback();
      const want = u.searchParams.get('news_article_id'), ids = /^in\.\((.*)\)$/.exec(want)?.[1]?.split(','), one = /^eq\.(.*)$/.exec(want)?.[1];
      const mine = [...store.saved].filter(([k]) => k.startsWith(me + ':')).map(([k, at]) => [k.slice(me.length + 1), at]).filter(([id]) => (!ids || ids.includes(id)) && (!one || id === one));
      return ok(mine.map(([id, at]) => ({ id: 'r-' + id, saved_at: at, news_article_id: id, app_news_articles: { ...store.articles.find(a => a.id === id), app_news_marks: markOf(id) ? [markOf(id)] : [] } })));
    }
    if (p === 'app_news_articles') {
      // 내 표시를 붙여 읽을 때는 늘 내 작업공간으로 거른다(공용 칸만 읽을 때는 표시 없음).
      if (query.includes('app_news_marks(')) expect(query).toContain(`app_news_marks.workspace_id=eq.${me}`);
      else expect(query).not.toContain('app_news_marks');
      if (query.includes('app_reading_items(')) expect(query).toContain(`app_reading_items.workspace_id=eq.${me}`);
      const inKeys = /^in\.\((.*)\)$/.exec(u.searchParams.get('source_key') || '')?.[1]?.split(',');
      const id = (u.searchParams.get('id') || '').replace(/^eq\./, '');
      const rows = store.articles.filter(a => (!id || a.id === id) && (!inKeys || inKeys.includes(a.source_key)));
      return ok(query.includes('app_news_marks(') ? rows.map(a => ({ ...a, app_news_marks: markOf(a.id) ? [markOf(a.id)] : [], app_reading_items: savedOf(a.id) })) : rows);
    }
    if (p === 'app_news_marks') {
      expect(query + JSON.stringify(body || {})).toContain(me);
      const aid = (u.searchParams.get('article_id') || '').replace(/^eq\./, '');
      const out = (id, m) => ({ article_id: id, starred_at: m.starred_at ?? null, folder_id: m.folder_id ?? null, hidden_at: m.hidden_at ?? null, keywords: m.keywords || [] });
      if (method === 'PATCH') { const m = markOf(aid); if (!m) return ok([]); for (const k of MARK) if (k in body) m[k] = body[k]; return ok([out(aid, m)]); }
      if (method === 'POST') { const m = { keywords: [] }; for (const k of MARK) if (k in body) m[k] = body[k]; store.marks.set(key(body.article_id), m); return ok([out(body.article_id, m)], 201); }
      const star = u.searchParams.get('starred_at');
      const mine = [...store.marks].filter(([k]) => k.startsWith(me + ':')).map(([k, m]) => [k.slice(me.length + 1), m]);
      return ok(mine.filter(([id, m]) => (!aid || id === aid) && (!star || m.starred_at)).map(([id, m]) => ({ ...out(id, m), app_news_articles: { ...store.articles.find(a => a.id === id), app_reading_items: savedOf(id) } })));
    }
    if (p === 'app_news_reads') {
      if (method === 'POST') { expect(body.workspace_id).toBe(me); store.reads.add(key(body.article_id)); return route.fulfill({ status: 201 }); }
      expect(query).toContain(`workspace_id=eq.${me}`);
      const ids = /^in\.\((.*)\)$/.exec(u.searchParams.get('article_id') || '')?.[1]?.split(',') || [];
      return ok(ids.filter(id => store.reads.has(key(id))).map(id => ({ article_id: id })));
    }
    if (p === 'app_news_now_signals') { expect(body.workspace_id).toBe(me); store.signals.push({ me, ...body }); return route.fulfill({ status: 201 }); }
    return ok([]);
  });
}

async function openAs(browser, store, me, width) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await openHome(page, { beforeLoad: async () => {
    // 두 번째 사람: 자기 작업공간 하나(주인 행 하나).
    if (me === 'w2') await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_workspace_members', r => r.fulfill({ json: [{ workspace_id: 'w2', role: 'owner', workspace: { id: 'w2', name: 'QA2', slug: 'qa-two' } }] }));
  } });
  await newsServer(page);
  await installShared(page, store, me);
  await openNews(page, width);
  return { ctx, page, errors };
}

for (const width of [412, 1280]) {
  test(`NEWS-모두에게열기 ${width}: 두 작업공간 — 같은 기사 목록, 별표·읽음은 각자, 다른 작업공간 표시는 안 보이고 묻지도 않는다`, async ({ browser }) => {
    test.setTimeout(120000);
    const store = sharedStore();
    const a = await openAs(browser, store, 'w', width);
    await expect(items(a.page)).toHaveCount(5);
    // A: c1 상세를 열어(읽음) 별표.
    await item(a.page, 'c1').locator('[data-nc-open="c1"]').click();
    await a.page.locator('#nowDetail [data-nd-act="star"]').click();
    await expect(a.page.locator('#nowDetail [data-nd-act="star"]')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => store.saved.get('w:c1')).toBeTruthy();
    expect([...store.marks.values()].some(m => m.starred_at)).toBe(false); // 표시 표의 옛 별표 칸에는 쓰지 않는다
    await expect.poll(() => store.reads.has('w:c1')).toBe(true);
    await expect.poll(() => store.signals.some(s => s.me === 'w' && s.article_id === 'c1' && s.action === 'star')).toBe(true);
    // 반응은 새 표에만 한 줄(옛 app_now_signals에 같이 쓰면 보충 함수가 다시 옮겨 두 줄이 된다, S62-12g).
    expect(store.asked.w.filter(c => c.startsWith('POST app_now_signals'))).toEqual([]);

    const b = await openAs(browser, store, 'w2', width);
    // B: 같은 공용 기사 목록(같은 줄·같은 제목).
    await expect(items(b.page)).toHaveCount(5);
    expect(await items(b.page).evaluateAll(els => els.map(e => e.dataset.ncItem))).toEqual(await items(a.page).evaluateAll(els => els.map(e => e.dataset.ncItem)));
    await expect(item(b.page, 'c1').locator('.nw-title')).toHaveText('가짜 채널 기사');
    // A의 별표·읽음은 B 화면에 없다(c1은 B에게 아직 안 읽은 글, 별표 없음).
    await expect(item(b.page, 'c1')).toHaveClass(/is-new/);
    await expect(item(b.page, 'c1').locator('.nw-star')).toHaveCount(0);
    // B 읽을 거리(S68-24·S68-28·S68-29: News에서 보낸 글도 평범한 읽을 거리 줄, [News] 칩 없음): 비어 있음(A가 별표한 기사 없음).
    await b.page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_reading_items', r => r.fulfill({ json: [] }));
    await b.page.evaluate(() => window.KPTURouter.go('reading'));
    await expect(b.page.locator('#readingView')).toBeVisible();
    await expect(b.page.locator('#readingView .rd-switch [data-filter-value]')).toHaveText(['전체', '안 읽음', '밑줄', '메모']);
    await b.page.locator('#readingView .rd-switch [data-filter-value="all"]').click();
    await expect(b.page.locator('#readingView .rd-switch [data-filter-value="all"]')).toHaveAttribute('aria-checked', 'true');
    await expect(b.page.locator('#readingView [data-rd-rows]')).toContainText('저장한 글이 없어요');
    await expect(b.page.locator('#readingView .rd-row')).toHaveCount(0);
    await b.page.goBack();
    await expect(b.page.locator('#outsideView')).toBeVisible();
    // B가 k1을 숨겨도 A 목록에는 그대로.
    await b.page.locator('#outsideRoot [data-os-tab="media"]').click();
    await expect(items(b.page)).toHaveCount(5);
    await item(b.page, 'k1').locator('[data-nc-open="k1"]').click();
    await b.page.locator('#nowDetail [data-nd-act="dismiss"]').click();
    await expect.poll(() => store.marks.get('w2:k1')?.hidden_at).toBeTruthy();
    expect(store.marks.get('w:k1')).toBeUndefined();
    expect(store.marks.get('w2:c1')).toBeUndefined();
    expect(store.saved.has('w2:c1')).toBe(false);
    await a.page.reload();
    await openNews(a.page, width);
    await expect(item(a.page, 'k1')).toHaveCount(1);
    await expect(item(a.page, 'c1').locator('.nw-star')).toHaveCount(1);
    await expect(item(a.page, 'c1')).not.toHaveClass(/is-new/);

    // 어느 쪽도 다른 작업공간 id로 표시·읽음을 묻거나 쓰지 않았다. 공용 기사 표에는 쓰지 않았다(읽기만).
    expect(store.violations).toEqual([]);
    for (const me of ['w', 'w2']) {
      expect(store.asked[me].filter(x => x.startsWith('GET app_news_articles')).length).toBeGreaterThan(0);
      expect(store.asked[me].filter(x => /^(POST|PATCH|DELETE) app_news_articles/.test(x))).toEqual([]);
      expect(store.asked[me].filter(x => / (app_news_(marks|reads)|app_reading_items|rpc\/app_reading_keep)/.test(x) && !new RegExp(`(workspace_id=eq\\.|"workspace_id":"|"p_workspace":")${me}(&|"| |$)`).test(x))).toEqual([]);
    }
    expect(a.errors).toEqual([]); expect(b.errors).toEqual([]);
    await a.ctx.close(); await b.ctx.close();
  });
}
