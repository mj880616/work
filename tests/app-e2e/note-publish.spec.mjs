// NOTE-게시 ②·③(docs/design/note-publish.md): 노트 ⋯ [공유 링크 만들기] → [링크 복사]·[게시 멈춤], 노트 머리 한 줄 '게시 중 · 링크 복사 · 게시 멈춤',
// [목록] '게시 중' 거르기, 잠근 폴더 노트엔 게시 메뉴 없음, 로그인 없는 share 화면에 그 노트만. ③: 노트 사진이 받는 화면에도 보이고(주인 화면이 짝 페이지
// 사진으로 올림) 게시 멈춤 뒤 그 사진 주소는 404, 다른 노트 사진은 안 보임. 메뉴·메뉴 편집에 '공유 페이지' 없음, 옛 주소 ?view=pages는 노트로.
// REST 세 표·사진 저장소·share-page-read·share-page-media는 page.route로 흉내 낸다(서버 쪽 실제 처리 코드 검사는 tests/security/share-page-read-note.test.mjs·
// tests/note-publish-model.test.mjs — 시험 실행기가 .ts를 불러오지 않게 여기엔 같은 규칙만 짧게 둔다). 값은 모두 합성.
import { test, expect } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { accountButton } from './helpers/shell-navigation.mjs';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { answerAsk } from './helpers/small-notice.mjs';
import { testOrigin } from './helpers/test-origin.mjs';

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const ORIGIN = testOrigin;
const TOKEN = 'e'.repeat(64);
const URL_OF = t => 'https://work.bokdoong.com/work/share/?t=' + t;
const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PG = n => `60000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const F1 = U(1), F2 = U(2);
const N1 = '70000000-0000-4000-8000-000000000001', N2 = '70000000-0000-4000-8000-000000000002', N3 = '70000000-0000-4000-8000-000000000003';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAEElEQVR4nGM4EaABRww4OQAsNg8BoqhHXQAAAABJRU5ErkJggg==', 'base64');
const SIGNED = SB + '/storage/v1/object/sign/share-page-media/';
function pubServer({ photos = false } = {}) {
  const s = { pairs: [], pages: [], links: [], calls: [], pin: '1234', locked: [F1], media: [], files: new Map(), photoGets: [], mediaCalls: [] };
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
  s.notes = [row(N1, '게시할 노트', { folder_id: F2, folder: '보통' }, { raw_text: '게시 제목줄\n굵은 글 보통 글', doc }), row(N2, '다른 노트', { folder_id: F2, folder: '보통' }), row(N3, '감춘 노트', { folder_id: F1, folder: '비밀' })];
  if (photos) {
    // ③: n1·n2 모두 자기 첨부 사진이 글 안에 있다. n1만 게시한다.
    const att = id => [{ drive_file_id: id, file_name: id + '.jpg', mime_type: 'image/jpeg', size_bytes: 1000 }];
    s.notes[0].doc = { v: 'ed1', doc: { type: 'doc', content: [...doc.doc.content.slice(0, 2), { type: 'image', attrs: { src: 'drive:photoOne', alt: '현장' } }, { type: 'file', attrs: { src: 'drive:attachPdf', name: '회의.pdf' } }] } };
    s.notes[0].attachments = [...att('photoOne'), { drive_file_id: 'attachPdf', file_name: '회의.pdf', mime_type: 'application/pdf', size_bytes: 2000 }];
    s.notes[1].doc = { v: 'ed1', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '다른 노트 본문' }] }, { type: 'image', attrs: { src: 'drive:photoTwo', alt: '남의 사진' } }] } };
    s.notes[1].attachments = att('photoTwo');
  }
  const json = (route, v, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(v) });
  const eqv = (u, k) => (u.searchParams.get(k) || '').replace(/^eq\./, '');
  // 사진 저장소(비공개 버킷 흉내)와 share-page-media 흉내: 내 페이지에만 JPEG 올리기(EXIF 구간 거절), 정리 = 저장된 블록에 없는 이 페이지 사진 지우기.
  const used = blocks => new Set(JSON.stringify(blocks || []).match(/share:[0-9a-f-]{36}/g)?.map(x => x.slice(6)) || []);
  const mediaHandler = async req => {
    const type = (req.headers.get('content-type') || '').split(';')[0];
    if (type === 'multipart/form-data') {
      const form = await req.formData(), pageId = String(form.get('page_id')), bytes = Buffer.from(await form.get('image').arrayBuffer());
      if (!s.pages.some(p => p.id === pageId)) return new Response('{"error":"not_found"}', { status: 404 });
      if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.includes(Buffer.from('Exif'))) return new Response('{"error":"bad_image"}', { status: 422 });
      const id = randomUUID(), path = `${pageId}/${id}.jpg`;
      s.files.set(path, bytes); s.media.push({ id, page_id: pageId, storage_path: path });
      return new Response(JSON.stringify({ ok: true, id, src: 'share:' + id }), { status: 200 });
    }
    const body = await req.json();
    if (body.action === 'prune') {
      const keep = used(s.pages.find(p => p.id === body.page_id)?.blocks); for (const k of body.keep || []) keep.add(k);
      const gone = s.media.filter(r => r.page_id === body.page_id && !keep.has(r.id));
      for (const r of gone) s.files.delete(r.storage_path);
      s.media = s.media.filter(r => !gone.includes(r));
      return new Response(JSON.stringify({ ok: true, removed: gone.length, failed: 0 }), { status: 200 });
    }
    if (body.action === 'sign') return new Response(JSON.stringify({ ok: true, urls: {} }), { status: 200 });
    return new Response('{"error":"bad_request"}', { status: 400 });
  };
  s.install = async page => {
    await page.route(u => u.origin === SB && u.pathname === '/functions/v1/basket-files', async route => {
      const u = new URL(route.request().url());
      if (u.searchParams.get('action') !== 'photo') return route.fallback();
      s.photoGets.push(u.searchParams.get('note_id') + ':' + u.searchParams.get('file_id'));
      const ok = s.notes.some(n => n.id === u.searchParams.get('note_id') && n.attachments.some(a => a.drive_file_id === u.searchParams.get('file_id') && /^image\//.test(a.mime_type)));
      return ok ? route.fulfill({ status: 200, contentType: 'image/png', body: PNG }) : route.fulfill({ status: 404, json: {} });
    });
    await page.route(u => u.origin === SB && u.pathname === '/functions/v1/share-page-media', async route => {
      const req = route.request();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, body: '' });
      const headers = { ...req.headers() }; delete headers['content-length'];
      const res = await mediaHandler(new Request(req.url(), { method: req.method(), headers, body: req.postDataBuffer() }));
      const body = await res.text();
      s.mediaCalls.push({ type: (headers['content-type'] || '').split(';')[0], status: res.status, body });
      return route.fulfill({ status: res.status, contentType: 'application/json', body, headers: { 'access-control-allow-origin': '*' } });
    });
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
        if (m === 'POST') { expect(body.blocks).toEqual([]); const p = { id: PG(s.pages.length + 1), title: body.title, status: body.status, blocks: [] }; s.pages.push(p); return json(route, [{ id: p.id, status: p.status }], 201); }
        if (m === 'PATCH') {
          const p = s.pages.find(x => x.id === eqv(u, 'id'));
          Object.assign(p, { ...(body.status ? { status: body.status } : {}), ...(body.title ? { title: body.title } : {}), ...(body.blocks ? { blocks: body.blocks } : {}) });
          return json(route, [{ id: p.id, status: p.status }]);
        }
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
  // 로그인 없는 읽기(share-page-read 흉내): 링크 → 게시 중 페이지 → 짝 노트의 지금 제목·글. 사진은 짝 페이지 거울(지문 sha256("페이지:src") → 사진 id)에 있고
  // 그 페이지 소속 기록이 있는 것만 서명 주소, 그 밖은 자리. 파일 칸은 이름·크기만.
  const keyOf = (pageId, src) => createHash('sha256').update(`${pageId}:${src}`).digest('hex');
  s.readHandler = async req => {
    const { token } = await req.json();
    const link = s.links.find(l => l.token === token && !l.disabled_at), page = link && s.pages.find(p => p.id === link.page_id);
    const notFound = () => new Response('{"error":"not_found"}', { status: 404 });
    if (!page || page.status !== 'published') return notFound();
    const pair = s.pairs.find(p => p.page_id === page.id), note = pair && s.notes.find(n => n.id === pair.note_id && !n.deleted_at && !n.archived_at);
    const mirror = new Map((page.blocks?.[0]?.doc?.doc?.content || []).filter(n => n.attrs?.key).map(n => [n.attrs.key, n.attrs.src.slice(6)]));
    if (!note) return notFound();
    const media = {};
    const strip = n => {
      if (n.type === 'image') {
        const id = mirror.get(keyOf(page.id, n.attrs.src)), row = id && s.media.find(r => r.id === id && r.page_id === page.id);
        if (row) media[id] = SIGNED + row.storage_path + '?token=sig';
        return { type: 'image', attrs: { ...(row ? { src: 'share:' + id } : {}), ...(n.attrs.alt ? { alt: n.attrs.alt } : {}) } };
      }
      if (n.type === 'file') return { type: 'file', attrs: { name: n.attrs.name, ...(n.attrs.size ? { size: n.attrs.size } : {}) } };
      return n.content ? { ...n, content: n.content.map(strip) } : n;
    };
    const blocks = [{ type: 'doc', doc: { v: 'ed1', doc: strip(note.doc.doc) } }];
    return new Response(JSON.stringify({ ok: true, page: { title: note.title, blocks }, ...(Object.keys(media).length ? { media } : {}) }), { status: 200 });
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
  const reader = await context.newPage(), heads = [], answers = [];
  await reader.route(SB + '/**', async route => {
    const req = route.request();
    if (req.url().startsWith(SIGNED)) {
      const bytes = server.files.get(decodeURIComponent(new URL(req.url()).pathname.slice(new URL(SIGNED).pathname.length)));
      return bytes ? route.fulfill({ status: 200, contentType: 'image/jpeg', body: bytes }) : route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' });
    }
    if (req.url() !== SB + '/functions/v1/share-page-read') return route.abort();
    heads.push(Object.keys(req.headers()));
    const res = await server.readHandler(new Request(SB + '/functions/v1/share-page-read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: req.postData() || '' }));
    const body = await res.text();
    answers.push(body);
    return route.fulfill({ status: res.status, contentType: 'application/json', body, headers: { 'access-control-allow-origin': '*' } });
  });
  await reader.goto(ORIGIN + '/share/?t=' + TOKEN);
  return { reader, heads, answers };
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
  let items = await rowMenu(page, N1);
  expect(items).toContain('공유 링크 만들기');
  expect(items).not.toContain('링크 복사');
  await menu(page).locator('[data-note-pub-make]').click();
  // 페이지(빈 블록·게시) → 짝 → 링크 한 줄씩, 링크는 복사됨.
  await expect.poll(() => server.links.length).toBe(1);
  expect(server.pages).toEqual([{ id: PG(1), title: '게시할 노트', status: 'published', blocks: [] }]);
  expect(server.pairs).toEqual([{ page_id: PG(1), note_id: N1 }]);
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(URL_OF(TOKEN));
  // 게시 뒤 ⋯: [링크 복사]·[게시 멈춤].
  items = await rowMenu(page, N1);
  expect(items).toEqual(expect.arrayContaining(['링크 복사', '게시 멈춤']));
  expect(items).not.toContain('공유 링크 만들기');
  await page.keyboard.press('Escape');
  // [목록] 거르기 '게시 중' → 그 노트만 → 다시 누르면 전체.
  const chip = page.locator('[data-nt-pub]');
  await expect(chip).toHaveText('게시 중1');
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#noteRows [data-note-row]')).toHaveCount(1);
  await expect(page.locator(`#noteRows [data-note-row="${N1}"]`)).toBeVisible();
  await chip.click();
  await expect(page.locator('#noteRows [data-note-row]')).toHaveCount(3);
  // 노트 머리 한 줄 '게시 중 · 링크 복사 · 게시 멈춤'.
  await page.evaluate(() => navigator.clipboard.writeText(''));
  await page.locator(`#noteRows [data-note-row="${N1}"]`).click();
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
  await expect(page.locator(`#noteRows [data-note-row="${N3}"] .basket-title-text`)).toHaveText('잠김');
  await page.locator(`#noteRows [data-note-row="${N3}"]`).click();
  for (const d of '1234') await page.locator(`dialog.lk-here [data-lk-key="${d}"]`).click();
  await expect(page.locator(`#noteRows [data-note-row="${N3}"] .basket-title-text`)).toHaveText('감춘 노트');
  items = await rowMenu(page, N3);
  expect(items).toContain('수정');
  for (const label of ['공유 링크 만들기', '링크 복사', '게시 멈춤']) expect(items).not.toContain(label);
  await page.keyboard.press('Escape');
  expect(server.calls.filter(c => c.m !== 'GET' && c.q.includes(N3) || c.body?.note_id === N3)).toEqual([]);
  expect(errors).toEqual([]);
});

