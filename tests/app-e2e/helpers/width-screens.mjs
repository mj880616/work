// LAYOUT-폭별검사 화면 표: 폭별 모양 검사(tests/app-e2e/width-layout.spec.mjs)가 여는 화면과 그 화면에서 하는 동작.
// 새 화면은 아래 SCREENS에 줄 하나만 더한다: { name, open(page, width) [, acts: { 동작 이름: async (page, width) => {} }] [, only(width)] }.
// open은 그 화면을 사람처럼 연다(가짜 서버·지어낸 자료만, 운영 접속 없음). acts는 그 화면에서 한 손동작(폴더 누르기·줄 밀기·메뉴 열기) —
// 동작마다 화면을 새로 열어 잰다(앞 동작이 남긴 상태가 섞이지 않게). only(width)가 false인 폭은 건너뛴다(예: 줄 밀기는 폰 틀 ≤760px만).
import { expect } from '@playwright/test';
import { openHome } from './home-entry.mjs';
import { clickView } from './shell-navigation.mjs';
import { chooseBasketKind } from './basket-kind.mjs';
import { installViewPrefsServer } from './view-prefs-server.mjs';
import { start as startFiles, openFiles, treeGo } from './files-server.mjs';
import { start as startNews, openNews } from './news-server.mjs';
import { bootLibrary, libFolder, libDoc } from './library-folder-server.mjs';

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const PHONE_FRAME = w => w <= 760; // 하단바·줄 밀기가 있는 폰 틀(app CSS max-width:760px)

// 손가락 한 번 가로 밀기(브라우저 터치 입력). dx < 0 = 왼쪽.
export async function swipeRow(page, locator, dx) {
  await locator.scrollIntoViewIfNeeded();
  const b = await locator.boundingBox();
  const y = b.y + Math.min(b.height / 2, 20), x0 = dx < 0 ? b.x + b.width - 30 : b.x + 30;
  const cdp = await page.context().newCDPSession(page);
  const tp = x => [{ x, y, id: 0 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(x0) });
  for (let i = 1; i <= 10; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(x0 + dx * i / 10) }); await page.waitForTimeout(16); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
  await page.waitForTimeout(350); // 칸이 열리는 움직임(.18초)이 끝날 때까지
}

// 노트: 폴더 둘(하나는 하위 폴더 있음) + 노트 넷(긴 제목 하나). 노트 목록·나무·노트 열기를 모두 이 자료로 본다.
async function notes(page) {
  await openHome(page);
  await installViewPrefsServer(page);
  const row = (id, title, updated_at, metadata = {}) => ({ id, workspace_id: 'w', kind: 'note', title, raw_text: title + ' 본문 첫 줄\n둘째 줄', occurred_at: updated_at, created_at: updated_at, updated_at, archived_at: null, ai_export_allowed: true, attachments: [], metadata });
  const rows = [
    row('n1', '가상 회의 노트', '2026-10-16T01:00:00Z', { folder_id: U(1) }),
    row('n2', '아주 긴 제목의 가상 노트 — 폭이 좁아지면 줄여 보여야 한다', '2026-10-12T01:00:00Z', { folder_id: U(1) }),
    row('n3', '가상 메모', '2026-10-10T01:00:00Z', { folder_id: U(2) }),
    row('n4', '폴더 없는 가상 노트', '2026-10-09T01:00:00Z'),
  ];
  const folders = [
    { id: U(1), workspace_id: 'w', parent_id: null, name: '가상 회의', sort_order: 1024, created_at: '2026-10-01T00:00:00Z' },
    { id: U(2), workspace_id: 'w', parent_id: null, name: '가상 자료 모음', sort_order: 2048, created_at: '2026-10-01T00:00:00Z' },
    { id: U(3), workspace_id: 'w', parent_id: U(1), name: '가상 하위 폴더', sort_order: 1024, created_at: '2026-10-01T00:00:00Z' },
  ];
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', r => {
    const req = r.request(), q = new URL(req.url()).searchParams;
    const pick = x => (!q.get('kind') || 'eq.' + x.kind === q.get('kind')) && (!q.get('id') || 'eq.' + x.id === q.get('id'));
    return req.method() === 'GET' ? r.fulfill({ json: rows.filter(pick).slice(Number(q.get('offset') || 0)).map(x => structuredClone(x)) }) : r.fulfill({ status: 500, json: {} });
  });
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_folders', r => r.request().method() === 'GET' ? r.fulfill({ json: structuredClone(folders) }) : r.fulfill({ status: 500, json: {} }));
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  await expect(page.locator('[data-nx-count]')).toContainText('4');
}
const noteFolderRow = page => page.locator(`[data-nx-tree] [data-nx-folder="${U(1)}"] .ft-main, #noteRows [data-nx-folder="${U(1)}"] .ft-main, [data-nx-tree] .ft-row:has-text("가상 회의") .ft-main`).first();
async function enterNoteFolder(page) {
  const more = page.locator(`[data-nx-folder-more="${U(1)}"]:visible`).first();
  await more.click();
  await page.locator('#noteDocMenu [data-nx-enter]').click();
  await page.waitForTimeout(400);
}
const noteRow = page => page.locator('#noteRows [data-note-row]:visible, [data-nx-note]:visible').first();

