// PERF-첫로딩 P1(측정 기준선, docs/design/first-load.md 7절). CI 검사 묶음(tests/app-e2e)에 들어가지 않는다.
// 두 가지를 잰다. 숫자만 남기고 화면 내용은 남기지 않는다(화면 이름·밀리초·파일 수·KB).
//  1) shell: 로그인 안 한 채 /app/을 열어 로그인 화면이 뜰 때까지(첫 화면 껍데기). 실제 계정·비밀값 없음.
//  2) switch: 흉내 로그인(tests/app-e2e/helpers/home-entry.mjs, 자료는 즉시 답함)으로 홈을 연 뒤
//     메뉴를 사람처럼 눌러 화면을 바꾼다. 마지막 클릭 → 화면 바뀜(kptu:view-changed) → 기다림 표시([data-wait]) 사라짐 시각과
//     그 사이 새로 받은 같은 출처 JS 파일 수·KB를 잰다. 마지막에 홈으로 돌아오는 값(다시 들어가기)도 함께 본다.
// 실행법은 scripts/perf/first-load.spec.mjs 머리 주석과 같다(이 파일 이름만 바꾼다). 결과는 한 줄 JSON(PERF_SHELL …, PERF_SWITCH …).
import { test } from '@playwright/test';
import { openHome } from '../../tests/app-e2e/helpers/home-entry.mjs';
import { clickView } from '../../tests/app-e2e/helpers/shell-navigation.mjs';
import { testOrigin } from '../../tests/app-e2e/helpers/test-origin.mjs';

const phoneNet = { latency: 150, downloadThroughput: 9e6 / 8, uploadThroughput: 1.5e6 / 8 };
const allProfiles = {
  local: { viewport: { width: 1280, height: 800 }, net: null, cpu: 1 },
  phone: { viewport: { width: 412, height: 915 }, net: phoneNet, cpu: 4 },
};
const profiles = Object.fromEntries((process.env.PERF_PROFILES || 'local,phone').split(',').filter(k => allProfiles[k]).map(k => [k, allProfiles[k]]));
// 메뉴 앞쪽 화면 순서. 마지막 home은 "갔던 화면으로 돌아오기".
const route = (process.env.PERF_SWITCH_VIEWS || 'calendar,tasks,meetings,library,team,ledger,home').split(',');
const round = process.env.PERF_ROUND || '1';
const runs = Number(process.env.PERF_RUNS || 3); // 한 회차 안에서 재는 횟수(가운데 값)
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const isJs = url => { try { const u = new URL(url); return u.origin === testOrigin && /\.m?js$/.test(u.pathname); } catch { return false; } };

// CDP로 같은 출처 JS 요청을 센다(문서가 바뀌어도 이어서 센다). 크기는 풀린 크기(dataReceived 합).
async function jsMeter(page, profile) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  if (profile.net) await cdp.send('Network.emulateNetworkConditions', { offline: false, ...profile.net });
  if (profile.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpu });
  const seen = new Map();
  cdp.on('Network.requestWillBeSent', e => { if (isJs(e.request.url) && !seen.has(e.requestId)) seen.set(e.requestId, 0); });
  cdp.on('Network.dataReceived', e => { if (seen.has(e.requestId)) seen.set(e.requestId, seen.get(e.requestId) + e.dataLength); });
  return { mark: () => new Set(seen.keys()), since: before => { const ids = [...seen.keys()].filter(id => !before.has(id)); return { files: ids.length, kb: Math.round(ids.reduce((n, id) => n + seen.get(id), 0) / 1024) }; } };
}

