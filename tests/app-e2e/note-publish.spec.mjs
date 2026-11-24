// NOTE-게시 ②(docs/design/note-publish.md): 노트 ⋯ [공유 링크 만들기] → [링크 복사]·[게시 멈춤], 노트 머리 한 줄 '게시 중 · 링크 복사 · 게시 멈춤',
// [목록] '게시 중' 거르기, 잠근 폴더 노트엔 게시 메뉴 없음, 공유 페이지 목록에서 노트 짝 줄 빼기, 로그인 없는 share 화면에 그 노트만.
// 서버(REST 세 표·share-page-read)는 page.route로 흉내 낸다 — 실제 서버 검사는 supabase/functions/share-page-read 시험(#3006). 값은 모두 합성.
import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { answerAsk } from './helpers/small-notice.mjs';
import { testOrigin } from './helpers/test-origin.mjs';

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const ORIGIN = testOrigin;
const TOKEN = 'e'.repeat(64);
const URL_OF = t => 'https://work.bokdoong.com/work/share/?t=' + t;
const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const F1 = U(1), F2 = U(2);

function pubServer() {
  const s = { pairs: [], pages: [], links: [], calls: [], pin: '1234', locked: [F1] };
  const folders = [
    { id: F1, workspace_id: 'w', parent_id: null, name: '비밀', sort_order: 1024, created_at: '2026-10-01T00:00:00Z' },
    { id: F2, workspace_id: 'w', parent_id: null, name: '보통', sort_order: 2048, created_at: '2026-10-01T00:00:00Z' },
  ];
  const doc = { v: 'ed1', doc: { type: 'doc', content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '게시 제목줄' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '굵은 글', marks: [{ type: 'strong' }] }, { type: 'text', text: ' 보통 글' }] },
    { type: 'image', attrs: { src: 'drive:fakefileid', alt: '현장' } },
  ] } };
  const row = (id, title, metadata = {}, extra = {}) => ({ id, workspace_id: 'w', kind: 'note', title, raw_text: title + ' 본문 글', occurred_at: '2026-10-05T01:00:00Z', created_at: '2026-10-05T01:00:00Z', updated_at: '2026-10-05T01:00:00Z', archived_at: null, deleted_at: null, ai_export_allowed: true, attachments: [], metadata, ...extra });
  s.notes = [row('n1', '게시할 노트', { folder_id: F2, folder: '보통' }, { raw_text: '게시 제목줄\n굵은 글 보통 글', doc }), row('n2', '다른 노트', { folder_id: F2, folder: '보통' }), row('n3', '감춘 노트', { folder_id: F1, folder: '비밀' })];
  const json = (route, v, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(v) });
  const eqv = (u, k) => (u.searchParams.get(k) || '').replace(/^eq\./, '');
  s.install = async page => {
    await page.route(u => u.origin === SB && u.pathname.startsWith('/rest/v1/rpc/app_lock_'), async route => {
      const name = new URL(route.request().url()).pathname.split('/').pop(), body = route.request().postDataJSON() || {};
      const covered = [...s.locked];
      if (name === 'app_lock_read') return json(route, { has_pin: true, features: [], relock: '5m', left: 5, blocked_until: null });
      if (name === 'app_lock_note_folders') return json(route, { folders: [...s.locked], covered, top_names: folders.filter(f => s.locked.includes(f.id)).map(f => f.name) });
      if (name === 'app_lock_check') return json(route, body.p_pin === s.pin ? { ok: true, left: 5, blocked_until: null } : { ok: false, left: 4, blocked_until: null });
      return route.fulfill({ status: 404, body: '' });
    });
    await page.route(u => u.origin === SB && ['/rest/v1/app_note_share_pages', '/rest/v1/app_share_pages', '/rest/v1/app_share_page_links'].includes(u.pathname), async route => {
      const req = route.request(), u = new URL(req.url()), m = req.method(), table = u.pathname.split('/').pop(), body = req.postDataJSON?.() ?? null;
      s.calls.push({ table, m, q: u.search, body });
      expect(u.pathname === '/rest/v1/app_share_pages' && m === 'POST' ? true : eqv(u, 'workspace_id') === 'w' || m === 'POST').toBe(true);
      if (table === 'app_note_share_pages') {
        if (m === 'GET') return json(route, s.pairs.map(p => u.searchParams.get('select') === 'page_id' ? { page_id: p.page_id } : { page_id: p.page_id, note_id: p.note_id }));
        if (m === 'POST') {
          expect(Object.keys(body).sort()).toEqual(['note_id', 'page_id', 'workspace_id']);
          if (!s.notes.some(n => n.id === body.note_id && n.kind === 'note') || !s.pages.some(p => p.id === body.page_id)) return json(route, { code: '42501' }, 403);
          s.pairs.push({ page_id: body.page_id, note_id: body.note_id }); return route.fulfill({ status: 201, body: '' });
        }
        if (m === 'DELETE') { s.pairs = s.pairs.filter(p => p.note_id !== eqv(u, 'note_id')); return route.fulfill({ status: 204, body: '' }); }
      }
      if (table === 'app_share_pages') {
        if (m === 'GET') {
          const ids = (u.searchParams.get('id') || '').match(/^in\.\((.*)\)$/)?.[1].split(',');
          const st = u.searchParams.get('status');
          let rows = s.pages.filter(p => !ids || ids.includes(p.id));
          if (st === 'eq.archived') rows = rows.filter(p => p.status === 'archived'); else if (st === 'neq.archived') rows = rows.filter(p => p.status !== 'archived');
          return json(route, rows.map(p => ({ updated_at: '2026-11-24T01:00:00Z', project_id: null, ...p })));
        }
        if (m === 'POST') { expect(body.blocks).toEqual([]); const p = { id: 'pg-' + (s.pages.length + 1), title: body.title, status: body.status, blocks: [] }; s.pages.push(p); return json(route, [{ id: p.id, status: p.status }], 201); }
        if (m === 'PATCH') { const p = s.pages.find(x => x.id === eqv(u, 'id')); Object.assign(p, { status: body.status, ...(body.title ? { title: body.title } : {}) }); return json(route, [{ id: p.id, status: p.status }]); }
      }
      if (table === 'app_share_page_links') {
        const sel = u.searchParams.get('select');
        if (m === 'GET') {
          if (sel === 'token') return json(route, s.links.filter(l => l.id === eqv(u, 'id')).map(l => ({ token: l.token })));
          expect(sel).not.toContain('token'); // 목록은 링크 값 없이
          return json(route, s.links.filter(l => l.page_id === eqv(u, 'page_id')).map(({ token, ...rest }) => rest));
        }
        if (m === 'POST') { const l = { id: 'ln-' + (s.links.length + 1), page_id: body.page_id, token: TOKEN, expires_at: body.expires_at, disabled_at: null, created_at: '2026-11-24T02:00:00Z' }; s.links.push(l); return json(route, [{ token: l.token }], 201); }
      }
      return route.fulfill({ status: 500, body: '' });
    });
  };
  s.installNotes = async page => {
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', r => r.request().method() === 'GET' ? r.fulfill({ json: structuredClone(s.notes) }) : r.fulfill({ status: 500, json: {} }));
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_folders', r => r.request().method() === 'GET' ? r.fulfill({ json: structuredClone(folders) }) : r.fulfill({ status: 500, json: {} }));
    await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  };
  // 로그인 없는 읽기(share-page-read 흉내): 링크 → 게시 중 페이지 → 짝 노트의 지금 제목·글(사진은 자리만).
  s.read = body => {
    const link = s.links.find(l => l.token === body.token && !l.disabled_at), page = link && s.pages.find(p => p.id === link.page_id);
    if (!page || page.status !== 'published') return null;
    const pair = s.pairs.find(p => p.page_id === page.id), note = pair && s.notes.find(n => n.id === pair.note_id);
    if (!note) return null;
    const strip = n => n.type === 'image' ? { type: 'image', attrs: { alt: n.attrs.alt } } : n.content ? { ...n, content: n.content.map(strip) } : n;
    return { ok: true, page: { title: note.title, blocks: [{ type: 'doc', doc: { v: 'ed1', doc: strip(note.doc.doc) } }] } };
  };
  return s;
}
const go = (page, view) => page.evaluate(v => window.KPTURouter.go(v, { source: 'delegated' }), view);
const menu = page => page.locator('#noteDocMenu');
async function openNotes(page, server) {
  if (!server.notesOn) { server.notesOn = true; await server.installNotes(page); }
  await go(page, 'basket');
  await chooseBasketKind(page, 'note');
  await expect(page.locator('[data-nx-count]')).toHaveText('노트 · 3');
  await page.locator('[data-note-view="list"]').click();
  await expect(page.locator('#noteRows [data-note-row]')).toHaveCount(3);
}
async function rowMenu(page, id) {
  await page.locator(`#noteRows [data-note-row-more="${id}"]`).click();
  await expect(menu(page)).toBeVisible();
  return menu(page).locator('button').allTextContents();
}
async function readShare(context, server) {
  const reader = await context.newPage(), heads = [];
  await reader.route(SB + '/**', async route => {
    const req = route.request();
    if (req.url() !== SB + '/functions/v1/share-page-read') return route.abort();
    heads.push(Object.keys(req.headers()));
    const out = server.read(req.postDataJSON() || {});
    return route.fulfill({ status: out ? 200 : 404, contentType: 'application/json', body: JSON.stringify(out || { ok: false }) });
  });
  await reader.goto(ORIGIN + '/share/?t=' + TOKEN);
  return { reader, heads };
}

