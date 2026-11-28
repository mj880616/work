// BRIEF-품질올리기('더 깊게', 운영자 기능 brief_plus, 설계 docs/design/brief-room.md 6-2절):
// ① 새 칸이 든 브리핑: 요지 띠 아래 '짜임' 한 줄, 항목 옆 근거 위치, '쟁점'(번호·이유 줄)·'문서 안 불일치·확인 필요'(두 값과 위치)는 펼침,
//    '배경 지식 · 확인 필요'는 접힘. 새 칸 줄은 [수정] 메뉴가 없다(고치는 칸이 아님).
// ② 새 칸이 없는 브리핑은 지금 그대로(새 칸 없음).
// ③ 브리핑 룸 ⋯ [쟁점 관점…]은 서버 기능 답에 brief_plus가 있을 때만 → 글 저장 = 서버 화면 기억 view_prefs.brief_lens. 없는 계정은 메뉴 줄 없음.
// 자료 이름·문장은 모두 가짜. 서버는 흉내(표 읽기는 owner RLS REST).
import { test, expect } from '@playwright/test';
import { openHome, OPERATOR_MENU_FEATURES } from './helpers/home-entry.mjs';

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const D = n => `d0000000-0000-4000-8000-00000000000${n}`;
const plusBrief = {
  v: 3, lead: '가상 평가위원회를 새로 두고 시행 시기를 정함.',
  gist: ['가상 평가위원회를 새로 두고 시행 시기를 정함.'],
  sections: [{ title: '평가위원회', items: [{ text: '위원회는 9명 이내 위원으로 구성', page: 2, ours: false, ref: '제3조의2 제2항' }] }],
  quotes: [],
  plus: {
    core: '본문 개정 조문과 부칙 2개 조, 핵심은 제3조의2 평가위원회 설치',
    issues: [{ text: '평가위원회 구성에 추천 주체 규정이 없음', why: '제3조의2는 위원 수만 정함', ref: '제3조의2' }, { text: '인건비 상한이 지침에 맡겨짐', why: '제7조가 범위를 지침에 위임', ref: '제7조' }],
    mismatches: [{ what: '시행일', a: { value: '공포 후 6개월이 경과한 날', ref: '주요 내용 나' }, b: { value: '공포 후 1년이 경과한 날', ref: '부칙 제1조' }, note: '부칙 기준 1년으로 보이나 확인 필요' }],
    background: [{ text: '공공기관 총인건비 제도는 매년 예산 지침으로 인상률 상한을 정함 (확인 필요)' }],
  },
};
const plainBrief = { v: 3, lead: '가상 회의 요지', gist: ['가상 회의 요지'], sections: [{ title: '', items: [{ text: '가상 안건 한 줄', page: null }] }], quotes: [] };
const row = (id, doc, brief) => ({ id, document_id: doc, status: 'done', stage: 'done', step_no: 3, step_total: 3, page_count: 4, brief, edited: null, edited_at: null, error_code: null, created_at: '2026-11-28T00:00:00Z', updated_at: '2026-11-28T00:10:00Z', finished_at: '2026-11-28T00:10:00Z' });

async function open(page, { plus = true } = {}) {
  const docs = [
    { id: D(3), title: '가상 공공기관 운영법 개정안', file_name: '가상 법률안.pdf', mime_type: 'application/pdf', file_id: 'FILE_cccccccccc', created_at: '2026-11-28T00:00:00Z' },
    { id: D(4), title: '가상 회의록', file_name: '가상 회의록.pdf', mime_type: 'application/pdf', file_id: 'FILE_dddddddddd', created_at: '2026-11-27T00:00:00Z' },
  ];
  const home = await openHome(page, {
    features: plus ? [...OPERATOR_MENU_FEATURES, 'brief_plus'] : OPERATOR_MENU_FEATURES,
    beforeLoad: async () => {
      await page.route(SB + '/rest/v1/app_document_briefs**', r => r.fulfill({ json: [row('b3', D(3), plusBrief), row('b4', D(4), plainBrief)] }));
      await page.route(SB + '/rest/v1/app_library_folders**', r => r.fulfill({ json: r.request().method() === 'GET' ? [{ id: 'f-brief' }] : [] }));
      await page.route(SB + '/rest/v1/app_library_folder_items**', r => r.fulfill({ json: r.request().method() === 'GET' ? [{ document_id: D(3) }, { document_id: D(4) }] : [] }));
      await page.route(SB + '/rest/v1/app_documents?**', r => {
        if (r.request().method() !== 'GET') return r.fallback();
        return new URL(r.request().url()).searchParams.get('id')?.startsWith('in.') ? r.fulfill({ json: docs }) : r.fallback();
      });
      await page.route(SB + '/rest/v1/app_news_highlights**', r => r.fulfill({ json: [] }));
    },
  });
  await page.evaluate(() => window.KPTURouter.go('brief'));
  await expect(page.locator('#briefView .br-row')).toHaveCount(2);
  return home;
}
const body = page => page.locator('#briefView [data-br-detail] [data-br-zone]');

