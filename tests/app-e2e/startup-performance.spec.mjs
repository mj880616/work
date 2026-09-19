import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const loaderUrl='http://127.0.0.1:8123/app/loader-v2.js?p6-startup-contract=1';
const read=path=>readFileSync(path,'utf8');

test('authenticated home commits before non-critical feature bundle', async ({ page }) => {
  const response=await page.request.get(loaderUrl);
  expect(response.ok()).toBeTruthy();
  const source=await response.text();
  const usable=source.indexOf('window.__KPTU_MARK_APP_UI_READY__?.()');
  const deferred=source.indexOf('defer(()=>loadFeatures()');
  expect(source).toContain('await window.__KPTU_HOME_READY__');
  expect(source).toContain('await window.__KPTU_START_TEAM_DATA__()');
  expect(usable).toBeGreaterThan(0);
  expect(deferred).toBeGreaterThan(usable);
  const criticalAwaitedImports=source.split('\n').filter(line=>/^  await import\(/.test(line));
  for(const path of ['project-system-v3','profile-settings','media-workflow','meeting-round-detail','google-tasks']){
    expect(criticalAwaitedImports.some(line=>line.includes(path))).toBeFalsy();
  }
});

test('direct feature URLs wait for the feature bundle and failures remain visible', async ({ page }) => {
  const source=await (await page.request.get(loaderUrl)).text();
  expect(source).toContain("if(requested&&requested!=='home')await loadFeatures()");
  expect(source).toContain("box.id='deferredFeatureError'");
  expect(source).toContain("setAttribute('role','alert')");
  expect(source).toContain('이 기능을 불러오지 못했습니다.');
});

test('home reuses authenticated boot context and guards stale-session commits', async () => {
  const home=read('app/home-dashboard-v2.js');
  const team=read('app/team.js');
  expect(home).toContain('window.__KPTU_BOOT_CONTEXT__');
  expect(home).toContain('if(epoch!==renderEpoch)return');
  expect(home).toContain("addEventListener('kptu:session-changed'");
  expect(team).toContain("addEventListener('kptu:session-changed'");
  expect(team).toContain("showOnly('authView')");
});

test('page builder and AI modules remain lazy or background-only', async ({ page }) => {
  const source=await (await page.request.get(loaderUrl)).text();
  expect(source).toContain("addEventListener('kptu:page-editor-opened',lazyPageBuilderOpen)");
  expect(source).toContain('await window.__KPTU_PAGE_BUILDER_READY__');
  for(const modulePath of ['./workplace-ai-report.js','./workflow-ai-v3.js','./meeting-ai-ingest-client.js','./meeting-ai-paste-ui.js']){
    expect(source.indexOf(modulePath)).toBeGreaterThan(source.indexOf("startup?.mark('allInitialModulesComplete')"));
  }
});

test('feature navigation waits for deferred readiness and bootstrap loads access approval', async () => {
  const source=read('app/loader-v2.js');
  expect(source).toContain("if(teamState==='bootstrap'){await import('./access-approval.js?v=4');return}");
  expect(source).toContain("event.stopImmediatePropagation()");
  expect(source).toContain("loadFeatures().then(()=>{status.remove()");
  expect(source).toContain("await Promise.all([window.__KPTU_HOME_READY__,mobileNavigationReady])");
});