const imgOf = reader => reader.locator('#srMain .sr-doc .ed-doc img.ed-photo-img');
for (const width of [390, 1280]) test(`③ 사진 넣은 노트 게시 → 비로그인 받는 화면에 그 사진 → 게시 멈춤 뒤 사진 주소 404, 다른 노트 사진은 안 보임 (${width})`, async ({ page, context }) => {
  const server = pubServer({ photos: true });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN });
  await page.setViewportSize({ width, height: 860 });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await openHome(page, { beforeLoad: () => server.install(page) });
  await openNotes(page, server);
  await rowMenu(page, N1);
  await menu(page).locator('[data-note-pub-make]').click();
  // 주인 화면이 그 노트의 사진(첨부 중 사진만) 한 장을 다시 그린 JPEG로 짝 페이지 사진에 올리고, 짝 페이지에는 지문 → 사진 id 한 줄만.
  await expect.poll(() => server.pages[0]?.blocks?.[0]?.doc?.doc?.content?.length || 0).toBe(1);
  expect(server.media.map(r => r.page_id)).toEqual([PG(1)]);
  expect(server.files.size).toBe(1);
  const [file] = [...server.files.values()];
  expect([file[0], file[1]]).toEqual([0xff, 0xd8]); // JPEG(share-page-media가 위치 정보 구간이 있으면 거절)
  const mirror = JSON.stringify(server.pages[0].blocks);
  expect(mirror).not.toMatch(/photoOne|attachPdf|drive:/);
  expect(server.photoGets.filter(g => g.endsWith(':photoTwo') || g.endsWith(':attachPdf'))).toEqual([]);
  expect(server.mediaCalls.filter(c => c.type === 'multipart/form-data').length).toBe(1);
  // 받는 화면: 그 사진이 보이고(짧은 서명 주소), 첨부 파일은 이름만(번호·링크 없음), 다른 노트 사진은 없다.
  const { reader, answers } = await readShare(context, server);
  await expect(reader.locator('h1.sr-title')).toHaveText('게시할 노트');
  await expect(imgOf(reader)).toHaveCount(1);
  await expect(imgOf(reader)).toHaveAttribute('alt', '현장');
  await expect.poll(() => imgOf(reader).evaluate(img => img.complete && img.naturalWidth)).toBeGreaterThan(0);
  const src = await imgOf(reader).getAttribute('src');
  expect(src.startsWith(SIGNED + PG(1) + '/')).toBe(true);
  await expect(reader.locator('.sr-photo-note')).toHaveCount(0);
  await expect(reader.locator('#srMain .ed-file')).toContainText('회의.pdf');
  await expect(reader.locator('#srMain a[href*="drive.google.com"]')).toHaveCount(0);
  const html = await reader.content();
  for (const word of ['photoOne', 'photoTwo', 'attachPdf', 'drive:', '다른 노트 본문', '남의 사진']) expect(html).not.toContain(word);
  for (const a of answers) for (const word of ['photoOne', 'photoTwo', 'attachPdf']) expect(a).not.toContain(word);
  expect(Object.keys(JSON.parse(answers.at(-1)).media)).toEqual([server.media[0].id]);
  // 게시 멈춤 → 짝 페이지 거울 비움 → 사진 파일·기록 정리 → 받아 둔 사진 주소도 404, 링크는 닫힘.
  await page.locator(`#noteRows [data-note-row="${N1}"]`).click();
  await page.locator('[data-note-pub-line] [data-pub-line="stop"]').click();
  expect(await answerAsk(page, true)).toBe('게시를 멈출까요?');
  await expect.poll(() => server.pages[0].status).toBe('draft');
  await expect.poll(() => server.files.size).toBe(0);
  expect(server.media).toEqual([]);
  expect(server.pages[0].blocks).toEqual([]);
  expect(await reader.evaluate(async u => (await fetch(u)).status, src)).toBe(404);
  await reader.reload();
  await expect(reader.locator('.sr-closed h1')).toHaveText('열 수 없는 링크예요');
  // 다시 게시하면 같은 링크에서 사진도 다시 보인다(새로 올림).
  await page.locator('[data-note-more]').click();
  await menu(page).locator('[data-note-pub-make]').click();
  await expect.poll(() => server.files.size).toBe(1);
  await reader.reload();
  await expect(imgOf(reader)).toHaveCount(1);
  await expect.poll(() => imgOf(reader).evaluate(img => img.complete && img.naturalWidth)).toBeGreaterThan(0);
  expect(server.links.length).toBe(1);
  await reader.close();
  expect(errors).toEqual([]);
});