// 잊지 말기: 업데이트 셋.
async function basket(page) {
  const rows = [1, 2, 3].map(n => ({ id: U(200 + n), workspace_id: 'w', kind: 'basket', title: null, raw_text: ['첫째 가짜 업데이트\n- 확인할 것 하나', '둘째 가짜 업데이트', '셋째 가짜 업데이트'][n - 1], occurred_at: `2026-10-0${7 - n}T01:00:00Z`, created_at: `2026-10-0${7 - n}T01:00:00Z`, updated_at: `2026-10-0${7 - n}T01:00:00Z`, archived_at: null, ai_export_allowed: true, attachments: [], metadata: {} }));
  await openHome(page, { beforeLoad: async () => {
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', r => {
      const req = r.request(), q = new URL(req.url()).searchParams;
      const pick = row => (!q.get('kind') || 'eq.' + row.kind === q.get('kind')) && (!q.get('id') || 'eq.' + row.id === q.get('id'));
      if (req.method() !== 'GET') return r.fulfill({ status: 500, json: {} });
      return r.fulfill({ json: q.get('metadata') ? [] : rows.filter(pick).slice(Number(q.get('offset') || 0)) });
    });
    await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  } });
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await expect(page.locator('#basketView [data-basket-row]')).toHaveCount(3, { timeout: 20000 });
}
const basketRow = page => page.locator('#basketView [data-basket-row-item]').first();

const home = async page => { await openHome(page); };
const view = name => async page => { await openHome(page); await clickView(page, name); };
const route = (name, detail = {}) => async page => { await openHome(page); await page.evaluate(([v, d]) => window.KPTURouter.go(v, d), [name, detail]); await page.waitForTimeout(800); };
const diary = async page => {
  await openHome(page);
  const tab = page.locator('.mobile-tabs [data-mobile-schedule-tab]:visible');
  if (await tab.count()) { await clickView(page, 'calendar'); await page.locator('.schedule-switch [data-view="diary"]:visible').first().click(); } else await clickView(page, 'diary');
};
const menu = async (page, width) => {
  await openHome(page);
  if (width <= 760) await page.locator('#mobileMenuTab').click(); else await page.locator('#appView>.app-topline [data-account-open]:visible').first().click();
  await page.waitForTimeout(300);
};
const files = async (page, width, enter = false) => {
  const { server } = await startFiles(page, width);
  await openFiles(page, width);
  if (enter) { const f = server.items.find(i => i.is_folder); if (f) await treeGo(page, f.source, f.item_id); }
};
const library = async (page, width, enter = false) => {
  const folders = [libFolder('f1', null, { name: '가상 자료 폴더' }), libFolder('f2', null, { name: '아주 긴 이름의 가상 자료 폴더 — 좁은 폭에서 줄여 보여야 함', sort_order: 2048 })];
  await bootLibrary(page, width, { folders, docs: [libDoc('d1', null), libDoc('d2', null)] });
  const by = page.locator('#libraryGroupBy');
  if (await by.count()) await by.selectOption({ label: '폴더' }).catch(() => {});
  if (enter) { const f = page.locator('#libraryFolderNav .ft-row .ft-main:visible, #documentList [data-lu-node] > summary:visible').first(); if (await f.count()) await f.click(); }
  await page.waitForTimeout(400);
};
const org = async page => {
  await openHome(page); await clickView(page, 'team');
  const row = page.locator('[data-so-org="o"]').first(); await expect(row).toBeVisible();
  if (!await page.locator('#wdModal:visible').count()) await row.click();
  await expect(page.locator('#wdModal')).toBeVisible();
};
const project = async page => {
  await openHome(page); await clickView(page, 'projects');
  const row = page.locator('#projectGrid .ps3-plist [data-ps3-project]').first(); await expect(row).toBeVisible();
  if (!await page.locator('#ps3DetailModal:visible').count()) await row.click();
  await expect(page.locator('#ps3DetailModal')).toBeVisible();
};
const calendarEvent = async page => {
  await openHome(page); await clickView(page, 'calendar');
  const ev = page.locator('#calendarView [data-google-event]:visible, #calendarView .clv-event:visible').first();
  await expect(ev).toBeVisible(); await ev.click(); await page.waitForTimeout(400);
};
const rowMenu = sel => async page => { const m = page.locator(sel).first(); await m.scrollIntoViewIfNeeded(); await m.click(); await page.waitForTimeout(300); };

