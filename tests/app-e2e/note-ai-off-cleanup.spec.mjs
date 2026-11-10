import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';

// NOTE-AI제외정리(11/10 17:41 명진 결정 A): 노트 ⋯에 [AI에 보내지 않기]·[AI 제외 풀기]가 없고, 비밀번호·키 모양 글이 든 노트도
// 목록 제목·앞 줄이 원래 글 그대로 보인다('비밀 메모' 가림 없음). 옛 표시(metadata.ai_off)가 있는 노트도 같다. 가림은 서버가 AI로 보낼 때만.
// 사진: NOTE_AI_OFF_SHOTS 폴더가 있으면 docs/design/screens/s56-26/ 용 사진을 남긴다. 예시 값은 모두 지어낸 가짜 글.
test.use({ hasTouch: true });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const SHOTS = process.env.NOTE_AI_OFF_SHOTS || '';

async function fixture(page, width) {
  await page.setViewportSize({ width, height: 860 });
  const errors = [], writes = [];
  page.on('pageerror', e => errors.push(e.message));
  await openHome(page);
  const row = (id, title, raw_text, updated_at, metadata = {}) => ({ id, workspace_id: 'w', kind: 'note', title, raw_text, occurred_at: updated_at, created_at: updated_at, updated_at, archived_at: null, ai_export_allowed: true, attachments: [], metadata });
  const rows = [
    row('n-wifi', '와이파이 비밀번호: 가짜값-1234', '와이파이 비밀번호: 가짜값-1234\n공유기는 거실 선반', '2026-11-10T08:00:00Z'),
    row('n-old', '서버 접속 메모', '접속 순서 정리\ntoken: 가짜-토큰-값', '2026-11-09T08:00:00Z', { ai_off: true }),
    row('n-plain', '3차 교섭 준비', '요구안 초안 다시 보기', '2026-11-08T08:00:00Z'),
  ];
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams;
    const pick = x => (!q.get('kind') || 'eq.' + x.kind === q.get('kind')) && (!q.get('id') || 'eq.' + x.id === q.get('id'));
    if (req.method() === 'GET') { if (q.get('metadata')) return r.fulfill({ json: [] }); return r.fulfill({ json: rows.filter(pick).slice(Number(q.get('offset') || 0)) }); }
    writes.push({ method: req.method(), query: Object.fromEntries(q), body: req.postData() });
    return r.fulfill({ status: 500, json: {} });
  });
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  await expect(page.locator('[data-note-row]')).toHaveCount(3);
  return { rows, writes, errors };
}

for (const width of [412, 1280]) {
  test(`NOTE-AI제외정리: 비밀 모양 노트도 원래 제목, ⋯ 메뉴에 AI 제외 없음 ${width}`, async ({ page }) => {
    const f = await fixture(page, width);
    const list = page.locator('[data-note-row]');
    await expect(list.filter({ hasText: '와이파이 비밀번호: 가짜값-1234' })).toHaveCount(1);
    await expect(list.filter({ hasText: '서버 접속 메모' })).toHaveCount(1);
    await expect(page.locator('[data-note-row]', { hasText: '비밀 메모' })).toHaveCount(0);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/note-list-${width}.png` });
    const more = page.locator('[data-note-row-more="n-old"]');
    if (width >= 761) await page.locator('[data-note-row="n-old"]').hover();
    await expect(more).toBeVisible();
    if (width < 761) await more.tap(); else await more.click();
    const menu = page.locator('#noteDocMenu');
    await expect(menu).toBeVisible();
    await expect(menu.locator('button')).not.toContainText(['AI에 보내지 않기']);
    await expect(menu.locator('button')).not.toContainText(['AI 제외 풀기']);
    await expect(menu.locator('button').last()).toHaveText('삭제');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/note-menu-${width}.png` });
    await page.keyboard.press('Escape');
    expect(f.writes, '보기만 해서는 아무것도 쓰지 않는다(옛 ai_off 값 보존)').toEqual([]);
    expect(f.errors).toEqual([]);
  });
}