async function openMenuEdit(page, width) {
  await accountButton(page).click();
  const panel = page.locator(width <= 760 ? '#mobileMenu' : '#sidebarAccountPanel');
  await expect(panel).toBeVisible();
  await panel.locator('[data-menu-edit-open]').click();
  await expect(page.locator('#menuEditModal')).toBeVisible();
}
for (const width of [390, 1280]) test(`③ 메뉴·메뉴 수정에 '공유 페이지'가 없고, 옛 주소 ?view=pages는 노트를 연다 (${width})`, async ({ page }) => {
  const server = pubServer();
  await page.setViewportSize({ width, height: 860 });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  // 저장해 둔 메뉴 순서에 옛 'pages'가 남아 있어도 버린다.
  await openHome(page, { beforeLoad: async () => { await server.install(page); await server.installNotes(page); server.notesOn = true; }, menuLayout: { bar: ['home', 'note', 'calendar'], rest: ['basket', 'pages', 'library', 'files'] } });
  expect(await page.locator('#appView [data-view="pages"], #pagesView, #sharePagesRoot').count()).toBe(0);
  if (width <= 760) {
    await page.locator('#mobileMenuTab').click();
    await expect(page.locator('#mobileMenu')).toBeVisible();
    await expect(page.locator('#mobileMenu')).not.toContainText('공유 페이지');
    await page.keyboard.press('Escape');
  } else {
    await expect(page.locator('#appNav')).toBeVisible();
    await expect(page.locator('#appNav')).not.toContainText('공유 페이지');
  }
  await openMenuEdit(page, width);
  await expect(page.locator('#menuEditModal [data-reorder-id]').first()).toBeVisible();
  await expect(page.locator('#menuEditModal [data-reorder-id="pages"]')).toHaveCount(0);
  await expect(page.locator('#menuEditModal')).not.toContainText('공유 페이지');
  await page.locator('#menuEditModal [data-close="menuEditModal"]').click();
  // [+ 추가] 판에도 없다(PC 위 줄).
  if (width > 760) {
    await page.locator('[data-quick-add]').click();
    await expect(page.locator('#toplineAddMenu')).toBeVisible();
    await expect(page.locator('#toplineAddMenu')).not.toContainText('공유 페이지');
    await page.keyboard.press('Escape');
  }
  // 옛 주소: ?view=pages → 노트(정리함 노트 쪽), 주소도 노트로 고쳐 쓴다.
  await page.goto(ORIGIN + '/app/?view=pages');
  await expect(page.locator('#basketView')).toBeVisible();
  await expect(page.locator('[data-nx-count]')).toHaveText('노트 · 3');
  await expect.poll(() => new URL(page.url()).searchParams.get('view')).toBe('basket');
  expect(new URL(page.url()).searchParams.get('pane')).toBe('note');
  // 앱 안에서 옛 이름으로 불러도(업무일지의 옛 공유 페이지 줄 등) 노트로.
  await go(page, 'home');
  await go(page, 'pages');
  await expect(page.locator('[data-nx-count]')).toHaveText('노트 · 3');
  expect(errors).toEqual([]);
});

