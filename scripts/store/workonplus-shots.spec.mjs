// S69-11 STORE-플레이등록자료: 플레이 스토어 'WORK ON+' 폰 스크린샷(9:16, 1080×1920)을 찍는다.
// 실행: 정적 서버(python3 tests/app-e2e/helpers/static-server.py 8123)를 띄운 뒤
//   npx playwright test scripts/store/workonplus-shots.spec.mjs --browser=chromium --workers=1
// 결과: docs/store/workonplus/screenshots/*.png (SHOT_DIR로 바꿀 수 있음).
// 화면은 기존 E2E와 같은 흉내 서버(tests/app-e2e/helpers/home-entry.mjs)로 연다 — 운영자 기능이 없는 새 계정(features: [], 기본 메뉴).
// 글·일정·할 일·노트는 모두 지어낸 예시다. 실제 사람 자료·이메일·특정 단체 이름을 넣지 않는다.
// CI의 화면 시험 묶음(tests/app-e2e)에 들어가지 않는다(경로를 직접 줄 때만 돈다).
import { test, expect } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { openHome } from '../../tests/app-e2e/helpers/home-entry.mjs';

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const OUT = process.env.SHOT_DIR || 'docs/store/workonplus/screenshots';
const ART = process.env.ART_DIR || 'docs/store/workonplus/graphics';
const NOW = '2026-11-24T01:00:00Z'; // 화요일 오전 10시(한국 시각)
const W = 'w';

const ev = (id, title, start, end, allDay = false) => ({ id, title, start, end, allDay, calendarId: 'c' });
const EVENTS = [
  ev('e1', '주간 회의', '2026-11-24T10:30:00+09:00', '2026-11-24T11:30:00+09:00'),
  ev('e2', '거래처 미팅', '2026-11-24T15:00:00+09:00', '2026-11-24T16:00:00+09:00'),
  ev('e3', '분기 계획 검토', '2026-11-25T14:00:00+09:00', '2026-11-25T15:30:00+09:00'),
  ev('e4', '교육 — 문서 작성법', '2026-11-26T09:30:00+09:00', '2026-11-26T12:00:00+09:00'),
  ev('e5', '출장', '2026-11-27', '2026-11-29', true),
  ev('e6', '팀 점심', '2026-11-23T12:00:00+09:00', '2026-11-23T13:00:00+09:00'),
  ev('e7', '프로젝트 중간 발표', '2026-11-18T16:00:00+09:00', '2026-11-18T17:00:00+09:00'),
  ev('e8', '병원 예약', '2026-11-20T18:30:00+09:00', '2026-11-20T19:00:00+09:00'),
  ev('e9', '월간 정리', '2026-11-30T17:00:00+09:00', '2026-11-30T18:00:00+09:00'),
  ev('e10', '홍보물 시안 확인', '2026-11-13T11:00:00+09:00', '2026-11-13T12:00:00+09:00'),
  ev('e11', '행사 준비 회의', '2026-11-10T14:00:00+09:00', '2026-11-10T15:00:00+09:00'),
  ev('e12', '연말 행사', '2026-12-04', '2026-12-05', true),
];
const tk = (id, title, due, status = 'needsAction') => ({ id, title, due, status, taskListId: 'default', taskListTitle: '내 할 일' });
const TASKS = [
  tk('t1', '회의 자료 보내기', '2026-11-24'),
  tk('t2', '견적서 확인', '2026-11-25'),
  tk('t3', '교육 신청서 내기', '2026-11-26'),
  tk('t4', '출장 숙소 예약', '2026-11-23'),
  tk('t5', '월간 보고 초안', '2026-11-30'),
  tk('t6', '사진 정리', null),
  tk('t7', '명함 주문', '2026-11-20', 'completed'),
];
const note = (id, title, raw, at, extra = {}) => ({ id, workspace_id: W, kind: 'note', title, raw_text: raw, occurred_at: at, created_at: at, updated_at: at, archived_at: null, ai_export_allowed: true, attachments: [], metadata: {}, ...extra });
const NOTES = [
  note('n1', '분기 계획 메모', '## 목표\n\n- 신규 거래처 두 곳\n- 문서 양식 정리\n- 교육 일정 확정\n\n## 할 일\n\n- 견적서 확인\n- 회의 자료 보내기', '2026-11-24T00:40:00Z'),
  note('n2', '거래처 미팅 준비', '물어볼 것\n- 납기 일정\n- 견적 조건\n- 다음 만남 날짜', '2026-11-23T08:10:00Z'),
  note('n3', '교육 들은 내용', '좋은 문서는 첫 문장에 결론을 쓴다.\n표는 한 가지 비교만 담는다.', '2026-11-21T05:20:00Z'),
  note('n4', '출장 준비물', '- 노트북·충전기\n- 명함\n- 발표 자료', '2026-11-20T11:00:00Z'),
  note('n5', '읽고 싶은 책', '- 일 잘하는 사람의 메모 습관\n- 글쓰기 기본기', '2026-11-18T13:00:00Z'),
  note('n6', '아이디어', '홈 화면에 이번 주 일정을 한눈에.', '2026-11-15T02:00:00Z'),
];
const BODY = '회의가 길어지는 가장 큰 까닭은 목적이 정해지지 않은 채 시작하기 때문이에요.\n\n회의 전에 한 줄로 목적을 적어 두면, 이야기가 옆길로 샐 때 돌아올 자리가 생겨요.\n\n끝날 때는 누가 무엇을 언제까지 할지 세 칸으로 정리하면 다음 회의가 짧아져요.\n\n정리한 내용은 바로 일정과 할 일로 옮겨 두는 것이 좋아요.';
const rd = (id, title, site, at, read = null, body = null) => ({ id, workspace_id: W, url: `https://example.com/${id.slice(-1)}`, title, site, saved_at: at, read_at: read, body_state: body ? 'ok' : 'pending', body_at: at, business_area_id: null, updated_at: at, body });
const READING = [
  rd('a6900000-0000-4000-8000-000000000001', '회의를 짧게 끝내는 세 가지 습관', 'example.com', '2026-11-24T00:20:00Z', null, BODY),
  rd('a6900000-0000-4000-8000-000000000002', '일정 관리, 달력 하나로 충분할까', 'example.org', '2026-11-23T10:00:00Z', null, BODY),
  rd('a6900000-0000-4000-8000-000000000003', '메모를 다시 꺼내 보게 만드는 방법', 'example.net', '2026-11-22T03:00:00Z', '2026-11-22T05:00:00Z', BODY),
  rd('a6900000-0000-4000-8000-000000000004', '좋은 보고서의 첫 문장', 'example.com', '2026-11-21T07:00:00Z', null, BODY),
  rd('a6900000-0000-4000-8000-000000000005', '사진 정리를 미루지 않는 법', 'example.org', '2026-11-19T09:00:00Z', '2026-11-19T12:00:00Z', BODY),
];
const ids = s => (s || '').replace(/^eq\./, '');

