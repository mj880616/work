import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
// S71-59 UI-화면메뉴안으로(2026-11-26 사용자 PC 화면 의견: "노트 관련 메뉴인 거 같은데 있는 위치가 이 시스템의 전체 메뉴가 있을 법한 위치야
// 더 노트 화면으로 들어와야 할 것 같아" / 조직 관리·자료실·읽을 거리 "여기도 마찬가지" / 사업 관리 "반면 여기는 제대로 돼 있네"):
// PC 틀(761px~) 맨 위 줄(뒤로·앞으로·위치·찾기·+ 추가·계정)은 앱 전체 것만. 화면에서만 쓰는 단추·⋯는 화면 안 첫 줄(보기 탭·고르기 줄)
// 오른쪽 끝 — 사업 관리가 본보기. 자리 표·옮기기는 공용 screen-tools.js(lineSlot) 한 곳. 첫 줄이 따로 없는 화면(브리핑 룸·사진)은
// 화면 맨 위 그 한 줄. 폰(~760px)은 지금 그대로 앱 머리 줄 '… · 찾기 · [+]' 한 줄(회귀 없음).
// 예외(이 표 밖): 저장한 글·업데이트 기록의 찾기 옆 ＋ 하나는 사용자가 정한 자리라 맨 위 줄 그대로(reading-head-one-line·update-news 시험).
// 서버는 흉내, 조직 이름은 가짜.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const owner = 'home-test', stamp = '2026-09-15T01:00:00Z';
const orgs = [
  { id: 'oa', workspace_id: 'w', name: '가상 가 지부', active: true, created_by: owner, updated_at: stamp },
  { id: 'ob', workspace_id: 'w', name: '가상 나 지부', active: true, created_by: owner, updated_at: stamp },
];
// 화면 × 그 화면 전용 단추(⋯ 또는 만들기) × 화면 안 첫 줄(없으면 null — 화면 맨 위 한 줄).
const SCREENS = [
  { key: '노트', view: 'basket', kind: 'note', tool: '[data-note-folder-more]', line: '#basketView [data-note-list] > .note-list-head' },
  // 잊지 말기(S71-29 둘째 줄 없앰)는 노트와 같은 화면 칸(#basketView)이라 첫 줄 자리를 같이 쓴다 — 지금 보이는 쪽의 첫 줄(.basket-head)로 간다.
  // S71-58 FORGET-처리전만: [처리 전 ▾] 걸러 보기 단추는 없앴다 — 남은 단추는 ↻(gone: 어디에도 없어야 하는 것).
  { key: '잊지 말기', view: 'basket', kind: 'memo', tool: '[data-inbox-find]', line: '#basketView > .basket-head', gone: ['[data-forget-view-open]'] },
  { key: '조직 관리', view: 'team', tool: '#soTeamMore', line: '#soTeamTabs' },
  { key: '자료실', view: 'library', tool: '#libraryTopMenuBtn', line: '#libraryView .lu-search-row', also: ['#newDocumentBtn'] },
  { key: '읽을 거리', view: 'outside', tool: '[data-os-more]', line: '#outsideRoot > .os-tabs', also: ['[data-nw-media]'] },
  { key: '브리핑 룸', view: 'brief', tool: '[data-br-top-add]', line: null, also: ['[data-br-top-more]'] }, // [+]가 맨 오른쪽(S71-30)
  { key: '사진', view: 'photos', tool: '[data-photos-head-more]', line: null, also: ['[data-photos-src-pick]'] },
  { key: '사업 관리(본보기)', view: 'meetings', tool: '#newMeetingBtn', line: '#reportTop' },
];

async function boot(page, width) {
  await page.setViewportSize({ width, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await openHome(page, { beforeLoad: async () => {
    await page.route(SB + '/rest/v1/app_suborganizations?**', r => { const id = new URL(r.request().url()).searchParams.get('id'); return r.fulfill({ json: id ? orgs.filter(o => 'eq.' + o.id === id) : orgs }); });
    await page.route(SB + '/rest/v1/app_suborganization_assignees?**', r => { const q = new URL(r.request().url()).searchParams; return r.fulfill({ json: q.get('user_id') ? [{ user_id: owner }] : orgs.map(o => ({ organization_id: o.id, user_id: owner })) }); });
  } });
  return errors;
}
async function go(page, s) {
  await page.evaluate(v => window.KPTURouter.go(v, { source: 'delegated' }), s.view);
  await expect(page.locator(`#${s.view}View`)).toBeVisible();
  if (s.kind) await chooseBasketKind(page, s.kind);
}
const rect = loc => loc.evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom, mid: r.top + r.height / 2 }; });

