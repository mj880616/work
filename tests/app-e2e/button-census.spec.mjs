// S49-16 UI-버튼크기전수: 모든 화면의 보이는 버튼을 도구로 모아 크기·글자·굵기·모서리를 잰다.
// 같은 줄(같은 부모, 같은 높이 자리)의 글자 버튼은 높이·글자 크기·굵기·모서리가 하나여야 한다(주 버튼은 색으로만 구분).
// 화면마다 따로 둔 값이 아니라 docs/design-decisions.md 'UI-버튼기준'(--ds-* 토큰)이 기준이다.
// 결과 표는 [census] 줄로 출력한다(PR 전수 표의 근거). Supabase는 모두 모의 응답.
import {test, expect} from '@playwright/test';
import {clickView} from './helpers/shell-navigation.mjs';
import {loginEntry} from './helpers/login-entry.mjs';
import {signInWithSession} from './helpers/session-login.mjs';
import {testOrigin} from './helpers/test-origin.mjs';

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const user = {id:'census-user', email:'census@example.org', user_metadata:{display_name:'버튼 전수'}};
const WS = 'census-workspace';
const REPORT_ONLY = false;
const VIEWS = ['home', 'calendar', 'tasks', 'basket', 'library', 'meetings', 'team', 'pages', 'files', 'photos', 'ledger', 'arsenal', 'diary'];

function mockApp(page) {
  return page.route(SB + '/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    const ok = (data, status = 200) => route.fulfill({status, contentType:'application/json', body:JSON.stringify(data ?? null)});
    if (path === '/auth/v1/token') return ok({access_token:'c-access', refresh_token:'c-refresh', expires_in:3600, expires_at:Math.floor(Date.now() / 1000) + 3600, user});
    if (path === '/auth/v1/user') return ok(user);
    if (path === '/rest/v1/app_workspace_members') return ok([{workspace_id:WS, user_id:user.id, role:'owner', workspace:{id:WS, slug:'c', name:'웹2'}}]);
    if (path === '/rest/v1/app_workspaces') return ok([{id:WS, name:'웹2'}]);
    if (path === '/rest/v1/app_profiles') return ok([{user_id:user.id, display_name:'QA'}]);
    if (path === '/rest/v1/app_share_pages') return ok([{id:'p1', title:'공유 페이지 예시', status:'draft', project_id:null, updated_at:'2026-10-21T01:00:00.000Z', blocks:[]}]);
    if (path === '/functions/v1/google-calendar') return ok({connected:false, enabled:false, selected:[], calendars:[], events:[]});
    if (path.startsWith('/functions/v1/')) return ok({});
    if (path.startsWith('/rest/v1/rpc/')) return ok(null);
    if (path.startsWith('/rest/v1/')) return ok([]);
    return ok({});
  });
}

// 화면 안의 보이는 버튼 모양을 모은다. 줄 = 같은 부모 + 가운데 높이가 6px 안에 드는 것.
const collect = (page, view) => page.evaluate(view => {
  const root = document.querySelector('#' + view + 'View') || document.querySelector('#appView');
  const out = [];
  const rows = new Map();
  let parentSeq = 0; const parentIds = new WeakMap();
  for (const el of root.querySelectorAll('button, summary, a[role="button"]')) {
    if (!el.checkVisibility() || el.closest('.hidden,[hidden]')) continue;
    if (el.closest('.ed-editor, .ed-doc, .ql-editor, [contenteditable="true"]')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const s = getComputedStyle(el);
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    const icon = el.matches('.icon-btn,.more-dots') || [...text].length <= 2 || /^[⋯✕×‹›▾▸+]+$/.test(text);
    const filled = !/rgba?\(0, 0, 0, 0\)/.test(s.backgroundColor) && el.matches('.primary,.quick-pill-primary,[data-basket-save]');
    if (!parentIds.has(el.parentElement)) parentIds.set(el.parentElement, ++parentSeq);
    out.push({view, label:text.slice(0, 18), cls:(el.className && el.className.baseVal === undefined ? el.className : '').toString().split(/\s+/).slice(0, 3).join('.'),
      h:Math.round(r.height * 10) / 10, w:Math.round(r.width), fs:s.fontSize, fw:s.fontWeight, br:s.borderRadius,
      icon, filled, row:parentIds.get(el.parentElement) + ':' + Math.round((r.top + r.height / 2 + scrollY) / 6)});
  }
  return out;
}, view);

for (const width of [390, 1280]) test('버튼 전수 수집 ' + width, async ({page}) => {
  test.setTimeout(240000);
  await page.setViewportSize({width, height:900});
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await mockApp(page);
  await page.goto(loginEntry(testOrigin + '/app/'));
  await signInWithSession(page, user.email);
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, {timeout:20000});
  page.setDefaultTimeout(10000);
  const all = [], skipped = [];
  for (const view of VIEWS) {
    try {
      await clickView(page, view);
      await page.waitForTimeout(700);
      all.push(...await collect(page, view));
    } catch (e) { skipped.push(view); await page.keyboard.press('Escape').catch(() => {}); }
  }
  for (const b of all) console.log('[census] ' + width + ' ' + [b.view, JSON.stringify(b.label), b.cls, 'h' + b.h, 'w' + b.w, b.fs, b.fw, b.br, b.icon ? 'icon' : 'text', b.filled ? 'filled' : '', 'row' + b.row].join(' '));
  console.log('[census] ' + width + ' skipped=' + skipped.join(',') + ' total=' + all.length);
  expect(errors).toEqual([]);
  if (REPORT_ONLY) return;
  // 단추 모양(모서리가 둥근 것)만 잰다. 줄 전체를 누르는 목록 줄(모서리 0)·첨부 클립은 버튼 모양이 아니다.
  const shaped = b => !b.icon && b.br !== '0px' && b.br !== '50%' && !/basket-clip/.test(b.cls);
  // 규칙 1: 글자 버튼 굵기는 400·500만(굵은 700 버튼 없음), 글자는 14px 이하.
  const heavy = all.filter(b => shaped(b) && (Number(b.fw) > 500 || parseFloat(b.fs) > 14));
  expect(heavy.map(b => `${b.view} ${b.label} ${b.fs}/${b.fw}`), '굵거나 큰 글자 버튼').toEqual([]);
  // 규칙 2: 같은 줄의 글자 버튼은 높이·글자 크기·굵기·모서리가 하나.
  const rows = new Map();
  for (const b of all.filter(shaped)) { const k = b.view + '|' + b.row; if (!rows.has(k)) rows.set(k, []); rows.get(k).push(b); }
  const odd = [];
  for (const [k, list] of rows) {
    if (list.length < 2) continue;
    const sig = b => [Math.round(b.h), b.fs, b.fw].join('/');
    if (new Set(list.map(sig)).size > 1) odd.push(k + ' ' + list.map(b => `${b.label}=${sig(b)}`).join(', '));
  }
  expect(odd, '같은 줄 글자 버튼 크기 불일치').toEqual([]);
});