async function fakeServer(page) {
  await page.route(SB + '/**', async route => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname, a = u.searchParams.get('action'), method = req.method();
    const ok = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    // 흉내 로그인 열쇠의 만료 시각을 찍는 날(NOW) 뒤로 둔다(기본 흉내 값은 10월이라 11월 화면에서는 다시 받기를 되풀이한다).
    if (p === '/auth/v1/token') return ok({ access_token: 'shot-access', refresh_token: 'shot-refresh', expires_at: Math.floor(Date.parse(NOW) / 1000) + 86400, user: { id: 'home-test', email: 'shot@example.org' } });
    if (p.endsWith('/functions/v1/google-calendar')) {
      if (a === 'events') return ok({ warning: '', events: EVENTS });
      return ok({ connected: true, selected: ['c'], calendars: [{ id: 'c', summary: '내 캘린더', backgroundColor: '#5b7a99' }], colors: {} });
    }
    if (p.endsWith('/functions/v1/google-tasks')) {
      if (a === 'tasks') return ok({ tasks: TASKS, needs_reconnect: false, pending_scope: 'all' });
      if (a === 'links') return ok({ links: [], meeting_links: [] });
      return ok({ connected: true, authorized: true, pending_scope: 'all', tasks: TASKS });
    }
    if (p === '/rest/v1/app_workspace_members') return ok([{ workspace_id: W, role: 'owner', workspace: { id: W, name: '내 작업공간', slug: 'my' } }]);
    if (p === '/rest/v1/app_notes' && method === 'GET') {
      const kind = u.searchParams.get('kind'), id = ids(u.searchParams.get('id'));
      if (u.searchParams.get('metadata')) return ok([]);
      let rows = NOTES;
      if (kind && kind !== 'eq.note') rows = [];
      if (id) rows = rows.filter(r => r.id === id);
      return ok(rows);
    }
    if (p === '/rest/v1/app_reading_items') {
      const id = ids(u.searchParams.get('id')), withBody = (u.searchParams.get('select') || '').includes('body');
      const pick = r => { const { workspace_id, body, ...rest } = r; return withBody ? { ...rest, body } : rest; };
      // [읽음] 표시(PATCH)는 그 줄을 고친 모양으로 돌려준다(흉내 서버 안에서만).
      if (method === 'PATCH') { const row = READING.find(r => r.id === id); if (row) Object.assign(row, req.postDataJSON() || {}); return ok(row ? [pick(row)] : []); }
      if (method !== 'GET') return ok([]);
      return ok((id ? READING.filter(r => r.id === id) : READING).map(pick));
    }
    if (p === '/rest/v1/app_news_highlights') return ok([]);
    if (p.startsWith('/rest/v1/rpc/app_lock_')) {
      if (p.endsWith('app_lock_read')) return ok({ has_pin: true, features: ['diary', 'photos'], relock: '5m', left: 5, blocked_until: null });
      return ok({ ok: false, left: 5, blocked_until: null });
    }
    if (p.endsWith('app_spaces') || p.endsWith('app_suborganizations') || p.endsWith('app_suborganization_updates') || p.endsWith('app_meetings') || p.endsWith('app_project_milestones') || p.endsWith('app_record_links')) return ok([]);
    return route.fallback();
  });
}