// S71-69 SHARE-글공유 ②(사용자 결정 2026-11-26 "노트는 본문을 공유 / 노트가 텍스트만 있지 않은 경우 html 또는 pdf 또는 링크로 공유 묻기"):
// 노트 ⋯ [공유] — 글만 있는 노트(N2)는 바로 '제목 + 본문 글', 머리글·굵게·사진이 있는 노트(N1)는 고르기 [HTML 파일][PDF 파일][링크][글만 보내기].
// 폰 390 = 기기 공유 창(흉내 — 파일도 받음), PC 1280 = 복사·내려받기. [링크]는 한 줄 확인 뒤에만 기존 게시 길로 게시하고 그 주소를 보낸다.
async function fakeShareBox(page) {
  await page.addInitScript(() => {
    window.__copied = []; window.__shared = []; window.__saved = [];
    // 내려받기 이름은 링크의 download 칸으로 본다(시험용 크로미움은 한글 이름을 내려받기 사건에 'download'로 넘긴다).
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { if (this.download) window.__saved.push(this.download); return click.call(this); };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async t => { window.__copied.push(t); }, write: async () => {} } });
    Object.defineProperty(navigator, 'canShare', { configurable: true, writable: true, value: () => true });
    Object.defineProperty(navigator, 'share', { configurable: true, writable: true, value: async d => {
      const files = await Promise.all((d.files || []).map(async f => ({ name: f.name, type: f.type, head: new TextDecoder().decode(new Uint8Array(await f.slice(0, 16).arrayBuffer())) })));
      window.__shared.push({ ...d, files: d.files ? files : undefined });
    } });
  });
}
const shareLog = page => page.evaluate(() => ({ shared: window.__shared, copied: window.__copied }));
const sheet = page => page.locator('#noteShareSheet');
async function startShare(page, width) {
  const server = pubServer();
  await page.setViewportSize({ width, height: 860 });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await fakeShareBox(page);
  await openHome(page, { beforeLoad: () => server.install(page) });
  await openNotes(page, server);
  return { server, errors };
}