for (const width of [390, 1280]) test(`노트 게시 → 링크 복사 → 받는 화면에 그 노트만 → '게시 중' 거르기 → 게시 멈춤 → 링크 닫힘 → 다시 게시 (${width})`, async ({ page, context }) => {
  const server = pubServer();
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN });
  await page.setViewportSize({ width, height: 860 });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await openHome(page, { beforeLoad: () => server.install(page) });
  await openNotes(page, server);
  // 게시 전: 거르기 칩 없음, ⋯에 [공유 링크 만들기].
  await expect(page.locator('[data-nt-pub]')).toHaveCount(0);
  let items = await rowMenu(page, 'n1');
  expect(items).toContain('공유 링크 만들기');
  expect(items).not.toContain('링크 복사');
  await menu(page).locator('[data-note-pub-make]').click();
  // 페이지(빈 블록·게시) → 짝 → 링크 한 줄씩, 링크는 복사됨.
  await expect.poll(() => server.links.length).toBe(1);
  expect(server.pages).toEqual([{ id: 'pg-1', title: '게시할 노트', status: 'published', blocks: [] }]);
  expect(server.pairs).toEqual([{ page_id: 'pg-1', note_id: 'n1' }]);
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(URL_OF(TOKEN));
  // 게시 뒤 ⋯: [링크 복사]·[게시 멈춤].
  items = await rowMenu(page, 'n1');
  expect(items).toEqual(expect.arrayContaining(['링크 복사', '게시 멈춤']));
  expect(items).not.toContain('공유 링크 만들기');
  await page.keyboard.press('Escape');
  // [목록] 거르기 '게시 중' → 그 노트만 → 다시 누르면 전체.
  const chip = page.locator('[data-nt-pub]');
  await expect(chip).toHaveText('게시 중1');
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#noteRows [data-note-row]')).toHaveCount(1);
  await expect(page.locator('#noteRows [data-note-row="n1"]')).toBeVisible();
  await chip.click();
  await expect(page.locator('#noteRows [data-note-row]')).toHaveCount(3);
  // 노트 머리 한 줄 '게시 중 · 링크 복사 · 게시 멈춤'.
  await page.evaluate(() => navigator.clipboard.writeText(''));
  await page.locator('#noteRows [data-note-row="n1"]').click();
  const line = page.locator('[data-note-pub-line]');
  await expect(line).toBeVisible();
  await expect(line).toHaveText('게시 중·링크 복사·게시 멈춤');
  const box = await line.boundingBox();
  expect(box.height).toBeLessThanOrEqual(34); // 콤팩트 한 줄
  await line.locator('[data-pub-line="copy"]').click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(URL_OF(TOKEN));
  // 로그인 없는 받는 화면: 그 노트 제목·글만, 노트 편집기와 같은 모양(ed-doc), 사진은 자리 + 안내 한 줄, 로그인 머리 없음.
  const { reader, heads } = await readShare(context, server);
  await expect(reader.locator('h1.sr-title')).toHaveText('게시할 노트');
  const doc = reader.locator('.sr-doc .ed-doc');
  await expect(doc.locator('h2.ed-h1')).toHaveText('게시 제목줄');
  await expect(doc.locator('strong')).toHaveText('굵은 글');
  await expect(doc.locator('figure.ed-photo.is-place')).toHaveAttribute('aria-label', '사진: 현장');
  await expect(reader.locator('.sr-photo-note')).toHaveText('사진은 이 링크에서 보이지 않아요.');
  await expect(reader.locator('#srMain')).not.toContainText('다른 노트');
  await expect(reader.locator('#srMain img')).toHaveCount(0);
  expect(heads.flat()).not.toContain('authorization');
  expect(await reader.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  // 게시 멈춤(확인 한 번) → 머리 줄 사라짐 → 링크를 다시 열면 '열 수 없는 링크'.
  await line.locator('[data-pub-line="stop"]').click();
  expect(await answerAsk(page, true)).toBe('게시를 멈출까요?');
  await expect.poll(() => server.pages[0].status).toBe('draft');
  await expect(line).toBeHidden();
  await reader.reload();
  await expect(reader.locator('.sr-closed h1')).toHaveText('열 수 없는 링크예요');
  await expect(reader.locator('#srMain')).not.toContainText('게시 제목줄');
  // 다시 게시하면 같은 페이지·같은 링크가 살아난다(새 줄을 만들지 않음).
  await page.locator('[data-note-more]').click();
  await menu(page).locator('[data-note-pub-make]').click();
  await expect.poll(() => server.pages[0].status).toBe('published');
  await expect(line).toBeVisible();
  expect([server.pages.length, server.pairs.length, server.links.length]).toEqual([1, 1, 1]);
  await reader.reload();
  await expect(reader.locator('h1.sr-title')).toHaveText('게시할 노트');
  await reader.close();
  expect(errors).toEqual([]);
});

