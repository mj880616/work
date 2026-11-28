// NEWS-클리핑 E2E 공용 흉내 서버(뉴스 클리핑 화면 C1·C2). 기사·매체·주소·폴더·메모는 모두 가짜(example.org).
import { expect } from '@playwright/test';
import { openHome } from './home-entry.mjs';
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const CATALOG = [
  { key: 'news-fake-a', name: '가짜노동신문', region: 'domestic', lang: 'ko' },
  { key: 'news-fake-b', name: '가짜일보', region: 'domestic', lang: 'ko' },
  { key: 'news-fake-en', name: 'Fake Wire', region: 'foreign', lang: 'en' },
];
const LIMITS = { fill: 10, translate: 20, open: 60, keywords: 30 };
// S70-17b: w1(제목 없는 대기 줄)의 주소에는 읽을 만한 경로 조각('가짜 대기 기사')이 있다 — 제목을 끝내 못 얻은 줄은 목록에서 빠지므로(feed-shared-model newsPage).
export const ITEMS = () => [
  { id: 'c1', lane: 'channel', url: 'https://example.org/c1', title: '가짜 채널 기사', lang: 'ko', publisher: '가짜노동신문', source_key: null, keywords: [], published_at: '2026-10-06T00:00:00Z', scrapped_at: '2026-10-06T00:20:00Z', created_at: '2026-10-06T00:21:00Z', state: 'ok', summary: '가짜 채널 기사 한 문장 요약.', body_kind: null, title_ko: null, translated_at: null, starred_at: null, folder_id: null, _body: null },
  { id: 'k1', lane: 'keyword', url: 'https://news.google.com/rss/articles/fake-1', title: '가짜 키워드 기사', lang: 'ko', publisher: '가짜일보', source_key: null, keywords: ['가짜어'], published_at: '2026-10-05T22:00:00Z', scrapped_at: null, created_at: '2026-10-06T00:10:00Z', state: 'ok', summary: '가짜 키워드 요약.', body_kind: null, title_ko: null, translated_at: null, starred_at: null, folder_id: null, _body: null },
  { id: 'e1', lane: 'media', url: 'https://example.org/en1', title: 'A fake foreign story', lang: 'en', publisher: 'Fake Wire', source_key: 'news-fake-en', keywords: [], published_at: '2026-10-05T03:00:00Z', scrapped_at: null, created_at: '2026-10-05T03:10:00Z', state: 'ok', summary: 'One fake line.', body_kind: 'full', title_ko: '가짜 외국 기사', translated_at: '2026-10-05T03:20:00Z', starred_at: null, folder_id: null, _body: 'Fake body paragraph.' },
  { id: 'p1', lane: 'channel', url: 'https://example.org/paid', title: '가짜 유료 기사', lang: 'ko', publisher: '가짜일보', source_key: null, keywords: [], published_at: null, scrapped_at: '2026-10-05T02:00:00Z', created_at: '2026-10-05T02:01:00Z', state: 'paywall', summary: '공개된 가짜 요약.', body_kind: 'lead', title_ko: null, translated_at: null, starred_at: null, folder_id: null, _body: '공개된 가짜 앞부분.' },
  { id: 'w1', lane: 'channel', url: 'https://www.example.org/news/%EA%B0%80%EC%A7%9C-%EB%8C%80%EA%B8%B0-%EA%B8%B0%EC%82%AC', title: null, lang: 'ko', publisher: null, source_key: null, keywords: [], published_at: null, scrapped_at: '2026-10-04T02:00:00Z', created_at: '2026-10-04T02:01:00Z', state: 'pending', summary: null, body_kind: null, title_ko: null, translated_at: null, starred_at: null, folder_id: null, _body: null },
];

// S63-11 서버 찾기 흉내: or=(title.ilike."*낱말*낱말*",…) — 제목·한국어 제목·요약에서 낱말을 순서대로(대소문자 무시).
function likeOk(it, orParam) {
  const pat = /\.ilike\."([^"]*)"/.exec(orParam || '')?.[1];
  if (pat === undefined) return true;
  const re = new RegExp(pat.split('*').filter(Boolean).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*'), 'i');
  return ['title', 'title_ko', 'summary'].some(k => re.test(String(it[k] ?? '')));
}