const go = (page, view) => page.evaluate(v => window.KPTURouter.go(v, { source: 'delegated' }), view);
const settle = page => page.waitForTimeout(1200);
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });

test.use({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });

test('WORK ON+ 스토어 스크린샷(앱 화면)', async ({ page }) => {
  test.setTimeout(120000);
  mkdirSync(OUT, { recursive: true });
  await openHome(page, { features: [], menuLayout: null, weeklyBase: false, milestones: false, now: NOW, beforeLoad: () => fakeServer(page) });
  await settle(page);
  await shot(page, '01-home');

  await page.locator('.mobile-tabs [data-view="calendar"]').first().click();
  await expect(page.locator('#calendarView')).toBeVisible();
  await page.locator('[data-calendar-view="month"]:visible').first().click();
  await settle(page);
  await shot(page, '02-calendar');

  await page.locator('#calendarView').getByRole('button', { name: '할 일', exact: true }).first().click();
  await settle(page);
  await shot(page, '03-tasks');

  await page.locator('.mobile-tabs [data-basket-kind-nav="note"]').click();
  await expect(page.locator('#basketView')).toBeVisible();
  await settle(page);
  await shot(page, '04-notes');

  await go(page, 'reading');
  await expect(page.locator('#readingView')).toBeVisible();
  await settle(page);
  await page.locator('#readingView [data-rd-open]').first().click();
  await settle(page);
  await shot(page, '05-saved-article');

  await go(page, 'diary');
  await expect(page.locator('#lockView')).toBeVisible();
  await settle(page);
  await shot(page, '07-lock');
});