for (const width of [390, 1280]) test(`잠근 폴더의 노트는 PIN으로 풀어도 ⋯에 게시 칸이 없다 (${width})`, async ({ page }) => {
  const server = pubServer();
  await page.setViewportSize({ width, height: 860 });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await openHome(page, { beforeLoad: () => server.install(page) });
  await openNotes(page, server);
  let items;
  await expect(page.locator('#noteRows [data-note-row="n3"] .basket-title-text')).toHaveText('잠김');
  await page.locator('#noteRows [data-note-row="n3"]').click();
  for (const d of '1234') await page.locator(`dialog.lk-here [data-lk-key="${d}"]`).click();
  await expect(page.locator('#noteRows [data-note-row="n3"] .basket-title-text')).toHaveText('감춘 노트');
  items = await rowMenu(page, 'n3');
  expect(items).toContain('수정');
  for (const label of ['공유 링크 만들기', '링크 복사', '게시 멈춤']) expect(items).not.toContain(label);
  await page.keyboard.press('Escape');
  expect(server.calls.filter(c => c.m !== 'GET' && c.q.includes('n3') || c.body?.note_id === 'n3')).toEqual([]);
  expect(errors).toEqual([]);
});

test('공유 페이지 목록에서 노트를 게시한 페이지는 빠진다 (1280)', async ({ page }) => {
  const server = pubServer();
  server.pages = [{ id: 'pg-1', title: '노트 게시 페이지', status: 'published', blocks: [] }, { id: 'pg-2', title: '따로 만든 공유 페이지', status: 'draft', blocks: [] }];
  server.pairs = [{ page_id: 'pg-1', note_id: 'n1' }];
  await page.setViewportSize({ width: 1280, height: 860 });
  await openHome(page, { beforeLoad: () => server.install(page) });
  await go(page, 'pages');
  const list = page.locator('#sharePagesRoot .sp-list-view > .sp-list');
  await expect(list.locator('li')).toHaveCount(1);
  await expect(list).toContainText('따로 만든 공유 페이지');
  await expect(page.locator('#sharePagesRoot')).not.toContainText('노트 게시 페이지');
});
