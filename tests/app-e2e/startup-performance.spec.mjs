import { test, expect } from '@playwright/test';

const loaderUrl='http://127.0.0.1:8123/app/loader-v2.js?task8-startup-contract=1';

test('page builder is absent from unconditional awaited startup imports', async ({ page }) => {
  const response=await page.request.get(loaderUrl);
  expect(response.ok()).toBeTruthy();
  const source=await response.text();
  expect(source.split('\n').some(line=>/^  await import\('\.\/page-builder\.js/.test(line))).toBeFalsy();
  expect(source).toContain("addEventListener('kptu:page-editor-opened',lazyPageBuilderOpen)");
});

test('lazy page builder preserves explicit readiness and critical team readiness', async ({ page }) => {
  const response=await page.request.get(loaderUrl);
  expect(response.ok()).toBeTruthy();
  const source=await response.text();
  expect(source).toContain('await window.__KPTU_TEAM_READY__');
  expect(source).toContain('await window.__KPTU_PAGE_BUILDER_READY__');
  expect(source).toContain('window.__KPTU_MARK_APP_UI_READY__?.()');
});

test('AI feature modules stay out of the unconditional awaited startup path', async ({ page }) => {
  const response=await page.request.get(loaderUrl);
  expect(response.ok()).toBeTruthy();
  const source=await response.text();
  const startupLines=source.split('\n').filter(line=>/^  await import\(/.test(line));
  for(const modulePath of [
    './workplace-ai-report.js',
    './workflow-ai-v3.js',
    './meeting-ai-ingest-client.js',
    './meeting-ai-paste-ui.js'
  ]) expect(startupLines.some(line=>line.includes(modulePath))).toBeFalsy();
  expect(source).toContain("addEventListener('kptu:app-ui-ready'");
});