export async function newsServer(page) {
  const server = { folders: [], notes: [], items: ITEMS(), keywords: [{ word: '가짜어', enabled: true, created_at: '2026-10-01T00:00:00Z' }], sources: new Map([['news-fake-a', { source_key: 'news-fake-a', enabled: true, last_ok_at: '2026-10-06T00:07:00Z', last_error: null }]]), calls: [], fillArmed: false, reads: new Set() };
  await page.route(SB + '/**', async route => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname, method = req.method();
    const ok = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    const body = req.postDataJSON?.() ?? null;
    if (p === '/functions/v1/news-feed') {
      const action = u.searchParams.get('action');
      server.calls.push({ what: 'edge', action, method, auth: req.headers().authorization || '', body });
      if (action === 'catalog') return ok({ ok: true, sources: CATALOG, limits: LIMITS, ai: { month_capped: server.aiCapped === true } });
      if (action === 'open') { const it = server.items.find(i => i.id === body.id); it._body = '가짜 본문 첫 문단.'; it.body_kind = 'full'; return ok({ ok: true, status: 'ok' }); }
      if (action === 'translate') { const it = server.items.find(i => i.id === body.id); if (it._body_ko) return ok({ ok: true, status: 'stored' }); it.title_ko ||= '가짜 외국 기사'; it._body_ko = '가짜 번역 본문.'; it.translated_at ||= '2026-10-06T01:00:00Z'; return ok({ ok: true, status: 'translated' }); }
      if (action === 'fill_now') { if (!server.fillArmed) return ok({ ok: true, done: 0, status: 'nothing' }); const it = server.items.find(i => i.id === 'w1'); Object.assign(it, { state: 'ok', title: '채운 가짜 기사', summary: '채운 가짜 요약.' }); return ok({ ok: true, done: 1, deferred: 0 }); }
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
    // S51-8 읽음 표(app_feed_reads): 넣은 것만 기억, 처음엔 모두 안 읽음.
    if (p === '/rest/v1/app_feed_reads') {
      server.calls.push({ what: 'app_feed_reads', method, query: decodeURIComponent(u.search), body });
      if (method === 'POST') return route.fulfill({ status: 201 }); // 옮기는 동안 같이 써 보는 옛 표 — 읽음은 app_news_reads가 기준
      const col = u.searchParams.has('news_item_id') ? 'news_item_id' : 'outside_post_id';
      const ids = /^in\.\((.*)\)$/.exec(u.searchParams.get(col) || '')?.[1]?.split(',') || [];
      return ok(ids.filter(id => server.reads.has(id)).map(id => ({ [col]: id })));
    }
    // S48-27 Now: 관심 주제·환류 기록은 비어 있음, 관심 후보 묻기는 '아직'(서버 규칙).
    if (p.startsWith('/rest/v1/app_now_')) { server.calls.push({ what: p.slice('/rest/v1/'.length), method, body }); return method === 'POST' ? route.fulfill({ status: 201 }) : ok([]); }
    if (p === '/functions/v1/ai-assist' && body?.kind === 'now_interests') return ok({ ok: true, kind: 'now_interests', ran: false, added: 0 });
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
    // S68-27 READ-보관기록일원화: 보관의 원본 = 내 읽을 거리 줄(app_reading_items). 가짜 기사 한 줄의 starred_at 칸이 '그 기사를 가리키는 읽을 거리 줄의 저장 시각'.
    // 쓰기는 서버 함수 app_reading_keep 하나(뉴스만 — 사회운동 글·직접 저장 줄은 다른 흉내로 넘긴다).
    const savedOf = it => (it.starred_at ? [{ saved_at: it.starred_at }] : []);
    if (p === '/rest/v1/rpc/app_reading_keep' && body?.p_source === 'news') {
      server.calls.push({ what: 'reading_keep', body });
      const it = server.items.find(i => i.id === body.p_article);
      if (!it) return route.fulfill({ status: 400, contentType: 'application/json', body: '{"code":"22023","message":"READINGKEEP_ARTICLE"}' });
      if (body.p_on) { it.starred_at ||= body.p_saved_at || new Date().toISOString(); it._marked = true; return ok({ ok: true, on: true, id: 'r-' + it.id, saved_at: it.starred_at, created: true }); }
      const was = it.starred_at; it.starred_at = null; it.folder_id = null;
      return ok({ ok: true, on: false, removed: was ? 1 : 0, saved_at: was });
    }
    if (p === '/rest/v1/app_reading_items' && method === 'GET' && u.searchParams.has('news_article_id')) {
      server.calls.push({ what: 'app_reading_items', method, query: decodeURIComponent(u.search) });
      const want = u.searchParams.get('news_article_id'), ids = /^in\.\((.*)\)$/.exec(want || '')?.[1]?.split(',');
      const one = /^eq\.(.*)$/.exec(want || '')?.[1];
      const inKeys = /^in\.\((.*)\)$/.exec(u.searchParams.get('app_news_articles.source_key') || '')?.[1]?.split(',');
      const strip = it => { const { _body, _body_ko, _marked, starred_at, folder_id, hidden_at, keywords, ...row } = it; return { ...row, body: _body ?? null, body_ko: _body_ko ?? null }; };
      const rows = server.items.filter(i => i.starred_at && (!ids || ids.includes(i.id)) && (!one || i.id === one) && (!inKeys || inKeys.includes(i.source_key)) && likeOk(i, u.searchParams.get('app_news_articles.or')))
        .sort((a, b) => String(b.starred_at).localeCompare(String(a.starred_at)));
      return ok(rows.map(i => ({ id: 'r-' + i.id, saved_at: i.starred_at, news_article_id: i.id,
        app_news_articles: { ...strip(i), app_news_marks: [{ folder_id: i.folder_id ?? null, hidden_at: i.hidden_at ?? null, keywords: i.keywords || [] }] } })));
    }
    // NEWS-모두에게열기 ③: 지도 함수(옛 id → 공용 id) — 이 가짜 서버의 id는 모두 공용 id라 지도 줄 없음(화면은 같은 id로 읽는다).
    if (p === '/rest/v1/rpc/app_news_article_of' || p === '/rest/v1/rpc/app_outside_article_of') { server.calls.push({ what: 'map', path: p, body }); return ok(server.idMap?.(body) || []); }
    if (!p.startsWith('/rest/v1/app_news_') && p !== '/rest/v1/app_outside_sources') return route.fallback();
    server.calls.push({ what: p.slice('/rest/v1/'.length), method, query: decodeURIComponent(u.search), body });
    // NEWS-모두에게열기 ③: 공용 기사(app_news_articles) + 내 표시(app_news_marks) + 내 읽음(app_news_reads). 가짜 기사 한 줄에 둘 다 들고 있다.
    const MARK = ['starred_at', 'folder_id', 'hidden_at'];
    const marked = it => !!(it._marked || it.starred_at || it.folder_id || it.hidden_at || (it.keywords || []).length);
    const art = it => { const { _body, _body_ko, _marked, starred_at, folder_id, hidden_at, keywords, ...row } = it; return { ...row, body: _body ?? null, body_ko: _body_ko ?? null }; };
    const markOf = it => ({ starred_at: it.starred_at, folder_id: it.folder_id, hidden_at: it.hidden_at ?? null, keywords: it.keywords || [] });
    const inIds = v => /^in\.\((.*)\)$/.exec(v || '')?.[1]?.split(',') || [];
    // S63-11 서버 찾기 흉내: or=(title.ilike."*낱말*낱말*",…) — 제목·한국어 제목·요약에서 낱말을 순서대로(대소문자 무시).
    // (likeOk는 아래 함수 선언 — 위 읽을 거리 흉내도 같이 쓴다)
    if (p === '/rest/v1/app_news_articles') {
      const id = (u.searchParams.get('id') || '').replace(/^eq\./, '');
      const inKeys = /^in\.\((.*)\)$/.exec(u.searchParams.get('source_key') || '')?.[1]?.split(',');
      const rows = server.items.filter(i => (!id || i.id === id) && (!inKeys || inKeys.includes(i.source_key)) && likeOk(i, u.searchParams.get('or')));
      return ok(rows.map(i => ({ ...art(i), app_news_marks: marked(i) ? [markOf(i)] : [], app_reading_items: savedOf(i) })));
    }
    if (p === '/rest/v1/app_news_marks') {
      const aid = (u.searchParams.get('article_id') || '').replace(/^eq\./, '');
      const view = i => ({ article_id: i.id, ...markOf(i), app_news_articles: { ...art(i), app_reading_items: savedOf(i) } });
      if (method === 'PATCH') { const it = server.items.find(i => i.id === aid); if (!it || !marked(it)) return ok([]); Object.assign(it, body); return ok([{ article_id: it.id, ...markOf(it) }]); }
      if (method === 'POST') { const it = server.items.find(i => i.id === body.article_id); Object.assign(it, body, { _marked: true }); delete it.article_id; delete it.workspace_id; return ok([{ article_id: it.id, ...markOf(it) }], 201); }
      const star = u.searchParams.get('starred_at'), hidden = u.searchParams.get('hidden_at');
      const cs = /^cs\.\{"((?:[^"\\]|\\.)*)"\}$/.exec(u.searchParams.get('keywords') || '')?.[1]?.replace(/\\(.)/g, '$1');
      const rows = server.items.filter(i => marked(i) && (!aid || i.id === aid) && (!star || !!i.starred_at) && (hidden !== 'is.null' || !i.hidden_at) && (hidden !== 'not.is.null' || !!i.hidden_at) && (cs === undefined || (i.keywords || []).includes(cs)) && likeOk(i, u.searchParams.get('app_news_articles.or')));
      return ok(rows.map(view));
    }
    if (p === '/rest/v1/app_news_reads') {
      server.calls.push({ what: 'app_news_reads', method, query: decodeURIComponent(u.search), body });
      if (method === 'POST') { server.reads.add(body.article_id); return route.fulfill({ status: 201 }); }
      return ok(inIds(u.searchParams.get('article_id')).filter(id => server.reads.has(id)).map(id => ({ article_id: id })));
    }
    // 옛 표(옮기는 동안 화면이 같은 id로 한 번 더 써 보는 곳)는 기록만 남기고 아무것도 바꾸지 않는다.
    if (p === '/rest/v1/app_news_items') {
      if (method !== 'GET') return ok([]);
      const id = (u.searchParams.get('id') || '').replace(/^eq\./, '');
      const view = it => { const { _body, _body_ko, ...row } = it; return { ...row, body: _body ?? null, body_ko: _body_ko ?? null }; };
      if (method === 'PATCH') { const row = server.items.find(i => i.id === id); Object.assign(row, body); return ok([{ id: row.id, starred_at: row.starred_at, folder_id: row.folder_id }]); }
      if (id) return ok(server.items.filter(i => i.id === id).map(view));
      const lane = u.searchParams.get('lane'), star = u.searchParams.get('starred_at');
      const inKeys = /^in\.\((.*)\)$/.exec(u.searchParams.get('source_key') || '')?.[1]?.split(',');
      // S59-1 키워드 칸: keywords=cs.{"낱말"} → keywords 칸에 그 낱말이 있는 글(새 것부터).
      const cs = /^cs\.\{"((?:[^"\\]|\\.)*)"\}$/.exec(u.searchParams.get('keywords') || '')?.[1]?.replace(/\\(.)/g, '$1');
      const rows = server.items.filter(i => (!lane || (lane === 'eq.channel' ? i.lane === 'channel' : i.lane !== 'channel')) && (!star || !!i.starred_at) && (!inKeys || inKeys.includes(i.source_key)) && (cs === undefined || (i.keywords || []).includes(cs)));
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
      // 읽기 답은 요청 받은 때의 값(옛 값)이고, sourcesHold가 있으면 그 약속이 풀릴 때까지 늦게 준다(느린 읽기 흉내, 한 번만).
      const rows = [...server.sources.values()].filter(r => like !== 'like.news-*' || r.source_key.startsWith('news-')).map(r => ({ ...r }));
      const hold = server.sourcesHold; server.sourcesHold = null;
      if (hold) await hold;
      return ok(rows);
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
// S48-27 → S51-8: 뉴스 클리핑은 News 메뉴의 [언론] 탭(라우터 화면 이름 outside, S51-17 P5부터 메뉴 글자 'News'·주소 ?view=news).
export async function openNews(page, width) {
  if (width <= 760) {
    await page.locator('#mobileMenuTab').click();
    await page.locator('#mobileMenu nav button:visible', { hasText: '읽을 거리' }).click();
  } else await page.locator('#appView>.app-nav').getByRole('link', { name: '읽을 거리', exact: true }).click();
  await expect(page.locator('#outsideView')).toBeVisible();
  await page.locator('#outsideRoot [data-os-tab="media"]').click();
  await expect(page.locator('#nowPanelNews')).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get('view')).toBe('news');
}
