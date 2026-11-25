// BRIEF-브리핑룸 ③ 화면: 메뉴 '브리핑 룸' → 목록(브리핑 받기 / 만드는 중 n/m / 한 줄 요지 / 글자 없음) → 보기(요지 → 소제목별 요약 → 원문 인용과 쪽, S68-56).
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

async function open(page, { allDocs = false } = {}) {
  const calls = [];
  await openHome(page, {
    beforeLoad: async () => {
      await page.route(SB + '/rest/v1/app_document_briefs**', r => {
        // 자료실은 다 된 것의 한 줄 요지만 읽는다(select=document_id,lead:brief->>lead).
        const u = new URL(r.request().url());
        if (u.searchParams.get('status') === 'eq.done') return r.fulfill({ json: rows().filter(x => x.status === 'done').map(x => ({ document_id: x.document_id, lead: x.brief.lead })) });
        return r.fulfill({ json: rows() });
      });
      await page.route(SB + '/rest/v1/app_library_folders**', r => r.fulfill({ json: r.request().method() === 'GET' ? [{ id: 'f-brief' }] : [] }));
      await page.route(SB + '/rest/v1/app_library_folder_items**', r => r.fulfill({ json: [{ document_id: D(1) }, { document_id: D(2) }] }));
      await page.route(SB + '/rest/v1/app_documents?**', r => {
        const u = new URL(r.request().url());
        if (r.request().method() !== 'GET') return r.fallback();
        return u.searchParams.get('id')?.startsWith('in.') || allDocs ? r.fulfill({ json: docs.map(d => ({ workspace_id: 'w', category: '기타', visibility: 'private', ...d })) }) : r.fallback();
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
    // S68-44(명진 11/23): 다 된 줄 날짜는 진행 칸 수 'n/m'과 헷갈리지 않는 노트 목록 표기('10.05', 다른 해 '26.10.05'), 진행 줄은 '만드는 중 7/12' 그대로.
    await expect(list.locator('.br-row').nth(1).locator('.br-st')).toHaveText('만드는 중 7/12');
    await expect(list.locator('.br-row').nth(2).locator('.br-st')).toHaveText(/^(\d{2}\.)?10\.05$/);
    await expect(list.locator('.br-row').nth(3)).toContainText('글자를 읽을 수 없는 파일이에요');
    await page.screenshot({ path: `docs/design/screens/s61-45/${label}-list.png`, fullPage: false });
    // 보기(S68-56): 옛 형식(v1) 브리핑은 같은 모양으로 — 요지 띠 → 옛 칸 이름 그대로의 소제목 묶음 → 원문 인용(접힘). S70-29: 위 '예전 방식 브리핑 · [다시 만들기]' 띠는 지움 — 없어야 한다.
    await list.locator('.br-row').nth(2).click();
    const detail = page.locator('#briefView [data-br-detail]');
    await expect(detail).toBeVisible();
    await expect(detail.locator('.br-legacy, [data-br-redo]')).toHaveCount(0);
    await expect(detail).not.toContainText('예전 방식 브리핑');
    await expect(detail.locator('.br-gist p')).toHaveText([brief.lead]);
    await expect(detail.locator('.br-sec h3')).toHaveText(['닿는 것 1', '할 일·기한·숫자 2', '부딪히는 대목 1', '원문 인용 1']);
    await expect(detail).not.toContainText('챙길 일');
    await expect(detail.locator('[data-br-task]')).toHaveCount(0);
    await expect(detail.locator('.br-sec-quotes')).not.toHaveAttribute('open', '');
    await expect(detail.locator('.br-q')).toBeHidden();
    await detail.locator('.br-sec-quotes > summary').click();
    await expect(detail.locator('p.br-meta').first()).toContainText(/(^|· )(\d{2}\.)?10\.05 브리핑$/);
    await expect(detail.locator('.br-q')).toContainText(QUOTE);
    await expect(detail.locator('.br-pg a')).toHaveAttribute('href', 'https://drive.google.com/file/d/FILE_cccccccccc/view#page=31');
    if (width > 760) await expect(list).toBeVisible(); else await expect(list).toBeHidden();
    await page.screenshot({ path: `docs/design/screens/s61-45/${label}-brief.png`, fullPage: false });
    // [브리핑 받기]는 누를 때만 서버를 부른다(넣기만 해서는 부르지 않음).
    expect(calls.filter(c => c.action === 'brief-start')).toHaveLength(0);
    // S70-29: 옛 형식 보기에도 [다시 만들기] 띠가 없다 — 보기에서는 brief-start를 부르지 않는다.
    await expect(detail.locator('[data-br-redo]')).toHaveCount(0);
    expect(calls.filter(c => c.action === 'brief-start')).toHaveLength(0);
  });
  // [브리핑 받기]는 목록 줄에서 누를 때만 서버(brief-start)를 부른다.
  test(`브리핑 룸 [브리핑 받기] (${label})`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const calls = await open(page);
    await goBrief(page);
    const list = page.locator('#briefView [data-br-list]');
    expect(calls.filter(c => c.action === 'brief-start')).toHaveLength(0);
    await list.locator('[data-br-start]').click();
    await expect.poll(() => calls.filter(c => c.action === 'brief-start').map(c => c.document_id)).toEqual([D(1)]);
  });
}

// S68-56(명진 11/23 15:06·15:12 "미리 정한 칸에 우겨넣지 말고 걍 요약"): 새 형식(v3) — 요지 띠, AI가 정한 소제목(앞 3개 펼침·나머지 접힘),
// 발언자는 문장 안, 항목 옆 쪽 링크·'우리 관련' 작은 표시, 원문 인용(접힘, 발언자·쪽). [할 일로]·챙길 일·대응할 것 없음.
const brief3 = {
  v: 3, lead: '국토교통부 철도국장이 연내 운영 기준 마련을 약속함.',
  gist: ['국토교통부 철도국장이 연내 운영 기준 마련을 약속함.', '예시 위원은 예산 재검토를 요구함.'],
  sections: [
    { title: '안건 1. 예시 노선 운영 계획', items: [{ text: '국토교통부 철도국장: 연내 운영 기준 마련', page: 12 }, { text: '예시 위원: 예산 재검토 요구', page: null }] },
    { title: '안건 2. 예시 거래처 단가', items: [{ text: '예시 거래처 단가 3% 조정안 보고', page: 31, ours: true }] },
    { title: '안건 3. 인력 운영', items: [{ text: '예시 기관: 인력 재배치 계획 설명', page: 33 }] },
    { title: '기타', items: [{ text: '위원장: 다음 회의 12/3', page: null }] },
  ],
  quotes: [{ text: QUOTE, speaker: '예시 기관', heading: '3. 평가 지표 개편', page: 31 }],
};
for (const [label, width, height] of [['phone-390', 390, 844], ['fold-760', 760, 900], ['pc-1280', 1280, 860]]) test(`브리핑 보기 새 형식: 요지·자유 소제목(앞 3개 펼침)·우리 관련·쪽 링크·인용 접기, 할 일로 없음 (${label})`, async ({ page }) => {
  await page.setViewportSize({ width, height });
  await open(page);
  // 나중에 건 route가 먼저 걸린다: 다 된 브리핑(b3)을 새 형식으로 덮는다(화면은 브리핑 룸을 열 때 읽는다).
  await page.route(SB + '/rest/v1/app_document_briefs**', r => r.fulfill({ json: rows().map(x => (x.id === 'b3' ? { ...x, brief: brief3 } : x)) }));
  await goBrief(page);
  await page.locator('#briefView [data-br-list] .br-row').nth(2).click();
  const detail = page.locator('#briefView [data-br-detail]');
  await expect(detail.locator('.br-gist p')).toHaveText(brief3.gist);
  await expect(detail.locator('.br-legacy')).toHaveCount(0);
  await expect(detail.locator('.br-sec h3')).toHaveText(['안건 1. 예시 노선 운영 계획 2', '안건 2. 예시 거래처 단가 1', '안건 3. 인력 운영 1', '기타 1', '원문 인용 1']);
  const secs = detail.locator('details[data-br-sec=""]');
  for (const i of [0, 1, 2]) await expect(secs.nth(i)).toHaveAttribute('open', '');
  await expect(secs.nth(3)).not.toHaveAttribute('open', '');
  await expect(secs.nth(3).locator('li')).toBeHidden();
  await secs.nth(3).locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(secs.nth(3).locator('li .br-tx')).toHaveText('위원장: 다음 회의 12/3');
  await expect(secs.nth(0).locator('li .br-tx')).toHaveText(['국토교통부 철도국장: 연내 운영 기준 마련', '예시 위원: 예산 재검토 요구']);
  await expect(secs.nth(0).locator('li').first().locator('a.br-ref')).toHaveAttribute('href', 'https://drive.google.com/file/d/FILE_cccccccccc/view#page=12');
  await expect(secs.nth(0).locator('li').nth(1).locator('.br-ref')).toHaveCount(0);
  await expect(detail.locator('.br-ours')).toHaveText(['우리 관련']);
  await expect(secs.nth(1).locator('.br-ours')).toHaveCount(1);
  // 고정 칸·[할 일로] 없음.
  await expect(detail.locator('[data-br-task]')).toHaveCount(0);
  await expect(detail).not.toContainText(/챙길 일|대응할 것|우리 조직 관련/);
  // 인용: 기본 접힘, 펼치면 원문 그대로 + 발언자 · 쪽, 인용 링크는 원문 그 쪽.
  await expect(detail.locator('.br-q')).toBeHidden();
  await detail.locator('.br-sec-quotes > summary').click();
  await expect(detail.locator('.br-qt')).toHaveText(`“${QUOTE}”`);
  await expect(detail.locator('a.br-qt')).toHaveAttribute('href', 'https://drive.google.com/file/d/FILE_cccccccccc/view#page=31');
  await expect(detail.locator('.br-pg')).toHaveText('예시 기관 · 31쪽 · 3. 평가 지표 개편');
  // 가로 넘침 없음(폰·폴드·PC).
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `docs/design/screens/s68-56/${label}-brief.png`, fullPage: false });
});

