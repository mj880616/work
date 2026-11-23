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
    // 보기(S68-45·S68-55): 옛 형식(v1) 브리핑도 새 배치로 — 한눈에(한 줄 요지) → 약속·계획(주체 불명) → 우리 조직 관련 → 대응할 것 → 원문 인용(접힘).
    // 옛 할 일은 누가 하는지 모르므로 '내 챙길 일'로 옮기지 않고, 위에 '예전 방식 브리핑 · [다시 만들기]'.
    await list.locator('.br-row').nth(2).click();
    const detail = page.locator('#briefView [data-br-detail]');
    await expect(detail).toBeVisible();
    await expect(detail.locator('.br-glance li')).toHaveText(['①' + brief.lead]);
    await expect(detail.locator('.br-sec h3')).toHaveText(['약속·계획(주체 불명) 2', '우리 조직 관련 1', '대응할 것 1', '원문 인용 1']);
    await expect(detail.locator('.br-legacy')).toHaveText('예전 방식 브리핑 · 다시 만들기');
    await expect(detail.locator('[data-br-task]')).toHaveCount(0);
    await expect(detail.locator('.br-who')).toHaveCount(0);
    await expect(detail.locator('.br-sec-quotes')).not.toHaveAttribute('open', '');
    await expect(detail.locator('.br-q')).toBeHidden();
    await detail.locator('.br-sec-quotes > summary').click();
    await expect(detail.locator('.br-meta')).toContainText(/(^|· )(\d{2}\.)?10\.05 브리핑$/);
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

// S68-45(명진 11/23 시안 'ㄱㄱ') + S68-55(명진 11/23 "누가 한 발언인지에 따라서 주체를 적어서"): 새 형식(v3) — 한눈에 '누가 무엇' 3줄,
// 내 챙길 일(기한 꼬리표·급함·주체·[할 일로]), 약속·계획(상대: 주체 · 무엇 · 언제까지, 단추 없음), 조직 꼬리표+주체, 주체+주장→반박, 인용 발언자, 3개 넘으면 '+ n개 더 보기'.
const brief3 = {
  v: 3, lead: '인건비 배점 상향과 정원 지표 신설.',
  glance: [{ subject: '○○부', text: '인건비 배점 5점→8점(31쪽)' }, { subject: '예시 가지부', text: '정원 지표 대상' }, { subject: '우리 조직', text: '11/28까지 의견 제출' }],
  todos: [
    { subject: '우리 조직', due: '', text: '내부 검토 회의', urgent: false },
    { subject: '우리 조직', due: '연내', text: '정원 지표 대응안 마련', urgent: false },
    { subject: '나', due: '일주일 내', text: '의견서 초안', urgent: true },
    { subject: '예시 가지부', due: '종합감사 전', text: '인건비 자료 정리', urgent: false },
    { subject: '나', due: '12/20', text: '설명회 참석', urgent: false },
  ],
  promises: [
    { subject: '○○부', speaker: '○○부 국장', due: '연내', text: '운영기준에 적정 인력 확보 의무 반영' },
    { subject: '주체 불명', speaker: '', due: '', text: '후속 실태 조사' },
  ],
  orgs: [{ name: '예시 가지부', subject: '○○공단', speaker: '', text: '정원 관리 지표 대상 기관(12쪽)' }],
  counters: [{ subject: '○○ 의원', speaker: '○○ 의원', claim: '총인건비 안에서 인력 재배치', reply: '충원 요구 근거 자료(33쪽)' }],
  quotes: [{ text: QUOTE, heading: '3. 평가 지표 개편', why: '배점이 오르면 부담이 커짐', page: 31, speaker: '○○부 국장' }],
};
for (const [label, width, height] of [['phone-390', 390, 844], ['phone-412', 412, 915], ['fold-760', 760, 900], ['pc-1280', 1280, 860]]) test(`브리핑 보기 새 형식: 주체 꼬리표·내 챙길 일(할 일로)·약속·계획(단추 없음)·조직·대응·인용 (${label})`, async ({ page }) => {
  await page.setViewportSize({ width, height });
  await open(page);
  // 나중에 건 route가 먼저 걸린다: 다 된 브리핑(b3)을 새 형식으로 덮는다(화면은 브리핑 룸을 열 때 읽는다).
  await page.route(SB + '/rest/v1/app_document_briefs**', r => r.fulfill({ json: rows().map(x => (x.id === 'b3' ? { ...x, brief: brief3 } : x)) }));
  await page.route(SB + '/rest/v1/app_google_task_links**', r => r.fulfill({ json: [] }));
  await goBrief(page);
  await page.locator('#briefView [data-br-list] .br-row').nth(2).click();
  const detail = page.locator('#briefView [data-br-detail]');
  await expect(detail.locator('.br-glance li')).toHaveText(['①○○부인건비 배점 5점→8점(31쪽)', '②예시 가지부정원 지표 대상', '③우리 조직11/28까지 의견 제출']);
  await expect(detail.locator('.br-glance li .br-who')).toHaveText(['○○부', '예시 가지부', '우리 조직']);
  await expect(detail.locator('.br-legacy')).toHaveCount(0);
  await expect(detail.locator('.br-sec h3')).toHaveText(['내 챙길 일 5', '약속·계획 2', '우리 조직 관련 1', '대응할 것 1', '원문 인용 1']);
  const todos = detail.locator('.br-sec-todos');
  // 급한 것 → 기한 있는 것(서버 순서) → 기한 없는 것. 앞 3개만 보이고 나머지는 '+ 2개 더 보기'.
  await expect(todos.locator(':scope > .br-items > li .br-tx')).toHaveText(['의견서 초안', '정원 지표 대응안 마련', '인건비 자료 정리']);
  await expect(todos.locator(':scope > .br-items > li .br-who')).toHaveText(['나', '우리 조직', '예시 가지부']);
  await expect(todos.locator(':scope > .br-items > li').first().locator('.br-due')).toHaveClass(/is-urgent/);
  await expect(todos.locator(':scope > .br-items > li').nth(1).locator('.br-due')).not.toHaveClass(/is-urgent/);
  const more = todos.locator('.br-more-items');
  await expect(more.locator('summary')).toHaveText('+ 2개 더 보기');
  await expect(more.locator('li').first()).toBeHidden();
  await more.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(more.locator('li .br-tx')).toHaveText(['설명회 참석', '내부 검토 회의']);
  // [할 일로]는 내 챙길 일에만. 약속·계획은 '주체 · 무엇 · 언제까지', 단추 없음.
  await expect(detail.locator('[data-br-task]')).toHaveCount(5);
  await expect(todos.locator('[data-br-task]')).toHaveCount(5);
  const promises = detail.locator('.br-sec-promises');
  await expect(promises.locator('li .br-who')).toHaveText(['○○부 국장', '주체 불명']);
  await expect(promises.locator('li .br-tx')).toHaveText(['운영기준에 적정 인력 확보 의무 반영', '후속 실태 조사']);
  await expect(promises.locator('li').first().locator('.br-when')).toHaveText('· 연내');
  await expect(promises.locator('button')).toHaveCount(0);
  await expect(detail.locator('.br-sec-orgs .br-tag')).toHaveText('예시 가지부');
  await expect(detail.locator('.br-sec-orgs .br-who')).toHaveText('○○공단');
  await expect(detail.locator('.br-sec-counters .br-claim')).toHaveText('○○ 의원 총인건비 안에서 인력 재배치');
  await expect(detail.locator('.br-sec-counters .br-claim .br-who')).toHaveText('○○ 의원');
  await expect(detail.locator('.br-sec-counters .br-reply')).toHaveText('충원 요구 근거 자료(33쪽)');
  // 주체 꼬리표는 조직 꼬리표와 다른 모양(배경 없음·테두리).
  const look = await page.evaluate(() => {
    const st = s => getComputedStyle(document.querySelector(s));
    return { tag: st('#briefView .br-sec-orgs .br-tag').backgroundColor, who: st('#briefView .br-sec-orgs .br-who').backgroundColor, border: st('#briefView .br-sec-orgs .br-who').borderTopStyle };
  });
  expect(look.who).not.toBe(look.tag);
  expect(look.border).toBe('solid');
  // 인용: 기본 접힘, 펼치면 발언자 + 원문 그대로 + 왜, 인용을 누르는 링크는 원문 그 쪽.
  await expect(detail.locator('.br-q')).toBeHidden();
  await detail.locator('.br-sec-quotes > summary').click();
  await expect(detail.locator('.br-pg .br-who')).toHaveText('○○부 국장');
  await expect(detail.locator('.br-qt')).toHaveText(`“${QUOTE}”`);
  await expect(detail.locator('a.br-qt')).toHaveAttribute('href', 'https://drive.google.com/file/d/FILE_cccccccccc/view#page=31');
  await expect(detail.locator('.br-why')).toHaveText('왜: 배점이 오르면 부담이 커짐');
  // 가로 넘침 없음(폰 390/412·폴드·PC).
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `docs/design/screens/s68-55/${label}-brief.png`, fullPage: false });
  // [할 일로]: 기존 Google 할 일 창이 할 일 글로 채워져 열린다(저장은 그 창이 한다).
  await todos.locator('[data-br-task]').first().click();
  await expect(page.locator('#gtTaskModal')).toBeVisible();
  await expect(page.locator('#gtEditTitle')).toHaveValue('의견서 초안');
  await expect(page.locator('#gtEditNotes')).toHaveValue(/기한: 일주일 내/);
});