// 그림 예시(앱 화면이 아닌 것): '이번 주' 위젯 설명, 그래픽 이미지(1024×500), 스토어 아이콘(512×512, 투명 칸 있는 32비트 PNG).
// 위젯 그림은 android-app/app/src/main/res/layout/week_widget.xml의 모양·색(values/colors.xml widget_*)을 따라 그린 예시다.
const ICON_SVG = readFileSync(new URL('../../app/app-icon.svg', import.meta.url), 'utf8');
const FONT = "font-family:'Noto Sans CJK KR','Noto Sans KR',system-ui,sans-serif";
const DAYS = [['월', 23, 1, '팀 점심'], ['화', 24, 2, '주간 회의'], ['수', 25, 2, '분기 계획'], ['목', 26, 2, '교육'], ['금', 27, 1, '출장'], ['토', 28, 1, '출장'], ['일', 29, 0, '']];
const ROWS = [['10:30', '주간 회의'], ['15:00', '거래처 미팅']];
const widgetHtml = () => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;${FONT};background:linear-gradient(180deg,#5d6672,#3a4048);width:360px;height:640px;overflow:hidden">
<div style="padding:26px 22px 0;color:#F3F1EA"><div style="font-size:21px;font-weight:700;line-height:1.35">홈 화면에서<br>이번 주를 한눈에</div>
<div style="font-size:13px;opacity:.85;margin-top:6px">'이번 주' 위젯 — 요일별 일정 수와 고른 날 일정</div></div>
<div style="margin:22px 14px 0;background:#F7F5F0;border-radius:20px;padding:8px 8px 10px 12px;color:#262624;box-shadow:0 6px 18px rgba(0,0,0,.25)">
 <div style="display:flex;align-items:center;height:36px"><span style="font-size:26px;width:34px">‹</span><b style="flex:1;font-size:13px">이번 주</b><span style="font-size:11px;color:#5F5E59">일정 9</span><span style="font-size:13px;color:#5F5E59;padding:0 4px 0 10px">↻</span><span style="font-size:26px;width:34px;text-align:right">›</span></div>
 <div style="display:flex;gap:2px">${DAYS.map(([w, n, c, t], i) => `<div style="flex:1;text-align:center;border-radius:12px;padding:4px 0 5px;${i === 1 ? 'background:#22262B;color:#F3F1EA' : ''}"><div style="font-size:10px;${i === 1 ? '' : 'color:#5F5E59'}">${w}</div><div style="font-size:14px;font-weight:700">${n}</div><div style="font-size:11px;${i === 1 ? '' : 'color:#5F5E59'}">${c || '·'}</div><div style="font-size:9px;white-space:nowrap;overflow:hidden;padding:0 2px">${t}</div></div>`).join('')}</div>
 <div style="border-top:1px solid #E2DFD7;margin-top:6px;padding-top:6px">${ROWS.map(([a, b]) => `<div style="font-size:12px;line-height:22px"><span style="display:inline-block;width:44px;color:#5F5E59">${a}</span>${b}</div>`).join('')}</div>
</div>
<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:22px 0;margin:34px 26px 0">${['#8aa1b8', '#b8a88a', '#9bb08f', '#b89a9a', '#a59ab8', '#8fb0ae', '#b0a58f', '#9aa3b8'].map(c => `<div style="width:52px;height:52px;border-radius:16px;background:${c};opacity:.75;margin:auto"></div>`).join('')}</div>
<div style="position:absolute;left:0;right:0;bottom:14px;text-align:center;font-size:11px;color:#F3F1EA;opacity:.7">그림 예시 · 일정은 지어낸 것입니다</div></body>`;
const featureHtml = () => `<!doctype html><meta charset="utf-8"><body style="margin:0;${FONT};width:1024px;height:500px;background:#F3F1EA;color:#22262B;display:flex;align-items:center;overflow:hidden">
<div style="width:220px;height:220px;margin:0 56px 0 92px;flex:none">${ICON_SVG.replace('<svg ', '<svg width="220" height="220" ')}</div>
<div><div style="font-size:64px;font-weight:800;letter-spacing:.02em">WORK ON+</div>
<div style="font-size:30px;margin-top:14px;color:#3f444b">일정·할 일·노트를 한 앱에서</div>
<div style="font-size:20px;margin-top:22px;color:#646a72">구글 캘린더·할 일 연결 · 폰과 PC 같은 기록</div></div></body>`;

test('WORK ON+ 스토어 그림(위젯 예시·그래픽 이미지·아이콘)', async ({ browser }) => {
  mkdirSync(OUT, { recursive: true });
  mkdirSync(ART, { recursive: true });
  const phone = await browser.newPage({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 3 });
  await phone.setContent(widgetHtml());
  await phone.screenshot({ path: `${OUT}/06-week-widget.png` });
  await phone.close();
  const wide = await browser.newPage({ viewport: { width: 1024, height: 500 }, deviceScaleFactor: 1 });
  await wide.setContent(featureHtml());
  await wide.screenshot({ path: `${ART}/feature-graphic-1024x500.png` });
  await wide.close();
  // 플레이 아이콘: 모서리는 플레이가 둥글게 깎으므로 꽉 찬 사각형 그림(maskable 512)을 쓰고, 투명 칸이 있는 32비트(RGBA)로 저장한다.
  const icon = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
  const png = readFileSync(new URL('../../app/icons/app-icon-maskable-512.png', import.meta.url)).toString('base64');
  await icon.setContent(`<!doctype html><body style="margin:0;background:transparent"><img src="data:image/png;base64,${png}" width="512" height="512" style="display:block">`);
  await icon.screenshot({ path: `${ART}/icon-512.png`, omitBackground: true });
  await icon.close();
});
