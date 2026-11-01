// NEWS-클리핑 E2E 공용 흉내 서버(뉴스 클리핑 화면 C1·C2). 기사·매체·주소·폴더·메모는 모두 가짜(example.org).
import { expect } from '@playwright/test';
import { openHome } from './home-entry.mjs';
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const CATALOG = [
  { key: 'news-fake-a', name: '가짜노동신문', region: 'domestic', lang: 'ko' },
  { key: 'news-fake-b', name: '가짜일보', region: 'domestic', lang: 'ko' },
  { key: 'news-fake-en', name: 'Fake Wire', region: 'foreign', lang: 'en' },
];
const LIMITS = { fill: 10, translate: 20, open: 60, keyword_items: 30, keywords: 30 };
export const ITEMS = () => [
  { id: 'c1', lane: 'channel', url: 'https://example.org/c1', title: '가짜 채널 기사', lang: 'ko', publisher: '가짜노동신문', source_key: null, keywords: [], published_at: '2026-10-06T00:00:00Z', scrapped_at: '2026-10-06T00:20:00Z', created_at: '2026-10-06T00:21:00Z', state: 'ok', summary: '가짜 채널 기사 한 문장 요약.', body_kind: null, title_ko: null, translated_at: null, starred_at: null, folder_id: null, _body: null },
  { id: 'k1', lane: 'keyword', url: 'https://news.google.com/rss/articles/fake-1', title: '가짜 키워드 기사', lang: 'ko', publisher: '가짜일보', source_key: null, keywords: ['가짜어'], published_at: '2026-10-05T22:00:00Z', scrapped_at: null, created_at: '2026-10-06T00:10:00Z', state: 'ok', summary: '가짜 키워드 요약.', body_kind: null, title_ko: null, translated_at: null, starred_at: null, folder_id: null, _body: null },
  { id: 'e1', lane: 'media', url: 'https://example.org/en1', title: 'A fake foreign story', lang: 'en', publisher: 'Fake Wire', source_key: 'news-fake-en', keywords: [], published_at: '2026-10-05T03:00:00Z', scrapped_at: null, created_at: '2026-10-05T03:10:00Z', state: 'ok', summary: 'One fake line.', body_kind: 'full', title_ko: '가짜 외국 기사', translated_at: '2026-10-05T03:20:00Z', starred_at: null, folder_id: null, _body: 'Fake body paragraph.' },
  { id: 'p1', lane: 'channel', url: 'https://example.org/paid', title: '가짜 유료 기사', lang: 'ko', publisher: '가짜일보', source_key: null, keywords: [], published_at: null, scrapped_at: '2026-10-05T02:00:00Z', created_at: '2026-10-05T02:01:00Z', state: 'paywall', summary: '공개된 가짜 요약.', body_kind: 'lead', title_ko: null, translated_at: null, starred_at: null, folder_id: null, _body: '공개된 가짜 앞부분.' },
  { id: 'w1', lane: 'channel', url: 'https://www.example.org/wait', title: null, lang: 'ko', publisher: null, source_key: null, keywords: [], published_at: null, scrapped_at: '2026-10-04T02:00:00Z', created_at: '2026-10-04T02:01:00Z', state: 'pending', summary: null, body_kind: null, title_ko: null, translated_at: null, starred_at: null, folder_id: null, _body: null },
];