for (const [name, profile] of Object.entries(profiles)) {
  test(`shell ${name}`, async ({ browser }) => {
    test.setTimeout(300000);
    const samples = [];
    for (let rep = 0; rep < runs; rep++) { // 매번 새 브라우저 문맥(캐시 빈 첫 방문)
      const context = await browser.newContext({ viewport: profile.viewport });
      const page = await context.newPage();
      const meter = await jsMeter(page, profile);
      const start = Date.now();
      await page.goto(`${testOrigin}/app/`);
      await page.waitForURL(url => url.pathname === '/app/login/', { timeout: 120000 });
      await page.locator('#googleLoginBtn').waitFor({ state: 'visible', timeout: 120000 });
      const shownMs = Date.now() - start;
      await page.waitForLoadState('load');
      samples.push({ shownMs, ...meter.since(new Set()) });
      await context.close();
    }
    const pick = key => median(samples.map(s => s[key]));
    console.log('PERF_SHELL ' + JSON.stringify({ round, profile: name, view: 'login', shownMs: pick('shownMs'), jsFiles: pick('files'), jsKB: pick('kb') }));
  });

  test(`switch ${name}`, async ({ page }) => {
    test.setTimeout(600000);
    await page.setViewportSize(profile.viewport);
    // 마지막 클릭 시각을 페이지 진짜 시계로 잡는다(openHome이 page.clock으로 시계를 바꾸기 전에 붙는다).
    await page.addInitScript(() => {
      const real = performance;
      const now = real.now.bind(real);
      window.__perfSwitch = { now, click: 0, changed: {} };
      document.addEventListener('click', e => { if (e.target.closest?.('[data-view],[data-mobile-schedule-tab],.sidebar-brand,[data-account-open],#mobileMenuTab')) window.__perfSwitch.click = now(); }, true);
      window.addEventListener('kptu:view-changed', e => { window.__perfSwitch.changed[e.detail?.view] = now(); });
    });
    await openHome(page);
    const meter = await jsMeter(page, profile);
    const samples = [];
    for (let rep = 0; rep < runs; rep++) { // 홈을 새로 열고 같은 순서로 runs번 눌러 가운데 값을 쓴다
    await page.goto(`${testOrigin}/app/?view=home`);
    await page.waitForFunction(() => document.querySelector('#appView.kptu-ui-ready'), null, { timeout: 120000 });
    await page.waitForTimeout(profile.net ? 6000 : 2000); // 쉬는 틈 미리 받기(view-loader.js warm)까지 끝난 상태에서 누른다
    const rows = [];
    samples.push(rows);
    for (const [i, view] of route.entries()) {
      const before = meter.mark();
      await page.evaluate(v => { window.__perfSwitch.changed[v] = 0; window.__perfSwitch.click = 0; }, view);
      await clickView(page, view);
      await page.waitForFunction(v => window.__perfSwitch.changed[v] > 0 && window.KPTUViewLoader?.isLoaded?.(v) !== false, view, { timeout: 120000 });
      // 화면 칸 안 기다림 표시가 사라질 때까지(자료는 흉내 서버라 즉시 온다 → 코드 받기·그리기 시간).
      await page.waitForFunction(v => {
        const panel = document.getElementById(v + 'View');
        return !panel || ![...panel.querySelectorAll('[data-wait]')].some(n => n.offsetParent);
      }, view, { timeout: 30000 }).catch(() => {});
      const t = await page.evaluate(v => ({ click: window.__perfSwitch.click, changed: window.__perfSwitch.changed[v], settled: window.__perfSwitch.now() }), view);
      const { files, kb } = meter.since(before);
      rows.push({ round, profile: name, step: i + 1, view, shownMs: Math.round(t.changed - t.click), settledMs: Math.round(t.settled - t.click), newJsFiles: files, newJsKB: kb });
      await page.waitForTimeout(profile.net ? 2500 : 800); // 다음 클릭 전에 늦게 오는 요청을 이 화면 몫으로 모은다
      const late = meter.since(before);
      rows.at(-1).newJsFilesIdle = late.files;
      rows.at(-1).newJsKBIdle = late.kb;
    }
    }
    for (const [i, first] of samples[0].entries()) {
      const pick = key => median(samples.map(rows => rows[i][key]));
      const row = { ...first };
      for (const key of ['shownMs', 'settledMs', 'newJsFiles', 'newJsKB', 'newJsFilesIdle', 'newJsKBIdle']) row[key] = pick(key);
      console.log('PERF_SWITCH ' + JSON.stringify(row));
    }
  });
}