test('새 칸이 든 브리핑: 짜임·근거 위치·쟁점·문서 안 불일치(펼침)·배경 지식(접힘), 새 칸 줄은 [수정] 없음', async ({ page }) => {
  await open(page);
  await page.locator('#briefView .br-row', { hasText: '가상 공공기관 운영법' }).click();
  const b = body(page);
  await expect(b.locator('.br-gist .br-core')).toHaveText('짜임 본문 개정 조문과 부칙 2개 조, 핵심은 제3조의2 평가위원회 설치');
  await expect(b.locator('.br-it', { hasText: '위원회는 9명 이내' }).locator('.br-art')).toHaveText('제3조의2 제2항');
  const issues = b.locator('details[data-br-sec="issues"]');
  await expect(issues).toHaveAttribute('open', '');
  await expect(issues.locator('summary h3')).toHaveText('쟁점 2');
  await expect(issues.locator('ol > li')).toHaveCount(2);
  await expect(issues.locator('li').first().locator('.br-why')).toHaveText('제3조의2는 위원 수만 정함');
  const mm = b.locator('details[data-br-sec="mismatches"]');
  await expect(mm).toHaveAttribute('open', '');
  await expect(mm.locator('li .br-tx')).toHaveText('시행일: 공포 후 6개월이 경과한 날(주요 내용 나) ↔ 공포 후 1년이 경과한 날(부칙 제1조)');
  await expect(mm.locator('li .br-why')).toHaveText('부칙 기준 1년으로 보이나 확인 필요');
  const bg = b.locator('details[data-br-sec="background"]');
  await expect(bg).not.toHaveAttribute('open', '');
  await expect(bg.locator('summary h3')).toHaveText('배경 지식 · 확인 필요 1');
  // 새 칸 줄은 고치는 칸이 아니라 우클릭 메뉴에 [수정]이 없다(요약 줄에는 있다).
  await mm.locator('li .br-tx').click({ button: 'right' });
  const menu = page.locator('#rowMenu');
  await expect(menu).toBeVisible();
  await expect(menu.locator('[data-row-item="copy"]')).toBeVisible();
  await expect(menu.locator('[data-row-item="edit"]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await b.locator('.br-it', { hasText: '위원회는 9명 이내' }).locator('.br-tx').click({ button: 'right' });
  await expect(menu.locator('[data-row-item="edit"]')).toBeVisible();
});

test('새 칸이 없는 브리핑은 지금 그대로', async ({ page }) => {
  await open(page);
  await page.locator('#briefView .br-row', { hasText: '가상 회의록' }).click();
  const b = body(page);
  await expect(b).toContainText('가상 안건 한 줄');
  await expect(b.locator('.br-core, .br-art, .br-sec-plus')).toHaveCount(0);
});

test('⋯ [쟁점 관점…]: brief_plus 계정만 → 저장하면 서버 화면 기억 brief_lens, 비우면 지운다', async ({ page }) => {
  const home = await open(page);
  await page.locator('[data-br-top-more]').click();
  await page.locator('#brTopMenu [data-br-top-act="lens"]').click();
  const field = page.locator('.kptu-ask-field');
  await expect(field).toHaveAttribute('maxlength', '200');
  await field.fill('  가상 관점:   비용이 늘어나는 조항 ');
  await page.locator('.kptu-ask-actions .primary').click();
  await expect.poll(() => home.prefs.value?.brief_lens).toBe('가상 관점: 비용이 늘어나는 조항');
  await page.locator('[data-br-top-more]').click();
  await page.locator('#brTopMenu [data-br-top-act="lens"]').click();
  await expect(page.locator('.kptu-ask-field')).toHaveValue('가상 관점: 비용이 늘어나는 조항');
  await page.locator('.kptu-ask-field').fill('');
  await page.locator('.kptu-ask-actions .primary').click();
  await expect.poll(() => home.prefs.value?.brief_lens ?? null).toBe(null);
});

test('brief_plus가 없는 계정은 ⋯에 [쟁점 관점…] 줄이 없다', async ({ page }) => {
  await open(page, { plus: false });
  await page.locator('[data-br-top-more]').click();
  await expect(page.locator('#brTopMenu [data-br-top-act="help"]')).toBeVisible();
  await expect(page.locator('#brTopMenu [data-br-top-act="lens"]')).toHaveCount(0);
});
