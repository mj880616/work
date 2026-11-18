import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { expectPickerAtButton } from './helpers/picker-anchor.mjs';

// (fixture: basket-note-add-folder.spec.mjs와 같은 모양, 폴더 이름만 짧은 것·긴 것) NOTE-추가폴더표시 → NOTE-탐색기 (2026-10-28): the note input shows which folder a NEW note goes into as a small [폴더 ▾] button
// ("회의 ▾" / "폴더 없음 ▾"): the entered folder (folder ⋯ [이 폴더로 들어가기]), unless another one is picked on the button, which opens
// the shared folder list (library-move-picker.js). A new note is put there with the folder id and name. PC 1280 and phone 390.
test.use({ hasTouch: true });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function fixture(page, width, made = null) {
  await page.setViewportSize({ width, height: 900 });
  const errors = [], writes = [], failOnce = new Set();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await openHome(page);
  const row = (id, title, updated_at, metadata = {}) => ({ id, workspace_id: 'w', kind: 'note', title, raw_text: title + ' 본문', occurred_at: updated_at, created_at: updated_at, updated_at, archived_at: null, ai_export_allowed: true, attachments: [], metadata });
  const rows = made ? made(row) : [
    row('n1', '가 노트', '2026-10-16T01:00:00Z', { tasks: [{ task_id: 't1' }] }),
    row('n2', '나 노트', '2026-10-12T01:00:00Z'),
    row('n3', '다 노트', '2026-10-10T01:00:00Z'),
  ];
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams;
    const metaOk = (x, key) => !q.has('metadata->>' + key) || (q.get('metadata->>' + key) === 'is.null' ? x.metadata[key] == null : 'eq.' + x.metadata[key] === q.get('metadata->>' + key));
    const pick = x => (!q.get('kind') || 'eq.' + x.kind === q.get('kind')) && (!q.get('id') || 'eq.' + x.id === q.get('id'))
      && (!q.get('updated_at') || 'eq.' + x.updated_at === q.get('updated_at')) && metaOk(x, 'pinned_at') && metaOk(x, 'folder');
    if (req.method() === 'GET') return r.fulfill({ json: rows.filter(pick).slice(Number(q.get('offset') || 0)).map(x => structuredClone(x)) });
    if (req.method() === 'PATCH') {
      const id = (q.get('id') || '').slice(3);
      if (failOnce.has(id)) { failOnce.delete(id); return r.fulfill({ status: 503, json: { message: 'busy' } }); }
      const body = req.postDataJSON(); writes.push({ query: Object.fromEntries(q), body });
      const hit = rows.filter(pick); hit.forEach(x => Object.assign(x, structuredClone(body))); return r.fulfill({ json: hit.map(x => structuredClone(x)) });
    }
    if (req.method() === 'POST') { const body = req.postDataJSON(); writes.push({ method: 'POST', body }); const x = { ...row('n-new', body.title, '2026-10-20T01:00:00Z'), raw_text: body.raw_text }; rows.unshift(x); return r.fulfill({ status: 201, json: [structuredClone(x)] }); }
    return r.fulfill({ status: 500, json: {} });
  });
  const folders = [{ id: U(1), workspace_id: 'w', parent_id: null, name: '가족', sort_order: 1024, created_at: '2026-10-01T00:00:00Z' }, { id: U(2), workspace_id: 'w', parent_id: null, name: '노동조합 교섭 자료함', sort_order: 2048, created_at: '2026-10-01T00:00:00Z' }];
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_folders', r => r.request().method() === 'GET' ? r.fulfill({ json: structuredClone(folders) }) : r.fulfill({ status: 500, json: {} }));
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page,'note');
  // 10/28 17:55: the phone's first screen is the folder list (no note rows), so wait on the count in the head.
  await expect(page.locator('[data-nx-count]')).toHaveText(`노트 · ${rows.length}`);
  return { rows, writes, errors, failOnce };
}