for (const width of [390, 1280]) test(`노트 공유 ${width}: 글만 있는 노트는 바로 제목 + 본문 글, [공유] 칸은 목록 줄 ⋯에`, async ({ page }) => {
  const { errors } = await startShare(page, width);
  expect(await rowMenu(page, N2)).toContain('공유');
  await menu(page).locator('[data-note-share]').click();
  await expect(sheet(page)).toBeHidden();
  if (width <= 760) {
    await expect.poll(async () => (await shareLog(page)).shared.length).toBe(1);
    expect((await shareLog(page)).shared[0]).toEqual({ title: '다른 노트', text: '다른 노트\n\n다른 노트 본문 글' });
  } else {
    await expect.poll(async () => (await shareLog(page)).copied.at(-1)).toBe('다른 노트\n\n다른 노트 본문 글');
    expect((await shareLog(page)).shared).toEqual([]);
  }
  expect(errors).toEqual([]);
});

for (const width of [390, 1280]) test(`노트 공유 ${width}: 서식·사진 있는 노트는 고르기 → HTML·PDF 파일 · 글만 보내기`, async ({ page }) => {
  test.setTimeout(90000);
  const { errors } = await startShare(page, width);
  await rowMenu(page, N1);
  await menu(page).locator('[data-note-share]').click();
  await expect(sheet(page)).toBeVisible();
  await expect(sheet(page).locator('[data-note-share]')).toHaveText(['HTML 파일', 'PDF 파일', '링크', '글만 보내기']);
  const pick = async value => { if (!(await sheet(page).isVisible())) { await rowMenu(page, N1); await menu(page).locator('[data-note-share]').click(); } await sheet(page).locator(`[data-note-share="${value}"]`).click(); };
  for (const [kind, head, type] of [['html', '<!doctype html>', 'text/html'], ['pdf', '%PDF-1.4', 'application/pdf']]) {
    if (width <= 760) {
      const before = (await shareLog(page)).shared.length;
      await pick(kind);
      await expect.poll(async () => (await shareLog(page)).shared.length, { timeout: 20000 }).toBe(before + 1);
      const f = (await shareLog(page)).shared.at(-1).files[0];
      expect(f.name).toMatch(new RegExp(`^게시할 노트 \\d{4}-\\d{2}-\\d{2}\\.${kind}$`));
      expect(f.type).toBe(type);
      expect(f.head.startsWith(head)).toBe(true);
    } else {
      const dl = page.waitForEvent('download', { timeout: 20000 });
      await pick(kind);
      const d = await dl;
      expect(await page.evaluate(() => window.__saved.at(-1))).toMatch(new RegExp(`^게시할 노트 \\d{4}-\\d{2}-\\d{2}\\.${kind}$`));
      const bytes = (await import('node:fs')).readFileSync(await d.path());
      expect(bytes.subarray(0, head.length).toString('latin1')).toBe(head);
      if (kind === 'html') { expect(bytes.toString('utf8')).toContain('게시 제목줄'); expect(bytes.toString('utf8')).toContain('굵은 글'); }
    }
  }
  await pick('text');
  if (width <= 760) await expect.poll(async () => (await shareLog(page)).shared.at(-1)?.text).toBe('게시할 노트\n\n게시 제목줄\n\n굵은 글 보통 글\n\n[사진: 현장]');
  else await expect.poll(async () => (await shareLog(page)).copied.at(-1)).toBe('게시할 노트\n\n게시 제목줄\n\n굵은 글 보통 글\n\n[사진: 현장]');
  expect(errors).toEqual([]);
});

