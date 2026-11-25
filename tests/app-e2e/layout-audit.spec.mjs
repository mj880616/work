import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { openHome } from './helpers/home-entry.mjs';
import { clickView } from './helpers/shell-navigation.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { start as startFiles, openFiles, treeGo } from './helpers/files-server.mjs';
import { measureLayout, uniqueIssues } from './helpers/layout-audit.mjs';
// QA-여백겹침점검(S70-25, 명진 11/25 11:12 "디자인 전수조사 여백 없어서 답답하거나 겹치는 문제 등 확인후 개선").
// 앱 메뉴 화면마다 PC 1280·1440, 폰 390, 폴드 펼침 884에서 겹침·붙음·자리 표시 남음을 같은 자로 잰다(helpers/layout-audit.mjs).
// 가짜 서버·지어낸 자료만 쓴다(운영 접속 없음). 조사 결과: docs/qa/layout-audit-20261125.md.
// KNOWN 표: 이미 찾았고 고치는 PR이 줄 서 있는 문제(화면|폭 → 허용하는 종류). 고치는 PR은 그 화면 줄을 지워 검사를 켠다(고치기 전 실패 → 고친 뒤 통과).
// AUDIT_OUT=폴더 를 주면 화면마다 잰 결과(json)와 사진(png)을 그 폴더에 남긴다(조사 보고 만들 때만).
const WIDTHS = [1280, 1440, 390, 884];
const view = name => async page => { await clickView(page, name); };
const SCREENS = [
  ['홈', async () => {}],
  ['노트', async page => { await chooseBasketKind(page, 'note'); }],
  ['잊지 말기', view('basket')],
  ['달력', view('calendar')],
  ['할 일', view('tasks')],
  ['하루 기록', async page => { // 폰은 [일정] 탭 위 [달력 | 할 일 | 하루 기록]에서 고른다
    const tab = page.locator('.mobile-tabs [data-mobile-schedule-tab]:visible');
    if (await tab.count()) { await clickView(page, 'calendar'); await page.locator('.schedule-switch [data-view="diary"]:visible').first().click(); } else await clickView(page, 'diary');
  }],
  ['조직 관리', view('team')],
  ['사업 관리', view('meetings')],
  ['사업영역 관리', view('projects')],
  ['브리핑 룸', view('brief')],
  ['파일', null], // 파일은 가짜 파일 서버로 따로 연다(아래 open)
  ['파일 빈 폴더', null], // 사진2: 한 칸 보기에서 빈 폴더를 연 모양
  ['자료실', view('library')],
  ['읽을 거리', view('outside')],
  ['저장한 글', view('reading')],
  ['통화', view('calls')],
  ['텔레그램 소식', view('telegram')],
  ['아스날', view('arsenal')],
  ['사진', view('photos')],
  ['메뉴', async page => { const w = page.viewportSize().width; if (w <= 760) await page.locator('#mobileMenuTab').click(); else await page.locator('#appView>.app-topline [data-account-open]:visible').first().click(); await page.waitForTimeout(300); }],
];
// 화면|폭 → 아직 허용하는 문제 종류(고치는 PR이 지운다). 조사(2026-11-25) 결과로 채움.
// 고치는 순서와 PR: docs/qa/layout-audit-20261125.md 4절.
const KNOWN = {
  // S70-24(#3060): [저장한 글] 보기 탭 줄이 아래 선에 붙음(사진1) — 그 PR이 고친다
  '저장한 글|1280': ['under'], '저장한 글|1440': ['under'], '저장한 글|884': ['under'],
};
const DEFAULT_ALLOW = new Set();

async function open(page, name, width) {
  await page.setViewportSize({ width, height: 900 });
  if (name.startsWith('파일')) {
    const { server } = await startFiles(page, width);
    // 지어낸 빈 폴더 하나(안에 아무것도 없음).
    server.items.push({ source: 'od', item_id: 'OD!3', parent_id: null, name: '가짜 빈 폴더', is_folder: true, mime: null, size_bytes: null, modified_at: '2026-10-01T01:00:00Z', hash: null, trashed: false, starred: false, library_doc_id: null });
    await openFiles(page, width);
    if (name === '파일 빈 폴더') await treeGo(page, 'od', 'OD!3');
    return;
  }
  await openHome(page);
  const go = SCREENS.find(s => s[0] === name)[1];
  await go(page);
}

for (const [name] of SCREENS) for (const width of WIDTHS) test(`LA ${name} ${width}: 겹침·붙음·자리 표시 남음 없음`, async ({ page }) => {
  test.setTimeout(90000);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await open(page, name, width);
  await page.waitForTimeout(1500); // 가짜 서버 응답과 마지막 그리기가 끝날 때까지
  const issues = uniqueIssues(await measureLayout(page));
  const dir = process.env.AUDIT_OUT;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    const key = `${name.replace(/\s/g, '')}-${width}`;
    writeFileSync(`${dir}/${key}.json`, JSON.stringify({ name, width, issues }, null, 1));
    await page.screenshot({ path: `${dir}/${key}.png` });
    return;
  }
  const allow = new Set([...(KNOWN[`${name}|${width}`] || []), ...DEFAULT_ALLOW]);
  expect(issues.filter(i => !allow.has(i.kind))).toEqual([]);
  expect(errors).toEqual([]);
});