// S68-55: 옛 방식(v2, 주체 없음) 브리핑 — 할 일은 약속·계획(주체 불명)으로, [다시 만들기]는 [브리핑 받기]와 같은 길(brief-start).
test('브리핑 보기 옛 형식(v2): 약속·계획(주체 불명), [할 일로] 없음, [다시 만들기]로 새 형식 시작 (phone-390)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const calls = await open(page);
  const brief2 = { v: 2, lead: '요지.', glance: ['하나'], todos: [{ due: '연내', text: '운영기준에 적정 인력 확보 의무 반영', urgent: false }], orgs: [], counters: [], quotes: [] };
  await page.route(SB + '/rest/v1/app_document_briefs**', r => r.fulfill({ json: rows().map(x => (x.id === 'b3' ? { ...x, brief: brief2 } : x)) }));
  await goBrief(page);
  await page.locator('#briefView [data-br-list] .br-row').nth(2).click();
  const detail = page.locator('#briefView [data-br-detail]');
  await expect(detail.locator('.br-sec h3')).toHaveText(['약속·계획(주체 불명) 1']);
  await expect(detail.locator('.br-sec-promises .br-tx')).toHaveText('운영기준에 적정 인력 확보 의무 반영');
  await expect(detail.locator('.br-sec-promises .br-when')).toHaveText('· 연내');
  await expect(detail.locator('[data-br-task]')).toHaveCount(0);
  await expect(detail.locator('.br-legacy')).toHaveText('예전 방식 브리핑 · 다시 만들기');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'docs/design/screens/s68-55/phone-390-legacy.png', fullPage: false });
  expect(calls.filter(c => c.action === 'brief-start')).toHaveLength(0);
  await detail.locator('[data-br-remake]').click();
  await expect.poll(() => calls.filter(c => c.action === 'brief-start').map(c => c.document_id)).toEqual([D(3)]);
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
