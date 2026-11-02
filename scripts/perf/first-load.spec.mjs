// PERF-첫로딩 측정(설계용, docs/design/first-load.md 2장). CI에서 돌지 않는다(CI는 tests/app-e2e만 실행).
// 로컬에서 Pages 빌드 결과를 띄워 로그인된 화면 하나를 새로 열 때의 요청 수·크기·표시 시각을 잰다.
// Supabase 자료는 tests/app-e2e/helpers/home-entry.mjs의 흉내 서버가 즉시 답하므로, 숫자는 "프로그램 파일을 받고 실행하는 시간"만이다.
//
// 실행(저장소 루트):
//   (cd scripts && npm ci)                       # 빌드에 필요한 acorn
//   git archive HEAD | tar -x -C /tmp/src && node scripts/build-pages.mjs /tmp/src /tmp/site
//   (cd /tmp/site && python3 -m http.server 8125) &
//   npm i --no-save @playwright/test@<설치된 playwright와 같은 판>
//   WEB2_TEST_ORIGIN=http://127.0.0.1:8125 APP_E2E_ORIGIN=http://127.0.0.1:8125 \
//     npx playwright test scripts/perf/first-load.spec.mjs --workers=1 --reporter=line
// 결과는 한 줄 JSON(PERF …)으로 찍힌다. 같은 조건을 3번 재서 가운데 값을 쓴다.
import { test } from '@playwright/test';
import { openHome } from '../../tests/app-e2e/helpers/home-entry.mjs';
import { testOrigin } from '../../tests/app-e2e/helpers/test-origin.mjs';

const views = (process.env.PERF_VIEWS || 'home,team,ledger').split(',');
const runs = Number(process.env.PERF_RUNS || 3);
// 조건: local = 네트워크 지연 없음(PC, 실행 비용만), phone = 폰 4G 흉내(왕복 150ms, 내려받기 9Mbps, CPU 4배 느리게),
// phone-warm = phone과 같되 한 번 미리 연 뒤 잰다(다시 방문). Playwright는 page.route(Supabase 흉내)를 쓰면 브라우저 캐시를 끄므로,
// 운영에서 "1년·immutable"로 캐시되는 ?v= 파일을 처음 받은 내용으로 즉시 돌려줘 캐시 적중을 흉내 낸다(디스크 읽기·V8 코드 캐시 이득은 빠짐).
const phoneNet = { latency: 150, downloadThroughput: 9e6 / 8, uploadThroughput: 1.5e6 / 8 };
const allProfiles = {
  local: { viewport: { width: 1280, height: 800 }, net: null, cpu: 1 },
  phone: { viewport: { width: 412, height: 915 }, net: phoneNet, cpu: 4 },
  'phone-warm': { viewport: { width: 412, height: 915 }, net: phoneNet, cpu: 4, warm: true },
};
const profiles = Object.fromEntries((process.env.PERF_PROFILES || 'local,phone,phone-warm').split(',').map(k => [k, allProfiles[k]]));
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

