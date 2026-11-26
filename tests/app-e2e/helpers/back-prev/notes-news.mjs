// S71-76 NAV-뒤로가기직전화면: 노트 › 저장한 글·밑줄에서 다른 화면(읽을 거리) 글을 여는 길의 가짜 서버.
// 저장한 글은 화면이 넘칠 만큼(스크롤 자리 확인용) 둔다. 글·매체·이름은 모두 지어낸 것이다. 쓰기 요청은 없어야 한다(s.writes).
import { expect } from '@playwright/test';
import { openHome } from '../home-entry.mjs';
import { chooseBasketKind } from '../basket-kind.mjs';

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const id = (head, n) => `${head}000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const SAVED_COUNT = 30;
export const newsId = n => id('a7', n);
export const hlId = n => id('b7', n);

export async function notesNewsFixture(page, width) {
  await page.setViewportSize({ width, height: width < 761 ? 760 : 820 });
  const s = { writes: [], errors: [] };
  page.on('pageerror', e => s.errors.push(e.message));
  await openHome(page);
  const day = n => `2026-10-${String(1 + (n % 27)).padStart(2, '0')}T00:00:00Z`;
  const news = Array.from({ length: SAVED_COUNT }, (_, i) => ({ id: newsId(i + 1), lane: 'keyword', url: `https://example.org/b${i + 1}`, title: `가상 기사 ${i + 1}번 — 현장 점검 소식`, lang: 'ko', publisher: '가상일보', published_at: day(i), created_at: day(i), summary: null, title_ko: null, starred_at: `2026-11-${String(28 - (i % 27)).padStart(2, '0')}T0${i % 10}:00:00Z`, state: 'ok', body_kind: null }));
  const hl = [1, 2].map(n => ({ id: hlId(n), source_type: 'news', source_id: newsId(n), quote: `가상 기사 ${n}번 밑줄 문장`, quote_prefix: '', quote_suffix: '', memo: null, source_title: news[n - 1].title, source_media: '가상일보', source_date: news[n - 1].published_at, source_url: news[n - 1].url, created_at: `2026-11-0${n}T00:00:00Z`, updated_at: `2026-11-0${n}T00:00:00Z` }));
  const article = a => { const { starred_at, ...rest } = a; return { ...rest, app_news_marks: [{ folder_id: null, hidden_at: null, keywords: [] }], app_reading_items: [{ saved_at: starred_at }] }; };
  await page.route(u => u.origin === SB && u.pathname.startsWith('/rest/v1/'), async r => {
    const req = r.request(), u = new URL(req.url()), table = u.pathname.slice('/rest/v1/'.length), method = req.method(), q = u.searchParams;
    const one = (q.get('id') || '').replace(/^eq\./, '');
    // 글을 열면 읽음 표시(app_news_reads·app_outside_seen)는 쓴다 — 그 밖의 쓰기(저장 풀기·지우기)는 없어야 한다.
    if (method !== 'GET' && method !== 'HEAD' && /^app_(news|outside|reading|now)_/.test(table) && !/^app_(news_reads|outside_seen)$/.test(table)) s.writes.push(`${method} ${table}`);
    if (table === 'app_notes' && method === 'GET') return r.fulfill({ json: [] });
    if (table === 'app_note_folders' && method === 'GET') return r.fulfill({ json: [] });
    if (table === 'app_news_highlights' && method === 'GET') return r.fulfill({ json: structuredClone(hl) });
    if (table === 'app_reading_items' && method === 'GET' && q.get('outside_article_id') === 'not.is.null') return r.fulfill({ json: [] });
    if (table === 'app_reading_items' && method === 'GET' && q.get('news_article_id') === 'not.is.null')
      return r.fulfill({ json: news.map(a => ({ id: 'r-' + a.id, saved_at: a.starred_at, app_news_articles: { ...article(a), app_reading_items: undefined } })) });
    if (table === 'app_news_articles' && method === 'GET') return r.fulfill({ json: (one ? news.filter(a => a.id === one) : news).map(article) });
    if (table === 'app_record_links' || table === 'app_note_comments') return r.fulfill({ json: [] });
    if (table.startsWith('app_now_') || table.startsWith('app_news_') || table.startsWith('app_outside_') || table === 'app_feed_reads' || table === 'app_feed_bodies' || table === 'app_reading_items') return method === 'GET' ? r.fulfill({ json: [] }) : r.fulfill({ status: 201, json: [] });
    return r.fallback();
  });
  await page.route(u => u.origin === SB && u.pathname.startsWith('/functions/v1/') && /outside-feed|news-feed|ai-assist/.test(u.pathname), r => r.fulfill({ json: { ok: true, sources: [], limits: {}, ran: false, added: 0 } }));
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  return s;
}
// 노트 왼쪽 줄(폰 = 폴더 목록 줄, 폴드 펼침·PC = 나무 줄) '밑줄'·'저장한 글'.
export const noteNewsRow = (page, at, width) => page.locator(`${width < 600 ? '#noteRows' : '[data-nx-tree]'} [data-nx-news-item="${at}"] .ft-main`);
export const noteNewsBox = page => page.locator('#basketView [data-nnm]');
