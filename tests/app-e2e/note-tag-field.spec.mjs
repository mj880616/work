import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';

// S67-48 노트 태그 칸(요청함 11/20 21:52 "노트에 태그 설정 가능하게 폴더가 달라도 태그로 모아볼 수 있게 / 태그는 복수설정 가능"):
// 노트 읽기 머리 줄의 칩 + [+ 태그] → 지금까지 쓴 태그(많이 쓴 순)에서 고르거나 새로 써서 여러 개, 칩 ×로 빼기. 원본은 본문 #태그 하나라
// 붙이면 본문 끝 태그 줄에, 빼면 본문 어디서든 지워져 서버(app_notes 저장 길)에 저장된다. [태그] 보기는 폴더와 상관없이 모으고 여러 태그는 '그리고'.
// 잠긴 폴더 노트는 풀기 전 태그 목록·모아 보기에 들어가지 않는다. 폰 412·PC 1440. 이름·글은 지어낸 것.
test.use({ hasTouch: true });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const FA = U(1), FB = U(2), FL = U(3);
// 화면 사진: KPTU_SHOTS=폴더 이면 그 폴더에 남긴다(검토용, 저장소에 넣지 않음).
const shot = (page, name) => process.env.KPTU_SHOTS ? page.screenshot({ path: `${process.env.KPTU_SHOTS}/${name}.png` }) : null;

// NOTE-태그단추키움(2026-11-28 사용자 요청): [+ 태그] 글자는 본문 단추 크기(--ds-text-button), 누르는 높이는 --ds-compact-height 이상. 읽기·수정 같은 부품.
async function expectTagAddBig(add) {
  // 수정 중에는 태그 줄이 잠깐 쉬었다가(paintEditTags 250ms) 다시 그려지므로, 떨어진 단추를 재지 않고 맞을 때까지 다시 잰다.
  await expect.poll(() => add.evaluate(el => {
    if (!el.isConnected) return 'detached';
    const probe = document.createElement('span'); probe.style.cssText = 'position:absolute;visibility:hidden;font-size:var(--ds-text-button)'; document.body.append(probe);
    const token = parseFloat(getComputedStyle(probe).fontSize); probe.remove();
    const font = parseFloat(getComputedStyle(el).fontSize), h = el.getBoundingClientRect().height;
    return font === token && font >= 13 && h >= 32 ? 'ok' : `font ${font}/${token} h ${h}`;
  }), { timeout: 5000 }).toBe('ok');
}
async function fixture(page, width) {
  await page.setViewportSize({ width, height: 900 });
  const errors = [], patches = [];
  page.on('pageerror', e => errors.push(e.message));
  const folders = [
    { id: FA, workspace_id: 'w', parent_id: null, name: '회의', sort_order: 1024, created_at: '2026-10-01T00:00:00Z' },
    { id: FB, workspace_id: 'w', parent_id: null, name: '자료', sort_order: 2048, created_at: '2026-10-01T00:00:00Z' },
    { id: FL, workspace_id: 'w', parent_id: null, name: '비밀', sort_order: 3072, created_at: '2026-10-01T00:00:00Z' },
  ];
  const row = (id, title, raw_text, updated_at, folder) => ({ id, workspace_id: 'w', kind: 'note', title, raw_text, occurred_at: updated_at, created_at: updated_at, updated_at, archived_at: null, ai_export_allowed: true, attachments: [], metadata: { folder_id: folder.id, folder: folder.name } });
  const rows = [
    row('n1', '첫 노트', '오늘 정리한 글', '2026-10-16T01:00:00Z', folders[0]),
    row('n2', '다른 폴더 노트', '본문 중간 #교섭 이야기\n#현장', '2026-10-12T01:00:00Z', folders[1]),
    row('n3', '교섭 둘째', '#교섭 #현장 둘째 글', '2026-10-11T01:00:00Z', folders[1]),
    row('n4', '잠긴 노트', '#교섭 #비밀태그 잠긴 글', '2026-10-10T01:00:00Z', folders[2]),
  ];
  await openHome(page, { beforeLoad: async () => {
    await page.route(u => u.origin === SB && u.pathname.startsWith('/rest/v1/rpc/app_lock_'), route => {
      const name = new URL(route.request().url()).pathname.split('/').pop();
      const json = v => route.fulfill({ contentType: 'application/json', body: JSON.stringify(v) });
      if (name === 'app_lock_read') return json({ has_pin: true, features: [], relock: '5m', left: 5, blocked_until: null });
      if (name === 'app_lock_note_folders') return json({ folders: [FL], covered: [FL], top_names: ['비밀'] });
      return route.fulfill({ status: 404, body: '' });
    });
  } });
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', r => {
    const req = r.request(), q = new URL(req.url()).searchParams;
    const pick = x => (!q.get('kind') || 'eq.' + x.kind === q.get('kind')) && (!q.get('id') || 'eq.' + x.id === q.get('id'));
    if (req.method() === 'GET') return r.fulfill({ json: structuredClone(rows.filter(pick).slice(Number(q.get('offset') || 0))) });
    if (req.method() === 'PATCH') {
      const body = req.postDataJSON(), i = rows.findIndex(pick);
      // 노트 저장 길(saveNoteDoc): 읽은 판(updated_at)이 그대로일 때만 바뀐다.
      if (i < 0 || 'eq.' + rows[i].updated_at !== q.get('updated_at')) return r.fulfill({ json: [] });
      patches.push({ id: rows[i].id, ...body });
      rows[i] = { ...rows[i], ...body };
      return r.fulfill({ json: [structuredClone(rows[i])] });
    }
    return r.fulfill({ status: 500, json: {} });
  });
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_folders', r => r.fulfill({ json: structuredClone(folders) }));
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_comments', r => r.fulfill({ json: [] }));
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  await expect(page.locator('[data-nx-count]')).toHaveText('노트 · 4');
  return { errors, patches, rows };
}
const press = async (page, l, width) => { await expect(l).toBeVisible(); if (width < 761) await l.tap(); else await l.click(); };
const view = (page, name) => page.locator(`.nv-switch [data-note-view="${name}"]`);
const readChips = page => page.locator('[data-note-meta-tags] [data-note-tag]');
const titles = page => page.locator('#noteRows .basket-title-text');

