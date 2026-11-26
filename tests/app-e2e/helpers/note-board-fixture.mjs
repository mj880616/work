import { expect } from '@playwright/test';
import { openHome } from './home-entry.mjs';
import { chooseBasketKind } from './basket-kind.mjs';
import { installViewPrefsServer } from './view-prefs-server.mjs';

// 노트 › 보드 시험 공용 서버 흉내(S70-03): 노트 카드 1장 + 선 표 + 상자 표(생각 지도·틀·꾸미기 칸이 모두 있는 서버).
// 상자를 지우면 아래 가지와 붙은 선도 지운다(서버 cascade와 같게). 이름·글은 지어낸 것.
export const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
export const TEXT_DEF = { parent_id: null, ord: 0, side: null, kind: 'topic', color: null, shape: 'round', font: 2, w: null, collapsed: false, h: null, pinned: false,
  z: 0, stroke: null, stroke_w: null, dash: false, alpha: null, bold: false, align: null, ink: null };
export async function boardFixture(page, width, { bid = 'bs70003', seed = [], links = [], open = true, height = null } = {}) {
  await page.setViewportSize({ width, height: height || (width > 600 ? 1000 : 860) });
  const errors = [], linkCalls = [], linkRows = links.map(l => ({ from_x: null, from_y: null, to_x: null, to_y: null, color: null, width: null, from_note: null, to_note: null, from_text: null, to_text: null, from_side: null, to_side: null, shape: 'line', dash: 'solid', ends: 'end', label: null, bend_x: null, bend_y: null, ...l })), textCalls = [], textRows = seed.map(t => ({ ...TEXT_DEF, ...t }));
  page.on('pageerror', e => errors.push(e.message));
  await installViewPrefsServer(page, { note_boards: [{ id: bid, name: '시험 보드' }], note_board: bid });
  await openHome(page);
  const row = (id, title, board) => ({ id, workspace_id: 'w', kind: 'note', title, raw_text: title + '\n본문', occurred_at: '2026-10-10T01:00:00Z', created_at: '2026-10-10T01:00:00Z', updated_at: '2026-10-10T01:00:00Z', archived_at: null, ai_export_allowed: true, attachments: [], metadata: { boards: { [bid]: board } } });
  const rows = [row('n1', '가 노트', { x: 40, y: 640, r: 1, z: 0 })];
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams;
    const pick = x => (!q.get('kind') || 'eq.' + x.kind === q.get('kind')) && (!q.get('id') || 'eq.' + x.id === q.get('id'));
    if (req.method() === 'GET') return r.fulfill({ json: rows.filter(pick).slice(Number(q.get('offset') || 0)).map(x => structuredClone(x)) });
    if (req.method() === 'PATCH') { const body = req.postDataJSON(); const hit = rows.filter(pick); hit.forEach(x => Object.assign(x, structuredClone(body))); return r.fulfill({ json: hit.map(x => structuredClone(x)) }); }
    return r.fulfill({ status: 500, json: {} });
  });
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_folders', r => r.fulfill({ json: [] }));
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  let seq = 0;
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_board_links', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams, method = req.method(), body = method === 'GET' || method === 'DELETE' ? null : req.postDataJSON();
    linkCalls.push({ method, query: Object.fromEntries(q), body });
    if (method === 'GET') return r.fulfill({ json: structuredClone(linkRows) });
    if (method === 'POST') { const saved = { id: `L${++seq}`, from_x: null, from_y: null, to_x: null, to_y: null, color: null, width: null, ...body }; delete saved.workspace_id; linkRows.push(saved); return r.fulfill({ status: 201, json: [structuredClone(saved)] }); }
    if (method === 'PATCH') { const hit = linkRows.find(l => 'eq.' + l.id === q.get('id')); Object.assign(hit, body); return r.fulfill({ json: [structuredClone(hit)] }); }
    if (method === 'DELETE') { const id = q.get('id')?.slice(3); for (let i = linkRows.length - 1; i >= 0; i--) if (linkRows[i].id === id) linkRows.splice(i, 1); return r.fulfill({ json: [] }); }
    return r.fulfill({ status: 500, json: {} });
  });
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_board_texts', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams, method = req.method(), body = method === 'GET' || method === 'DELETE' ? null : req.postDataJSON();
    textCalls.push({ method, query: Object.fromEntries(q), body });
    if (method === 'GET') return r.fulfill({ json: structuredClone(textRows) });
    if (method === 'POST') { const saved = { ...TEXT_DEF, id: `T${++seq}`, ...body }; delete saved.workspace_id; textRows.push(saved); return r.fulfill({ status: 201, json: [structuredClone(saved)] }); }
    if (method === 'PATCH') { const hit = textRows.find(t => 'eq.' + t.id === q.get('id')); Object.assign(hit, body); return r.fulfill({ json: [structuredClone(hit)] }); }
    if (method === 'DELETE') {
      const gone = new Set([q.get('id')?.slice(3)]);
      let grew = true; while (grew) { grew = false; for (const t of textRows) if (t.parent_id && gone.has(t.parent_id) && !gone.has(t.id)) { gone.add(t.id); grew = true; } }
      for (let i = textRows.length - 1; i >= 0; i--) if (gone.has(textRows[i].id)) textRows.splice(i, 1);
      for (let i = linkRows.length - 1; i >= 0; i--) if (gone.has(linkRows[i].from_text) || gone.has(linkRows[i].to_text)) linkRows.splice(i, 1);
      return r.fulfill({ json: [] });
    }
    return r.fulfill({ status: 500, json: {} });
  });
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  if (open) {
    await page.locator('.nv-switch [data-note-view="board"]').click();
    await expect(page.locator('[data-note-board] [data-nb-card]')).toHaveCount(1);
  }
  return { errors, linkCalls, linkRows, textCalls, textRows, rows };
}
export const nbNode = (page, text) => page.locator('[data-nb-texts] [data-nb-text]').filter({ has: page.locator('.nb-tx', { hasText: new RegExp(`^${text}$`) }) });
export const nbEditor = page => page.locator('[data-nb-text-edit]');
export async function nbBox(l) { for (let i = 0; i < 20; i++) { const b = await l.boundingBox({ timeout: 2000 }).catch(() => null); if (b) return b; await new Promise(r => setTimeout(r, 50)); } return null; }
export async function nbCenter(l) { const b = await nbBox(l); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }
// 판 안 빈 곳(카드·상자·도구 줄에서 40px 넘게 떨어진 곳).
export const nbBlank = page => page.locator('[data-nb-scroll]').evaluate(el => {
  const r = el.getBoundingClientRect();
  for (let y = r.bottom - 30; y > r.top + 60; y -= 20) for (let x = r.right - 40; x > r.left + 40; x -= 20) {
    const hit = document.elementFromPoint(x, y);
    if (!hit || !el.contains(hit) || hit.closest('[data-nb-card],[data-nb-text],.nb-tools,[data-nb-hit],.nb-node-bar,.nb-selbar')) continue;
    const near = [...el.querySelectorAll('[data-nb-card],[data-nb-text]')].some(n => { const b = n.getBoundingClientRect(); return x > b.left - 40 && x < b.right + 40 && y > b.top - 40 && y < b.bottom + 40; });
    if (!near) return { x, y };
  }
  return null;
});