test('PC 1280: 화면 전용 단추·⋯는 화면 안 첫 줄 오른쪽 끝, 맨 위 줄에는 앱 전체 것만', async ({ page }) => {
  test.setTimeout(150000);
  const errors = await boot(page, 1280);
  const topline = page.locator('#appView>.app-topline');
  const rows = [];
  for (const s of SCREENS) {
    await go(page, s);
    const panel = page.locator(`#${s.view}View`), tool = panel.locator(s.tool);
    await expect(tool, `${s.key}: 화면 안에 단추`).toBeVisible();
    for (const sel of s.also || []) await expect(panel.locator(sel), `${s.key}: ${sel}도 화면 안`).toBeVisible();
    for (const sel of s.gone || []) await expect(page.locator(sel), `${s.key}: ${sel}는 없음`).toHaveCount(0);
    // 맨 위 줄에는 이 화면 단추가 없다(앱 전체 것만: 메뉴 숨기기·뒤로·앞으로·위치·찾기·+ 추가·계정).
    await expect(topline.locator([s.tool, ...(s.also || [])].join(',')), `${s.key}: 맨 위 줄에 없음`).toHaveCount(0);
    await expect(topline.locator('[data-screen-tools-for]:visible'), `${s.key}: 맨 위 줄 단추 상자 없음`).toHaveCount(0);
    const t = await rect(tool), p = await rect(panel);
    // 오른쪽 끝(화면 칸 오른쪽에서 12px 안).
    expect(p.right - t.right, `${s.key}: 오른쪽 끝`).toBeLessThanOrEqual(12);
    if (s.line) {
      // 첫 줄과 같은 줄(세로 가운데 6px 안), 그 줄 내용(탭·고르기) 오른쪽.
      const l = await rect(page.locator(s.line));
      expect(Math.abs(t.mid - l.mid), `${s.key}: 첫 줄과 같은 줄`).toBeLessThanOrEqual(6);
      expect(t.y, `${s.key}: 맨 위 줄 아래`).toBeGreaterThanOrEqual((await rect(topline)).bottom - 1);
    } else {
      // 첫 줄이 없는 화면: 화면 맨 위 그 한 줄(화면 칸 위끝 바로 아래).
      expect(t.y - p.y, `${s.key}: 화면 맨 위 줄`).toBeLessThanOrEqual(8);
    }
    rows.push(s.key);
  }
  expect(rows).toEqual(SCREENS.map(s => s.key));
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('폰 390: 화면 단추는 지금 그대로 앱 머리 줄 한 줄(화면 안 첫 줄 자리는 비어 없음)', async ({ page }) => {
  test.setTimeout(150000);
  const errors = await boot(page, 390);
  const head = page.locator('#appView>.mobile-shell-header');
  for (const s of SCREENS.filter(x => x.view !== 'meetings')) {
    await go(page, s);
    const tool = head.locator(s.tool);
    await expect(tool, `${s.key}: 머리 줄에 단추`).toBeVisible();
    const h = await rect(head), t = await rect(tool);
    expect(h.h, `${s.key}: 머리 줄 한 줄`).toBeLessThanOrEqual(48);
    expect(Math.abs(t.mid - h.mid), `${s.key}: 같은 줄`).toBeLessThanOrEqual(3);
    expect(t.right, `${s.key}: 화면 안`).toBeLessThanOrEqual(390);
    await expect(page.locator(`#${s.view}View [data-screen-tools="line"]:visible`), `${s.key}: 화면 안 자리 없음`).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), `${s.key}: 가로 넘침 없음`).toBeLessThanOrEqual(1);
  }
  expect(errors).toEqual([]);
});

test('PC ↔ 폰 폭을 바꾸면 단추가 맞는 자리로 옮겨 가고, 다른 화면으로 가면 남지 않는다', async ({ page }) => {
  test.setTimeout(90000);
  await boot(page, 1280);
  const note = SCREENS[0];
  await go(page, note);
  await expect(page.locator(`${note.line} [data-screen-tools="line"] ${note.tool}`)).toBeVisible();
  await page.setViewportSize({ width: 390, height: 900 });
  await expect(page.locator(`#appView>.mobile-shell-header ${note.tool}`)).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator(`${note.line} [data-screen-tools="line"] ${note.tool}`)).toBeVisible();
  // 같은 화면 칸의 노트 ↔ 잊지 말기를 오가면 자리도 지금 보이는 쪽 첫 줄로 따라간다(숨은 쪽 줄에 남아 안 보이는 일 없음).
  const forget = SCREENS[1];
  await go(page, forget);
  await expect(page.locator(`${forget.line} [data-screen-tools="line"] ${forget.tool}`)).toBeVisible();
  await go(page, note);
  await expect(page.locator(`${note.line} [data-screen-tools="line"] ${note.tool}`)).toBeVisible();
  await expect(page.locator(`${forget.tool}:visible`)).toHaveCount(0);
  await page.evaluate(() => window.KPTURouter.go('library', { source: 'delegated' }));
  await expect(page.locator('#libraryView')).toBeVisible();
  await expect(page.locator(`${note.tool}:visible`)).toHaveCount(0);
  await expect(page.locator('#libraryView .lu-search-row [data-screen-tools="line"] #libraryTopMenuBtn')).toBeVisible();
});