for (const width of [390, 1280]) test(`노트 공유 ${width}: [링크]는 확인 뒤에만 게시하고 게시 주소를 보낸다(취소하면 게시 없음)`, async ({ page }) => {
  const { server, errors } = await startShare(page, width);
  await rowMenu(page, N1);
  await menu(page).locator('[data-note-share]').click();
  await sheet(page).locator('[data-note-share="link"]').click();
  expect(await answerAsk(page, false)).toBe('링크로 공유할까요?');
  expect(server.pages.length).toBe(0);
  await rowMenu(page, N1);
  await menu(page).locator('[data-note-share]').click();
  await sheet(page).locator('[data-note-share="link"]').click();
  expect(await answerAsk(page, true)).toBe('링크로 공유할까요?');
  await expect.poll(() => server.links.length).toBe(1);
  expect(server.pages[0].status).toBe('published');
  expect(server.pairs).toEqual([{ page_id: server.pages[0].id, note_id: N1 }]);
  if (width <= 760) {
    await expect.poll(async () => (await shareLog(page)).shared.length).toBe(1);
    expect((await shareLog(page)).shared[0]).toEqual({ title: '게시할 노트', text: '게시할 노트', url: URL_OF(TOKEN) });
  } else await expect.poll(async () => (await shareLog(page)).copied.at(-1)).toBe('게시할 노트\n' + URL_OF(TOKEN));
  // 이미 게시 중이면 묻지 않고 같은 주소.
  await rowMenu(page, N1);
  await menu(page).locator('[data-note-share]').click();
  await sheet(page).locator('[data-note-share="link"]').click();
  await expect(page.locator('.kptu-ask')).toHaveCount(0);
  if (width <= 760) await expect.poll(async () => (await shareLog(page)).shared.length).toBe(2);
  else await expect.poll(async () => (await shareLog(page)).copied.length).toBe(2);
  expect(server.pages.length).toBe(1);
  expect(errors).toEqual([]);
});

test('노트 공유 [링크]: 서버가 내 노트가 아니라고 거절하면(짝 표 403) 공유하지 않고 알림, 만든 빈 페이지는 거둔다', async ({ page }) => {
  const { server, errors } = await startShare(page, 390);
  // 목록을 읽은 뒤 서버 쪽에서 그 노트가 내 작업공간에 없게(다른 사람 노트 id를 보낸 것과 같은 거절).
  server.notes = server.notes.filter(n => n.id !== N1);
  await rowMenu(page, N1);
  await menu(page).locator('[data-note-share]').click();
  await sheet(page).locator('[data-note-share="link"]').click();
  await answerAsk(page, true);
  await expect.poll(() => server.calls.some(c => c.table === 'app_share_pages' && c.m === 'DELETE')).toBe(true);
  await expect(page.locator('#kptuNotice .kptu-notice-text')).toHaveText('링크를 만들지 못했어요. 다시 시도해 주세요.');
  expect((await shareLog(page)).shared).toEqual([]);
  expect(server.links.length).toBe(0);
  expect(errors).toEqual([]);
});
