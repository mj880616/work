// SEC-Web2CSP 1단계(보고만 하기): 운영 Worker(cloudflare/bokdoong-router.mjs)가 Web2 첫 화면·로그인 화면에 붙이는
// Content-Security-Policy-Report-Only 헤더(cloudflare/web2-csp.mjs)를 시험 서버 응답에도 똑같이 붙이고,
// 로그인 → 16개 메뉴를 한 바퀴 여는 동안 CSP 위반(securitypolicyviolation)이 0개인지 본다. 가짜 서버(filter-chip-fixture)만 쓴다.
import {test, expect} from '@playwright/test';
import {appOrigin} from './helpers/test-origin.mjs';
import {baseState, mockApp, signIn} from './helpers/filter-chip-fixture.mjs';
import {WEB2_CSP, WEB2_REFERRER_POLICY} from '../../cloudflare/web2-csp.mjs';

const VIEWS = ['home', 'calendar', 'tasks', 'journal', 'diary', 'photos', 'basket', 'library', 'meetings', 'team', 'pages', 'telegram', 'calls', 'ledger', 'hwp', 'arsenal'];
// 운영 Worker가 정책을 붙이는 주소(web2CspPage)를 시험 서버 경로(/app/…)로 옮긴 것.
const PAGES = new Set(['/app/', '/app/index.html', '/app/login/', '/app/login/index.html']);

async function withReportOnlyCsp(page) {
  const violations = [], served = [];
  await page.exposeFunction('__kptuCspViolation', v => violations.push(v));
  await page.addInitScript(() => {
    addEventListener('securitypolicyviolation', e => {
      window.__kptuCspViolation?.({page: location.pathname || location.href, directive: e.effectiveDirective || e.violatedDirective,
        blocked: e.blockedURI, source: e.sourceFile ? `${e.sourceFile}:${e.lineNumber}` : '', sample: e.sample || '', disposition: e.disposition});
    }, true);
  });
  await page.route(url => url.origin === appOrigin && PAGES.has(url.pathname), async route => {
    const response = await route.fetch();
    served.push(new URL(route.request().url()).pathname);
    await route.fulfill({response, headers: {...response.headers(), 'content-security-policy-report-only': WEB2_CSP, 'referrer-policy': WEB2_REFERRER_POLICY}});
  });
  return {violations, served};
}

async function boot(page, width, height) {
  await page.setViewportSize({width, height});
  const watch = await withReportOnlyCsp(page);
  const state = baseState(); state.meetings = []; state.meetingWrites = []; state.downloads = []; state.deletes = [];
  await mockApp(page, state);
  await signIn(page);
  return watch;
}

test('보고 장치 확인: 정책 밖 주소는 위반으로 잡히되 막히지는 않는다(Report-Only)', async ({page}) => {
  const {violations, served} = await boot(page, 412, 915);
  expect(served).toEqual(expect.arrayContaining(['/app/', '/app/login/']));
  expect(violations).toEqual([]);
  await page.evaluate(() => { const img = new Image(); img.src = 'https://csp-check.invalid/x.png'; });
  await expect.poll(() => violations.filter(v => v.blocked.startsWith('https://csp-check.invalid')).length).toBe(1);
  expect(violations[0]).toMatchObject({directive: 'img-src', disposition: 'report'});
  // 보고만 하므로 화면은 그대로 동작한다.
  await expect(page.locator('#appView')).toBeVisible();
});

for (const [width, height] of [[412, 915], [1280, 900]]) {
  test(`${width}px: 로그인과 16개 메뉴를 한 바퀴 여는 동안 CSP 위반 0개`, async ({page}) => {
    test.setTimeout(240000);
    const {violations, served} = await boot(page, width, height);
    expect(served).toEqual(expect.arrayContaining(['/app/', '/app/login/']));
    const opened = [];
    for (const view of VIEWS) {
      await page.evaluate(v => window.KPTURouter.go(v), view);
      await page.waitForFunction(v => window.KPTURouter?.current === v && window.KPTUViewLoader?.isLoaded?.(v) !== false
        && !!document.querySelector('#appView .view-panel:not(.hidden)'), view, {timeout: 20000});
      await page.waitForTimeout(1200);
      opened.push(view);
    }
    expect(opened).toEqual(VIEWS);
    const lines = violations.map(v => `${v.page} ${v.directive} ${v.blocked} ${v.source} ${v.sample}`.trim());
    expect(lines, 'CSP 위반(보고 전용 정책 기준)').toEqual([]);
  });
}