export async function newsServer(page) {
  const server = { folders: [], notes: [], items: ITEMS(), keywords: [{ word: '가짜어', enabled: true, created_at: '2026-10-01T00:00:00Z' }], sources: new Map([['news-fake-a', { source_key: 'news-fake-a', enabled: true, last_ok_at: '2026-10-06T00:07:00Z', last_error: null }]]), calls: [] };
  await page.route(SB + '/**', async route => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname, method = req.method();
    const ok = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    const body = req.postDataJSON?.() ?? null;
    if (p === '/functions/v1/news-feed') {
      const action = u.searchParams.get('action');
      server.calls.push({ what: 'edge', action, method, auth: req.headers().authorization || '', body });
      if (action === 'catalog') return ok({ ok: true, sources: CATALOG, limits: LIMITS });
      if (action === 'open') { const it = server.items.find(i => i.id === body.id); it._body = '가짜 본문 첫 문단.'; it.body_kind = 'full'; return ok({ ok: true, status: 'ok' }); }
      if (action === 'translate') { const it = server.items.find(i => i.id === body.id); if (it._body_ko) return ok({ ok: true, status: 'stored' }); it.title_ko ||= '가짜 외국 기사'; it._body_ko = '가짜 번역 본문.'; it.translated_at ||= '2026-10-06T01:00:00Z'; return ok({ ok: true, status: 'translated' }); }
      if (action === 'fill_now') { const it = server.items.find(i => i.id === 'w1'); Object.assign(it, { state: 'ok', title: '채운 가짜 기사', summary: '채운 가짜 요약.' }); return ok({ ok: true, done: 1, deferred: 0 }); }
      return ok({ ok: false, error: 'UNKNOWN_ACTION' }, 400);
    }
    if (p === '/functions/v1/outside-feed') {
      const action = u.searchParams.get('action');
      server.calls.push({ what: 'outside-edge', action, body });
      if (action === 'catalog') return ok({ ok: true, sources: [{ key: 'kctu', name: '가짜총연맹', group: 'kctu', lang: 'ko' }] });
      if (action === 'read_now') return ok({ ok: true, source: body.source, status: 'ok', inserted: 0 });
      return ok({ ok: false }, 400);
    }
    if (p.startsWith('/rest/v1/app_outside_') && !p.endsWith('app_outside_sources')) return ok([]);
    if (p === '/rest/v1/app_notes') {
      const memoQuery = u.searchParams.get('metadata->>news_item_id');
      const id = (u.searchParams.get('id') || '').replace(/^eq\./, '');
      if (method === 'GET' && memoQuery) {
        server.calls.push({ what: 'memo-read', query: decodeURIComponent(u.search) });
        const ids = /^in\.\((.*)\)$/.exec(memoQuery)?.[1]?.split(',') || [];
        return ok(server.notes.filter(n => ids.includes(n.metadata.news_item_id)));
      }
      // 노트 화면 목록(kind=note)에도 메모 노트를 보인다(serveNotes일 때만, 나머지는 홈 흉내 서버로).
      if (method === 'GET' && server.serveNotes && u.searchParams.get('kind') === 'eq.note') return ok(id ? server.notes.filter(n => n.id === id) : server.notes);
      if (method === 'POST' && body?.metadata?.news_item_id) {
        server.calls.push({ what: 'memo-create', body });
        const row = { id: 'e000000' + server.notes.length + '-0000-4000-8000-0000000000aa', occurred_at: null, created_at: '2026-10-06T01:00:00Z', archived_at: null, ai_export_allowed: true, attachments: [], doc: null, ...body, updated_at: '2026-10-06T01:00:00Z', doc_type: null };
        server.notes.push(row); return ok([row], 201);
      }
      if (method === 'PATCH' && server.notes.some(n => n.id === id)) {
        server.calls.push({ what: 'memo-update', body });
        const row = server.notes.find(n => n.id === id); Object.assign(row, body); return ok([row]);
      }
      return route.fallback();
    }
    if (p === '/rest/v1/app_news_folders') {
      server.calls.push({ what: 'app_news_folders', method, query: decodeURIComponent(u.search), body });
      const id = (u.searchParams.get('id') || '').replace(/^eq\./, '');
      if (method === 'POST') { const row = { id: 'f000000' + server.folders.length + '-0000-4000-8000-000000000001', parent_id: body.parent_id, name: body.name, sort_order: body.sort_order }; server.folders.push(row); return ok([row], 201); }
      if (method === 'PATCH') { const row = server.folders.find(f => f.id === id); Object.assign(row, body); return ok([row]); }
      if (method === 'DELETE') { const f = server.folders.find(x => x.id === id); server.folders = server.folders.filter(x => x.id !== id); for (const x of server.folders) if (x.parent_id === id) x.parent_id = f.parent_id; for (const it of server.items) if (it.folder_id === id) it.folder_id = f.parent_id; return route.fulfill({ status: 204 }); }
      return ok(server.folders);
    }
    if (!p.startsWith('/rest/v1/app_news_') && p !== '/rest/v1/app_outside_sources') return route.fallback();
    server.calls.push({ what: p.slice('/rest/v1/'.length), method, query: decodeURIComponent(u.search), body });
    if (p === '/rest/v1/app_news_items') {
      const id = (u.searchParams.get('id') || '').replace(/^eq\./, '');
      const view = it => { const { _body, _body_ko, ...row } = it; return { ...row, body: _body ?? null, body_ko: _body_ko ?? null }; };
      if (method === 'PATCH') { const row = server.items.find(i => i.id === id); Object.assign(row, body); return ok([{ id: row.id, starred_at: row.starred_at, folder_id: row.folder_id }]); }
      if (id) return ok(server.items.filter(i => i.id === id).map(view));
      const lane = u.searchParams.get('lane'), star = u.searchParams.get('starred_at');
      const rows = server.items.filter(i => (!lane || (lane === 'eq.channel' ? i.lane === 'channel' : i.lane !== 'channel')) && (!star || !!i.starred_at));
      return ok(rows.map(({ _body, _body_ko, ...row }) => row));
    }
    if (p === '/rest/v1/app_news_keywords') {
      const word = (u.searchParams.get('word') || '').replace(/^eq\./, '');
      if (method === 'POST') { const row = { word: body.word, enabled: body.enabled, created_at: '2026-10-06T01:00:00Z' }; server.keywords.push(row); return ok([row], 201); }
      if (method === 'PATCH') { const row = server.keywords.find(k => k.word === word); row.enabled = body.enabled; return ok([row]); }
      if (method === 'DELETE') { server.keywords = server.keywords.filter(k => k.word !== word); return route.fulfill({ status: 204 }); }
      return ok(server.keywords);
    }
    if (p === '/rest/v1/app_outside_sources') {
      const key = (u.searchParams.get('source_key') || '').replace(/^eq\./, '');
      if (method === 'PATCH') { const row = server.sources.get(key); row.enabled = body.enabled; return ok([row]); }
      if (method === 'POST') { const row = { source_key: body.source_key, enabled: body.enabled, last_ok_at: null, last_error: null }; server.sources.set(row.source_key, row); return ok([row], 201); }
      const like = u.searchParams.get('source_key');
      return ok([...server.sources.values()].filter(r => like !== 'like.news-*' || r.source_key.startsWith('news-')));
    }
    return ok([]);
  });
  return server;
}

export async function start(page, width) {
  await page.setViewportSize({ width, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await openHome(page);
  const server = await newsServer(page);
  return { errors, server };
}
export async function openNews(page, width) {
  if (width <= 760) {
    await page.locator('#mobileMenuTab').click();
    await page.locator('#mobileMenu nav button:visible', { hasText: '뉴스 클리핑' }).click();
  } else await page.locator('#appView>.app-nav').getByRole('button', { name: '뉴스 클리핑', exact: true }).click();
  await expect(page.locator('#newsView')).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get('view')).toBe('news');
}