// NOTE-큰창잘림(요청함 10/27 17:21 · 10/28 00:14 덧붙임 ③ '입력칸 옆 버튼 잘림 전수'):
// 노트 입력 줄 [폴더 ▾]는 flex(가운데 맞춤) 버튼이라 버튼 자체의 '…'가 듣지 않아, 긴 이름은 앞뒤가 잘리고 ▾가 사라졌다(폰).
// 이제 '…'는 안쪽 이름 칸이 맡고 ▾는 늘 보인다. 폰 안내 글은 '노트 추가'(폴더는 옆 버튼이 보임)라 한 줄 칸에서 둘째 줄로 잘리지 않는다.
const shot = (page, name) => page.screenshot({ path: `docs/design/screens/s61-30/${name}.png` });
const enter = async (page, id, width) => {
  const tap = l => width < 761 ? l.tap() : l.click();
  await tap(page.locator(`[data-nx-folder-more="${id}"]`).first());
  await tap(page.locator('#noteDocMenu [data-nx-enter]'));
};
// 버튼 안 글자가 버튼 밖으로 나가지 않고, ▾가 버튼 안에 보이는가 + 이름 칸이 '…'로 줄었는가.
const measure = btn => btn.evaluate(b => {
  const box = b.getBoundingClientRect(), name = b.querySelector('.home-quick-folder-name');
  const tail = [...b.childNodes].find(n => n.nodeType === 3);
  const r = document.createRange(); r.selectNodeContents(tail); const t = r.getBoundingClientRect();
  const n = name.getBoundingClientRect();
  return { arrowInside: t.left >= box.left && t.right <= box.right + 0.5 && t.width > 0, nameInside: n.left >= box.left - 0.5,
    nameCut: name.scrollWidth > name.clientWidth + 1, inScreen: box.right <= document.documentElement.clientWidth + 0.5 };
});
for (const width of [360, 412, 1280]) test(`노트 입력 줄 [폴더 ▾]: 긴 이름은 이름만 '…', ▾는 늘 보임 ${width}`, async ({ page }) => {
  const f = await fixture(page, width);
  const btn = page.locator('[data-note-list] [data-quick-folder]'), input = page.locator('[data-note-list] [data-quick-input]');
  await enter(page, U(1), width);
  await expect(btn).toHaveText('가족 ▾');
  expect(await measure(btn)).toEqual({ arrowInside: true, nameInside: true, nameCut: false, inScreen: true });
  await expect(input).toHaveAttribute('placeholder', width < 761 ? '노트 추가' : '가족에 노트 추가');
  // 같은 칸의 [폴더 ▾] 고르기 창에서 긴 이름 폴더를 고른다.
  await (width < 761 ? btn.tap() : btn.click());
  const pick = page.locator('#luMovePicker .lu-move-item', { hasText: '노동조합 교섭 자료함' });
  await (width < 761 ? pick.tap() : pick.click());
  await expect(btn).toHaveText('노동조합 교섭 … ▾');
  const m = await measure(btn);
  expect(m).toEqual({ arrowInside: true, nameInside: true, nameCut: width < 761, inScreen: true });
  await expect(input).toHaveAttribute('placeholder', width < 761 ? '노트 추가' : '노동조합 교섭 자료함에 노트 추가');
  // 입력칸은 폰에서도 글 쓸 자리가 남는다(버튼이 칸을 밀어내지 않음).
  expect((await input.boundingBox()).width).toBeGreaterThan(width < 761 ? 110 : 300);
  if (width !== 360) await shot(page, `note-quick-folder-long-${width}`);
  // 큰 창 제목 줄 [폴더 ▾]는 이름 뒤만 '…'이고 ▾까지 보인다(기존 동작 유지 확인).
  await (width < 761 ? page.locator('[data-note-list] [data-quick-big]').tap() : page.locator('[data-note-list] [data-quick-big]').click());
  const winBtn = page.locator('#edWindow [data-edw-folder]');
  await expect(winBtn).toHaveText('노동조합 교섭 … ▾');
  expect(await winBtn.evaluate(b => b.scrollWidth <= b.clientWidth + 1 && b.getBoundingClientRect().right <= document.documentElement.clientWidth + 0.5)).toBe(true);
  if (width !== 360) await shot(page, `note-window-folder-long-${width}`);
  expect(f.errors).toEqual([]);
});