for (const [name, profile] of Object.entries(profiles)) {
  test(`first load ${name}`, async ({ page }) => {
    test.setTimeout(600000);
    await page.setViewportSize(profile.viewport);
    // 앱이 화면을 보이는 순간(#appView.kptu-ui-ready)을 페이지 시계로 기록한다.
    await page.addInitScript(() => {
      performance.setResourceTimingBufferSize(5000); // 기본 250개로는 모자란다
      // openHome이 page.clock으로 시계를 바꾸면 performance도 가짜가 된다. 이 스크립트가 먼저 돌므로 진짜를 잡아 둔다.
      const real = performance;
      window.__perf = { now: real.now.bind(real), entries: real.getEntriesByType.bind(real) };
      const mark = () => {
        const app = document.querySelector('#appView');
        if (app?.classList.contains('kptu-ui-ready') && !window.__perfReady) window.__perfReady = window.__perf.now();
      };
      new MutationObserver(mark).observe(document, { subtree: true, attributes: true, attributeFilter: ['class'], childList: true });
    });
    await openHome(page); // 로그인 세션을 만든다(그 뒤 새로 여는 화면은 이 세션으로 바로 들어간다).
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    if (profile.net) await cdp.send('Network.emulateNetworkConditions', { offline: false, ...profile.net });
    if (profile.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpu });
    if (profile.warm) {
      const memo = new Map();
      await page.route(url => url.origin === testOrigin && url.searchParams.has('v'), async route => {
        const key = route.request().url();
        if (!memo.has(key)) { const r = await route.fetch(); memo.set(key, { status: r.status(), headers: r.headers(), body: await r.body() }); }
        await route.fulfill(memo.get(key));
      });
    }
    const rows = [];
    for (const view of views) {
      const samples = [];
      for (let i = 0; i < runs; i++) {
        if (profile.warm && i === 0) { // 미리 한 번 열어 캐시를 채운다(재지 않음)
          await page.goto(`${testOrigin}/app/?view=${view}`);
          await page.waitForFunction(() => window.__perfReady, null, { timeout: 120000 });
          await page.waitForTimeout(4000);
        }
        await page.goto(`${testOrigin}/app/?view=${view}`);
        await page.waitForFunction(() => window.__perfReady, null, { timeout: 120000 });
        await page.waitForFunction(v => window.KPTUViewLoader?.isLoaded(v), view, { timeout: 120000 }).catch(() => {});
        const viewAt = await page.evaluate(() => window.__perf.now());
        await page.waitForTimeout(profile.net ? 4000 : 1500); // 쉬는 틈 미리 받기까지 모은다
        samples.push(await page.evaluate(({ viewAt }) => {
          const res = window.__perf.entries('resource');
          const ready = window.__perfReady;
          const js = r => /\.m?js(\?|$)/.test(r.name) && new URL(r.name).origin === location.origin;
          const css = r => /\.css(\?|$)/.test(r.name) && new URL(r.name).origin === location.origin;
          const before = res.filter(r => r.startTime <= ready);
          const sum = (list, key) => list.reduce((n, r) => n + (r[key] || 0), 0);
          const nav = window.__perf.entries('navigation')[0];
          return {
            ready: Math.round(ready), viewReady: Math.round(viewAt), domContentLoaded: Math.round(nav?.domContentLoadedEventEnd || 0), url: location.pathname + location.search,
            jsBeforeReady: before.filter(js).length, cssBeforeReady: before.filter(css).length,
            jsKBBeforeReady: Math.round(sum(before.filter(js), 'decodedBodySize') / 1024),
            jsTotal: res.filter(js).length, jsKBTotal: Math.round(sum(res.filter(js), 'decodedBodySize') / 1024),
            lastJsBeforeReady: Math.round(Math.max(0, ...before.filter(js).map(r => r.responseEnd))),
            // 시작 단계 수(2-1절 셈법): 보이기 전 JS 요청 시작 시각을 줄 세워 100ms 넘게 쉬면 새 단계로 센다(PERF-첫로딩 P4).
            jsStages: before.filter(js).map(r => r.startTime).sort((a, b) => a - b).reduce((n, t, i, all) => n + (i === 0 || t - all[i - 1] > 100 ? 1 : 0), 0),
            files: before.filter(js).map(r => [new URL(r.name).pathname, Math.round(r.decodedBodySize / 1024), Math.round(r.startTime), Math.round(r.responseEnd)]),
          };
        }, { viewAt }));
      }
      const pick = key => median(samples.map(s => s[key]));
      const { files, url, ...numbers } = samples[0];
      // PERF_DUMP=1이면 첫 측정의 파일 목록(경로, KB, 요청 시작, 받기 끝 ms)을 따로 찍는다.
      if (process.env.PERF_DUMP) console.log('PERF_FILES ' + JSON.stringify({ profile: name, view, files }));
      rows.push({ ...(process.env.PERF_ROUND ? { round: process.env.PERF_ROUND } : {}), profile: name, view, url, ...Object.fromEntries(Object.keys(numbers).map(k => [k, pick(k)])) });
    }
    for (const row of rows) console.log('PERF ' + JSON.stringify(row));
  });
}