for (const width of [412, 1440]) {
  test(`태그 칸: 칩으로 두 개 붙이기 → 다른 폴더 노트와 [태그] 보기에 모임(그리고) → × 빼기 → 수정 중 붙이기 (${width})`, async ({ page }) => {
    const { errors, patches, rows } = await fixture(page, width);
    await press(page, view(page, 'list'), width);
    // 목록 줄 오른쪽에 그 노트 태그가 작게. 잠긴 노트 줄에는 없다.
    await expect(page.locator('#noteRows [data-nx-note="n2"] [data-nx-tags]')).toHaveText('태그: #교섭 #현장');
    await expect(page.locator('#noteRows [data-nx-note="n4"] [data-nx-tags]')).toHaveCount(0);
    await press(page, page.locator('#noteRows [data-note-row="n1"]'), width);
    await expect(readChips(page)).toHaveCount(0);
    const add = page.locator('[data-note-meta-tags] [data-tag-add]');
    await expect(add).toHaveText('+ 태그');
    await expectTagAddBig(add);
    await press(page, add, width);
    await expect(add).toHaveAttribute('aria-expanded', 'true');
    // 지금까지 쓴 태그: 많이 쓴 순, 잠긴 노트에만 있는 #비밀태그는 없음(잠긴 노트의 #교섭도 세지 않음).
    const items = page.locator('[data-note-tag-pick] [data-tag-pick-item]');
    await expect(items).toHaveText(['#교섭2', '#현장2']);
    await press(page, items.filter({ hasText: '#교섭' }), width);
    await expect(readChips(page)).toHaveText(['#교섭']);
    await expect(items).toHaveText(['#현장2'], { timeout: 5000 });
    // 새 태그는 써서 Enter(앞의 #은 떼고), 고르기 칸은 열린 채로 이어서 고른다.
    const find = page.locator('[data-note-tag-pick] [data-tag-find]');
    await find.fill('#공항철도');
    await shot(page, `pick-${width}`);
    await expect(page.locator('[data-note-tag-pick] [data-tag-new]')).toHaveText('새 태그 #공항철도 추가');
    await find.press('Enter');
    await expect(readChips(page)).toHaveText(['#교섭', '#공항철도']);
    expect(patches.map(p => [p.id, p.raw_text])).toEqual([['n1', '오늘 정리한 글\n\n#교섭'], ['n1', '오늘 정리한 글\n\n#교섭 #공항철도']]);
    expect(patches[1].doc?.v).toBe('ed1');
    // 같은 태그(대소문자·# 무시)를 다시 쓰면 붙이지 않는다.
    await find.fill('교섭');
    await expect(page.locator('[data-note-tag-pick] [data-tag-new]')).toHaveCount(0);
    await page.locator('[data-note-tag-pick] [data-tag-pick-close]').click();
    await expect(page.locator('[data-note-tag-pick]')).toBeHidden();
    await expect(page.locator('[data-basket-read-text]')).toContainText('#교섭 #공항철도');
    // 칩 이름 → [태그] 보기에서 그 태그. 다른 폴더 노트도 함께, 잠긴 노트는 빠진다(줄은 최근에 고친 순 — 시험 시계는 10월 앞).
    await press(page, readChips(page).filter({ hasText: '#교섭' }), width);
    await expect(page.locator('[data-note-detail]')).toBeHidden();
    await expect(page.locator('[data-nt-tag]')).toHaveText(['#교섭3', '#현장2', '#공항철도1']);
    await expect(page.locator('[data-nt-tag="교섭"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(titles(page)).toHaveText(['다른 폴더 노트', '교섭 둘째', '첫 노트']);
    // 두 태그를 함께 켜면 둘 다 붙은 노트만(그리고), [선택 해제]로 모두 끔 → 태그가 있는 노트 전부.
    await press(page, page.locator('[data-nt-tag="현장"]'), width);
    await shot(page, `tagview-${width}`);
    await expect(titles(page)).toHaveText(['다른 폴더 노트', '교섭 둘째']);
    await press(page, page.locator('[data-nt-tag="공항철도"]'), width);
    await expect(page.locator('#noteRows')).toContainText('선택한 태그가 모두 붙은 노트 없음');
    await press(page, page.locator('[data-nt-clear]'), width);
    await expect(page.locator('[data-nt-tag][aria-pressed="true"]')).toHaveCount(0);
    await expect(titles(page)).toHaveText(['다른 폴더 노트', '교섭 둘째', '첫 노트']);
    // 다른 폴더 노트에서 칩 ×로 #교섭 빼기: 본문 중간의 #교섭도 지워지고 #현장은 남는다.
    await press(page, page.locator('#noteRows [data-note-row="n2"]'), width);
    await expect(readChips(page)).toHaveText(['#교섭', '#현장']);
    await press(page, page.locator('[data-note-meta-tags] [data-tag-remove="교섭"]'), width);
    await expect(readChips(page)).toHaveText(['#현장']);
    expect(patches.at(-1)).toMatchObject({ id: 'n2', raw_text: '본문 중간 이야기\n#현장', title: '다른 폴더 노트' });
    // 수정 중에도 같은 칸: 붙이면 편집기 글 끝 태그 줄에 더해지고, [저장]에서 함께 저장된다.
    await press(page, page.locator('[data-note-more]'), width);
    await press(page, page.locator('#noteDocMenu [data-note-edit]'), width);
    const editAdd = page.locator('[data-note-edit-tag-chips] [data-tag-add]');
    await expect(page.locator('[data-note-edit-tag-chips] .note-meta-tag')).toHaveText(['#현장']);
    await expectTagAddBig(editAdd);
    await press(page, editAdd, width);
    await press(page, page.locator('[data-note-edit-tag-pick] [data-tag-pick-item]').filter({ hasText: '#공항철도' }), width);
    await expect(page.locator('[data-note-edit-tag-chips] .note-meta-tag')).toHaveText(['#현장', '#공항철도']);
    await expect(page.locator('[data-note-body-field]')).toContainText('#현장 #공항철도');
    await shot(page, `edit-${width}`);
    const before = patches.length;
    await press(page, page.locator('[data-note-save]'), width);
    await expect(readChips(page)).toHaveText(['#현장', '#공항철도']);
    expect(patches.length).toBe(before + 1);
    expect(patches.at(-1).raw_text).toBe('본문 중간 이야기\n#현장 #공항철도');
    expect(rows.find(r => r.id === 'n4').raw_text).toBe('#교섭 #비밀태그 잠긴 글');
    expect(errors).toEqual([]);
  });
}