test('메뉴에 브리핑 룸이 있다(폰 메뉴 창·PC 왼쪽 메뉴)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await open(page);
  await expect(page.locator('.app-nav [data-view="brief"]')).toHaveText('브리핑 룸');
  await page.locator('.app-nav [data-view="brief"]').click();
  await expect(page.locator('#briefView')).toBeVisible();
  await expect(page).toHaveURL(/view=brief/);
});

test('자료실: 다 된 브리핑의 한 줄 요지가 이름 밑에, 자료 ⋯ [브리핑 받기]는 브리핑 룸으로 가서 시작한다', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  const calls = await open(page, { allDocs: true });
  await page.evaluate(() => window.KPTURouter.go('library'));
  await page.waitForFunction(() => window.__KPTU_LIBRARY_UPLOAD_READY__ !== undefined || document.querySelector('#documentList [data-lu-document]'));
  await page.evaluate(() => window.__KPTU_LIBRARY_UPLOAD_READY__);
  await page.locator('#documentList summary', { hasText: '사업영역 없음' }).first().click();
  const done = page.locator(`#documentList [data-lu-document="${D(3)}"]`);
  await expect(done.locator('.lu-row-brief')).toBeVisible();
  await expect(done.locator('.lu-row-brief')).toHaveText(brief.lead);
  await expect(page.locator(`#documentList [data-lu-document="${D(1)}"] .lu-row-brief`)).toHaveCount(0);
  await page.screenshot({ path: 'docs/design/screens/s61-45/pc-1280-library.png', fullPage: false });
  await page.locator(`#documentList [data-lu-document="${D(1)}"]`).hover();
  await page.locator(`#documentList [data-lu-menu="${D(1)}"]`).click();
  await page.locator(`#luMorePanel [data-lu-brief="${D(1)}"]`).click();
  await expect(page.locator('#briefView')).toBeVisible();
  await expect.poll(() => calls.filter(c => c.action === 'brief-start').map(c => c.document_id)).toEqual([D(1)]);
});
