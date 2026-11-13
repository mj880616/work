// BRIEF-브리핑룸 ③ 화면: 메뉴 '브리핑 룸' → 목록(브리핑 받기 / 만드는 중 n/m / 한 줄 요지 / 글자 없음) → 보기(한 줄 요지 + 네 칸, 원문 그대로 인용과 쪽).
// 자료 이름·문장은 모두 예시. 서버는 흉내(표 읽기는 owner RLS REST, 시작은 document-actions brief-start).
import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const D = n => `d0000000-0000-4000-8000-00000000000${n}`;
const QUOTE = '인건비 관리의 적정성 지표 배점을 현행 5점에서 8점으로 상향하고, 총인건비 인상률 준수 여부를 감점 요소로 반영한다.';
const docs = [
  { id: D(1), title: '공공기관 인력 운영 계획(예시)', file_name: '예시 계획.pdf', mime_type: 'application/pdf', file_id: 'FILE_aaaaaaaaaa', created_at: '2026-10-06T00:50:00Z' },
  { id: D(2), title: '예시 연구 용역 최종 보고서', file_name: '예시 보고서.hwp', file_id: 'FILE_bbbbbbbbbb', created_at: '2026-10-05T00:00:00Z' },
  { id: D(3), title: '예시 경영평가 편람 개정안', file_name: '예시 편람.pdf', mime_type: 'application/pdf', file_id: 'FILE_cccccccccc', created_at: '2026-10-04T00:00:00Z' },
  { id: D(4), title: '예시 스캔 공문', file_name: '예시 스캔.pdf', mime_type: 'application/pdf', file_id: 'FILE_dddddddddd', created_at: '2026-10-03T00:00:00Z' },
];
const brief = {
  v: 1, lead: '평가 지표 중 인건비 항목 배점이 늘고, 정원 관리 지표가 새로 생김.',
  touches: ['예시 가지부: 정원 관리 지표 대상 기관에 들어감(12쪽).'], todos: ['의견 제출 11/28까지(3쪽).', '인건비 배점 5점 → 8점(31쪽).'],
  conflicts: ['총인건비 안에서 인력을 늘리라는 전제 — 인력 충원 요구와 부딪힘(33쪽).'],
  quotes: [{ text: QUOTE, heading: '3. 평가 지표 개편', why: '배점이 오르면 기관이 교섭에서 더 버팀.', page: 31 }],
};
const rows = () => [
  { id: 'b2', document_id: D(2), status: 'running', stage: 'chunk', step_no: 7, step_total: 12, page_count: 84, brief: null, error_code: null, created_at: '2026-10-06T00:40:00Z', updated_at: '2026-10-06T00:59:50Z', lease_until: '2026-10-06T01:02:00Z' },
  { id: 'b3', document_id: D(3), status: 'done', stage: 'done', step_no: 9, step_total: 9, page_count: 96, brief, error_code: null, created_at: '2026-10-05T00:00:00Z', updated_at: '2026-10-05T00:10:00Z', finished_at: '2026-10-05T00:10:00Z' },
  { id: 'b4', document_id: D(4), status: 'failed', stage: 'read', step_no: 0, step_total: 0, page_count: null, brief: null, error_code: 'no_text', created_at: '2026-10-04T00:00:00Z', updated_at: '2026-10-04T00:00:10Z' },
];

async function open(page) {
  const calls = [];
  await openHome(page, {
    beforeLoad: async () => {
      await page.route(SB + '/rest/v1/app_document_briefs**', r => r.fulfill({ json: rows() }));
      await page.route(SB + '/rest/v1/app_library_folders**', r => r.fulfill({ json: r.request().method() === 'GET' ? [{ id: 'f-brief' }] : [] }));
      await page.route(SB + '/rest/v1/app_library_folder_items**', r => r.fulfill({ json: [{ document_id: D(1) }, { document_id: D(2) }] }));
      await page.route(SB + '/rest/v1/app_documents?**', r => {
        const u = new URL(r.request().url());
        return u.searchParams.get('id')?.startsWith('in.') ? r.fulfill({ json: docs }) : r.fallback();
      });
      await page.route(SB + '/functions/v1/document-actions', r => {
        const body = r.request().postDataJSON();
        calls.push(body);
        return r.fulfill({ json: { ok: true, brief: { id: 'b1', document_id: body.document_id, status: 'queued', stage: 'read', step_no: 0, step_total: 0, created_at: '2026-10-06T01:00:00Z', updated_at: '2026-10-06T01:00:00Z' } } });
      });
    },
  });
  return calls;
}

async function goBrief(page) {
  await page.evaluate(() => window.KPTURouter.go('brief'));
  await expect(page.locator('#briefView')).toBeVisible();
  await expect(page.locator('#briefView .br-row')).toHaveCount(4);
}

for (const [label, width, height] of [['phone-412', 412, 915], ['fold-760', 760, 900], ['pc-1280', 1280, 860]]) {
  test(`브리핑 룸 목록·보기 (${label})`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const calls = await open(page);
    await goBrief(page);
    const list = page.locator('#briefView [data-br-list]');
    await expect(list.locator('.br-row').nth(0)).toContainText('공공기관 인력 운영 계획(예시)');
    await expect(list.locator('.br-row').nth(0).locator('[data-br-start]')).toHaveText('브리핑 받기');
    await expect(list.locator('.br-row').nth(1)).toContainText('만드는 중 7/12');
    await expect(list.locator('.br-row').nth(2)).toContainText('평가 지표 중 인건비 항목 배점이 늘고');
    await expect(list.locator('.br-row').nth(3)).toContainText('글자를 읽을 수 없는 파일이에요');
    await page.screenshot({ path: `docs/design/screens/s61-45/${label}-list.png`, fullPage: false });
    // 보기: 다 된 줄을 누르면 한 줄 요지 + 네 칸, 인용은 원문 그대로와 쪽 링크.
    await list.locator('.br-row').nth(2).click();
    const detail = page.locator('#briefView [data-br-detail]');
    await expect(detail).toBeVisible();
    await expect(detail.locator('.br-lead')).toContainText('한 줄 요지');
    await expect(detail.locator('.br-sec h3')).toHaveText(['내 담당 조직·사업에 닿는 것', '해야 할 일·기한·숫자', '우리 쪽 주장과 부딪히는 대목', '꼭 직접 읽을 대목 원문 그대로']);
    await expect(detail.locator('.br-q')).toContainText(QUOTE);
    await expect(detail.locator('.br-pg a')).toHaveAttribute('href', 'https://drive.google.com/file/d/FILE_cccccccccc/view#page=31');
    if (width > 760) await expect(list).toBeVisible(); else await expect(list).toBeHidden();
    await page.screenshot({ path: `docs/design/screens/s61-45/${label}-brief.png`, fullPage: false });
    // [브리핑 받기]는 누를 때만 서버를 부른다(넣기만 해서는 부르지 않음).
    expect(calls.filter(c => c.action === 'brief-start')).toHaveLength(0);
    if (width <= 760) await detail.locator('[data-br-back]').click();
    await list.locator('[data-br-start]').click();
    await expect.poll(() => calls.filter(c => c.action === 'brief-start').map(c => c.document_id)).toEqual([D(1)]);
  });
}

test('메뉴에 브리핑 룸이 있다(폰 메뉴 창·PC 왼쪽 메뉴)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await open(page);
  await expect(page.locator('.app-nav [data-view="brief"]')).toHaveText('브리핑 룸');
  await page.locator('.app-nav [data-view="brief"]').click();
  await expect(page.locator('#briefView')).toBeVisible();
  await expect(page).toHaveURL(/view=brief/);
});
