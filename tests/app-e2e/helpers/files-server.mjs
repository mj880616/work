// FILES-클라우드탐색기 ④ E2E 공용 흉내 서버(파일 화면). 파일·폴더 이름과 id는 모두 가짜.
// 색인 읽기 함수(app_cloud_list·app_cloud_trail·app_cloud_find)와 Edge cloud-files(status·sync·folder·thumb·media·preview·open-url,
// S48-45 쓰기 rename·mkdir·move·trash·across)를 흉내 낸다.
import { expect } from '@playwright/test';
import { openHome } from './home-entry.mjs';
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
// 시계는 2026-10-06 10:00 서울(home-entry.mjs).
const item = o => ({ parent_id: null, is_folder: false, mime: null, size_bytes: 1000, modified_at: '2026-10-01T01:00:00Z', hash: null, trashed: false, starred: false, library_doc_id: null, ...o });
export const ITEMS = () => [
  item({ source: 'od', item_id: 'OD!1', name: '가짜 문서함', is_folder: true, size_bytes: null }),
  item({ source: 'od', item_id: 'OD!2', name: '가짜 사진함', is_folder: true, size_bytes: null }),
  item({ source: 'od', item_id: 'OD!10', parent_id: 'OD!1', name: '가짜 2026', is_folder: true, size_bytes: null }),
  item({ source: 'od', item_id: 'OD!11', parent_id: 'OD!1', name: '가짜 안내문.pdf', mime: 'application/pdf', size_bytes: 1258291, modified_at: '2026-10-05T03:00:00Z' }),
  item({ source: 'od', item_id: 'OD!12', parent_id: 'OD!1', name: '가짜 예산표.xlsx', size_bytes: 63488, modified_at: '2026-10-06T00:12:00Z', starred: true }),
  item({ source: 'od', item_id: 'OD!13', parent_id: 'OD!1', name: '가짜 메모.txt', mime: 'text/plain', size_bytes: 3000, modified_at: '2026-09-20T01:00:00Z' }),
  item({ source: 'od', item_id: 'OD!14', parent_id: 'OD!10', name: '가짜 계획안.hwpx', size_bytes: 188416, modified_at: '2026-10-06T00:05:00Z' }),
  item({ source: 'od', item_id: 'OD!20', parent_id: 'OD!2', name: '가짜 현장.jpg', mime: 'image/jpeg', size_bytes: 3565158, modified_at: '2026-10-04T01:00:00Z' }),
  item({ source: 'gd', item_id: 'gdFolder1', name: '가짜 업무 공간', is_folder: true, size_bytes: null }),
  item({ source: 'gd', item_id: 'gdDoc1', parent_id: 'gdFolder1', name: '가짜 결과 정리.pdf', mime: 'application/pdf', size_bytes: 655360, modified_at: '2026-10-05T05:00:00Z', library_doc_id: 'd0000000-0000-4000-8000-000000000001', _text: '가짜 협약 문구' }),
];
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
// 한 쪽짜리 가짜 PDF(글 'Fake'), xref 위치는 계산해서 맞춘다.
export function fakePdf() {
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const stream = 'BT /F1 24 Tf 40 100 Td (Fake) Tj ET';
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let out = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

export async function filesServer(page, { connected = { od: true, gd: true } } = {}) {
  const server = { items: ITEMS(), calls: [], pendingSync: null, directItems: [] };
  const trail = (source, id) => {
    const out = [];
    let cur = server.items.find(i => i.source === source && i.item_id === id), depth = 0;
    while (cur) { out.push({ item_id: cur.item_id, name: cur.name, depth: depth++ }); cur = server.items.find(i => i.source === source && i.item_id === cur.parent_id); }
    return out;
  };
  const view = i => { const { _text, ...row } = i; return row; };
  const pathOf = i => trail(i.source, i.parent_id).reverse().map(t => t.name).join(' › ');
  await page.route(SB + '/**', async route => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname, method = req.method();
    const ok = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    const body = req.postDataJSON?.() ?? null;
    if (p === '/functions/v1/cloud-files') {
      server.calls.push({ what: 'edge', action: body?.action, body, auth: req.headers().authorization || '', range: req.headers().range || '' });
      const a = body?.action;
      if (a === 'status') return ok({ ok: true, od: { connected: connected.od, scanning: false, synced_at: '2026-10-06T00:59:00Z', index_done_at: '2026-10-01T00:00:00Z', error: null }, gd: { connected: connected.gd, scanning: false, synced_at: '2026-10-06T00:58:00Z', index_done_at: '2026-10-01T00:00:00Z', error: null } });
      if (a === 'sync') { const d = server.pendingSync || { changed: [], removed: [] }; server.pendingSync = null; return ok({ ok: true, od: { fresh: true }, gd: { fresh: true }, reload: false, ...d }); }
      // S48-65 폴더 바로 읽기: 색인에 없는 줄(server.directItems 중 그 폴더 것)을 색인에 합치고 새로 찾은 수를 돌려준다.
      if (a === 'folder') {
        const here = server.directItems.filter(i => i.source === body.source && (i.parent_id ?? null) === (body.id ?? null));
        const fresh = here.filter(i => !server.items.some(x => x.source === i.source && x.item_id === i.item_id));
        server.items.push(...fresh);
        return ok({ ok: true, found: here.length, added: fresh.length, truncated: false, changed: fresh.map(view), reload: false });
      }
      if (a === 'thumb') return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
      if (a === 'preview') return route.fulfill({ status: 200, contentType: 'application/pdf', body: fakePdf() });
      if (a === 'media') {
        const it = server.items.find(i => i.source === body.source && i.item_id === body.id);
        if (it?.mime === 'text/plain') return route.fulfill({ status: 206, contentType: 'text/plain; charset=utf-8', body: '가짜 메모 첫 줄\n둘째 줄' });
        return route.fulfill({ status: 200, contentType: 'application/pdf', body: fakePdf() });
      }
      if (a === 'open-url') return ok({ ok: true, url: 'https://example.org/fake-open' });
      // S48-45 쓰기: confirm:true 없으면 거절(서버와 같음). 결과는 바뀐 줄·지운 줄.
      if (['rename', 'mkdir', 'move', 'trash', 'across'].includes(a)) {
        if (body.confirm !== true) return ok({ ok: false, error: 'confirm_required' }, 400);
        const find = (src, id) => server.items.find(i => i.source === src && i.item_id === id && !i.trashed);
        if (a === 'rename') { const it = find(body.source, body.id); if (server.items.some(i => i !== it && i.source === it.source && i.parent_id === it.parent_id && i.name === body.name)) return ok({ ok: false, error: 'name_taken' }, 409); it.name = body.name; return ok({ ok: true, changed: [view(it)], removed: [] }); }
        if (a === 'mkdir') { const it = item({ source: body.source, item_id: body.source === 'od' ? 'OD!90' : 'gdNew90', parent_id: body.parent ?? null, name: body.name, is_folder: true, size_bytes: null }); server.items.push(it); return ok({ ok: true, changed: [view(it)], removed: [] }); }
        if (a === 'move') { const changed = body.ids.map(id => { const it = find(body.source, id); it.parent_id = body.to ?? null; return view(it); }); return ok({ ok: true, changed, removed: [], failed: [], left: [] }); }
        if (a === 'trash') { for (const id of body.ids) find(body.source, id).trashed = true; return ok({ ok: true, changed: [], removed: body.ids.map(id => ({ source: body.source, id })), failed: [], left: [] }); }
        if (a === 'across') { const it = find(body.source, body.id); it.trashed = true; const copy = item({ ...view(it), source: body.to_source, item_id: body.to_source === 'od' ? 'OD!91' : 'gdNew91', parent_id: body.to ?? null, trashed: false }); server.items.push(copy); return ok({ ok: true, changed: [view(copy)], removed: [{ source: body.source, id: body.id }], kept_original: false }); }
      }
      return ok({ ok: false, error: 'action_invalid' }, 400);
    }
    // S48-45 ⑦ 같은 파일 보기: 색인 표를 해시로 읽는다.
    if (p === '/rest/v1/app_cloud_items' && method === 'GET') {
      server.calls.push({ what: 'app_cloud_items', search: u.search, auth: req.headers().authorization || '' });
      const hash = (u.searchParams.get('hash') || '').replace(/^eq\./, ''), src = (u.searchParams.get('source') || '').replace(/^eq\./, '');
      return ok(server.items.filter(i => i.hash === hash && i.source === src && !i.trashed).map(i => ({ source: i.source, item_id: i.item_id, parent_id: i.parent_id, name: i.name, hash: i.hash, trashed: false })));
    }
    if (!p.startsWith('/rest/v1/rpc/app_cloud_')) return route.fallback();
    const name = p.slice('/rest/v1/rpc/'.length);
    server.calls.push({ what: name, body, auth: req.headers().authorization || '' });
    const live = server.items.filter(i => !i.trashed);
    if (name === 'app_cloud_list') {
      return ok(live.filter(i => i.source === body.p_source && (i.parent_id ?? null) === (body.p_parent_id ?? null))
        .map(i => ({ ...view(i), child_count: i.is_folder ? live.filter(c => c.source === i.source && c.parent_id === i.item_id && !c.is_folder).length : null })));
    }
    if (name === 'app_cloud_trail') return ok(trail(body.p_source, body.p_item_id));
    if (name === 'app_cloud_find') {
      let rows;
      if (body.p_query) {
        const words = body.p_query.split(' ');
        rows = live.filter(i => words.every(w => `${i.name} ${i._text || ''}`.includes(w))).map(i => ({ ...view(i), match_in: words.every(w => i.name.includes(w)) ? 'name' : 'text' }));
      } else if (body.p_shelf === 'starred') rows = live.filter(i => i.starred).map(view);
      else rows = live.filter(i => !i.is_folder).sort((a, b) => body.p_shelf === 'big' ? b.size_bytes - a.size_bytes : b.modified_at.localeCompare(a.modified_at)).map(view);
      return ok(rows.map(r => ({ ...r, match_in: r.match_in ?? null, folder_path: pathOf(r) })));
    }
    return ok([]);
  });
  return server;
}

export async function start(page, width, opts) {
  await page.setViewportSize({ width, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await openHome(page);
  const server = await filesServer(page, opts);
  return { errors, server };
}
export async function openFiles(page, width) {
  if (width <= 760) {
    await page.locator('#mobileMenuTab').click();
    await page.locator('#mobileMenu nav button:visible', { hasText: '파일' }).click();
  } else await page.locator('#appView>.app-nav').getByRole('button', { name: '파일', exact: true }).click();
  await expect(page.locator('#filesView')).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get('view')).toBe('files');
}