export const SCREENS = [
  { name: '홈', open: home },
  { name: '노트', open: notes, acts: {
    '폴더 누르기': async page => { await noteFolderRow(page).click(); await page.waitForTimeout(400); },
    '폴더 들어가기': enterNoteFolder,
    '폴더 메뉴 열기': rowMenu(`[data-nx-folder-more="${U(1)}"]:visible`),
    '줄 밀기 왼쪽': async page => { await enterNoteFolder(page); await swipeRow(page, noteRow(page), -180); },
    '줄 밀기 오른쪽': async page => { await enterNoteFolder(page); await swipeRow(page, noteRow(page), 180); },
  }, only: { '줄 밀기 왼쪽': PHONE_FRAME, '줄 밀기 오른쪽': PHONE_FRAME } },
  { name: '노트 열기', open: async page => { await notes(page); await enterNoteFolder(page); await noteRow(page).click(); await page.waitForTimeout(600); } },
  { name: '잊지 말기', open: basket, acts: {
    '줄 누르기': async page => { await basketRow(page).click(); await page.waitForTimeout(400); },
    '줄 밀기 왼쪽': async page => { await swipeRow(page, basketRow(page), -180); },
  }, only: { '줄 밀기 왼쪽': PHONE_FRAME } },
  { name: '달력', open: view('calendar') },
  { name: '일정 열기', open: calendarEvent },
  { name: '할 일', open: view('tasks') },
  { name: '하루 기록', open: diary },
  { name: '조직 관리', open: view('team') },
  { name: '조직 상세', open: org },
  { name: '사업 관리', open: view('meetings') },
  { name: '사업영역 관리', open: view('projects') },
  { name: '사업영역 상세', open: project },
  { name: '브리핑 룸', open: view('brief') },
  { name: '파일', open: (page, w) => files(page, w) },
  { name: '파일 폴더', open: (page, w) => files(page, w, true) },
  { name: '자료실', open: (page, w) => library(page, w) },
  { name: '자료실 폴더', open: (page, w) => library(page, w, true) },
  { name: '읽을 거리', open: async (page, w) => { await startNews(page, w); await openNews(page, w); } },
  { name: '저장한 글', open: view('reading') },
  { name: '통화', open: view('calls') },
  { name: '텔레그램 소식', open: view('telegram') },
  { name: '아스날', open: view('arsenal') },
  { name: '사진', open: view('photos') },
  { name: '메뉴', open: menu },
  { name: '설정', open: route('profile') },
  { name: '설정 수집 상태', open: route('profile', { sub: 'status' }) },
  { name: '찾기', open: route('search') },
  { name: '운영자 업데이트 기록', open: route('updates') },
  { name: '운영자 가입 관리', open: route('signups') },
  { name: '운영자 의견함', open: route('feedback') },
];

// 시험 한 칸 = 화면 × (처음 모양 또는 동작 하나). 폭은 helpers/width-audit.mjs WIDTHS.
export function cases() {
  const out = [];
  for (const s of SCREENS) {
    out.push({ screen: s.name, act: '', run: s.open, only: () => true });
    for (const [act, fn] of Object.entries(s.acts || {})) out.push({ screen: s.name, act, run: async (page, w) => { await s.open(page, w); await fn(page, w); }, only: s.only?.[act] || (() => true) });
  }
  return out;
}
